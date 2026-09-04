// ============================================================
// BABYLON POSSESSION — first-person creature control
// ============================================================
// This module is deliberately independent from the spell, input, and UI
// directors. Install it after those systems exist and it exposes the small
// runtime hooks MagicDirector already understands: beginPossession() and
// endPossession(). Keeping that boundary small also leaves the click-to-command
// possession fallback usable on runtimes that cannot create a first-person
// Babylon camera.

const B = window.BABYLON;

const TAU = Math.PI * 2;

const DEFAULT_OPTIONS = Object.freeze({
  speedMultiplier: 1,
  sprintMultiplier: 1.55,
  collisionRadius: 0.28,
  cameraHeight: 1.08,
  lookSensitivity: 0.0022,
  pitchLimit: Math.PI * 0.46,
  pointerLock: true,
  manageAutonomy: false,
});

/**
 * Ability definitions are intentionally data-only so a HUD, authored creature
 * package, or future combat director can reuse them without depending on this
 * controller. `power`, `range`, and `radius` describe the built-in fallback
 * behaviour; callers may intercept `onAbility` to supply richer effects.
 */
export const CREATURE_ABILITIES = Object.freeze({
  imp: Object.freeze([
    Object.freeze({ id: 'pick', label: 'Pick', slot: 1, cooldown: 0.7, range: 1.25, power: 5, kind: 'melee' }),
    Object.freeze({ id: 'mend', label: 'Mend', slot: 2, cooldown: 6, range: 1.5, power: 14, kind: 'selfHeal' }),
  ]),
  bileDemon: Object.freeze([
    Object.freeze({ id: 'belch', label: 'Bile Belch', slot: 1, cooldown: 4.5, range: 4.6, radius: 1.15, power: 25, kind: 'cone' }),
    Object.freeze({ id: 'stomp', label: 'Stomp', slot: 2, cooldown: 7, range: 2.3, radius: 2.1, power: 18, kind: 'burst' }),
  ]),
  troll: Object.freeze([
    Object.freeze({ id: 'hammer', label: 'Hammer Blow', slot: 1, cooldown: 1.05, range: 1.7, power: 23, kind: 'melee' }),
    Object.freeze({ id: 'charge', label: 'Charge', slot: 2, cooldown: 6.5, range: 4.2, power: 28, kind: 'dash' }),
  ]),
  warlock: Object.freeze([
    Object.freeze({ id: 'arcaneBolt', label: 'Arcane Bolt', slot: 1, cooldown: 1.25, range: 8, power: 19, kind: 'projectile' }),
    Object.freeze({ id: 'ward', label: 'Arcane Ward', slot: 2, cooldown: 8, range: 0, power: 22, kind: 'selfHeal' }),
  ]),
  fly: Object.freeze([
    Object.freeze({ id: 'bite', label: 'Bite', slot: 1, cooldown: 0.65, range: 1.25, power: 9, kind: 'melee' }),
    Object.freeze({ id: 'dart', label: 'Dart', slot: 2, cooldown: 4.5, range: 3.8, power: 15, kind: 'dash' }),
  ]),
});

const GENERIC_ABILITIES = Object.freeze([
  Object.freeze({ id: 'strike', label: 'Strike', slot: 1, cooldown: 0.9, range: 1.45, power: 10, kind: 'melee' }),
]);

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function finite(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function keyOf(value) { return String(value || '').toLowerCase(); }

function entityPosition(entity) {
  return entity?.root?.position || entity?.node?.position || entity?.mesh?.position || entity?.position || null;
}

function resolveEntity(entities, entityOrId) {
  if (!entityOrId) return null;
  if (typeof entityOrId === 'object') return entityOrId;
  return entities?.getById?.(entityOrId) || entities?.get?.(entityOrId) || null;
}

function eventIsEditable(event) {
  const target = event.target;
  return target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName);
}

/**
 * First-person possession controller.
 *
 * The director owns only its private camera and browser listeners. It never
 * modifies the top-down camera, which means exit can always hand the scene back
 * exactly as it found it. A grid-based collision probe is used by default;
 * provide `canMove` or `moveEntity` to integrate a physics/navigation layer.
 */
export class PossessionDirector {
  constructor(runtime, world, entities, options = {}) {
    if (!runtime?.scene || !runtime?.canvas) {
      throw new Error('PossessionDirector needs runtime.scene and runtime.canvas.');
    }
    this.runtime = runtime;
    this.scene = runtime.scene;
    this.canvas = runtime.canvas;
    this.world = world || {};
    this.entities = entities || {};
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.input = options.input || runtime.input || null;
    this.effects = options.effects || null;
    this.audio = options.audio || null;
    this._time = 0;
    this._camera = null;
    this._session = null;
    this._installed = false;
    this._disposed = false;
    this._keys = new Set();
    this._cooldowns = Object.create(null);
    this._previousHooks = null;
    this._beforeRenderObserver = null;
    this._listeners = [];
    this._pointerLocked = false;
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onPointerLockError = this._onPointerLockError.bind(this);
    this._onBlur = this._onBlur.bind(this);
  }

  /** Installs runtime hooks and a before-render update observer. */
  install() {
    if (this._installed || this._disposed) return this;
    this._installed = true;
    this._previousHooks = {
      begin: this.runtime.beginPossession,
      end: this.runtime.endPossession,
      command: this.runtime.commandPossessed,
      hud: this.runtime.getPossessionHud,
    };
    const owner = this;
    this._runtimeBegin = function beginPossession(entity, opts) { return owner.enter(entity, opts); };
    this._runtimeEnd = function endPossession(entity, opts) { return owner.exit({ entity, ...opts }); };
    this._runtimeCommand = function commandPossessed(destination) { return owner.command(destination); };
    this._runtimeHud = function getPossessionHud() { return owner.snapshot(); };
    this.runtime.beginPossession = this._runtimeBegin;
    this.runtime.endPossession = this._runtimeEnd;
    this.runtime.commandPossessed = this._runtimeCommand;
    this.runtime.getPossessionHud = this._runtimeHud;
    this.runtime.possessionDirector = this;

    this._listen(this.canvas, 'pointerdown', this._onPointerDown);
    this._listen(window, 'keydown', this._onKeyDown, true);
    this._listen(window, 'keyup', this._onKeyUp, true);
    this._listen(window, 'mousemove', this._onMouseMove, true);
    this._listen(window, 'blur', this._onBlur);
    this._listen(document, 'pointerlockchange', this._onPointerLockChange);
    this._listen(document, 'pointerlockerror', this._onPointerLockError);
    const observable = this.scene.onBeforeRenderObservable;
    if (observable?.add) {
      this._beforeRenderObserver = observable.add(() => {
        const dt = this.runtime.engine?.getDeltaTime?.() / 1000 || 1 / 60;
        this.update(dt);
      });
    }
    return this;
  }

  /** Start first-person control. Returns a fallback session when unavailable. */
  enter(entityOrId, options = {}) {
    if (this._disposed) return false;
    const entity = resolveEntity(this.entities, entityOrId);
    if (!this._isPossessable(entity)) return false;
    if (this._session?.entity === entity) return true;
    this.exit({ reason: 'switch', silent: true });

    const abilityList = this.abilitiesFor(entity);
    this._cooldowns = Object.fromEntries(abilityList.map((ability) => [ability.id, 0]));
    const firstPerson = this._canUseFirstPerson();
    const session = {
      entity,
      firstPerson,
      fallback: !firstPerson,
      reason: firstPerson ? null : 'first-person camera unavailable',
      enteredAt: this._time,
      yaw: finite(entity.root?.rotation?.y),
      pitch: 0,
      abilities: abilityList,
      saved: {
        activeCamera: this.scene.activeCamera,
        activeCameras: this.scene.activeCameras ? [...this.scene.activeCameras] : null,
        inputEnabled: this.input?.enabled,
        togglePause: this.runtime.togglePause,
        autonomous: entity.autonomous,
        visualEnabled: this._nodeEnabled(entity.visual),
        proceduralEnabled: this._nodeEnabled(entity.proceduralVisual),
        meshVisibility: (entity.root?.getChildMeshes?.() || []).map((mesh) => ({ mesh, isVisible: mesh.isVisible })),
      },
    };
    this._session = session;
    if (this.options.manageAutonomy || options.manageAutonomy) entity.autonomous = false;

    if (firstPerson) {
      this._createCamera(session);
      this._handoffCamera(session);
      this._setOwnedVisualVisible(entity, false, false, session.saved.meshVisibility);
      // The regular controller retains all listeners but stops consuming map
      // commands while a possessed creature owns movement keys.
      this.input?.setEnabled?.(false);
      this._suspendTopDownPause(session);
      if (this.options.pointerLock && options.pointerLock !== false) this.requestPointerLock();
    }

    this.runtime.possession = { entity, director: this, firstPerson, fallback: !firstPerson };
    this.runtime.events?.emit?.('possessionEntered', { entity, firstPerson, fallback: !firstPerson });
    return true;
  }

  /** Restore the original top-down camera and input controller. */
  exit(options = {}) {
    const session = this._session;
    if (!session) return false;
    if (options.entity && options.entity !== session.entity && options.entity?.id !== session.entity.id) return false;
    this._releasePointerLock();
    this._keys.clear();
    this._restoreCamera(session);
    this._restoreTopDownPause(session);
    this._setOwnedVisualVisible(
      session.entity,
      session.saved.visualEnabled,
      session.saved.proceduralEnabled,
      session.saved.meshVisibility,
    );
    if (this.options.manageAutonomy || options.manageAutonomy) session.entity.autonomous = session.saved.autonomous;
    if (session.firstPerson && session.saved.inputEnabled !== undefined) this.input?.setEnabled?.(session.saved.inputEnabled);
    this._camera?.dispose?.();
    this._camera = null;
    this._session = null;
    if (this.runtime.possession?.director === this) this.runtime.possession = null;
    if (!options.silent) this.runtime.events?.emit?.('possessionExited', { entity: session.entity, reason: options.reason || 'released' });
    return true;
  }

  /** True when the browser currently owns mouse look for this controller. */
  get pointerLocked() { return this._pointerLocked; }
  get active() { return Boolean(this._session); }
  get entity() { return this._session?.entity || null; }
  get camera() { return this._camera; }

  abilitiesFor(entityOrId) {
    const entity = resolveEntity(this.entities, entityOrId);
    const type = keyOf(entity?.type).replace(/[-_]/g, '');
    const predefined = CREATURE_ABILITIES[entity?.type] || CREATURE_ABILITIES[type] || GENERIC_ABILITIES;
    const custom = entity?.userData?.possessionAbilities;
    const source = Array.isArray(custom) && custom.length ? custom : predefined;
    return source.map((ability, index) => Object.freeze({ ...ability, slot: finite(ability.slot, index + 1) }));
  }

  /**
   * Executes an ability by id or numbered slot. The optional `target` can be
   * a picked entity; omitted targets are found from the first-person reticle.
   */
  useAbility(idOrSlot, target = null) {
    const session = this._session;
    if (!session) return false;
    const ability = session.abilities.find((item) => item.id === idOrSlot || item.slot === Number(idOrSlot));
    if (!ability || (this._cooldowns[ability.id] || 0) > 0) return false;
    const result = this.options.onAbility?.({ director: this, entity: session.entity, ability, target });
    if (result === false) return false;
    const succeeded = result === undefined ? this._applyDefaultAbility(session, ability, target) : result;
    if (succeeded === false) return false;
    this._cooldowns[ability.id] = Math.max(0, finite(ability.cooldown));
    this.runtime.events?.emit?.('possessionAbility', { entity: session.entity, ability, target });
    return true;
  }

  /** Move a fallback-possessed creature toward a top-down point. */
  command(destination) {
    const entity = this.entity;
    if (!entity || !destination) return false;
    return this.entities?.moveTo?.(entity, destination, { state: 'walk' }) ?? false;
  }

  requestPointerLock() {
    if (!this._session?.firstPerson || !this.options.pointerLock) return false;
    const request = this.canvas.requestPointerLock;
    if (typeof request !== 'function') return false;
    try { request.call(this.canvas); return true; } catch (_) { return false; }
  }

  update(dt) {
    const step = clamp(finite(dt), 0, 0.1);
    this._time += step;
    for (const id of Object.keys(this._cooldowns)) this._cooldowns[id] = Math.max(0, this._cooldowns[id] - step);
    const session = this._session;
    if (!session || !session.firstPerson) return;
    if (!this._isPossessable(session.entity)) {
      this.exit({ reason: 'creature unavailable' });
      return;
    }
    this._move(session, step);
    this._syncCamera(session);
  }

  snapshot() {
    const session = this._session;
    if (!session) return { active: false, entityId: null, abilities: [], cooldowns: {} };
    return {
      active: true,
      firstPerson: session.firstPerson,
      fallback: session.fallback,
      fallbackReason: session.reason,
      pointerLocked: this._pointerLocked,
      entityId: session.entity.id || null,
      entityType: session.entity.type || 'creature',
      health: { current: finite(session.entity.hp), max: finite(session.entity.maxHp, finite(session.entity.hp)) },
      abilities: session.abilities.map((ability) => ({
        id: ability.id, label: ability.label, slot: ability.slot,
        cooldown: finite(ability.cooldown), remaining: this._cooldowns[ability.id] || 0,
        ready: (this._cooldowns[ability.id] || 0) <= 0,
      })),
      cooldowns: { ...this._cooldowns },
    };
  }

  dispose() {
    if (this._disposed) return;
    this.exit({ reason: 'disposed', silent: true });
    const observable = this.scene?.onBeforeRenderObservable;
    if (this._beforeRenderObserver && observable?.remove) observable.remove(this._beforeRenderObserver);
    this._beforeRenderObserver = null;
    for (const listener of this._listeners) listener.target.removeEventListener(listener.type, listener.handler, listener.options);
    this._listeners.length = 0;
    if (this.runtime.beginPossession && this.runtime.beginPossession === this._runtimeBegin) this.runtime.beginPossession = this._previousHooks.begin;
    if (this.runtime.endPossession && this.runtime.endPossession === this._runtimeEnd) this.runtime.endPossession = this._previousHooks.end;
    if (this.runtime.commandPossessed === this._runtimeCommand) this.runtime.commandPossessed = this._previousHooks.command;
    if (this.runtime.getPossessionHud === this._runtimeHud) this.runtime.getPossessionHud = this._previousHooks.hud;
    if (this.runtime.possessionDirector === this) delete this.runtime.possessionDirector;
    this._disposed = true;
  }

  _listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this._listeners.push({ target, type, handler, options });
  }

  _canUseFirstPerson() {
    return Boolean(B?.UniversalCamera && B?.Vector3 && this.scene && this.canvas);
  }

  _isPossessable(entity) {
    return Boolean(entity && entityPosition(entity) && entity.hp > 0 && entity.state !== 'death' && entity.faction === 'dungeon');
  }

  _createCamera(session) {
    const camera = new B.UniversalCamera('possessionCamera', B.Vector3.Zero(), this.scene);
    camera.minZ = 0.06;
    camera.maxZ = Math.max(120, finite(this.runtime.camera?.maxZ, 120));
    camera.fov = 1.15;
    camera.inertia = 0;
    camera.speed = 0;
    camera.checkCollisions = true;
    camera.ellipsoid = new B.Vector3(0.26, 0.52, 0.26);
    camera.rotation.set(session.pitch, session.yaw, 0);
    this._camera = camera;
    this._syncCamera(session);
  }

  _handoffCamera(session) {
    this.runtime.pipeline?.addCamera?.(this._camera);
    this.scene.activeCamera = this._camera;
    if (this.scene.activeCameras) this.scene.activeCameras = [this._camera];
    this.runtime.events?.emit?.('possessionCameraChanged', { camera: this._camera, previous: session.saved.activeCamera });
  }

  _restoreCamera(session) {
    if (session.firstPerson) {
      this.runtime.pipeline?.removeCamera?.(this._camera);
      this.scene.activeCamera = session.saved.activeCamera || this.runtime.camera || null;
      if (this.scene.activeCameras) this.scene.activeCameras = session.saved.activeCameras;
      this.runtime.events?.emit?.('possessionCameraChanged', { camera: this.scene.activeCamera, previous: this._camera });
    }
  }

  _suspendTopDownPause(session) {
    // InputController handles Escape before it checks `enabled`. While first
    // person is active, reserve Escape for pointer-lock release/possession exit
    // instead of allowing that legacy handler to open the pause panel.
    const owner = this;
    session.pauseHook = function possessionPauseGuard() {
      return owner._session === session ? false : session.saved.togglePause?.();
    };
    this.runtime.togglePause = session.pauseHook;
  }

  _restoreTopDownPause(session) {
    if (this.runtime.togglePause === session.pauseHook) this.runtime.togglePause = session.saved.togglePause;
  }

  _syncCamera(session) {
    const position = entityPosition(session.entity);
    if (!position || !this._camera) return;
    this._camera.position.copyFromFloats(position.x, position.y + this._eyeHeight(session.entity), position.z);
    this._camera.rotation.x = session.pitch;
    this._camera.rotation.y = session.yaw;
    this._camera.rotation.z = 0;
  }

  _eyeHeight(entity) {
    const perCreature = entity?.userData?.possessionEyeHeight;
    if (Number.isFinite(Number(perCreature))) return Number(perCreature);
    const scale = finite(entity?.root?.scaling?.y, 1);
    return this.options.cameraHeight * Math.max(0.68, scale);
  }

  _move(session, dt) {
    let x = 0;
    let z = 0;
    if (this._keys.has('w') || this._keys.has('arrowup')) z += 1;
    if (this._keys.has('s') || this._keys.has('arrowdown')) z -= 1;
    if (this._keys.has('a') || this._keys.has('arrowleft')) x -= 1;
    if (this._keys.has('d') || this._keys.has('arrowright')) x += 1;
    if (!x && !z) return;
    const length = Math.hypot(x, z) || 1;
    const speed = Math.max(0.1, finite(session.entity.speed, 1) * this.options.speedMultiplier)
      * (this._keys.has('shift') ? this.options.sprintMultiplier : 1);
    const forwardX = Math.sin(session.yaw);
    const forwardZ = Math.cos(session.yaw);
    const rightX = Math.cos(session.yaw);
    const rightZ = -Math.sin(session.yaw);
    const dx = (forwardX * (z / length) + rightX * (x / length)) * speed * dt;
    const dz = (forwardZ * (z / length) + rightZ * (x / length)) * speed * dt;
    this._tryMove(session.entity, dx, dz);
  }

  _tryMove(entity, dx, dz) {
    const position = entityPosition(entity);
    if (!position) return false;
    const candidate = { x: position.x + dx, y: position.y, z: position.z + dz };
    const requested = this.options.moveEntity?.({ entity, from: position, to: candidate, dx, dz, director: this });
    if (requested === false) return false;
    if (requested && typeof requested === 'object') {
      position.x = finite(requested.x, position.x);
      position.y = finite(requested.y, position.y);
      position.z = finite(requested.z, position.z);
      return true;
    }
    if (this.options.canMove && this.options.canMove({ entity, from: position, to: candidate, director: this }) === false) return false;
    if (!this._isWalkableFootprint(candidate.x, candidate.z)) return false;
    position.x = candidate.x;
    position.z = candidate.z;
    if (entity.root?.rotation) entity.root.rotation.y = this._session?.yaw ?? entity.root.rotation.y;
    entity.destination = null;
    if (entity.path) entity.path.length = 0;
    if (entity.state !== 'death') this.entities?.setState?.(entity, 'walk');
    return true;
  }

  _isWalkableFootprint(x, z) {
    if (typeof this.world?.isWalkable !== 'function') return true;
    const radius = Math.max(0, finite(this.options.collisionRadius));
    const probes = [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]];
    return probes.every(([ox, oz]) => this.world.isWalkable(x + ox, z + oz));
  }

  _applyDefaultAbility(session, ability, suppliedTarget) {
    const entity = session.entity;
    const target = suppliedTarget || this._reticleTarget(ability.range);
    if (ability.kind === 'selfHeal') {
      const result = this.entities?.heal?.(entity, ability.power);
      this.effects?.healing?.(entityPosition(entity), '#6effa2', 0.55);
      return result !== false;
    }
    if (ability.kind === 'dash') {
      const distance = Math.min(finite(ability.range, 3), 4.5);
      const moved = this._tryMove(entity, Math.sin(session.yaw) * distance, Math.cos(session.yaw) * distance);
      if (target && moved) this._damage(target, ability.power, entity);
      return moved;
    }
    if (ability.kind === 'burst') {
      const origin = entityPosition(entity);
      const radius = finite(ability.radius, ability.range);
      let hit = false;
      for (const candidate of this.entities?.getAll?.() || []) {
        const pos = entityPosition(candidate);
        if (candidate === entity || candidate.faction === entity.faction || !pos) continue;
        if (Math.hypot(pos.x - origin.x, pos.z - origin.z) <= radius) hit = this._damage(candidate, ability.power, entity) || hit;
      }
      this.effects?.burst?.(origin, '#d18342', 0.8);
      return hit;
    }
    if (!target || target.faction === entity.faction) return false;
    const targetPosition = entityPosition(target);
    const origin = entityPosition(entity);
    if (!targetPosition || Math.hypot(targetPosition.x - origin.x, targetPosition.z - origin.z) > finite(ability.range, 1.5)) return false;
    const result = this._damage(target, ability.power, entity);
    if (result) {
      this.entities?.setState?.(entity, 'attack');
      this.effects?.hit?.(targetPosition, '#f2a65a', 0.35);
      this.audio?.play?.('hit_metal', targetPosition);
    }
    return result;
  }

  _damage(target, amount, source) {
    const result = this.entities?.takeDamage?.(target, amount, source);
    if (result !== undefined) return result !== false;
    if (!target || target.hp <= 0) return false;
    target.hp = Math.max(0, target.hp - Math.max(0, finite(amount)));
    return true;
  }

  _reticleTarget(range) {
    if (!this._camera || !B?.Ray) return null;
    const ray = this._camera.getForwardRay?.(Math.max(0.1, finite(range, 1.5)));
    if (!ray) return null;
    const pick = this.scene.pickWithRay?.(ray, (mesh) => mesh?.isPickable !== false);
    return this.entities?.fromPick?.(pick) || pick?.pickedMesh?.metadata?.entity || null;
  }

  _nodeEnabled(node) {
    if (!node) return undefined;
    return typeof node.isEnabled === 'function' ? node.isEnabled() : node.isVisible !== false;
  }

  _setOwnedVisualVisible(entity, visualEnabled, proceduralEnabled = visualEnabled, meshVisibility = null) {
    const set = (node, enabled) => {
      if (!node || enabled === undefined) return;
      if (typeof node.setEnabled === 'function') node.setEnabled(Boolean(enabled));
      else node.isVisible = Boolean(enabled);
    };
    if (visualEnabled === false && proceduralEnabled === false) {
      set(entity.visual, false);
      set(entity.proceduralVisual, false);
      for (const entry of meshVisibility || []) entry.mesh.isVisible = false;
      return;
    }
    set(entity.visual, visualEnabled);
    if (entity.proceduralVisual !== entity.visual) set(entity.proceduralVisual, proceduralEnabled);
    for (const entry of meshVisibility || []) entry.mesh.isVisible = entry.isVisible;
  }

  _onPointerDown(event) {
    if (!this._session?.firstPerson || event.button !== 0) return;
    if (document.pointerLockElement !== this.canvas) this.requestPointerLock();
  }

  _onMouseMove(event) {
    const session = this._session;
    if (!session?.firstPerson || document.pointerLockElement !== this.canvas) return;
    session.yaw = (session.yaw - finite(event.movementX) * this.options.lookSensitivity) % TAU;
    session.pitch = clamp(session.pitch - finite(event.movementY) * this.options.lookSensitivity, -this.options.pitchLimit, this.options.pitchLimit);
    event.preventDefault();
  }

  _onKeyDown(event) {
    const session = this._session;
    if (!session?.firstPerson || eventIsEditable(event)) return;
    const key = keyOf(event.key);
    if (key === 'escape') {
      // The browser consumes the first Escape to leave pointer lock. A second
      // press, or Escape without a lock, releases the creature.
      event.preventDefault();
      event.stopPropagation();
      if (document.pointerLockElement !== this.canvas) {
        const released = this.runtime.spells?.releasePossession?.();
        if (released === false || released === undefined) this.exit({ reason: 'escape' });
      }
      return;
    }
    if (key >= '1' && key <= '9') {
      if (this.useAbility(Number(key))) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
      this._keys.add(key);
      event.preventDefault();
      event.stopPropagation();
    }
  }

  _onKeyUp(event) { this._keys.delete(keyOf(event.key)); }
  _onBlur() { this._keys.clear(); }
  _onPointerLockChange() { this._pointerLocked = document.pointerLockElement === this.canvas; }
  _onPointerLockError() { this._pointerLocked = false; }

  _releasePointerLock() {
    if (document.pointerLockElement !== this.canvas || typeof document.exitPointerLock !== 'function') return;
    try { document.exitPointerLock(); } catch (_) { /* Browser may already be leaving lock. */ }
  }
}

/** Convenience factory for the standard install-after-bootstrap integration. */
export function installPossession(runtime, world, entities, options = {}) {
  return new PossessionDirector(runtime, world, entities, options).install();
}
