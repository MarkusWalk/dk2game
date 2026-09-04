// Dependency-free smoke coverage for renderer-independent Babylon systems.
// Run with: node tests/babylon-systems-smoke.mjs

import assert from 'node:assert/strict';

globalThis.window ||= { BABYLON: null };
globalThis.window.BABYLON ||= null;

const { EntitySpatialIndex, GridNavigator, NavigationService } = await import('../src/babylon/navigation.js');
const { WorkshopDirector } = await import('../src/babylon/workshop.js');
const {
  PersistenceDirector, SAVE_KIND, SAVE_VERSION, exportSaveGame,
  importSaveGame, validateSaveGame,
} = await import('../src/babylon/persistence.js');

function test(name, action) {
  try { action(); process.stdout.write(`ok - ${name}\n`); }
  catch (error) { process.stderr.write(`not ok - ${name}\n${error.stack}\n`); process.exitCode = 1; }
}

function gridWorld(size = 6) {
  const grid = Array.from({ length: size }, (_, x) => Array.from({ length: size }, (_, z) => ({
    x, z, type: 'claimed', room: null, discovered: true, visible: true, gold: 0, metadata: {},
  })));
  return {
    gridSize: size, grid, seed: 77, _dirty: false,
    getCell(x, z) { return grid[Math.round(x)]?.[Math.round(z)] || null; },
    isWalkable(x, z) { return Boolean(this.getCell(x, z)); },
  };
}

function makeImp(id = 'imp-1', x = 0, z = 0) {
  const scaling = { x: 1, y: 1, z: 1, set(xv, yv, zv) { this.x = xv; this.y = yv; this.z = zv; } };
  return {
    id, type: 'imp', faction: 'dungeon', hp: 38, maxHp: 38, damage: 3, attackRange: 1, speed: 2,
    attackInterval: 1, attackCooldown: 0, state: 'idle', previousState: 'idle', carryAmount: 0, autonomous: true,
    root: { position: { x, y: 0, z }, rotation: { y: 0 }, scaling, metadata: {}, getChildMeshes: () => [] },
    userData: {}, path: [], pathIndex: 0, destination: null, work: null, target: null,
  };
}

function entityStub(initial = []) {
  const values = new Map(initial.map((entity) => [entity.id, entity]));
  return {
    getAll: () => [...values.values()], list: (kind) => kind === 'imps' ? [...values.values()].filter((entity) => entity.type === 'imp') : [...values.values()],
    get: (id) => values.get(String(id)) || null, getById(id) { return this.get(id); },
    remove(entity) { return values.delete(entity.id); },
    spawn(type, options) {
      const entity = makeImp(String(options.id), options.x, options.z);
      Object.assign(entity, { type, faction: options.faction, hp: options.hp, maxHp: options.maxHp, damage: options.damage, attackRange: options.attackRange, speed: options.speed, attackInterval: options.attackInterval, state: options.state, autonomous: options.autonomous });
      entity.root.rotation.y = options.facing || 0; values.set(entity.id, entity); return entity;
    },
    moveTo(entity, destination, options = {}) { entity.root.position.x = destination.x; entity.root.position.z = destination.z; entity.state = options.state || entity.state; return true; },
    setState(entity, state) { entity.state = state; return true; },
    setCarrying(entity, amount) { entity.carryAmount = amount; return true; },
  };
}

function defenseStub() {
  const values = new Map();
  const make = (category, kind, x, z, options) => {
    const item = { id: String(options.id || `${category}-${values.size + 1}`), category, kind, x, z, faction: options.faction || 'dungeon', orientation: options.orientation || 'z', hp: options.hp ?? (category === 'door' ? 100 : 90), maxHp: options.maxHp ?? (category === 'door' ? 100 : 90), charges: options.charges ?? 0, maxCharges: options.maxCharges ?? 3, root: { dispose() {} } };
    values.set(item.id, item); return item;
  };
  return {
    _internalManufacturing: 500,
    list: () => [...values.values()], get: (id) => values.get(String(id)) || null,
    getManufacturing() { return this._internalManufacturing; },
    canPlaceDoor: () => ({ ok: true }), canPlaceTrap: () => ({ ok: true }),
    placeDoor(kind, x, z, options = {}) { return make('door', kind, x, z, options); },
    placeTrap(kind, x, z, options = {}) { return make('trap', kind, x, z, options); },
    repairDoor(door, amount, options = {}) { if (!door || !options.free) return false; door.hp = Math.min(door.maxHp, door.hp + amount); return amount; },
    reloadTrap(trap, options = {}) { if (!trap || !options.free) return false; trap.charges = trap.maxCharges; trap.reloading = true; return true; },
  };
}

class MemoryStorage {
  constructor() { this.data = new Map(); }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] || null; }
  getItem(key) { return this.data.get(key) || null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

test('navigation caches paths, honors frame budget, and spatial queries remain current', () => {
  const world = gridWorld();
  world.grid[2][0] = null;
  const navigator = new GridNavigator(world, { pathCacheLimit: 2 });
  const first = navigator.findPath({ x: 0, z: 0 }, { x: 4, z: 0 });
  assert.ok(first.length > 5, 'path routes around blocked cell');
  assert.ok(navigator.getCachedPath({ x: 0, z: 0 }, { x: 4, z: 0 }), 'path enters cache');
  first[0].x = 99;
  assert.equal(navigator.findPath({ x: 0, z: 0 }, { x: 4, z: 0 })[0].x, 0, 'cached paths are copied');

  const service = new NavigationService(world, { maxPathRequestsPerFrame: 1, maxFlowFieldsPerFrame: 1 });
  const one = service.requestPath({ x: 0, z: 1 }, { x: 5, z: 1 }, { cache: false });
  const two = service.requestPath({ x: 0, z: 2 }, { x: 5, z: 2 }, { cache: false });
  service.update();
  assert.equal(one.status, 'complete'); assert.equal(two.status, 'pending');
  service.update(); assert.equal(two.status, 'complete');

  const imp = makeImp('near', 1, 1); const hero = makeImp('hero', 4, 4); hero.faction = 'heroes';
  const index = new EntitySpatialIndex({ cellSize: 1 });
  index.sync([imp, hero]);
  assert.deepEqual(index.queryRadius({ x: 1, z: 1 }, 0.2).map((entity) => entity.id), ['near']);
  assert.equal(index.nearest({ x: 3.7, z: 3.7 }).id, 'hero');
  imp.root.position.x = 5; imp.root.position.z = 5; index.sync([imp, hero]);
  assert.equal(index.queryBounds(0, 0, 2, 2).length, 0, 'sync removes stale spatial buckets');
  service.dispose();
});

test('Workshop manufactures, crates, delivers, services, and refunds with headless stubs', () => {
  const world = gridWorld(4); world.getCell(1, 1).room = 'workshop';
  const imp = makeImp('imp-1', 1, 1); const entities = entityStub([imp]); const defenses = defenseStub();
  const runtime = { manufacturing: 500 };
  const workshop = new WorkshopDirector(runtime, world, entities, defenses, null, null, { workRatePerTile: 200, serviceDuration: 0.15 });
  assert.ok(workshop.orderDoor('ironwood', 2, 2));
  workshop.update(0.1); // manufacture + pick up crate
  assert.equal(workshop.listCrates().length, 1);
  workshop.update(0.1); // deliver to target
  assert.equal(workshop.listCrates().length, 0);
  const door = defenses.list().find((item) => item.category === 'door');
  assert.ok(door, 'finished crate is installed by Imp');

  door.hp = 30;
  const beforeRepair = runtime.manufacturing;
  assert.ok(workshop.requestRepair(door.id, 50));
  workshop.update(0.1); workshop.update(0.1); workshop.update(0.1);
  assert.equal(door.hp, 80, 'repair job is completed free after reservation');
  assert.ok(runtime.manufacturing < beforeRepair, 'repair consumes reserved work');

  const trap = defenses.placeTrap('spike', 3, 2, { id: 'trap-1', charges: 0, maxCharges: 3 });
  assert.ok(workshop.requestReload(trap.id));
  workshop.update(0.1); workshop.update(0.1); workshop.update(0.1);
  assert.equal(trap.charges, trap.maxCharges, 'reload service refills charges');

  door.hp = 10;
  const beforeFailedRepair = runtime.manufacturing;
  const failed = workshop.requestRepair(door.id, 30);
  const reserved = failed.reservedWork;
  defenses.list = () => []; defenses.get = () => null;
  workshop.update(0.1); workshop.update(0.1); workshop.update(0.1);
  assert.equal(runtime.manufacturing, beforeFailedRepair, 'failed service refunds all reserved work');
  assert.ok(reserved > 0);
  workshop.dispose();
});

test('Workshop releases unreachable jobs after a bounded timeout', () => {
  const world = gridWorld(4); world.getCell(1, 1).room = 'workshop';
  const imp = makeImp('imp-timeout', 1, 1); const entities = entityStub([imp]); const defenses = defenseStub();
  entities.moveTo = (entity, destination, options = {}) => { entity.state = options.state || entity.state; return true; };
  const runtime = { manufacturing: 500 };
  const workshop = new WorkshopDirector(runtime, world, entities, defenses, null, null, { jobTimeout: 5 });
  const door = defenses.placeDoor('ironwood', 3, 3, { id: 'door-timeout', hp: 20, maxHp: 100 });
  const before = runtime.manufacturing;
  assert.ok(workshop.requestRepair(door.id, 40));
  for (let index = 0; index < 52; index++) workshop.update(0.1);
  assert.equal(workshop.listJobs().length, 0, 'unreachable job is cancelled');
  assert.equal(imp.userData.workshopJobId, undefined, 'Imp reservation is released');
  assert.equal(runtime.manufacturing, before, 'reserved service work is refunded');
  workshop.dispose();
});

test('persistence round-trips through slots and rejects corrupt or incompatible saves', () => {
  const world = gridWorld(16); const imp = makeImp('imp-7', 0, 0); imp.userData.dkStatuses = { 'magic:haste': { remaining: 3, speedMultiplier: 1.5 } }; imp.userData.dkStatusBase = { speed: 2, damage: 3, faction: 'dungeon', maxHp: 38, scale: { x: 1, y: 1, z: 1 } };
  const entities = entityStub([imp]); entities._serial = 0;
  const defenses = defenseStub(); defenses._serial = 0;
  const door = defenses.placeDoor('ironwood', 1, 0, { id: 'door-9', hp: 70, maxHp: 100, locked: true }); door.locked = true;
  const state = { started: true, paused: false, elapsed: 42, wave: 2, nextWaveAt: 60, gold: 99, mana: 120, manaMax: 300, work: 50, research: 4, heartHp: 450, heartMaxHp: 500, mode: 'dig', quality: 'high', gameOver: null };
  const workshop = { serialize: () => ({ version: 1, queue: [{ id: 'blueprint-a' }] }), restore(data) { this.restored = data; } };
  const magic = { cooldowns: { createImp: 2 }, unlocked: new Set(['createImp']), researchTarget: null, researchProgress: {}, _infernos: [], possessed: null, maxMana: 300, spellbook: () => ({ createImp: { id: 'createImp' } }), releasePossession() {} };
  const runtime = { state, spells: magic, maxMana: 300 };
  let navigationInvalidations = 0;
  let restoredMode = null; let restoredQuality = null;
  const app = {
    world, entities, defenses, workshop, magic, state, runtime,
    navigation: { invalidate() { navigationInvalidations++; } },
    input: { setMode(mode) { restoredMode = mode; return true; } },
    setQuality(quality) { restoredQuality = quality; },
    snapshot: () => ({}),
  };
  const storage = new MemoryStorage(); const persistence = new PersistenceDirector(app, { storage, autosaveInterval: 1000 });
  assert.equal(persistence.saveSlot('slot1').ok, true);
  assert.deepEqual(persistence.listSlots(), ['slot1']);
  world.getCell(0, 0).type = 'lava'; state.gold = 0; entities.remove(imp); defenses.list().length = 0;
  assert.equal(persistence.loadSlot('slot1').ok, true);
  assert.equal(world.getCell(0, 0).type, 'claimed'); assert.equal(state.gold, 99);
  assert.equal(entities.get('imp-7').userData.dkStatuses['magic:haste'].remaining, 3);
  assert.equal(defenses.get('door-9').locked, true);
  assert.ok(entities._serial >= 7 && defenses._serial >= 9, 'restored ids advance director serials');
  assert.equal(navigationInvalidations, 1, 'restoring world invalidates cached navigation');
  assert.equal(restoredMode, 'dig'); assert.equal(restoredQuality, 'high');
  assert.equal(workshop.restored.queue[0].id, 'blueprint-a');
  assert.equal(importSaveGame('{bad json').ok, false, 'corrupt JSON is rejected');
  assert.equal(validateSaveGame({ kind: SAVE_KIND, version: SAVE_VERSION + 1, sections: {} }).ok, false, 'future saves are rejected');
  assert.equal(validateSaveGame({ version: 0, state: { gold: 5 }, world: { gridSize: 16, cells: [] } }).ok, true, 'v0 shape migrates');
  assert.equal(JSON.parse(exportSaveGame(app)).version, SAVE_VERSION);
  persistence.dispose();
});

if (!process.exitCode) process.stdout.write('Babylon systems smoke tests passed.\n');
