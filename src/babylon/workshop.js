// ============================================================
// DK2 WORKSHOP LOGISTICS DIRECTOR
// ============================================================
// A deliberately separate simulation layer for Workshop production.  It owns
// blueprints, finished physical crates and Imp errands, while DefensesDirector
// remains the authority that validates and creates doors/traps.  The director
// also works without Babylon so save/load and deterministic logic can run in a
// lightweight test harness.

import { DOOR_DEFINITIONS, TRAP_DEFINITIONS } from './defenses.js';

const B = typeof window !== 'undefined' ? window.BABYLON : null;

export const WORKSHOP_BLUEPRINTS = Object.freeze({
  doors: Object.freeze(Object.fromEntries(Object.entries(DOOR_DEFINITIONS)
    .map(([id, definition]) => [id, Object.freeze({ id, category: 'door', name: definition.name, workCost: definition.workCost })]))),
  traps: Object.freeze(Object.fromEntries(Object.entries(TRAP_DEFINITIONS)
    .map(([id, definition]) => [id, Object.freeze({ id, category: 'trap', name: definition.name, workCost: definition.workCost })]))),
});

const CATEGORY_ALIASES = Object.freeze({ door: 'door', doors: 'door', trap: 'trap', traps: 'trap' });
const MAX_STEP = 0.1;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function number(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function integer(value, fallback = 0) { return Math.floor(number(value, fallback)); }
function keyOf(x, z) { return `${Math.round(x)},${Math.round(z)}`; }
function sortId(a, b) { return String(a.id).localeCompare(String(b.id)); }
function clonePlain(value) { return JSON.parse(JSON.stringify(value)); }

function canonicalCategory(category) {
  return CATEGORY_ALIASES[String(category || '').toLowerCase()] || null;
}

function blueprintFor(category, kind) {
  const resolved = canonicalCategory(category);
  const table = resolved === 'door' ? WORKSHOP_BLUEPRINTS.doors : resolved === 'trap' ? WORKSHOP_BLUEPRINTS.traps : null;
  const blueprint = table?.[String(kind || '').toLowerCase()] || null;
  return blueprint ? { ...blueprint } : null;
}

/**
 * DK2-style blueprint -> crate -> Imp delivery logistics.
 *
 * Integration order is intentionally flexible.  Calling update after
 * EntityDirector.update gives the most natural movement; calling it before
 * still produces deterministic state transitions on the next tick.
 */
export class WorkshopDirector {
  constructor(runtime = {}, world = null, entities = null, defenses = null, effects = null, audio = null, options = {}) {
    this.runtime = runtime || {};
    this.world = world;
    this.entities = entities;
    this.defenses = defenses;
    this.effects = effects;
    this.audio = audio;
    this.scene = this.runtime.scene || null;
    this.options = {
      workRatePerTile: Math.max(0.01, number(options.workRatePerTile, 0.9)),
      minimumWorkRate: Math.max(0, number(options.minimumWorkRate, 0)),
      cratesPerTile: Math.max(1, integer(options.cratesPerTile, 3)),
      deliveryRange: Math.max(0.08, number(options.deliveryRange, 0.22)),
      serviceDuration: Math.max(0.15, number(options.serviceDuration, 0.85)),
      jobTimeout: Math.max(5, number(options.jobTimeout, 30)),
      crateRefundFraction: clamp(number(options.crateRefundFraction, 0.5), 0, 1),
    };
    this.queue = [];
    this.crates = new Map();
    this.jobs = new Map();
    this._serial = 0;
    this._time = 0;
    this._disposed = false;
    this.lastError = '';
    this.root = null;
    this._materials = new Map();
    this._crateRoots = new Map();
    this._createVisualKit();

    if (this.runtime.workshopData) this.restore(this.runtime.workshopData);
  }

  // ------------------------------------------------------------
  // Catalog, queue and manufacturing
  // ------------------------------------------------------------

  catalog() {
    return clonePlain(WORKSHOP_BLUEPRINTS);
  }

  canQueueBlueprint(category, kind, options = {}) {
    const blueprint = blueprintFor(category, kind);
    if (!blueprint) return { ok: false, reason: `Unknown Workshop blueprint: ${category}/${kind}` };
    const quantity = integer(options.quantity, 1);
    if (quantity < 1) return { ok: false, reason: 'Blueprint quantity must be at least one' };
    if (this._disposed) return { ok: false, reason: 'Workshop has been disposed' };
    return { ok: true, blueprint, quantity };
  }

  queueBlueprint(category, kind, options = {}) {
    const check = this.canQueueBlueprint(category, kind, options);
    if (!check.ok) return this._fail(check.reason);
    const id = String(options.id || `blueprint-${++this._serial}`);
    if (this.getBlueprint(id)) return this._fail(`Blueprint id already exists: ${id}`);
    const item = {
      id,
      category: check.blueprint.category,
      kind: check.blueprint.id,
      name: check.blueprint.name,
      workCost: check.blueprint.workCost,
      quantity: check.quantity,
      completed: 0,
      progress: clamp(number(options.progress, 0), 0, check.blueprint.workCost),
      paidWork: clamp(number(options.paidWork, options.progress || 0), 0, check.blueprint.workCost),
      priority: number(options.priority, 0),
      state: 'queued',
      createdAt: number(options.createdAt, this._time),
      delivery: options.delivery ? {
        x: integer(options.delivery.x),
        z: integer(options.delivery.z),
        orientation: options.delivery.orientation,
      } : null,
    };
    this.queue.push(item);
    this._sortQueue();
    this._emit('workshopBlueprintQueued', { blueprint: this._plainBlueprint(item) });
    return item;
  }

  queueDoor(kind, options = {}) { return this.queueBlueprint('door', kind, options); }
  queueTrap(kind, options = {}) { return this.queueBlueprint('trap', kind, options); }

  /** Queue manufacture and remember where an Imp should install the crate. */
  orderDefense(category, kind, x, z, options = {}) {
    const blueprint = blueprintFor(category, kind);
    if (!blueprint) return this._fail(`Unknown Workshop blueprint: ${category}/${kind}`);
    const tx = integer(x);
    const tz = integer(z);
    const method = blueprint.category === 'door' ? 'canPlaceDoor' : 'canPlaceTrap';
    const check = this.defenses?.[method]?.(blueprint.id, tx, tz, options);
    if (!check?.ok) return this._fail(check?.reason || `${blueprint.name} cannot be installed there`);
    const duplicate = this.queue.some((item) => item.delivery?.x === tx && item.delivery?.z === tz)
      || Array.from(this.jobs.values()).some((job) => job.type === 'delivery' && job.x === tx && job.z === tz);
    if (duplicate) return this._fail('A Workshop delivery is already assigned to that tile');
    const crate = Array.from(this.crates.values())
      .filter((item) => item.category === blueprint.category && item.kind === blueprint.id && !['carried', 'reserved'].includes(item.state))
      .sort(sortId)[0];
    if (crate) return this.requestDelivery(crate, tx, tz, options);
    return this.queueBlueprint(blueprint.category, blueprint.id, {
      priority: number(options.priority, 1),
      delivery: { x: tx, z: tz, orientation: options.orientation },
    });
  }

  orderDoor(kind, x, z, options = {}) { return this.orderDefense('door', kind, x, z, options); }
  orderTrap(kind, x, z, options = {}) { return this.orderDefense('trap', kind, x, z, options); }

  /** Cancel unfinished manufacture and return all work already committed. */
  cancelBlueprint(blueprintOrId) {
    const item = this._blueprint(blueprintOrId);
    if (!item) return false;
    const refund = Math.max(0, item.paidWork);
    this._refundWork(refund);
    this.queue.splice(this.queue.indexOf(item), 1);
    this._emit('workshopBlueprintCancelled', { blueprint: this._plainBlueprint(item), refund });
    return refund;
  }

  reprioritizeBlueprint(blueprintOrId, priority) {
    const item = this._blueprint(blueprintOrId);
    if (!item) return false;
    item.priority = number(priority, item.priority);
    this._sortQueue();
    return true;
  }

  getBlueprint(id) { return this.queue.find((item) => item.id === String(id)) || null; }
  listBlueprints() { return this.queue.map((item) => this._plainBlueprint(item)); }

  /** The instantaneous deterministic production rate for UI and tests. */
  manufactureRate() {
    const tiles = this.storageCells().length;
    return tiles > 0 ? this.options.minimumWorkRate + tiles * this.options.workRatePerTile : 0;
  }

  // ------------------------------------------------------------
  // Crates and storage
  // ------------------------------------------------------------

  listCrates() { return Array.from(this.crates.values()).sort(sortId).map((crate) => this._plainCrate(crate)); }
  getCrate(id) { return this.crates.get(String(id)) || null; }

  /**
   * Cancelling a physical crate recovers half of its embodied work by default.
   * A crate assigned to an Imp first cancels its delivery and is returned to a
   * Workshop cell if one is available.
   */
  cancelCrate(crateOrId, refundFraction = this.options.crateRefundFraction) {
    const crate = this._crate(crateOrId);
    if (!crate) return false;
    for (const job of this._jobsForCrate(crate.id)) this.cancelJob(job, { returnCrate: true });
    const refund = Math.floor(crate.workCost * clamp(number(refundFraction, 0), 0, 1));
    this._removeCrate(crate);
    this._refundWork(refund);
    this._emit('workshopCrateCancelled', { crate: this._plainCrate(crate), refund });
    return refund;
  }

  /** Moves orphaned or returned crates into valid claimed Workshop slots. */
  placeStoredCrates() {
    let placed = 0;
    for (const crate of Array.from(this.crates.values()).sort(sortId)) {
      if (crate.state === 'carried' || this._isValidStorage(crate.x, crate.z)) continue;
      const slot = this._findStorageSlot();
      if (!slot) continue;
      crate.x = slot.x; crate.z = slot.z; crate.slot = slot.slot; crate.state = 'stored';
      this._placeCrateVisual(crate);
      placed++;
    }
    return placed;
  }

  storageCells() {
    const result = [];
    const size = integer(this.world?.gridSize, 0);
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        const cell = this.world?.getCell?.(x, z);
        if (cell?.type === 'claimed' && cell.room === 'workshop' && cell.discovered) result.push(cell);
      }
    }
    return result;
  }

  // ------------------------------------------------------------
  // Delivery and service jobs
  // ------------------------------------------------------------

  canDeliver(crateOrId, x, z) {
    const crate = this._crate(crateOrId);
    if (!crate) return { ok: false, reason: 'Unknown Workshop crate' };
    if (crate.state === 'carried') return { ok: false, reason: 'Crate is already being carried' };
    const method = crate.category === 'door' ? 'canPlaceDoor' : 'canPlaceTrap';
    const check = this.defenses?.[method]?.(crate.kind, x, z) || { ok: false, reason: 'DefensesDirector is required for delivery' };
    return check.ok ? { ok: true, crate, x: Math.round(x), z: Math.round(z) } : check;
  }

  requestDelivery(crateOrId, x, z, options = {}) {
    const check = this.canDeliver(crateOrId, x, z);
    if (!check.ok) return this._fail(check.reason);
    const id = String(options.id || `delivery-${++this._serial}`);
    if (this.jobs.has(id)) return this._fail(`Workshop job id already exists: ${id}`);
    const job = {
      id, type: 'delivery', state: 'waiting', crateId: check.crate.id,
      x: check.x, z: check.z, orientation: options.orientation,
      assigneeId: null, startedAt: null, duration: 0, elapsed: 0,
      createdAt: this._time,
    };
    this.jobs.set(id, job);
    check.crate.state = 'reserved';
    this._emit('workshopDeliveryQueued', { job: this._plainJob(job), crate: this._plainCrate(check.crate) });
    return job;
  }

  /** Queue a paid Imp repair errand.  Cancellation returns the reserved work. */
  requestRepair(doorOrId, amount = null, options = {}) {
    const door = this.defenses?.get?.(doorOrId) || doorOrId;
    if (!door || door.category !== 'door' || door.broken || door.hp >= door.maxHp) return this._fail('That door cannot be repaired');
    const definition = DOOR_DEFINITIONS[door.kind];
    if (!definition) return this._fail('Unknown door type');
    const repair = Math.min(door.maxHp - door.hp, Math.max(1, number(amount, definition.repairRate)));
    const workCost = Math.max(1, Math.ceil((repair / door.maxHp) * definition.workCost * 0.55));
    return this._queueService('repair', door, workCost, { ...options, amount: repair });
  }

  /** Queue a paid Imp reload errand.  DefensesDirector performs the final arm timer. */
  requestReload(trapOrId, options = {}) {
    const trap = this.defenses?.get?.(trapOrId) || trapOrId;
    if (!trap || trap.category !== 'trap' || trap.reloading || trap.charges >= trap.maxCharges) return this._fail('That trap does not need reloading');
    const definition = TRAP_DEFINITIONS[trap.kind];
    if (!definition) return this._fail('Unknown trap type');
    const missing = trap.maxCharges - trap.charges;
    const workCost = Math.max(1, Math.ceil(definition.reloadCost * missing / trap.maxCharges));
    return this._queueService('reload', trap, workCost, { ...options, missing });
  }

  cancelJob(jobOrId, options = {}) {
    const job = this._job(jobOrId);
    if (!job) return false;
    const crate = job.crateId ? this._crate(job.crateId) : null;
    const imp = this._entity(job.assigneeId);
    if (imp) this._releaseImp(imp);
    if (crate) {
      crate.state = 'stored';
      if (options.returnCrate !== false) this._returnCrate(crate, imp);
    }
    const refund = Math.max(0, number(job.reservedWork, 0));
    this._refundWork(refund);
    this.jobs.delete(job.id);
    this._emit('workshopJobCancelled', { job: this._plainJob(job), refund });
    return refund;
  }

  listJobs() { return Array.from(this.jobs.values()).sort(sortId).map((job) => this._plainJob(job)); }
  getJob(id) { return this.jobs.get(String(id)) || null; }

  // ------------------------------------------------------------
  // Simulation and persistence
  // ------------------------------------------------------------

  update(dt, time = undefined) {
    if (this._disposed) return;
    const step = clamp(number(dt), 0, MAX_STEP);
    this._time = Number.isFinite(time) ? number(time) : this._time + step;
    this._manufacture(step);
    this.placeStoredCrates();
    for (const job of Array.from(this.jobs.values()).sort(sortId)) this._updateJob(job, step);
    this._updateCrateVisuals();
  }

  snapshot() {
    return {
      version: 1,
      serial: this._serial,
      time: this._time,
      queue: this.listBlueprints(),
      crates: this.listCrates(),
      jobs: this.listJobs(),
    };
  }

  serialize() { return this.snapshot(); }

  restore(data = {}) {
    this._clearState();
    this._serial = Math.max(0, integer(data.serial, 0));
    this._time = Math.max(0, number(data.time, 0));
    for (const raw of Array.isArray(data.queue) ? data.queue : []) {
      const blueprint = blueprintFor(raw.category, raw.kind);
      if (!blueprint || !raw.id) continue;
      this.queue.push({
        id: String(raw.id), category: blueprint.category, kind: blueprint.id, name: blueprint.name, workCost: blueprint.workCost,
        quantity: Math.max(1, integer(raw.quantity, 1)), completed: Math.max(0, integer(raw.completed, 0)),
        progress: clamp(number(raw.progress), 0, blueprint.workCost), paidWork: clamp(number(raw.paidWork, raw.progress), 0, blueprint.workCost),
        priority: number(raw.priority), state: raw.state === 'blocked' ? 'blocked' : 'queued', createdAt: number(raw.createdAt),
        delivery: raw.delivery ? { x: integer(raw.delivery.x), z: integer(raw.delivery.z), orientation: raw.delivery.orientation } : null,
      });
    }
    this._sortQueue();
    for (const raw of Array.isArray(data.crates) ? data.crates : []) {
      const blueprint = blueprintFor(raw.category, raw.kind);
      if (!blueprint || !raw.id) continue;
      const crate = {
        id: String(raw.id), category: blueprint.category, kind: blueprint.id, name: blueprint.name, workCost: blueprint.workCost,
        x: integer(raw.x, -1), z: integer(raw.z, -1), slot: Math.max(0, integer(raw.slot, 0)),
        state: raw.state === 'carried' ? 'stored' : (raw.state === 'reserved' ? 'reserved' : 'stored'),
        createdAt: number(raw.createdAt, this._time), blueprintId: raw.blueprintId || null,
      };
      this.crates.set(crate.id, crate);
      this._serial = Math.max(this._serial, this._numericSuffix(crate.id));
      this._placeCrateVisual(crate);
    }
    for (const raw of Array.isArray(data.jobs) ? data.jobs : []) {
      if (!raw?.id || !['delivery', 'repair', 'reload'].includes(raw.type)) continue;
      if (raw.type === 'delivery' && !this.crates.has(String(raw.crateId))) continue;
      this.jobs.set(String(raw.id), {
        id: String(raw.id), type: raw.type, state: 'waiting', crateId: raw.crateId ? String(raw.crateId) : null,
        defenseId: raw.defenseId ? String(raw.defenseId) : null, x: integer(raw.x), z: integer(raw.z), orientation: raw.orientation,
        amount: number(raw.amount), missing: integer(raw.missing), reservedWork: Math.max(0, number(raw.reservedWork)),
        assigneeId: null, startedAt: null, duration: Math.max(0, number(raw.duration)), elapsed: 0, createdAt: number(raw.createdAt),
      });
      this._serial = Math.max(this._serial, this._numericSuffix(raw.id));
    }
    this.placeStoredCrates();
    return this.snapshot();
  }

  load(data) { return this.restore(data); }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._clearState();
    for (const material of this._materials.values()) material.dispose?.(false, true);
    this._materials.clear();
    this.root?.dispose?.(false, false);
    this.root = null;
  }

  // ------------------------------------------------------------
  // Internals: deterministic manufacture
  // ------------------------------------------------------------

  _manufacture(dt) {
    const item = this.queue.find((candidate) => candidate.quantity > 0);
    if (!item || !dt) return;
    const storage = this._findStorageSlot();
    if (!storage) { item.state = 'blocked'; return; }
    item.state = 'manufacturing';
    const remaining = Math.max(0, item.workCost - item.progress);
    const availableRate = this.manufactureRate() * dt;
    const availableEconomy = this.getManufacturing();
    const committed = Math.min(remaining, availableRate, availableEconomy);
    if (committed <= 0 || !this._spendWork(committed)) return;
    item.progress += committed;
    item.paidWork += committed;
    if (item.progress + 1e-7 < item.workCost) return;

    const crate = this._makeCrate(item, storage);
    if (!crate) return; // Should be unreachable after the storage check; preserve paid work if it is not.
    item.completed++;
    item.quantity--;
    item.progress = 0;
    item.paidWork = 0;
    const delivery = item.delivery;
    item.delivery = null;
    item.state = item.quantity > 0 ? 'queued' : 'complete';
    if (item.quantity <= 0) this.queue.splice(this.queue.indexOf(item), 1);
    this._emit('workshopManufactured', { blueprint: this._plainBlueprint(item), crate: this._plainCrate(crate) });
    if (delivery && !this.requestDelivery(crate, delivery.x, delivery.z, { orientation: delivery.orientation })) {
      this._emit('workshopDeliveryFailed', { crate: this._plainCrate(crate), reason: this.lastError });
    }
  }

  _makeCrate(item, slot) {
    if (!slot) return null;
    const crate = {
      id: `crate-${++this._serial}`,
      category: item.category, kind: item.kind, name: item.name, workCost: item.workCost,
      x: slot.x, z: slot.z, slot: slot.slot, state: 'stored', createdAt: this._time, blueprintId: item.id,
    };
    this.crates.set(crate.id, crate);
    this._placeCrateVisual(crate);
    this._effect('claim', { x: crate.x, y: 0.15, z: crate.z }, 0xe3a23b, 0.34);
    return crate;
  }

  _queueService(type, defense, reservedWork, options = {}) {
    if (!this._spendWork(reservedWork)) return this._fail(`Need ${reservedWork} manufacturing work`);
    const id = String(options.id || `${type}-${++this._serial}`);
    if (this.jobs.has(id)) { this._refundWork(reservedWork); return this._fail(`Workshop job id already exists: ${id}`); }
    const job = {
      id, type, state: 'waiting', defenseId: String(defense.id), crateId: null,
      x: number(defense.x), z: number(defense.z), amount: number(options.amount), missing: integer(options.missing),
      reservedWork, assigneeId: null, startedAt: null, duration: Math.max(0.15, number(options.duration, this.options.serviceDuration)),
      elapsed: 0, createdAt: this._time,
    };
    this.jobs.set(id, job);
    this._emit('workshopServiceQueued', { job: this._plainJob(job) });
    return job;
  }

  _updateJob(job, dt) {
    if (job.state === 'waiting') this._assignJob(job);
    if (job.assigneeId && Number.isFinite(job.startedAt) && this._time - job.startedAt >= this.options.jobTimeout) {
      // An unreachable crate/target must not reserve its Imp, crate, or paid
      // service work forever. Cancellation returns all reserved resources.
      this.cancelJob(job, { returnCrate: true });
      this._emit('workshopJobTimedOut', { job: this._plainJob(job) });
      return;
    }
    const imp = this._entity(job.assigneeId);
    if (!imp || imp.state === 'death' || imp.hp <= 0) {
      if (job.assigneeId) this._releaseImp(imp);
      job.assigneeId = null; job.state = 'waiting';
      return;
    }
    if (job.type === 'delivery') this._updateDelivery(job, imp);
    else this._updateService(job, imp, dt);
  }

  _assignJob(job) {
    const imp = this._idleImp();
    if (!imp) return false;
    job.assigneeId = imp.id;
    job.startedAt = this._time;
    imp.userData ||= {};
    imp.userData.workshopJobId = job.id;
    if (job.type === 'delivery') {
      const crate = this._crate(job.crateId);
      if (!crate) { this.cancelJob(job, { returnCrate: false }); return false; }
      job.state = 'to-crate';
      this._moveImp(imp, crate.x, crate.z, 'carry');
    } else {
      job.state = 'to-defense';
      this._moveImp(imp, job.x, job.z, 'carry');
    }
    return true;
  }

  _updateDelivery(job, imp) {
    const crate = this._crate(job.crateId);
    if (!crate) { this.cancelJob(job, { returnCrate: false }); return; }
    if (job.state === 'to-crate') {
      if (!this._at(imp, crate.x, crate.z)) return;
      crate.state = 'carried';
      this._hideCrateVisual(crate);
      this.entities?.setCarrying?.(imp, 1);
      job.state = 'to-target';
      this._moveImp(imp, job.x, job.z, 'carry');
      return;
    }
    if (job.state !== 'to-target' || !this._at(imp, job.x, job.z)) return;
    const method = crate.category === 'door' ? 'placeDoor' : 'placeTrap';
    const placed = this.defenses?.[method]?.(crate.kind, job.x, job.z, { free: true, orientation: job.orientation });
    if (!placed) {
      this._returnCrate(crate, imp);
      job.state = 'waiting'; job.assigneeId = null;
      this._releaseImp(imp);
      return;
    }
    this._removeCrate(crate);
    this._releaseImp(imp);
    this.jobs.delete(job.id);
    this._effect('claim', { x: job.x, y: 0.15, z: job.z }, 0xe3a23b, 0.46);
    this._emit('workshopDelivered', { job: this._plainJob(job), defense: placed });
  }

  _updateService(job, imp, dt) {
    if (job.state === 'to-defense') {
      if (!this._at(imp, job.x, job.z)) return;
      job.state = 'servicing'; job.elapsed = 0;
      this.entities?.setState?.(imp, 'work');
      return;
    }
    if (job.state !== 'servicing') return;
    job.elapsed += dt;
    if (job.elapsed < job.duration) return;
    const defense = this.defenses?.get?.(job.defenseId);
    const done = job.type === 'repair'
      ? this.defenses?.repairDoor?.(defense, job.amount, { free: true })
      : this.defenses?.reloadTrap?.(defense, { free: true });
    if (!done) {
      // The target may have been sold or fully serviced by another Imp.  No
      // resource is lost: the reservation was not consumed by the defense.
      this._refundWork(job.reservedWork);
      this._emit('workshopServiceFailed', { job: this._plainJob(job), refund: job.reservedWork });
    } else this._emit('workshopServiceComplete', { job: this._plainJob(job), defense });
    this._releaseImp(imp);
    this.jobs.delete(job.id);
  }

  // ------------------------------------------------------------
  // Internals: storage, entities and economy
  // ------------------------------------------------------------

  _findStorageSlot(excludingCrateId = null) {
    const used = new Set();
    for (const crate of this.crates.values()) {
      if (crate.id !== excludingCrateId && crate.state !== 'carried' && this._isValidStorage(crate.x, crate.z)) used.add(`${keyOf(crate.x, crate.z)}:${crate.slot}`);
    }
    for (const cell of this.storageCells()) {
      for (let slot = 0; slot < this.options.cratesPerTile; slot++) {
        if (!used.has(`${keyOf(cell.x, cell.z)}:${slot}`)) return { x: cell.x, z: cell.z, slot };
      }
    }
    return null;
  }

  _isValidStorage(x, z) {
    const cell = this.world?.getCell?.(x, z);
    return Boolean(cell?.type === 'claimed' && cell.room === 'workshop' && cell.discovered);
  }

  _returnCrate(crate, imp = null) {
    const slot = this._findStorageSlot(crate.id);
    if (slot) {
      crate.x = slot.x; crate.z = slot.z; crate.slot = slot.slot; crate.state = 'stored';
    } else if (imp?.root?.position) {
      crate.x = Math.round(imp.root.position.x); crate.z = Math.round(imp.root.position.z); crate.slot = 0; crate.state = 'orphaned';
    } else crate.state = 'orphaned';
    this._placeCrateVisual(crate);
  }

  _idleImp() {
    const imps = this.entities?.list?.('imps') || this.entities?.getAll?.()?.filter((entity) => entity.type === 'imp') || [];
    return imps
      .filter((imp) => imp?.hp > 0 && imp.state === 'idle' && !imp.work && !imp.destination && !imp.target && !imp.userData?.workshopJobId)
      .sort(sortId)[0] || null;
  }

  _entity(id) { return id ? (this.entities?.get?.(id) || this.entities?.getById?.(id) || null) : null; }

  _moveImp(imp, x, z, state) {
    const moved = this.entities?.moveTo?.(imp, { x, y: 0, z }, { state });
    if (moved === false) { imp.destination = null; return false; }
    return true;
  }

  _releaseImp(imp) {
    if (!imp) return;
    if (imp.userData) delete imp.userData.workshopJobId;
    imp.navigationRequest?.cancel?.();
    imp.navigationRequest = null;
    imp.navigationSequence = (imp.navigationSequence || 0) + 1;
    imp.destination = null;
    if (imp.path) imp.path.length = 0;
    this.entities?.setCarrying?.(imp, 0);
    this.entities?.setState?.(imp, 'idle');
  }

  _at(imp, x, z) {
    const position = imp?.root?.position || imp?.position;
    return Boolean(position && Math.hypot(position.x - x, position.z - z) <= this.options.deliveryRange);
  }

  getManufacturing() {
    const value = this.runtime?.economy?.get?.('manufacturing');
    return Number.isFinite(value) ? value : number(this.runtime?.manufacturing, 0);
  }

  _spendWork(amount) {
    const safe = Math.max(0, number(amount));
    if (!safe) return true;
    if (this.runtime?.economy?.spend) return this.runtime.economy.spend('manufacturing', safe) !== false;
    if (this.getManufacturing() + 1e-7 < safe) return false;
    this.runtime.manufacturing = this.getManufacturing() - safe;
    return true;
  }

  _refundWork(amount) {
    const safe = Math.max(0, number(amount));
    if (!safe) return;
    if (this.runtime?.economy?.add) this.runtime.economy.add('manufacturing', safe);
    else this.runtime.manufacturing = this.getManufacturing() + safe;
  }

  _jobsForCrate(crateId) { return Array.from(this.jobs.values()).filter((job) => job.crateId === crateId); }
  _blueprint(value) { return typeof value === 'object' && value ? this.getBlueprint(value.id) : this.getBlueprint(value); }
  _crate(value) { return typeof value === 'object' && value ? this.getCrate(value.id) : this.getCrate(value); }
  _job(value) { return typeof value === 'object' && value ? this.getJob(value.id) : this.getJob(value); }

  _sortQueue() { this.queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt || sortId(a, b)); }
  _numericSuffix(id) { const found = String(id).match(/(\d+)$/); return found ? Number(found[1]) : 0; }
  _fail(reason) { this.lastError = String(reason || 'Workshop command failed'); return false; }
  _emit(name, detail) { this.runtime?.events?.emit?.(name, detail); }
  _effect(name, ...args) { this.effects?.[name]?.(...args); }

  _plainBlueprint(item) { return { ...item }; }
  _plainCrate(crate) { return { ...crate }; }
  _plainJob(job) { return { ...job }; }

  // ------------------------------------------------------------
  // Optional Babylon crate visuals
  // ------------------------------------------------------------

  _createVisualKit() {
    if (!B || !this.scene) return;
    this.root = new B.TransformNode('workshop-logistics', this.scene);
    this.root.metadata = { kind: 'workshop-logistics' };
    const createMaterial = (name, color, metallic, emissive = null) => {
      const material = new B.PBRMaterial(`workshop.mat.${name}`, this.scene);
      material.albedoColor = B.Color3.FromHexString(color);
      material.metallic = metallic;
      material.roughness = 0.62;
      if (emissive) { material.emissiveColor = B.Color3.FromHexString(emissive); material.emissiveIntensity = 0.22; }
      this._materials.set(name, material);
    };
    createMaterial('wood', '#694227', 0.02);
    createMaterial('iron', '#56616d', 0.72);
    createMaterial('rune', '#7c41d1', 0.28, '#7c41d1');
  }

  _placeCrateVisual(crate) {
    if (!this.root || !B) return;
    let root = this._crateRoots.get(crate.id);
    if (!root) {
      root = new B.TransformNode(`workshop-crate:${crate.id}`, this.scene);
      root.parent = this.root;
      root.metadata = { workshopCrateId: crate.id, kind: 'workshop-crate' };
      const box = B.MeshBuilder.CreateBox(`workshop-crate.box:${crate.id}`, { width: 0.34, height: 0.26, depth: 0.3 }, this.scene);
      box.parent = root; box.position.y = 0.16; box.material = this._materials.get('wood');
      box.metadata = { workshopCrateId: crate.id };
      const band = B.MeshBuilder.CreateBox(`workshop-crate.band:${crate.id}`, { width: 0.355, height: 0.055, depth: 0.315 }, this.scene);
      band.parent = root; band.position.y = 0.16; band.material = crate.category === 'door' ? this._materials.get('iron') : this._materials.get('rune');
      band.metadata = { workshopCrateId: crate.id };
      this._crateRoots.set(crate.id, root);
    }
    const offsets = [[-0.24, -0.19], [0.24, -0.19], [0, 0.22]];
    const [ox, oz] = offsets[crate.slot % offsets.length];
    root.position.set(crate.x + ox, 0, crate.z + oz);
    root.setEnabled(crate.state !== 'carried');
  }

  _hideCrateVisual(crate) { this._crateRoots.get(crate.id)?.setEnabled(false); }

  _updateCrateVisuals() {
    if (!this.root) return;
    for (const crate of this.crates.values()) {
      const root = this._crateRoots.get(crate.id);
      if (!root || crate.state === 'carried') continue;
      root.position.y = Math.sin(this._time * 2.4 + this._numericSuffix(crate.id)) * 0.008;
    }
  }

  _removeCrate(crate) {
    this.crates.delete(crate.id);
    const root = this._crateRoots.get(crate.id);
    root?.dispose?.(false, false);
    this._crateRoots.delete(crate.id);
  }

  _clearState() {
    for (const job of this.jobs.values()) this._releaseImp(this._entity(job.assigneeId));
    this.jobs.clear();
    for (const crate of this.crates.values()) this._removeCrate(crate);
    this.crates.clear();
    this.queue.length = 0;
  }
}
