// ============================================================
// STATE — mutable shared state
// ============================================================
// Every mutable array / object the game threads through its loops. Other
// modules import these and mutate them in place. Because arrays are
// mutated (never reassigned), ES-module live-binding is preserved.
//
// Scalar mutable state is exposed as fields on single exported objects
// (e.g. `GAME.over = true`) so mutations are visible cross-module.

import { HEART_MAX_HP, CAM_DEFAULTS, HEART_X, HEART_Z, MANA_START, MANA_MAX } from './constants.js';

export const grid = [];       // grid[x][z] = { type, mesh, marker, goldAmount, roomType, roomMesh }
export const imps = [];
export const jobs = [];       // { x, z, claimedBy: null, progress: 0 }
export const treasuries = []; // { x, z, amount, pile }
export const creatures = [];  // { mesh, userData: {state, needs, path, …} }
export const portals = [];    // { x, z, claimed, mesh, spawnTimer, spawnedCount }
export const heroes = [];     // hostile invaders seeking the heart
export const levelBadges = []; // { target, sprite, mat, tex, canvas, level, yOffset, xOffset }
export const rooms = [];
export const stats = {
  goldTotal: 500, tilesDug: 0, tilesClaimed: 0, wallsReinforced: 0,
  wallsCaptured: 0, creatures: 0,
  research: 0,      // lifetime Library research points (readout only)
  manufacturing: 0, // accumulated Workshop manufacturing points — Trolls grind them
  mana: MANA_START, manaMax: MANA_MAX,  // regenerates from claimed tiles; spent on spells + imps
  // Spell research — DK2-style. All spells start locked; the Library drains
  // researchProgress[target] until it hits SPELL_RESEARCH_COST[target], at
  // which point the spell becomes castable.
  spellsResearched: { lightning: false, heal: false, callToArms: false, haste: false, createImp: false, possess: false },
  researchTarget: null,   // which spell is currently being researched ("heal" etc.) or null
  researchProgress: { lightning: 0, heal: 0, callToArms: 0, haste: 0, createImp: 0, possess: 0 },
};

// Sim-time clock — accumulates `dt` (which is clamped to 50 ms in the loop) so
// it never jumps when the tab is hidden and resumes. Anything with sim
// semantics (commitUntil, hasteUntil, depletedUntil, etc.) reads this instead
// of `performance.now()` so a stall doesn't desync those checks from the
// dt-driven counters around them. Mutable scalar wrapped in an object so
// mutations are visible cross-module.
export const sim = { time: 0 };

// Active dig markers — replaces the per-frame 30×30 grid scan in animate().
// markForDig() pushes; unmarkTile() removes. Each entry is the marker mesh,
// which has .position.x/z to address its grid cell.
export const markersList = [];

// Visual effect arrays — the animation loop iterates these to tick particles.
export const goldBursts = [];
export const pulses = [];
export const sparkBursts = [];
export const torches = [];
export const droppedGold = []; // { x, z, amount, age, mesh }
export const hpBars = [];      // { mesh, target, fill, maxScale, hideUntilHurt }
export const floatingDamageNumbers = []; // { mesh, vy, life, maxLife }
export const _lightningBolts = [];

// Phase 5 — spatial defense
export const doors = [];       // { x, z, kind: 'wood'|'steel', hp, maxHp, mesh, userData }
export const traps = [];       // { x, z, kind: 'spike'|'lightning', armed, cooldown, mesh }

// Invasion / combat state
// Heroes are pre-placed in HERO_LAIRS at game start (no timed waves). The fields
// below are kept so HUD and unrelated systems don't break; nextWaveAt=Infinity
// means the legacy wave path is effectively dead.
export const invasion = {
  waveNumber: 0,        // repurposed: count of breached lairs (HUD badge)
  nextWaveAt: Infinity,
  warnUntil: 0,
  warnShown: false,
  started: false,
  boss: null,           // populated when boss lair is breached
};
export const GAME = {
  over: false,
  won: false,
  // Menu / pause state. `started` flips true after the start screen's "New
  // Game" button. `paused` is set whenever any modal screen is up.
  started: false,
  paused: true,
  menuOpen: 'start',   // 'start' | 'pause' | 'about' | null
};

// Captured heroes occupying prison/torture tiles. Each entry is the original
// hero Group, repurposed: faction is flipped to 'prisoner', AI is suspended,
// and a per-prisoner timer drives the conversion outcome.
export const prisoners = [];

// Pay-day cycle. Replaces the per-creature rolling 90s pay window with a
// global wage event every PAY_DAY_INTERVAL seconds — when it fires, every
// living creature's paySince is forced overdue so they path to a treasury.
export const payDay = {
  lastAt: 0,        // sim.time of last pay-day event
  nextAt: 180,      // sim.time of next pay-day event (set on init)
  bannerUntil: 0,   // sim.time until which the PAY DAY banner is visible
  unpaidCount: 0,   // tally of creatures who didn't get paid last cycle
};

// Creature info panel target — the creature whose stats the right-side panel
// is rendering. null = panel hidden.
export const infoPanel = { target: null };

// Spell cooldown tracking — updated by spells.js, read by UI
export const spells = {
  lightning:  { lastCast: -999 },
  heal:       { lastCast: -999 },
  callToArms: { lastCast: -999 },
  haste:      { lastCast: -999 },
  createImp:  { lastCast: -999 },
  possess:    { lastCast: -999 },
};

// Possession state — populated when the Possess spell rides a creature.
// `target` is the creature group; `prevCam` snapshots iso camera so we can
// restore on exit.
export const possession = {
  active: false,
  target: null,
  prevCam: null,    // { yaw, distance, height, zoomMul, targetX, targetZ }
  yaw: 0,           // first-person yaw (radians)
  attackCooldown: 0,
};

// Active Call to Arms rally flag — one at a time. `expiresAt` is perf-time seconds.
export const rally = { active: false, x: 0, z: 0, expiresAt: 0, mesh: null };

// Build mode is mutable — exported inside an object so cross-module reads
// always see the current value (imports of plain `let` exports would be
// live-bound; the object wrapper matches that semantics on the assign side).
export const buildModeRef = { value: 'dig' };

// Drag-select state (populated by input.js)
export const dragState = {
  isDragging: false,
  dragStart: null,
  dragCurrent: null,
};
export const previewMeshes = new Map(); // "x,z" -> mesh
export const previewPool = [];

// Hand of Keeper state
export const handState = {
  heldEntity: null,     // imp or creature Group currently in the hand
  dropIndicator: null,  // ring mesh on the drop-target tile
  handPointerTile: null // last tile the pointer hovered in hand mode
};

// Camera control state
export const cameraControls = {
  target: { x: HEART_X, z: HEART_Z },
  yaw: CAM_DEFAULTS.yaw,
  zoomMul: 1.0,
  distance: CAM_DEFAULTS.distance,
  height: CAM_DEFAULTS.height,
};
export const camKeys = new Set();

// Shared across imp-respawn; using an object so modules can mutate the timer.
export const impRespawn = { timer: 0 };

// The dungeon heart — populated by init.js once createDungeonHeart runs.
export const heartRef = { heart: null };

// Spell button cache (populated lazily by hud / spells code)
export const spellBtnRefs = { cache: null };
