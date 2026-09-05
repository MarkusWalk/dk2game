// ============================================================
// JOB QUEUE
// ============================================================
// Tile orders are marks, not edits: clicking a tile queues a job here and an
// Imp walks over and performs the work.  Priority mirrors the original build —
// dig (player-commanded expansion) outranks claim, which outranks reinforce
// (passive fortification) — so aggressive expansion always wins the idle Imp.
//
// Deliberately renderer-independent, like navigation.js: no Babylon imports.
// It reads the world grid, hands work to the entity director (which owns
// pathing through runtime.navigation) and never touches meshes.

export const JOB_PRIORITY = ['dig', 'claim', 'claim_wall', 'reinforce'];

// How long an Imp stands on the tile before the work resolves.
const JOB_DURATIONS = { dig: 1.6, claim: 0.9, claim_wall: 1.2, reinforce: 1.4 };

// Tile states each job type is still meaningful on.  These mirror the guards
// inside world.dig/claim/reinforce so a queued job can never outlive its own
// target: dig a marked wall by hand and the queued job prunes itself.
// 'claim_wall' keeps its priority slot for parity with the original design;
// this build has no enemy walls to capture yet, so nothing queues one.
const JOB_TARGETS = {
  dig: new Set(['rock', 'gold', 'reinforced']),
  claim: new Set(['earth']),
  claim_wall: new Set(['earth']),
  reinforce: new Set(['rock', 'earth', 'claimed']),
};

// Territory: a tile only auto-claims once your land actually touches it.
const OWNED = new Set(['claimed', 'reinforced', 'heart', 'portal']);
const CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const MAX_ATTEMPTS = 3;

const keyOf = (x, z) => `${Math.round(x)},${Math.round(z)}`;

const REJECTIONS = {
  dig: 'Only rock and gold can be excavated',
  claim: 'Only bare earth floor can be claimed',
  claim_wall: 'Only bare earth floor can be claimed',
  reinforce: 'Only your own rock and floor can be reinforced',
};

/**
 * Owns the pending work queue and matches idle Imps to it.
 *
 * Constructed as `new JobsDirector(runtime, world, entities)`; drive it with
 * `update(dt)` from the simulation step and `dispose()` on teardown.  Every
 * other module reaches it through `runtime.jobs`, which the constructor sets,
 * and every one of those call sites is optional-chained — the game runs
 * unchanged when the director is absent.
 */
export class JobsDirector {
  constructor(runtime, world, entities, options = {}) {
    this.runtime = runtime || {};
    this.world = world || this.runtime.world || null;
    this.entities = entities || this.runtime.entities || null;
    this.jobs = new Map();
    this.lastError = null;
    this.assignInterval = Number(options.assignInterval) || 0.35;
    this._assignClock = 0;
    this._serial = 0;
    this._disposed = false;
    if (this.runtime) this.runtime.jobs = this;
  }

  // ------------------------------------------------------------
  // Queue API
  // ------------------------------------------------------------

  getAt(x, z) {
    return this.jobs.get(keyOf(x, z)) || null;
  }

  has(x, z, type = null) {
    const job = this.getAt(x, z);
    return Boolean(job && (!type || job.type === type));
  }

  list() {
    return Array.from(this.jobs.values());
  }

  /**
   * Queue work on a tile.  Idempotent per tile: marking the same tile twice
   * returns the existing job rather than stacking a second one.  Returns the
   * job, or null with `lastError` set to something the player can be told.
   */
  queue(type, x, z) {
    this.lastError = null;
    const kind = String(type || '');
    if (!JOB_TARGETS[kind]) {
      this.lastError = `Unknown order: ${kind}`;
      return null;
    }
    const gx = Math.round(x);
    const gz = Math.round(z);
    const cell = this.world?.getCell?.(gx, gz);
    if (!cell) {
      this.lastError = 'That tile lies beyond the dungeon';
      return null;
    }
    const existing = this.jobs.get(keyOf(gx, gz));
    if (existing) {
      // A dig order is the player's own command and evicts passive work that
      // was auto-queued on the same tile; anything else defers to what stands.
      if (existing.type === kind || kind !== 'dig') return existing;
      this.cancel(existing);
    }
    if (!JOB_TARGETS[kind].has(cell.type)) {
      this.lastError = REJECTIONS[kind];
      return null;
    }
    const job = {
      id: `job-${++this._serial}`,
      type: kind, x: gx, z: gz,
      claimedBy: null, progress: 0, attempts: 0,
    };
    this.jobs.set(keyOf(gx, gz), job);
    this._emit('jobQueued', { job: { ...job } });
    return job;
  }

  /** Drop a job and free whoever was walking to it. */
  cancel(jobOrX, z) {
    const job = typeof jobOrX === 'object' && jobOrX ? jobOrX : this.getAt(jobOrX, z);
    if (!job || this.jobs.get(keyOf(job.x, job.z)) !== job) return false;
    this._release(job, { clearWork: true });
    this.jobs.delete(keyOf(job.x, job.z));
    this._emit('jobCancelled', { job: { ...job } });
    return true;
  }

  cancelAt(x, z) {
    return this.cancel(x, z);
  }

  clear() {
    for (const job of this.list()) this.cancel(job);
  }

  // ------------------------------------------------------------
  // Assignment
  // ------------------------------------------------------------

  /**
   * Hand an idle Imp its best job — highest priority first, nearest inside
   * that band.  Returns true when the Imp took one.
   */
  requestJob(entity) {
    if (!entity || !this._available(entity)) return false;
    const from = entity.root?.position;
    if (!from) return false;

    for (const type of JOB_PRIORITY) {
      let best = null;
      let bestDistance = Infinity;
      for (const job of this.jobs.values()) {
        if (job.type !== type || job.claimedBy) continue;
        if (!this._valid(job)) continue;
        // A tile with no walkable neighbour yet (the middle of a marked block)
        // is not reachable *yet* — skip it, but leave the player's mark alone.
        if (!this._approachable(job)) continue;
        const distance = (job.x - from.x) ** 2 + (job.z - from.z) ** 2;
        if (distance < bestDistance) { bestDistance = distance; best = job; }
      }
      if (!best) continue;
      best.claimedBy = entity.id;
      const action = best.type === 'claim_wall' ? 'claim' : best.type;
      const assigned = this.entities?.assignWork?.(entity, action, best.x, best.z, {
        duration: JOB_DURATIONS[best.type],
        jobId: best.id,
      });
      if (assigned === false || assigned === undefined) {
        best.claimedBy = null;
        this._failed(best);
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Called by the entity director when an Imp finishes (or fails) the work it
   * was carrying.  Retires the job and cascades border work onto the tiles the
   * change just exposed.
   */
  onWorkComplete(entity, work, succeeded = true) {
    if (!work) return;
    const job = (work.jobId && this._byId(work.jobId)) || this.getAt(work.x, work.z);
    if (job && (!job.claimedBy || job.claimedBy === entity?.id)) {
      if (succeeded !== false && !this._valid(job)) {
        this.jobs.delete(keyOf(job.x, job.z));
        this._emit('jobCompleted', { job: { ...job }, entityId: entity?.id || null });
      } else {
        // The world refused the action (tile changed under the Imp) — release
        // it back to the queue rather than leaving it claimed forever.
        job.claimedBy = null;
        this._failed(job);
      }
    }
    this.queueBorderJobsAround(work.x, work.z);
  }

  /** Free any job an Imp was holding (death, possession, reassignment). */
  releaseEntity(entityOrId) {
    const id = typeof entityOrId === 'object' && entityOrId ? entityOrId.id : entityOrId;
    if (!id) return;
    for (const job of this.jobs.values()) {
      if (job.claimedBy === id) job.claimedBy = null;
    }
  }

  // ------------------------------------------------------------
  // Territory cascade
  // ------------------------------------------------------------

  /**
   * Re-queue border work after a tile's walkability changed.  Digging a tile
   * exposes floor your Imps can now claim; claiming floor exposes rock they
   * can now fortify.  Dig itself stays player-commanded — nothing here ever
   * queues one.
   */
  queueBorderJobsAround(x, z) {
    const gx = Math.round(x);
    const gz = Math.round(z);
    const cell = this.world?.getCell?.(gx, gz);
    if (!cell) return;
    if (cell.type === 'earth' && this._ownedNeighbour(gx, gz)) this.queue('claim', gx, gz);
    for (const [dx, dz] of CARDINAL) {
      const nx = gx + dx;
      const nz = gz + dz;
      const neighbour = this.world?.getCell?.(nx, nz);
      if (!neighbour || this.jobs.has(keyOf(nx, nz))) continue;
      if (neighbour.type === 'earth' && this._ownedNeighbour(nx, nz)) this.queue('claim', nx, nz);
      else if (neighbour.type === 'rock' && OWNED.has(cell.type)) this.queue('reinforce', nx, nz);
    }
  }

  // ------------------------------------------------------------
  // Tick
  // ------------------------------------------------------------

  update(dt = 0) {
    if (this._disposed) return;
    const step = Math.max(0, Number(dt) || 0);

    for (const job of this.list()) {
      if (!this._valid(job)) { this.cancel(job); continue; }
      if (!job.claimedBy) continue;
      const worker = this.entities?.get?.(job.claimedBy);
      if (!worker || worker.hp <= 0 || worker.state === 'death') {
        // Dead or removed: the job is free again, and costs nobody an attempt.
        job.claimedBy = null;
        continue;
      }
      if (worker.autonomous === false || worker.userData?.workshopJobId) {
        // Possessed, or the Workshop claimed it — take the order back.
        this._release(job, { clearWork: true });
        continue;
      }
      if (worker.work?.jobId !== job.id) { job.claimedBy = null; continue; }
      // Standing still with work in hand means the path request failed; that
      // work would otherwise fire wherever the Imp happens to wander to.
      const busy = worker.destination || worker.navigationRequest?.status === 'pending'
        || ['work', 'dig', 'hit'].includes(worker.state);
      if (!busy) {
        this._release(job, { clearWork: true });
        this._failed(job);
        continue;
      }
      job.progress = Math.min(1, worker.work.elapsed / worker.work.duration);
    }

    this._assignClock += step;
    if (this._assignClock < this.assignInterval) return;
    this._assignClock = 0;
    if (!this._pending()) return;
    for (const imp of this._imps()) {
      if (!this._pending()) break;
      this.requestJob(imp);
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.clear();
    this.jobs.clear();
    if (this.runtime?.jobs === this) this.runtime.jobs = null;
  }

  // ------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------

  _imps() {
    return this.entities?.list?.('imps')
      || this.entities?.getAll?.()?.filter((entity) => entity.type === 'imp')
      || [];
  }

  _available(entity) {
    return Boolean(
      entity
      && entity.type === 'imp'
      && entity.hp > 0
      && entity.state !== 'death'
      && entity.autonomous !== false          // possessed Imps take orders from the player
      && !entity.work
      && !entity.carryAmount                  // hauling gold or a workshop crate
      && !entity.userData?.workshopJobId      // the Workshop already owns this one
      && !entity.userData?.dkHaltedDoor,      // stuck at a locked door
    );
  }

  _pending() {
    for (const job of this.jobs.values()) if (!job.claimedBy) return true;
    return false;
  }

  _byId(id) {
    for (const job of this.jobs.values()) if (job.id === id) return job;
    return null;
  }

  _valid(job) {
    const cell = this.world?.getCell?.(job.x, job.z);
    return Boolean(cell && JOB_TARGETS[job.type]?.has(cell.type));
  }

  /** Is there a walkable tile an Imp could stand on to do this work? */
  _approachable(job) {
    if (this.world?.isWalkable?.(job.x, job.z)) return true;
    for (const [dx, dz] of CARDINAL) {
      if (this.world?.isWalkable?.(job.x + dx, job.z + dz)) return true;
    }
    return false;
  }

  _ownedNeighbour(x, z) {
    for (const [dx, dz] of CARDINAL) {
      const cell = this.world?.getCell?.(x + dx, z + dz);
      if (cell && (OWNED.has(cell.type) || cell.room)) return true;
    }
    return false;
  }

  /** Path or action failure. A job nobody can complete is dropped, not left
   * blocking the queue forever. */
  _failed(job) {
    job.attempts++;
    if (job.attempts < MAX_ATTEMPTS) return;
    this.jobs.delete(keyOf(job.x, job.z));
    this._emit('jobUnreachable', { job: { ...job } });
  }

  _release(job, { clearWork = false } = {}) {
    if (!job.claimedBy) return;
    const worker = this.entities?.get?.(job.claimedBy);
    job.claimedBy = null;
    if (!clearWork || !worker) return;
    if (worker.work?.jobId === job.id) {
      worker.work = null;
      if (worker.state === 'work' || worker.state === 'dig') this.entities?.setState?.(worker, 'idle');
    }
  }

  _emit(name, detail) {
    this.runtime?.events?.emit?.(name, detail);
  }
}

export function createJobsDirector(runtime, world, entities, options) {
  return new JobsDirector(runtime, world, entities, options);
}
