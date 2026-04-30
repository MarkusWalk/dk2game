// ============================================================
// TILE FACTORY — rocks, floors, walls, portals, dig markers
// ============================================================
// Builds the per-cell THREE.Mesh for any tile type. Rocks clone their material
// for per-instance color drift; floors reuse the shared material. Portals are
// compound groups with an inner disc, two rotating swirl rings, and a point
// light. All meshes carry userData.{gridX,gridZ,tileType} so raycasting in
// input.js can map a hit back to the grid.

import {
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

export function createTileMesh(x, z, type) {
  let mesh;
  if (type === T_ROCK) {
    // Each rock gets a tiny variation so the field doesn't look uniform
    mesh = new THREE.Mesh(ROCK_GEO, ROCK_MAT.clone());
    mesh.material.userData.perInstance = true;
    // subtle color drift
    const shade = 0.85 + Math.random() * 0.3;
    mesh.material.color.multiplyScalar(shade);
    mesh.position.set(x, 0.575, z);
    mesh.rotation.y = Math.floor(Math.random() * 4) * Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  } else if (type === T_GOLD) {
    mesh = new THREE.Mesh(ROCK_GEO, GOLD_MAT.clone());
    mesh.material.userData.perInstance = true;
    mesh.position.set(x, 0.575, z);
    mesh.rotation.y = Math.floor(Math.random() * 4) * Math.PI / 2;
    mesh.castShadow = true;
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
      s.castShadow = true;
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
      s.castShadow = true;
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
  if (cell.mesh) {
    tileGroup.remove(cell.mesh);
    _disposeTileMesh(cell.mesh);
  }
  cell.type = type;
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
