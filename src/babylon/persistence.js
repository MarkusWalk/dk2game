// ============================================================
// BABYLON SAVE / LOAD PERSISTENCE
// ============================================================
// This module deliberately knows about simulation data, not Babylon scene
// objects.  It can be imported by main.js when save/load UI is added, but is
// also useful to tests and embedders through its pure serialize/validate API.

export const SAVE_KIND = 'dungeon-heart-babylon-save';
export const SAVE_VERSION = 1;
export const STORAGE_PREFIX = 'dungeon-heart.babylon.save.';
export const DEFAULT_AUTOSAVE_SLOT = 'autosave';

const MAX_SAVE_BYTES = 8 * 1024 * 1024;
const MAX_CELLS = 128 * 128;
const MAX_ENTITIES = 512;
const MAX_DEFENSES = 512;
const MAX_STATUSES = 48;
const TILE_TYPES = new Set(['rock', 'earth', 'claimed', 'reinforced', 'gold', 'water', 'lava', 'portal', 'heart']);
const ROOM_TYPES = new Set(['treasury', 'lair', 'hatchery', 'training', 'library', 'prison', 'torture', 'workshop', 'temple']);
const SAFE_STATE_KEYS = Object.freeze([
  'started', 'paused', 'elapsed', 'wave', 'nextWaveAt', 'gold', 'mana',
  'manaMax', 'work', 'research', 'heartHp', 'heartMaxHp', 'mode', 'quality',
]);
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function finite(value, fallback = 0, min = -Infinity, max = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
function text(value, fallback = '', max = 96) {
  return typeof value === 'string' ? value.slice(0, max) : fallback;
}
function point(value, fallback = { x: 0, y: 0, z: 0 }) {
  const source = value?.root?.position || value?.position || value || fallback;
  return { x: finite(source.x, fallback.x, -2048, 2048), y: finite(source.y, fallback.y, -2048, 2048), z: finite(source.z, fallback.z, -2048, 2048) };
}
function copyJson(value, depth = 0) {
  if (depth > 8 || value == null) return null;
  if (typeof value === 'string') return value.slice(0, 512);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 128).map((item) => copyJson(item, depth + 1)).filter((item) => item !== undefined);
  if (!plain(value)) return undefined;
  const result = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    const copied = copyJson(item, depth + 1);
    if (copied !== undefined) result[key] = copied;
  }
  return result;
}
function asList(value) { return Array.isArray(value) ? value : []; }
function numericSuffix(value) {
  const match = String(value || '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}
function slotName(slot) {
  const name = String(slot || DEFAULT_AUTOSAVE_SLOT);
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(name)) throw new Error('Save slot must contain only letters, numbers, underscores, or hyphens.');
  return name;
}
function contextOf(context) { return typeof context === 'function' ? context() : context; }
function entityList(entities) { return entities?.getAll?.() || entities?.list?.() || []; }
function defenseList(defenses) { return defenses?.list?.() || [...(defenses?.doors?.values?.() || []), ...(defenses?.traps?.values?.() || [])]; }

function serializeStatuses(entity) {
  const data = entity?.userData || {};
  const statuses = Object.create(null);
  let count = 0;
  for (const [key, status] of Object.entries(data.dkStatuses || {})) {
    if (++count > MAX_STATUSES || typeof key !== 'string' || !plain(status)) break;
    const value = copyJson(status);
    if (value && finite(value.remaining, 0, 0, 86400) > 0) {
      value.remaining = finite(value.remaining, 0, 0, 86400);
      statuses[key.slice(0, 128)] = value;
    }
  }
  const base = plain(data.dkStatusBase) ? copyJson(data.dkStatusBase) : null;
  return { statuses, base };
}

function serializeWorld(context) {
  const world = context?.world;
  if (!world?.grid || !Number.isFinite(world.gridSize)) return null;
  const cells = [];
  for (const column of world.grid) for (const cell of column || []) {
    if (!cell) continue;
    cells.push({
      x: finite(cell.x, 0, 0, 127), z: finite(cell.z, 0, 0, 127),
      type: text(cell.type, 'rock', 24), room: cell.room ? text(cell.room, '', 32) : null,
      discovered: Boolean(cell.discovered), visible: Boolean(cell.visible), gold: finite(cell.gold, 0, 0, 1e9),
    });
  }
  return { gridSize: finite(world.gridSize, 64, 16, 128), seed: finite(world.seed, 1337, 0, 0xffffffff), cells };
}

function serializeEconomy(context) {
  const state = context?.state || context?.runtime?.state || {};
  const values = Object.create(null);
  for (const key of SAFE_STATE_KEYS) if (key in state && key !== 'gameOver') values[key] = copyJson(state[key]);
  // The visible game-over object can contain arbitrary UI state; preserve only
  // its stable boolean so corrupt/old UI snapshots can never block a load.
  values.gameOver = state.gameOver ? { victory: Boolean(state.gameOver.victory) } : null;
  return values;
}

function serializeEntities(context) {
  return entityList(context?.entities).slice(0, MAX_ENTITIES).map((entity) => {
    const status = serializeStatuses(entity);
    return {
      id: text(String(entity.id), '', 128), type: text(entity.type, 'imp', 48), faction: text(entity.faction, 'dungeon', 48),
      position: point(entity), facing: finite(entity.root?.rotation?.y, 0, -Math.PI * 2, Math.PI * 2),
      state: text(entity.state, 'idle', 48), previousState: text(entity.previousState, 'idle', 48),
      hp: finite(entity.hp, 1, 0, 1e6), maxHp: finite(entity.maxHp, 1, 1, 1e6), damage: finite(entity.damage, 1, 0, 1e5),
      attackRange: finite(entity.attackRange, 1, 0, 128), speed: finite(entity.speed, 1, 0, 128),
      attackInterval: finite(entity.attackInterval, 0.9, 0.05, 120), attackCooldown: finite(entity.attackCooldown, 0, 0, 120),
      carryAmount: finite(entity.carryAmount, 0, 0, 1e9), autonomous: entity.autonomous !== false,
      targetId: entity.target?.id ? text(String(entity.target.id), '', 128) : null,
      destination: entity.destination ? point(entity.destination) : null,
      path: asList(entity.path).slice(0, 256).map((item) => point(item)), pathIndex: finite(entity.pathIndex, 0, 0, 256),
      work: entity.work ? { action: text(entity.work.action, 'dig', 48), x: finite(entity.work.x, 0, 0, 127), z: finite(entity.work.z, 0, 0, 127), duration: finite(entity.work.duration, 1.5, 0.05, 600), elapsed: finite(entity.work.elapsed, 0, 0, 600) } : null,
      statuses: status.statuses, statusBase: status.base,
    };
  }).filter((entity) => entity.id);
}

function serializeDefenses(context) {
  return defenseList(context?.defenses).slice(0, MAX_DEFENSES).map((item) => ({
    id: text(String(item.id), '', 128), category: item.category === 'door' ? 'door' : 'trap', kind: text(item.kind, '', 48),
    x: finite(item.x, 0, 0, 127), z: finite(item.z, 0, 0, 127), faction: text(item.faction, 'dungeon', 48),
    orientation: text(item.orientation, 'z', 1), hp: finite(item.hp, 1, 0, 1e6), maxHp: finite(item.maxHp, 1, 1, 1e6),
    placedCost: finite(item.placedCost, 0, 0, 1e6), locked: Boolean(item.locked), manual: ['open', 'closed'].includes(item.manual) ? item.manual : null,
    openAmount: finite(item.openAmount, 0, 0, 1), attackClock: finite(item.attackClock, 0, 0, 120), retaliateClock: finite(item.retaliateClock, 0, 0, 120),
    broken: Boolean(item.broken), destroyClock: finite(item.destroyClock, 0, 0, 120), armed: Boolean(item.armed), armClock: finite(item.armClock, 0, 0, 120),
    cooldown: finite(item.cooldown, 0, 0, 120), charges: finite(item.charges, 0, 0, 10000), maxCharges: finite(item.maxCharges, 0, 0, 10000),
    reloading: Boolean(item.reloading), reloadClock: finite(item.reloadClock, 0, 0, 120), pendingCharges: finite(item.pendingCharges, 0, 0, 10000),
  })).filter((item) => item.id && item.kind);
}

function serializeWorkshop(context) {
  const workshop = context?.workshop || context?.runtime?.workshop;
  // Preserve both the authoritative economy pool and physical logistics.
  const state = context?.state || context?.runtime?.state || {};
  return {
    manufacturing: finite(context?.defenses?.getManufacturing?.() ?? state.work, 0, 0, 1e9),
    state: workshop?.serialize?.() ? copyJson(workshop.serialize()) : copyJson(workshop?.state || workshop?.snapshot?.() || null),
  };
}

function serializeMagic(context) {
  const magic = context?.magic || context?.runtime?.spells;
  if (!magic) return null;
  return {
    cooldowns: copyJson(magic.cooldowns || {}), unlocked: Array.from(magic.unlocked || []).map((name) => text(name, '', 64)).filter(Boolean),
    researchTarget: magic.researchTarget ? text(magic.researchTarget, '', 64) : null, researchProgress: copyJson(magic.researchProgress || {}),
    infernos: asList(magic._infernos).slice(0, 32).map((zone) => ({ x: finite(zone.x, 0, 0, 127), z: finite(zone.z, 0, 0, 127), radius: finite(zone.radius, 3, 0.1, 32), remaining: finite(zone.remaining, 0, 0, 600), tick: finite(zone.tick, 0, -10, 10), owner: text(zone.owner, 'dungeon', 48) })),
    possessedId: magic.possessed?.id ? text(String(magic.possessed.id), '', 128) : null,
  };
}

export const DEFAULT_ADAPTERS = Object.freeze({
  world: { serialize: serializeWorld, restore: restoreWorld },
  economy: { serialize: serializeEconomy, restore: restoreEconomy },
  entities: { serialize: serializeEntities, restore: restoreEntities },
  defenses: { serialize: serializeDefenses, restore: restoreDefenses },
  workshop: { serialize: serializeWorkshop, restore: restoreWorkshop },
  magic: { serialize: serializeMagic, restore: restoreMagic },
});

export function createSaveGame(context, options = {}) {
  const current = contextOf(context);
  const adapters = { ...DEFAULT_ADAPTERS, ...(options.adapters || {}) };
  const sections = Object.create(null);
  for (const [name, adapter] of Object.entries(adapters)) {
    if (!adapter?.serialize) continue;
    try { sections[name] = copyJson(adapter.serialize(current, options)); }
    catch (error) { if (options.strict) throw error; sections[name] = null; }
  }
  return { kind: SAVE_KIND, version: SAVE_VERSION, savedAt: new Date().toISOString(), sections };
}

export function exportSaveGame(context, options = {}) {
  const json = JSON.stringify(createSaveGame(context, options));
  if (json.length > MAX_SAVE_BYTES) throw new Error('Save is too large to export.');
  return json;
}

function migrateV0(save) {
  const source = plain(save) ? save : {};
  return {
    kind: SAVE_KIND, version: SAVE_VERSION, savedAt: text(source.savedAt, new Date().toISOString(), 64),
    sections: {
      world: source.world || source.sections?.world || null,
      economy: source.economy || source.state || source.sections?.economy || null,
      entities: source.entities || source.sections?.entities || [],
      defenses: source.defenses || source.sections?.defenses || [],
      workshop: source.workshop || source.sections?.workshop || null,
      magic: source.magic || source.spells || source.sections?.magic || null,
    },
  };
}

export function migrateSaveGame(input) {
  let save = typeof input === 'string' ? JSON.parse(input) : input;
  if (!plain(save)) throw new Error('Save is not an object.');
  if (save.kind && save.kind !== SAVE_KIND) throw new Error('Save belongs to another game.');
  let version = Number.isInteger(save.version) ? save.version : 0;
  if (version > SAVE_VERSION) throw new Error(`Save version ${version} is newer than this game.`);
  while (version < SAVE_VERSION) {
    if (version === 0) save = migrateV0(save);
    else throw new Error(`No migration exists for save version ${version}.`);
    version = save.version;
  }
  return save;
}

export function validateSaveGame(input) {
  try {
    const save = migrateSaveGame(input);
    if (!plain(save.sections)) throw new Error('Save has no sections.');
    const world = save.sections.world;
    if (world != null && (!plain(world) || !Array.isArray(world.cells) || world.cells.length > MAX_CELLS)) throw new Error('World cells are invalid.');
    for (const key of ['entities', 'defenses']) {
      const entries = save.sections[key];
      const max = key === 'entities' ? MAX_ENTITIES : MAX_DEFENSES;
      if (entries != null && (!Array.isArray(entries) || entries.length > max || entries.some((entry) => !plain(entry)))) throw new Error(`${key} are invalid.`);
    }
    return { ok: true, save };
  } catch (error) { return { ok: false, reason: String(error?.message || error) }; }
}

export function importSaveGame(json) {
  if (typeof json !== 'string' || json.length > MAX_SAVE_BYTES) return { ok: false, reason: 'Save text is missing or too large.' };
  return validateSaveGame(json);
}

function restoreWorld(context, data) {
  const world = context?.world;
  if (!world || !data?.cells) return { restored: 0 };
  if (finite(data.gridSize, world.gridSize, 16, 128) !== world.gridSize) throw new Error('Save grid size does not match this dungeon.');
  let restored = 0;
  for (const raw of data.cells) {
    const cell = world.getCell?.(raw.x, raw.z);
    if (!cell || !TILE_TYPES.has(raw.type) || (raw.room != null && !ROOM_TYPES.has(raw.room))) continue;
    cell.type = raw.type;
    cell.room = raw.room || null;
    cell.discovered = Boolean(raw.discovered);
    cell.visible = Boolean(raw.visible);
    cell.gold = finite(raw.gold, 0, 0, 1e9);
    if (raw.type === 'heart') world.heartCell = cell;
    restored++;
  }
  if (Number.isFinite(data.seed)) { world.seed = finite(data.seed, world.seed, 0, 0xffffffff); world._randomState = (world.seed ^ 0x9e3779b9) >>> 0; }
  world._dirty = true;
  world._rebuildClock = 0;
  (context?.navigation || context?.runtime?.navigation)?.invalidate?.('save-restored');
  return { restored };
}

function restoreEconomy(context, data) {
  const state = context?.state || context?.runtime?.state;
  if (!state || !plain(data)) return { restored: 0 };
  let restored = 0;
  for (const key of SAFE_STATE_KEYS) {
    if (!(key in data)) continue;
    if (typeof state[key] === 'boolean') state[key] = Boolean(data[key]);
    else if (typeof state[key] === 'string') state[key] = text(data[key], state[key], 64);
    else state[key] = finite(data[key], state[key], key === 'elapsed' ? 0 : -1e9, 1e9);
    restored++;
  }
  state.gameOver = data.gameOver ? { victory: Boolean(data.gameOver.victory) } : null;
  if (context?.runtime) context.runtime.maxMana = state.manaMax;
  return { restored };
}

function clearEntities(entities) { for (const entity of [...entityList(entities)]) entities.remove?.(entity); }
function restoreEntities(context, data) {
  const entities = context?.entities;
  if (!entities || !Array.isArray(data)) return { restored: 0, byId: new Map() };
  clearEntities(entities);
  const byId = new Map();
  for (const raw of data.slice(0, MAX_ENTITIES)) {
    if (!raw?.id || !raw?.type) continue;
    try {
      const entity = entities.spawn(raw.type, {
        id: String(raw.id), x: finite(raw.position?.x, 0, 0, 127), z: finite(raw.position?.z, 0, 0, 127), facing: finite(raw.facing, 0, -Math.PI * 2, Math.PI * 2),
        faction: text(raw.faction, 'dungeon', 48), hp: finite(raw.hp, 1, 0, 1e6), maxHp: finite(raw.maxHp, 1, 1, 1e6), damage: finite(raw.damage, 1, 0, 1e5),
        attackRange: finite(raw.attackRange, 1, 0, 128), speed: finite(raw.speed, 1, 0, 128), attackInterval: finite(raw.attackInterval, 0.9, 0.05, 120),
        state: text(raw.state, 'idle', 48), autonomous: raw.autonomous !== false,
      });
      entity.previousState = text(raw.previousState, 'idle', 48);
      entity.attackCooldown = finite(raw.attackCooldown, 0, 0, 120);
      entity.carryAmount = finite(raw.carryAmount, 0, 0, 1e9);
      entity.destination = raw.destination ? point(raw.destination) : null;
      entity.path = asList(raw.path).slice(0, 256).map((item) => point(item));
      entity.pathIndex = finite(raw.pathIndex, 0, 0, entity.path.length);
      entity.work = raw.work ? { action: text(raw.work.action, 'dig', 48), x: finite(raw.work.x, 0, 0, 127), z: finite(raw.work.z, 0, 0, 127), duration: finite(raw.work.duration, 1.5, 0.05, 600), elapsed: finite(raw.work.elapsed, 0, 0, 600), onComplete: null } : null;
      entity.userData ||= {};
      entity.userData.dkStatuses = copyJson(raw.statuses || {}) || Object.create(null);
      if (raw.statusBase) entity.userData.dkStatusBase = copyJson(raw.statusBase);
      byId.set(entity.id, entity);
    } catch (error) { console.warn('[Persistence] Skipped invalid entity.', error); }
  }
  // Explicit restored ids do not pass through the directors' auto-id path.
  // Advance the serial so the next summon cannot replace a restored Map entry.
  if (Number.isFinite(entities._serial)) {
    entities._serial = Math.max(entities._serial, ...Array.from(byId.keys(), numericSuffix));
  }
  for (const raw of data) {
    const entity = byId.get(String(raw?.id));
    if (entity && raw.targetId) entity.target = byId.get(String(raw.targetId)) || null;
  }
  return { restored: byId.size, byId };
}

function clearDefenses(defenses, world) {
  for (const item of defenseList(defenses)) {
    try {
      if (typeof defenses?._removeDefense === 'function') defenses._removeDefense(item);
      else {
        defenses?.runtime?.removeShadowCaster?.(item.root, true);
        item.root?.dispose?.(false, false);
      }
    } catch (_) { /* visual only */ }
  }
  defenses?.doors?.clear?.(); defenses?.traps?.clear?.();
  for (const column of world?.grid || []) for (const cell of column || []) if (cell?.metadata) delete cell.metadata.defenseId;
}
function restoreDefenses(context, data) {
  const defenses = context?.defenses;
  if (!defenses || !Array.isArray(data)) return { restored: 0 };
  clearDefenses(defenses, context?.world);
  let restored = 0;
  for (const raw of data.slice(0, MAX_DEFENSES)) {
    if (!raw?.id || !raw?.kind) continue;
    const options = { id: String(raw.id), faction: text(raw.faction, 'dungeon', 48), orientation: raw.orientation === 'x' ? 'x' : 'z', hp: finite(raw.hp, 1, 0, 1e6), maxHp: finite(raw.maxHp, 1, 1, 1e6), charges: finite(raw.charges, 0, 0, 10000), maxCharges: finite(raw.maxCharges, 0, 0, 10000), free: true, force: true };
    try {
      const item = raw.category === 'door' ? defenses.placeDoor(raw.kind, raw.x, raw.z, options) : defenses.placeTrap(raw.kind, raw.x, raw.z, options);
      if (!item) continue;
      for (const key of ['placedCost', 'locked', 'manual', 'openAmount', 'attackClock', 'retaliateClock', 'broken', 'destroyClock', 'armed', 'armClock', 'cooldown', 'reloading', 'reloadClock', 'pendingCharges']) if (key in raw) item[key] = raw[key];
      restored++;
    } catch (error) { console.warn('[Persistence] Skipped invalid defense.', error); }
  }
  if (Number.isFinite(defenses._serial)) {
    defenses._serial = Math.max(defenses._serial, ...data.slice(0, MAX_DEFENSES).map((item) => numericSuffix(item?.id)));
  }
  return { restored };
}

function restoreWorkshop(context, data) {
  const workshop = context?.workshop || context?.runtime?.workshop;
  if (!data) return { restored: 0 };
  if (Number.isFinite(data.manufacturing) && context?.defenses?._internalManufacturing != null && !context.runtime?.economy) context.defenses._internalManufacturing = finite(data.manufacturing, 0, 0, 1e9);
  if (workshop?.restore && data.state != null) workshop.restore(copyJson(data.state));
  else if (workshop?.load && data.state != null) workshop.load(copyJson(data.state));
  return { restored: 1 };
}

function reapplyStatuses(entity) {
  const data = entity?.userData;
  if (!data?.dkStatusBase || !data.dkStatuses) return;
  const base = data.dkStatusBase;
  let speed = finite(base.speed, entity.speed, 0, 128), damage = finite(base.damage, entity.damage, 0, 1e5), maxHp = finite(base.maxHp, entity.maxHp, 1, 1e6), faction = text(base.faction, entity.faction, 48), scale = 1, hidden = false;
  for (const status of Object.values(data.dkStatuses)) {
    if (!plain(status) || finite(status.remaining, 0, 0, 86400) <= 0) continue;
    speed *= finite(status.speedMultiplier, 1, 0, 128); damage *= finite(status.damageMultiplier, 1, 0, 128); scale *= finite(status.scaleMultiplier, 1, 0.05, 128);
    maxHp += finite(status.bonusHp, 0, -1e6, 1e6); if (status.faction) faction = text(status.faction, faction, 48); hidden ||= Boolean(status.hidden);
  }
  entity.speed = speed; entity.damage = damage; entity.maxHp = Math.max(1, maxHp); entity.hp = Math.min(entity.hp, entity.maxHp); entity.faction = faction;
  if (entity.root?.scaling) { const s = base.scale || { x: 1, y: 1, z: 1 }; entity.root.scaling.set(finite(s.x, 1, 0.01, 128) * scale, finite(s.y, 1, 0.01, 128) * scale, finite(s.z, 1, 0.01, 128) * scale); }
  if (entity.root?.metadata) entity.root.metadata.faction = faction;
  for (const mesh of entity.root?.getChildMeshes?.() || []) mesh.visibility = hidden ? 0.27 : 1;
}
function restoreMagic(context, data, restoreState) {
  const magic = context?.magic || context?.runtime?.spells;
  if (!magic || !plain(data)) return { restored: 0 };
  magic.maxMana = finite(context?.state?.manaMax ?? context?.runtime?.state?.manaMax, magic.maxMana, 1, 1e6);
  for (const key of Object.keys(magic.cooldowns || {})) magic.cooldowns[key] = finite(data.cooldowns?.[key], 0, 0, 120);
  const spellbook = magic.spellbook?.() || {};
  magic.unlocked = new Set(asList(data.unlocked).filter((name) => Object.hasOwn(spellbook, name)));
  magic.researchTarget = Object.hasOwn(spellbook, data.researchTarget) ? data.researchTarget : null;
  magic.researchProgress = copyJson(data.researchProgress || {}) || Object.create(null);
  magic._infernos = asList(data.infernos).slice(0, 32).map((zone) => ({ x: finite(zone.x, 0, 0, 127), z: finite(zone.z, 0, 0, 127), radius: finite(zone.radius, 3, 0.1, 32), remaining: finite(zone.remaining, 0, 0, 600), tick: finite(zone.tick, 0, -10, 10), owner: text(zone.owner, 'dungeon', 48) }));
  for (const entity of restoreState?.entities?.byId?.values?.() || entityList(context?.entities)) reapplyStatuses(entity);
  const possessed = restoreState?.entities?.byId?.get?.(String(data.possessedId));
  if (possessed && possessed.faction === 'dungeon') {
    const activated = context?.possession?.enter?.(possessed, { pointerLock: false })
      ?? context?.runtime?.beginPossession?.(possessed, { pointerLock: false });
    if (activated !== false) {
      magic.possessed = possessed; possessed.autonomous = false; possessed.userData ||= {}; possessed.userData.possessed = true;
      if (context.runtime) context.runtime.possession = { entity: possessed, director: magic };
    }
  }
  return { restored: 1 };
}

export function applySaveGame(context, input, options = {}) {
  const validated = validateSaveGame(input);
  if (!validated.ok) return validated;
  const current = contextOf(context);
  const adapters = { ...DEFAULT_ADAPTERS, ...(options.adapters || {}) };
  const results = Object.create(null);
  try {
    current?.magic?.releasePossession?.();
    // Release old Imp assignments before EntityDirector replaces the roster;
    // otherwise stale Workshop ids could accidentally mutate newly restored
    // entities that reuse those ids.
    current?.workshop?.restore?.({});
    // Economy first makes the world and Workshop restore free of stale resource
    // constraints. Entity targets are resolved before magic possession.
    for (const name of ['economy', 'world', 'entities', 'defenses', 'workshop', 'magic']) {
      const adapter = adapters[name];
      if (!adapter?.restore) continue;
      results[name] = adapter.restore(current, validated.save.sections[name], results, options);
    }
    const savedMode = current?.state?.mode;
    if (savedMode) current?.input?.setMode?.(savedMode);
    const savedQuality = current?.state?.quality;
    if (savedQuality) {
      if (typeof current?.setQuality === 'function') current.setQuality(savedQuality);
      else current?.runtime?.setQuality?.(savedQuality);
    }
    current?.ui?.update?.(current.snapshot?.(true));
    return { ok: true, save: validated.save, results };
  } catch (error) { return { ok: false, reason: `Save could not be applied: ${String(error?.message || error)}`, save: validated.save, results }; }
}

/** Browser-facing controller: slots, import/export, and bounded autosaves. */
export class PersistenceDirector {
  constructor(context, options = {}) {
    this.context = context;
    this.adapters = options.adapters || {};
    try { this.storage = options.storage || globalThis.localStorage || null; }
    catch (_) { this.storage = options.storage || null; }
    this.prefix = options.prefix || STORAGE_PREFIX;
    this.autosaveSlot = slotName(options.autosaveSlot || DEFAULT_AUTOSAVE_SLOT);
    this.autosaveInterval = Math.max(1000, finite(options.autosaveInterval, 30000, 1000, 3600000));
    this._timer = null;
    this.lastError = '';
  }
  key(slot = DEFAULT_AUTOSAVE_SLOT) { return `${this.prefix}${slotName(slot)}`; }
  saveSlot(slot = DEFAULT_AUTOSAVE_SLOT) {
    if (!this.storage?.setItem) return { ok: false, reason: 'Persistent browser storage is unavailable.' };
    try { const json = exportSaveGame(this.context, { adapters: this.adapters }); this.storage.setItem(this.key(slot), json); return { ok: true, bytes: json.length, slot: slotName(slot) }; }
    catch (error) { this.lastError = String(error?.message || error); return { ok: false, reason: this.lastError }; }
  }
  loadSlot(slot = DEFAULT_AUTOSAVE_SLOT, options = {}) {
    if (!this.storage?.getItem) return { ok: false, reason: 'Persistent browser storage is unavailable.' };
    try { const json = this.storage.getItem(this.key(slot)); if (!json) return { ok: false, reason: 'Save slot is empty.' }; return applySaveGame(this.context, json, { ...options, adapters: { ...this.adapters, ...(options.adapters || {}) } }); }
    catch (error) { this.lastError = String(error?.message || error); return { ok: false, reason: this.lastError }; }
  }
  listSlots() {
    if (!this.storage || !Number.isFinite(this.storage.length) || !this.storage.key) return [];
    const slots = [];
    try {
      for (let index = 0; index < this.storage.length; index++) {
        const key = this.storage.key(index);
        if (typeof key === 'string' && key.startsWith(this.prefix)) slots.push(key.slice(this.prefix.length));
      }
    } catch (_) { return []; }
    return slots.sort();
  }
  removeSlot(slot = DEFAULT_AUTOSAVE_SLOT) { if (!this.storage?.removeItem) return false; try { this.storage.removeItem(this.key(slot)); return true; } catch (_) { return false; } }
  exportJson(options = {}) { return exportSaveGame(this.context, { ...options, adapters: { ...this.adapters, ...(options.adapters || {}) } }); }
  importJson(json, options = {}) { return applySaveGame(this.context, json, { ...options, adapters: { ...this.adapters, ...(options.adapters || {}) } }); }
  scheduleAutosave(delay = this.autosaveInterval) { this.stopAutosave(); this._timer = globalThis.setTimeout(() => { this.saveSlot(this.autosaveSlot); this.scheduleAutosave(); }, Math.max(0, finite(delay, this.autosaveInterval, 0, 3600000))); return this; }
  startAutosave() { return this.scheduleAutosave(); }
  stopAutosave() { if (this._timer != null) globalThis.clearTimeout(this._timer); this._timer = null; return this; }
  dispose() { this.stopAutosave(); }
}
