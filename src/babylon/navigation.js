// ============================================================
// BABYLON NAVIGATION FOUNDATION
// ============================================================
// Renderer-independent navigation helpers for the 64x64 Dungeon Heart grid.
// Keep this module free of Babylon imports: callers may use plain { x, z }
// cells, or convert results to Babylon.Vector3 at their boundary.

const CARDINAL_STEPS = Object.freeze([
  Object.freeze([1, 0]),
  Object.freeze([-1, 0]),
  Object.freeze([0, 1]),
  Object.freeze([0, -1]),
]);

// Packs a bucket's (bx, bz) grid coordinate into a single safe integer key,
// avoiding a template-string allocation on every insert/lookup. The offset
// keeps both halves non-negative before packing; comfortably covers any
// coordinate this game produces (world position / cellSize) with room to
// spare, while staying far below Number.MAX_SAFE_INTEGER.
const BUCKET_KEY_OFFSET = 1 << 20;
const BUCKET_KEY_SCALE = BUCKET_KEY_OFFSET * 2;

const DEFAULT_PATH_CACHE_LIMIT = 256;
const DEFAULT_FLOW_FIELD_CACHE_LIMIT = 12;
const DEFAULT_PATH_BUDGET = 4;
const DEFAULT_FLOW_FIELD_BUDGET = 1;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positionOf(value) {
  const source = value?.root?.position || value?.position || value?.node?.position || value?.mesh?.position || value;
  if (!source) return null;
  const x = Number(source.x);
  const z = Number(source.z);
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
}

function cellOf(value, size) {
  const position = positionOf(value);
  if (!position) return null;
  return {
    x: clamp(Math.round(position.x), 0, size - 1),
    z: clamp(Math.round(position.z), 0, size - 1),
  };
}

function copyCell(cell) {
  return { x: cell.x, y: 0, z: cell.z };
}

function defaultEntityKey(entity, fallback) {
  if (entity?.id != null) return String(entity.id);
  if (entity?.entityId != null) return String(entity.entityId);
  return fallback;
}

/**
 * Uniform-grid index for moving entities.  It deliberately stores only entity
 * references, so the game remains the owner of entity state and lifecycle.
 * Query results are ordered by first registration, giving stable tie-breaking
 * even though bucket membership changes while entities move.
 */
export class EntitySpatialIndex {
  constructor(options = {}) {
    this.cellSize = Math.max(0.25, finiteNumber(options.cellSize, 2));
    this._records = new Map();
    this._buckets = new Map();
    this._anonymousKeys = new WeakMap();
    this._nextAnonymousKey = 0;
    this._nextOrder = 0;
  }

  get size() {
    return this._records.size;
  }

  clear() {
    this._records.clear();
    this._buckets.clear();
  }

  upsert(entity, key = undefined) {
    if (!entity) return false;
    const position = positionOf(entity);
    if (!position) return false;
    const entityKey = this._keyFor(entity, key);
    const bucketKey = this._bucketKeyFor(position.x, position.z);
    let record = this._records.get(entityKey);
    if (!record) {
      record = { key: entityKey, entity, order: this._nextOrder++, bucketKey: null, x: position.x, z: position.z };
      this._records.set(entityKey, record);
    }
    record.entity = entity;
    record.x = position.x;
    record.z = position.z;
    if (record.bucketKey !== bucketKey) {
      if (record.bucketKey != null) this._buckets.get(record.bucketKey)?.delete(entityKey);
      let bucket = this._buckets.get(bucketKey);
      if (!bucket) {
        bucket = new Set();
        this._buckets.set(bucketKey, bucket);
      }
      bucket.add(entityKey);
      record.bucketKey = bucketKey;
    }
    return true;
  }

  remove(entityOrKey) {
    const key = typeof entityOrKey === 'string' || typeof entityOrKey === 'number'
      ? String(entityOrKey)
      : this._keyFor(entityOrKey, undefined, false);
    if (!key) return false;
    const record = this._records.get(key);
    if (!record) return false;
    this._buckets.get(record.bucketKey)?.delete(key);
    this._records.delete(key);
    return true;
  }

  /** Synchronises an iterable of live entities and removes stale entries. */
  sync(entities) {
    const live = new Set();
    for (const entity of entities || []) {
      const key = this._keyFor(entity);
      if (this.upsert(entity, key)) live.add(key);
    }
    for (const key of this._records.keys()) if (!live.has(key)) this.remove(key);
    return this.size;
  }

  queryRadius(center, radius, filter = null) {
    const origin = positionOf(center);
    const distance = Math.max(0, finiteNumber(radius));
    if (!origin) return [];
    const radiusSquared = distance * distance;
    const candidates = this._queryBounds(origin.x - distance, origin.z - distance, origin.x + distance, origin.z + distance);
    const result = [];
    for (const record of candidates) {
      const dx = record.x - origin.x;
      const dz = record.z - origin.z;
      if (dx * dx + dz * dz <= radiusSquared && (!filter || filter(record.entity))) result.push(record.entity);
    }
    return result;
  }

  queryBounds(minX, minZ, maxX, maxZ, filter = null) {
    const candidates = this._queryBounds(minX, minZ, maxX, maxZ);
    const result = [];
    for (const record of candidates) {
      if (record.x < minX || record.x > maxX || record.z < minZ || record.z > maxZ) continue;
      if (!filter || filter(record.entity)) result.push(record.entity);
    }
    return result;
  }

  nearest(center, options = {}) {
    const origin = positionOf(center);
    if (!origin) return null;
    const radius = Number.isFinite(options.maxDistance) ? Math.max(0, options.maxDistance) : Infinity;
    // `_records` is a Map whose keys are only ever appended (never
    // reinserted), and each record's `order` is assigned at that same
    // append, so its natural iteration order is already ascending by
    // `order` — no need to copy into an array and sort just to re-derive
    // the order it's already in.
    const candidates = radius === Infinity
      ? this._records.values()
      : this._queryBounds(origin.x - radius, origin.z - radius, origin.x + radius, origin.z + radius);
    const filter = options.filter || null;
    let nearest = null;
    let nearestDistance = radius * radius;
    for (const record of candidates) {
      if (filter && !filter(record.entity)) continue;
      const dx = record.x - origin.x;
      const dz = record.z - origin.z;
      const distance = dx * dx + dz * dz;
      if (distance < nearestDistance || (!nearest && distance === nearestDistance)) {
        nearest = record.entity;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  _queryBounds(minX, minZ, maxX, maxZ) {
    const startX = Math.floor(Math.min(minX, maxX) / this.cellSize);
    const endX = Math.floor(Math.max(minX, maxX) / this.cellSize);
    const startZ = Math.floor(Math.min(minZ, maxZ) / this.cellSize);
    const endZ = Math.floor(Math.max(minZ, maxZ) / this.cellSize);
    const records = [];
    for (let z = startZ; z <= endZ; z++) {
      for (let x = startX; x <= endX; x++) {
        for (const key of this._buckets.get(this._bucketKeyForCell(x, z)) || []) {
          const record = this._records.get(key);
          if (record) records.push(record);
        }
      }
    }
    records.sort((a, b) => a.order - b.order);
    return records;
  }

  _bucketKeyForCell(bx, bz) {
    return (bx + BUCKET_KEY_OFFSET) * BUCKET_KEY_SCALE + (bz + BUCKET_KEY_OFFSET);
  }

  _bucketKeyFor(x, z) {
    return this._bucketKeyForCell(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
  }

  _keyFor(entity, explicitKey = undefined, create = true) {
    if (explicitKey != null) return String(explicitKey);
    const direct = defaultEntityKey(entity, null);
    if (direct) return direct;
    if (!entity || (typeof entity !== 'object' && typeof entity !== 'function')) return null;
    let anonymous = this._anonymousKeys.get(entity);
    if (!anonymous && create) {
      anonymous = `@${++this._nextAnonymousKey}`;
      this._anonymousKeys.set(entity, anonymous);
    }
    return anonymous || null;
  }
}

/** A reusable, immutable-to-callers shortest-path flow field for one goal. */
export class FlowField {
  constructor(size, goalKey, next, distance) {
    this.size = size;
    this.goal = Object.freeze({ x: goalKey % size, y: 0, z: Math.floor(goalKey / size) });
    this._next = next;
    this._distance = distance;
  }

  distanceAt(position) {
    const cell = cellOf(position, this.size);
    return cell ? this._distance[cell.x + cell.z * this.size] : -1;
  }

  isReachable(position) {
    return this.distanceAt(position) >= 0;
  }

  nextCell(position) {
    const cell = cellOf(position, this.size);
    if (!cell) return null;
    const next = this._next[cell.x + cell.z * this.size];
    return next >= 0 ? copyCell({ x: next % this.size, z: Math.floor(next / this.size) }) : null;
  }

  pathFrom(position, maxSteps = this.size * this.size) {
    const start = cellOf(position, this.size);
    if (!start || !this.isReachable(start)) return [];
    const path = [copyCell(start)];
    let key = start.x + start.z * this.size;
    for (let count = 0; key !== -1 && count < maxSteps; count++) {
      const next = this._next[key];
      if (next < 0) break;
      key = next;
      path.push(copyCell({ x: key % this.size, z: Math.floor(key / this.size) }));
    }
    return path;
  }
}

/**
 * Deterministic cardinal-grid pathfinder with bounded LRU caches.  It is
 * intentionally synchronous; NavigationService is the frame-budgeted facade.
 */
export class GridNavigator {
  constructor(world, options = {}) {
    this.world = world || null;
    this.size = Math.max(1, Math.floor(finiteNumber(options.gridSize, world?.gridSize || 64)));
    this.isWalkable = typeof options.isWalkable === 'function'
      ? options.isWalkable
      : (x, z) => Boolean(this.world?.isWalkable?.(x, z));
    this.pathCacheLimit = Math.max(0, Math.floor(finiteNumber(options.pathCacheLimit, DEFAULT_PATH_CACHE_LIMIT)));
    this.flowFieldCacheLimit = Math.max(0, Math.floor(finiteNumber(options.flowFieldCacheLimit, DEFAULT_FLOW_FIELD_CACHE_LIMIT)));
    this.revision = 0;
    this._pathCache = new Map();
    this._flowFieldCache = new Map();
    // findPath/buildFlowField are synchronous and never called re-entrantly
    // (NavigationService budgets one search to completion before starting the
    // next), so their scratch work buffers can be allocated once here instead
    // of per call. `next`/`distance` stay freshly allocated per buildFlowField
    // call because they are retained inside the returned (often cached)
    // FlowField — only the transient BFS frontier queue is safe to share.
    this._scratchCameFrom = new Int32Array(this.size * this.size);
    this._scratchFrontier = new Int32Array(this.size * this.size);
    this._searching = false;
  }

  invalidate() {
    this.revision++;
    this.clearCaches();
    return this.revision;
  }

  /** Drops cached entries without bumping revision — call after bumpRevision()
   * has already made them unreachable, to reclaim the Map storage. */
  clearCaches() {
    this._pathCache.clear();
    this._flowFieldCache.clear();
  }

  /** Cache keys embed `revision`, so bumping it alone makes every existing
   * entry permanently unreachable — cheap enough to do synchronously on every
   * world-change event, leaving the (comparatively pricier) Map.clear() to be
   * coalesced by the caller. */
  bumpRevision() {
    this.revision++;
    return this.revision;
  }

  findPath(start, goal, options = {}) {
    const endpoints = this._endpoints(start, goal);
    if (!endpoints) return [];
    const { startCell, goalCell, startKey, goalKey } = endpoints;
    const allowGoalBlocked = options.allowGoalBlocked !== false;
    const canTraverse = typeof options.canTraverse === 'function' ? options.canTraverse : null;
    const cacheKey = !canTraverse && options.cache !== false
      ? this._pathCacheKey(startKey, goalKey, allowGoalBlocked)
      : null;
    const cached = cacheKey ? this._getCachedPath(cacheKey) : null;
    if (cached) return this._copyPath(cached, options.goalPosition || goal);

    if (this._searching) throw new Error('GridNavigator: findPath called re-entrantly (a search is already using the scratch buffers)');
    this._searching = true;
    try {
      const cameFrom = this._scratchCameFrom;
      cameFrom.fill(-2);
      const frontier = this._scratchFrontier;
      let head = 0;
      let tail = 0;
      frontier[tail++] = startKey;
      cameFrom[startKey] = -1;
      while (head < tail) {
        const current = frontier[head++];
        if (current === goalKey) break;
        const x = current % this.size;
        const z = Math.floor(current / this.size);
        for (const [dx, dz] of CARDINAL_STEPS) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= this.size || nz >= this.size) continue;
          const key = nx + nz * this.size;
          if (cameFrom[key] !== -2) continue;
          if (key !== goalKey && !this._canEnter(nx, nz, options, canTraverse)) continue;
          if (key === goalKey && !allowGoalBlocked && !this._canEnter(nx, nz, options, canTraverse)) continue;
          cameFrom[key] = current;
          frontier[tail++] = key;
        }
      }
      if (cameFrom[goalKey] === -2) return [];
      const reverse = [];
      for (let key = goalKey; key !== -1; key = cameFrom[key]) reverse.push(key);
      reverse.reverse();
      if (cacheKey) this._remember(this._pathCache, cacheKey, reverse, this.pathCacheLimit);
      return this._copyPath(reverse, options.goalPosition || goal, startCell, goalCell);
    } finally {
      this._searching = false;
    }
  }

  getCachedPath(start, goal, options = {}) {
    const endpoints = this._endpoints(start, goal);
    if (!endpoints || options.cache === false || typeof options.canTraverse === 'function') return null;
    const cached = this._getCachedPath(this._pathCacheKey(endpoints.startKey, endpoints.goalKey, options.allowGoalBlocked !== false));
    return cached ? this._copyPath(cached, options.goalPosition || goal) : null;
  }

  buildFlowField(goal, options = {}) {
    const goalCell = cellOf(goal, this.size);
    if (!goalCell) return null;
    const goalKey = goalCell.x + goalCell.z * this.size;
    const canTraverse = typeof options.canTraverse === 'function' ? options.canTraverse : null;
    const cacheKey = !canTraverse && options.cache !== false ? `${this.revision}|${goalKey}` : null;
    const cached = cacheKey ? this._getCachedFlowField(cacheKey) : null;
    if (cached) return cached;

    if (this._searching) throw new Error('GridNavigator: buildFlowField called re-entrantly (a search is already using the scratch buffers)');
    this._searching = true;
    try {
      // `next`/`distance` are handed to the returned FlowField (and often
      // kept in the cache), so — unlike the transient BFS frontier — they
      // must stay freshly allocated per call rather than reuse scratch.
      const next = new Int32Array(this.size * this.size);
      const distance = new Int32Array(this.size * this.size);
      next.fill(-1);
      distance.fill(-1);
      const frontier = this._scratchFrontier;
      let head = 0;
      let tail = 0;
      frontier[tail++] = goalKey;
      distance[goalKey] = 0;
      while (head < tail) {
        const current = frontier[head++];
        const x = current % this.size;
        const z = Math.floor(current / this.size);
        for (const [dx, dz] of CARDINAL_STEPS) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= this.size || nz >= this.size) continue;
          const key = nx + nz * this.size;
          if (distance[key] >= 0 || !this._canEnter(nx, nz, options, canTraverse)) continue;
          distance[key] = distance[current] + 1;
          next[key] = current;
          frontier[tail++] = key;
        }
      }
      const field = new FlowField(this.size, goalKey, next, distance);
      if (cacheKey) this._remember(this._flowFieldCache, cacheKey, field, this.flowFieldCacheLimit);
      return field;
    } finally {
      this._searching = false;
    }
  }

  getCachedFlowField(goal, options = {}) {
    const cell = cellOf(goal, this.size);
    if (!cell || options.cache === false || typeof options.canTraverse === 'function') return null;
    return this._getCachedFlowField(`${this.revision}|${cell.x + cell.z * this.size}`) || null;
  }

  _endpoints(start, goal) {
    const startCell = cellOf(start, this.size);
    const goalCell = cellOf(goal, this.size);
    if (!startCell || !goalCell) return null;
    return {
      startCell,
      goalCell,
      startKey: startCell.x + startCell.z * this.size,
      goalKey: goalCell.x + goalCell.z * this.size,
    };
  }

  _canEnter(x, z, options, canTraverse) {
    if (!this.isWalkable(x, z)) return false;
    return !canTraverse || canTraverse(x, z, options.context) !== false;
  }

  _pathCacheKey(startKey, goalKey, allowGoalBlocked) {
    return `${this.revision}|${startKey}|${goalKey}|${allowGoalBlocked ? 1 : 0}`;
  }

  _copyPath(keys, requestedGoal) {
    const path = keys.map((key) => copyCell({ x: key % this.size, z: Math.floor(key / this.size) }));
    // Retain the exact commanded destination (for example a Babylon Vector3
    // targeting a creature) while cached routing itself stays cell based.
    if (path.length && requestedGoal) {
      const position = positionOf(requestedGoal);
      if (position) path[path.length - 1] = { x: position.x, y: finiteNumber(requestedGoal.y), z: position.z };
    }
    return path;
  }

  _getCachedPath(key) {
    const value = this._pathCache.get(key);
    if (!value) return null;
    this._pathCache.delete(key);
    this._pathCache.set(key, value);
    return value;
  }

  _getCachedFlowField(key) {
    const value = this._flowFieldCache.get(key);
    if (!value) return null;
    this._flowFieldCache.delete(key);
    this._flowFieldCache.set(key, value);
    return value;
  }

  _remember(cache, key, value, limit) {
    if (!limit) return;
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > limit) cache.delete(cache.keys().next().value);
  }
}

/**
 * Frame-budgeted integration facade. `requestPath` and `requestFlowField`
 * never run an uncached search immediately; call `update()` once per active
 * game frame to process the configured deterministic work budget.
 */
export class NavigationService {
  constructor(world, options = {}) {
    this.world = world || null;
    this.spatial = options.spatialIndex || new EntitySpatialIndex(options.spatialIndexOptions);
    this.navigator = options.navigator || new GridNavigator(world, options);
    this.maxPathRequestsPerFrame = Math.max(0, Math.floor(finiteNumber(options.maxPathRequestsPerFrame, DEFAULT_PATH_BUDGET)));
    this.maxFlowFieldsPerFrame = Math.max(0, Math.floor(finiteNumber(options.maxFlowFieldsPerFrame, DEFAULT_FLOW_FIELD_BUDGET)));
    this._requests = [];
    this._flowRequests = [];
    this._nextRequestId = 0;
    this._clearedRevision = this.navigator.revision;
    this._unsubscribe = this._subscribeToWorldEvents(options.events || world?.runtime?.events);
  }

  get revision() {
    return this.navigator.revision;
  }

  invalidate(reason = 'manual') {
    const revision = this.navigator.invalidate();
    return { reason, revision };
  }

  requestPath(start, goal, options = {}) {
    const cached = this.navigator.getCachedPath(start, goal, options);
    const request = this._makeRequest('path', start, goal, options);
    if (cached) this._complete(request, cached);
    else this._requests.push(request);
    return request;
  }

  requestFlowField(goal, options = {}) {
    const cached = this.navigator.getCachedFlowField(goal, options);
    const request = this._makeRequest('flow', null, goal, options);
    if (cached) this._complete(request, cached);
    else this._flowRequests.push(request);
    return request;
  }

  /** Direct use for setup code; active gameplay should normally queue work. */
  findPath(start, goal, options = {}) {
    return this.navigator.findPath(start, goal, options);
  }

  buildFlowField(goal, options = {}) {
    return this.navigator.buildFlowField(goal, options);
  }

  update(entities = null) {
    // A burst of cellChanged events this frame already bumped the navigator's
    // revision (so nothing stale can be served — see _subscribeToWorldEvents)
    // but left the Maps themselves full of now-unreachable entries; reclaim
    // them here at most once per frame rather than once per cell.
    if (this.navigator.revision !== this._clearedRevision) {
      this.navigator.clearCaches();
      this._clearedRevision = this.navigator.revision;
    }
    if (entities) this.spatial.sync(entities);
    this._process(this._requests, this.maxPathRequestsPerFrame, (request) => this.navigator.findPath(request.start, request.goal, request.options));
    this._process(this._flowRequests, this.maxFlowFieldsPerFrame, (request) => this.navigator.buildFlowField(request.goal, request.options));
  }

  dispose() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    for (const request of [...this._requests, ...this._flowRequests]) request.cancel();
    this._requests.length = 0;
    this._flowRequests.length = 0;
    this.spatial.clear();
  }

  _makeRequest(kind, start, goal, options) {
    const request = {
      id: ++this._nextRequestId,
      kind,
      start,
      goal,
      options,
      priority: finiteNumber(options.priority),
      status: 'pending',
      result: null,
      error: null,
      promise: null,
      cancel: null,
    };
    request.promise = new Promise((resolve) => { request._resolve = resolve; });
    request.cancel = () => {
      if (request.status !== 'pending') return false;
      request.status = 'cancelled';
      request._resolve(null);
      return true;
    };
    return request;
  }

  _process(queue, budget, build) {
    if (!budget || !queue.length) return;
    // Priority is descending; sequence order resolves equal-priority requests.
    queue.sort((a, b) => b.priority - a.priority || a.id - b.id);
    let processed = 0;
    while (queue.length && processed < budget) {
      const request = queue.shift();
      if (request.status !== 'pending') continue;
      try {
        this._complete(request, build(request));
      } catch (error) {
        request.status = 'failed';
        request.error = error;
        request._resolve(null);
        request.options.onComplete?.(null, request);
      }
      processed++;
    }
  }

  _complete(request, result) {
    request.status = 'complete';
    request.result = result;
    request._resolve(result);
    request.options.onComplete?.(result, request);
  }

  _subscribeToWorldEvents(events) {
    if (!events?.on) return null;
    // `cellChanged` fires once per cell, so painting a multi-tile room (or an
    // imp digging) can raise dozens of these in a single frame. Cache keys
    // embed `revision`, so bumping it is enough to make every existing entry
    // unreachable immediately (a path computed before this change is never
    // served after it) without paying for a Map.clear() per cell — the
    // actual clear is coalesced to at most once per update() call.
    return events.on('cellChanged', () => this.navigator.bumpRevision());
  }
}

export function createNavigationService(world, options = {}) {
  return new NavigationService(world, options);
}
