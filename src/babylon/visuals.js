// ============================================================
// BABYLON VISUAL POLISH LAYER
// ============================================================
// Optional, presentation-only dressing for the Babylon dungeon.  Gameplay
// owns the grid, defenses and entities; this layer only observes them.  Static
// decoration is kept in thin-instance batches, while the few moving helpers
// (selection rings and atmospheric particles) are pooled and capped by tier.

const B = window.BABYLON;

const QUALITY = Object.freeze({
  low: Object.freeze({ density: 0.20, motes: 18, floorDecals: false, glow: 0.34 }),
  medium: Object.freeze({ density: 0.36, motes: 32, floorDecals: true, glow: 0.46 }),
  high: Object.freeze({ density: 0.54, motes: 52, floorDecals: true, glow: 0.62 }),
  ultra: Object.freeze({ density: 0.68, motes: 72, floorDecals: true, glow: 0.78 }),
});

const ROOM_COLOURS = Object.freeze({
  treasury: '#d79731', lair: '#8f3d50', hatchery: '#b49643', training: '#b44a39',
  library: '#a75de0', prison: '#7b91aa', torture: '#a61f38', workshop: '#e06b32', temple: '#55b889',
});

const TRAP_COLOURS = Object.freeze({
  spike: '#d6a759', sentry: '#e49043', lightning: '#68c9ff', fear: '#be65ff',
  gas: '#87d653', boulder: '#ca8b5a', alarm: '#ff4b45',
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normaliseTier(value) {
  const name = typeof value === 'object' ? value?.name : value;
  return QUALITY[name] ? name : 'high';
}

// A stable grid hash: never use Math.random for room dressing or decorations.
function hash(x, z, salt = 0) {
  let h = Math.imul((x | 0) + 374761393, 668265263) ^ Math.imul((z | 0) + 1442695041, 2246822519);
  h = Math.imul(h ^ (h >>> 13) ^ (salt | 0), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function matrix(x, y, z, sx = 1, sy = 1, sz = 1, yaw = 0, pitch = 0, roll = 0) {
  return B.Matrix.Compose(
    new B.Vector3(sx, sy, sz),
    B.Quaternion.RotationYawPitchRoll(yaw, pitch, roll),
    new B.Vector3(x, y, z),
  );
}

function color(value) {
  if (value?.r != null) return value;
  return B.Color3.FromHexString(value || '#ffffff');
}

function positionOf(value) {
  if (!value) return null;
  if (value.root?.position) return value.root.position;
  if (value.node?.position) return value.node.position;
  if (value.mesh?.position) return value.mesh.position;
  if (value.position) return value.position;
  if (Number.isFinite(value.x) && Number.isFinite(value.z)) return value;
  return null;
}

function isWalkableCell(cell) {
  if (!cell || !cell.discovered || !cell.visible) return false;
  return Boolean(cell.room || ['earth', 'claimed', 'heart', 'portal'].includes(cell.type));
}

/**
 * Presentation-only dungeon dressing. Create after world/defenses/effects;
 * invoke update(dt) from the render loop and setQuality() after runtime tier
 * changes. It deliberately does not dispose runtime/world-owned resources.
 */
export class VisualPolishLayer {
  constructor(runtime, options = {}) {
    if (!B) throw new Error('VisualPolishLayer requires Babylon.js 9.25.');
    if (!runtime?.scene) throw new Error('VisualPolishLayer requires runtime.scene.');

    this.runtime = runtime;
    this.scene = runtime.scene;
    this.world = options.world || runtime.world || null;
    this.defenses = options.defenses || runtime.defenses || null;
    this.effects = options.effects || runtime.effects || null;
    this.entities = options.entities || runtime.entities || null;
    this.seed = Number(options.seed ?? this.world?.seed ?? runtime.seed ?? 1337) || 1337;
    this.qualityName = normaliseTier(options.quality ?? runtime.quality);
    this.quality = QUALITY[this.qualityName];
    this.root = new B.TransformNode('visual-polish', this.scene);
    this.root.metadata = { kind: 'visual-polish-layer' };
    this.batches = new Map();
    this.materials = new Map();
    this._moteSystems = [];
    this._subscriptions = [];
    this._dressingDirty = true;
    this._defensesDirty = true;
    this._rebuildClock = 0;
    this._defenseClock = 0;
    this._time = 0;
    this._disposed = false;
    this._lastDefenseSignature = '';
    this.selection = null;
    this.hover = null;

    this._createMaterials();
    this._createThinTemplates();
    this._createInteractionPool();
    this._createMotes();
    this._listen();
    this.rebuild();
  }

  // ----------------------------------------------------------
  // Public integration surface
  // ----------------------------------------------------------

  setWorld(world) {
    if (world === this.world) return this;
    this.world = world || null;
    this.seed = Number(this.world?.seed ?? this.seed) || this.seed;
    this._dressingDirty = true;
    this._createMotes();
    return this;
  }

  setDefenses(defenses) {
    this.defenses = defenses || null;
    this._defensesDirty = true;
    return this;
  }

  setQuality(tier) {
    const next = normaliseTier(tier);
    if (next === this.qualityName) return this.quality;
    this.qualityName = next;
    this.quality = QUALITY[next];
    this._dressingDirty = true;
    this._defensesDirty = true;
    this._createMotes();
    return this.quality;
  }

  markDirty(options = {}) {
    this._dressingDirty ||= options.dressing !== false;
    this._defensesDirty ||= options.defenses !== false;
  }

  rebuild() {
    if (this._disposed) return;
    this._rebuildDressing();
    this._rebuildDefensePresentation();
    this._dressingDirty = false;
    this._defensesDirty = false;
  }

  setSelection(selection) {
    this.selection = selection || null;
    this._setIndicator(this.selectionRing, this._selectionTarget(selection), this._selectionColour(selection));
  }

  clearSelection() {
    this.selection = null;
    this._setIndicator(this.selectionRing, null);
  }

  setHover(target, mode = 'select') {
    this.hover = target || null;
    const targetValue = target?.entity || target?.defense || target?.tile || target;
    const tint = mode === 'select' ? '#d5bc76' : mode.includes('spell') ? '#bc76ff' : '#78c8ee';
    this._setIndicator(this.hoverRing, targetValue, tint, 0.78);
  }

  clearHover() {
    this.hover = null;
    this._setIndicator(this.hoverRing, null);
  }

  update(deltaSeconds) {
    if (this._disposed) return;
    const dt = clamp(Number(deltaSeconds) || 0, 0, 0.1);
    this._time += dt;
    this._rebuildClock += dt;
    this._defenseClock += dt;

    // Coalescing event bursts protects large room-paint operations from doing
    // a matrix upload for every individual cell.
    if (this._dressingDirty && this._rebuildClock >= 0.09) {
      this._rebuildClock = 0;
      this._rebuildDressing();
      this._dressingDirty = false;
    }
    if (this._defensesDirty || this._defenseClock >= 0.28) {
      this._defenseClock = 0;
      const signature = this._defenseSignature();
      if (this._defensesDirty || signature !== this._lastDefenseSignature) {
        this._lastDefenseSignature = signature;
        this._rebuildDefensePresentation();
        this._defensesDirty = false;
      }
    }
    this._animateIndicators();
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const unsubscribe of this._subscriptions) unsubscribe();
    this._subscriptions.length = 0;
    for (const system of this._moteSystems) system.dispose(false);
    this._moteSystems.length = 0;
    this.moteTexture?.dispose();
    for (const batch of this.batches.values()) batch.mesh.dispose(false, false);
    this.batches.clear();
    for (const material of this.materials.values()) material.dispose(false, true);
    this.materials.clear();
    this.selectionRing?.root.dispose(false, false);
    this.hoverRing?.root.dispose(false, false);
    this.root.dispose(false, false);
  }

  // ----------------------------------------------------------
  // Shared art and thin-instance batches
  // ----------------------------------------------------------

  _material(name, options) {
    const material = new B.StandardMaterial(`polish.mat.${name}`, this.scene);
    material.diffuseColor = color(options.color);
    material.emissiveColor = color(options.emissive || '#000000');
    material.specularColor = color(options.specular || '#17131c');
    material.alpha = options.alpha ?? 1;
    material.disableLighting = Boolean(options.unlit);
    material.backFaceCulling = options.backFaceCulling ?? true;
    if (material.alpha < 1) material.transparencyMode = B.Material.MATERIAL_ALPHABLEND;
    this.materials.set(name, material);
    return material;
  }

  _createMaterials() {
    this._material('edge', { color: '#3a2630', emissive: '#170811' });
    this._material('corner', { color: '#73503a', emissive: '#24120c' });
    this._material('rubble', { color: '#2a2331', emissive: '#100a15' });
    this._material('iron', { color: '#292831', specular: '#77758b' });
    this._material('blood', { color: '#4d0711', emissive: '#210307', alpha: 0.74, backFaceCulling: false });
    this._material('rune', { color: '#65358e', emissive: '#c169ff', unlit: true, alpha: 0.8, backFaceCulling: false });
    this._material('chalk', { color: '#8d8171', emissive: '#28221e', alpha: 0.56, backFaceCulling: false });
    this._material('doorWood', { color: '#6c381e', emissive: '#170907' });
    this._material('doorSteel', { color: '#68727e', emissive: '#11151b', specular: '#b6c4d1' });
    this._material('doorMagic', { color: '#5e2b88', emissive: '#bc58ff', unlit: true });
    this._material('trapReady', { color: '#613530', emissive: '#ff7951', unlit: true, alpha: 0.9, backFaceCulling: false });
    this._material('trapCold', { color: '#27212b', emissive: '#160f1d', alpha: 0.62, backFaceCulling: false });
    this._material('selection', { color: '#f6ca5d', emissive: '#f6a93b', unlit: true, alpha: 0.93, backFaceCulling: false });
    this._material('hover', { color: '#b5e7ff', emissive: '#5cbde8', unlit: true, alpha: 0.70, backFaceCulling: false });
  }

  _template(key, mesh, material) {
    mesh.parent = this.root;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.alwaysSelectAsActiveMesh = false;
    mesh.setEnabled(false);
    this.batches.set(key, { mesh, matrices: [], data: null });
  }

  _createThinTemplates() {
    this._template('edge', B.MeshBuilder.CreateBox('polish.edge', { size: 1 }, this.scene), this.materials.get('edge'));
    this._template('corner', B.MeshBuilder.CreateCylinder('polish.corner', { height: 1, diameter: 1, tessellation: 6 }, this.scene), this.materials.get('corner'));
    this._template('rubble', B.MeshBuilder.CreatePolyhedron('polish.rubble', { type: 1, size: 1 }, this.scene), this.materials.get('rubble'));
    this._template('iron', B.MeshBuilder.CreateBox('polish.iron', { size: 1 }, this.scene), this.materials.get('iron'));
    this._template('blood', B.MeshBuilder.CreateDisc('polish.blood', { radius: 0.5, tessellation: 10 }, this.scene), this.materials.get('blood'));
    this._template('rune', B.MeshBuilder.CreateTorus('polish.rune', { diameter: 1, thickness: 0.075, tessellation: 12 }, this.scene), this.materials.get('rune'));
    this._template('chalk', B.MeshBuilder.CreateDisc('polish.chalk', { radius: 0.5, tessellation: 5 }, this.scene), this.materials.get('chalk'));
    this._template('doorWood', B.MeshBuilder.CreateBox('polish.doorWood', { size: 1 }, this.scene), this.materials.get('doorWood'));
    this._template('doorSteel', B.MeshBuilder.CreateBox('polish.doorSteel', { size: 1 }, this.scene), this.materials.get('doorSteel'));
    this._template('doorMagic', B.MeshBuilder.CreateTorus('polish.doorMagic', { diameter: 1, thickness: 0.09, tessellation: 14 }, this.scene), this.materials.get('doorMagic'));
    this._template('trapReady', B.MeshBuilder.CreateTorus('polish.trapReady', { diameter: 1, thickness: 0.045, tessellation: 14 }, this.scene), this.materials.get('trapReady'));
    this._template('trapCold', B.MeshBuilder.CreateDisc('polish.trapCold', { radius: 0.5, tessellation: 8 }, this.scene), this.materials.get('trapCold'));
  }

  _push(key, transform) {
    this.batches.get(key)?.matrices.push(transform);
  }

  _flush(key) {
    const batch = this.batches.get(key);
    if (!batch) return;
    const { mesh, matrices } = batch;
    if (!matrices.length) {
      mesh.thinInstanceCount = 0;
      mesh.setEnabled(false);
      batch.data = null;
      return;
    }
    const data = new Float32Array(matrices.length * 16);
    matrices.forEach((entry, index) => entry.copyToArray(data, index * 16));
    mesh.setEnabled(true);
    mesh.thinInstanceSetBuffer('matrix', data, 16, false);
    mesh.thinInstanceCount = matrices.length;
    mesh.thinInstanceRefreshBoundingInfo(true);
    batch.data = data;
  }

  _clearBatches() {
    for (const batch of this.batches.values()) batch.matrices.length = 0;
  }

  _rebuildDressing() {
    this._clearBatches();
    const world = this.world;
    if (!world?.grid) return this._flushAll();
    const density = this.quality.density;
    for (let x = 0; x < world.grid.length; x++) {
      for (let z = 0; z < world.grid[x].length; z++) {
        const cell = world.grid[x][z];
        if (!isWalkableCell(cell)) continue;
        this._addFloorEdge(cell);
        this._addDeterministicDressing(cell, density);
      }
    }
    this._flushAll();
  }

  _addFloorEdge(cell) {
    const directions = [[1, 0, 0], [-1, 0, Math.PI], [0, 1, Math.PI / 2], [0, -1, -Math.PI / 2]];
    for (const [dx, dz, yaw] of directions) {
      const neighbour = this.world.getCell?.(cell.x + dx, cell.z + dz);
      if (isWalkableCell(neighbour)) continue;
      this._push('edge', matrix(cell.x + dx * 0.455, 0.085, cell.z + dz * 0.455, 0.88, 0.052, 0.075, yaw));
    }
    if (hash(cell.x, cell.z, this.seed + 37) > 0.66) {
      const offsetX = (hash(cell.x, cell.z, this.seed + 38) - 0.5) * 0.66;
      const offsetZ = (hash(cell.x, cell.z, this.seed + 39) - 0.5) * 0.66;
      this._push('corner', matrix(cell.x + offsetX, 0.11, cell.z + offsetZ, 0.055, 0.10, 0.055));
    }
  }

  _addDeterministicDressing(cell, density) {
    const roll = hash(cell.x, cell.z, this.seed + 71);
    const yaw = Math.floor(hash(cell.x, cell.z, this.seed + 72) * 4) * Math.PI / 2;
    if (roll < density * 0.22) {
      this._push('rubble', matrix(
        cell.x + (hash(cell.x, cell.z, this.seed + 73) - 0.5) * 0.66, 0.12,
        cell.z + (hash(cell.x, cell.z, this.seed + 74) - 0.5) * 0.66,
        0.10 + hash(cell.x, cell.z, 75) * 0.10, 0.09, 0.11, yaw,
      ));
    } else if (roll < density * 0.30 && this.quality.floorDecals) {
      this._push('chalk', matrix(cell.x, 0.067, cell.z, 0.27, 0.01, 0.27, yaw, Math.PI / 2));
    } else if (roll < density * 0.36 && this.quality.floorDecals && cell.room === 'torture') {
      this._push('blood', matrix(cell.x, 0.071, cell.z, 0.30, 0.01, 0.17, yaw, Math.PI / 2));
    }

    // Room sigils are intentionally sparse: the camera reads the room colour
    // first, not a noisy carpet of emissive symbols.
    if (cell.room && this.quality.floorDecals && hash(cell.x, cell.z, this.seed + 80) < density * 0.18) {
      const roomColour = ROOM_COLOURS[cell.room];
      if (roomColour) this._push('rune', matrix(cell.x, 0.081, cell.z, 0.18, 0.012, 0.18, yaw));
    }
    if (cell.room && hash(cell.x, cell.z, this.seed + 83) < density * 0.12) {
      const side = (hash(cell.x, cell.z, this.seed + 84) - 0.5) * 0.64;
      this._push('iron', matrix(cell.x + side, 0.16, cell.z - side, 0.075, 0.17, 0.075, yaw));
    }
  }

  _flushAll() {
    for (const key of this.batches.keys()) this._flush(key);
  }

  // ----------------------------------------------------------
  // Door/trap state presentation (thin instances, no new lights)
  // ----------------------------------------------------------

  _defenseSignature() {
    const values = this.defenses?.list?.() || [];
    return values.map((item) => [item.id, item.kind, item.locked, item.armed, item.reloading, item.broken, item.charges, item.openAmount?.toFixed?.(1)].join(':')).join('|');
  }

  _rebuildDefensePresentation() {
    // Preserve the static world dressing batches and add defense marks before
    // uploading their individual batches again.
    for (const key of ['doorWood', 'doorSteel', 'doorMagic', 'trapReady', 'trapCold']) {
      const batch = this.batches.get(key);
      if (batch) batch.matrices.length = 0;
    }
    for (const defense of this.defenses?.list?.() || []) {
      if (!Number.isFinite(defense.x) || !Number.isFinite(defense.z)) continue;
      if (defense.category === 'door') this._addDoorPresentation(defense);
      else if (defense.category === 'trap') this._addTrapPresentation(defense);
    }
    for (const key of ['doorWood', 'doorSteel', 'doorMagic', 'trapReady', 'trapCold']) this._flush(key);
  }

  _addDoorPresentation(door) {
    if (door.broken) return;
    const yaw = door.orientation === 'z' ? Math.PI / 2 : 0;
    const kind = door.kind === 'magic' ? 'doorMagic' : door.kind === 'steel' ? 'doorSteel' : 'doorWood';
    if (kind === 'doorMagic') {
      this._push(kind, matrix(door.x, 1.06, door.z - 0.18, 0.26, 0.26, 0.10, yaw, Math.PI / 2));
    } else {
      const height = door.locked ? 0.22 : 0.10;
      this._push(kind, matrix(door.x, 1.19, door.z - 0.17, 0.14, height, 0.045, yaw));
    }
  }

  _addTrapPresentation(trap) {
    const ready = trap.armed && !trap.reloading && trap.charges > 0;
    if (ready) {
      const scale = trap.kind === 'lightning' || trap.kind === 'fear' ? 0.70 : 0.58;
      this._push('trapReady', matrix(trap.x, 0.093, trap.z, scale, 0.01, scale));
    } else {
      this._push('trapCold', matrix(trap.x, 0.073, trap.z, 0.66, 0.01, 0.66, 0, Math.PI / 2));
    }
  }

  // ----------------------------------------------------------
  // Pooled selection/interaction feedback
  // ----------------------------------------------------------

  _createInteractionPool() {
    this.selectionRing = this._makeIndicator('selection', this.materials.get('selection'), 0.78);
    this.hoverRing = this._makeIndicator('hover', this.materials.get('hover'), 0.64);
  }

  _makeIndicator(name, material, diameter) {
    const root = new B.TransformNode(`polish.${name}`, this.scene);
    root.parent = this.root;
    root.setEnabled(false);
    const outer = B.MeshBuilder.CreateTorus(`polish.${name}.outer`, { diameter, thickness: 0.045, tessellation: 20 }, this.scene);
    outer.parent = root;
    outer.material = material;
    outer.isPickable = false;
    const notch = B.MeshBuilder.CreateBox(`polish.${name}.notch`, { size: 1 }, this.scene);
    notch.parent = root;
    notch.position.set(0, 0.018, diameter * 0.44);
    notch.scaling.set(0.16, 0.018, 0.032);
    notch.material = material;
    notch.isPickable = false;
    return { root, outer, notch, target: null, baseDiameter: diameter, alpha: material.alpha };
  }

  _selectionTarget(selection) {
    return selection?.entity || selection?.defense || selection?.tile || selection;
  }

  _selectionColour(selection) {
    if (selection?.entity?.faction === 'heroes') return '#ff865d';
    if (selection?.defense?.category === 'trap') return TRAP_COLOURS[selection.defense.kind] || '#ffb75a';
    if (selection?.defense?.kind === 'magic') return '#c66cff';
    return '#f6ca5d';
  }

  _setIndicator(indicator, target, tint = null, scale = 1) {
    if (!indicator) return;
    const position = positionOf(target);
    indicator.target = target && position ? target : null;
    indicator.root.setEnabled(Boolean(indicator.target));
    if (!indicator.target) return;
    indicator.root.position.set(position.x, Math.max(0.086, Number(position.y) || 0) + 0.015, position.z);
    indicator.root.scaling.setAll(scale);
    if (tint) {
      const next = color(tint);
      indicator.outer.material.diffuseColor = next;
      indicator.outer.material.emissiveColor = next;
      indicator.notch.material.diffuseColor = next;
      indicator.notch.material.emissiveColor = next;
    }
  }

  _animateIndicators() {
    for (const [indicator, speed, amount] of [[this.selectionRing, 4.4, 0.09], [this.hoverRing, 6.1, 0.055]]) {
      if (!indicator?.target) continue;
      const position = positionOf(indicator.target);
      if (!position) {
        this._setIndicator(indicator, null);
        continue;
      }
      indicator.root.position.x = position.x;
      indicator.root.position.z = position.z;
      indicator.root.rotation.y += 0.018;
      const pulse = 1 + Math.sin(this._time * speed) * amount;
      indicator.outer.scaling.setAll(pulse);
      indicator.notch.position.y = 0.018 + Math.sin(this._time * speed) * 0.008;
    }
  }

  // ----------------------------------------------------------
  // Atmospheric mote field
  // ----------------------------------------------------------

  _createMotes() {
    for (const system of this._moteSystems) system.dispose(false);
    this._moteSystems.length = 0;
    if (!this.quality.motes || !this.world?.gridSize || typeof B.ParticleSystem !== 'function') return;
    if (!this.moteTexture) this.moteTexture = this._createMoteTexture();
    if (!this.moteTexture) return;
    const system = new B.ParticleSystem('polish.dungeon-motes', this.quality.motes, this.scene);
    const size = this.world.gridSize;
    system.particleTexture = this.moteTexture;
    system.emitter = B.Vector3.Zero();
    system.minEmitBox = new B.Vector3(1, 0.22, 1);
    system.maxEmitBox = new B.Vector3(size - 1, 2.0, size - 1);
    system.color1 = new B.Color4(0.75, 0.54, 0.34, 0.18);
    system.color2 = new B.Color4(0.43, 0.26, 0.55, 0.12);
    system.colorDead = new B.Color4(0.08, 0.03, 0.12, 0);
    system.minSize = 0.018;
    system.maxSize = 0.055;
    system.minLifeTime = 4.0;
    system.maxLifeTime = 8.5;
    system.emitRate = Math.max(2, this.quality.motes * 0.42);
    system.minEmitPower = 0.02;
    system.maxEmitPower = 0.085;
    system.direction1 = new B.Vector3(-0.12, 0.08, -0.06);
    system.direction2 = new B.Vector3(0.12, 0.17, 0.06);
    system.gravity = new B.Vector3(0, 0.002, 0);
    system.updateSpeed = 0.012;
    system.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
    system.preWarmCycles = 3;
    system.preWarmStepOffset = 1;
    system.start();
    this._moteSystems.push(system);
  }

  _createMoteTexture() {
    if (typeof B.DynamicTexture !== 'function') return null;
    const texture = new B.DynamicTexture('polish.mote-sprite', { width: 32, height: 32 }, this.scene, false);
    const context = texture.getContext?.();
    if (!context) {
      texture.dispose();
      return null;
    }
    const gradient = context.createRadialGradient(16, 16, 1, 16, 16, 15);
    gradient.addColorStop(0, 'rgba(255,236,196,1)');
    gradient.addColorStop(0.28, 'rgba(211,150,88,0.82)');
    gradient.addColorStop(1, 'rgba(62,24,79,0)');
    context.clearRect(0, 0, 32, 32);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 32, 32);
    texture.hasAlpha = true;
    texture.update(false);
    return texture;
  }

  // ----------------------------------------------------------
  // Event bridge: optional and safe beside existing listeners
  // ----------------------------------------------------------

  _listen() {
    const events = this.runtime.events;
    if (events?.on) {
      this._subscriptions.push(events.on('cellChanged', () => { this._dressingDirty = true; }));
      this._subscriptions.push(events.on('visibilityChanged', () => { this._dressingDirty = true; }));
      this._subscriptions.push(events.on('worldRebuilt', () => { this._dressingDirty = true; }));
      this._subscriptions.push(events.on('defenseTriggered', () => { this._defensesDirty = true; }));
    }
    if (typeof document === 'undefined') return;
    const onSelection = (event) => this.setSelection(event.detail?.selection || null);
    const onHover = (event) => this.setHover(event.detail?.hover || null, event.detail?.mode || 'select');
    document.addEventListener('dungeon:selection-changed', onSelection);
    document.addEventListener('dungeon:hover-changed', onHover);
    this._subscriptions.push(() => document.removeEventListener('dungeon:selection-changed', onSelection));
    this._subscriptions.push(() => document.removeEventListener('dungeon:hover-changed', onHover));
  }
}

export function createVisualPolishLayer(runtime, options = {}) {
  return new VisualPolishLayer(runtime, options);
}

export { QUALITY as VISUAL_QUALITY_PRESETS };
