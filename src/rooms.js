// ============================================================
// ROOM DECOR — SEAMLESS PLATES, VARIANTS, ROOM ENTITIES
// ============================================================
// Core idea: stop decorating tiles in isolation. Every tile still owns its own
// VARIANT PROP (coin pile / bed / trough / etc.), but the base floor plate fills
// the full 1x1 tile (no grid gaps), corner studs appear only on EDGE tiles, and
// each contiguous cluster of same-type tiles is treated as a single Room entity
// with a central light and large central inlay scaled to room size.
//
// Hashing (x,z) → variant means every tile in the same spot always rolls the same
// decoration, so rooms stay stable when you un/re-designate. The variety across
// tiles is what makes 6 treasury tiles read as "one treasure hall" instead of
// "six identical gold piles in a row."

import {
  GRID_SIZE,
  ROOM_TREASURY, ROOM_LAIR, ROOM_HATCHERY,
  T_CLAIMED, TREASURY_PILE_VISUAL_CAP,
} from './constants.js';
import {
  ROOM_FLOOR_GEO, EDGE_STUD_GEO,
  TREASURY_FLOOR_MAT, TREASURY_STUD_MAT, TREASURY_INLAY_MAT,
  COIN_MAT, CHEST_WOOD_MAT, CHEST_BAND_MAT, GEM_MATS,
  LAIR_FLOOR_MAT, LAIR_STUD_MAT, LAIR_RUNE_MAT,
  LAIR_COCOON_MAT, LAIR_SILK_MAT, LAIR_PUPA_MAT,
  RUG_MAT, RUG_TRIM_MAT, BONE_MAT, WATER_MAT, BOWL_MAT,
  BRAZIER_MAT, EMBER_MAT,
  HATCHERY_FLOOR_MAT, HATCHERY_STUD_MAT, HATCHERY_INLAY_MAT,
  HATCHERY_GRASS_MAT, STRAW_MAT, WOOD_MAT, MUD_MAT, FEED_MAT,
  CHICKEN_BODY_MAT, CHICKEN_BEAK_MAT, CHICKEN_COMB_MAT,
  EGG_SHELL_MAT, EGG_SPOT_MAT,
} from './materials.js';
import { grid, rooms, treasuries } from './state.js';
import { scene } from './scene.js';
import { playSfx } from './audio.js';

const THREE = window.THREE;

// --- Deterministic variant rolling ---
export function tileHash(x, z, salt = 0) {
  // Small 32-bit mix — deterministic, fast, good enough for prop distribution
  const h = ((x * 73856093) ^ (z * 19349663) ^ (salt * 83492791)) >>> 0;
  return (h & 0xffffff) / 0xffffff;
}
export function pickVariant(roll, variants) {
  const total = variants.reduce((s, v) => s + v.w, 0);
  let r = roll * total;
  for (const v of variants) {
    if (r < v.w) return v.n;
    r -= v.w;
  }
  return variants[variants.length - 1].n;
}
// Which of the 4 neighbors face a DIFFERENT room type (or non-room)?
// Used so corner studs only appear on true room edges, not inside.
export function getEdgeDirs(x, z, roomType) {
  const same = (nx, nz) =>
    grid[nx] && grid[nx][nz] && grid[nx][nz].roomType === roomType;
  return { n: !same(x, z-1), s: !same(x, z+1), w: !same(x-1, z), e: !same(x+1, z) };
}

// ============================================================
// VARIANT TABLES — (weights sum unbounded, pickVariant normalises)
// ============================================================
export const TREASURY_VARIANTS = [
  { n: 'coin_carpet',  w: 30 },
  { n: 'big_pile',     w: 18 },
  { n: 'chest',        w: 14 },
  { n: 'coin_columns', w: 10 },
  { n: 'gem_cluster',  w: 5  },
  { n: 'empty',        w: 23 },
];
export const LAIR_VARIANTS = [
  // 'bed' is the default for an UNOWNED lair tile — a small empty nest.
  // When a creature owns this tile we swap to a full occupied nest.
  { n: 'bed',        w: 32 },
  { n: 'rug',        w: 16 },
  { n: 'bones',      w: 12 },
  { n: 'skull',      w: 8  },
  { n: 'water_bowl', w: 7  },
  { n: 'brazier',    w: 5  },
  { n: 'empty',      w: 20 },
];
export const HATCHERY_VARIANTS = [
  { n: 'grass_tufts',  w: 22 },
  { n: 'straw_patch',  w: 16 },
  { n: 'feed_pellets', w: 14 },
  { n: 'straw_bale',   w: 10 },
  { n: 'trough',       w: 8  },
  { n: 'water_trough', w: 6  },
  { n: 'perch',        w: 4  },
  { n: 'mud',          w: 20 },
];

export function tileVariantName(x, z, roomType) {
  const table =
    roomType === ROOM_TREASURY ? TREASURY_VARIANTS :
    roomType === ROOM_LAIR     ? LAIR_VARIANTS     :
                                 HATCHERY_VARIANTS;
  return pickVariant(tileHash(x, z, 1), table);
}

// ============================================================
// PER-TILE PROP BUILDERS
// ============================================================
// Each returns a Group positioned at (x, y=0, z). Group owns any per-tile state
// (scale targets, swappable children, light references) via userData.
//
// For TREASURY, userData.pile is the sub-group that scales with gold amount;
// userData.light is the gold glow; userData.variant is the variant name so
// updateGoldPile knows how to grow each kind.
// For LAIR, userData.bed is the occupied-nest prop (hidden unless owned);
// userData.decor is the unowned-variant prop (shown unless owned).
// For HATCHERY, userData.egg is the depletion prop (hidden until eaten from);
// userData.prop is the variant decoration.

// --- Treasury variant builders ---
function _makeCoinCarpet(hash) {
  // Low, wide bumpy mound — reads as "floor covered in coins"
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.42, 0.09, 10, 1),
    COIN_MAT
  );
  base.position.y = 0.16;
  base.rotation.y = hash * Math.PI * 2;
  base.castShadow = true;
  g.add(base);
  // Scatter a dozen nuggets on top
  const nuggetGeo = new THREE.IcosahedronGeometry(0.045, 0);
  for (let i = 0; i < 12; i++) {
    const n = new THREE.Mesh(nuggetGeo, COIN_MAT);
    const a = (i / 12) * Math.PI * 2 + hash * 6;
    const r = 0.08 + ((i * 3 + hash * 100) % 22) / 100;
    n.position.set(Math.cos(a) * r, 0.2 + (i % 3) * 0.015, Math.sin(a) * r);
    n.rotation.set(i, i * 0.7, i * 0.3);
    g.add(n);
  }
  return g;
}
function _makeBigPile(hash) {
  // Irregular lumpy mound — stacked icos, not a clean cone
  const g = new THREE.Group();
  const lumpGeo = new THREE.IcosahedronGeometry(0.18, 0);
  for (let i = 0; i < 7; i++) {
    const lump = new THREE.Mesh(lumpGeo, COIN_MAT);
    const a = i * 0.9 + hash * 6;
    const r = 0.03 + (i % 3) * 0.08;
    lump.position.set(Math.cos(a) * r, 0.18 + i * 0.07, Math.sin(a) * r);
    const s = 0.7 + ((i * 7 + hash * 50) % 40) / 100;
    lump.scale.setScalar(s);
    lump.rotation.set(i * 0.6, i * 0.9, i * 0.3);
    lump.castShadow = true;
    g.add(lump);
  }
  return g;
}
function _makeChest(hash) {
  const g = new THREE.Group();
  // Base box
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.25, 0.38), CHEST_WOOD_MAT);
  base.position.y = 0.24;
  base.castShadow = true; base.receiveShadow = true;
  g.add(base);
  // Open lid — rotated back
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.38), CHEST_WOOD_MAT);
  lid.position.set(0, 0.39, -0.19);
  lid.rotation.x = -0.9;
  lid.castShadow = true;
  g.add(lid);
  // Metal bands on chest
  for (const bx of [-0.22, 0.22]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.4), CHEST_BAND_MAT);
    band.position.set(bx, 0.24, 0);
    g.add(band);
  }
  // Spilling coins inside + out front
  const coinGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.015, 8);
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Mesh(coinGeo, COIN_MAT);
    const fx = (i % 3 - 1) * 0.14 + (hash * 10 + i) % 0.1;
    const fz = 0.18 + (i % 2) * 0.04;
    c.position.set(fx, 0.13 + (i % 3) * 0.015, fz);
    c.rotation.x = (i * 0.3) % 0.6;
    c.castShadow = true;
    g.add(c);
  }
  // Couple coins heaped inside the chest
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(coinGeo, COIN_MAT);
    c.position.set((i - 2) * 0.07, 0.37, -0.02 + (i % 2) * 0.03);
    c.rotation.x = Math.PI / 2 + i * 0.2;
    g.add(c);
  }
  g.rotation.y = (hash - 0.5) * 0.7;
  return g;
}
function _makeCoinColumns(hash) {
  const g = new THREE.Group();
  const coinGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.02, 10);
  // 3 stacks of varying height
  const stackPos = [[-0.18, -0.12], [0.16, -0.14], [0.02, 0.18]];
  const stackH = [6, 8, 5];
  for (let s = 0; s < 3; s++) {
    const [px, pz] = stackPos[s];
    const h = stackH[s] + Math.floor(hash * 4);
    for (let i = 0; i < h; i++) {
      const c = new THREE.Mesh(coinGeo, COIN_MAT);
      c.position.set(px, 0.15 + i * 0.023, pz);
      c.rotation.y = i * 0.4;
      if (i === 0) c.castShadow = true;
      g.add(c);
    }
  }
  return g;
}
function _makeGemCluster(hash) {
  const g = new THREE.Group();
  const gemGeo = new THREE.OctahedronGeometry(0.07, 0);
  for (let i = 0; i < 5; i++) {
    const mat = GEM_MATS[(Math.floor(hash * 100) + i) % GEM_MATS.length];
    const gem = new THREE.Mesh(gemGeo, mat);
    const a = i * 1.3 + hash * 5;
    const r = 0.08 + (i % 3) * 0.05;
    gem.position.set(Math.cos(a) * r, 0.2 + (i % 2) * 0.04, Math.sin(a) * r);
    gem.rotation.set(i, i * 0.8, i * 0.3);
    gem.scale.setScalar(0.7 + (i % 3) * 0.15);
    gem.castShadow = true;
    g.add(gem);
  }
  // Gold dust around them
  const dustGeo = new THREE.IcosahedronGeometry(0.025, 0);
  for (let i = 0; i < 6; i++) {
    const d = new THREE.Mesh(dustGeo, COIN_MAT);
    const a = i * 1.1 + hash * 9;
    d.position.set(Math.cos(a) * 0.28, 0.18, Math.sin(a) * 0.28);
    g.add(d);
  }
  return g;
}

export function buildTreasuryTile(x, z) {
  // Returns a Group with: corner studs (edge-aware), variant pile, point light.
  // Pile sub-group starts hidden until first deposit. Light intensity driven by amount.
  const group = new THREE.Group();
  const hash = tileHash(x, z, 7);
  const variant = tileVariantName(x, z, ROOM_TREASURY);

  // Full-tile floor plate — covers the claimed burgundy beneath and merges with
  // neighbors (1.0 wide, no gap) so the whole room reads as a continuous surface.
  const plate = new THREE.Mesh(ROOM_FLOOR_GEO, TREASURY_FLOOR_MAT);
  plate.position.y = 0.09;
  plate.receiveShadow = true;
  group.add(plate);

  // Edge-aware corner studs: at each of the 4 tile corners, add a stud only if
  // BOTH adjacent edges face outside this room. Interior corners stay clean.
  const edges = getEdgeDirs(x, z, ROOM_TREASURY);
  const corners = [
    { pos: [-0.4, -0.4], a: 'n', b: 'w' },
    { pos: [ 0.4, -0.4], a: 'n', b: 'e' },
    { pos: [-0.4,  0.4], a: 's', b: 'w' },
    { pos: [ 0.4,  0.4], a: 's', b: 'e' },
  ];
  for (const c of corners) {
    if (edges[c.a] && edges[c.b]) {
      const s = new THREE.Mesh(EDGE_STUD_GEO, TREASURY_STUD_MAT);
      s.position.set(c.pos[0], 0.11, c.pos[1]);
      s.castShadow = true;
      group.add(s);
    }
  }

  // Variant prop — holds the pile sub-group (what scales with gold)
  const pile = new THREE.Group();
  let propBuilder;
  if (variant === 'empty') {
    // Still build something invisible so updateGoldPile doesn't crash
    propBuilder = new THREE.Group();
  } else if (variant === 'coin_carpet')  propBuilder = _makeCoinCarpet(hash);
  else if (variant === 'big_pile')       propBuilder = _makeBigPile(hash);
  else if (variant === 'chest')          propBuilder = _makeChest(hash);
  else if (variant === 'coin_columns')   propBuilder = _makeCoinColumns(hash);
  else if (variant === 'gem_cluster')    propBuilder = _makeGemCluster(hash);
  else                                    propBuilder = _makeCoinCarpet(hash);
  pile.add(propBuilder);
  pile.visible = false;  // gold deposit makes this visible
  group.add(pile);

  // Warm pool light — always present, intensity scales with amount
  const light = new THREE.PointLight(0xffaa44, 0, 2.6, 2);
  light.position.y = 0.5;
  group.add(light);

  group.position.set(x, 0, z);
  group.userData = { pile, light, variant, hash, propBuilder };
  return group;
}

export function updateGoldPile(tileGroup, amount) {
  const ud = tileGroup.userData;
  if (amount <= 0) {
    ud.pile.visible = false;
    ud.light.intensity = 0;
    return;
  }
  ud.pile.visible = true;
  const t = Math.min(1, amount / TREASURY_PILE_VISUAL_CAP);
  // Each variant grows differently — carpet spreads, pile heightens, chest doesn't
  // change shape (it's a discrete container), columns get taller, gems don't scale.
  if (ud.variant === 'coin_carpet') {
    const s = 0.5 + t * 0.9;
    ud.propBuilder.scale.set(s, 0.7 + t * 1.1, s);
  } else if (ud.variant === 'big_pile') {
    const s = 0.5 + t * 1.1;
    ud.propBuilder.scale.set(s, 0.5 + t * 1.5, s);
  } else if (ud.variant === 'coin_columns') {
    ud.propBuilder.scale.set(1, 0.35 + t * 0.9, 1);
  } else {
    // chest, gem_cluster, empty — fixed visual, just fade light with amount
    ud.propBuilder.scale.set(1, 1, 1);
  }
  ud.light.intensity = 0.4 + t * 1.3;
}

// --- Lair variant builders ---
function _makeLairRug(hash) {
  const g = new THREE.Group();
  const rug = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.015, 0.55), RUG_MAT);
  rug.position.y = 0.13;
  rug.rotation.y = (hash - 0.5) * 0.6;
  rug.receiveShadow = true;
  g.add(rug);
  // Trim
  for (const dz of [-0.27, 0.27]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.02, 0.04), RUG_TRIM_MAT);
    trim.position.set(0, 0.135, dz);
    trim.rotation.y = rug.rotation.y;
    g.add(trim);
  }
  return g;
}
function _makeLairBones(hash) {
  const g = new THREE.Group();
  const boneGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.28, 6);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(boneGeo, BONE_MAT);
    const a = i * 1.2 + hash * 5;
    b.position.set(Math.cos(a) * 0.15, 0.14, Math.sin(a) * 0.15);
    b.rotation.z = Math.PI / 2;
    b.rotation.y = a;
    b.castShadow = true;
    g.add(b);
    // End knobs
    for (const ey of [-0.14, 0.14]) {
      const end = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 4), BONE_MAT);
      const dx = Math.cos(a) * 0.15 + Math.cos(a + Math.PI / 2) * ey;
      const dz = Math.sin(a) * 0.15 + Math.sin(a + Math.PI / 2) * ey;
      end.position.set(dx, 0.14, dz);
      g.add(end);
    }
  }
  return g;
}
function _makeLairSkull(hash) {
  const g = new THREE.Group();
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), BONE_MAT);
  cranium.scale.set(1, 0.85, 1.1);
  cranium.position.y = 0.22;
  cranium.castShadow = true;
  g.add(cranium);
  // Jaw
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 0.1), BONE_MAT);
  jaw.position.set(0, 0.15, 0.08);
  g.add(jaw);
  // Eye sockets — dark pits
  const socketMat = new THREE.MeshStandardMaterial({ color: 0x0a0508, roughness: 1 });
  const sockL = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), socketMat);
  sockL.position.set(-0.045, 0.22, 0.1);
  g.add(sockL);
  const sockR = sockL.clone();
  sockR.position.set(0.045, 0.22, 0.1);
  g.add(sockR);
  g.rotation.y = (hash - 0.5) * 1.5;
  return g;
}
function _makeLairWaterBowl(hash) {
  const g = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.08, 10), BOWL_MAT);
  bowl.position.y = 0.17;
  bowl.castShadow = true;
  g.add(bowl);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.01, 12), WATER_MAT);
  water.position.y = 0.21;
  g.add(water);
  return g;
}
function _makeLairBrazier(hash) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.28, 8), BRAZIER_MAT);
  base.position.y = 0.27;
  base.castShadow = true;
  g.add(base);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.1, 0.08, 8), BRAZIER_MAT);
  bowl.position.y = 0.43;
  g.add(bowl);
  const ember = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), EMBER_MAT);
  ember.position.y = 0.48;
  g.add(ember);
  const light = new THREE.PointLight(0xff6030, 0.8, 2.5, 2);
  light.position.y = 0.55;
  g.add(light);
  g.userData = { ember, light };  // animated flicker-lite
  return g;
}
function _makeLairBed(hash, occupied) {
  // The occupied nest uses the same silk-cocoon language as the original, but
  // with thicker, more bedlike cushioning. Unoccupied beds omit the glowing pupa
  // so you can instantly see which tiles have a creature resting vs ready.
  const g = new THREE.Group();
  const cocoon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), LAIR_COCOON_MAT);
  cocoon.scale.set(1, 0.55, 1.15);
  cocoon.position.y = 0.24;
  cocoon.castShadow = true;
  cocoon.receiveShadow = true;
  g.add(cocoon);
  const silk1 = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.013, 5, 18), LAIR_SILK_MAT);
  silk1.rotation.set(0, 0, Math.PI / 2);
  silk1.scale.set(1, 1, 0.55);
  silk1.position.y = 0.24;
  g.add(silk1);
  const silk2 = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.013, 5, 18), LAIR_SILK_MAT);
  silk2.rotation.set(Math.PI / 2, 0.4, 0);
  silk2.scale.set(1.15, 1, 0.55);
  silk2.position.y = 0.24;
  g.add(silk2);
  if (occupied) {
    const pupa = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 1), LAIR_PUPA_MAT);
    pupa.position.y = 0.25;
    g.add(pupa);
    const light = new THREE.PointLight(0xa060ff, 0.55, 2.0, 2);
    light.position.y = 0.26;
    g.add(light);
    g.userData = { pupa, light };
  }
  g.rotation.y = hash * Math.PI * 2;
  return g;
}

export function buildLairTile(x, z) {
  const group = new THREE.Group();
  const hash = tileHash(x, z, 13);
  let variant = tileVariantName(x, z, ROOM_LAIR);

  // Dark-stone floor plate for the whole tile
  const plate = new THREE.Mesh(ROOM_FLOOR_GEO, LAIR_FLOOR_MAT);
  plate.position.y = 0.09;
  plate.receiveShadow = true;
  group.add(plate);

  // Edge-aware studs (dark metallic)
  const edges = getEdgeDirs(x, z, ROOM_LAIR);
  const corners = [
    { pos: [-0.4, -0.4], a: 'n', b: 'w' },
    { pos: [ 0.4, -0.4], a: 'n', b: 'e' },
    { pos: [-0.4,  0.4], a: 's', b: 'w' },
    { pos: [ 0.4,  0.4], a: 's', b: 'e' },
  ];
  for (const c of corners) {
    if (edges[c.a] && edges[c.b]) {
      const s = new THREE.Mesh(EDGE_STUD_GEO, LAIR_STUD_MAT);
      s.position.set(c.pos[0], 0.11, c.pos[1]);
      s.castShadow = true;
      group.add(s);
    }
  }

  // Build variant decor AND a hidden bed prop; we swap visibility when a
  // creature claims this tile (becomes lairOwner).
  let decor;
  if      (variant === 'rug')        decor = _makeLairRug(hash);
  else if (variant === 'bones')      decor = _makeLairBones(hash);
  else if (variant === 'skull')      decor = _makeLairSkull(hash);
  else if (variant === 'water_bowl') decor = _makeLairWaterBowl(hash);
  else if (variant === 'brazier')    decor = _makeLairBrazier(hash);
  else if (variant === 'bed')        decor = _makeLairBed(hash, false);
  else                               decor = new THREE.Group();  // 'empty'
  group.add(decor);

  const bed = _makeLairBed(hash, true);
  bed.visible = false;
  group.add(bed);

  group.position.set(x, 0, z);
  group.userData = { variant, hash, decor, bed };
  return group;
}

// Called whenever a creature claims or releases this tile as its bed.
export function setLairOccupied(cell, occupied) {
  const mesh = cell.roomMesh;
  if (!mesh || !mesh.userData.bed) return;
  mesh.userData.bed.visible = !!occupied;
  mesh.userData.decor.visible = !occupied;
}

// --- Hatchery variant builders ---
function _makeHatcheryGrass(hash) {
  const g = new THREE.Group();
  const tuftGeo = new THREE.ConeGeometry(0.04, 0.12, 4);
  for (let i = 0; i < 7; i++) {
    const t = new THREE.Mesh(tuftGeo, HATCHERY_GRASS_MAT);
    const a = i * 0.9 + hash * 6;
    const r = 0.08 + (i % 3) * 0.08;
    t.position.set(Math.cos(a) * r, 0.17, Math.sin(a) * r);
    t.rotation.y = a;
    t.rotation.z = ((i % 5) - 2) * 0.1;
    t.castShadow = true;
    g.add(t);
  }
  return g;
}
function _makeStrawPatch(hash) {
  const g = new THREE.Group();
  const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.04, 10), STRAW_MAT);
  straw.position.y = 0.13;
  straw.rotation.y = hash * Math.PI * 2;
  g.add(straw);
  // A few loose straws on top
  const strandGeo = new THREE.BoxGeometry(0.18, 0.015, 0.02);
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(strandGeo, STRAW_MAT);
    s.position.set((i % 2 - 0.5) * 0.15, 0.155, ((i * 3) % 4 - 2) * 0.06);
    s.rotation.y = i * 0.7 + hash;
    g.add(s);
  }
  return g;
}
function _makeFeedPellets(hash) {
  const g = new THREE.Group();
  const pelletGeo = new THREE.IcosahedronGeometry(0.028, 0);
  for (let i = 0; i < 9; i++) {
    const p = new THREE.Mesh(pelletGeo, FEED_MAT);
    const a = i * 1.3 + hash * 5;
    const r = ((i * 7 + hash * 100) % 30) / 100;
    p.position.set(Math.cos(a) * r, 0.145, Math.sin(a) * r);
    p.rotation.set(i, i * 0.6, i * 0.3);
    g.add(p);
  }
  return g;
}
function _makeStrawBale(hash) {
  const g = new THREE.Group();
  const bale = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.28), STRAW_MAT);
  bale.position.y = 0.28;
  bale.rotation.y = (hash - 0.5) * 0.8;
  bale.castShadow = true;
  bale.receiveShadow = true;
  g.add(bale);
  // Binding ropes
  for (const ry of [-0.09, 0.09]) {
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.012, 5, 16),
      new THREE.MeshStandardMaterial({ color: 0x6a5028, roughness: 0.9 }));
    rope.rotation.set(0, bale.rotation.y, Math.PI / 2);
    rope.position.set(ry, 0.28, 0);
    g.add(rope);
  }
  return g;
}
function _makeFeedingTrough(hash) {
  const g = new THREE.Group();
  // Long wooden trough
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.14, 0.28), WOOD_MAT);
  body.position.y = 0.22;
  body.castShadow = true;
  g.add(body);
  // Hollow inside
  const inside = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 0.22), MUD_MAT);
  inside.position.y = 0.28;
  g.add(inside);
  // Feed pile inside
  const feed = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.18), FEED_MAT);
  feed.position.y = 0.295;
  g.add(feed);
  g.rotation.y = (hash - 0.5) * 0.8;
  return g;
}
function _makeWaterTrough(hash) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.32), WOOD_MAT);
  body.position.y = 0.22;
  body.castShadow = true;
  g.add(body);
  const water = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.02, 0.25), WATER_MAT);
  water.position.y = 0.3;
  g.add(water);
  g.rotation.y = (hash - 0.5) * 0.6;
  return g;
}
function _makePerch(hash) {
  const g = new THREE.Group();
  const postGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.45, 6);
  for (const [px, pz] of [[-0.2, 0], [0.2, 0]]) {
    const post = new THREE.Mesh(postGeo, WOOD_MAT);
    post.position.set(px, 0.34, pz);
    post.castShadow = true;
    g.add(post);
  }
  // Horizontal bar
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6), WOOD_MAT);
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 0.54;
  bar.castShadow = true;
  g.add(bar);
  g.rotation.y = hash * Math.PI;
  return g;
}
function _makeMud(hash) {
  const g = new THREE.Group();
  const patch = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.02, 10), MUD_MAT);
  patch.position.y = 0.12;
  patch.rotation.y = hash * Math.PI * 2;
  g.add(patch);
  return g;
}

function _makeEgg() {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), EGG_SHELL_MAT);
  shell.scale.set(0.9, 1.25, 0.9);
  shell.castShadow = true;
  shell.receiveShadow = true;
  g.add(shell);
  const spotGeo = new THREE.SphereGeometry(0.012, 5, 4);
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(spotGeo, EGG_SPOT_MAT);
    const ang = i * (Math.PI * 2 / 4) + 0.5;
    const h = -0.02 + (i % 2) * 0.04;
    s.position.set(Math.cos(ang) * 0.062, h, Math.sin(ang) * 0.062);
    g.add(s);
  }
  g.userData = { shell, basePhase: Math.random() * Math.PI * 2 };
  return g;
}

export function buildHatcheryTile(x, z) {
  const group = new THREE.Group();
  const hash = tileHash(x, z, 19);
  const variant = tileVariantName(x, z, ROOM_HATCHERY);

  // Mossy/swampy dirt floor plate for the whole tile
  const plate = new THREE.Mesh(ROOM_FLOOR_GEO, HATCHERY_FLOOR_MAT);
  plate.position.y = 0.09;
  plate.receiveShadow = true;
  group.add(plate);

  const edges = getEdgeDirs(x, z, ROOM_HATCHERY);
  const corners = [
    { pos: [-0.4, -0.4], a: 'n', b: 'w' },
    { pos: [ 0.4, -0.4], a: 'n', b: 'e' },
    { pos: [-0.4,  0.4], a: 's', b: 'w' },
    { pos: [ 0.4,  0.4], a: 's', b: 'e' },
  ];
  for (const c of corners) {
    if (edges[c.a] && edges[c.b]) {
      const s = new THREE.Mesh(EDGE_STUD_GEO, HATCHERY_STUD_MAT);
      s.position.set(c.pos[0], 0.11, c.pos[1]);
      s.castShadow = true;
      group.add(s);
    }
  }

  let prop;
  if      (variant === 'grass_tufts')  prop = _makeHatcheryGrass(hash);
  else if (variant === 'straw_patch')  prop = _makeStrawPatch(hash);
  else if (variant === 'feed_pellets') prop = _makeFeedPellets(hash);
  else if (variant === 'straw_bale')   prop = _makeStrawBale(hash);
  else if (variant === 'trough')       prop = _makeFeedingTrough(hash);
  else if (variant === 'water_trough') prop = _makeWaterTrough(hash);
  else if (variant === 'perch')        prop = _makePerch(hash);
  else                                  prop = _makeMud(hash);
  group.add(prop);

  // Egg — hidden unless this tile is currently depleted
  const egg = _makeEgg();
  egg.position.y = 0.18;
  egg.visible = false;
  group.add(egg);

  group.position.set(x, 0, z);
  group.userData = { variant, hash, prop, egg };
  return group;
}

// ============================================================
// ROOM ENTITIES — connected components + central light + inlay
// ============================================================
// Each `Room` owns room-level decoration that shouldn't be per-tile:
//   centerLight (tinted pool light at centroid)
//   inlay       (glowing rune at centroid, scaled to room size)
//   chickens    (hatchery only — 2-3 wandering ambience entities)
// Per-tile variant props still live on cell.roomMesh; Rooms and tile props
// coexist. Rebuild is triggered by designateTile/undesignateTile.

function floodRoomTiles(sx, sz, roomType) {
  const visited = new Set();
  const q = [[sx, sz]];
  while (q.length) {
    const [x, z] = q.pop();
    const k = x + ',' + z;
    if (visited.has(k)) continue;
    if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) continue;
    if (!grid[x][z] || grid[x][z].roomType !== roomType) continue;
    visited.add(k);
    q.push([x+1,z], [x-1,z], [x,z+1], [x,z-1]);
  }
  return visited;
}

function disposeRoomVisuals(room) {
  if (room.group) {
    scene.remove(room.group);
    room.group.traverse(obj => {
      if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
    });
  }
  if (room.chickens) {
    for (const c of room.chickens) scene.remove(c);
  }
}

function buildRoomCentralDecor(room) {
  // Central decor = one big inlay (rune/mosaic) at centroid + one tinted light.
  // Scale inlay with room size so small rooms don't get a giant rune.
  const g = new THREE.Group();
  const size = room.tiles.size;
  const inlayRadius = Math.min(0.22 + Math.sqrt(size) * 0.15, 0.9);
  const mat =
    room.type === ROOM_TREASURY ? TREASURY_INLAY_MAT :
    room.type === ROOM_LAIR     ? LAIR_RUNE_MAT :
                                   HATCHERY_INLAY_MAT;
  // Torus + cross — same visual language as wall runes so the player reads
  // the inlay as "this is a sacred/claimed area"
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(inlayRadius, inlayRadius * 0.09, 6, 24),
    mat
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.11;
  g.add(ring);
  const bar1 = new THREE.Mesh(
    new THREE.BoxGeometry(inlayRadius * 2 * 0.95, 0.03, inlayRadius * 0.18),
    mat
  );
  bar1.position.y = 0.11;
  g.add(bar1);
  const bar2 = new THREE.Mesh(
    new THREE.BoxGeometry(inlayRadius * 0.18, 0.03, inlayRadius * 2 * 0.95),
    mat
  );
  bar2.position.y = 0.11;
  g.add(bar2);

  // Tinted point light
  const lightColor =
    room.type === ROOM_TREASURY ? 0xffaa44 :
    room.type === ROOM_LAIR     ? 0xa060ff :
                                   0x90a040;
  const light = new THREE.PointLight(lightColor, 0.6, Math.min(5, 2 + Math.sqrt(size)), 2);
  light.position.y = 1.0;
  g.add(light);

  g.position.set(room.centroid.x, 0, room.centroid.z);
  room.inlay = { ring, bar1, bar2 };
  room.centerLight = light;
  return g;
}

// Per-room wandering chickens for hatchery rooms
function _createWanderChicken() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), CHICKEN_BODY_MAT);
  body.scale.set(1, 0.9, 1.1);
  body.position.y = 0.22;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), CHICKEN_BODY_MAT);
  head.position.set(0, 0.32, 0.08);
  head.castShadow = true;
  g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 4), CHICKEN_BEAK_MAT);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.32, 0.15);
  g.add(beak);
  const comb = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.05, 4), CHICKEN_COMB_MAT);
  comb.position.set(0, 0.37, 0.07);
  g.add(comb);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.09, 4), CHICKEN_BODY_MAT);
  tail.rotation.x = -0.6;
  tail.position.set(0, 0.27, -0.1);
  g.add(tail);
  g.userData = {
    head, body,
    targetX: 0, targetZ: 0,
    facing: Math.random() * Math.PI * 2,
    peckPhase: Math.random() * Math.PI * 2,
    state: 'idle',
    stateTimer: 0.5 + Math.random()
  };
  return g;
}
export function updateWanderChicken(chicken, room, dt) {
  const ud = chicken.userData;
  ud.stateTimer -= dt;
  if (ud.state === 'idle') {
    // Pecking head bob
    ud.peckPhase += dt * 6;
    ud.head.position.y = 0.32 + Math.abs(Math.sin(ud.peckPhase)) * -0.04;
    if (ud.stateTimer <= 0) {
      // Pick a new target tile in this room
      const tiles = Array.from(room.tiles);
      const pick = tiles[Math.floor(Math.random() * tiles.length)];
      const [tx, tz] = pick.split(',').map(Number);
      ud.targetX = tx + (Math.random() - 0.5) * 0.5;
      ud.targetZ = tz + (Math.random() - 0.5) * 0.5;
      ud.state = 'walking';
      ud.stateTimer = 3;
    }
  } else if (ud.state === 'walking') {
    const dx = ud.targetX - chicken.position.x;
    const dz = ud.targetZ - chicken.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08 || ud.stateTimer <= 0) {
      ud.state = 'idle';
      ud.stateTimer = 1 + Math.random() * 2;
    } else {
      const sp = 0.8;
      chicken.position.x += (dx / d) * sp * dt;
      chicken.position.z += (dz / d) * sp * dt;
      ud.facing = Math.atan2(dx, dz);
      // Walk bob
      ud.peckPhase += dt * 10;
      chicken.position.y = Math.abs(Math.sin(ud.peckPhase)) * 0.03;
    }
    let diff = ud.facing - chicken.rotation.y;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    chicken.rotation.y += diff * Math.min(1, dt * 8);
  }
}

function spawnRoomChickens(room) {
  room.chickens = [];
  const count = Math.max(1, Math.min(3, Math.round(room.tiles.size / 3)));
  const tilesArr = Array.from(room.tiles);
  for (let i = 0; i < count; i++) {
    const c = _createWanderChicken();
    const tile = tilesArr[i % tilesArr.length];
    const [tx, tz] = tile.split(',').map(Number);
    c.position.set(tx, 0, tz);
    c.userData.targetX = tx;
    c.userData.targetZ = tz;
    scene.add(c);
    room.chickens.push(c);
  }
}

function computeCentroid(tileSet) {
  let cx = 0, cz = 0;
  for (const k of tileSet) {
    const [x, z] = k.split(',').map(Number);
    cx += x; cz += z;
  }
  return { x: cx / tileSet.size, z: cz / tileSet.size };
}

function buildRoomFrom(tileSet, type) {
  const room = { type, tiles: tileSet, centroid: computeCentroid(tileSet) };
  const g = buildRoomCentralDecor(room);
  scene.add(g);
  room.group = g;
  if (type === ROOM_HATCHERY) spawnRoomChickens(room);
  rooms.push(room);
  return room;
}

function findRoomContaining(x, z) {
  const k = x + ',' + z;
  return rooms.find(r => r.tiles.has(k));
}

// After tiles change (add/remove), rebuild affected rooms. Simplest correct
// approach: for a given (x,z) plus its 4 neighbors, destroy any rooms that
// touch these cells, then re-scan connected components from those cells.
function rebuildRoomsAround(x, z) {
  const seeds = [[x, z], [x+1, z], [x-1, z], [x, z+1], [x, z-1]];

  // Find and destroy touching rooms
  const toDestroy = new Set();
  for (const [sx, sz] of seeds) {
    if (sx < 0 || sx >= GRID_SIZE || sz < 0 || sz >= GRID_SIZE) continue;
    const r = findRoomContaining(sx, sz);
    if (r) toDestroy.add(r);
  }
  for (const r of toDestroy) {
    disposeRoomVisuals(r);
    const idx = rooms.indexOf(r);
    if (idx >= 0) rooms.splice(idx, 1);
  }

  // Re-scan connected components from all seeds
  const visited = new Set();
  for (const [sx, sz] of seeds) {
    if (sx < 0 || sx >= GRID_SIZE || sz < 0 || sz >= GRID_SIZE) continue;
    const cell = grid[sx][sz];
    if (!cell.roomType) continue;
    const k = sx + ',' + sz;
    if (visited.has(k)) continue;
    const tiles = floodRoomTiles(sx, sz, cell.roomType);
    for (const t of tiles) visited.add(t);
    if (tiles.size > 0) buildRoomFrom(tiles, cell.roomType);
  }
}

// After a tile's room membership changes, its edge-stud pattern may differ,
// AND its neighbors' edge-stud patterns may differ too. Rebuild the per-tile
// prop for (x,z) and its same-type neighbors so studs match the new layout.
function refreshTileAndNeighborProps(x, z, roomType) {
  const targets = [[x, z], [x+1, z], [x-1, z], [x, z+1], [x, z-1]];
  for (const [tx, tz] of targets) {
    if (tx < 0 || tx >= GRID_SIZE || tz < 0 || tz >= GRID_SIZE) continue;
    const cell = grid[tx][tz];
    if (cell.roomType !== roomType) continue;
    // Rebuild this tile (creates a fresh mesh even if one didn't exist).
    // Gameplay state (treasury amount, lair ownership, hatchery depletion)
    // lives OUTSIDE the mesh, so it's safely preserved across rebuilds.
    rebuildTileMesh(tx, tz);
  }
}

// Rebuild one tile's prop, preserving gameplay state from the other sources.
function rebuildTileMesh(x, z) {
  const cell = grid[x][z];
  const rt = cell.roomType;
  if (!rt) return;
  if (cell.roomMesh) {
    scene.remove(cell.roomMesh);
    cell.roomMesh.traverse(o => {
      if (o.geometry && o.geometry.dispose &&
          o.geometry !== ROOM_FLOOR_GEO && o.geometry !== EDGE_STUD_GEO) {
        o.geometry.dispose();
      }
    });
  }
  let mesh = null;
  if      (rt === ROOM_TREASURY) mesh = buildTreasuryTile(x, z);
  else if (rt === ROOM_LAIR)     mesh = buildLairTile(x, z);
  else if (rt === ROOM_HATCHERY) mesh = buildHatcheryTile(x, z);
  cell.roomMesh = mesh;
  if (mesh) scene.add(mesh);

  // Reapply gameplay state to the fresh mesh
  if (rt === ROOM_TREASURY) {
    const tr = treasuries.find(t => t.x === x && t.z === z);
    if (tr) {
      tr.pile = mesh;
      updateGoldPile(mesh, tr.amount);
    }
  } else if (rt === ROOM_LAIR) {
    setLairOccupied(cell, !!cell.lairOwner);
  } else if (rt === ROOM_HATCHERY) {
    if (cell.depletedUntil && cell.depletedUntil > performance.now() / 1000) {
      if (mesh.userData.egg) mesh.userData.egg.visible = true;
    }
  }
}

// ============================================================
// ROOM DESIGNATION
// ============================================================
// A "room" is just a set of claimed-floor tiles sharing a roomType tag.
// Each designated tile gets a visual prop (pile, bed, patch) as a child of `scene`
// stored at cell.roomMesh. Treasury is functional (stores gold); lair and hatchery
// are visual-only until the creature system lands.

export function designateTile(x, z, roomType) {
  const cell = grid[x][z];
  if (cell.type !== T_CLAIMED) return false;       // only claimed floor is designatable
  if (cell.roomType === roomType) return false;    // already this type

  // Replace any existing designation (e.g. re-designating a lair as hatchery)
  if (cell.roomType) {
    const ok = undesignateTile(x, z);
    if (!ok) return false;                         // refused (e.g. non-empty treasury)
  }

  cell.roomType = roomType;
  // Treasury bookkeeping entry — pile reference filled in by the mesh rebuild below
  if (roomType === ROOM_TREASURY) {
    treasuries.push({ x, z, amount: 0, pile: null });
  }

  // Build this tile AND refresh neighbors — their edge studs change when a new
  // same-type tile appears beside them (interior corners should lose studs).
  refreshTileAndNeighborProps(x, z, roomType);
  // Room entities may have merged or been born; rebuild room-level decor
  rebuildRoomsAround(x, z);
  playSfx('confirm', { minInterval: 120 });
  return true;
}

export function undesignateTile(x, z) {
  const cell = grid[x][z];
  if (!cell.roomType) return false;
  // Refuse to undesignate a treasury that still holds gold — prevents silent loss.
  if (cell.roomType === ROOM_TREASURY) {
    const t = treasuries.find(t => t.x === x && t.z === z);
    if (t && t.amount > 0) return false;
  }

  const oldType = cell.roomType;

  if (cell.roomMesh) {
    scene.remove(cell.roomMesh);
    cell.roomMesh.traverse(o => {
      if (o.geometry && o.geometry.dispose &&
          o.geometry !== ROOM_FLOOR_GEO && o.geometry !== EDGE_STUD_GEO) {
        o.geometry.dispose();
      }
    });
    cell.roomMesh = null;
  }
  if (oldType === ROOM_TREASURY) {
    const idx = treasuries.findIndex(t => t.x === x && t.z === z);
    if (idx >= 0) treasuries.splice(idx, 1);
  } else if (oldType === ROOM_LAIR) {
    if (cell.lairOwner && cell.lairOwner.userData) {
      cell.lairOwner.userData.lair = null;
    }
    cell.lairOwner = null;
  } else if (oldType === ROOM_HATCHERY) {
    cell.depletedUntil = null;
  }
  cell.roomType = null;

  // Former neighbors may now have a new exposed edge — rebuild their studs.
  refreshTileAndNeighborProps(x, z, oldType);
  // Room may have shrunk, split, or disappeared.
  rebuildRoomsAround(x, z);
  return true;
}
