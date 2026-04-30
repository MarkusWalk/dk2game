// ============================================================
// CONSTANTS
// ============================================================
// All immutable config values live here so every module can import them by
// name. Tile type IDs, tunables, costs, speeds, room types, XP, spell costs —
// anything the original file `const`-declared at module scope.

export const GRID_SIZE = 64;
export const HEART_X = 32, HEART_Z = 32;
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
export const CREATURE_SPEED = 2.2;         // slower than imps (2.8) so they feel heavier (Fly baseline)
export const CREATURE_WANDER_SPEED = 1.4;  // lazy speed when just idling (Fly baseline)
export const PORTAL_SPAWN_INTERVAL = 22;   // seconds between spawns per claimed portal (was 14 — too fast)
export const PORTAL_MAX_SPAWN = 8;         // a single portal stops spawning after this many (was 10)
export const NEED_HUNGER_RATE = 1.0 / 60;   // full hunger bar fills in 60s  (0..1)
export const NEED_SLEEP_RATE  = 1.0 / 90;   // full sleep bar fills in 90s   (0..1)
export const NEED_CRITICAL = 0.85;          // above this, creature seeks the relevant room
export const NEED_SATISFIED = 0.15;         // below this after eating/sleeping, needs clear
export const EAT_DURATION = 3.0;            // seconds of eating at a hatchery tile
export const SLEEP_DURATION = 6.0;          // seconds of sleeping at a lair tile
export const HATCHERY_REGROW = 12.0;        // legacy: kept for any callers that still reference it
// Per-tile chicken pool — DK2-style. Each hatchery tile holds up to
// HATCHERY_TILE_CAP live chickens; eating consumes one. New chickens regrow
// every HATCHERY_REGROW_PER_CHICKEN seconds while under the cap.
export const HATCHERY_TILE_CAP = 3;
export const HATCHERY_REGROW_PER_CHICKEN = 18.0;
// Visual chicken meshes per hatchery room (perf cap so a giant hatchery
// doesn't render dozens of chickens — they wander the same animations).
export const HATCHERY_MAX_VISUAL_CHICKENS = 6;

// --- Species registry ---
// Each species has its own stats, speed, and favorite room. Fly remains the
// baseline (cheap skirmisher). Beetle = tank, Goblin = fast striker,
// Warlock = ranged glass cannon gated by a Library.
// `favoriteRoom` biases idle wandering so you can tell species apart at a glance.
export const SPECIES = {
  fly: {
    name: 'Fly', letter: 'F', color: 0x3a5528,
    hp: 32, atk: 6, atkCooldown: 0.8, atkRange: 0.8,
    speed: 2.2, wanderSpeed: 1.4,
    favoriteRoom: 'hatchery',
    spawnWeight: 5,
    fleeBelow: 0.40,              // HP fraction — skittish, flees early
    kiteMin: 0,                   // melee, no kiting
    decisionInterval: 1.2,        // seconds between AI re-evaluations
    commitPause: 0.25,            // seconds to face target before committing
    secondaryMove: { name: 'swarm dive', kind: 'dash',  learnedAt: 3, atk: 11, cooldown: 4.0, range: 1.0 },
  },
  beetle: {
    name: 'Beetle', letter: 'B', color: 0x3a2818,
    hp: 60, atk: 3, atkCooldown: 1.1, atkRange: 0.9,
    speed: 1.6, wanderSpeed: 1.0,
    favoriteRoom: 'lair',
    spawnWeight: 3,
    fleeBelow: 0.0,               // stoic, never retreats
    kiteMin: 0,
    decisionInterval: 3.0,        // slow, deliberate
    commitPause: 0.5,
    secondaryMove: { name: 'shell ram', kind: 'ram', learnedAt: 3, atk: 8,  cooldown: 5.0, range: 1.0 },
  },
  goblin: {
    name: 'Goblin', letter: 'G', color: 0x4a6020,
    hp: 22, atk: 5, atkCooldown: 0.6, atkRange: 0.8,
    speed: 2.9, wanderSpeed: 1.9,
    favoriteRoom: 'training',
    spawnWeight: 4,
    fleeBelow: 0.30,
    kiteMin: 0,
    decisionInterval: 0.8,        // twitchy, re-plans often
    commitPause: 0.15,
    secondaryMove: { name: 'cheap shot', kind: 'crit', learnedAt: 3, atk: 11, cooldown: 3.0, range: 0.9 },
  },
  warlock: {
    name: 'Warlock', letter: 'W', color: 0x4a2850,
    hp: 24, atk: 7, atkCooldown: 1.2, atkRange: 3.0,
    speed: 1.8, wanderSpeed: 1.2,
    favoriteRoom: 'library',
    spawnWeight: 2,
    requiresRoom: 'library',
    fleeBelow: 0.50,              // glass cannon, bolts early
    kiteMin: 1.8,                 // if enemy closer than this, back off
    decisionInterval: 2.0,
    commitPause: 0.35,
    secondaryMove: { name: 'chain zap', kind: 'chain', learnedAt: 3, atk: 9, cooldown: 4.5, range: 3.0 },
  },
  troll: {
    name: 'Troll', letter: 'T', color: 0x5a4a2a,
    hp: 40, atk: 4, atkCooldown: 1.3, atkRange: 0.9,
    speed: 1.4, wanderSpeed: 0.9,
    favoriteRoom: 'workshop',
    spawnWeight: 2,
    requiresRoom: 'workshop',     // only spawn once a Workshop exists
    fleeBelow: 0.25,
    kiteMin: 0,
    decisionInterval: 2.5,
    commitPause: 0.4,
    secondaryMove: { name: 'cleave', kind: 'cleave', learnedAt: 3, atk: 6, cooldown: 5.0, range: 1.2 },
  },
  skeleton: {
    name: 'Skeleton', letter: 'S', color: 0xd0c8b0,
    hp: 28, atk: 5, atkCooldown: 0.9, atkRange: 0.85,
    speed: 1.9, wanderSpeed: 1.2,
    favoriteRoom: 'lair',
    spawnWeight: 0,                // never rolled by portals — only created via prison starvation
    fleeBelow: 0.0,                // undead, no fear
    kiteMin: 0,
    decisionInterval: 1.6,
    commitPause: 0.25,
    secondaryMove: { name: 'bone shatter', kind: 'crit', learnedAt: 3, atk: 10, cooldown: 3.5, range: 0.85 },
  },
  vampire: {
    name: 'Vampire', letter: 'V', color: 0x401020,
    hp: 48, atk: 9, atkCooldown: 1.0, atkRange: 1.0,
    speed: 2.2, wanderSpeed: 1.4,
    favoriteRoom: 'lair',
    spawnWeight: 0,                // never rolled by portals — only torture-converted
    fleeBelow: 0.20,
    kiteMin: 0,
    decisionInterval: 1.4,
    commitPause: 0.3,
    secondaryMove: { name: 'lifesteal', kind: 'lifesteal', learnedAt: 3, atk: 12, cooldown: 4.0, range: 1.0 },
  },
  biledemon: {
    name: 'Bile Demon', letter: 'D', color: 0x507030,
    hp: 78, atk: 6, atkCooldown: 1.4, atkRange: 1.0,
    speed: 1.4, wanderSpeed: 0.85,
    favoriteRoom: 'hatchery',
    spawnWeight: 2,
    fleeBelow: 0.0,                // glutton, doesn't flee
    kiteMin: 0,
    decisionInterval: 2.8,
    commitPause: 0.5,
    secondaryMove: { name: 'poison cloud', kind: 'cleave', learnedAt: 3, atk: 4, cooldown: 4.5, range: 1.6 },
  },
  mistress: {
    name: 'Mistress', letter: 'M', color: 0x802040,
    hp: 36, atk: 8, atkCooldown: 0.7, atkRange: 1.1,
    speed: 2.5, wanderSpeed: 1.6,
    favoriteRoom: 'training',
    spawnWeight: 2,
    requiresRoom: 'training',
    fleeBelow: 0.10,               // masochist — fights through pain
    kiteMin: 0,
    decisionInterval: 1.0,
    commitPause: 0.2,
    secondaryMove: { name: 'whip combo', kind: 'crit', learnedAt: 3, atk: 14, cooldown: 3.0, range: 1.1 },
  },
  darkknight: {
    name: 'Dark Knight', letter: 'K', color: 0x281828,
    hp: 90, atk: 11, atkCooldown: 1.1, atkRange: 1.0,
    speed: 1.8, wanderSpeed: 1.1,
    favoriteRoom: 'training',
    spawnWeight: 1,
    requiresRoom: 'training',
    fleeBelow: 0.05,
    kiteMin: 0,
    decisionInterval: 1.8,
    commitPause: 0.3,
    secondaryMove: { name: 'sundering blow', kind: 'cleave', learnedAt: 3, atk: 9, cooldown: 4.0, range: 1.3 },
  },
};

// Distress + help-seeking — creatures alert each other to nearby threats.
export const DISTRESS_RADIUS = 5.0;         // tiles — who hears the call
export const DISTRESS_TTL = 4.0;            // seconds — how long the signal is fresh
export const DISTRESS_MAX_RESPONDERS = 3;   // cap swarm to this many nearest friends

// Per-species affinities. Positive = friends (calm near each other), negative = enemies
// (gain anger faster when close). v1 is sparse — only notable pairs.
// Read as AFFINITY[a][b]; unspecified pairs are neutral (0).
export const AFFINITY = {
  fly:     { beetle:  0,  goblin: -1, warlock:  0,  troll:  0 },
  beetle:  { fly:     0,  goblin:  1, warlock: -1,  troll:  1 },
  goblin:  { fly:    -1,  beetle:  1, warlock: -1,  troll: -1 },
  warlock: { fly:     0,  beetle: -1, goblin: -1,  troll:  0 },
  troll:   { fly:     0,  beetle:  1, goblin: -1,  warlock: 0 },
};

// Work duration in seconds per job type
export const WORK_DURATIONS = { dig: 1.8, claim: 0.9, reinforce: 1.3, claim_wall: 1.5 };

// Job type priority (lower index = higher priority). Aggressive expansion (claim_wall)
// outranks passive fortification (reinforce): imps push into enemy territory first.
export const JOB_PRIORITY = ['dig', 'claim', 'claim_wall', 'reinforce'];

// Room types — stored as grid[x][z].roomType. null means plain claimed floor.
export const ROOM_TREASURY = 'treasury';
export const ROOM_LAIR     = 'lair';
export const ROOM_HATCHERY = 'hatchery';
export const ROOM_TRAINING = 'training';   // creatures standing on tiles gain XP
export const ROOM_LIBRARY  = 'library';    // warlocks here generate research points
export const ROOM_WORKSHOP = 'workshop';   // trolls here generate manufacturing points
export const ROOM_PRISON   = 'prison';     // captured heroes wait in cages here
export const ROOM_TORTURE  = 'torture';    // prisoners moved here flip allegiance
export const TREASURY_CAPACITY = 300;  // max gold per treasury tile

// Prison + Torture conversion loop. A defeated hero flagged as
// `ud.captureCandidate` is dragged to a free prison tile by an imp. After
// PRISON_STARVE_DURATION seconds in a cage, the hero starves and a Skeleton
// spawns. If the player drops the prisoner onto a torture tile instead, after
// TORTURE_DURATION it converts into a Vampire on your side.
export const PRISON_STARVE_DURATION = 35;   // seconds caged before skeleton hatch
export const TORTURE_DURATION       = 25;   // seconds on rack before vampire flip

// Training / Library gameplay constants
export const TRAINING_XP_PER_SEC = 1;        // base XP/sec standing on training tiles
export const TRAINING_LARGE_SIZE = 9;        // room size ≥ this counts as "Large" (2x)
export const LIBRARY_RESEARCH_PER_SEC = 0.6; // research points Warlocks generate per second
export const WORKSHOP_MFG_PER_SEC = 0.8;     // manufacturing points Trolls generate per sec

// --- Doors / Traps ---
// Manufacturing costs in points. A lone Troll in a Small Workshop produces
// ~0.8 pts/sec → a wooden door in ~12 s, spike trap in ~9 s.
export const DOOR_WOOD_COST      = 10;
export const DOOR_STEEL_COST     = 30;
export const TRAP_SPIKE_COST     = 7;
export const TRAP_LIGHTNING_COST = 20;

// Door HP (hero axe-chops the door before moving through).
// Wood ≈ 3 s at hero DPS 4/s = 12 HP; Steel ≈ 8 s = 32 HP. Rounded for feel.
export const DOOR_WOOD_HP   = 15;
export const DOOR_STEEL_HP  = 40;

// Trap tunables
export const TRAP_SPIKE_DMG         = 20;
export const TRAP_LIGHTNING_DMG     = 15;
export const TRAP_LIGHTNING_AOE     = 1.8;   // tile radius
export const TRAP_LIGHTNING_COOLDOWN = 10;   // seconds between triggers
export const TRAP_TRIGGER_RADIUS    = 0.5;   // hero must be this close to tile center

export const PREVIEW_COLORS = {
  dig:         0xe8a018,   // warm orange (matches marker)
  treasury:    0xffcc44,   // gold (brighter than floor — reads as highlight)
  lair:        0x9070c0,   // violet
  hatchery:    0x70a030,   // brighter grass
  training:    0xd04030,   // rusted blood-iron
  library:     0x7080ff,   // arcane cobalt
  workshop:    0xffa040,   // forge orange
  prison:      0x6a6a78,   // iron-bar grey
  torture:     0x602030,   // blood-rusted crimson
  door_wood:   0xc88a40,   // wood tan
  door_steel:  0xa0b0c0,   // steel blue-gray
  trap_spike:  0xc0c0c8,   // metal spikes
  trap_lightning: 0xc0e0ff, // electric blue
  hand:        0xe0c8a8,   // warm hand-glow for drop preview
  lightning:   0xc0e0ff,   // ice-blue (spell cursor)
  heal:        0x80ff90,   // healing green (spell cursor)
  callToArms:  0xff6040,   // warm rally red (spell cursor)
  haste:       0xffe040,   // fast yellow (spell cursor)
  createImp:   0xff8050,   // imp-skin orange
  possess:     0xa040d0,   // arcane purple (target picker)
  sight:       0xc0a0ff,   // pale violet (reveal pulse)
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

// --- Hero archetypes (Phase 5) ---
// Archer: ranged, fragile. Priest: heals allies in aura. Dwarf: slow tank,
// beelines for Treasury instead of heart (plunder behavior).
export const HERO_HP_ARCHER   = 18;
export const HERO_ATK_ARCHER  = 4;
export const HERO_RANGE_ARCHER = 5.0;  // shoots from 5 tiles
export const HERO_HP_PRIEST   = 22;
export const HERO_ATK_PRIEST  = 2;
export const HERO_HEAL_PRIEST = 5;     // HP/sec to adjacent heroes
export const HERO_HEAL_RADIUS_PRIEST = 2.5;
export const HERO_HP_DWARF    = 50;
export const HERO_ATK_DWARF   = 6;
export const HERO_SPEED_DWARF = 1.1;   // slow but sturdy
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

// ============================================================
// HERO COMPOUNDS — DK2-style multi-chamber strongholds.
// ============================================================
// Each compound is laid out via a template grid. Glyph legend:
//   W = T_ENEMY_WALL  (outer + inner walls)
//   . = T_ENEMY_FLOOR (walkable interior)
//   K = T_ENEMY_FLOOR + spawn knight
//   A = T_ENEMY_FLOOR + spawn archer
//   P = T_ENEMY_FLOOR + spawn priest
//   D = T_ENEMY_FLOOR + spawn dwarf
//   B = T_ENEMY_FLOOR + spawn boss (Knight Commander)
//   G = T_ENEMY_FLOOR + drop a gold pile (treasure room loot)
// Templates have their door at the bottom-center; HERO_COMPOUNDS rotates them
// via `rotation` (0..3, 90° CW each) so the door faces the heart.
export const HERO_TERRITORY_RADIUS = 6;

export const COMPOUND_TEMPLATES = {
  // 7×6 — gatehouse + barracks split. 2 heroes.
  small: [
    'WWWWWWW',
    'W..K..W',
    'W.WWW.W',
    'W.....W',
    'W..A..W',
    'WW.W.WW',
  ],
  // 9×8 — 3 sub-rooms (gatehouse / barracks / treasure) divided by inner walls.
  // 3 heroes + 1 gold pile.
  medium: [
    'WWWWWWWWW',
    'W..W..G.W',
    'W.K.W.A.W',
    'W.W.W.W.W',
    'W.W...W.W',
    'W.W.P.W.W',
    'W.......W',
    'WWWW.WWWW',
  ],
  // 11×11 — throne room (boss) flanked by barracks, with treasury alcoves.
  // Boss + 2 knights + 1 archer + 2 gold piles.
  boss: [
    'WWWWWWWWWWW',
    'W.........W',
    'W..WWWWW..W',
    'W..W.G.W..W',
    'W..W.B.W..W',
    'W..WW.WW..W',
    'W.K.....A.W',
    'W.........W',
    'W.W.....W.W',
    'W.K..G..K.W',
    'WWWW...WWWW',
  ],
};

// Per-compound placement. `cx, cz` are the centroid; `template` selects the
// template; `rotation` is 0..3 (rotation × 90° CW) and is chosen so the door
// faces the heart for that quadrant.
export const HERO_COMPOUNDS = [
  // NE quadrant — heart is SW; rotate 90° so door faces west (toward heart).
  { id: 'ne', cx: 50, cz: 14, template: 'small',  rotation: 1 },
  // NW quadrant — heart is SE; rotate 270° so door faces east.
  { id: 'nw', cx: 14, cz: 14, template: 'small',  rotation: 3 },
  // SE quadrant — heart is NW; rotate 180° so door faces north.
  { id: 'se', cx: 50, cz: 50, template: 'medium', rotation: 2 },
  // SW quadrant — heart is NE; rotate 180° so door faces north.
  { id: 'sw', cx: 14, cz: 50, template: 'medium', rotation: 2 },
  // Boss compound — far south; rotate 180° so door faces north (toward heart).
  { id: 'boss', cx: 32, cz: 55, template: 'boss', rotation: 2 },
];

// Legacy export kept so nothing breaks if someone still imports the old name.
export const HERO_LAIRS = HERO_COMPOUNDS;

// ============================================================
// NEUTRAL POCKETS — abandoned dungeon chambers scattered between compounds.
// ============================================================
// Each pocket is a small (3-4 tile) pre-carved T_FLOOR room buried in rock,
// sometimes with a gold pile or a few gold-vein tiles around it. The player
// discovers them by digging — they read as "oh nice, there's already a room
// here" instead of "this map is just a bag of rocks."
export const NEUTRAL_POCKETS = [
  { cx: 32, cz: 12, size: 3, gold: 240 },   // due north
  { cx: 32, cz: 50, size: 4, gold: 360 },   // due south (just before boss)
  { cx: 52, cz: 32, size: 3, gold: 240 },   // due east
  { cx: 12, cz: 32, size: 3, gold: 240 },   // due west
  { cx: 42, cz: 22, size: 2, gold: 120 },   // NE midway
  { cx: 22, cz: 42, size: 2, gold: 120 },   // SW midway
];

// IMP
export const IMP_SPEED = 2.8;
export const IMP_SPAWN_MANA_COST = 25;  // mana paid per auto-respawn (was 40 gold)
export const IMP_SPAWN_DELAY = 10;      // seconds between respawns
export const IMP_MIN_COUNT   = 4;

// MANA — generated by claimed tiles, spent on spells + imp respawn.
// 0.2/s/tile means a modest 30-tile dungeon trickles 6 mana/sec — a Lightning
// (30) every 5s if you do nothing else. Bigger empires get more spells.
export const MANA_PER_CLAIMED_TILE_PER_SEC = 0.20;
export const MANA_BASE_REGEN_PER_SEC       = 1.0;   // baseline so an unclaimed dungeon still trickles
export const MANA_MAX                      = 200;
export const MANA_START                    = 50;

// Pay-day cycle — global wage event. Every PAY_DAY_INTERVAL seconds the
// payDay tick forces every creature overdue so they queue at a treasury.
// Creatures who can't get paid (no gold) gain anger fast (UNPAID rate).
export const PAY_DAY_INTERVAL = 180;
export const PAY_DAY_BANNER_DURATION = 4;

// Anger threshold for leaving the dungeon. A creature whose happiness stays
// below LEAVING_HAPPINESS for LEAVING_TIMEOUT seconds packs up and walks to
// the nearest claimed portal, dissolving into it (same fade as kick-out).
export const LEAVING_HAPPINESS = 0.20;
export const LEAVING_TIMEOUT   = 18;

// Sight of Evil — click anywhere to reveal an AoE on the fog-of-war for
// SIGHT_DURATION seconds. Tiles inside the radius commit to permanent-
// discovered. Pairs with the Cartograph minimap for scouting.
export const SPELL_SIGHT_MANA     = 25;
export const SPELL_SIGHT_COOLDOWN = 4;
export const SPELL_SIGHT_RADIUS   = 6;
export const SPELL_SIGHT_DURATION = 8;

// Possession — first-person ride along a player creature. Cheap and uncapped
// in duration; the player ends it manually with Escape (or the creature dies).
export const SPELL_POSSESS_MANA     = 35;
export const SPELL_POSSESS_COOLDOWN = 6;
export const POSSESS_CAM_HEIGHT     = 0.95;   // eye-level
export const POSSESS_CAM_FORWARD    = 0.05;   // tiny offset so model isn't clipped
export const POSSESS_MOVE_SPEED     = 3.6;    // tiles/sec, faster than wander
export const POSSESS_TURN_SPEED     = 2.4;    // rad/sec
export const POSSESS_ATTACK_RANGE   = 1.2;    // melee swing reach in possession

// Spell research — research points required to unlock each spell.
// Cheaper utility first (heal); buffs/aoe last (callToArms). Library drains
// researchProgress[target] at LIBRARY_RESEARCH_PER_SEC (×2 in large libraries)
// while a Warlock idles inside.
export const SPELL_RESEARCH_COST = {
  heal:       30,
  createImp:  50,
  sight:      40,
  lightning:  90,
  haste:      120,
  callToArms: 180,
  possess:    150,
};

// XP / Levels
export const LEVEL_CAP_CREATURE   = 5;
export const LEVEL_CAP_IMP        = 4;
export const XP_PER_HERO_KILL     = 22;
export const XP_PER_BOSS_KILL     = 120;
export const XP_PER_DIG           = 2;
export const XP_PER_CLAIM         = 1;

// Spells — costs are in mana now (see MANA_* above). Mana regenerates from
// claimed tiles, so a bigger dungeon casts more spells. Cooldowns are still
// the primary throttle; mana sets the long-run budget.
export const SPELL_LIGHTNING_MANA     = 30;
export const SPELL_LIGHTNING_COOLDOWN = 5.0;
export const SPELL_LIGHTNING_DMG      = 40;
export const SPELL_LIGHTNING_AOE      = 1.8;   // tile radius
export const SPELL_HEAL_MANA          = 15;
export const SPELL_HEAL_COOLDOWN      = 3.0;
export const SPELL_HEAL_AMOUNT        = 25;
export const SPELL_CTA_MANA           = 40;    // call to arms
export const SPELL_CTA_COOLDOWN       = 18.0;
export const SPELL_CTA_DURATION       = 20.0;  // rally flag lives this long
export const SPELL_CTA_RANGE          = 10;    // tile radius to pull idle creatures from
export const SPELL_HASTE_MANA         = 20;
export const SPELL_HASTE_COOLDOWN     = 8.0;
export const SPELL_HASTE_DURATION     = 5.0;   // seconds of +50% speed/atk
// Create Imp — manual override on top of auto-respawn, lets you scale the
// workforce above IMP_MIN_COUNT for digging surges. Mana-priced same as auto
// (25) so the choice is *when* to spend, not *whether* it's cheaper.
export const SPELL_CREATE_IMP_MANA    = 25;
export const SPELL_CREATE_IMP_COOLDOWN = 4.0;

// Room designation gold cost per tile. Charged on the drag-paint commit; only
// tiles that actually convert (modeAlreadyApplied=false) are billed.
// Rebalanced 2026-04-29: original 50/75/100 made even small rooms unaffordable
// against the 250-gold start. Halved + start raised to 500 so the player can
// stand up a treasury, a lair, and a hatchery in the opening minutes.
export const ROOM_COST_PER_TILE = {
  treasury: 25,
  lair:     25,
  hatchery: 35,
  training: 50,
  library:  50,
  workshop: 50,
  prison:   60,   // bars and chains aren't cheap
  torture:  80,   // specialist gear — the most expensive room
};

// Waves
export const WAVE_INTERVAL_BASE = 85;    // seconds between waves after the first (was 60)
export const WAVE_WARN_LEAD = 6;         // seconds of warning before a wave

// Per-wave composition tables. Each wave picks a weighted party. Units are
// archetype keys resolved in heroes.js spawnHeroByKind. Difficulty ramps by
// adding more units and unlocking archers → priests → dwarves.
//
// Guarantee: at least one healer every 3 waves once priests are unlocked.
export const WAVE_TABLES = [
  // Wave 1 — tutorial (1 knight)
  [ { units: ['knight'], w: 1 } ],
  // Wave 2 — two knights OR one archer scout
  [
    { units: ['knight', 'knight'], w: 3 },
    { units: ['knight', 'archer'], w: 2 },
  ],
  // Wave 3 — archer pair common
  [
    { units: ['knight', 'archer', 'archer'], w: 3 },
    { units: ['knight', 'knight', 'archer'], w: 2 },
  ],
  // Wave 4 — dwarf debut (greed run on treasury)
  [
    { units: ['knight', 'archer', 'priest'],  w: 3 },
    { units: ['dwarf', 'knight', 'archer'],   w: 2 },
  ],
  // Wave 5 — priest guaranteed mid-run
  [
    { units: ['knight', 'knight', 'archer', 'priest'], w: 3 },
    { units: ['dwarf', 'knight', 'archer', 'archer'],  w: 2 },
  ],
  // Wave 6 — bigger parties
  [
    { units: ['knight', 'knight', 'archer', 'archer', 'priest'], w: 3 },
    { units: ['dwarf', 'dwarf', 'knight', 'archer'],             w: 2 },
  ],
  // Wave 7 — real threat
  [
    { units: ['knight', 'knight', 'archer', 'archer', 'priest'], w: 2 },
    { units: ['dwarf', 'knight', 'archer', 'priest', 'knight'],  w: 3 },
  ],
  // Wave 8 — large party, mix everything
  [
    { units: ['dwarf', 'knight', 'knight', 'archer', 'archer', 'priest'], w: 3 },
  ],
  // Wave 9 — pre-boss muscle
  [
    { units: ['dwarf', 'dwarf', 'knight', 'archer', 'archer', 'priest'], w: 3 },
    { units: ['knight', 'knight', 'archer', 'archer', 'priest', 'priest'], w: 2 },
  ],
];

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
