// ============================================================
// TILE FACTORY — rocks, floors, walls, portals, dig markers
// ============================================================
// Builds the per-cell THREE.Mesh for any tile type. Rocks clone their material
// for per-instance color drift; floors reuse the shared material. Portals are
// compound groups with an inner disc, two rotating swirl rings, and a point
// light. All meshes carry userData.{gridX,gridZ,tileType} so raycasting in
// input.js can map a hit back to the grid.

import {
  GRID_SIZE,
  T_ROCK, T_FLOOR, T_CLAIMED, T_HEART, T_GOLD, T_REINFORCED,
  T_ENEMY_FLOOR, T_ENEMY_WALL, T_PORTAL_NEUTRAL, T_PORTAL_CLAIMED,
} from './constants.js';
import {
  ROCK_GEO, FLOOR_GEO, ROCK_MAT, GOLD_MAT, FLOOR_MAT, CLAIMED_MAT,
  GOLD_FLECK_GEO, GOLD_FLECK_MAT,
  REINFORCED_GEO, REINFORCED_MAT, STUD_GEO, STUD_MAT, RUNE_MAT, SEAM_MAT,
  ENEMY_FLOOR_MAT, ENEMY_WALL_MAT, ENEMY_STUD_MAT, ENEMY_RUNE_MAT, ENEMY_SEAM_MAT,
  PORTAL_NEUTRAL_BASE_MAT, PORTAL_NEUTRAL_INNER_MAT,
  PORTAL_CLAIMED_BASE_MAT, PORTAL_CLAIMED_INNER_MAT,
} from './materials.js';
import { grid, discovered } from './state.js';
import { tileGroup } from './scene.js';
import { markMinimapDirty } from './minimap.js';
// Tile types that are always visible regardless of fog (raw rock terrain). Has
// to live here too — fog.js can't be imported from tiles.js without creating
// an init-order cycle (fog → state → tiles).
const _ALWAYS_VISIBLE_TYPES = new Set([T_ROCK]);

const THREE = window.THREE;

// ============================================================
// ROCK INSTANCING
// ============================================================
// Natural T_ROCK cells dominate the map (4000+ on a 64×64 grid). Rendering
// each as its own Mesh sent thousands of uniformMatrix4fv calls per frame —
// the dominant cost in the perf trace. Folding them into a single
// InstancedMesh collapses that to one draw call. Each instance carries a
// per-instance rotation (variance) and a slight color tint via setColorAt
// so the field doesn't look uniform.
//
// Slot lifecycle: setTile(x, z, T_ROCK) acquires a slot; setTile to anything
// else releases it (the slot is hidden via a zero-scale matrix and recycled).
let _rockMesh = null;
const _rockSlotByCell = new Map();    // "x,z" -> instanceId
const _rockCellBySlot = [];           // instanceId -> {x, z} (or null)
const _rockFreeSlots = [];
let _rockHighWater = 0;

const _tmpMat = new THREE.Matrix4();
const _tmpRotMat = new THREE.Matrix4();
const _tmpHideMat = new THREE.Matrix4().makeScale(0, 0, 0);
const _tmpColor = new THREE.Color();

function _ensureRockMesh() {
  if (_rockMesh) return _rockMesh;
  const cap = GRID_SIZE * GRID_SIZE;
  _rockMesh = new THREE.InstancedMesh(ROCK_GEO, ROCK_MAT, cap);
  // Rocks dominate the shadow caster count — disabling here is a major win.
  // The directional light is gentle and the iso angle makes individual rock
  // shadows mostly invisible against neighbouring rocks anyway.
  _rockMesh.castShadow = false;
  _rockMesh.receiveShadow = true;
  _rockMesh.count = 0;
  _rockMesh.userData = { isRockInstanced: true };
  // Per-instance color attribute so each rock can have its own subtle shade.
  _rockMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(cap * 3), 3
  );
  tileGroup.add(_rockMesh);
  return _rockMesh;
}

function _addRockInstance(x, z) {
  const im = _ensureRockMesh();
  let slot;
  if (_rockFreeSlots.length > 0) {
    slot = _rockFreeSlots.pop();
  } else {
    slot = _rockHighWater++;
    if (slot >= im.count) im.count = slot + 1;
  }
  const rot = ((x * 7 + z * 13) & 3) * (Math.PI / 2);
  _tmpRotMat.makeRotationY(rot);
  _tmpMat.makeTranslation(x, 0.575, z).multiply(_tmpRotMat);
  im.setMatrixAt(slot, _tmpMat);
  // Subtle deterministic shade so the field doesn't read as a perfectly
  // uniform tile pattern. Keep variance modest — strong drift looked busy.
  const hash = (x * 73856093) ^ (z * 19349663);
  const shade = 0.85 + ((hash >>> 0) % 100) / 100 * 0.3;
  _tmpColor.copy(ROCK_MAT.color).multiplyScalar(shade);
  im.setColorAt(slot, _tmpColor);
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  _rockSlotByCell.set(x + ',' + z, slot);
  _rockCellBySlot[slot] = { x, z };
}

function _removeRockInstance(x, z) {
  const key = x + ',' + z;
  const slot = _rockSlotByCell.get(key);
  if (slot === undefined) return;
  const im = _ensureRockMesh();
  im.setMatrixAt(slot, _tmpHideMat);
  im.instanceMatrix.needsUpdate = true;
  _rockSlotByCell.delete(key);
  _rockCellBySlot[slot] = null;
  _rockFreeSlots.push(slot);
}

// Raycast helper for input.js — given an InstancedMesh hit, return the cell
// the hit instance corresponds to. Returns null if the slot has been freed
// (race window between dig completion and the next pointer event).
export function getRockInstanceCell(slot) {
  return _rockCellBySlot[slot] || null;
}

export function createTileMesh(x, z, type) {
  let mesh;
  if (type === T_ROCK) {
    // Rocks are rendered through the shared InstancedMesh — see _addRockInstance.
    // Returning null tells setTile to skip the per-cell mesh attach.
    return null;
  } else if (type === T_GOLD) {
    mesh = new THREE.Mesh(ROCK_GEO, GOLD_MAT.clone());
    mesh.material.userData.perInstance = true;
    mesh.position.set(x, 0.575, z);
    mesh.rotation.y = Math.floor(Math.random() * 4) * Math.PI / 2;
    // Gold is rare (~100 cells) but still drops shadow casting — the iso
    // camera plus the dense rock around veins makes individual shadows
    // indistinguishable from the surrounding shadow soup.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    // Shimmer flecks reuse shared geo/mat so digging out a gold seam doesn't
    // allocate (and then redundantly try to dispose) per-tile copies.
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(GOLD_FLECK_GEO, GOLD_FLECK_MAT);
      f.position.set(
        (Math.random() - 0.5) * 0.6,
        0.3 + Math.random() * 0.25,
        (Math.random() - 0.5) * 0.6
      );
      mesh.add(f);
    }
  } else if (type === T_FLOOR) {
    mesh = new THREE.Mesh(FLOOR_GEO, FLOOR_MAT);
    mesh.position.set(x, 0.04, z);
    mesh.receiveShadow = true;
  } else if (type === T_CLAIMED) {
    mesh = new THREE.Mesh(FLOOR_GEO, CLAIMED_MAT);
    mesh.position.set(x, 0.04, z);
    mesh.receiveShadow = true;
  } else if (type === T_REINFORCED) {
    // Shorter block so it sits lower than surrounding rock — reads as "worked stone"
    mesh = new THREE.Mesh(REINFORCED_GEO, REINFORCED_MAT);
    mesh.position.set(x, 0.46, z);  // height 0.92, center at 0.46
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Large brass corner studs at the top (children — not raycast)
    const studOffsets = [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]];
    for (const [sx, sz] of studOffsets) {
      const s = new THREE.Mesh(STUD_GEO, STUD_MAT);
      s.position.set(sx, 0.38, sz);
      // Studs are tiny — their shadow contribution is dwarfed by the parent
      // wall's own. Skip to halve the wall's shadow-caster count.
      mesh.add(s);
    }

    // Prominent glowing rune on top: ring + cross
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 8, 20), RUNE_MAT);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.48;
    mesh.add(ring);
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.08), RUNE_MAT);
    bar1.position.y = 0.48;
    mesh.add(bar1);
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.46), RUNE_MAT);
    bar2.position.y = 0.48;
    mesh.add(bar2);

    // Glowing seam around the mid-section (a thin box slightly larger than the wall)
    const seam = new THREE.Mesh(new THREE.BoxGeometry(1.03, 0.06, 1.03), SEAM_MAT);
    seam.position.y = -0.05;
    mesh.add(seam);
  } else if (type === T_ENEMY_FLOOR) {
    mesh = new THREE.Mesh(FLOOR_GEO, ENEMY_FLOOR_MAT);
    mesh.position.set(x, 0.04, z);
    mesh.receiveShadow = true;
  } else if (type === T_ENEMY_WALL) {
    // Same shape as your reinforced wall but with blue faction colors
    mesh = new THREE.Mesh(REINFORCED_GEO, ENEMY_WALL_MAT);
    mesh.position.set(x, 0.46, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const studOffsets = [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]];
    for (const [sx, sz] of studOffsets) {
      const s = new THREE.Mesh(STUD_GEO, ENEMY_STUD_MAT);
      s.position.set(sx, 0.38, sz);
      mesh.add(s);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 8, 20), ENEMY_RUNE_MAT);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.48;
    mesh.add(ring);
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.08), ENEMY_RUNE_MAT);
    bar1.position.y = 0.48;
    mesh.add(bar1);
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.46), ENEMY_RUNE_MAT);
    bar2.position.y = 0.48;
    mesh.add(bar2);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(1.03, 0.06, 1.03), ENEMY_SEAM_MAT);
    seam.position.y = -0.05;
    mesh.add(seam);
  } else if (type === T_PORTAL_NEUTRAL || type === T_PORTAL_CLAIMED) {
    // Per-cell portal floor: just a dark base disc with a small glowing inset.
    // The big swirl + point light live on a single portal-level decor mesh
    // (init.js builds it; creatures.js animatePortals drives it). With 4×4
    // portal footprints, putting swirls per-cell would multiply the visual.
    mesh = new THREE.Mesh(FLOOR_GEO, type === T_PORTAL_CLAIMED ? PORTAL_CLAIMED_BASE_MAT : PORTAL_NEUTRAL_BASE_MAT);
    mesh.position.set(x, 0.04, z);
    mesh.receiveShadow = true;
    const innerMat = type === T_PORTAL_CLAIMED ? PORTAL_CLAIMED_INNER_MAT : PORTAL_NEUTRAL_INNER_MAT;
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.36, 20), innerMat);
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.051;
    mesh.add(inner);
  }
  if (mesh) mesh.userData = { gridX: x, gridZ: z, tileType: type };
  return mesh;
}

// Dig marker (glowing ring/spike above a marked rock)
export function createMarker(x, z) {
  const g = new THREE.Group();
  const ringGeo = new THREE.TorusGeometry(0.35, 0.04, 8, 24);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xe8a018, emissive: 0xffa818, emissiveIntensity: 1.5
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.35;
  g.add(ring);

  // Downward pick/spike
  const spikeGeo = new THREE.ConeGeometry(0.08, 0.3, 6);
  const spike = new THREE.Mesh(spikeGeo, ringMat);
  spike.rotation.x = Math.PI;
  spike.position.y = 1.5;
  g.add(spike);

  g.position.set(x, 0, z);
  g.userData = { ring, spike, phase: Math.random() * Math.PI * 2 };
  return g;
}

// Replace a tile's mesh with a new one of the given type. Disposes per-tile
// geometries that were created inline (rock/gold flecks); shared geometries
// (ROCK_GEO, FLOOR_GEO) are NOT disposed because other tiles still reference them.
// Walks children so inline-created child geo/mats (T_GOLD flecks, reinforced
// rune bars, enemy-wall studs) don't leak when a tile is replaced.
function _disposeTileMesh(mesh) {
  if (!mesh) return;
  mesh.traverse(obj => {
    if (!obj.isMesh) return;
    const geo = obj.geometry;
    if (geo && geo !== ROCK_GEO && geo !== FLOOR_GEO && geo !== GOLD_FLECK_GEO && geo.dispose) geo.dispose();
    // Dispose per-instance (cloned) materials only — shared materials are
    // reused across tiles and must survive.
    const mat = obj.material;
    if (mat && mat.userData && mat.userData.perInstance && mat.dispose) mat.dispose();
  });
}
export function setTile(x, z, type) {
  const cell = grid[x][z];
  // Was-rock-instance check has to fire BEFORE we touch cell.mesh because rocks
  // are stored in the InstancedMesh, not as a per-cell mesh. The slot map is
  // the source of truth for "is this cell currently a rock instance".
  if (_rockSlotByCell.has(x + ',' + z)) {
    _removeRockInstance(x, z);
  }
  if (cell.mesh) {
    tileGroup.remove(cell.mesh);
    _disposeTileMesh(cell.mesh);
    cell.mesh = null;
  }
  cell.type = type;

  if (type === T_ROCK) {
    // Rocks are rendered through the singleton InstancedMesh. Per-cell
    // visibility for fog isn't yet supported (T_ROCK is in ALWAYS_VISIBLE
    // anyway, so individual instance hiding never matters), so we just
    // acquire a slot and leave fog alone.
    _addRockInstance(x, z);
    cell.mesh = null;
    markMinimapDirty();
    return;
  }

  const mesh = createTileMesh(x, z, type);
  if (mesh) {
    tileGroup.add(mesh);
    cell.mesh = mesh;
    // Apply fog-of-war: hidden until discovered, except always-visible types
    // (raw rock terrain) which keep the world's silhouette readable.
    if (_ALWAYS_VISIBLE_TYPES.has(type)) mesh.visible = true;
    else if (discovered[x] && discovered[x][z]) mesh.visible = true;
    else mesh.visible = false;
  } else {
    cell.mesh = null;
  }
  markMinimapDirty();
}
