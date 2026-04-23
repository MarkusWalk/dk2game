// ============================================================
// CONSTANTS
// ============================================================
// All immutable config values live here so every module can import them by
// name. Tile type IDs, tunables, costs, speeds, room types, XP, spell costs —
// anything the original file `const`-declared at module scope.

export const GRID_SIZE = 30;
export const HEART_X = 15, HEART_Z = 15;
export const INITIAL_RADIUS = 2;

export const T_ROCK   = 0;
export const T_FLOOR  = 1;
export const T_CLAIMED = 2;
export const T_HEART  = 3;
export const T_GOLD   = 4;
export const T_REINFORCED = 5;
export const T_ENEMY_FLOOR = 6;  // Enemy's claimed floor (blue)
export const T_ENEMY_WALL  = 7;  // Enemy's reinforced wall (blue rune)
export const T_PORTAL_NEUTRAL = 8;  // Unclaimed portal (gray swirl) — walkable
export const T_PORTAL_CLAIMED = 9;  // Claimed portal (red swirl) — spawns creatures — walkable

// --- Creatures ---
export const CREATURE_SPEED = 2.2;         // slower than imps (2.8) so they feel heavier
export const CREATURE_WANDER_SPEED = 1.4;  // lazy speed when just idling
export const PORTAL_SPAWN_INTERVAL = 14;   // seconds between spawns per claimed portal (was 16)
export const PORTAL_MAX_SPAWN = 10;        // a single portal stops spawning after this many (was 6)
export const NEED_HUNGER_RATE = 1.0 / 60;   // full hunger bar fills in 60s  (0..1)
export const NEED_SLEEP_RATE  = 1.0 / 90;   // full sleep bar fills in 90s   (0..1)
export const NEED_CRITICAL = 0.85;          // above this, creature seeks the relevant room
export const NEED_SATISFIED = 0.15;         // below this after eating/sleeping, needs clear
export const EAT_DURATION = 3.0;            // seconds of eating at a hatchery tile
export const SLEEP_DURATION = 6.0;          // seconds of sleeping at a lair tile
export const HATCHERY_REGROW = 12.0;        // seconds for a depleted hatchery tile to recover

// Work duration in seconds per job type
export const WORK_DURATIONS = { dig: 1.8, claim: 0.9, reinforce: 1.3, claim_wall: 1.5 };

// Job type priority (lower index = higher priority). Aggressive expansion (claim_wall)
// outranks passive fortification (reinforce): imps push into enemy territory first.
export const JOB_PRIORITY = ['dig', 'claim', 'claim_wall', 'reinforce'];

// Room types — stored as grid[x][z].roomType. null means plain claimed floor.
// Only 'treasury' has gameplay effect currently; 'lair' and 'hatchery' are visual
// placeholders until creatures are added (they'll drive sleep and food respectively).
export const ROOM_TREASURY = 'treasury';
export const ROOM_LAIR     = 'lair';
export const ROOM_HATCHERY = 'hatchery';
export const TREASURY_CAPACITY = 300;  // max gold per treasury tile

export const PREVIEW_COLORS = {
  dig:       0xe8a018,   // warm orange (matches marker)
  treasury:  0xffcc44,   // gold (brighter than floor — reads as highlight)
  lair:      0x9070c0,   // violet
  hatchery:  0x70a030,   // brighter grass
  hand:      0xe0c8a8,   // warm hand-glow for drop preview
  lightning: 0xc0e0ff,   // ice-blue (spell cursor)
  heal:      0x80ff90,   // healing green (spell cursor)
};

// Treasury tiles (offsets from heart) — inner diagonals + outer edge diagonals
export const TREASURY_POSITIONS = [
  [-1, -1], [1, -1], [-1, 1], [1, 1],
  [-2, -1], [2, -1], [-2, 1], [2, 1]
];
export const TREASURY_PILE_VISUAL_CAP = 300; // pile stops growing visually past this

// ============================================================
// INVASION / COMBAT CONSTANTS
// ============================================================
export const FACTION_PLAYER = 'player';
export const FACTION_HERO   = 'hero';

export const HEART_MAX_HP    = 750;
export const HERO_HP_KNIGHT  = 28;
export const HERO_ATK_KNIGHT = 5;
export const HERO_SPEED      = 1.7;   // tiles/sec
export const HERO_ATK_RANGE  = 0.8;
export const HERO_ATK_COOLDOWN = 1.25;
export const HERO_ATK_HEART  = 7;     // damage/sec while adjacent to heart (was 10 — was too punishing)
export const HERO_SIGHT      = 4.5;
export const CREATURE_HP_FLY = 32;
export const CREATURE_ATK_FLY = 6;
export const CREATURE_ATK_COOLDOWN = 0.8;
export const CREATURE_ATK_RANGE = 0.8;
export const IMP_HP = 20;

// Boss (Knight Commander) — final boss, rebalanced so you can actually win
export const BOSS_HP             = 260;
export const BOSS_ATK            = 11;
export const BOSS_ATK_HEART      = 14;   // was 22 — obliterated the heart in seconds
export const BOSS_SPEED          = 1.3;
export const BOSS_ATK_COOLDOWN   = 1.4;
export const BOSS_ATK_RANGE      = 1.0;
export const BOSS_SIGHT          = 5.5;
export const FINAL_WAVE          = 10;

// IMP
export const IMP_SPEED = 2.8;
export const IMP_SPAWN_COST  = 40;
export const IMP_SPAWN_DELAY = 10;      // seconds between respawns
export const IMP_MIN_COUNT   = 4;

// XP / Levels
export const LEVEL_CAP_CREATURE   = 5;
export const LEVEL_CAP_IMP        = 4;
export const XP_PER_HERO_KILL     = 22;
export const XP_PER_BOSS_KILL     = 120;
export const XP_PER_DIG           = 2;
export const XP_PER_CLAIM         = 1;

// Spells
export const SPELL_LIGHTNING_COST     = 200;
export const SPELL_LIGHTNING_COOLDOWN = 5.0;
export const SPELL_LIGHTNING_DMG      = 40;
export const SPELL_LIGHTNING_AOE      = 1.8;   // tile radius
export const SPELL_HEAL_COST          = 100;
export const SPELL_HEAL_COOLDOWN      = 3.0;
export const SPELL_HEAL_AMOUNT        = 25;

// Waves
export const WAVE_INTERVAL_BASE = 85;    // seconds between waves after the first (was 60)
export const WAVE_WARN_LEAD = 6;         // seconds of warning before a wave

// Camera
export const CAM_DEFAULTS = {
  yaw: Math.PI / 4,                // classic iso 45°
  distance: 22 * Math.sqrt(2),     // horizontal offset from target
  height: 22,                      // vertical offset
};
export const CAM_ZOOM_MIN = 0.5;
export const CAM_ZOOM_MAX = 2.5;
export const CAM_PAN_MARGIN = 4;          // tiles beyond grid you may pan to see the edge
export const ISO_ZOOM_LANDSCAPE = 14;

// Work beacon colors — color-coded per job type so you can tell at a glance what's happening.
export const BEACON_COLORS = { dig: 0xff9030, claim: 0xff2844, reinforce: 0xff5020, claim_wall: 0x40a0ff };
