// ============================================================
// BABYLON ENTITY DIRECTOR
// ============================================================
// A compact, data-driven character layer for the Babylon renderer. Every
// procedural character uses the same small library of geometry and PBR
// materials. Mesh clones therefore share GPU buffers while TransformNodes
// provide enough articulation for readable, skeletal-feeling motion.
//
// Authored GLB characters can replace any procedural model through the
// runtime's optional AssetLibrary. The procedural cast remains the zero-load,
// offline-safe fallback and deliberately has complete silhouettes and gear.

const B = window.BABYLON;

const TAU = Math.PI * 2;

const ENTITY_DEFS = Object.freeze({
  imp:        { faction: 'dungeon', hp: 38,  damage: 3,  range: 0.72, speed: 2.15, scale: 0.88 },
  bileDemon:  { faction: 'dungeon', hp: 260, damage: 20, range: 1.05, speed: 0.72, scale: 1.1 },
  troll:      { faction: 'dungeon', hp: 170, damage: 16, range: 1.05, speed: 1.05, scale: 1.05 },
  warlock:    { faction: 'dungeon', hp: 92,  damage: 14, range: 4.4,  speed: 1.18, scale: 0.98 },
  fly:        { faction: 'dungeon', hp: 42,  damage: 7,  range: 0.8,  speed: 2.45, scale: 0.92 },
  knight:     { faction: 'heroes',  hp: 130, damage: 14, range: 0.95, speed: 1.15, scale: 1 },
  archer:     { faction: 'heroes',  hp: 76,  damage: 11, range: 4.8,  speed: 1.35, scale: 0.96 },
  priest:     { faction: 'heroes',  hp: 86,  damage: 8,  range: 3.6,  speed: 1.08, scale: 1 },
});

const TYPE_ALIASES = Object.freeze({
  'bile-demon': 'bileDemon', bile_demon: 'bileDemon', demon: 'bileDemon',
  goblin: 'troll', fighter: 'knight', mage: 'warlock', bug: 'fly',
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function shortestAngle(from, to) {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

function canonicalType(type) {
  const raw = String(type || 'imp');
  return TYPE_ALIASES[raw] || raw;
}

function entityOf(value, entities) {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return entities.get(String(value)) || null;
  if (value.root && value.id) return value;
  return value.metadata?.entity || value.parent?.metadata?.entity || null;
}

/**
 * Owns all Babylon character visuals, lightweight navigation, combat and
 * procedural animation. It intentionally talks to DungeonWorld only through
 * public methods (`isWalkable`, `randomWalkable`, `getHeartPosition`, and the
 * optional tile mutators), so render and simulation responsibilities remain
 * separable.
 */
export class EntityDirector {
  constructor(runtime, world, effects = null) {
    if (!B) throw new Error('EntityDirector requires window.BABYLON.');
    if (!runtime?.scene) throw new Error('EntityDirector requires runtime.scene.');

    this.runtime = runtime;
    this.scene = runtime.scene;
    this.world = world;
    this.effects = effects;
    this.entities = new Map();
    this._serial = 0;
    this._time = 0;
    this.rallyPoint = null;
    this.rallyUntil = 0;
    this._templates = new Map();
    this._materials = new Map();
    this._disposed = false;

    this.root = new B.TransformNode('entities', this.scene);
    this.root.metadata = { kind: 'entity-layer' };
    this._createMaterials();
  }

  // ------------------------------------------------------------
  // Public lifecycle and commands
  // ------------------------------------------------------------

  spawn(type, options = {}, z = undefined, extra = {}) {
    if (this._disposed) throw new Error('Cannot spawn into a disposed EntityDirector.');
    // Also accept spawn(type, x, z, options) for lightweight callers.
    if (typeof options === 'number') options = { ...extra, x: options, z };
    const kind = canonicalType(type);
    const def = ENTITY_DEFS[kind];
    if (!def) throw new Error(`Unknown entity type: ${type}`);

    const id = String(options.id ?? `${kind}-${++this._serial}`);
    if (this.entities.has(id)) throw new Error(`Entity id already exists: ${id}`);

    const root = new B.TransformNode(`entity:${id}`, this.scene);
    root.parent = this.root;
    root.position.copyFrom(this._positionFrom(options));
    root.rotation = new B.Vector3(0, Number(options.facing) || 0, 0);
    root.scaling.setAll((Number(options.scale) || 1) * def.scale);

    const visual = new B.TransformNode(`visual:${id}`, this.scene);
    visual.parent = root;
    const built = this._build(kind, visual);
    const maxHp = Number(options.maxHp ?? options.hp ?? def.hp);
    const entity = {
      id, type: kind, faction: options.faction || def.faction,
      root, visual, proceduralVisual: visual,
      parts: built.parts || {}, meshes: built.meshes || [],
      state: options.state || 'idle', previousState: 'idle',
      hp: Number(options.hp ?? maxHp), maxHp,
      damage: Number(options.damage ?? def.damage),
      attackRange: Number(options.attackRange ?? def.range),
      speed: Number(options.speed ?? def.speed),
      attackInterval: Number(options.attackInterval ?? 0.9),
      attackCooldown: Math.random() * 0.3,
      phase: Math.random() * TAU, stateTime: 0, age: 0,
      target: null, destination: null, path: [], pathIndex: 0,
      repathTime: 0, thinkTime: 0.2 + Math.random() * 0.65,
      hitTime: 0, deathTime: 0, removeAt: Infinity,
      work: null, carryAmount: Number(options.carryAmount) || 0,
      autonomous: options.autonomous !== false,
      userData: options.userData || {},
      animationGroups: [], activeAssetAnimation: null,
      assetInstance: null,
      onDeath: options.onDeath || null,
    };
    root.metadata = { entity, entityId: id, entityType: kind, faction: entity.faction };
    for (const mesh of entity.meshes) this._markPickable(mesh, entity);
    this.entities.set(id, entity);

    this._tryAssetOverride(entity, options);
    this._effect('spawn', root.position, entity.faction === 'heroes' ? '#8ed8ff' : '#d69bff', 0.55);
    return entity;
  }

  spawnImp(x, z, options = {}) {
    return this.spawn('imp', { ...options, x, z });
  }

  summonImp(x, z, options = {}) {
    return this.spawnImp(x, z, options);
  }

  spawnCreature(type, x, z, options = {}) {
    const kind = canonicalType(type);
    if (ENTITY_DEFS[kind]?.faction !== 'dungeon' || kind === 'imp') {
      throw new Error(`Not a dungeon creature type: ${type}`);
    }
    return this.spawn(kind, { ...options, x, z });
  }

  spawnHero(type = 'knight', x = undefined, z = undefined, options = {}) {
    const kind = canonicalType(type);
    if (ENTITY_DEFS[kind]?.faction !== 'heroes') throw new Error(`Not a hero type: ${type}`);
    const position = Number.isFinite(x) && Number.isFinite(z)
      ? new B.Vector3(x, 0, z)
      : this._heroSpawnPosition();
    return this.spawn(kind, { ...options, position });
  }

  get(id) {
    return this.entities.get(String(id)) || null;
  }

  getById(id) {
    return this.get(id);
  }

  list(kind = null) {
    if (!kind) return this.getAll();
    const normalized = canonicalType(String(kind).replace(/s$/, ''));
    if (kind === 'imps' || normalized === 'imp') return this.getAll().filter((entity) => entity.type === 'imp');
    if (kind === 'heroes' || normalized === 'hero') return this.getAll('heroes');
    if (kind === 'creatures' || normalized === 'creature') {
      return this.getAll('dungeon').filter((entity) => entity.type !== 'imp');
    }
    if (kind === 'dungeon' || kind === 'heroes') return this.getAll(kind);
    return this.getAll().filter((entity) => entity.type === normalized);
  }

  getAll(faction = null) {
    const result = [];
    for (const entity of this.entities.values()) {
      if (!faction || entity.faction === faction) result.push(entity);
    }
    return result;
  }

  /** Returns the owning entity for a Babylon pick result, mesh, or child node. */
  fromPick(pickOrMesh) {
    let node = pickOrMesh?.pickedMesh || pickOrMesh;
    while (node) {
      const id = node.metadata?.entityId;
      if (id != null) return this.get(id);
      if (node.metadata?.entity) return node.metadata.entity;
      node = node.parent;
    }
    return null;
  }

  setState(entityOrId, state, options = {}) {
    const entity = entityOf(entityOrId, this.entities);
    if (!entity || entity.state === 'death') return false;
    const next = String(state || 'idle');
    if (entity.state !== next) {
      entity.previousState = entity.state;
      entity.state = next;
      entity.stateTime = 0;
      this._playAssetAnimation(entity, next);
    }
    if (options.target !== undefined) entity.target = entityOf(options.target, this.entities) || options.target;
    if (options.destination) this.moveTo(entity, options.destination, { state: next });
    return true;
  }

  moveTo(entityOrId, destination, options = {}) {
    const entity = entityOf(entityOrId, this.entities);
    if (!entity || entity.state === 'death') return false;
    const to = this._positionFrom(destination);
    if (Number.isFinite(this.world?.gridSize)) {
      to.x = clamp(to.x, 0, this.world.gridSize - 1);
      to.z = clamp(to.z, 0, this.world.gridSize - 1);
    }
    const path = this._findPath(entity.root.position, to);
    if (!path.length) return false;
    entity.destination = to;
    entity.path = path;
    entity.pathIndex = entity.path.length > 1 ? 1 : 0;
    entity.repathTime = 0.7;
    this.setState(entity, options.state || 'walk');
    return true;
  }

  assignWork(entityOrId, action, x, z, options = {}) {
    const entity = entityOf(entityOrId, this.entities);
    if (!entity || entity.state === 'death') return false;
    entity.work = {
      action: String(action || 'dig'), x: Math.round(x), z: Math.round(z),
      duration: Math.max(0.15, Number(options.duration) || 1.5),
      elapsed: 0, onComplete: options.onComplete || null,
    };
    const approach = this._nearestWalkableTo(entity.work.x, entity.work.z, entity.root.position);
    this.moveTo(entity, approach || { x, y: 0, z }, { state: 'walk' });
    return true;
  }

  setCarrying(entityOrId, amount) {
    const entity = entityOf(entityOrId, this.entities);
    if (!entity) return false;
    entity.carryAmount = Math.max(0, Number(amount) || 0);
    if (entity.parts.cargo) entity.parts.cargo.setEnabled(entity.carryAmount > 0);
    if (entity.carryAmount > 0 && entity.state !== 'death') this.setState(entity, 'carry');
    return true;
  }

  takeDamage(entityOrId, amount, attacker = null) {
    const entity = entityOf(entityOrId, this.entities);
    if (!entity || entity.state === 'death') return false;
    entity.hp = Math.max(0, entity.hp - Math.max(0, Number(amount) || 0));
    entity.target = entityOf(attacker, this.entities) || entity.target;
    entity.hitTime = 0.24;
    if (entity.hp <= 0) {
      this._kill(entity);
    } else {
      this.setState(entity, 'hit');
      this._effect('hit', entity.root.position, entity.faction === 'heroes' ? '#9edcff' : '#ff6b55', 0.32);
    }
    return true;
  }

  heal(entityOrId, amount = null) {
    const entity = entityOf(entityOrId, this.entities);
    if (!entity || entity.state === 'death' || entity.hp <= 0) return false;
    const restored = Math.max(1, Number(amount) || Math.max(18, entity.maxHp * 0.35));
    entity.hp = Math.min(entity.maxHp, entity.hp + restored);
    this._effect('healing', entity.root.position, '#6effa2', 0.55);
    return true;
  }

  setRally(x, z, duration = 9) {
    this.rallyPoint = this._positionFrom({ x, y: 0, z });
    this.rallyUntil = this._time + Math.max(1, Number(duration) || 9);
    this._effect('rally', this.rallyPoint, '#ffc449', 0.72);
    for (const entity of this.getAll('dungeon')) {
      if (entity.type !== 'imp' && entity.state !== 'death') this.moveTo(entity, this.rallyPoint, { state: 'walk' });
    }
    return true;
  }

  remove(entityOrId) {
    const entity = entityOf(entityOrId, this.entities);
    if (!entity) return false;
    this.entities.delete(entity.id);
    for (const group of entity.animationGroups) {
      try { group.stop(); } catch (_) { /* optional imported animation */ }
    }
    if (entity.assetInstance?.dispose) entity.assetInstance.dispose();
    entity.root.dispose(false, false);
    return true;
  }

  update(dt) {
    if (this._disposed) return;
    const step = clamp(Number(dt) || 0, 0, 0.075);
    this._time += step;
    const snapshot = Array.from(this.entities.values());
    for (const entity of snapshot) {
      entity.age += step;
      entity.stateTime += step;
      entity.attackCooldown = Math.max(0, entity.attackCooldown - step);
      entity.repathTime = Math.max(0, entity.repathTime - step);
      entity.thinkTime -= step;

      if (entity.state === 'death') {
        entity.deathTime += step;
        this._animate(entity, step);
        if (entity.deathTime >= entity.removeAt) this.remove(entity);
        continue;
      }
      if (entity.state === 'hit') {
        entity.hitTime -= step;
        if (entity.hitTime <= 0) this.setState(entity, entity.previousState === 'hit' ? 'idle' : entity.previousState);
      }

      if (entity.autonomous && entity.thinkTime <= 0) {
        entity.thinkTime = 0.26 + Math.random() * 0.18;
        this._think(entity);
      }
      this._updateMotion(entity, step);
      this._updateWork(entity, step);
      this._updateCombat(entity, step);
      this._animate(entity, step);
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const entity of Array.from(this.entities.values())) this.remove(entity);
    for (const mesh of this._templates.values()) mesh.dispose(false, false);
    for (const material of this._materials.values()) material.dispose(false, true);
    this._templates.clear();
    this._materials.clear();
    this.root.dispose(false, false);
  }

  // ------------------------------------------------------------
  // Shared materials and geometry
  // ------------------------------------------------------------

  _createMaterials() {
    const definitions = {
      impSkin:    ['#9c4329', 0.02, 0.76], impSkinLight: ['#cb6741', 0.01, 0.68],
      demonSkin:  ['#8b7650', 0.01, 0.9],  demonBelly:   ['#b7a46d', 0.01, 0.84],
      trollSkin:  ['#587b55', 0.01, 0.88], trollLight:   ['#84a668', 0.01, 0.8],
      heroSkin:   ['#d59a71', 0.01, 0.73], insect:       ['#2d5260', 0.28, 0.3],
      insectDark: ['#152d36', 0.18, 0.43], leather:      ['#4a281d', 0.02, 0.9],
      leatherTan: ['#8a5a32', 0.01, 0.86], clothRed:     ['#751f2a', 0.01, 0.92],
      clothBlue:  ['#234d77', 0.01, 0.88], clothCream:   ['#d5c79e', 0.01, 0.9],
      clothGreen: ['#35563d', 0.01, 0.9],  clothPurple:  ['#4b285f', 0.01, 0.86],
      clothBlack: ['#171922', 0.02, 0.82],
      steel:      ['#8996a8', 0.78, 0.29], darkSteel:    ['#3f4b59', 0.67, 0.37],
      gold:       ['#d99b2b', 0.72, 0.26], bone:         ['#d8d0ad', 0.01, 0.78],
      wood:       ['#5d3822', 0.01, 0.9],  arrow:        ['#a14a32', 0.01, 0.78],
    };
    for (const [name, [hex, metallic, roughness]] of Object.entries(definitions)) {
      const material = new B.PBRMaterial(`entity-mat:${name}`, this.scene);
      material.albedoColor = B.Color3.FromHexString(hex);
      material.metallic = metallic;
      material.roughness = roughness;
      material.environmentIntensity = metallic > 0.5 ? 0.72 : 0.46;
      this._materials.set(name, material);
    }
    this._emissiveMaterial('eyeAmber', '#ffae2b', 2.3);
    this._emissiveMaterial('eyeRed', '#ff4b35', 2.5);
    this._emissiveMaterial('magicPurple', '#b468ff', 2.5);
    this._emissiveMaterial('magicBlue', '#61d9ff', 2.4);

    const wing = new B.PBRMaterial('entity-mat:wing', this.scene);
    wing.albedoColor = B.Color3.FromHexString('#a9e5e6');
    wing.emissiveColor = B.Color3.FromHexString('#315f78');
    wing.alpha = 0.58;
    wing.transparencyMode = B.Material.MATERIAL_ALPHABLEND;
    wing.backFaceCulling = false;
    wing.roughness = 0.32;
    this._materials.set('wing', wing);
  }

  _emissiveMaterial(name, hex, intensity) {
    const material = new B.PBRMaterial(`entity-mat:${name}`, this.scene);
    const color = B.Color3.FromHexString(hex);
    material.albedoColor = color.scale(0.48);
    material.emissiveColor = color;
    material.emissiveIntensity = intensity;
    material.metallic = 0.18;
    material.roughness = 0.24;
    this._materials.set(name, material);
  }

  _template(shape) {
    const key = typeof shape === 'string' ? shape : shape.key;
    if (this._templates.has(key)) return this._templates.get(key);
    const name = `entity-geo:${key}`;
    let mesh;
    if (key === 'sphere') mesh = B.MeshBuilder.CreateSphere(name, { diameter: 1, segments: 8 }, this.scene);
    else if (key === 'smoothSphere') mesh = B.MeshBuilder.CreateSphere(name, { diameter: 1, segments: 12 }, this.scene);
    else if (key === 'box') mesh = B.MeshBuilder.CreateBox(name, { size: 1 }, this.scene);
    else if (key === 'cylinder') mesh = B.MeshBuilder.CreateCylinder(name, { height: 1, diameter: 1, tessellation: 8 }, this.scene);
    else if (key === 'hexCylinder') mesh = B.MeshBuilder.CreateCylinder(name, { height: 1, diameter: 1, tessellation: 6 }, this.scene);
    else if (key === 'cone') mesh = B.MeshBuilder.CreateCylinder(name, { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 7 }, this.scene);
    else if (key === 'torus') mesh = B.MeshBuilder.CreateTorus(name, { diameter: 1, thickness: 0.18, tessellation: 12 }, this.scene);
    else if (key === 'plane') mesh = B.MeshBuilder.CreatePlane(name, { width: 1, height: 1, sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
    else mesh = B.MeshBuilder.CreatePolyhedron(name, { type: 2, size: 0.5 }, this.scene);
    mesh.isVisible = false;
    mesh.isPickable = false;
    this._templates.set(key, mesh);
    return mesh;
  }

  _joint(parent, name, position = [0, 0, 0]) {
    const node = new B.TransformNode(name, this.scene);
    node.parent = parent;
    node.position.set(position[0], position[1], position[2]);
    return node;
  }

  _part(parent, name, shape, material, position, scaling, rotation = [0, 0, 0], meshes = null) {
    const mesh = this._template(shape).clone(name, parent, false, false);
    mesh.isVisible = true;
    mesh.isPickable = true;
    mesh.material = this._materials.get(material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.scaling.set(scaling[0], scaling[1], scaling[2]);
    mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    mesh.receiveShadows = true;
    this._addShadowCaster(mesh);
    if (meshes) meshes.push(mesh);
    return mesh;
  }

  _addShadowCaster(mesh) {
    const shadows = this.runtime.shadows || this.runtime.shadowGenerator;
    try {
      if (typeof this.runtime.addShadowCaster === 'function') this.runtime.addShadowCaster(mesh, false);
      else if (typeof shadows?.addShadowCaster === 'function') shadows.addShadowCaster(mesh);
      else if (typeof shadows?.addCaster === 'function') shadows.addCaster(mesh);
    } catch (_) { /* shadows are an optional runtime service */ }
  }

  _markPickable(mesh, entity) {
    mesh.isPickable = true;
    mesh.metadata = { ...(mesh.metadata || {}), entity, entityId: entity.id, entityType: entity.type, faction: entity.faction };
  }

  // ------------------------------------------------------------
  // Character construction
  // ------------------------------------------------------------

  _build(kind, root) {
    switch (kind) {
      case 'imp': return this._buildImp(root);
      case 'bileDemon': return this._buildBileDemon(root);
      case 'troll': return this._buildTroll(root);
      case 'warlock': return this._buildWarlock(root);
      case 'fly': return this._buildFly(root);
      case 'knight': return this._buildKnight(root);
      case 'archer': return this._buildArcher(root);
      case 'priest': return this._buildPriest(root);
      default: throw new Error(`No builder for entity type: ${kind}`);
    }
  }

  _bipedRig(root, meshes, options) {
    const parts = {};
    parts.body = this._part(root, 'torso', options.bodyShape || 'sphere', options.bodyMat, [0, options.bodyY, 0], options.bodyScale, [0, 0, 0], meshes);
    parts.headJoint = this._joint(root, 'head-joint', [0, options.headY, options.headZ || 0]);
    parts.head = this._part(parts.headJoint, 'head', options.headShape || 'sphere', options.skinMat, [0, 0, 0], options.headScale, [0, 0, 0], meshes);
    parts.armL = this._joint(root, 'arm-left', [-options.armX, options.armY, 0]);
    parts.armR = this._joint(root, 'arm-right', [options.armX, options.armY, 0]);
    parts.armMeshL = this._part(parts.armL, 'arm-left-mesh', 'hexCylinder', options.armMat || options.skinMat, [0, -options.armLength * 0.46, 0], [options.armWidth, options.armLength, options.armWidth], [0, 0, 0], meshes);
    parts.armMeshR = this._part(parts.armR, 'arm-right-mesh', 'hexCylinder', options.armMat || options.skinMat, [0, -options.armLength * 0.46, 0], [options.armWidth, options.armLength, options.armWidth], [0, 0, 0], meshes);
    parts.handL = this._part(parts.armL, 'hand-left', 'sphere', options.skinMat, [0, -options.armLength, 0], [options.handSize, options.handSize, options.handSize], [0, 0, 0], meshes);
    parts.handR = this._part(parts.armR, 'hand-right', 'sphere', options.skinMat, [0, -options.armLength, 0], [options.handSize, options.handSize, options.handSize], [0, 0, 0], meshes);
    parts.legL = this._joint(root, 'leg-left', [-options.legX, options.legY, 0]);
    parts.legR = this._joint(root, 'leg-right', [options.legX, options.legY, 0]);
    const legMat = options.legMat || options.bodyMat;
    this._part(parts.legL, 'leg-left-mesh', 'hexCylinder', legMat, [0, -options.legLength * 0.5, 0], [options.legWidth, options.legLength, options.legWidth], [0, 0, 0], meshes);
    this._part(parts.legR, 'leg-right-mesh', 'hexCylinder', legMat, [0, -options.legLength * 0.5, 0], [options.legWidth, options.legLength, options.legWidth], [0, 0, 0], meshes);
    parts.footL = this._part(parts.legL, 'foot-left', 'sphere', options.footMat || legMat, [0, -options.legLength, 0.06], [options.footWidth, options.footHeight, options.footLength], [0, 0, 0], meshes);
    parts.footR = this._part(parts.legR, 'foot-right', 'sphere', options.footMat || legMat, [0, -options.legLength, 0.06], [options.footWidth, options.footHeight, options.footLength], [0, 0, 0], meshes);
    return parts;
  }

  _eyes(parent, meshes, material, y, z, spread, size) {
    this._part(parent, 'eye-left', 'sphere', material, [-spread, y, z], [size, size * 0.7, size * 0.38], [0, 0, 0], meshes);
    this._part(parent, 'eye-right', 'sphere', material, [spread, y, z], [size, size * 0.7, size * 0.38], [0, 0, 0], meshes);
  }

  _buildImp(root) {
    const meshes = [];
    const parts = this._bipedRig(root, meshes, {
      bodyMat: 'impSkin', skinMat: 'impSkinLight', legMat: 'impSkin', footMat: 'impSkin',
      bodyY: 0.56, bodyScale: [0.48, 0.58, 0.34], headY: 0.98, headZ: 0.035,
      headScale: [0.44, 0.39, 0.38], armX: 0.31, armY: 0.66, armLength: 0.38,
      armWidth: 0.11, handSize: 0.15, legX: 0.14, legY: 0.36, legLength: 0.34,
      legWidth: 0.13, footWidth: 0.16, footHeight: 0.11, footLength: 0.25,
    });
    // Ears and swept-back brow make the Imp recognizable even at minimap scale.
    this._part(parts.headJoint, 'ear-left', 'cone', 'impSkinLight', [-0.31, 0.04, -0.02], [0.18, 0.42, 0.18], [0, 0, -1.22], meshes);
    this._part(parts.headJoint, 'ear-right', 'cone', 'impSkinLight', [0.31, 0.04, -0.02], [0.18, 0.42, 0.18], [0, 0, 1.22], meshes);
    this._part(parts.headJoint, 'brow-left', 'box', 'impSkin', [-0.11, 0.08, 0.19], [0.17, 0.045, 0.045], [0, 0, -0.15], meshes);
    this._part(parts.headJoint, 'brow-right', 'box', 'impSkin', [0.11, 0.08, 0.19], [0.17, 0.045, 0.045], [0, 0, 0.15], meshes);
    this._eyes(parts.headJoint, meshes, 'eyeAmber', -0.005, 0.197, 0.105, 0.075);
    this._part(root, 'loincloth', 'box', 'clothBlack', [0, 0.38, 0.02], [0.51, 0.2, 0.38], [0, 0, 0], meshes);
    this._part(root, 'belt', 'torus', 'leather', [0, 0.43, 0], [0.5, 0.17, 0.38], [Math.PI / 2, 0, 0], meshes);
    this._part(root, 'belt-buckle', 'box', 'gold', [0, 0.43, 0.22], [0.12, 0.11, 0.06], [0, 0, 0], meshes);
    this._part(root, 'satchel', 'box', 'leatherTan', [-0.31, 0.45, -0.03], [0.22, 0.25, 0.15], [0.08, 0, -0.12], meshes);
    const tail = this._joint(root, 'tail', [0, 0.45, -0.18]);
    this._part(tail, 'tail-segment', 'cone', 'impSkin', [0, 0.02, -0.23], [0.13, 0.54, 0.13], [Math.PI / 2.2, 0, 0], meshes);
    parts.tail = tail;
    parts.weapon = this._joint(parts.armR, 'pickaxe', [0, -0.38, 0]);
    this._part(parts.weapon, 'pick-shaft', 'cylinder', 'wood', [0, -0.03, 0], [0.045, 0.6, 0.045], [0, 0, 0], meshes);
    this._part(parts.weapon, 'pick-head', 'box', 'steel', [0, 0.27, 0], [0.48, 0.09, 0.1], [0, 0, 0], meshes);
    const cargo = this._joint(root, 'cargo', [0, 1.48, 0]);
    this._part(cargo, 'gold-chunk', 'poly', 'gold', [0, 0, 0], [0.3, 0.25, 0.28], [0.2, 0.4, 0], meshes);
    cargo.setEnabled(false);
    parts.cargo = cargo;
    return { parts, meshes };
  }

  _buildBileDemon(root) {
    const meshes = [];
    const parts = this._bipedRig(root, meshes, {
      bodyMat: 'demonSkin', skinMat: 'demonSkin', legMat: 'leather', footMat: 'demonSkin',
      bodyY: 0.77, bodyScale: [1.05, 1.05, 0.78], headY: 1.43, headZ: 0.22,
      headScale: [0.45, 0.41, 0.43], armX: 0.7, armY: 1.0, armLength: 0.72,
      armWidth: 0.24, handSize: 0.33, legX: 0.39, legY: 0.43, legLength: 0.42,
      legWidth: 0.27, footWidth: 0.35, footHeight: 0.19, footLength: 0.46,
    });
    this._part(root, 'belly', 'sphere', 'demonBelly', [0, 0.72, 0.69], [0.78, 0.76, 0.25], [0, 0, 0], meshes);
    for (let i = 0; i < 4; i++) this._part(root, `belly-ring-${i}`, 'torus', 'darkSteel', [0, 0.48 + i * 0.17, 0.82], [0.34 + i * 0.06, 0.12, 0.1], [Math.PI / 2, 0, 0], meshes);
    this._eyes(parts.headJoint, meshes, 'eyeRed', 0.035, 0.22, 0.12, 0.075);
    this._part(parts.headJoint, 'horn-left', 'cone', 'bone', [-0.28, 0.24, -0.02], [0.2, 0.5, 0.2], [0, 0, -0.55], meshes);
    this._part(parts.headJoint, 'horn-right', 'cone', 'bone', [0.28, 0.24, -0.02], [0.2, 0.5, 0.2], [0, 0, 0.55], meshes);
    this._part(parts.headJoint, 'jaw', 'box', 'demonBelly', [0, -0.18, 0.18], [0.38, 0.18, 0.31], [0, 0, 0], meshes);
    for (const side of [-1, 1]) this._part(parts.headJoint, `tusk-${side}`, 'cone', 'bone', [side * 0.16, -0.12, 0.35], [0.09, 0.22, 0.09], [Math.PI, 0, side * 0.12], meshes);
    for (const foot of [parts.footL, parts.footR]) {
      for (const x of [-0.1, 0, 0.1]) this._part(foot, `toe-${x}`, 'cone', 'bone', [x, -0.02, 0.19], [0.07, 0.18, 0.07], [Math.PI / 2, 0, 0], meshes);
    }
    this._part(parts.armL, 'gauntlet-left', 'cylinder', 'darkSteel', [0, -0.62, 0], [0.34, 0.32, 0.34], [0, 0, 0], meshes);
    this._part(parts.armR, 'gauntlet-right', 'cylinder', 'darkSteel', [0, -0.62, 0], [0.34, 0.32, 0.34], [0, 0, 0], meshes);
    return { parts, meshes };
  }

  _buildTroll(root) {
    const meshes = [];
    const parts = this._bipedRig(root, meshes, {
      bodyMat: 'trollSkin', skinMat: 'trollLight', legMat: 'clothBlack', footMat: 'trollSkin',
      bodyY: 0.82, bodyScale: [0.78, 0.94, 0.56], headY: 1.43, headZ: 0.2,
      headScale: [0.5, 0.45, 0.44], armX: 0.52, armY: 1.05, armLength: 0.72,
      armWidth: 0.23, handSize: 0.28, legX: 0.27, legY: 0.46, legLength: 0.47,
      legWidth: 0.23, footWidth: 0.28, footHeight: 0.16, footLength: 0.4,
    });
    parts.body.rotation.x = -0.12;
    this._eyes(parts.headJoint, meshes, 'eyeAmber', 0.02, 0.23, 0.14, 0.075);
    this._part(parts.headJoint, 'nose', 'sphere', 'trollLight', [0, -0.03, 0.28], [0.18, 0.2, 0.2], [0, 0, 0], meshes);
    for (const side of [-1, 1]) {
      this._part(parts.headJoint, `ear-${side}`, 'cone', 'trollLight', [side * 0.34, 0.02, 0], [0.18, 0.37, 0.16], [0, 0, side * 1.24], meshes);
      this._part(parts.headJoint, `tusk-${side}`, 'cone', 'bone', [side * 0.15, -0.2, 0.31], [0.08, 0.19, 0.08], [Math.PI, 0, side * 0.15], meshes);
      this._part(root, `shoulder-${side}`, 'sphere', 'darkSteel', [side * 0.54, 1.13, 0], [0.38, 0.22, 0.4], [0, 0, 0], meshes);
    }
    this._part(root, 'apron', 'box', 'leather', [0, 0.64, 0.38], [0.55, 0.65, 0.13], [0, 0, 0], meshes);
    parts.weapon = this._joint(parts.armR, 'war-hammer', [0, -0.68, 0]);
    this._part(parts.weapon, 'hammer-shaft', 'cylinder', 'wood', [0, -0.02, 0], [0.07, 0.82, 0.07], [0, 0, 0], meshes);
    this._part(parts.weapon, 'hammer-head', 'box', 'darkSteel', [0, 0.42, 0], [0.62, 0.27, 0.3], [0, 0, 0], meshes);
    return { parts, meshes };
  }

  _buildWarlock(root) {
    const meshes = [];
    const parts = this._bipedRig(root, meshes, {
      bodyMat: 'clothPurple', skinMat: 'heroSkin', legMat: 'clothBlack', footMat: 'clothBlack',
      bodyShape: 'cone', bodyY: 0.76, bodyScale: [0.68, 1.25, 0.59], headY: 1.39, headZ: 0.03,
      headScale: [0.38, 0.4, 0.36], armX: 0.44, armY: 1.06, armLength: 0.59,
      armWidth: 0.15, handSize: 0.18, legX: 0.2, legY: 0.39, legLength: 0.4,
      legWidth: 0.16, footWidth: 0.2, footHeight: 0.12, footLength: 0.3,
    });
    this._part(parts.headJoint, 'hood', 'cone', 'clothBlack', [0, 0.16, -0.03], [0.57, 0.68, 0.57], [0, 0, 0], meshes);
    this._eyes(parts.headJoint, meshes, 'magicPurple', 0.0, 0.2, 0.105, 0.062);
    this._part(root, 'mantle', 'torus', 'gold', [0, 1.13, 0], [0.61, 0.18, 0.52], [Math.PI / 2, 0, 0], meshes);
    parts.weapon = this._joint(parts.armR, 'staff', [0, -0.58, 0]);
    this._part(parts.weapon, 'staff-shaft', 'cylinder', 'wood', [0, 0.19, 0], [0.055, 1.46, 0.055], [0, 0, 0], meshes);
    this._part(parts.weapon, 'staff-cage', 'torus', 'gold', [0, 0.93, 0], [0.3, 0.12, 0.3], [Math.PI / 2, 0, 0], meshes);
    parts.magic = this._part(parts.weapon, 'staff-orb', 'poly', 'magicPurple', [0, 0.93, 0], [0.22, 0.22, 0.22], [0, 0, 0], meshes);
    const book = this._joint(root, 'floating-book', [-0.62, 1.2, 0]);
    this._part(book, 'book-cover', 'box', 'leather', [0, 0, 0], [0.36, 0.07, 0.28], [0, 0, -0.22], meshes);
    this._part(book, 'book-pages', 'box', 'clothCream', [0, 0.05, 0], [0.3, 0.06, 0.23], [0, 0, -0.22], meshes);
    parts.book = book;
    return { parts, meshes };
  }

  _buildFly(root) {
    const meshes = [];
    const parts = {};
    parts.body = this._part(root, 'thorax', 'sphere', 'insect', [0, 0.84, 0], [0.48, 0.5, 0.55], [0, 0, 0], meshes);
    this._part(root, 'abdomen', 'sphere', 'insectDark', [0, 0.8, -0.42], [0.42, 0.4, 0.75], [-0.12, 0, 0], meshes);
    parts.headJoint = this._joint(root, 'head-joint', [0, 0.87, 0.34]);
    parts.head = this._part(parts.headJoint, 'head', 'sphere', 'insect', [0, 0, 0], [0.42, 0.38, 0.38], [0, 0, 0], meshes);
    this._eyes(parts.headJoint, meshes, 'eyeRed', 0.04, 0.19, 0.16, 0.14);
    this._part(parts.headJoint, 'proboscis', 'cone', 'insectDark', [0, -0.12, 0.32], [0.1, 0.34, 0.1], [Math.PI / 2, 0, 0], meshes);
    parts.wingL = this._joint(root, 'wing-left', [-0.18, 1.05, -0.1]);
    parts.wingR = this._joint(root, 'wing-right', [0.18, 1.05, -0.1]);
    this._part(parts.wingL, 'wing-left-front', 'plane', 'wing', [-0.35, 0, 0], [0.73, 0.52, 1], [Math.PI / 2, 0.2, -0.15], meshes);
    this._part(parts.wingR, 'wing-right-front', 'plane', 'wing', [0.35, 0, 0], [0.73, 0.52, 1], [Math.PI / 2, -0.2, 0.15], meshes);
    this._part(parts.wingL, 'wing-left-rear', 'plane', 'wing', [-0.28, -0.02, -0.28], [0.55, 0.38, 1], [Math.PI / 2, 0.1, 0.22], meshes);
    this._part(parts.wingR, 'wing-right-rear', 'plane', 'wing', [0.28, -0.02, -0.28], [0.55, 0.38, 1], [Math.PI / 2, -0.1, -0.22], meshes);
    parts.legs = [];
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1]) {
        const leg = this._joint(root, `insect-leg-${i}-${side}`, [side * 0.19, 0.75, 0.18 - i * 0.27]);
        this._part(leg, `insect-leg-mesh-${i}-${side}`, 'hexCylinder', 'insectDark', [side * 0.16, -0.17, 0], [0.045, 0.45, 0.045], [0, 0, side * 0.65], meshes);
        parts.legs.push(leg);
      }
    }
    return { parts, meshes };
  }

  _heroBase(root, role) {
    const meshes = [];
    const cloth = role === 'priest' ? 'clothCream' : role === 'archer' ? 'leatherTan' : 'clothBlue';
    const armor = role === 'archer' ? 'leather' : role === 'priest' ? 'gold' : 'steel';
    const parts = this._bipedRig(root, meshes, {
      bodyMat: armor, skinMat: 'heroSkin', armMat: armor, legMat: cloth, footMat: 'leather',
      bodyShape: 'box', bodyY: 0.88, bodyScale: [0.63, 0.72, 0.42], headY: 1.43, headZ: 0.03,
      headScale: [0.37, 0.4, 0.35], armX: 0.41, armY: 1.06, armLength: 0.58,
      armWidth: 0.15, handSize: 0.16, legX: 0.2, legY: 0.54, legLength: 0.51,
      legWidth: 0.18, footWidth: 0.22, footHeight: 0.13, footLength: 0.31,
    });
    this._eyes(parts.headJoint, meshes, role === 'priest' ? 'magicBlue' : 'clothBlack', 0.0, 0.18, 0.1, 0.052);
    this._part(root, 'belt', 'box', 'leather', [0, 0.64, 0.02], [0.67, 0.13, 0.45], [0, 0, 0], meshes);
    this._part(root, 'belt-buckle', 'box', 'gold', [0, 0.64, 0.27], [0.12, 0.12, 0.06], [0, 0, 0], meshes);
    return { parts, meshes };
  }

  _buildKnight(root) {
    const { parts, meshes } = this._heroBase(root, 'knight');
    this._part(parts.headJoint, 'helmet', 'sphere', 'steel', [0, 0.13, -0.01], [0.43, 0.38, 0.4], [0, 0, 0], meshes);
    this._part(parts.headJoint, 'visor', 'box', 'darkSteel', [0, -0.01, 0.2], [0.41, 0.13, 0.08], [0, 0, 0], meshes);
    this._part(parts.headJoint, 'helmet-plume', 'cone', 'clothRed', [0, 0.41, -0.04], [0.16, 0.54, 0.28], [0, 0, 0], meshes);
    this._part(root, 'pauldron-left', 'sphere', 'steel', [-0.43, 1.13, 0], [0.32, 0.2, 0.38], [0, 0, 0], meshes);
    this._part(root, 'pauldron-right', 'sphere', 'steel', [0.43, 1.13, 0], [0.32, 0.2, 0.38], [0, 0, 0], meshes);
    parts.weapon = this._joint(parts.armR, 'sword', [0, -0.56, 0]);
    this._part(parts.weapon, 'sword-grip', 'cylinder', 'leather', [0, -0.02, 0], [0.06, 0.24, 0.06], [0, 0, 0], meshes);
    this._part(parts.weapon, 'sword-guard', 'box', 'gold', [0, 0.11, 0], [0.32, 0.06, 0.08], [0, 0, 0], meshes);
    this._part(parts.weapon, 'sword-blade', 'box', 'steel', [0, 0.48, 0], [0.13, 0.73, 0.055], [0, 0, 0], meshes);
    parts.shield = this._joint(parts.armL, 'shield', [0, -0.34, 0.12]);
    this._part(parts.shield, 'shield-face', 'sphere', 'clothBlue', [-0.02, 0, 0.11], [0.58, 0.72, 0.16], [0, 0, 0], meshes);
    this._part(parts.shield, 'shield-rim', 'torus', 'gold', [-0.02, 0, 0.2], [0.58, 0.72, 0.16], [Math.PI / 2, 0, 0], meshes);
    this._part(parts.shield, 'shield-boss', 'sphere', 'gold', [-0.02, 0, 0.25], [0.16, 0.16, 0.09], [0, 0, 0], meshes);
    return { parts, meshes };
  }

  _buildArcher(root) {
    const { parts, meshes } = this._heroBase(root, 'archer');
    this._part(parts.headJoint, 'hood', 'cone', 'clothGreen', [0, 0.13, -0.02], [0.52, 0.6, 0.49], [0, 0, 0], meshes);
    this._part(root, 'cape', 'box', 'clothBlue', [0, 0.88, -0.27], [0.58, 0.81, 0.08], [0.08, 0, 0], meshes);
    parts.weapon = this._joint(parts.armL, 'bow', [0, -0.38, 0.13]);
    this._part(parts.weapon, 'bow-upper', 'cylinder', 'wood', [0, 0.28, 0], [0.045, 0.62, 0.045], [0, 0, 0.35], meshes);
    this._part(parts.weapon, 'bow-lower', 'cylinder', 'wood', [0, -0.28, 0], [0.045, 0.62, 0.045], [0, 0, -0.35], meshes);
    this._part(parts.weapon, 'bow-string', 'cylinder', 'clothCream', [0, 0, 0], [0.012, 1.08, 0.012], [0, 0, 0], meshes);
    const quiver = this._joint(root, 'quiver', [0.31, 1.04, -0.29]);
    this._part(quiver, 'quiver-case', 'cylinder', 'leather', [0, -0.18, 0], [0.18, 0.65, 0.18], [0.22, 0, 0.22], meshes);
    for (let i = 0; i < 3; i++) this._part(quiver, `arrow-${i}`, 'cylinder', 'arrow', [(i - 1) * 0.06, 0.22, 0], [0.025, 0.68, 0.025], [0.22, 0, 0.22], meshes);
    return { parts, meshes };
  }

  _buildPriest(root) {
    const { parts, meshes } = this._heroBase(root, 'priest');
    this._part(root, 'robe', 'cone', 'clothCream', [0, 0.56, 0], [0.77, 1.06, 0.62], [0, 0, 0], meshes);
    this._part(root, 'stole-left', 'box', 'clothRed', [-0.15, 0.88, 0.24], [0.11, 0.83, 0.06], [0, 0, 0], meshes);
    this._part(root, 'stole-right', 'box', 'clothRed', [0.15, 0.88, 0.24], [0.11, 0.83, 0.06], [0, 0, 0], meshes);
    this._part(parts.headJoint, 'mitre', 'cone', 'clothCream', [0, 0.3, 0], [0.42, 0.7, 0.3], [0, 0, 0], meshes);
    this._part(parts.headJoint, 'mitre-trim', 'box', 'gold', [0, 0.27, 0.16], [0.09, 0.54, 0.05], [0, 0, 0], meshes);
    parts.weapon = this._joint(parts.armR, 'priest-staff', [0, -0.58, 0]);
    this._part(parts.weapon, 'staff-shaft', 'cylinder', 'gold', [0, 0.2, 0], [0.055, 1.5, 0.055], [0, 0, 0], meshes);
    this._part(parts.weapon, 'staff-halo', 'torus', 'gold', [0, 0.98, 0], [0.35, 0.35, 0.18], [0, 0, 0], meshes);
    parts.magic = this._part(parts.weapon, 'staff-light', 'poly', 'magicBlue', [0, 0.98, 0], [0.17, 0.17, 0.17], [0, 0, 0], meshes);
    return { parts, meshes };
  }

  // ------------------------------------------------------------
  // Motion, brains, combat and animation
  // ------------------------------------------------------------

  _think(entity) {
    if (entity.state === 'work' || entity.state === 'dig' || entity.state === 'hit') return;
    const enemies = this._livingEnemies(entity);
    let nearest = null;
    let nearestDistance = Infinity;
    for (const candidate of enemies) {
      const distance = B.Vector3.DistanceSquared(entity.root.position, candidate.root.position);
      if (distance < nearestDistance) { nearest = candidate; nearestDistance = distance; }
    }
    nearestDistance = Math.sqrt(nearestDistance);

    if (entity.type === 'imp' && nearest && nearestDistance < 3.4) {
      entity.target = nearest;
      const away = entity.root.position.subtract(nearest.root.position).normalize().scale(4);
      if (entity.repathTime <= 0 || !entity.destination) {
        this.moveTo(entity, entity.root.position.add(away), { state: 'flee' });
      }
      return;
    }
    if (nearest && nearestDistance < (entity.type === 'warlock' || entity.type === 'archer' ? 7.5 : 5.5)) {
      entity.target = nearest;
      if (nearestDistance > entity.attackRange * 0.92) {
        const destinationMoved = !entity.destination
          || B.Vector3.DistanceSquared(entity.destination, nearest.root.position) > 1.25;
        if (entity.repathTime <= 0 || destinationMoved) this.moveTo(entity, nearest.root.position, { state: 'walk' });
      }
      else this.setState(entity, 'attack');
      return;
    }

    if (entity.faction === 'dungeon' && entity.type !== 'imp' && this.rallyPoint && this._time < this.rallyUntil) {
      if (entity.repathTime <= 0 && B.Vector3.DistanceSquared(entity.root.position, this.rallyPoint) > 0.8) {
        this.moveTo(entity, this.rallyPoint, { state: 'walk' });
      }
      return;
    }

    if (entity.faction === 'heroes' && !entity.target) {
      const heart = this.world?.getHeartPosition?.();
      if (heart && entity.repathTime <= 0 && B.Vector3.DistanceSquared(entity.root.position, heart) > 1.7) {
        this.moveTo(entity, heart, { state: 'walk' });
      }
      return;
    }
    if ((entity.state === 'idle' || !entity.destination) && Math.random() < 0.22) {
      const wander = this.world?.randomWalkable?.(entity.root.position, 4);
      if (wander) this.moveTo(entity, wander, { state: 'walk' });
    }
  }

  _livingEnemies(entity) {
    const result = [];
    for (const candidate of this.entities.values()) {
      if (candidate !== entity && candidate.faction !== entity.faction && candidate.hp > 0 && candidate.state !== 'death') result.push(candidate);
    }
    return result;
  }

  _updateMotion(entity, dt) {
    if (!entity.destination || !['walk', 'flee', 'carry'].includes(entity.state)) return;
    const waypoint = entity.path[entity.pathIndex] || entity.destination;
    const delta = waypoint.subtract(entity.root.position);
    delta.y = 0;
    const distance = delta.length();
    if (distance < 0.075) {
      if (entity.pathIndex < entity.path.length - 1) {
        entity.pathIndex++;
        return;
      }
      entity.root.position.x = entity.destination.x;
      entity.root.position.z = entity.destination.z;
      entity.destination = null;
      entity.path.length = 0;
      entity.pathIndex = 0;
      if (entity.work) this.setState(entity, entity.work.action === 'dig' ? 'dig' : 'work');
      else this.setState(entity, entity.carryAmount > 0 ? 'carry' : 'idle');
      return;
    }
    const multiplier = entity.state === 'flee' ? 1.38 : 1;
    const amount = Math.min(distance, entity.speed * multiplier * dt);
    delta.scaleInPlace(1 / distance);
    entity.root.position.addInPlace(delta.scale(amount));
    const heading = Math.atan2(delta.x, delta.z);
    entity.root.rotation.y += shortestAngle(entity.root.rotation.y, heading) * Math.min(1, dt * 11);
  }

  _updateWork(entity, dt) {
    if (!entity.work || !['work', 'dig'].includes(entity.state)) return;
    entity.work.elapsed += dt;
    if (entity.work.elapsed < entity.work.duration) return;
    const job = entity.work;
    entity.work = null;
    try {
      if (job.onComplete) job.onComplete(entity, job);
      else if (job.action === 'dig') this.world?.dig?.(job.x, job.z);
      else if (job.action === 'claim') this.world?.claim?.(job.x, job.z);
      else if (job.action === 'reinforce') this.world?.reinforce?.(job.x, job.z);
    } catch (error) {
      console.warn('Entity work action failed:', error);
    }
    this._effect('work', new B.Vector3(job.x, 0.2, job.z), '#ffbd52', 0.36);
    this.setState(entity, entity.carryAmount > 0 ? 'carry' : 'idle');
  }

  _updateCombat(entity) {
    const target = entityOf(entity.target, this.entities);
    if (!target || target.hp <= 0 || target.state === 'death') {
      if (entity.state === 'attack') this.setState(entity, 'idle');
      entity.target = null;
      return;
    }
    const distance = B.Vector3.Distance(entity.root.position, target.root.position);
    if (distance > entity.attackRange * 1.18) {
      if (entity.state === 'attack' && entity.repathTime <= 0) {
        this.moveTo(entity, target.root.position, { state: 'walk' });
      }
      return;
    }
    entity.destination = null;
    entity.path.length = 0;
    this.setState(entity, 'attack');
    const heading = Math.atan2(target.root.position.x - entity.root.position.x, target.root.position.z - entity.root.position.z);
    entity.root.rotation.y += shortestAngle(entity.root.rotation.y, heading) * 0.2;
    if (entity.attackCooldown <= 0 && entity.stateTime > 0.28) {
      entity.attackCooldown = entity.attackInterval;
      this.takeDamage(target, entity.damage, entity);
      this._effect(entity.attackRange > 2 ? 'projectile' : 'attack', target.root.position, entity.faction === 'heroes' ? '#aaddff' : '#c878ff', 0.32);
    }
  }

  _animate(entity) {
    if (entity.animationGroups.length && entity.activeAssetAnimation) return;
    const p = entity.parts;
    const t = entity.age + entity.phase;
    const state = entity.state;
    const moving = state === 'walk' || state === 'flee' || state === 'carry';
    const rate = state === 'flee' ? 12 : moving ? 8.4 : 2.4;
    const cycle = Math.sin(t * rate);
    const bounce = moving ? Math.abs(Math.sin(t * rate)) * 0.075 : Math.sin(t * 2.3) * 0.018;
    entity.visual.position.y = bounce;
    entity.visual.rotation.x = 0;
    entity.visual.rotation.z = 0;

    if (p.legL) p.legL.rotation.x = moving ? cycle * 0.62 : 0;
    if (p.legR) p.legR.rotation.x = moving ? -cycle * 0.62 : 0;
    if (p.armL) p.armL.rotation.x = moving ? -cycle * 0.48 : Math.sin(t * 1.8) * 0.035;
    if (p.armR) p.armR.rotation.x = moving ? cycle * 0.48 : -Math.sin(t * 1.8) * 0.035;
    if (p.headJoint) p.headJoint.rotation.y = Math.sin(t * 1.15) * (state === 'idle' ? 0.11 : 0.035);
    if (p.tail) p.tail.rotation.y = Math.sin(t * 3.1) * 0.28;
    if (p.book) {
      p.book.position.y = 1.2 + Math.sin(t * 2.2) * 0.06;
      p.book.rotation.y = t * 0.35;
    }
    if (p.magic) {
      p.magic.rotation.y = t * 2;
      const pulse = 1 + Math.sin(t * 4.2) * 0.11;
      p.magic.scaling.setAll(pulse);
    }
    if (p.wingL) p.wingL.rotation.z = 0.18 + Math.sin(t * 32) * 0.52;
    if (p.wingR) p.wingR.rotation.z = -0.18 - Math.sin(t * 32) * 0.52;
    if (p.legs && moving) for (let i = 0; i < p.legs.length; i++) p.legs[i].rotation.x = Math.sin(t * 9 + i * 1.7) * 0.24;

    if (state === 'work' || state === 'dig') {
      const strike = Math.sin(entity.stateTime * 9.5);
      if (p.armR) p.armR.rotation.x = -0.75 - strike * 0.72;
      if (p.weapon) p.weapon.rotation.x = -0.28 - strike * 0.42;
      if (p.body) p.body.rotation.x = 0.1 + Math.max(0, strike) * 0.12;
    } else if (state === 'carry') {
      if (p.armL) p.armL.rotation.x = -1.42;
      if (p.armR) p.armR.rotation.x = -1.42;
      if (p.cargo) p.cargo.setEnabled(true);
    } else {
      if (p.cargo) p.cargo.setEnabled(entity.carryAmount > 0);
    }

    if (state === 'attack') {
      const strike = smoothstep01((entity.stateTime % entity.attackInterval) / Math.max(0.01, entity.attackInterval));
      const arc = Math.sin(strike * Math.PI);
      if (p.armR) p.armR.rotation.x = -0.9 + arc * 1.65;
      if (p.weapon) p.weapon.rotation.x = -0.45 + arc * 0.8;
      if (p.armL && entity.attackRange > 2) p.armL.rotation.x = -1.25;
    }
    if (state === 'hit') {
      const recoil = clamp(entity.hitTime / 0.24, 0, 1);
      entity.visual.rotation.x = -recoil * 0.18;
      entity.visual.position.z = -Math.sin(recoil * Math.PI) * 0.1;
    } else {
      entity.visual.position.z = 0;
    }
    if (state === 'death') {
      const fall = smoothstep01(entity.deathTime / 0.65);
      entity.visual.rotation.z = fall * (entity.phase > Math.PI ? 1 : -1) * Math.PI * 0.47;
      entity.visual.position.y = -fall * 0.14;
      entity.root.scaling.scaleInPlace(1 - Math.min(0.006, entity.deathTime * 0.0005));
    }
  }

  _kill(entity) {
    entity.hp = 0;
    entity.destination = null;
    entity.target = null;
    entity.path.length = 0;
    entity.deathTime = 0;
    entity.removeAt = 1.75;
    this.setState(entity, 'death');
    for (const mesh of entity.meshes) mesh.isPickable = false;
    this._effect('death', entity.root.position, entity.faction === 'heroes' ? '#8ed8ff' : '#bf62ee', 0.72);
    if (entity.onDeath) {
      try { entity.onDeath(entity); } catch (error) { console.warn('Entity onDeath callback failed:', error); }
    }
  }

  // ------------------------------------------------------------
  // Grid navigation
  // ------------------------------------------------------------

  _findPath(from, to) {
    if (!this.world?.isWalkable || !Number.isFinite(this.world.gridSize)) return [to.clone()];
    const size = this.world.gridSize;
    const sx = clamp(Math.round(from.x), 0, size - 1);
    const sz = clamp(Math.round(from.z), 0, size - 1);
    const gx = clamp(Math.round(to.x), 0, size - 1);
    const gz = clamp(Math.round(to.z), 0, size - 1);
    if (sx === gx && sz === gz) return [new B.Vector3(gx, 0, gz)];

    const startKey = sx + sz * size;
    const goalKey = gx + gz * size;
    const frontier = [startKey];
    const cameFrom = new Int32Array(size * size);
    cameFrom.fill(-2);
    cameFrom[startKey] = -1;
    let head = 0;
    while (head < frontier.length && frontier.length < size * size) {
      const current = frontier[head++];
      if (current === goalKey) break;
      const x = current % size;
      const z = Math.floor(current / size);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
        const key = nx + nz * size;
        if (cameFrom[key] !== -2) continue;
        if (key !== goalKey && !this.world.isWalkable(nx, nz)) continue;
        cameFrom[key] = current;
        frontier.push(key);
      }
    }
    if (cameFrom[goalKey] === -2) return [];
    const reverse = [];
    let key = goalKey;
    while (key !== -1) {
      reverse.push(new B.Vector3(key % size, 0, Math.floor(key / size)));
      key = cameFrom[key];
    }
    reverse.reverse();
    reverse[reverse.length - 1] = to.clone();
    return reverse;
  }

  _nearestWalkableTo(x, z, from) {
    if (this.world?.isWalkable?.(x, z)) return new B.Vector3(x, 0, z);
    const candidates = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dz]) => new B.Vector3(x + dx, 0, z + dz))
      .filter((p) => this.world?.isWalkable?.(p.x, p.z));
    candidates.sort((a, b) => B.Vector3.DistanceSquared(a, from) - B.Vector3.DistanceSquared(b, from));
    return candidates[0] || null;
  }

  _heroSpawnPosition() {
    const heart = this.world?.getHeartPosition?.() || B.Vector3.Zero();
    const grid = this.world?.grid;
    if (Array.isArray(grid)) {
      const candidates = [];
      for (const column of grid) {
        for (const cell of column || []) {
          if (cell?.discovered && this.world.isWalkable?.(cell.x, cell.z)) candidates.push(cell);
        }
      }
      candidates.sort((a, b) => {
        const da = (a.x - heart.x) ** 2 + (a.z - heart.z) ** 2;
        const db = (b.x - heart.x) ** 2 + (b.z - heart.z) ** 2;
        return db - da;
      });
      if (candidates.length) {
        const pick = candidates[Math.floor(Math.random() * Math.min(12, candidates.length))];
        return new B.Vector3(pick.x, 0, pick.z);
      }
    }
    return this.world?.randomWalkable?.() || heart.add(new B.Vector3(5, 0, 5));
  }

  _positionFrom(value) {
    if (value instanceof B.Vector3) return value.clone();
    if (Array.isArray(value)) return new B.Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
    if (value?.position) return this._positionFrom(value.position);
    return new B.Vector3(Number(value?.x) || 0, Number(value?.y) || 0, Number(value?.z) || 0);
  }

  // ------------------------------------------------------------
  // Optional runtime services: GLB overrides and VFX
  // ------------------------------------------------------------

  _tryAssetOverride(entity, options) {
    const library = this.runtime.assetLibrary || this.runtime.assets;
    if (!library || options.proceduralOnly) return;
    const key = options.assetKey || `entity:${entity.type}`;
    let result = null;
    try {
      if (typeof library.instantiateEntity === 'function') result = library.instantiateEntity(entity.type, entity.root, key);
      else if (typeof library.instantiate === 'function' && (library.has?.(key) ?? options.assetKey)) result = library.instantiate(key, { parent: entity.root, name: entity.id });
      else {
        const container = library.get?.(key) || library.getContainer?.(key);
        if (container?.instantiateModelsToScene) result = container.instantiateModelsToScene((name) => `${entity.id}:${name}`, false, { doNotInstantiate: false });
      }
    } catch (error) {
      console.warn(`Could not instantiate GLB override ${key}; using procedural ${entity.type}.`, error);
      return;
    }
    if (!result) return;
    if (typeof result.then === 'function') {
      result.then((resolved) => this._applyAssetResult(entity, resolved)).catch((error) => {
        console.warn(`Could not load GLB override ${key}; using procedural ${entity.type}.`, error);
      });
    } else {
      this._applyAssetResult(entity, result);
    }
  }

  _applyAssetResult(entity, result) {
    if (!result || !this.entities.has(entity.id) || this._disposed) return;
    const roots = result.root ? [result.root]
      : result.rootNodes || (result.node ? [result.node] : result instanceof B.Node ? [result] : []);
    if (!roots.length) return;
    entity.proceduralVisual.setEnabled(false);
    entity.assetInstance = result.dispose ? result : null;
    for (const node of roots) {
      node.parent = entity.root;
      node.metadata = { ...(node.metadata || {}), entity, entityId: entity.id, entityType: entity.type, faction: entity.faction };
      for (const mesh of node.getChildMeshes?.() || []) this._markPickable(mesh, entity);
    }
    entity.animationGroups = result.animationGroups || result.animations || [];
    this._playAssetAnimation(entity, entity.state);
  }

  _playAssetAnimation(entity, state) {
    if (!entity.animationGroups.length) return;
    const aliases = {
      idle: ['idle', 'stand'], walk: ['walk', 'run'], flee: ['run', 'walk'],
      work: ['work', 'mine', 'dig'], dig: ['dig', 'mine', 'work'], carry: ['carry', 'walk'],
      attack: ['attack', 'strike', 'shoot', 'cast'], hit: ['hit', 'damage'], death: ['death', 'die'],
    };
    const names = aliases[state] || [state];
    const group = entity.animationGroups.find((candidate) => names.some((name) => candidate.name?.toLowerCase().includes(name)));
    if (!group || entity.activeAssetAnimation === group) return;
    for (const candidate of entity.animationGroups) {
      if (candidate !== group) try { candidate.stop(); } catch (_) { /* imported group API variance */ }
    }
    try {
      group.start(state !== 'death' && state !== 'hit', 1, group.from, group.to, false);
      entity.activeAssetAnimation = group;
    } catch (_) { /* a custom AssetLibrary may expose animation-like objects */ }
  }

  _effect(kind, position, color, scale) {
    if (!this.effects) return;
    const point = position.clone?.() || this._positionFrom(position);
    const method = { death: 'despawn', work: 'dig', attack: 'hit', projectile: 'hit' }[kind] || kind;
    const numericColor = typeof color === 'string' && color.startsWith('#')
      ? Number.parseInt(color.slice(1), 16)
      : color;
    try {
      if (typeof this.effects[method] === 'function') this.effects[method](point, { color: numericColor, scale });
      else if (typeof this.effects.burst === 'function') this.effects.burst(point, { kind, color: numericColor, scale });
      else if (typeof this.effects.spawnBurst === 'function') this.effects.spawnBurst(point, numericColor, scale);
    } catch (_) { /* VFX should never interrupt the simulation */ }
  }
}
