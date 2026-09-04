// ============================================================
// BABYLON DEFENSES DIRECTOR
// ============================================================
// DK2-inspired doors and traps with an explicit simulation layer. Geometry
// and materials are shared between every placed defense; transient flashes,
// bolts and particles are delegated to EffectsDirector's capped pools.

const B = window.BABYLON;

export const DOOR_DEFINITIONS = Object.freeze({
  ironwood: Object.freeze({ name: 'Ironwood Door', workCost: 10, hp: 170, repairRate: 44, color: 0x6f3f24 }),
  braced: Object.freeze({ name: 'Braced Door', workCost: 18, hp: 260, repairRate: 38, color: 0x8a542c }),
  steel: Object.freeze({ name: 'Steel Door', workCost: 30, hp: 420, repairRate: 32, color: 0x74808b }),
  magic: Object.freeze({ name: 'Magic Door', workCost: 42, hp: 340, repairRate: 28, color: 0x7136b8, retaliation: 14, retaliationMana: 6 }),
});

export const TRAP_DEFINITIONS = Object.freeze({
  spike: Object.freeze({ name: 'Spike Trap', workCost: 7, reloadCost: 3, charges: 3, armTime: 0.7, cooldown: 1.1, radius: 0.72, damage: 38 }),
  sentry: Object.freeze({ name: 'Sentry Trap', workCost: 16, reloadCost: 6, charges: 8, armTime: 1.1, cooldown: 0.72, radius: 5.2, damage: 16 }),
  lightning: Object.freeze({ name: 'Lightning Trap', workCost: 20, reloadCost: 8, charges: 4, armTime: 1.4, cooldown: 2.5, radius: 2.65, damage: 42 }),
  fear: Object.freeze({ name: 'Fear Trap', workCost: 14, reloadCost: 5, charges: 4, armTime: 1.0, cooldown: 3.2, radius: 2.8, duration: 5.2 }),
  gas: Object.freeze({ name: 'Gas Trap', workCost: 18, reloadCost: 7, charges: 3, armTime: 1.3, cooldown: 4.8, radius: 2.45, damage: 7, duration: 5 }),
  boulder: Object.freeze({ name: 'Boulder Trap', workCost: 28, reloadCost: 12, charges: 1, armTime: 1.8, cooldown: 6, radius: 0.9, damage: 78 }),
  alarm: Object.freeze({ name: 'Alarm Trap', workCost: 10, reloadCost: 4, charges: 5, armTime: 0.6, cooldown: 4, radius: 4.2, duration: 9 }),
});

const DOOR_ALIASES = Object.freeze({ wood: 'ironwood', woodDoor: 'ironwood', ironwoodDoor: 'ironwood', bracedDoor: 'braced', steelDoor: 'steel', magicDoor: 'magic' });
const TRAP_ALIASES = Object.freeze({ spikeTrap: 'spike', sentryTrap: 'sentry', lightningTrap: 'lightning', fearTrap: 'fear', gasTrap: 'gas', boulderTrap: 'boulder', alarmTrap: 'alarm' });
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function pointOf(value, z = undefined) {
  if (typeof value === 'number') return { x: value, y: 0, z: Number(z) || 0 };
  if (value?.root?.position) return value.root.position;
  if (value?.position) return value.position;
  return value || { x: 0, y: 0, z: 0 };
}
function color3(hex) { return B.Color3.FromInts((hex >> 16) & 255, (hex >> 8) & 255, hex & 255); }
function distance2(a, b) { return (a.x - b.x) ** 2 + (a.z - b.z) ** 2; }

function statusState(entity) {
  entity.userData ||= {};
  entity.userData.dkStatuses ||= Object.create(null);
  entity.userData.dkStatusBase ||= {
    speed: Number(entity.speed) || 1,
    damage: Number(entity.damage) || 1,
    faction: entity.faction,
    maxHp: Number(entity.maxHp) || Number(entity.hp) || 1,
    scale: entity.root?.scaling ? { x: entity.root.scaling.x, y: entity.root.scaling.y, z: entity.root.scaling.z } : { x: 1, y: 1, z: 1 },
  };
  return entity.userData;
}

function recomputeStatusModifiers(entity) {
  const data = statusState(entity);
  const base = data.dkStatusBase;
  let speed = 1, damage = 1, scale = 1, faction = base.faction, hidden = false, bonusHp = 0;
  for (const status of Object.values(data.dkStatuses)) {
    if (!status || status.remaining <= 0) continue;
    speed *= status.speedMultiplier ?? 1;
    damage *= status.damageMultiplier ?? 1;
    scale *= status.scaleMultiplier ?? 1;
    bonusHp += status.bonusHp ?? 0;
    if (status.faction) faction = status.faction;
    hidden ||= Boolean(status.hidden);
  }
  entity.speed = base.speed * speed;
  entity.damage = base.damage * damage;
  entity.faction = faction;
  entity.maxHp = base.maxHp + bonusHp;
  entity.hp = Math.min(entity.hp, entity.maxHp);
  if (entity.root) {
    entity.root.scaling.set(base.scale.x * scale, base.scale.y * scale, base.scale.z * scale);
    if (entity.root.metadata) entity.root.metadata.faction = faction;
    for (const mesh of entity.root.getChildMeshes?.() || []) mesh.visibility = hidden ? 0.27 : 1;
  }
  data.concealed = hidden;
}

export class DefensesDirector {
  constructor(runtime, world, entities, effects = null, audio = null) {
    if (!B) throw new Error('DefensesDirector requires window.BABYLON.');
    if (!runtime?.scene) throw new Error('DefensesDirector requires runtime.scene.');
    this.runtime = runtime;
    this.scene = runtime.scene;
    this.world = world;
    this.entities = entities;
    this.effects = effects;
    this.audio = audio;
    this.doors = new Map();
    this.traps = new Map();
    this._serial = 0;
    this._time = 0;
    this._internalManufacturing = Number(runtime.initialManufacturing ?? 420);
    this._templates = new Map();
    this._materials = new Map();
    this._gasClouds = [];
    this._disposed = false;
    this.lastError = '';
    this.root = new B.TransformNode('defenses', this.scene);
    this.root.metadata = { kind: 'defense-layer' };
    this._createKit();
  }

  // ------------------------------------------------------------
  // Economy and catalog
  // ------------------------------------------------------------

  catalog() {
    return {
      doors: Object.fromEntries(Object.entries(DOOR_DEFINITIONS).map(([id, def]) => [id, { id, ...def }])),
      traps: Object.fromEntries(Object.entries(TRAP_DEFINITIONS).map(([id, def]) => [id, { id, ...def }])),
    };
  }

  getManufacturing() {
    const value = this.runtime.economy?.get?.('manufacturing');
    return Number.isFinite(value) ? value : this._internalManufacturing;
  }

  addManufacturing(amount) {
    amount = Math.max(0, Number(amount) || 0);
    if (this.runtime.economy?.add) this.runtime.economy.add('manufacturing', amount);
    else this._internalManufacturing += amount;
    return this.getManufacturing();
  }

  canManufacture(amount) {
    if (this.runtime.economy?.canAfford) return this.runtime.economy.canAfford('manufacturing', amount) !== false;
    return this.getManufacturing() >= amount;
  }

  _spendWork(amount, free = false) {
    if (free || amount <= 0) return true;
    if (!this.canManufacture(amount)) return false;
    if (this.runtime.economy?.spend) return this.runtime.economy.spend('manufacturing', amount) !== false;
    this._internalManufacturing -= amount;
    return true;
  }

  _refundWork(amount) {
    if (amount <= 0) return;
    if (this.runtime.economy?.add) this.runtime.economy.add('manufacturing', amount);
    else this._internalManufacturing += amount;
  }

  // ------------------------------------------------------------
  // Doors
  // ------------------------------------------------------------

  canPlaceDoor(kind, x, z, options = {}) {
    kind = DOOR_ALIASES[kind] || kind;
    if (!DOOR_DEFINITIONS[kind]) return { ok: false, reason: `Unknown door: ${kind}` };
    const cell = this.world?.getCell?.(x, z);
    if (!cell) return { ok: false, reason: 'Outside the dungeon' };
    if (this.getAt(x, z)) return { ok: false, reason: 'Tile already contains a defense' };
    if (!options.force && (!cell.discovered || (cell.type !== 'claimed' && !cell.room))) {
      return { ok: false, reason: 'Doors require a claimed dungeon tile' };
    }
    if (!options.force && (cell.room || cell.type === 'heart' || cell.type === 'portal')) {
      return { ok: false, reason: 'Doors cannot replace rooms or landmarks' };
    }
    const northSouth = this.world?.isWalkable?.(x, z - 1) && this.world?.isWalkable?.(x, z + 1);
    const eastWest = this.world?.isWalkable?.(x - 1, z) && this.world?.isWalkable?.(x + 1, z);
    if (!options.force && northSouth === eastWest) {
      return { ok: false, reason: 'Doors need a one-tile-wide corridor between solid walls' };
    }
    let orientation = options.orientation;
    if (orientation !== 'x' && orientation !== 'z') {
      if (northSouth && !eastWest) orientation = 'x';
      else if (eastWest && !northSouth) orientation = 'z';
      else if (northSouth) orientation = 'x';
      else if (eastWest) orientation = 'z';
    }
    if (!orientation && !options.force) return { ok: false, reason: 'Doors need a one-tile-wide corridor' };
    return { ok: true, cell, orientation: orientation || 'x' };
  }

  placeDoor(kind, x, z, options = {}) {
    kind = DOOR_ALIASES[kind] || kind;
    x = Math.round(Number(x)); z = Math.round(Number(z));
    const check = this.canPlaceDoor(kind, x, z, options);
    if (!check.ok) return this._fail(check.reason);
    const def = DOOR_DEFINITIONS[kind];
    if (!this._spendWork(def.workCost, options.free)) return this._fail(`Need ${def.workCost} manufacturing work`);
    try {
      const id = String(options.id || `door-${++this._serial}`);
      const root = this._buildDoor(id, kind, x, z, check.orientation);
      const door = {
        id, category: 'door', kind, name: def.name, x, z, root,
        faction: options.faction || 'dungeon', orientation: check.orientation,
        hp: Number(options.hp ?? def.hp), maxHp: Number(options.maxHp ?? def.hp),
        locked: Boolean(options.locked), manual: null, openAmount: 0,
        attackClock: 0, retaliateClock: 0, destroyClock: 0, broken: false, placedCost: def.workCost,
      };
      this._tagDefense(root, door);
      this.doors.set(id, door);
      check.cell.metadata ||= Object.create(null);
      check.cell.metadata.defenseId = id;
      this._effect('claim', { x, y: 0.25, z }, def.color, 0.55);
      this._sound('hit_metal', { x, y: 0, z });
      return door;
    } catch (error) {
      this._refundWork(def.workCost);
      console.warn('[DefensesDirector] Door placement failed.', error);
      return this._fail('Door construction failed');
    }
  }

  buildDoor(kind, x, z, options = {}) { return this.placeDoor(kind, x, z, options); }
  createDoor(kind, x, z, options = {}) { return this.placeDoor(kind, x, z, options); }

  setDoorLocked(doorOrId, locked = true) {
    const door = this._door(doorOrId);
    if (!door || door.broken) return false;
    door.locked = Boolean(locked);
    if (door.locked) door.manual = 'closed';
    else if (door.manual === 'closed') door.manual = null;
    this._sound('ui_accept', pointOf(door));
    return true;
  }

  lockDoor(doorOrId) { return this.setDoorLocked(doorOrId, true); }
  unlockDoor(doorOrId) { return this.setDoorLocked(doorOrId, false); }
  toggleDoorLock(doorOrId) {
    const door = this._door(doorOrId);
    return door ? this.setDoorLocked(door, !door.locked) : false;
  }
  openDoor(doorOrId) {
    const door = this._door(doorOrId);
    if (!door || door.broken || door.locked) return false;
    door.manual = 'open';
    return true;
  }
  closeDoor(doorOrId) {
    const door = this._door(doorOrId);
    if (!door || door.broken) return false;
    door.manual = 'closed';
    return true;
  }
  autoDoor(doorOrId) {
    const door = this._door(doorOrId);
    if (!door || door.broken) return false;
    door.manual = null;
    return true;
  }

  allowsPassage(doorOrId, entityOrFaction, options = {}) {
    const door = this._door(doorOrId);
    if (!door || door.broken || door.hp <= 0) return true;
    if (door.locked && !options.ignoreLock) return false;
    const faction = typeof entityOrFaction === 'string' ? entityOrFaction : entityOrFaction?.faction;
    return faction === door.faction && door.manual !== 'closed';
  }

  isBlocked(x, z, entityOrFaction = null) {
    const defense = this.getAt(x, z);
    return Boolean(defense?.category === 'door' && !this.allowsPassage(defense, entityOrFaction));
  }

  damageDoor(doorOrId, amount, attacker = null) {
    const door = this._door(doorOrId);
    if (!door || door.broken) return false;
    door.hp = Math.max(0, door.hp - Math.max(0, Number(amount) || 0));
    this._effect('hit', { x: door.x, y: 0.55, z: door.z }, door.kind === 'magic' ? 0xb36cff : 0xffb45e, 0.36);
    this._sound('hit_metal', pointOf(door));
    if (door.hp <= 0) {
      door.broken = true;
      door.locked = false;
      door.manual = 'open';
      door.destroyClock = 1.15;
      this._effect('despawn', { x: door.x, y: 0.5, z: door.z }, 0xff734f, 0.9);
      this.effects?.shake?.(0.24, 0.25);
    } else if (attacker) {
      door.lastAttacker = attacker.id || null;
      const def = DOOR_DEFINITIONS[door.kind];
      if (door.kind === 'magic' && door.retaliateClock <= 0 && attacker.root && attacker.faction !== door.faction && this._spendMana(def.retaliationMana)) {
        door.retaliateClock = 0.9;
        const source = new B.Vector3(door.x, 0.72, door.z);
        this.effects?.lightning?.(source, attacker.root.position, { color: 0xb55cff, secondaryColor: 0xffffff, duration: 0.12, width: 0.42, shake: 0.08 });
        this._damage(attacker, def.retaliation, door);
      }
    }
    return true;
  }

  repairDoor(doorOrId, amount = null, options = {}) {
    const door = this._door(doorOrId);
    if (!door || door.broken || door.hp >= door.maxHp) return false;
    const def = DOOR_DEFINITIONS[door.kind];
    const repair = Math.min(door.maxHp - door.hp, Math.max(1, Number(amount) || def.repairRate));
    const work = Math.max(1, Math.ceil((repair / door.maxHp) * def.workCost * 0.55));
    if (!this._spendWork(work, options.free)) return this._fail(`Need ${work} manufacturing work`);
    door.hp += repair;
    this._effect('healing', { x: door.x, y: 0.5, z: door.z }, 0x75efb2, 0.42);
    return repair;
  }

  sellDoor(doorOrId, refundFraction = 0.5) {
    const door = this._door(doorOrId);
    if (!door) return false;
    const condition = clamp(door.hp / door.maxHp, 0.1, 1);
    const refund = Math.floor(door.placedCost * clamp(refundFraction, 0, 1) * condition);
    this._removeDefense(door);
    this._refundWork(refund);
    return refund;
  }

  // ------------------------------------------------------------
  // Traps
  // ------------------------------------------------------------

  canPlaceTrap(kind, x, z, options = {}) {
    kind = TRAP_ALIASES[kind] || kind;
    if (!TRAP_DEFINITIONS[kind]) return { ok: false, reason: `Unknown trap: ${kind}` };
    const cell = this.world?.getCell?.(x, z);
    if (!cell) return { ok: false, reason: 'Outside the dungeon' };
    if (this.getAt(x, z)) return { ok: false, reason: 'Tile already contains a defense' };
    if (!options.force && (!cell.discovered || (cell.type !== 'claimed' && !cell.room))) {
      return { ok: false, reason: 'Traps require a claimed dungeon tile' };
    }
    if (!options.force && (cell.type === 'heart' || cell.type === 'portal')) return { ok: false, reason: 'Cannot trap a landmark' };
    return { ok: true, cell };
  }

  placeTrap(kind, x, z, options = {}) {
    kind = TRAP_ALIASES[kind] || kind;
    x = Math.round(Number(x)); z = Math.round(Number(z));
    const check = this.canPlaceTrap(kind, x, z, options);
    if (!check.ok) return this._fail(check.reason);
    const def = TRAP_DEFINITIONS[kind];
    if (!this._spendWork(def.workCost, options.free)) return this._fail(`Need ${def.workCost} manufacturing work`);
    try {
      const id = String(options.id || `trap-${++this._serial}`);
      const root = this._buildTrap(id, kind, x, z, options.orientation || 'z');
      const charges = Math.max(0, Number(options.charges ?? def.charges));
      const trap = {
        id, category: 'trap', kind, name: def.name, x, z, root,
        faction: options.faction || 'dungeon', orientation: options.orientation || 'z',
        hp: Number(options.hp ?? 90), maxHp: Number(options.maxHp ?? 90),
        armed: false, armClock: Number(options.armTime ?? def.armTime), cooldown: 0,
        charges, maxCharges: Math.max(charges, Number(options.maxCharges ?? def.charges)),
        reloading: false, reloadClock: 0, placedCost: def.workCost,
      };
      this._tagDefense(root, trap);
      this.traps.set(id, trap);
      check.cell.metadata ||= Object.create(null);
      check.cell.metadata.defenseId = id;
      this._effect('claim', { x, y: 0.15, z }, 0xe3a23b, 0.4);
      return trap;
    } catch (error) {
      this._refundWork(def.workCost);
      console.warn('[DefensesDirector] Trap placement failed.', error);
      return this._fail('Trap construction failed');
    }
  }

  buildTrap(kind, x, z, options = {}) { return this.placeTrap(kind, x, z, options); }
  createTrap(kind, x, z, options = {}) { return this.placeTrap(kind, x, z, options); }

  armTrap(trapOrId) {
    const trap = this._trap(trapOrId);
    if (!trap || trap.reloading || trap.charges <= 0) return false;
    trap.armClock = TRAP_DEFINITIONS[trap.kind].armTime;
    trap.armed = false;
    return true;
  }

  disarmTrap(trapOrId) {
    const trap = this._trap(trapOrId);
    if (!trap) return false;
    trap.armed = false;
    trap.armClock = Infinity;
    return true;
  }

  reloadTrap(trapOrId, options = {}) {
    const trap = this._trap(trapOrId);
    if (!trap || trap.reloading || trap.charges >= trap.maxCharges) return false;
    const missing = trap.maxCharges - trap.charges;
    const cost = Math.ceil(TRAP_DEFINITIONS[trap.kind].reloadCost * missing / trap.maxCharges);
    if (!this._spendWork(cost, options.free)) return this._fail(`Need ${cost} manufacturing work`);
    trap.armed = false;
    trap.reloading = true;
    trap.reloadClock = Number(options.duration ?? (1.2 + missing * 0.4));
    trap.pendingCharges = missing;
    return true;
  }

  damageTrap(trapOrId, amount) {
    const trap = this._trap(trapOrId);
    if (!trap) return false;
    trap.hp = Math.max(0, trap.hp - Math.max(0, Number(amount) || 0));
    this._effect('hit', { x: trap.x, y: 0.25, z: trap.z }, 0xff8752, 0.35);
    if (trap.hp <= 0) this._removeDefense(trap);
    return true;
  }

  sellTrap(trapOrId, refundFraction = 0.5) {
    const trap = this._trap(trapOrId);
    if (!trap) return false;
    const refund = Math.floor(trap.placedCost * clamp(refundFraction, 0, 1) * clamp(trap.hp / trap.maxHp, 0.1, 1));
    this._removeDefense(trap);
    this._refundWork(refund);
    return refund;
  }

  // ------------------------------------------------------------
  // Simulation
  // ------------------------------------------------------------

  update(dt, time = undefined) {
    if (this._disposed) return;
    const step = clamp(Number(dt) || 0, 0, 0.1);
    this._time = Number.isFinite(time) ? time : this._time + step;
    const living = this._entities();
    for (const door of Array.from(this.doors.values())) {
      this._updateDoor(door, this._nearby(door, 1.35, living), step);
    }
    for (const trap of Array.from(this.traps.values())) {
      const radius = (TRAP_DEFINITIONS[trap.kind]?.radius || 1) + 0.2;
      this._updateTrap(trap, this._nearby(trap, radius, living), step);
    }
    this._updateClouds(living, step);
    this._updateDefenseStatuses(living, step);
  }

  _updateDoor(door, living, dt) {
    door.attackClock = Math.max(0, door.attackClock - dt);
    door.retaliateClock = Math.max(0, door.retaliateClock - dt);
    if (door.broken) {
      door.destroyClock -= dt;
      door.openAmount = Math.min(1, door.openAmount + dt * 4);
      this._poseDoor(door);
      if (door.destroyClock <= 0) this._removeDefense(door);
      return;
    }
    let friendlyNear = false;
    for (const entity of living) {
      const distance = Math.sqrt(distance2(entity.root.position, door));
      if (distance > 1.25) continue;
      if (entity.faction === door.faction) {
        friendlyNear = true;
        if ((door.locked || door.manual === 'closed') && distance < 0.72) this._haltAtDoor(entity, door);
      } else {
        this._haltAtDoor(entity, door);
        if (distance < 0.82 && door.attackClock <= 0) {
          door.attackClock = Math.max(0.45, Number(entity.attackInterval) || 0.9);
          this.damageDoor(door, Math.max(2, Number(entity.damage) || 8), entity);
        }
      }
    }
    const shouldOpen = !door.locked && (door.manual === 'open' || (door.manual == null && friendlyNear));
    const target = shouldOpen ? 1 : 0;
    door.openAmount += (target - door.openAmount) * Math.min(1, dt * 7.5);
    this._poseDoor(door);
  }

  _haltAtDoor(entity, door) {
    if (!entity?.root?.position) return;
    // Stop at the physical doorway, regardless of the final path destination
    // (heroes normally target the Heart several cells beyond this door).
    const axis = door.orientation === 'x' ? 'z' : 'x';
    const coordinate = entity.root.position[axis] - door[axis];
    entity.userData ||= {};
    entity.userData.dkDoorSides ||= Object.create(null);
    if (!entity.userData.dkDoorSides[door.id] || Math.abs(coordinate) > 0.18) {
      entity.userData.dkDoorSides[door.id] = Math.sign(coordinate) || -1;
    }
    entity.root.position[axis] = door[axis] + entity.userData.dkDoorSides[door.id] * 0.72;
    entity.destination = null;
    if (entity.path) entity.path.length = 0;
    // Never place a defense object in EntityDirector's combat target slot: its
    // combat code expects a character root, hp and death lifecycle. Door damage
    // is exclusively driven by DefensesDirector's attack timer above.
    entity.target = null;
    this.entities?.setState?.(entity, 'idle');
  }

  _updateTrap(trap, living, dt) {
    const def = TRAP_DEFINITIONS[trap.kind];
    trap.cooldown = Math.max(0, trap.cooldown - dt);
    if (trap.reloading) {
      trap.reloadClock -= dt;
      if (trap.reloadClock <= 0) {
        trap.charges = Math.min(trap.maxCharges, trap.charges + trap.pendingCharges);
        trap.pendingCharges = 0;
        trap.reloading = false;
        trap.armClock = def.armTime;
      }
    } else if (!trap.armed && trap.charges > 0 && Number.isFinite(trap.armClock)) {
      trap.armClock -= dt;
      if (trap.armClock <= 0) trap.armed = true;
    }
    this._animateTrap(trap, dt);
    if (!trap.armed || trap.cooldown > 0 || trap.charges <= 0) return;
    const hostile = living
      .filter((entity) => entity.faction !== trap.faction && entity.hp > 0 && entity.state !== 'death' && !entity.userData?.concealed)
      .sort((a, b) => distance2(a.root.position, trap) - distance2(b.root.position, trap));
    const target = hostile[0];
    if (!target || distance2(target.root.position, trap) > def.radius ** 2) return;
    this._triggerTrap(trap, target, hostile);
  }

  _triggerTrap(trap, target, hostile) {
    const def = TRAP_DEFINITIONS[trap.kind];
    trap.charges--;
    trap.cooldown = def.cooldown;
    trap.armed = trap.charges > 0;
    if (trap.armed) trap.armClock = Math.min(0.35, def.armTime);
    const origin = new B.Vector3(trap.x, 0.25, trap.z);
    if (trap.kind === 'spike') {
      trap.root.metadata.visual.actuator.scaling.y = 1;
      this._damage(target, def.damage, trap);
      this._applyStatus(target, `${trap.id}:slow`, { duration: 2.4, speedMultiplier: 0.56 });
      this._effect('hit', origin, 0xe6edf3, 0.72);
    } else if (trap.kind === 'sentry') {
      const end = pointOf(target);
      this.effects?.lightning?.(origin.add(new B.Vector3(0, 0.45, 0)), end, { color: 0xffbd5c, secondaryColor: 0xffffff, width: 0.28, duration: 0.08, shake: 0.06 });
      this._damage(target, def.damage, trap);
    } else if (trap.kind === 'lightning') {
      for (const entity of hostile) {
        if (distance2(entity.root.position, trap) > def.radius ** 2) continue;
        this.effects?.lightning?.(origin.add(new B.Vector3(0, 1.2, 0)), entity.root.position, { color: 0x7dc8ff, duration: 0.14, shake: 0.12 });
        this._damage(entity, def.damage, trap);
        this._applyStatus(entity, `${trap.id}:shock`, { duration: 1.5, speedMultiplier: 0.35 });
      }
      this.effects?.shake?.(0.28, 0.22);
    } else if (trap.kind === 'fear') {
      for (const entity of hostile) {
        if (distance2(entity.root.position, trap) > def.radius ** 2) continue;
        this._applyStatus(entity, `${trap.id}:fear`, { duration: def.duration, speedMultiplier: 1.18, fear: true });
        const away = entity.root.position.subtract(origin).normalize().scale(4.5).add(entity.root.position);
        this.entities?.moveTo?.(entity, away, { state: 'flee' });
      }
      this._effect('rally', origin, 0xb866ff, 1.05);
    } else if (trap.kind === 'gas') {
      this._gasClouds.push({ x: trap.x, z: trap.z, radius: def.radius, remaining: def.duration, tick: 0, source: trap });
      this._effect('burst', origin, 0x72d15d, 1.25);
    } else if (trap.kind === 'boulder') {
      const axis = trap.orientation === 'x' ? { x: 0, z: 1 } : { x: 1, z: 0 };
      const toward = ((target.root.position.x - trap.x) * axis.x + (target.root.position.z - trap.z) * axis.z) < 0 ? -1 : 1;
      for (let i = 0; i <= 7; i++) {
        const p = { x: trap.x + axis.x * i * toward, y: 0.32, z: trap.z + axis.z * i * toward };
        this._effect('hit', p, 0xb88858, 0.42 + i * 0.025);
        for (const entity of hostile) {
          if (distance2(entity.root.position, p) <= 0.72 ** 2) this._damage(entity, Math.max(22, def.damage - i * 6), trap);
        }
      }
      this.effects?.shake?.(0.48, 0.45);
    } else if (trap.kind === 'alarm') {
      for (const entity of hostile) {
        if (distance2(entity.root.position, trap) <= def.radius ** 2) this._applyStatus(entity, `${trap.id}:marked`, { duration: def.duration, marked: true });
      }
      this.entities?.setRally?.(trap.x, trap.z, Math.min(6, def.duration));
      this._effect('rally', origin, 0xff493f, 1.1);
    }
    this._sound(trap.kind === 'lightning' ? 'lightning' : trap.kind === 'alarm' ? 'rally' : 'hit_metal', origin);
    this.runtime.events?.emit?.('defenseTriggered', { defense: trap, target });
  }

  _updateClouds(living, dt) {
    for (let i = this._gasClouds.length - 1; i >= 0; i--) {
      const cloud = this._gasClouds[i];
      cloud.remaining -= dt;
      cloud.tick -= dt;
      if (cloud.tick <= 0) {
        cloud.tick = 0.7;
        for (const entity of living) {
          if (entity.faction === cloud.source.faction || distance2(entity.root.position, cloud) > cloud.radius ** 2) continue;
          this._damage(entity, TRAP_DEFINITIONS.gas.damage, cloud.source);
          this._applyStatus(entity, `${cloud.source.id}:gas`, { duration: 1.2, speedMultiplier: 0.78, poison: true });
        }
        this._effect('burst', { x: cloud.x, y: 0.25, z: cloud.z }, 0x65bc50, 0.82);
      }
      if (cloud.remaining <= 0) this._gasClouds.splice(i, 1);
    }
  }

  _applyStatus(entity, key, options) {
    const data = statusState(entity);
    data.dkStatuses[`defense:${key}`] = { source: 'defense', remaining: options.duration, ...options };
    recomputeStatusModifiers(entity);
  }

  _updateDefenseStatuses(living, dt) {
    for (const entity of living) {
      const data = statusState(entity);
      let changed = false;
      for (const [key, status] of Object.entries(data.dkStatuses)) {
        if (!key.startsWith('defense:')) continue;
        status.remaining -= dt;
        if (status.remaining <= 0) { delete data.dkStatuses[key]; changed = true; }
      }
      if (changed) recomputeStatusModifiers(entity);
    }
  }

  // ------------------------------------------------------------
  // Lookup, serialization and lifecycle
  // ------------------------------------------------------------

  get(id) { return this.doors.get(String(id)) || this.traps.get(String(id)) || null; }
  getAt(x, z) {
    x = Math.round(Number(x)); z = Math.round(Number(z));
    for (const item of this.doors.values()) if (item.x === x && item.z === z) return item;
    for (const item of this.traps.values()) if (item.x === x && item.z === z) return item;
    return null;
  }
  list(category = null) {
    if (category === 'door' || category === 'doors') return Array.from(this.doors.values());
    if (category === 'trap' || category === 'traps') return Array.from(this.traps.values());
    return [...this.doors.values(), ...this.traps.values()];
  }
  pick(pickOrMesh) {
    let node = pickOrMesh?.pickedMesh || pickOrMesh;
    while (node) {
      if (node.metadata?.defenseId) return this.get(node.metadata.defenseId);
      node = node.parent;
    }
    return null;
  }

  snapshot() {
    const omit = ({ root, lastAttacker, ...data }) => ({ ...data });
    return {
      manufacturing: this.getManufacturing(),
      doors: Array.from(this.doors.values(), omit),
      traps: Array.from(this.traps.values(), omit),
    };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const defense of this.list()) this._removeDefense(defense);
    this._gasClouds.length = 0;
    for (const mesh of this._templates.values()) mesh.dispose(false, false);
    for (const material of this._materials.values()) material.dispose(false, true);
    this._templates.clear();
    this._materials.clear();
    this.root.dispose(false, false);
  }

  // ------------------------------------------------------------
  // Shared procedural art kit
  // ------------------------------------------------------------

  _createKit() {
    const material = (name, hex, metallic, roughness, emissive = 0, emissiveIntensity = 0) => {
      const mat = new B.PBRMaterial(`defense.mat.${name}`, this.scene);
      mat.albedoColor = color3(hex);
      mat.metallic = metallic;
      mat.roughness = roughness;
      if (emissive) { mat.emissiveColor = color3(emissive); mat.emissiveIntensity = emissiveIntensity; }
      this._materials.set(name, mat);
      return mat;
    };
    material('wood', 0x6b3b22, 0.02, 0.86);
    material('darkWood', 0x321a18, 0.02, 0.94);
    material('iron', 0x414852, 0.82, 0.32);
    material('steel', 0x8997a4, 0.94, 0.22);
    material('bronze', 0x9a632e, 0.75, 0.34);
    material('stone', 0x403b46, 0.05, 0.94);
    material('spike', 0xc4d2dc, 0.92, 0.18);
    material('arcane', 0x633092, 0.18, 0.35, 0xa34cff, 1.8);
    material('electric', 0x326a9a, 0.25, 0.25, 0x62bfff, 2.2);
    material('gas', 0x426b32, 0.08, 0.46, 0x6fd94f, 1.1);
    material('alarm', 0x821f20, 0.45, 0.38, 0xff3b31, 1.45);
    const make = (key, create) => {
      const mesh = create();
      mesh.name = `defense.template.${key}`;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this._templates.set(key, mesh);
    };
    make('box', () => B.MeshBuilder.CreateBox('box', { size: 1 }, this.scene));
    make('cylinder', () => B.MeshBuilder.CreateCylinder('cylinder', { height: 1, diameter: 1, tessellation: 10 }, this.scene));
    make('cone', () => B.MeshBuilder.CreateCylinder('cone', { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 8 }, this.scene));
    make('sphere', () => B.MeshBuilder.CreateSphere('sphere', { diameter: 1, segments: 8 }, this.scene));
    make('torus', () => B.MeshBuilder.CreateTorus('torus', { diameter: 1, thickness: 0.16, tessellation: 16 }, this.scene));
  }

  _part(parent, name, shape, material, position, scaling, rotation = [0, 0, 0]) {
    const mesh = this._templates.get(shape).clone(name, parent, true);
    mesh.setEnabled(true);
    mesh.material = this._materials.get(material);
    mesh.position.set(...position);
    mesh.scaling.set(...scaling);
    mesh.rotation.set(...rotation);
    mesh.isPickable = true;
    mesh.receiveShadows = true;
    this.runtime.shadowGenerator?.addShadowCaster?.(mesh);
    return mesh;
  }

  _buildDoor(id, kind, x, z, orientation) {
    const root = new B.TransformNode(`defense:${id}`, this.scene);
    root.parent = this.root;
    root.position.set(x, 0, z);
    root.rotation.y = orientation === 'z' ? Math.PI / 2 : 0;
    const frameMat = kind === 'steel' ? 'steel' : kind === 'magic' ? 'arcane' : 'iron';
    this._part(root, `${id}:threshold`, 'box', 'stone', [0, 0.08, 0], [0.98, 0.16, 0.34]);
    this._part(root, `${id}:postL`, 'box', frameMat, [-0.43, 0.58, 0], [0.16, 1.16, 0.26]);
    this._part(root, `${id}:postR`, 'box', frameMat, [0.43, 0.58, 0], [0.16, 1.16, 0.26]);
    this._part(root, `${id}:lintel`, 'box', frameMat, [0, 1.12, 0], [1, 0.18, 0.3]);
    const leafMat = kind === 'steel' ? 'steel' : kind === 'magic' ? 'arcane' : kind === 'braced' ? 'darkWood' : 'wood';
    const left = this._part(root, `${id}:leafL`, 'box', leafMat, [-0.22, 0.59, 0], [0.4, 0.89, 0.16]);
    const right = this._part(root, `${id}:leafR`, 'box', leafMat, [0.22, 0.59, 0], [0.4, 0.89, 0.16]);
    if (kind === 'braced' || kind === 'steel') {
      this._part(left, `${id}:braceL`, 'box', 'iron', [0, 0, -0.12], [0.08, 0.96, 0.06], [0, 0, -0.48]);
      this._part(right, `${id}:braceR`, 'box', 'iron', [0, 0, -0.12], [0.08, 0.96, 0.06], [0, 0, 0.48]);
    }
    if (kind === 'magic') {
      this._part(root, `${id}:rune`, 'torus', 'arcane', [0, 0.65, -0.16], [0.35, 0.35, 0.12], [Math.PI / 2, 0, 0]);
    }
    root.metadata = { visual: { left, right } };
    return root;
  }

  _poseDoor(door) {
    const visual = door.root.metadata.visual;
    const open = clamp(door.openAmount, 0, 1);
    visual.left.position.x = -0.22 - open * 0.25;
    visual.right.position.x = 0.22 + open * 0.25;
    visual.left.scaling.x = 0.4 * (1 - open * 0.83);
    visual.right.scaling.x = 0.4 * (1 - open * 0.83);
    door.root.metadata.openAmount = open;
  }

  _buildTrap(id, kind, x, z, orientation) {
    const root = new B.TransformNode(`defense:${id}`, this.scene);
    root.parent = this.root;
    root.position.set(x, 0, z);
    root.rotation.y = orientation === 'x' ? Math.PI / 2 : 0;
    const base = this._part(root, `${id}:base`, kind === 'fear' ? 'cylinder' : 'box', kind === 'alarm' ? 'alarm' : 'iron', [0, 0.08, 0], [0.74, 0.14, 0.74]);
    const visual = { base };
    if (kind === 'spike') {
      visual.actuator = new B.TransformNode(`${id}:actuator`, this.scene); visual.actuator.parent = root;
      for (const [px, pz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22], [0, 0]]) {
        this._part(visual.actuator, `${id}:spike`, 'cone', 'spike', [px, 0.29, pz], [0.12, 0.58, 0.12]);
      }
      visual.actuator.scaling.y = 0.12;
    } else if (kind === 'sentry') {
      visual.turret = new B.TransformNode(`${id}:turret`, this.scene); visual.turret.parent = root; visual.turret.position.y = 0.24;
      this._part(visual.turret, `${id}:head`, 'sphere', 'bronze', [0, 0.22, 0], [0.42, 0.34, 0.42]);
      this._part(visual.turret, `${id}:barrel`, 'cylinder', 'steel', [0, 0.25, 0.35], [0.1, 0.62, 0.1], [Math.PI / 2, 0, 0]);
    } else if (kind === 'lightning') {
      visual.core = this._part(root, `${id}:core`, 'sphere', 'electric', [0, 0.48, 0], [0.23, 0.3, 0.23]);
      visual.ring = this._part(root, `${id}:coil`, 'torus', 'steel', [0, 0.42, 0], [0.62, 0.62, 0.25], [Math.PI / 2, 0, 0]);
      for (const [px, pz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) this._part(root, `${id}:rod`, 'cylinder', 'electric', [px, 0.35, pz], [0.06, 0.52, 0.06]);
    } else if (kind === 'fear') {
      visual.core = this._part(root, `${id}:idol`, 'cone', 'arcane', [0, 0.47, 0], [0.52, 0.76, 0.52]);
      this._part(root, `${id}:eyeL`, 'sphere', 'alarm', [-0.13, 0.59, 0.23], [0.09, 0.07, 0.06]);
      this._part(root, `${id}:eyeR`, 'sphere', 'alarm', [0.13, 0.59, 0.23], [0.09, 0.07, 0.06]);
    } else if (kind === 'gas') {
      visual.core = this._part(root, `${id}:vial`, 'cylinder', 'gas', [0, 0.35, 0], [0.2, 0.48, 0.2]);
      for (let i = -2; i <= 2; i++) this._part(root, `${id}:grate`, 'box', 'steel', [i * 0.13, 0.17, 0], [0.055, 0.055, 0.64]);
    } else if (kind === 'boulder') {
      visual.core = this._part(root, `${id}:boulder`, 'sphere', 'stone', [0, 0.42, -0.08], [0.66, 0.66, 0.66]);
      this._part(root, `${id}:band`, 'torus', 'iron', [0, 0.42, -0.08], [0.72, 0.72, 0.23], [Math.PI / 2, 0, 0]);
    } else if (kind === 'alarm') {
      visual.core = this._part(root, `${id}:bell`, 'cone', 'bronze', [0, 0.55, 0], [0.52, 0.58, 0.52], [0, 0, Math.PI]);
      this._part(root, `${id}:post`, 'cylinder', 'darkWood', [0, 0.38, 0], [0.12, 0.72, 0.12]);
      visual.ring = this._part(root, `${id}:signal`, 'torus', 'alarm', [0, 0.82, 0], [0.46, 0.46, 0.12], [Math.PI / 2, 0, 0]);
    }
    root.metadata = { visual };
    return root;
  }

  _animateTrap(trap, dt) {
    const visual = trap.root.metadata.visual;
    const readiness = trap.armed && trap.cooldown <= 0 ? 1 : 0.28;
    if (visual.core) {
      const pulse = readiness * (1 + Math.sin(this._time * 4 + trap.x) * 0.06);
      visual.core.scaling.y = Math.max(0.12, visual.core.scaling.y * 0.85 + pulse * visual.core.scaling.x * 0.15);
      visual.core.rotation.y += 0.018 * readiness;
    }
    if (visual.ring) visual.ring.rotation.y += 0.026 * readiness;
    if (visual.turret) visual.turret.rotation.y += 0.012 * readiness;
    if (trap.kind === 'spike' && trap.cooldown > 0) visual.actuator.scaling.y = Math.max(0.12, visual.actuator.scaling.y - dt * 3.8);
    trap.root.scaling.y = trap.reloading ? 0.86 + Math.sin(this._time * 8) * 0.04 : 1;
  }

  _tagDefense(root, defense) {
    root.metadata = { ...(root.metadata || {}), defense, defenseId: defense.id, defenseType: defense.category, kind: defense.kind };
    for (const mesh of root.getChildMeshes()) mesh.metadata = { ...(mesh.metadata || {}), defense, defenseId: defense.id, defenseType: defense.category, kind: defense.kind };
  }

  _removeDefense(defense) {
    if (!defense) return false;
    const cell = this.world?.getCell?.(defense.x, defense.z);
    if (cell?.metadata?.defenseId === defense.id) delete cell.metadata.defenseId;
    this.doors.delete(defense.id);
    this.traps.delete(defense.id);
    this.runtime.removeShadowCaster?.(defense.root, true);
    defense.root?.dispose(false, false);
    return true;
  }

  _door(value) { return value?.category === 'door' ? value : this.doors.get(String(value)) || null; }
  _trap(value) { return value?.category === 'trap' ? value : this.traps.get(String(value)) || null; }
  _entities() { return (this.entities?.getAll?.() || this.entities?.list?.() || []).filter((entity) => entity?.root && entity.hp > 0 && entity.state !== 'death'); }
  _nearby(point, radius, fallback) {
    return this.runtime.navigation?.spatial?.queryRadius?.(point, radius, (entity) => (
      entity?.root && entity.hp > 0 && entity.state !== 'death'
    )) || fallback;
  }
  _damage(entity, amount, source) {
    // EntityDirector only accepts character attackers. Passing a trap/door
    // would make its AI later treat the defense as a killable creature.
    const attacker = source?.category ? null : source;
    return this.entities?.takeDamage?.(entity, amount, attacker) ?? false;
  }
  _spendMana(amount) {
    const economy = this.runtime.economy;
    if (!economy) return false;
    if (economy.canAfford?.('mana', amount) === false) return false;
    return economy.spend?.('mana', amount) !== false;
  }
  _fail(reason) { this.lastError = String(reason || 'Defense action failed'); return false; }
  _sound(name, position) { this.audio?.play?.(name, position) || this.audio?.playSfx?.(name, { position }); }
  _effect(kind, position, color, scale) {
    if (!this.effects) return;
    const method = kind === 'burst' ? 'burst' : kind;
    try {
      if (typeof this.effects[method] === 'function') this.effects[method](position, { color, scale });
      else this.effects.burst?.(position, { kind, color, scale });
    } catch (_) { /* Visual feedback must never interrupt defense simulation. */ }
  }
}
