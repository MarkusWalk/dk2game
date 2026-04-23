// ============================================================
// MATERIALS — shared Three.js Materials + key Geometries
// ============================================================
// Centralised so emissive pulses (RUNE_MAT / SEAM_MAT / LAIR_RUNE_MAT / etc.)
// drive EVERY instance via a single mutation per frame. Anything cloned is
// cloned at the call site (rock tiles subtly shade their cloned ROCK_MAT).

const THREE = window.THREE;

// ---------- Rock / floor ----------
export const ROCK_GEO = (() => {
  const g = new THREE.BoxGeometry(1, 1.15, 1, 2, 2, 2);
  // jitter top vertices for rocky irregularity
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.4) {
      pos.setX(i, pos.getX(i) + (Math.random() - 0.5) * 0.12);
      pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * 0.12);
      pos.setY(i, pos.getY(i) + (Math.random() - 0.5) * 0.18);
    }
  }
  g.computeVertexNormals();
  return g;
})();

export const FLOOR_GEO = new THREE.BoxGeometry(1, 0.08, 1);

export const ROCK_MAT = new THREE.MeshStandardMaterial({
  color: 0x6a4a32, roughness: 0.95, metalness: 0.05, flatShading: true
});
export const GOLD_MAT = new THREE.MeshStandardMaterial({
  color: 0x8a6820, roughness: 0.55, metalness: 0.45,
  emissive: 0x6a4800, emissiveIntensity: 0.35, flatShading: true
});
export const FLOOR_MAT = new THREE.MeshStandardMaterial({
  color: 0x1a100a, roughness: 1.0
});
export const CLAIMED_MAT = new THREE.MeshStandardMaterial({
  color: 0x8a1818, roughness: 0.78,
  emissive: 0x4a0606, emissiveIntensity: 0.55
});

// Reinforced wall — shorter than rock so it reads as "worked masonry", dark cool color,
// prominent brass studs, a large glowing rune on top, and a red seam around the mid-section.
export const REINFORCED_GEO = new THREE.BoxGeometry(1, 0.92, 1);
export const REINFORCED_MAT = new THREE.MeshStandardMaterial({
  color: 0x181620, roughness: 0.45, metalness: 0.55,
  emissive: 0x080408, emissiveIntensity: 0.25, flatShading: true
});
export const STUD_GEO = new THREE.CylinderGeometry(0.13, 0.15, 0.16, 8);
export const STUD_MAT = new THREE.MeshStandardMaterial({
  color: 0xb08840, roughness: 0.22, metalness: 1.0,
  emissive: 0x3a1808, emissiveIntensity: 0.4
});
export const RUNE_MAT = new THREE.MeshStandardMaterial({
  color: 0xff4820, emissive: 0xff2808, emissiveIntensity: 3.2
});
export const SEAM_MAT = new THREE.MeshStandardMaterial({
  color: 0xff2810, emissive: 0xff1808, emissiveIntensity: 1.5,
  transparent: true, opacity: 0.85
});

// Enemy faction — cool blue palette to contrast with your warm red
export const ENEMY_FLOOR_MAT = new THREE.MeshStandardMaterial({
  color: 0x1a1844, roughness: 0.8,
  emissive: 0x0a0a2a, emissiveIntensity: 0.45
});
export const ENEMY_WALL_MAT = new THREE.MeshStandardMaterial({
  color: 0x0c1028, roughness: 0.45, metalness: 0.55,
  emissive: 0x040418, emissiveIntensity: 0.25, flatShading: true
});
export const ENEMY_STUD_MAT = new THREE.MeshStandardMaterial({
  color: 0x708090, roughness: 0.22, metalness: 1.0,
  emissive: 0x18283a, emissiveIntensity: 0.4
});
export const ENEMY_RUNE_MAT = new THREE.MeshStandardMaterial({
  color: 0x3080ff, emissive: 0x2060ff, emissiveIntensity: 3.2
});
export const ENEMY_SEAM_MAT = new THREE.MeshStandardMaterial({
  color: 0x2060ff, emissive: 0x1848ff, emissiveIntensity: 1.5,
  transparent: true, opacity: 0.85
});

// Portal materials — neutral (gray-purple, dormant) and claimed (red, active)
export const PORTAL_NEUTRAL_BASE_MAT = new THREE.MeshStandardMaterial({
  color: 0x14101a, roughness: 0.7, emissive: 0x0a0812, emissiveIntensity: 0.3
});
export const PORTAL_NEUTRAL_INNER_MAT = new THREE.MeshStandardMaterial({
  color: 0x4040a0, emissive: 0x3030a0, emissiveIntensity: 1.5, roughness: 0.5
});
export const PORTAL_NEUTRAL_SWIRL_MAT = new THREE.MeshStandardMaterial({
  color: 0x6060c0, emissive: 0x5050b0, emissiveIntensity: 2.2,
  transparent: true, opacity: 0.8
});
export const PORTAL_CLAIMED_BASE_MAT = new THREE.MeshStandardMaterial({
  color: 0x201010, roughness: 0.7, emissive: 0x200808, emissiveIntensity: 0.5
});
export const PORTAL_CLAIMED_INNER_MAT = new THREE.MeshStandardMaterial({
  color: 0xff4020, emissive: 0xff3010, emissiveIntensity: 2.5, roughness: 0.4
});
export const PORTAL_CLAIMED_SWIRL_MAT = new THREE.MeshStandardMaterial({
  color: 0xff6040, emissive: 0xff4010, emissiveIntensity: 3.0,
  transparent: true, opacity: 0.85
});

// ============================================================
// ROOM-LEVEL MATERIALS
// ============================================================
// Full-tile floor plate — no gap — so adjacent tiles merge visually.
export const ROOM_FLOOR_GEO = new THREE.BoxGeometry(1.0, 0.03, 1.0);

// TREASURY
export const TREASURY_FLOOR_MAT = new THREE.MeshStandardMaterial({
  color: 0x6a4a18, roughness: 0.55, metalness: 0.35,
  emissive: 0x2a1c08, emissiveIntensity: 0.4, flatShading: true
});
export const TREASURY_STUD_MAT = new THREE.MeshStandardMaterial({
  color: 0xffcc44, emissive: 0xaa7820, emissiveIntensity: 0.8,
  metalness: 1.0, roughness: 0.25
});
export const COIN_MAT = new THREE.MeshStandardMaterial({
  color: 0xffcc44, emissive: 0xffaa22, emissiveIntensity: 0.35,
  metalness: 0.85, roughness: 0.28, flatShading: true
});
export const CHEST_WOOD_MAT = new THREE.MeshStandardMaterial({
  color: 0x4a2a14, roughness: 0.85, metalness: 0.1, flatShading: true
});
export const CHEST_BAND_MAT = new THREE.MeshStandardMaterial({
  color: 0x2a1a10, roughness: 0.6, metalness: 0.7, flatShading: true
});
export const GEM_MATS = [
  new THREE.MeshStandardMaterial({ color: 0xff3050, emissive: 0xff1030, emissiveIntensity: 1.8, metalness: 0.6, roughness: 0.2 }),
  new THREE.MeshStandardMaterial({ color: 0x30c0ff, emissive: 0x1080ff, emissiveIntensity: 1.8, metalness: 0.6, roughness: 0.2 }),
  new THREE.MeshStandardMaterial({ color: 0x40ff60, emissive: 0x10c030, emissiveIntensity: 1.5, metalness: 0.6, roughness: 0.2 }),
  new THREE.MeshStandardMaterial({ color: 0xd060ff, emissive: 0xa020ff, emissiveIntensity: 1.6, metalness: 0.6, roughness: 0.2 }),
];
export const TREASURY_INLAY_MAT = new THREE.MeshStandardMaterial({
  color: 0xffcc44, emissive: 0xffa820, emissiveIntensity: 1.2,
  metalness: 0.9, roughness: 0.25, transparent: true, opacity: 0.9
});

// LAIR
export const LAIR_FLOOR_MAT = new THREE.MeshStandardMaterial({
  color: 0x2a1f3a, roughness: 0.8, metalness: 0.15,
  emissive: 0x1a0f2a, emissiveIntensity: 0.55, flatShading: true
});
export const LAIR_STUD_MAT = new THREE.MeshStandardMaterial({
  color: 0x3a2a52, roughness: 0.4, metalness: 0.85,
  emissive: 0x201630, emissiveIntensity: 0.5
});
export const LAIR_RUNE_MAT = new THREE.MeshStandardMaterial({
  color: 0xb070ff, emissive: 0xa060ff, emissiveIntensity: 2.2
});
export const LAIR_COCOON_MAT = new THREE.MeshStandardMaterial({
  color: 0x2a1f3a, roughness: 0.7, metalness: 0.1,
  emissive: 0x150a28, emissiveIntensity: 0.4, flatShading: true
});
export const LAIR_SILK_MAT = new THREE.MeshStandardMaterial({
  color: 0xc8b8e0, roughness: 0.3, metalness: 0.5,
  emissive: 0x5848a0, emissiveIntensity: 0.45,
  transparent: true, opacity: 0.75
});
export const LAIR_PUPA_MAT = new THREE.MeshStandardMaterial({
  color: 0xa060ff, emissive: 0x9050ff, emissiveIntensity: 1.8
});
// Decor materials
export const RUG_MAT = new THREE.MeshStandardMaterial({
  color: 0x6a2030, roughness: 0.9, emissive: 0x2a0a10, emissiveIntensity: 0.2,
  flatShading: true
});
export const RUG_TRIM_MAT = new THREE.MeshStandardMaterial({
  color: 0xa08040, roughness: 0.6, metalness: 0.4, flatShading: true
});
export const BONE_MAT = new THREE.MeshStandardMaterial({
  color: 0xe8dcc0, roughness: 0.75, flatShading: true
});
export const WATER_MAT = new THREE.MeshStandardMaterial({
  color: 0x203848, roughness: 0.1, metalness: 0.4,
  emissive: 0x10202a, emissiveIntensity: 0.3,
  transparent: true, opacity: 0.85
});
export const BOWL_MAT = new THREE.MeshStandardMaterial({
  color: 0x2a1a18, roughness: 0.85, flatShading: true
});
export const BRAZIER_MAT = new THREE.MeshStandardMaterial({
  color: 0x3a2a20, roughness: 0.6, metalness: 0.6, flatShading: true
});
export const EMBER_MAT = new THREE.MeshStandardMaterial({
  color: 0xff6020, emissive: 0xff4010, emissiveIntensity: 2.4, roughness: 0.4
});

// HATCHERY — darker, mossier/swampier palette than original grass-green
export const HATCHERY_FLOOR_MAT = new THREE.MeshStandardMaterial({
  color: 0x2a3318, roughness: 0.95,
  emissive: 0x121808, emissiveIntensity: 0.3, flatShading: true
});
export const HATCHERY_STUD_MAT = new THREE.MeshStandardMaterial({
  color: 0x5a4828, roughness: 0.8, metalness: 0.3, flatShading: true
});
export const HATCHERY_INLAY_MAT = new THREE.MeshStandardMaterial({
  color: 0x9ab050, emissive: 0x405020, emissiveIntensity: 0.8,
  transparent: true, opacity: 0.85
});
export const HATCHERY_GRASS_MAT = new THREE.MeshStandardMaterial({
  color: 0x506028, emissive: 0x1a2408, emissiveIntensity: 0.25, roughness: 0.85, flatShading: true
});
export const STRAW_MAT = new THREE.MeshStandardMaterial({
  color: 0xc8a048, roughness: 0.9, flatShading: true
});
export const WOOD_MAT = new THREE.MeshStandardMaterial({
  color: 0x4a3020, roughness: 0.9, flatShading: true
});
export const MUD_MAT = new THREE.MeshStandardMaterial({
  color: 0x2a1a10, roughness: 1.0, flatShading: true
});
export const FEED_MAT = new THREE.MeshStandardMaterial({
  color: 0xc89848, roughness: 0.85, flatShading: true
});
export const CHICKEN_BODY_MAT = new THREE.MeshStandardMaterial({
  color: 0xf0e8d8, roughness: 0.85, flatShading: true
});
export const CHICKEN_BEAK_MAT = new THREE.MeshStandardMaterial({
  color: 0xffa830, roughness: 0.6
});
export const CHICKEN_COMB_MAT = new THREE.MeshStandardMaterial({
  color: 0xc83028, emissive: 0x601010, emissiveIntensity: 0.4, roughness: 0.6, flatShading: true
});
export const EGG_SHELL_MAT = new THREE.MeshStandardMaterial({
  color: 0xf4ead6, roughness: 0.55, metalness: 0.1,
  emissive: 0x3a2e1a, emissiveIntensity: 0.25, flatShading: true
});
export const EGG_SPOT_MAT = new THREE.MeshStandardMaterial({
  color: 0xb08040, roughness: 0.7, flatShading: true
});

// Shared reinforced-wall aesthetic echo — small corner studs every room edge
export const EDGE_STUD_GEO = new THREE.IcosahedronGeometry(0.045, 0);

// ============================================================
// CREATURE / FLY MATERIALS
// ============================================================
export const FLY_BODY_MAT = new THREE.MeshStandardMaterial({
  color: 0x3a5528, roughness: 0.5, metalness: 0.2, flatShading: true
});
export const FLY_WING_MAT = new THREE.MeshStandardMaterial({
  color: 0xa8c890, emissive: 0x607040, emissiveIntensity: 0.4,
  transparent: true, opacity: 0.55, side: THREE.DoubleSide, flatShading: true
});
export const FLY_EYE_MAT = new THREE.MeshStandardMaterial({
  color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 2.5
});

// Need-icon materials — shared so we can pulse them globally
export const NEED_HUNGER_MAT = new THREE.MeshStandardMaterial({
  color: 0xff5040, emissive: 0xff3020, emissiveIntensity: 2.0,
  transparent: true, opacity: 0.95
});
export const NEED_SLEEP_MAT = new THREE.MeshStandardMaterial({
  color: 0x40a0ff, emissive: 0x3080ff, emissiveIntensity: 2.0,
  transparent: true, opacity: 0.95
});

// ============================================================
// HERO MATERIALS
// ============================================================
export const HERO_ARMOR_MAT = new THREE.MeshStandardMaterial({
  color: 0x8090a8, roughness: 0.45, metalness: 0.75, flatShading: true
});
export const HERO_CLOTH_MAT = new THREE.MeshStandardMaterial({
  color: 0x506478, roughness: 0.85, flatShading: true
});
export const HERO_SKIN_MAT = new THREE.MeshStandardMaterial({
  color: 0xc09878, roughness: 0.75, flatShading: true
});
export const HERO_SWORD_MAT = new THREE.MeshStandardMaterial({
  color: 0xe0e8f0, emissive: 0x405068, emissiveIntensity: 0.3,
  metalness: 0.95, roughness: 0.2
});
export const HERO_HILT_MAT = new THREE.MeshStandardMaterial({
  color: 0x604020, roughness: 0.85
});
export const HERO_SHIELD_MAT = new THREE.MeshStandardMaterial({
  color: 0xa04030, roughness: 0.7, metalness: 0.3, flatShading: true
});
export const HERO_SHIELD_TRIM_MAT = new THREE.MeshStandardMaterial({
  color: 0xe8c460, metalness: 0.9, roughness: 0.3
});

// ============================================================
// HP BAR + FLOATING UI MATERIALS
// ============================================================
export const HP_BAR_GEO = new THREE.PlaneGeometry(1, 0.12);
export const HP_BAR_BG_MAT = new THREE.MeshBasicMaterial({ color: 0x1a0a08, transparent: true, opacity: 0.85, depthTest: false });
export const HP_BAR_FILL_MAT = new THREE.MeshBasicMaterial({ color: 0xd04040, transparent: true, opacity: 0.95, depthTest: false });
export const HP_BAR_FILL_HERO_MAT = new THREE.MeshBasicMaterial({ color: 0xff5030, transparent: true, opacity: 0.95, depthTest: false });
export const HP_BAR_FILL_BOSS_MAT = new THREE.MeshBasicMaterial({ color: 0xc01020, transparent: true, opacity: 0.98, depthTest: false });

// ============================================================
// PREVIEW / HAND / SPELL MATERIALS
// ============================================================
export const PREVIEW_GEO = new THREE.PlaneGeometry(0.96, 0.96);
export const PREVIEW_MAT = new THREE.MeshBasicMaterial({
  color: 0xffb030, transparent: true, opacity: 0.5,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
});

export const HAND_GLOW_MAT = new THREE.MeshBasicMaterial({
  color: 0xffd88c, transparent: true, opacity: 0.4,
  blending: THREE.AdditiveBlending, depthWrite: false
});
export const DROP_RING_GEO = new THREE.RingGeometry(0.3, 0.45, 24);
export const DROP_RING_MAT = new THREE.MeshBasicMaterial({
  color: 0xffd88c, transparent: true, opacity: 0.7,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
});
