// ============================================================
// BABYLON EFFECTS DIRECTOR — pooled, quality-scaled visual feedback
// ============================================================
// Effects in this module are intentionally asset-free. A tiny procedural
// particle sprite is shared by every system, burst systems are recycled, and
// dynamic lights are drawn from one capped pool. This keeps gameplay feedback
// vivid without turning large creature battles into a draw-call or light storm.

const QUALITY_PRESETS = Object.freeze({
  low:    { particleScale: 0.35, burstSlots: 1, pulseSlots: 6,  lightningSlots: 1, portalSlots: 2, lights: 0, embers: 0,  shake: 0.55 },
  medium: { particleScale: 0.65, burstSlots: 2, pulseSlots: 10, lightningSlots: 2, portalSlots: 3, lights: 2, embers: 18, shake: 0.75 },
  high:   { particleScale: 1.00, burstSlots: 3, pulseSlots: 16, lightningSlots: 3, portalSlots: 5, lights: 4, embers: 32, shake: 1.00 },
  ultra:  { particleScale: 1.30, burstSlots: 4, pulseSlots: 24, lightningSlots: 4, portalSlots: 6, lights: 6, embers: 48, shake: 1.10 },
});

const EFFECT_COLORS = Object.freeze({
  dust: 0x7d6245,
  spark: 0xff9b3d,
  claim: 0xb745ff,
  portal: 0x9d4dff,
  spawn: 0x65e3ff,
  despawn: 0xef5cff,
  hit: 0xff5d45,
  heal: 0x6effa2,
  lightning: 0xb9eaff,
  rally: 0xffc449,
  ember: 0xff7a24,
});

const BURST_RECIPES = Object.freeze({
  dust: { capacity: 64, count: 18, life: [0.35, 0.72], size: [0.09, 0.24], power: [0.45, 1.65], gravity: -2.6, color: EFFECT_COLORS.dust, duration: 0.9, blend: 'standard' },
  sparks: { capacity: 56, count: 14, life: [0.18, 0.48], size: [0.035, 0.095], power: [1.5, 3.2], gravity: -4.5, color: EFFECT_COLORS.spark, duration: 0.65, blend: 'add' },
  spawn: { capacity: 80, count: 28, life: [0.42, 0.92], size: [0.08, 0.22], power: [0.7, 2.3], gravity: 0.65, color: EFFECT_COLORS.spawn, duration: 1.1, blend: 'add' },
  despawn: { capacity: 80, count: 30, life: [0.38, 0.88], size: [0.08, 0.20], power: [0.55, 1.8], gravity: 1.1, color: EFFECT_COLORS.despawn, duration: 1.05, blend: 'add' },
  hit: { capacity: 48, count: 12, life: [0.12, 0.34], size: [0.045, 0.13], power: [1.1, 2.8], gravity: -3.1, color: EFFECT_COLORS.hit, duration: 0.48, blend: 'add' },
  heal: { capacity: 72, count: 24, life: [0.55, 1.15], size: [0.06, 0.17], power: [0.35, 1.25], gravity: 1.45, color: EFFECT_COLORS.heal, duration: 1.35, blend: 'add' },
  rally: { capacity: 64, count: 20, life: [0.35, 0.75], size: [0.05, 0.14], power: [0.8, 2.1], gravity: -0.35, color: EFFECT_COLORS.rally, duration: 0.95, blend: 'add' },
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizedTier(value) {
  if (typeof value === 'string' && QUALITY_PRESETS[value.toLowerCase()]) return value.toLowerCase();
  if (typeof value === 'number') {
    if (value <= 0) return 'low';
    if (value === 1) return 'medium';
    if (value === 2) return 'high';
    return 'ultra';
  }
  return 'high';
}

function color3(B, value) {
  if (value && typeof value.r === 'number' && typeof value.g === 'number' && typeof value.b === 'number') {
    return new B.Color3(value.r, value.g, value.b);
  }
  if (typeof value === 'string') {
    const hex = value.startsWith('#') ? value : `#${value}`;
    return B.Color3.FromHexString(hex);
  }
  const numeric = Number.isFinite(value) ? value : 0xffffff;
  return B.Color3.FromHexString(`#${numeric.toString(16).padStart(6, '0')}`);
}

function color4(B, value, alpha = 1) {
  const c = color3(B, value);
  return new B.Color4(c.r, c.g, c.b, alpha);
}

function optionBag(options, scale) {
  if (options == null) return scale == null ? {} : { scale };
  if (typeof options === 'string' || typeof options === 'number') return { color: options, scale };
  if (typeof options.r === 'number' && typeof options.g === 'number' && typeof options.b === 'number') {
    return { color: options, scale };
  }
  return scale == null ? options : { ...options, scale };
}

/**
 * Owns short-lived effects, ambient particles, portal visuals, effect lights,
 * and camera-shake requests for the Babylon renderer.
 *
 * Required runtime field: { scene }
 * Optional runtime fields: { engine, camera, quality, audio, onScreenShake }
 */
export class EffectsDirector {
  constructor(runtime) {
    if (!runtime || !runtime.scene) throw new Error('EffectsDirector requires runtime.scene');
    if (!window.BABYLON) throw new Error('Babylon.js must be loaded before EffectsDirector');

    this.B = window.BABYLON;
    this.runtime = runtime;
    this.scene = runtime.scene;
    this.world = null;
    this.time = 0;
    this.disposed = false;
    this.qualityTier = normalizedTier(runtime.quality && (runtime.quality.name ?? runtime.quality.tier ?? runtime.quality));
    this.quality = QUALITY_PRESETS[this.qualityTier];
    this.particleTexture = this._createParticleTexture();
    this.burstPools = new Map();
    this.pulses = [];
    this.lightPool = [];
    this.lightLeases = [];
    this.lightCursor = 0;
    this.lightCap = 0;
    this.lightSerial = 0;
    this.lightningPool = [];
    this.portalPool = [];
    this.ambientSystem = null;
    this.shakes = [];
    this.shakeHook = typeof runtime.onScreenShake === 'function' ? runtime.onScreenShake : null;
    this._lastShake = { x: 0, y: 0, z: 0, roll: 0, normalizedIntensity: 0 };

    this._buildPools();
  }

  attachWorld(world) {
    this.world = world || null;
    return this;
  }

  setQualityTier(tier) {
    const next = normalizedTier(tier && (tier.name ?? tier.tier ?? tier));
    if (next === this.qualityTier) return;
    this.qualityTier = next;
    this.quality = QUALITY_PRESETS[next];
    this._buildPools();
    this.lightLeases.forEach((lease) => {
      if (!lease || lease.index < this.quality.lights) return;
      lease.active = false;
      lease.owner = null;
      lease.light.intensity = 0;
      lease.light.setEnabled(false);
    });
    this.portalPool.slice(this.quality.portalSlots).forEach((slot) => {
      if (slot.active) this._stopPortal(slot);
    });
    this.lightningPool.slice(this.quality.lightningSlots).forEach((slot) => {
      slot.busy = false;
      slot.mesh.setEnabled(false);
    });
    this.pulses.slice(this.quality.pulseSlots).forEach((slot) => {
      slot.busy = false;
      slot.mesh.setEnabled(false);
    });
    this._configureAmbient();
  }

  setScreenShakeHook(callback) {
    this.shakeHook = typeof callback === 'function' ? callback : null;
  }

  // Mining feedback: opaque chips plus a smaller additive spark shower.
  dig(position, options = {}, scale) {
    options = optionBag(options, scale);
    const origin = this._vector(position, 0.24);
    const size = options.scale ?? 1;
    this._burst('dust', origin, { color: options.color ?? EFFECT_COLORS.dust, countScale: 1.0 * size });
    this._burst('sparks', origin, { color: options.sparkColor ?? EFFECT_COLORS.spark, countScale: 0.72 * size });
  }

  digDust(position, options = {}, scale) {
    this.dig(position, options, scale);
  }

  claim(position, options = {}, scale) {
    options = optionBag(options, scale);
    const origin = this._vector(position, 0.055);
    const color = options.color ?? EFFECT_COLORS.claim;
    this._pulse(origin, color, { duration: 0.8, start: 0.22, end: 2.15, thickness: 0.055 });
    this._pulse(origin, color, { duration: 1.0, delay: 0.12, start: 0.14, end: 1.55, thickness: 0.028, spin: 1.8 });
    this._burst('rally', this._vector(position, 0.12), { color, countScale: 0.55 });
    this._flashLight(origin, color, 2.2, 0.38, 0.46);
  }

  claimRunePulse(position, options = {}, scale) {
    this.claim(position, options, scale);
  }

  spawn(position, options = {}, scale) {
    options = optionBag(options, scale);
    const origin = this._vector(position, 0.15);
    const color = options.color ?? EFFECT_COLORS.spawn;
    this._burst('spawn', origin, { color, countScale: options.scale ?? 1 });
    this._pulse(this._vector(position, 0.06), color, { duration: 0.9, start: 0.16, end: 1.65, thickness: 0.045 });
    this._flashLight(origin, color, 3.0, 0.62, 0.55);
  }

  despawn(position, options = {}, scale) {
    options = optionBag(options, scale);
    const origin = this._vector(position, 0.18);
    const color = options.color ?? EFFECT_COLORS.despawn;
    this._burst('despawn', origin, { color, countScale: options.scale ?? 1 });
    this._pulse(this._vector(position, 0.08), color, { duration: 0.72, start: 1.35, end: 0.12, thickness: 0.05 });
    this._flashLight(origin, color, 2.4, 0.48, 0.48);
  }

  hit(position, options = {}, scale) {
    options = optionBag(options, scale);
    const origin = this._vector(position, options.height ?? 0.7);
    const color = options.color ?? EFFECT_COLORS.hit;
    this._burst('hit', origin, { color, countScale: (options.armored ? 0.75 : 1) * (options.scale ?? 1) });
    if (options.armored) this._burst('sparks', origin, { color: 0xffd18a, countScale: 0.5 });
    this._flashLight(origin, color, 1.4, 0.18, 0.18);
    if (options.shake !== false) this.shake(options.heavy ? 0.34 : 0.13, options.heavy ? 0.22 : 0.12);
  }

  healing(position, options = {}, scale) {
    options = optionBag(options, scale);
    const origin = this._vector(position, 0.08);
    const color = options.color ?? EFFECT_COLORS.heal;
    this._burst('heal', origin, { color, countScale: options.scale ?? 1 });
    this._pulse(origin, color, { duration: 1.15, start: 0.18, end: 1.25, thickness: 0.035, vertical: 0.7 });
    this._flashLight(origin, color, 2.25, 0.38, 0.72);
  }

  heal(position, options = {}, scale) {
    this.healing(position, options, scale);
  }

  rally(position, options = {}, scale) {
    options = optionBag(options, scale);
    const origin = this._vector(position, 0.07);
    const color = options.color ?? EFFECT_COLORS.rally;
    this._pulse(origin, color, { duration: 1.15, start: 0.25, end: options.radius ?? 3.2, thickness: 0.065 });
    this._pulse(origin, color, { duration: 1.42, delay: 0.12, start: 0.18, end: (options.radius ?? 3.2) * 0.75, thickness: 0.03, spin: -1.3 });
    this._burst('rally', origin, { color, countScale: 1.0 });
    this._flashLight(origin, color, 3.6, 0.42, 0.7);
    this.shake(0.16, 0.28);
  }

  // Entity-system compatibility aliases. They deliberately map broad gameplay
  // events onto the same small family of pooled effects instead of multiplying
  // particle systems for every creature state.
  work(position, options = {}, scale) {
    this.dig(position, options, scale);
  }

  attack(position, options = {}, scale) {
    options = optionBag(options, scale);
    this._burst('sparks', this._vector(position, 0.55), {
      color: options.color ?? EFFECT_COLORS.spark,
      countScale: 0.7 * (options.scale ?? 1),
    });
  }

  projectile(position, options = {}, scale) {
    options = optionBag(options, scale);
    this._burst('sparks', this._vector(position, 0.65), {
      color: options.color ?? EFFECT_COLORS.lightning,
      countScale: 0.9 * (options.scale ?? 1),
    });
  }

  death(position, options = {}, scale) {
    this.despawn(position, options, scale);
  }

  burst(position, options = {}) {
    const kind = options.kind || 'spawn';
    if (typeof this[kind] === 'function' && kind !== 'burst') {
      this[kind](position, options);
      return;
    }
    this.spawn(position, options);
  }

  spawnBurst(position, color, scale) {
    this.spawn(position, color, scale);
  }

  // A pooled polyline bolt. The jitter is generated once per strike; a second
  // dim branch on high tiers makes the silhouette feel less procedural.
  lightning(from, to, options = {}) {
    const start = this._vector(from, 0.4);
    const end = this._vector(to, 0.4);
    const color = options.color ?? EFFECT_COLORS.lightning;
    const slot = this._acquireLightning();
    if (!slot) return;
    this._writeBolt(slot, start, end, color, options.width ?? 1);
    slot.life = options.duration ?? 0.19;
    slot.maxLife = slot.life;
    slot.mesh.setEnabled(true);
    this._burst('sparks', end, { color, countScale: 1.15 });
    this._flashLight(end, color, 4.2, 0.72, 0.3);
    this.shake(options.shake ?? 0.4, 0.25);
  }

  /**
   * Starts a persistent portal visual and returns an opaque handle. Call
   * releasePortal(handle) when its tile is removed. Portal slots are capped by
   * quality tier; when the cap is reached, the oldest portal is recycled.
   */
  createPortalVortex(position, options = {}) {
    const slot = this._acquirePortal();
    const color = options.color ?? EFFECT_COLORS.portal;
    const origin = this._vector(position, options.height ?? 0.12);
    slot.generation += 1;
    slot.active = true;
    slot.age = Math.random() * 5;
    slot.node.position.copyFrom(origin);
    slot.inner.material.emissiveColor.copyFrom(color3(this.B, color));
    slot.outer.material.emissiveColor.copyFrom(color3(this.B, color));
    slot.node.setEnabled(true);
    slot.particles.color1 = color4(this.B, color, 0.9);
    slot.particles.color2 = color4(this.B, options.secondaryColor ?? 0x4ecbff, 0.72);
    slot.particles.colorDead = color4(this.B, color, 0);
    slot.particles.emitRate = Math.max(3, Math.round(16 * this.quality.particleScale));
    slot.particles.start();
    if (this.quality.lights > 0) {
      slot.light = this._leaseLight(origin, color, options.lightRange ?? 5.5, options.lightIntensity ?? 0.34, Infinity, slot);
    }
    return { slot, generation: slot.generation };
  }

  portalVortex(position, options = {}) {
    return this.createPortalVortex(position, options);
  }

  movePortal(handle, position) {
    const slot = this._resolvePortal(handle);
    if (!slot) return false;
    slot.node.position.copyFrom(this._vector(position, 0.12));
    if (slot.light) slot.light.light.position.copyFrom(slot.node.position);
    return true;
  }

  releasePortal(handle) {
    const slot = this._resolvePortal(handle);
    if (!slot) return false;
    this._stopPortal(slot);
    return true;
  }

  /** Box is { minX, maxX, minZ, maxZ, minY?, maxY? }. */
  setAmbientEmbers(box) {
    this.ambientBounds = box || null;
    this._configureAmbient();
  }

  stopAmbientEmbers() {
    if (this.ambientSystem) this.ambientSystem.stop();
  }

  shake(intensity = 0.15, duration = 0.16, options = {}) {
    if (this.quality.shake <= 0 || intensity <= 0 || duration <= 0) return;
    this.shakes.push({
      age: 0,
      duration,
      intensity: intensity * this.quality.shake,
      frequency: options.frequency ?? 31,
      seed: Math.random() * 1000,
    });
    if (this.shakes.length > 4) this.shakes.shift();
  }

  update(deltaSeconds, timeSeconds) {
    if (this.disposed) return;
    const dt = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.1);
    this.time = Number.isFinite(timeSeconds) ? timeSeconds : this.time + dt;

    this._updateBursts(dt);
    this._updatePulses(dt);
    this._updateLights(dt);
    this._updateLightning(dt);
    this._updatePortals(dt);
    this._updateShake(dt);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // Every particle system shares particleTexture. Keep it alive until all
    // systems are gone, then release that single texture exactly once below.
    this.burstPools.forEach((pool) => pool.forEach((slot) => slot.system.dispose(false)));
    this.burstPools.clear();
    this.pulses.forEach((slot) => {
      slot.mesh.dispose(false, true);
    });
    this.lightPool.forEach((light) => light.dispose());
    this.lightningPool.forEach((slot) => slot.mesh.dispose());
    this.portalPool.forEach((slot) => {
      slot.particles.dispose(false);
      slot.node.dispose(false, true);
    });
    if (this.ambientSystem) this.ambientSystem.dispose(false);
    if (this.particleTexture) this.particleTexture.dispose();
    if (this.shakeHook) this.shakeHook({ x: 0, y: 0, z: 0, roll: 0, normalizedIntensity: 0 });
  }

  _buildPools() {
    if (this.disposed) return;
    Object.entries(BURST_RECIPES).forEach(([name, recipe]) => {
      let pool = this.burstPools.get(name);
      if (!pool) {
        pool = [];
        this.burstPools.set(name, pool);
      }
      while (pool.length < this.quality.burstSlots) pool.push(this._createBurstSlot(name, recipe, pool.length));
    });
    while (this.pulses.length < this.quality.pulseSlots) this.pulses.push(this._createPulseSlot(this.pulses.length));
    while (this.lightPool.length < this.quality.lights) this.lightPool.push(this._createLight(this.lightPool.length));
    this.lightCap = this.quality.lights;
    while (this.lightningPool.length < this.quality.lightningSlots) this.lightningPool.push(this._createLightningSlot(this.lightningPool.length));
    while (this.portalPool.length < this.quality.portalSlots) this.portalPool.push(this._createPortalSlot(this.portalPool.length));
  }

  _createParticleTexture() {
    const B = this.B;
    const texture = new B.DynamicTexture('fx-soft-particle', { width: 32, height: 32 }, this.scene, false);
    const ctx = texture.getContext();
    const gradient = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.28, 'rgba(255,255,255,.92)');
    gradient.addColorStop(0.7, 'rgba(255,255,255,.28)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.clearRect(0, 0, 32, 32);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    texture.hasAlpha = true;
    texture.update(false);
    return texture;
  }

  _createBurstSlot(name, recipe, index) {
    const B = this.B;
    const system = new B.ParticleSystem(`fx-${name}-${index}`, recipe.capacity, this.scene);
    system.particleTexture = this.particleTexture;
    system.emitter = new B.Vector3(0, 0, 0);
    system.minLifeTime = recipe.life[0];
    system.maxLifeTime = recipe.life[1];
    system.minSize = recipe.size[0];
    system.maxSize = recipe.size[1];
    system.minEmitPower = recipe.power[0];
    system.maxEmitPower = recipe.power[1];
    system.direction1 = new B.Vector3(-0.7, 0.45, -0.7);
    system.direction2 = new B.Vector3(0.7, 1.35, 0.7);
    system.gravity = new B.Vector3(0, recipe.gravity, 0);
    system.emitRate = 0;
    system.targetStopDuration = 0.06;
    system.disposeOnStop = false;
    system.blendMode = recipe.blend === 'add' ? B.ParticleSystem.BLENDMODE_ADD : B.ParticleSystem.BLENDMODE_STANDARD;
    system.renderingGroupId = 2;
    return { system, recipe, life: 0, busy: false };
  }

  _burst(name, position, options = {}) {
    const completePool = this.burstPools.get(name);
    const pool = completePool && completePool.slice(0, this.quality.burstSlots);
    if (!pool || !pool.length) return false;
    let slot = pool.find((candidate) => !candidate.busy);
    if (!slot) slot = pool.reduce((oldest, candidate) => candidate.life < oldest.life ? candidate : oldest, pool[0]);
    const { system, recipe } = slot;
    system.stop();
    system.emitter.copyFrom(position);
    const color = options.color ?? recipe.color;
    system.color1 = color4(this.B, color, 0.95);
    system.color2 = color4(this.B, color, recipe.blend === 'add' ? 0.5 : 0.72);
    system.colorDead = color4(this.B, color, 0);
    const count = Math.max(2, Math.round(recipe.count * this.quality.particleScale * (options.countScale ?? 1)));
    system.manualEmitCount = count;
    slot.life = recipe.duration;
    slot.busy = true;
    system.start();
    return true;
  }

  _createPulseSlot(index) {
    const B = this.B;
    const mesh = B.MeshBuilder.CreateTorus(`fx-pulse-${index}`, {
      diameter: 1,
      thickness: 0.055,
      tessellation: this.qualityTier === 'low' ? 16 : 28,
    }, this.scene);
    const material = new B.StandardMaterial(`fx-pulse-mat-${index}`, this.scene);
    material.diffuseColor = B.Color3.Black();
    material.specularColor = B.Color3.Black();
    material.emissiveColor = B.Color3.White();
    material.disableLighting = true;
    material.alpha = 0;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
    return { mesh, material, age: 0, duration: 0, delay: 0, busy: false, start: 0, end: 1, vertical: 0, spin: 0 };
  }

  _pulse(position, color, options = {}) {
    const pool = this.pulses.slice(0, this.quality.pulseSlots);
    let slot = pool.find((candidate) => !candidate.busy);
    if (!slot) slot = pool.reduce((oldest, candidate) => candidate.age > oldest.age ? candidate : oldest, pool[0]);
    if (!slot) return false;
    slot.busy = true;
    slot.age = 0;
    slot.duration = options.duration ?? 0.8;
    slot.delay = options.delay ?? 0;
    slot.start = options.start ?? 0.2;
    slot.end = options.end ?? 1.8;
    slot.vertical = options.vertical ?? 0;
    slot.spin = options.spin ?? 0.7;
    slot.mesh.position.copyFrom(position);
    slot.mesh.scaling.setAll(slot.start);
    slot.mesh.rotation.y = Math.random() * Math.PI;
    slot.mesh.visibility = 1;
    slot.material.alpha = 0;
    slot.material.emissiveColor.copyFrom(color3(this.B, color));
    slot.mesh.setEnabled(true);
    return true;
  }

  _createLight(index) {
    const B = this.B;
    const light = new B.PointLight(`fx-light-${index}`, B.Vector3.Zero(), this.scene);
    light.diffuse = B.Color3.White();
    light.specular = B.Color3.Black();
    light.intensity = 0;
    light.range = 3;
    light.setEnabled(false);
    return light;
  }

  _leaseLight(position, color, range, intensity, duration, owner = null) {
    if (this.lightCap <= 0) return null;
    let lease = this.lightLeases.find((candidate) => !candidate.active && candidate.index < this.lightCap);
    if (!lease) {
      const index = this.lightCursor++ % this.lightCap;
      lease = this.lightLeases[index];
      if (!lease) {
        lease = { index, light: this.lightPool[index], active: false, owner: null, serial: 0, life: 0, maxLife: 0, intensity: 0 };
        this.lightLeases[index] = lease;
      } else if (lease.owner && lease.owner.light === lease) {
        lease.owner.light = null;
      }
    }
    lease.serial = ++this.lightSerial;
    lease.active = true;
    lease.owner = owner;
    lease.life = duration;
    lease.maxLife = duration;
    lease.intensity = intensity;
    lease.light.position.copyFrom(position);
    lease.light.diffuse.copyFrom(color3(this.B, color));
    lease.light.range = range;
    lease.light.intensity = intensity;
    lease.light.setEnabled(true);
    return lease;
  }

  _flashLight(position, color, range, intensity, duration) {
    return this._leaseLight(position, color, range, intensity, duration);
  }

  _createLightningSlot(index) {
    const B = this.B;
    const points = Array.from({ length: 9 }, () => B.Vector3.Zero());
    const mesh = B.MeshBuilder.CreateLines(`fx-lightning-${index}`, { points, updatable: true }, this.scene);
    mesh.color = color3(B, EFFECT_COLORS.lightning);
    mesh.alpha = 0;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
    return { mesh, points, life: 0, maxLife: 0, busy: false };
  }

  _acquireLightning() {
    const pool = this.lightningPool.slice(0, this.quality.lightningSlots);
    if (!pool.length) return null;
    const free = pool.find((slot) => !slot.busy);
    if (free) {
      free.busy = true;
      return free;
    }
    return pool.reduce((oldest, candidate) => candidate.life < oldest.life ? candidate : oldest, pool[0]);
  }

  _writeBolt(slot, start, end, color, width) {
    const B = this.B;
    const direction = end.subtract(start);
    const length = Math.max(direction.length(), 0.001);
    const tangent = direction.scale(1 / length);
    let side = B.Vector3.Cross(tangent, B.Axis.Y);
    if (side.lengthSquared() < 0.001) side = B.Vector3.Cross(tangent, B.Axis.X);
    side.normalize();
    const up = B.Vector3.Cross(side, tangent).normalize();
    for (let i = 0; i < slot.points.length; i++) {
      const t = i / (slot.points.length - 1);
      const envelope = Math.sin(Math.PI * t);
      const jitter = Math.min(0.24, length * 0.09) * envelope * width;
      const point = B.Vector3.Lerp(start, end, t);
      if (i > 0 && i < slot.points.length - 1) {
        point.addInPlace(side.scale((Math.random() - 0.5) * jitter));
        point.addInPlace(up.scale((Math.random() - 0.5) * jitter));
      }
      slot.points[i].copyFrom(point);
    }
    B.MeshBuilder.CreateLines(null, { points: slot.points, instance: slot.mesh });
    slot.mesh.color.copyFrom(color3(B, color));
    slot.mesh.alpha = 1;
  }

  _createPortalSlot(index) {
    const B = this.B;
    const node = new B.TransformNode(`fx-portal-${index}`, this.scene);
    const inner = B.MeshBuilder.CreateTorus(`fx-portal-inner-${index}`, { diameter: 1.0, thickness: 0.065, tessellation: 32 }, this.scene);
    const outer = B.MeshBuilder.CreateTorus(`fx-portal-outer-${index}`, { diameter: 1.5, thickness: 0.035, tessellation: 32 }, this.scene);
    inner.parent = node;
    outer.parent = node;
    inner.rotation.x = 0.16;
    outer.rotation.z = -0.13;
    inner.isPickable = false;
    outer.isPickable = false;
    const innerMaterial = new B.StandardMaterial(`fx-portal-inner-mat-${index}`, this.scene);
    const outerMaterial = new B.StandardMaterial(`fx-portal-outer-mat-${index}`, this.scene);
    [innerMaterial, outerMaterial].forEach((material) => {
      material.diffuseColor = B.Color3.Black();
      material.specularColor = B.Color3.Black();
      material.emissiveColor = color3(B, EFFECT_COLORS.portal);
      material.alpha = 0.86;
      material.disableLighting = true;
    });
    inner.material = innerMaterial;
    outer.material = outerMaterial;
    const particles = new B.ParticleSystem(`fx-portal-particles-${index}`, 96, this.scene);
    particles.particleTexture = this.particleTexture;
    particles.emitter = node;
    particles.minEmitBox = new B.Vector3(-0.58, 0.02, -0.58);
    particles.maxEmitBox = new B.Vector3(0.58, 0.08, 0.58);
    particles.direction1 = new B.Vector3(-0.2, 0.2, -0.2);
    particles.direction2 = new B.Vector3(0.2, 0.8, 0.2);
    particles.minLifeTime = 0.45;
    particles.maxLifeTime = 1.05;
    particles.minSize = 0.035;
    particles.maxSize = 0.12;
    particles.minEmitPower = 0.15;
    particles.maxEmitPower = 0.55;
    particles.gravity = new B.Vector3(0, 0.38, 0);
    particles.emitRate = 0;
    particles.blendMode = B.ParticleSystem.BLENDMODE_ADD;
    particles.disposeOnStop = false;
    particles.renderingGroupId = 2;
    node.setEnabled(false);
    return { node, inner, outer, particles, active: false, generation: 0, age: 0, light: null };
  }

  _acquirePortal() {
    const pool = this.portalPool.slice(0, this.quality.portalSlots);
    let slot = pool.find((candidate) => !candidate.active);
    if (!slot) {
      slot = pool.reduce((oldest, candidate) => candidate.age > oldest.age ? candidate : oldest, pool[0]);
      this._stopPortal(slot);
    }
    return slot;
  }

  _resolvePortal(handle) {
    if (!handle || !handle.slot || handle.slot.generation !== handle.generation || !handle.slot.active) return null;
    return handle.slot;
  }

  _stopPortal(slot) {
    slot.active = false;
    slot.particles.stop();
    slot.node.setEnabled(false);
    if (slot.light) {
      slot.light.active = false;
      slot.light.owner = null;
      slot.light.light.intensity = 0;
      slot.light.light.setEnabled(false);
      slot.light = null;
    }
  }

  _configureAmbient() {
    if (this.quality.embers <= 0 || !this.ambientBounds) {
      if (this.ambientSystem) this.ambientSystem.stop();
      return;
    }
    const B = this.B;
    if (!this.ambientSystem) {
      const system = new B.ParticleSystem('fx-ambient-embers', 96, this.scene);
      system.particleTexture = this.particleTexture;
      system.emitter = B.Vector3.Zero();
      system.minLifeTime = 1.8;
      system.maxLifeTime = 4.0;
      system.minSize = 0.025;
      system.maxSize = 0.085;
      system.minEmitPower = 0.08;
      system.maxEmitPower = 0.28;
      system.direction1 = new B.Vector3(-0.08, 0.12, -0.08);
      system.direction2 = new B.Vector3(0.08, 0.52, 0.08);
      system.gravity = new B.Vector3(0, 0.08, 0);
      system.color1 = color4(B, EFFECT_COLORS.ember, 0.72);
      system.color2 = color4(B, 0xffc05a, 0.48);
      system.colorDead = color4(B, EFFECT_COLORS.ember, 0);
      system.blendMode = B.ParticleSystem.BLENDMODE_ADD;
      system.renderingGroupId = 2;
      this.ambientSystem = system;
    }
    const box = this.ambientBounds;
    this.ambientSystem.minEmitBox = new B.Vector3(box.minX, box.minY ?? 0.2, box.minZ);
    this.ambientSystem.maxEmitBox = new B.Vector3(box.maxX, box.maxY ?? 1.8, box.maxZ);
    this.ambientSystem.emitRate = this.quality.embers / 4;
    this.ambientSystem.start();
  }

  _updateBursts(dt) {
    this.burstPools.forEach((pool) => pool.forEach((slot) => {
      if (!slot.busy) return;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.busy = false;
        slot.system.stop();
      }
    }));
  }

  _updatePulses(dt) {
    this.pulses.forEach((slot) => {
      if (!slot.busy) return;
      slot.age += dt;
      if (slot.age < slot.delay) return;
      const t = clamp((slot.age - slot.delay) / slot.duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const scale = slot.start + (slot.end - slot.start) * eased;
      slot.mesh.scaling.setAll(Math.max(0.001, scale));
      slot.mesh.rotation.y += slot.spin * dt;
      slot.mesh.position.y += slot.vertical * dt / Math.max(slot.duration, 0.001);
      slot.material.alpha = Math.sin(Math.PI * Math.min(t * 1.15, 1)) * (1 - t) * 1.45;
      if (t >= 1) {
        slot.busy = false;
        slot.material.alpha = 0;
        slot.mesh.setEnabled(false);
      }
    });
  }

  _updateLights(dt) {
    this.lightLeases.forEach((lease) => {
      if (!lease || !lease.active || lease.life === Infinity) return;
      lease.life -= dt;
      if (lease.life <= 0) {
        lease.active = false;
        lease.light.intensity = 0;
        lease.light.setEnabled(false);
        lease.owner = null;
        return;
      }
      const fraction = clamp(lease.life / lease.maxLife, 0, 1);
      const attack = Math.min(1, (1 - fraction) * 9);
      const release = Math.min(1, fraction * 3.2);
      lease.light.intensity = lease.intensity * attack * release;
    });
  }

  _updateLightning(dt) {
    this.lightningPool.forEach((slot) => {
      if (!slot.busy) return;
      slot.life -= dt;
      const fraction = clamp(slot.life / slot.maxLife, 0, 1);
      slot.mesh.alpha = fraction > 0.55 ? 1 : fraction / 0.55;
      if (slot.life <= 0) {
        slot.busy = false;
        slot.mesh.setEnabled(false);
      }
    });
  }

  _updatePortals(dt) {
    this.portalPool.forEach((slot) => {
      if (!slot.active) return;
      slot.age += dt;
      slot.inner.rotation.y += dt * 1.6;
      slot.outer.rotation.y -= dt * 0.85;
      slot.inner.scaling.setAll(1 + Math.sin(slot.age * 3.1) * 0.055);
      slot.outer.scaling.setAll(1 + Math.sin(slot.age * 2.2 + 1.4) * 0.07);
      const alphaPulse = 0.76 + Math.sin(slot.age * 3.4) * 0.14;
      slot.inner.material.alpha = alphaPulse;
      slot.outer.material.alpha = alphaPulse * 0.72;
      if (slot.light) slot.light.light.intensity = slot.light.intensity * (0.88 + Math.sin(slot.age * 2.7) * 0.12);
    });
  }

  _updateShake(dt) {
    if (!this.shakeHook) {
      this.shakes.length = 0;
      return;
    }
    let x = 0;
    let y = 0;
    let z = 0;
    let roll = 0;
    let total = 0;
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const shake = this.shakes[i];
      shake.age += dt;
      if (shake.age >= shake.duration) {
        this.shakes.splice(i, 1);
        continue;
      }
      const fade = Math.pow(1 - shake.age / shake.duration, 2);
      const amount = shake.intensity * fade;
      const phase = (shake.seed + shake.age * shake.frequency) * Math.PI * 2;
      x += Math.sin(phase * 1.07) * amount;
      y += Math.sin(phase * 1.73 + 0.8) * amount * 0.42;
      z += Math.sin(phase * 0.83 + 2.2) * amount * 0.55;
      roll += Math.sin(phase * 1.31 + 1.4) * amount * 0.012;
      total += amount;
    }
    if (total > 0 || this._lastShake.normalizedIntensity > 0) {
      this._lastShake = { x, y, z, roll, normalizedIntensity: clamp(total, 0, 1) };
      this.shakeHook(this._lastShake);
    }
  }

  _vector(value, yOffset = 0) {
    const B = this.B;
    if (!value) return new B.Vector3(0, yOffset, 0);
    return new B.Vector3(Number(value.x) || 0, (Number(value.y) || 0) + yOffset, Number(value.z) || 0);
  }
}
