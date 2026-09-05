// ============================================================
// BABYLON INPUT — tile painting, spell targeting, selection, camera
// ============================================================
// This controller deliberately talks to the Babylon rewrite through small,
// feature-detected public APIs. That keeps input usable while the rendering,
// world, entity, VFX, and HUD modules evolve independently.
//
// Required:
//   runtime = { scene, camera, canvas, engine }
//   world   = { getCell(x,z), dig, claim, reinforce, buildRoom }
// Optional entity/effect/UI methods are discovered at the call site. Tile
// meshes should expose metadata with gridX/gridZ, tileX/tileZ, or tile:{x,z};
// entity meshes should expose metadata.entity or metadata.entityId.

const BABYLON = window.BABYLON;

const ROOM_MODES = new Set([
  'treasury', 'lair', 'hatchery', 'training', 'library', 'workshop',
  'prison', 'torture', 'temple',
]);

// Single source of truth for room pricing: ui.js imports this so the price the
// palette advertises can never drift from the price actually charged here.
export const ROOM_COSTS = Object.freeze({
  treasury: 50,
  lair: 75,
  hatchery: 85,
  training: 120,
  library: 150,
  workshop: 175,
  prison: 140,
  torture: 190,
  temple: 220,
});

const DOOR_MODE_KINDS = Object.freeze({
  woodDoor: 'ironwood', ironwoodDoor: 'ironwood', bracedDoor: 'braced',
  steelDoor: 'steel', magicDoor: 'magic',
});
const TRAP_MODE_KINDS = Object.freeze({
  spikeTrap: 'spike', sentryTrap: 'sentry', lightningTrap: 'lightning',
  fearTrap: 'fear', gasTrap: 'gas', boulderTrap: 'boulder', alarmTrap: 'alarm',
});
const DEFENSE_MODES = new Set([...Object.keys(DOOR_MODE_KINDS), ...Object.keys(TRAP_MODE_KINDS)]);
const TILE_MODES = new Set(['dig', 'claim', 'reinforce', 'sell', ...ROOM_MODES, ...DEFENSE_MODES]);
const TILE_SPELLS = new Set(['lightning', 'rally', 'summon', 'sight', 'tremor', 'inferno', 'createGold']);
const ENTITY_SPELLS = new Set(['heal', 'haste', 'possess', 'protect', 'conceal', 'chicken', 'turncoat']);
const VALID_MODES = new Set(['select', ...TILE_MODES, ...TILE_SPELLS, ...ENTITY_SPELLS]);

const MODE_ALIASES = Object.freeze({
  hand: 'select',
  callToArms: 'rally',
  call_to_arms: 'rally',
  createImp: 'summon',
  create_imp: 'summon',
});

const MODE_ORDER = Object.freeze([
  'select', 'dig', 'claim', 'reinforce',
  'treasury', 'lair', 'hatchery', 'training', 'library', 'workshop',
  'woodDoor', 'bracedDoor', 'steelDoor', 'magicDoor',
  'spikeTrap', 'sentryTrap', 'lightningTrap', 'fearTrap', 'gasTrap', 'boulderTrap', 'alarmTrap',
  'lightning', 'heal', 'rally', 'summon', 'possess',
]);

const SHORTCUT_MODES = Object.freeze({
  '1': 'dig',
  '2': 'claim',
  '3': 'treasury',
  '4': 'lair',
  '5': 'hatchery',
  '6': 'training',
  '7': 'library',
  '8': 'hand',
  '9': 'heal',
  '0': 'lightning',
  '-': 'callToArms',
  '=': 'haste',
  f: 'reinforce',
  i: 'createImp',
  p: 'possess',
});

const POINTER_DRAG_THRESHOLD = 6;
const CAMERA_ZOOM_MIN = 7;
const CAMERA_ZOOM_MAX = 80;
const CAMERA_KEY_SPEED = 680;
const CAMERA_ROTATE_SPEED = 1.6;

function isEditableTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function invokeFirst(candidates) {
  for (const candidate of candidates) {
    const owner = candidate && candidate[0];
    const name = candidate && candidate[1];
    if (!owner || typeof owner[name] !== 'function') continue;
    return { called: true, result: owner[name](...(candidate[2] || [])) };
  }
  return { called: false, result: undefined };
}

function stopEvent(ev) {
  if (ev.cancelable) ev.preventDefault();
  ev.stopPropagation();
}

/**
 * Unified input controller for the Babylon renderer.
 *
 * Construction installs listeners immediately. Call dispose() when replacing
 * a runtime. Public setMode(), cancel(), setPaused(), pick(), and update()
 * methods let a custom HUD or render loop drive the controller directly.
 */
export class InputController {
  constructor(runtime, world, entities = null, effects = null, ui = null) {
    if (!BABYLON) throw new Error('Babylon.js must be loaded before InputController');
    if (!runtime || !runtime.scene || !runtime.camera || !runtime.canvas) {
      throw new Error('InputController needs runtime.scene, runtime.camera, and runtime.canvas');
    }

    this.runtime = runtime;
    this.world = world || {};
    this.entities = entities || {};
    this.effects = effects || {};
    this.ui = ui || {};

    this.mode = 'select';
    this.selection = null;
    this.hover = null;
    this.enabled = true;
    this._installed = false;
    this._pausedFallback = false;
    this._painting = false;
    this._painted = new Set();
    this._lastPaintTile = null;
    this._keys = new Set();
    this._pointers = new Map();
    this._mousePan = null;
    this._touchGesture = null;
    this._touchGestureConsumed = false;
    this._pendingTouchAction = null;
    this._hoverKey = '';
    this._hoverRaf = 0;
    this._pendingHoverPoint = null;
    this._lastUpdateFrame = -1;
    this._listeners = [];
    this._beforeRenderObserver = null;
    this._oldTouchAction = runtime.canvas.style.touchAction;
    this._restoreCameraControl = false;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerCancel = this._onPointerCancel.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onDocumentClick = this._onDocumentClick.bind(this);
    this._onSetModeEvent = this._onSetModeEvent.bind(this);
    this._onContextMenu = (ev) => stopEvent(ev);

    this.install();
  }

  install() {
    if (this._installed) return this;
    this._installed = true;

    const canvas = this.runtime.canvas;
    canvas.style.touchAction = 'none';
    const cameraInputs = this.runtime.camera.inputs && this.runtime.camera.inputs.attached;
    if (
      cameraInputs && Object.keys(cameraInputs).length > 0 &&
      typeof this.runtime.camera.detachControl === 'function'
    ) {
      // ArcRotateCamera's own pointer/wheel inputs would otherwise execute in
      // addition to the gestures below, doubling every pan and zoom.
      this.runtime.camera.detachControl(canvas);
      this._restoreCameraControl = true;
    }
    this._listen(canvas, 'pointerdown', this._onPointerDown);
    this._listen(canvas, 'pointermove', this._onPointerMove);
    this._listen(canvas, 'pointerup', this._onPointerUp);
    this._listen(canvas, 'pointercancel', this._onPointerCancel);
    this._listen(canvas, 'lostpointercapture', this._onPointerCancel);
    this._listen(canvas, 'contextmenu', this._onContextMenu);
    this._listen(canvas, 'dragstart', this._onContextMenu);
    this._listen(canvas, 'wheel', this._onWheel, { passive: false });
    this._listen(window, 'keydown', this._onKeyDown, true);
    this._listen(window, 'keyup', this._onKeyUp, true);
    this._listen(window, 'blur', this._onBlur);
    this._listen(document, 'click', this._onDocumentClick);
    this._listen(document, 'dungeon:set-mode', this._onSetModeEvent);

    const observable = this.runtime.scene.onBeforeRenderObservable;
    if (observable && typeof observable.add === 'function') {
      this._beforeRenderObserver = observable.add(() => {
        const engine = this.runtime.engine;
        const dt = engine && typeof engine.getDeltaTime === 'function'
          ? engine.getDeltaTime() / 1000
          : 1 / 60;
        this.update(dt);
      });
    }

    const initialMode = this.runtime.initialInputMode || this.ui.getMode?.() || 'dig';
    this.setMode(initialMode, { silent: true });
    return this;
  }

  dispose() {
    if (!this._installed) return;
    this.cancel({ resetMode: false, clearSelection: true });
    for (const item of this._listeners) {
      item.target.removeEventListener(item.type, item.handler, item.options);
    }
    this._listeners.length = 0;
    const observable = this.runtime.scene.onBeforeRenderObservable;
    if (this._beforeRenderObserver && observable && typeof observable.remove === 'function') {
      observable.remove(this._beforeRenderObserver);
    }
    this._beforeRenderObserver = null;
    this._keys.clear();
    this._pointers.clear();
    if (this._hoverRaf) cancelAnimationFrame(this._hoverRaf);
    this._hoverRaf = 0;
    this._pendingHoverPoint = null;
    this.runtime.canvas.style.touchAction = this._oldTouchAction;
    if (this._restoreCameraControl && typeof this.runtime.camera.attachControl === 'function') {
      this.runtime.camera.attachControl(this.runtime.canvas, true);
    }
    this._restoreCameraControl = false;
    this._installed = false;
  }

  _listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this._listeners.push({ target, type, handler, options });
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) this.cancel({ resetMode: false, clearSelection: false });
  }

  setMode(requestedMode, options = {}) {
    const rawDisplayMode = typeof requestedMode === 'string' && requestedMode.startsWith('room:')
      ? requestedMode.slice(5)
      : requestedMode;
    const displayMode = ({ select: 'hand', summon: 'createImp', callToArms: 'rally', call_to_arms: 'rally' })[rawDisplayMode]
      || rawDisplayMode;
    let mode = MODE_ALIASES[requestedMode] || requestedMode;
    if (typeof mode === 'string' && mode.startsWith('room:')) mode = mode.slice(5);
    if (!VALID_MODES.has(mode)) return false;

    this._cancelStroke();
    this.mode = mode;
    this.runtime.canvas.dataset.inputMode = mode;

    if (!options.silent) {
      invokeFirst([
        [this.ui, 'setMode', [displayMode]],
        [this.ui, 'onModeChanged', [mode]],
      ]);
      invokeFirst([[this.runtime, 'setCursorMode', [mode]]]);
      this._dispatch('dungeon:mode-changed', { mode, requestedMode, displayMode });
    }
    this._refreshHover();
    return true;
  }

  cycleMode(direction = 1) {
    let index = MODE_ORDER.indexOf(this.mode);
    if (index < 0) index = 0;
    index = (index + Math.sign(direction || 1) + MODE_ORDER.length) % MODE_ORDER.length;
    this.setMode(MODE_ORDER[index]);
  }

  cancel(options = {}) {
    const resetMode = options.resetMode !== false;
    const clearSelection = options.clearSelection !== false;
    this._cancelStroke();
    this._pendingTouchAction = null;
    this._clearHoverPreview();
    invokeFirst([
      [this.ui, 'hideContextMenu'],
      [this.ui, 'closeContextMenu'],
      [this.ui, 'cancelTargeting'],
    ]);
    if (clearSelection) this.clearSelection();
    if (resetMode && this.mode !== 'select') this.setMode('select');
  }

  clearSelection() {
    if (!this.selection) return;
    const previous = this.selection;
    this.selection = null;
    invokeFirst([
      [this.entities, 'setSelected', [previous.entity || null, false]],
      [this.effects, 'clearSelection'],
      [this.ui, 'setSelection', [null]],
      [this.ui, 'clearSelection'],
      [this.ui, 'update', [{ context: null }]],
    ]);
    this._dispatch('dungeon:selection-changed', { selection: null });
  }

  select(selection, screenPoint = null) {
    if (!selection) {
      this.clearSelection();
      return;
    }
    if (this.selection && this.selection.entity && this.selection.entity !== selection.entity) {
      invokeFirst([[this.entities, 'setSelected', [this.selection.entity, false]]]);
    }
    this.selection = selection;
    if (selection.entity) invokeFirst([[this.entities, 'setSelected', [selection.entity, true]]]);
    invokeFirst([
      [this.effects, 'showSelection', [selection]],
      [this.ui, 'setSelection', [selection]],
      [this.ui, 'showSelection', [selection]],
      [this.ui, 'update', [{ context: this._selectionContext(selection) }]],
    ]);
    this._dispatch('dungeon:selection-changed', { selection, screenPoint });
  }

  isPaused() {
    if (typeof this.runtime.isPaused === 'function') return !!this.runtime.isPaused();
    if (this.runtime.state && typeof this.runtime.state.paused === 'boolean') {
      return this.runtime.state.paused;
    }
    if (typeof this.runtime.paused === 'boolean') return this.runtime.paused;
    return this._pausedFallback;
  }

  setPaused(paused) {
    const next = !!paused;
    this.cancel({ resetMode: false, clearSelection: false });
    let call;
    if (next) {
      call = invokeFirst([
        [this.runtime, 'setPaused', [true]],
        [this.runtime, 'pause'],
      ]);
    } else {
      call = invokeFirst([
        [this.runtime, 'setPaused', [false]],
        [this.runtime, 'resume'],
      ]);
    }
    if (!call.called) {
      this._pausedFallback = next;
      this.runtime.paused = next;
    }
      invokeFirst([
        [this.ui, 'setPaused', [next]],
        [this.ui, 'showPause', [next]],
        [this.ui, next ? 'showPauseMenu' : 'hidePauseMenu'],
    ]);
    this._dispatch('dungeon:pause-changed', { paused: next });
    return next;
  }

  togglePaused() {
    if (typeof this.runtime.togglePause === 'function') {
      const result = this.runtime.togglePause();
      const paused = typeof result === 'boolean' ? result : this.isPaused();
      invokeFirst([
        [this.ui, 'setPaused', [paused]],
        [this.ui, 'showPause', [paused]],
      ]);
      this._dispatch('dungeon:pause-changed', { paused });
      return paused;
    }
    return this.setPaused(!this.isPaused());
  }

  /** Pick both an entity and a tile from a client-space point. */
  pick(clientX, clientY) {
    const renderPoint = this._renderPoint(clientX, clientY);
    if (!renderPoint) return { hit: null, entity: null, tile: null, point: null };

    let hit = null;
    try {
      hit = this.runtime.scene.pick(
        renderPoint.x,
        renderPoint.y,
        mesh => mesh && mesh.isPickable !== false,
        false,
        this.runtime.camera,
      );
    } catch (error) {
      this._reportError('Picking failed', error);
    }

    const entity = hit && hit.hit ? this._entityFromPick(hit) : null;
    const defense = hit && hit.hit ? this._defenseFromPick(hit) : null;
    let tile = hit && hit.hit ? this._tileFromPick(hit) : null;
    if (!tile) tile = this._groundTile(renderPoint.x, renderPoint.y);
    return {
      hit,
      entity,
      defense,
      tile,
      point: hit && hit.pickedPoint ? hit.pickedPoint : null,
      screen: { x: clientX, y: clientY },
    };
  }

  update(dt) {
    if (!this.enabled || this.isPaused()) return;
    const frameId = typeof this.runtime.scene.getFrameId === 'function'
      ? this.runtime.scene.getFrameId()
      : -1;
    if (frameId >= 0 && frameId === this._lastUpdateFrame) return;
    this._lastUpdateFrame = frameId;

    const seconds = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
    let panX = 0;
    let panY = 0;
    if (this._keys.has('arrowleft') || this._keys.has('a')) panX -= 1;
    if (this._keys.has('arrowright') || this._keys.has('d')) panX += 1;
    if (this._keys.has('arrowup') || this._keys.has('w')) panY -= 1;
    if (this._keys.has('arrowdown') || this._keys.has('s')) panY += 1;
    if (panX || panY) {
      const length = Math.hypot(panX, panY) || 1;
      this._panCameraScreen(
        panX / length * CAMERA_KEY_SPEED * seconds,
        panY / length * CAMERA_KEY_SPEED * seconds,
      );
    }
    if (this._keys.has('q')) this._rotateCamera(-CAMERA_ROTATE_SPEED * seconds);
    if (this._keys.has('e')) this._rotateCamera(CAMERA_ROTATE_SPEED * seconds);
    if (this._keys.has('z')) {
      this._zoomCamera(Math.exp(-1.6 * seconds));
    }
    if (this._keys.has('x')) {
      this._zoomCamera(Math.exp(1.6 * seconds));
    }
  }

  _renderPoint(clientX, clientY) {
    const canvas = this.runtime.canvas;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const engine = this.runtime.engine;
    const width = engine && typeof engine.getRenderWidth === 'function'
      ? engine.getRenderWidth()
      : canvas.width;
    const height = engine && typeof engine.getRenderHeight === 'function'
      ? engine.getRenderHeight()
      : canvas.height;
    return {
      x: (clientX - rect.left) * width / rect.width,
      y: (clientY - rect.top) * height / rect.height,
    };
  }

  _entityFromPick(pick) {
    const resolved = invokeFirst([
      [this.entities, 'resolvePick', [pick]],
      [this.entities, 'getEntityFromMesh', [pick.pickedMesh]],
      [this.entities, 'fromMesh', [pick.pickedMesh]],
    ]);
    if (resolved.called && resolved.result) return resolved.result;

    let mesh = pick.pickedMesh;
    while (mesh) {
      const metadata = mesh.metadata || {};
      if (metadata.entity) return metadata.entity;
      const id = metadata.entityId ?? metadata.unitId ?? metadata.actorId;
      if (id !== undefined && id !== null) {
        const byId = invokeFirst([
          [this.entities, 'getById', [id]],
          [this.entities, 'getEntity', [id]],
        ]);
        return byId.called && byId.result ? byId.result : { id, mesh, metadata };
      }
      mesh = mesh.parent;
    }
    return null;
  }

  _defenseFromPick(pick) {
    const defenses = this.runtime.defenses;
    if (!defenses) return null;
    const resolved = invokeFirst([
      [defenses, 'pick', [pick]],
      [defenses, 'fromPick', [pick]],
    ]);
    return resolved.called ? resolved.result || null : null;
  }

  _tileFromPick(pick) {
    const resolved = invokeFirst([
      [this.world, 'cellFromPick', [pick]],
      [this.world, 'resolvePick', [pick]],
      [this.world, 'getTileFromPick', [pick]],
    ]);
    if (resolved.called && resolved.result) return this._normalizeTile(resolved.result);

    let mesh = pick.pickedMesh;
    while (mesh) {
      const metadata = mesh.metadata || {};
      const candidates = [
        metadata.tile,
        metadata.cell,
        metadata.grid,
        { x: metadata.gridX, z: metadata.gridZ },
        { x: metadata.tileX, z: metadata.tileZ },
        { x: metadata.x, z: metadata.z },
      ];
      for (const candidate of candidates) {
        const tile = this._normalizeTile(candidate);
        if (tile) return tile;
      }

      const instanceId = pick.thinInstanceIndex ?? pick.instanceId;
      if (finiteNumber(instanceId)) {
        const map = metadata.instanceCells || metadata.tiles || metadata.cells;
        if (map && map[instanceId]) {
          const tile = this._normalizeTile(map[instanceId]);
          if (tile) return tile;
        }
        const instanceTile = invokeFirst([
          [this.world, 'getInstanceCell', [mesh, instanceId]],
          [this.world, 'getThinInstanceCell', [mesh, instanceId]],
        ]);
        if (instanceTile.called && instanceTile.result) {
          return this._normalizeTile(instanceTile.result);
        }
      }
      mesh = mesh.parent;
    }
    return this._tileFromWorldPoint(pick.pickedPoint);
  }

  _groundTile(renderX, renderY) {
    if (typeof this.runtime.scene.createPickingRay !== 'function') return null;
    try {
      const matrix = BABYLON.Matrix && BABYLON.Matrix.Identity
        ? BABYLON.Matrix.Identity()
        : undefined;
      const ray = this.runtime.scene.createPickingRay(
        renderX, renderY, matrix, this.runtime.camera, false,
      );
      if (!ray || !ray.origin || !ray.direction || Math.abs(ray.direction.y) < 1e-6) return null;
      const groundY = finiteNumber(this.world.groundY) ? this.world.groundY : 0;
      const distance = (groundY - ray.origin.y) / ray.direction.y;
      if (distance < 0) return null;
      return this._tileFromWorldPoint({
        x: ray.origin.x + ray.direction.x * distance,
        y: groundY,
        z: ray.origin.z + ray.direction.z * distance,
      });
    } catch (error) {
      this._reportError('Ground picking failed', error);
      return null;
    }
  }

  _tileFromWorldPoint(point) {
    if (!point) return null;
    const direct = invokeFirst([
      [this.world, 'worldToTile', [point]],
      [this.world, 'worldToGrid', [point]],
    ]);
    if (direct.called && direct.result) return this._normalizeTile(direct.result);

    const size = this.world.cellSize || this.world.tileSize || this.runtime.tileSize || 1;
    const origin = this.world.origin || this.runtime.worldOrigin || { x: 0, z: 0 };
    return this._normalizeTile({
      x: Math.round((point.x - (origin.x || 0)) / size),
      z: Math.round((point.z - (origin.z || 0)) / size),
    });
  }

  _normalizeTile(candidate) {
    if (!candidate) return null;
    const rawX = candidate.x ?? candidate.gridX ?? candidate.tileX;
    const rawZ = candidate.z ?? candidate.gridZ ?? candidate.tileZ;
    if (!finiteNumber(Number(rawX)) || !finiteNumber(Number(rawZ))) return null;
    const tile = { x: Math.round(Number(rawX)), z: Math.round(Number(rawZ)) };
    if (typeof this.world.inBounds === 'function' && !this.world.inBounds(tile.x, tile.z)) return null;
    if (typeof this.world.getCell === 'function') {
      const cell = this.world.getCell(tile.x, tile.z);
      if (cell === undefined || cell === null) return null;
      tile.cell = cell;
    }
    return tile;
  }

  _onPointerDown(ev) {
    if (!this.enabled || this.isPaused()) return;
    const pointer = {
      id: ev.pointerId,
      type: ev.pointerType,
      button: ev.button,
      x: ev.clientX,
      y: ev.clientY,
      startX: ev.clientX,
      startY: ev.clientY,
      moved: false,
    };
    this._pointers.set(ev.pointerId, pointer);
    if (typeof this.runtime.canvas.setPointerCapture === 'function') {
      try { this.runtime.canvas.setPointerCapture(ev.pointerId); } catch (_) { /* Browser owns capture. */ }
    }

    if (ev.pointerType === 'touch' && this._touchPointers().length >= 2) {
      stopEvent(ev);
      this._cancelStroke();
      this._pendingTouchAction = null;
      this._touchGestureConsumed = true;
      this._beginTouchGesture();
      return;
    }

    if (ev.button === 1 || ev.button === 2) {
      stopEvent(ev);
      this._mousePan = {
        button: ev.button,
        startX: ev.clientX,
        startY: ev.clientY,
        lastX: ev.clientX,
        lastY: ev.clientY,
        dragged: ev.button === 1,
      };
      return;
    }
    if (ev.button !== 0) return;

    stopEvent(ev);
    const picked = this.pick(ev.clientX, ev.clientY);
    if (TILE_MODES.has(this.mode)) {
      this._painting = true;
      this._painted.clear();
      this._lastPaintTile = null;
      if (picked.tile) this._paintTo(picked.tile);
      return;
    }

    // Touch targeting commits on release so a second finger can promote the
    // gesture to camera control without casting a spell underneath it.
    if (ev.pointerType === 'touch') {
      this._pendingTouchAction = { pointerId: ev.pointerId, picked };
    } else {
      this._activatePick(picked, { x: ev.clientX, y: ev.clientY });
    }
  }

  _onPointerMove(ev) {
    const pointer = this._pointers.get(ev.pointerId);
    if (pointer) {
      if (Math.hypot(ev.clientX - pointer.startX, ev.clientY - pointer.startY) > POINTER_DRAG_THRESHOLD) {
        pointer.moved = true;
      }
      pointer.x = ev.clientX;
      pointer.y = ev.clientY;
    }

    if (ev.pointerType === 'touch' && this._touchPointers().length >= 2) {
      stopEvent(ev);
      this._updateTouchGesture();
      return;
    }
    if (this._mousePan && (this._mousePan.button === ev.button || (ev.buttons & 6))) {
      stopEvent(ev);
      const pan = this._mousePan;
      const dx = ev.clientX - pan.lastX;
      const dy = ev.clientY - pan.lastY;
      pan.lastX = ev.clientX;
      pan.lastY = ev.clientY;
      if (Math.hypot(ev.clientX - pan.startX, ev.clientY - pan.startY) > POINTER_DRAG_THRESHOLD) {
        pan.dragged = true;
      }
      if (pan.dragged) this._panCameraScreen(dx, dy);
      return;
    }

    if (!this.enabled || this.isPaused()) return;
    if (this._painting && pointer && pointer.button === 0) {
      stopEvent(ev);
      const picked = this.pick(ev.clientX, ev.clientY);
      if (picked.tile) this._paintTo(picked.tile);
      return;
    }
    if (this._pendingTouchAction && pointer && pointer.moved) this._pendingTouchAction = null;
    this._scheduleHover(ev.clientX, ev.clientY);
  }

  _onPointerUp(ev) {
    const pointer = this._pointers.get(ev.pointerId);
    if (ev.button === 2 && this._mousePan && !this._mousePan.dragged) {
      stopEvent(ev);
      this._handleContext(this.pick(ev.clientX, ev.clientY), { x: ev.clientX, y: ev.clientY });
    }
    if (ev.button === 0 && this._painting) this._cancelStroke();
    if (
      ev.pointerType === 'touch' &&
      this._pendingTouchAction &&
      this._pendingTouchAction.pointerId === ev.pointerId &&
      !this._touchGestureConsumed &&
      pointer && !pointer.moved
    ) {
      stopEvent(ev);
      this._activatePick(this._pendingTouchAction.picked, { x: ev.clientX, y: ev.clientY });
    }

    this._pointers.delete(ev.pointerId);
    if (this._mousePan && this._mousePan.button === ev.button) this._mousePan = null;
    if (this._touchPointers().length < 2) this._touchGesture = null;
    if (this._touchPointers().length === 0) {
      this._touchGestureConsumed = false;
      this._pendingTouchAction = null;
    }
  }

  _onPointerCancel(ev) {
    this._pointers.delete(ev.pointerId);
    this._cancelStroke();
    this._pendingTouchAction = null;
    if (this._mousePan && this._mousePan.button === ev.button) this._mousePan = null;
    if (this._touchPointers().length < 2) this._touchGesture = null;
    if (this._touchPointers().length === 0) this._touchGestureConsumed = false;
  }

  _onWheel(ev) {
    if (!this.enabled || this.isPaused()) return;
    stopEvent(ev);
    this._zoomCamera(Math.exp(Math.sign(ev.deltaY) * 0.12));
  }

  _onKeyDown(ev) {
    if (isEditableTarget(ev.target)) return;
    // First-person possession owns its complete keyboard layer, including
    // Escape and numbered abilities. Leaving the top-down shortcuts active
    // here would change tools behind the possession HUD.
    if (this.runtime.possessionDirector?.active) return;
    const key = ev.key.toLowerCase();
    if (key === 'escape' && this.ui?.nodes?.codex?.classList?.contains('is-visible')) return;
    if (key === 'escape') {
      stopEvent(ev);
      if (this.mode !== 'select' || this.selection || this._painting) this.cancel();
      else this.togglePaused();
      return;
    }
    if (key === 'pause') {
      stopEvent(ev);
      this.togglePaused();
      return;
    }
    if (this.isPaused()) return;

    if (SHORTCUT_MODES[key]) {
      stopEvent(ev);
      this.setMode(SHORTCUT_MODES[key]);
      return;
    }
    if (key === '[' || key === '{') {
      stopEvent(ev);
      this.cycleMode(-1);
      return;
    }
    if (key === ']' || key === '}') {
      stopEvent(ev);
      this.cycleMode(1);
      return;
    }
    if (key === ' ' || key === 'c') {
      stopEvent(ev);
      invokeFirst([
        [this.runtime, 'recenterCamera'],
        [this.runtime, 'focusHeart'],
      ]);
      if (typeof this.runtime.recenterCamera !== 'function' && typeof this.runtime.focusHeart !== 'function') {
        this._focusHeart();
      }
      return;
    }
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'q', 'e', 'z', 'x'].includes(key)) {
      this._keys.add(key);
      if (key.startsWith('arrow')) stopEvent(ev);
    }
  }

  _onKeyUp(ev) {
    this._keys.delete(ev.key.toLowerCase());
  }

  _onBlur() {
    this._keys.clear();
    this._pointers.clear();
    this._mousePan = null;
    this._touchGesture = null;
    this._touchGestureConsumed = false;
    this._pendingTouchAction = null;
    this._cancelStroke();
  }

  _onDocumentClick(ev) {
    const button = ev.target && ev.target.closest
      ? ev.target.closest('[data-mode], [data-room], [data-action]')
      : null;
    if (!button) return;
    if (button.dataset.mode) {
      this.setMode(button.dataset.mode);
      return;
    }
    if (button.dataset.room) {
      this.setMode(button.dataset.room);
      return;
    }
    if (button.dataset.action === 'pause' || button.dataset.action === 'resume') {
      this.setPaused(button.dataset.action === 'pause');
    } else if (button.dataset.action === 'cancel') {
      this.cancel();
    } else if (button.dataset.action === 'recenter') {
      this._focusHeart();
    }
  }

  _onSetModeEvent(ev) {
    if (ev.detail && ev.detail.mode) this.setMode(ev.detail.mode);
  }

  _paintTo(tile) {
    const previous = this._lastPaintTile;
    if (!previous) {
      this._applyTileMode(tile);
      this._lastPaintTile = tile;
      return;
    }

    // Integer line interpolation prevents fast drags from skipping cells.
    const dx = tile.x - previous.x;
    const dz = tile.z - previous.z;
    const steps = Math.max(Math.abs(dx), Math.abs(dz));
    if (steps === 0) return;
    for (let step = 1; step <= steps; step++) {
      this._applyTileMode({
        x: Math.round(previous.x + dx * step / steps),
        z: Math.round(previous.z + dz * step / steps),
      });
    }
    this._lastPaintTile = tile;
  }

  _applyTileMode(tile) {
    const key = `${tile.x},${tile.z}`;
    if (this._painted.has(key)) return;
    this._painted.add(key);

    const targetCell = tile.cell || this.world.getCell?.(tile.x, tile.z);
    if (!targetCell?.discovered) {
      this._invalidTarget('The Keeper cannot command through unexplored rock', tile);
      return;
    }

    const economy = this.runtime.economy;
    const roomCost = ROOM_MODES.has(this.mode) ? ROOM_COSTS[this.mode] || 0 : 0;
    if (roomCost && economy?.canAfford && !economy.canAfford('gold', roomCost)) {
      this._invalidTarget(`${this._label(this.mode)} needs ${roomCost} gold`, tile);
      return;
    }

    let action;
    if (this.mode === 'dig') action = invokeFirst([[this.world, 'dig', [tile.x, tile.z]]]);
    else if (this.mode === 'claim') action = invokeFirst([[this.world, 'claim', [tile.x, tile.z]]]);
    else if (this.mode === 'reinforce') action = invokeFirst([[this.world, 'reinforce', [tile.x, tile.z]]]);
    else if (ROOM_MODES.has(this.mode)) {
      action = invokeFirst([[this.world, 'buildRoom', [tile.x, tile.z, this.mode]]]);
    } else if (DOOR_MODE_KINDS[this.mode]) {
      action = invokeFirst([
        [this.runtime.workshop, 'orderDoor', [DOOR_MODE_KINDS[this.mode], tile.x, tile.z]],
        [this.runtime.defenses, 'placeDoor', [DOOR_MODE_KINDS[this.mode], tile.x, tile.z]],
      ]);
    } else if (TRAP_MODE_KINDS[this.mode]) {
      action = invokeFirst([
        [this.runtime.workshop, 'orderTrap', [TRAP_MODE_KINDS[this.mode], tile.x, tile.z]],
        [this.runtime.defenses, 'placeTrap', [TRAP_MODE_KINDS[this.mode], tile.x, tile.z]],
      ]);
    } else if (this.mode === 'sell') {
      const defense = this.runtime.defenses?.getAt?.(tile.x, tile.z);
      if (defense?.category === 'door') action = invokeFirst([[this.runtime.defenses, 'sellDoor', [defense]]]);
      else if (defense?.category === 'trap') action = invokeFirst([[this.runtime.defenses, 'sellTrap', [defense]]]);
      else {
        const cell = this.world.getCell?.(tile.x, tile.z);
        if (cell?.room) {
          const refund = Math.floor((ROOM_COSTS[cell.room] || 0) * 0.5);
          action = invokeFirst([[this.world, 'setTile', [tile.x, tile.z, 'claimed', { room: null }]]]);
          if (action.called && action.result !== false) economy?.add?.('gold', refund);
        }
      }
    } else return;

    const success = action.called && action.result !== false && action.result !== 0;
    if (success) {
      if (roomCost && economy?.spend) economy.spend('gold', roomCost);
      const minedGold = Number(action.result?.gold) || 0;
      if (minedGold > 0) economy?.add?.('gold', minedGold);
      invokeFirst([[this.ui, 'onTileAction', [this.mode, tile, action.result]]]);
    } else {
      this._invalidTarget(this.runtime.workshop?.lastError || this.runtime.defenses?.lastError || `${this._label(this.mode)} cannot be used here`, tile);
    }
  }

  _activatePick(picked, screenPoint) {
    if (this.mode === 'possess' && this.runtime.spells?.possessed && picked.tile && !picked.entity) {
      const commanded = this.runtime.spells.commandPossessed?.(picked.tile);
      if (commanded === false) this._invalidTarget('The possessed creature cannot reach that tile', picked.tile);
      return;
    }
    if (this.mode === 'select') {
      if (picked.entity) this.select({ kind: 'entity', entity: picked.entity, pick: picked }, screenPoint);
      else if (picked.defense) this.select({ kind: 'defense', defense: picked.defense, pick: picked }, screenPoint);
      else if (picked.tile) this.select({ kind: 'tile', tile: picked.tile, pick: picked }, screenPoint);
      else this.clearSelection();
      return;
    }
    if (TILE_SPELLS.has(this.mode)) {
      if (!picked.tile) {
        this._invalidTarget(`${this._label(this.mode)} needs a tile`);
        return;
      }
      this._castSpell(this.mode, picked.tile, picked);
      return;
    }
    if (ENTITY_SPELLS.has(this.mode)) {
      if (!picked.entity) {
        this._invalidTarget(`${this._label(this.mode)} needs a creature`);
        return;
      }
      this._castSpell(this.mode, picked.entity, picked);
    }
  }

  _castSpell(name, target, picked) {
    const x = target && target.x;
    const z = target && target.z;
    const spells = this.runtime.spells || this.entities.spells;
    let cast;

    if (name === 'lightning') {
      cast = invokeFirst([
        [spells, 'castLightning', [x, z]],
        [this.entities, 'castLightning', [x, z]],
        [this.runtime, 'castLightning', [x, z]],
      ]);
    } else if (name === 'heal') {
      cast = invokeFirst([
        [spells, 'castHeal', [target]],
        [this.entities, 'heal', [target]],
        [this.runtime, 'castHeal', [target]],
      ]);
    } else if (name === 'haste') {
      cast = invokeFirst([
        [spells, 'castHaste', [target]],
        [this.entities, 'haste', [target]],
        [this.runtime, 'castHaste', [target]],
      ]);
    } else if (name === 'rally') {
      cast = invokeFirst([
        [spells, 'castRally', [x, z]],
        [spells, 'castCallToArms', [x, z]],
        [this.entities, 'setRally', [x, z]],
        [this.runtime, 'castRally', [x, z]],
      ]);
    } else if (name === 'summon') {
      cast = invokeFirst([
        [spells, 'castSummon', [x, z]],
        [spells, 'castCreateImp', [x, z]],
        [this.entities, 'summonImp', [x, z]],
        [this.entities, 'spawnImp', [x, z]],
        [this.entities, 'spawn', ['imp', x, z]],
        [this.runtime, 'summonImp', [x, z]],
      ]);
    } else if (name === 'possess') {
      cast = invokeFirst([
        [spells, 'castPossess', [target]],
        [this.entities, 'possess', [target]],
        [this.runtime, 'beginPossession', [target]],
      ]);
    }

    if (!cast || !cast.called) {
      cast = invokeFirst([
        [spells, 'cast', [name, target, picked]],
        [this.entities, 'castSpell', [name, target, picked]],
        [this.runtime, 'castSpell', [name, target, picked]],
        [this.effects, 'castSpell', [name, target, picked]],
      ]);
    }

    if (!cast || !cast.called || cast.result === false) {
      this._invalidTarget(`${this._label(name)} failed`, target);
      return false;
    }

    Promise.resolve(cast.result).then(result => {
      if (result === false) this._invalidTarget(`${this._label(name)} failed`, target);
      else {
        invokeFirst([[this.ui, 'onSpellCast', [name, target]]]);
        this._dispatch('dungeon:spell-cast', { spell: name, target });
      }
    }).catch(error => {
      this._reportError(`${this._label(name)} failed`, error);
      this._invalidTarget(`${this._label(name)} failed`, target);
    });
    return true;
  }

  _handleContext(picked, screenPoint) {
    this._cancelStroke();
    if (picked.entity) {
      const selection = { kind: 'entity', entity: picked.entity, pick: picked };
      this.select(selection, screenPoint);
      const shown = invokeFirst([
        [this.ui, 'showEntityContext', [picked.entity, screenPoint]],
        [this.ui, 'showContextMenu', [selection, screenPoint]],
      ]);
      if (!shown.called) this._dispatch('dungeon:context', { selection, screenPoint });
      return;
    }
    // Right-click on the world is the universal cancel gesture. A UI that
    // wants tile context can still listen to the event before the mode reset.
    if (picked.tile) this._dispatch('dungeon:tile-context', { tile: picked.tile, screenPoint });
    this.cancel();
  }

  _selectionContext(selection) {
    if (selection.entity) {
      const entity = selection.entity;
      const data = entity.data || entity.metadata || entity.userData || entity;
      return {
        id: entity.id ?? data.id,
        type: data.type || data.kind || data.faction || 'Creature',
        name: data.name || data.displayName || data.species || 'Creature',
        detail: data.status || data.state || data.role || '',
        health: data.health ?? data.hp,
        maxHealth: data.maxHealth ?? data.maxHp,
        icon: data.icon,
        actions: data.actions || [],
      };
    }
    if (selection.defense) {
      const defense = selection.defense;
      const detail = defense.category === 'door'
        ? `${defense.locked ? 'Locked' : 'Automatic'} · ${Math.ceil(defense.hp)} / ${Math.ceil(defense.maxHp)} integrity`
        : `${defense.armed ? 'Armed' : defense.reloading ? 'Reloading' : 'Unarmed'} · ${defense.charges}/${defense.maxCharges} charges`;
      const actions = defense.category === 'door'
        ? [
          { id: defense.locked ? 'unlock-door' : 'lock-door', label: defense.locked ? 'Unlock' : 'Lock', icon: defense.locked ? '◇' : '◆' },
          { id: 'repair-door', label: 'Repair', icon: '⚒' },
          { id: 'sell-defense', label: 'Sell', icon: '¤' },
        ]
        : [
          { id: defense.armed ? 'disarm-trap' : 'arm-trap', label: defense.armed ? 'Disarm' : 'Arm', icon: defense.armed ? '◇' : '◆' },
          { id: 'reload-trap', label: 'Reload', icon: '⚙' },
          { id: 'sell-defense', label: 'Sell', icon: '¤' },
        ];
      return {
        id: defense.id,
        type: defense.category,
        name: defense.name || defense.kind,
        detail,
        health: defense.hp,
        maxHealth: defense.maxHp,
        icon: defense.category === 'door' ? '▣' : '▲',
        actions,
      };
    }
    const tile = selection.tile;
    const cell = tile && (tile.cell || this.world.getCell?.(tile.x, tile.z));
    return {
      id: tile ? `${tile.x},${tile.z}` : undefined,
      type: 'Tile',
      name: cell?.room || cell?.type || 'Dungeon tile',
      detail: tile ? `X ${tile.x} · Z ${tile.z}` : '',
      icon: cell?.room ? '◆' : '◇',
      actions: [],
    };
  }

  _updateHover(clientX, clientY) {
    const picked = this.pick(clientX, clientY);
    const entityId = picked.entity && (picked.entity.id || picked.entity.entityId || 'entity');
    const defenseId = picked.defense && (picked.defense.id || 'defense');
    const key = entityId
      ? `e:${entityId}`
      : defenseId
        ? `d:${defenseId}`
      : picked.tile
        ? `t:${picked.tile.x},${picked.tile.z}`
        : '';
    if (key === this._hoverKey) return;
    this._hoverKey = key;
    this.hover = picked.entity
      ? { kind: 'entity', entity: picked.entity, pick: picked }
      : picked.defense
        ? { kind: 'defense', defense: picked.defense, pick: picked }
      : picked.tile
        ? { kind: 'tile', tile: picked.tile, pick: picked }
        : null;
    this._refreshHover();
  }

  _scheduleHover(clientX, clientY) {
    this._pendingHoverPoint = { x: clientX, y: clientY };
    if (this._hoverRaf || typeof requestAnimationFrame !== 'function') {
      if (!this._hoverRaf && typeof requestAnimationFrame !== 'function') {
        this._updateHover(clientX, clientY);
      }
      return;
    }
    this._hoverRaf = requestAnimationFrame(() => {
      this._hoverRaf = 0;
      const point = this._pendingHoverPoint;
      this._pendingHoverPoint = null;
      if (point && this.enabled && !this.isPaused()) this._updateHover(point.x, point.y);
    });
  }

  _refreshHover() {
    this._clearHoverPreview();
    if (!this.hover) return;
    invokeFirst([
      [this.effects, 'showTargetPreview', [this.hover, this.mode]],
      [this.effects, 'showTilePreview', [this.hover.tile, this.mode]],
      [this.ui, 'setHover', [this.hover, this.mode]],
    ]);
    this._dispatch('dungeon:hover-changed', { hover: this.hover, mode: this.mode });
  }

  _clearHoverPreview() {
    invokeFirst([
      [this.effects, 'clearTargetPreview'],
      [this.effects, 'clearTilePreview'],
      [this.ui, 'setHover', [null, this.mode]],
    ]);
    this._dispatch('dungeon:hover-changed', { hover: null, mode: this.mode });
  }

  _cancelStroke() {
    this._painting = false;
    this._painted.clear();
    this._lastPaintTile = null;
  }

  _touchPointers() {
    return Array.from(this._pointers.values()).filter(pointer => pointer.type === 'touch');
  }

  _beginTouchGesture() {
    const touches = this._touchPointers().slice(0, 2);
    if (touches.length < 2) return;
    this._touchGesture = {
      x: (touches[0].x + touches[1].x) / 2,
      y: (touches[0].y + touches[1].y) / 2,
      distance: Math.hypot(touches[1].x - touches[0].x, touches[1].y - touches[0].y),
    };
  }

  _updateTouchGesture() {
    const touches = this._touchPointers().slice(0, 2);
    if (touches.length < 2) return;
    const next = {
      x: (touches[0].x + touches[1].x) / 2,
      y: (touches[0].y + touches[1].y) / 2,
      distance: Math.hypot(touches[1].x - touches[0].x, touches[1].y - touches[0].y),
    };
    if (!this._touchGesture) {
      this._touchGesture = next;
      return;
    }
    this._panCameraScreen(next.x - this._touchGesture.x, next.y - this._touchGesture.y);
    if (this._touchGesture.distance > 1 && next.distance > 1) {
      this._zoomCamera(this._touchGesture.distance / next.distance);
    }
    this._touchGesture = next;
  }

  _panCameraScreen(dx, dy) {
    if (!dx && !dy) return;
    const delegated = invokeFirst([[this.runtime, 'panCamera', [dx, dy]]]);
    if (delegated.called) return;

    const camera = this.runtime.camera;
    if (!camera || !camera.target) return;
    const canvasHeight = Math.max(this.runtime.canvas.clientHeight || 1, 1);
    const extent = finiteNumber(camera.radius)
      ? camera.radius
      : Math.abs((camera.orthoTop || 12) - (camera.orthoBottom || -12));
    const scale = Math.max(extent, 8) / canvasHeight;
    const alpha = finiteNumber(camera.alpha)
      ? camera.alpha
      : finiteNumber(camera.rotation && camera.rotation.y)
        ? camera.rotation.y
        : 0;
    const rightX = Math.cos(alpha);
    const rightZ = -Math.sin(alpha);
    const forwardX = Math.sin(alpha);
    const forwardZ = Math.cos(alpha);
    const worldX = (-rightX * dx + forwardX * dy) * scale;
    const worldZ = (-rightZ * dx + forwardZ * dy) * scale;

    if (typeof camera.target.addInPlace === 'function' && BABYLON.Vector3) {
      camera.target.addInPlace(new BABYLON.Vector3(worldX, 0, worldZ));
    } else {
      camera.target.x += worldX;
      camera.target.z += worldZ;
    }
    invokeFirst([[this.runtime, 'clampCameraTarget', [camera.target]]]);
  }

  _rotateCamera(delta) {
    const delegated = invokeFirst([[this.runtime, 'rotateCamera', [delta]]]);
    if (delegated.called) return;
    const camera = this.runtime.camera;
    if (finiteNumber(camera.alpha)) camera.alpha += delta;
    else if (camera.rotation && finiteNumber(camera.rotation.y)) camera.rotation.y += delta;
  }

  _zoomCamera(factor) {
    if (!finiteNumber(factor) || factor <= 0) return;
    const delegated = invokeFirst([[this.runtime, 'zoomCamera', [factor]]]);
    if (delegated.called) return;
    const camera = this.runtime.camera;
    if (finiteNumber(camera.radius)) {
      const lower = finiteNumber(camera.lowerRadiusLimit) ? camera.lowerRadiusLimit : CAMERA_ZOOM_MIN;
      const upper = finiteNumber(camera.upperRadiusLimit) ? camera.upperRadiusLimit : CAMERA_ZOOM_MAX;
      camera.radius = Math.min(upper, Math.max(lower, camera.radius * factor));
      return;
    }
    if ([camera.orthoLeft, camera.orthoRight, camera.orthoTop, camera.orthoBottom].every(finiteNumber)) {
      camera.orthoLeft *= factor;
      camera.orthoRight *= factor;
      camera.orthoTop *= factor;
      camera.orthoBottom *= factor;
      return;
    }
    if (finiteNumber(camera.fov)) camera.fov = Math.min(1.35, Math.max(0.25, camera.fov * factor));
  }

  _focusHeart() {
    const heart = invokeFirst([[this.world, 'getHeartPosition']]);
    if (!heart.called || !heart.result) return;
    const target = heart.result;
    const camera = this.runtime.camera;
    if (camera && typeof camera.setTarget === 'function' && BABYLON.Vector3) {
      camera.setTarget(new BABYLON.Vector3(target.x, target.y || 0, target.z));
    } else if (camera && camera.target) {
      camera.target.x = target.x;
      camera.target.y = target.y || 0;
      camera.target.z = target.z;
    }
  }

  _targetPosition(target) {
    if (!target) return { x: 0, y: 0, z: 0 };
    const position = target.position || target.mesh?.position || target.root?.position || target.node?.position;
    if (position) return position;
    return {
      x: finiteNumber(target.x) ? target.x : 0,
      y: finiteNumber(target.y) ? target.y : 0,
      z: finiteNumber(target.z) ? target.z : 0,
    };
  }

  _invalidTarget(message, target = null) {
    invokeFirst([
      [this.ui, 'showError', [message]],
      [this.ui, 'notify', [message, 'error']],
      [this.ui, 'toast', [message, { type: 'error' }]],
    ]);
    invokeFirst([
      [this.effects, 'invalidTarget', [target, this.mode]],
      [this.effects, 'playInvalid', [target]],
    ]);
    this._dispatch('dungeon:invalid-target', { message, target, mode: this.mode });
  }

  _reportError(message, error) {
    if (typeof console !== 'undefined' && console.warn) console.warn(`[InputController] ${message}`, error);
    invokeFirst([[this.ui, 'showError', [message]]]);
  }

  _dispatch(name, detail) {
    if (typeof CustomEvent !== 'function') return;
    this.runtime.canvas.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
  }

  _label(value) {
    return String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
      .replace(/^./, letter => letter.toUpperCase());
  }
}

export function createInputController(runtime, world, entities, effects, ui) {
  return new InputController(runtime, world, entities, effects, ui);
}
