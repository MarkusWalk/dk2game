// ============================================================
// INPUT — drag-select / single-click to mark tiles
// ============================================================
// Drag-rectangle for build modes (dig / treasury / lair / hatchery) and
// single-click for hand / spell modes. Same code path for mouse + touch;
// multi-touch events peel off to camera-controls' two-finger handler.

import {
  T_ROCK, T_GOLD, T_REINFORCED, T_CLAIMED,
  PREVIEW_COLORS,
} from './constants.js';
import {
  grid, jobs, imps, creatures,
  buildModeRef, dragState, previewMeshes, previewPool, handState,
} from './state.js';
import { scene, renderer, tileGroup } from './scene.js';
import { PREVIEW_GEO, PREVIEW_MAT } from './materials.js';
import { markForDig, unmarkTile } from './jobs.js';
import { designateTile, undesignateTile } from './rooms.js';
import { cameraRef, didRmbDrag, clearMouseDragFlags } from './camera-controls.js';
import { pickUpEntity, dropHeld, hideDropIndicator, resolveDropTile, setDropIndicatorPos } from './hand.js';
import { castLightning, castHeal, castCallToArms, castHaste } from './spells.js';
import { playSfx } from './audio.js';
import { isWalkable } from './pathfinding.js';
import { slapEntity } from './slap.js';

const THREE = window.THREE;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Pointer coords — normalized for mouse events (clientX/Y) or touch events (touches[0]).
function getPointerPos(ev) {
  if (ev.touches && ev.touches.length > 0) {
    return { clientX: ev.touches[0].clientX, clientY: ev.touches[0].clientY };
  }
  if (ev.changedTouches && ev.changedTouches.length > 0) {
    return { clientX: ev.changedTouches[0].clientX, clientY: ev.changedTouches[0].clientY };
  }
  return { clientX: ev.clientX, clientY: ev.clientY };
}

function getTileUnderPointer(ev) {
  const pos = getPointerPos(ev);
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((pos.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((pos.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, cameraRef.camera);
  // tileGroup import is available via scene module
  const hits = raycaster.intersectObjects(_getTileGroupChildren(), false);
  if (hits.length === 0) return null;
  const ud = hits[0].object.userData;
  if (ud && ud.gridX !== undefined) return { x: ud.gridX, z: ud.gridZ };
  return null;
}

function _getTileGroupChildren() { return tileGroup.children; }

function getPreviewMesh() {
  if (previewPool.length > 0) return previewPool.pop();
  const m = new THREE.Mesh(PREVIEW_GEO, PREVIEW_MAT);
  m.rotation.x = -Math.PI / 2;
  return m;
}

function clearPreview() {
  for (const mesh of previewMeshes.values()) {
    scene.remove(mesh);
    previewPool.push(mesh);
  }
  previewMeshes.clear();
}

// --- Build mode dispatch helpers ---
// Each drag-select action asks: is this cell eligible for the current mode? Is it
// already applied? Then we apply or un-apply accordingly.
function modeEligible(cell, mode) {
  if (mode === 'dig') {
    return cell.type === T_ROCK || cell.type === T_GOLD || cell.type === T_REINFORCED;
  }
  // Room modes only touch your claimed floor — not heart, not walls, not unclaimed dirt.
  return cell.type === T_CLAIMED;
}
function modeAlreadyApplied(cell, mode) {
  if (mode === 'dig') return !!cell.marker;
  return cell.roomType === mode;
}
function applyMode(x, z, mode) {
  if (mode === 'dig') { markForDig(x, z); return true; }
  return designateTile(x, z, mode);
}
function unapplyMode(x, z, mode) {
  if (mode === 'dig') { unmarkSingle(x, z); return true; }
  return undesignateTile(x, z);
}

function updatePreview() {
  const { dragStart, dragCurrent } = dragState;
  if (!dragStart || !dragCurrent) { clearPreview(); return; }
  const minX = Math.min(dragStart.x, dragCurrent.x);
  const maxX = Math.max(dragStart.x, dragCurrent.x);
  const minZ = Math.min(dragStart.z, dragCurrent.z);
  const maxZ = Math.max(dragStart.z, dragCurrent.z);

  const wanted = new Set();
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      const cell = grid[x] && grid[x][z];
      if (!cell) continue;
      if (modeEligible(cell, buildModeRef.value)) wanted.add(x + ',' + z);
    }
  }
  // Remove stale
  for (const [key, mesh] of Array.from(previewMeshes)) {
    if (!wanted.has(key)) {
      scene.remove(mesh);
      previewPool.push(mesh);
      previewMeshes.delete(key);
    }
  }
  // Add new
  for (const key of wanted) {
    if (previewMeshes.has(key)) continue;
    const [x, z] = key.split(',').map(Number);
    const m = getPreviewMesh();
    m.position.set(x, 1.22, z);
    scene.add(m);
    previewMeshes.set(key, m);
  }
}

function unmarkSingle(x, z) {
  unmarkTile(x, z);
  // Only remove dig jobs (auto claim/reinforce jobs are system-driven and stay)
  const jIdx = jobs.findIndex(j => j.x === x && j.z === z && j.type === 'dig');
  if (jIdx >= 0) {
    const job = jobs[jIdx];
    if (job.claimedBy && job.claimedBy.userData.job === job) {
      job.claimedBy.userData.state = 'idle';
      job.claimedBy.userData.job = null;
    }
    jobs.splice(jIdx, 1);
  }
}

function applySelection() {
  const { dragStart, dragCurrent } = dragState;
  if (!dragStart || !dragCurrent) return;
  const minX = Math.min(dragStart.x, dragCurrent.x);
  const maxX = Math.max(dragStart.x, dragCurrent.x);
  const minZ = Math.min(dragStart.z, dragCurrent.z);
  const maxZ = Math.max(dragStart.z, dragCurrent.z);

  // Single-tile = toggle
  if (minX === maxX && minZ === maxZ) {
    const cell = grid[minX][minZ];
    if (!modeEligible(cell, buildModeRef.value)) return;
    if (modeAlreadyApplied(cell, buildModeRef.value)) unapplyMode(minX, minZ, buildModeRef.value);
    else applyMode(minX, minZ, buildModeRef.value);
    return;
  }

  // Area: collect all eligible tiles in rect. If every one is already applied, un-apply all.
  // Otherwise, apply to every un-applied one. Classic "toggle-rectangle" behavior from DK.
  const affected = [];
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      const cell = grid[x][z];
      if (modeEligible(cell, buildModeRef.value)) affected.push({ x, z, cell });
    }
  }
  if (affected.length === 0) return;
  const allApplied = affected.every(a => modeAlreadyApplied(a.cell, buildModeRef.value));
  if (allApplied) {
    for (const a of affected) unapplyMode(a.x, a.z, buildModeRef.value);
  } else {
    for (const a of affected) if (!modeAlreadyApplied(a.cell, buildModeRef.value)) applyMode(a.x, a.z, buildModeRef.value);
  }
}

// Raycast against every imp + creature. Returns the top-level Group, or null.
function getEntityUnderPointer(ev) {
  const pos = getPointerPos(ev);
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((pos.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((pos.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, cameraRef.camera);
  // Build a flat list of all entity meshes. Each entity is a Group — we want hits on
  // their children, then we walk back up to the Group to return the entity itself.
  const targets = [];
  for (const imp of imps) targets.push(imp);
  for (const c of creatures) targets.push(c);
  const hits = raycaster.intersectObjects(targets, true);
  if (hits.length === 0) return null;
  // Walk up the parent chain to find which entity group this belongs to
  let obj = hits[0].object;
  while (obj && !imps.includes(obj) && !creatures.includes(obj)) obj = obj.parent;
  return obj || null;
}

// --- Pointer handlers (mouse + touch share a single code path) ---
// Branches on buildMode: 'hand' uses tap-to-pick / tap-to-drop; all other modes use
// the existing drag-rectangle selection flow.
function pointerDown(ev) {
  const buildMode = buildModeRef.value;
  if (buildMode === 'hand') {
    const entity = getEntityUnderPointer(ev);
    if (entity) {
      pickUpEntity(entity);
    } else if (handState.heldEntity) {
      const tile = getTileUnderPointer(ev);
      if (tile) dropHeld(tile);
    }
    return true;
  }
  if (buildMode === 'lightning') {
    const tile = getTileUnderPointer(ev);
    if (tile) castLightning(tile.x, tile.z);
    else playSfx('spell_fail');
    return true;
  }
  if (buildMode === 'heal') {
    const entity = getEntityUnderPointer(ev);
    if (entity) castHeal(entity);
    else playSfx('spell_fail');
    return true;
  }
  if (buildMode === 'callToArms') {
    const tile = getTileUnderPointer(ev);
    if (tile) castCallToArms(tile.x, tile.z);
    else playSfx('spell_fail');
    return true;
  }
  if (buildMode === 'haste') {
    const entity = getEntityUnderPointer(ev);
    if (entity) castHaste(entity);
    else playSfx('spell_fail');
    return true;
  }
  // Designation modes (dig/treasury/lair/hatchery): if the click lands on one
  // of our own units, slap them instead of starting a drag-paint. Heroes are
  // not slappable — getEntityUnderPointer already restricts to imps+creatures.
  const entity = getEntityUnderPointer(ev);
  if (entity) {
    slapEntity(entity);
    return true;
  }
  const tile = getTileUnderPointer(ev);
  if (!tile) return false;
  dragState.isDragging = true;
  dragState.dragStart = tile;
  dragState.dragCurrent = tile;
  updatePreview();
  return true;
}
function pointerMove(ev) {
  const buildMode = buildModeRef.value;
  if (buildMode === 'hand') {
    const tile = getTileUnderPointer(ev);
    if (tile) {
      handState.handPointerTile = tile;
      if (handState.heldEntity) {
        const valid = isWalkable(tile.x, tile.z) || resolveDropTile(tile.x, tile.z) !== null;
        setDropIndicatorPos(tile.x, tile.z, valid);
      }
    }
    return true;
  }
  if (buildMode === 'lightning' || buildMode === 'heal' ||
      buildMode === 'callToArms' || buildMode === 'haste') {
    // Spells are single-click; no hover preview in v1.
    return true;
  }
  if (!dragState.isDragging) return false;
  const tile = getTileUnderPointer(ev);
  if (!tile) return false;
  if (dragState.dragCurrent && tile.x === dragState.dragCurrent.x && tile.z === dragState.dragCurrent.z) return false;
  dragState.dragCurrent = tile;
  updatePreview();
  return true;
}
function pointerUp() {
  const buildMode = buildModeRef.value;
  if (buildMode === 'hand') return;  // tap-semantics, nothing to finish
  if (buildMode === 'lightning' || buildMode === 'heal' ||
      buildMode === 'callToArms' || buildMode === 'haste') return;  // single-click, handled on down
  if (!dragState.isDragging) return;
  dragState.isDragging = false;
  applySelection();
  dragState.dragStart = null;
  dragState.dragCurrent = null;
  clearPreview();
}
function pointerCancel() {
  if (!dragState.isDragging) return;
  dragState.isDragging = false;
  dragState.dragStart = null;
  dragState.dragCurrent = null;
  clearPreview();
}

// --- Build mode switching ---
export function setBuildMode(mode) {
  if (!(mode in PREVIEW_COLORS)) return;
  // Leaving hand mode while carrying something: drop it at its current grid position
  if (buildModeRef.value === 'hand' && mode !== 'hand') {
    if (handState.heldEntity) dropHeld();
    hideDropIndicator();
    handState.handPointerTile = null;
  }
  buildModeRef.value = mode;
  PREVIEW_MAT.color.setHex(PREVIEW_COLORS[mode]);
  document.querySelectorAll('#toolbar .mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  // If user flips modes mid-drag, rebuild the preview to show the new eligibility set
  if (dragState.isDragging) updatePreview();
}

// Right-click = universal un-designate. Erases dig marks or any room type on the
// tile under the pointer. DK muscle-memory — also the fastest way to undo a
// stray drag-paint. Drag-paint with RMB held would be a nicer follow-up.
function rightClickUndesignate(ev) {
  const tile = getTileUnderPointer(ev);
  if (!tile) return;
  const cell = grid[tile.x][tile.z];
  if (cell.marker) {
    unmarkSingle(tile.x, tile.z);
    playSfx('whoosh', { minInterval: 80 });
    return;
  }
  if (cell.roomType) {
    undesignateTile(tile.x, tile.z);
    playSfx('whoosh', { minInterval: 80 });
  }
}

export function installInput() {
  // Mouse events.
  //
  // Left button  → drag-paint / slap / hand pickup (via pointerDown).
  // Right button → click without drag = un-designate.
  //                drag past threshold = camera-pan (handled in camera-controls).
  //                Decision happens on mouseup via didRmbDrag(); if the press
  //                was promoted to a pan, skip the un-designate.
  // Middle button → always a camera pan (camera-controls owns it).
  renderer.domElement.addEventListener('mousedown', (ev) => {
    if (ev.button === 2) return;   // RMB handled on mouseup (drag vs. click)
    if (ev.button !== 0) return;
    pointerDown(ev);
  });
  renderer.domElement.addEventListener('mousemove', (ev) => { pointerMove(ev); });
  renderer.domElement.addEventListener('mouseup', (ev) => {
    if (ev.button === 2) {
      if (!didRmbDrag()) rightClickUndesignate(ev);
      clearMouseDragFlags();
      return;
    }
    if (ev.button !== 0) return;
    pointerUp();
  });
  renderer.domElement.addEventListener('mouseleave', pointerCancel);

  // Touch events — require single-touch; multi-finger gestures abort the drag so a
  // two-finger tap never accidentally marks tiles. passive:false lets us preventDefault
  // to block browser scroll/pull-to-refresh while the player is painting.
  renderer.domElement.addEventListener('touchstart', (ev) => {
    if (ev.touches.length !== 1) { pointerCancel(); return; }
    ev.preventDefault();
    pointerDown(ev);
  }, { passive: false });
  renderer.domElement.addEventListener('touchmove', (ev) => {
    if (ev.touches.length !== 1) { pointerCancel(); return; }
    ev.preventDefault();
    pointerMove(ev);
  }, { passive: false });
  renderer.domElement.addEventListener('touchend', (ev) => {
    ev.preventDefault();
    pointerUp();
  }, { passive: false });
  renderer.domElement.addEventListener('touchcancel', pointerCancel);

  // Block browser context menu on long-press + dragstart so the canvas stays "ours"
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
  renderer.domElement.addEventListener('dragstart', e => e.preventDefault());

  document.querySelectorAll('#toolbar .mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setBuildMode(btn.dataset.mode));
  });

  // Mode hotkeys. Updated to cover new rooms (Training/Library) and spells
  // (Call to Arms + Haste). Number row matches the toolbar left→right order.
  const MODE_ORDER = [
    'dig', 'treasury', 'lair', 'hatchery',
    'training', 'library', 'hand',
    'lightning', 'heal', 'callToArms', 'haste',
  ];
  window.addEventListener('keydown', (ev) => {
    if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) return;
    const k = ev.key.toLowerCase();
    if      (k === '1') setBuildMode('dig');
    else if (k === '2') setBuildMode('treasury');
    else if (k === '3') setBuildMode('lair');
    else if (k === '4') setBuildMode('hatchery');
    else if (k === '5') setBuildMode('training');
    else if (k === '6') setBuildMode('library');
    else if (k === '7') setBuildMode('hand');
    else if (k === '8') setBuildMode('lightning');
    else if (k === '9') setBuildMode('heal');
    else if (k === '0') setBuildMode('callToArms');
    else if (k === '-') setBuildMode('haste');
    else if (k === ']' || k === '}') {
      const i = MODE_ORDER.indexOf(buildModeRef.value);
      setBuildMode(MODE_ORDER[(i + 1) % MODE_ORDER.length]);
    } else if (k === '[' || k === '{') {
      const i = MODE_ORDER.indexOf(buildModeRef.value);
      setBuildMode(MODE_ORDER[(i - 1 + MODE_ORDER.length) % MODE_ORDER.length]);
    } else if (k === 'escape') {
      dropHeld();
      setBuildMode('dig');
    }
  });
}
