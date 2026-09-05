// ============================================================
// BABYLON DUNGEON WORLD
// ============================================================
// Grid state and rendering for the Babylon edition.  Tile bodies, trims and
// repeated room props use thin instances: even a fully revealed 64x64 map is a
// few dozen draw calls instead of several thousand scene nodes.  Special hero
// objects (the Dungeon Heart and portals) remain ordinary meshes so they can
// animate and later be replaced by authored GLB models.

import { createDungeonEnvironment } from './environment.js';

const BABYLON = window.BABYLON;

export const TILE = Object.freeze({
  ROCK: 'rock',
  EARTH: 'earth',
  CLAIMED: 'claimed',
  REINFORCED: 'reinforced',
  GOLD: 'gold',
  WATER: 'water',
  LAVA: 'lava',
  PORTAL: 'portal',
  HEART: 'heart',
});

export const ROOM = Object.freeze({
  TREASURY: 'treasury',
  LAIR: 'lair',
  HATCHERY: 'hatchery',
  TRAINING: 'training',
  LIBRARY: 'library',
  PRISON: 'prison',
  TORTURE: 'torture',
  WORKSHOP: 'workshop',
  TEMPLE: 'temple',
});

export const ROOM_DEFINITIONS = Object.freeze({
  [ROOM.TREASURY]: Object.freeze({ name: 'Treasury', icon: '◆', cost: 25, description: 'Stores glittering hoards of mined gold.' }),
  [ROOM.LAIR]: Object.freeze({ name: 'Lair', icon: '☾', cost: 25, description: 'Private nests where creatures recover.' }),
  [ROOM.HATCHERY]: Object.freeze({ name: 'Hatchery', icon: '●', cost: 35, description: 'Produces food for the dungeon.' }),
  [ROOM.TRAINING]: Object.freeze({ name: 'Training Room', icon: '⚔', cost: 50, description: 'Dummies and racks improve combat skill.' }),
  [ROOM.LIBRARY]: Object.freeze({ name: 'Library', icon: '▤', cost: 50, description: 'Warlocks turn forbidden lore into spells.' }),
  [ROOM.PRISON]: Object.freeze({ name: 'Prison', icon: '▥', cost: 60, description: 'Iron cells hold defeated enemies.' }),
  [ROOM.TORTURE]: Object.freeze({ name: 'Torture Chamber', icon: '⌁', cost: 80, description: 'Converts captives through terrible persuasion.' }),
  [ROOM.WORKSHOP]: Object.freeze({ name: 'Workshop', icon: '⚒', cost: 50, description: 'Builds traps, doors and dungeon machinery.' }),
  [ROOM.TEMPLE]: Object.freeze({ name: 'Temple', icon: '✦', cost: 100, description: 'Sacrifices and dark rites grant rare blessings.' }),
});

const WALKABLE = new Set([TILE.EARTH, TILE.CLAIMED, TILE.PORTAL, TILE.HEART]);
const ROOM_TYPES = new Set(Object.values(ROOM));
const CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const ROOM_STYLE = Object.freeze({
  [ROOM.TREASURY]: { inset: 'gold', prop: 'treasure', density: 0.56 },
  [ROOM.LAIR]: { inset: 'leather', prop: 'bed', density: 0.48 },
  [ROOM.HATCHERY]: { inset: 'straw', prop: 'nest', density: 0.52 },
  [ROOM.TRAINING]: { inset: 'blackIron', prop: 'dummy', density: 0.38 },
  [ROOM.LIBRARY]: { inset: 'violetRune', prop: 'shelf', density: 0.46 },
  [ROOM.PRISON]: { inset: 'reinforced', prop: 'bars', density: 0.34 },
  [ROOM.TORTURE]: { inset: 'blood', prop: 'rack', density: 0.37 },
  [ROOM.WORKSHOP]: { inset: 'blackIron', prop: 'anvil', density: 0.42 },
  [ROOM.TEMPLE]: { inset: 'bone', prop: 'idol', density: 0.3 },
});

function hash2(x, z, salt = 0) {
  let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(z + 1442695041, 2246822519);
  h = Math.imul(h ^ (h >>> 13) ^ salt, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normaliseRoom(roomType) {
  if (!roomType) return null;
  const value = String(roomType).toLowerCase();
  return ROOM_TYPES.has(value) ? value : null;
}

export class DungeonWorld {
  constructor(runtime = {}) {
    if (!BABYLON) throw new Error('Babylon.js must be loaded before world.js');
    if (!runtime.scene) throw new Error('DungeonWorld requires runtime.scene');

    this.runtime = runtime;
    this.scene = runtime.scene;
    this.gridSize = clamp(runtime.gridSize || runtime.worldData?.gridSize || 64, 16, 128);
    this.seed = runtime.seed ?? runtime.worldData?.seed ?? 1337;
    this.grid = [];
    this.heartCell = null;
    this.environment = runtime.environment || createDungeonEnvironment(runtime);
    this.materials = this.environment.materials;
    this.batches = new Map();
    this.batchCells = new Map();
    this.specials = [];
    this._specialsByCell = new Map();
    this.animated = [];
    this._dirty = true;
    this._rebuildClock = 0;
    this._randomState = (this.seed ^ 0x9e3779b9) >>> 0;

    // Reused across every _add() call so a full-grid rebuild composes tens of
    // thousands of instance transforms without allocating a Vector3,
    // Quaternion and Matrix per tile/prop — only the final 16 floats are
    // copied out, straight into each batch's persistent scratch buffer.
    this._scratchScale = new BABYLON.Vector3();
    this._scratchRotation = new BABYLON.Quaternion();
    this._scratchPosition = new BABYLON.Vector3();
    this._scratchMatrix = new BABYLON.Matrix();

    this._createTemplates();
    if (runtime.worldData?.cells) this._loadCells(runtime.worldData.cells);
    else this._generateDungeon();
    this.rebuildVisuals();
  }

  // ------------------------------------------------------------
  // GRID CREATION
  // ------------------------------------------------------------

  _blankGrid() {
    this.grid.length = 0;
    for (let x = 0; x < this.gridSize; x++) {
      const column = [];
      for (let z = 0; z < this.gridSize; z++) {
        const cell = {
          x, z,
          type: TILE.ROCK,
          room: null,
          discovered: false,
          visible: false,
          gold: 0,
          metadata: Object.create(null),
        };
        // Keep the legacy roomType spelling as a live alias while the Babylon
        // modules converge on the shorter `room` field.
        Object.defineProperty(cell, 'roomType', {
          enumerable: true,
          get() { return this.room; },
          set(value) { this.room = normaliseRoom(value); },
        });
        column.push(cell);
      }
      this.grid.push(column);
    }
  }

  _generateDungeon() {
    this._blankGrid();
    const center = Math.floor(this.gridSize / 2);
    const carve = (x, z, type = TILE.EARTH) => {
      const cell = this.getCell(x, z);
      if (cell) cell.type = type;
    };

    // Natural seams and subterranean pools are deterministic, so rebuilding a
    // level with the same seed never changes the player's map.
    for (let x = 2; x < this.gridSize - 2; x++) {
      for (let z = 2; z < this.gridSize - 2; z++) {
        const vein = hash2(x, z, this.seed);
        if (vein > 0.975 && hash2(x >> 1, z >> 1, this.seed + 41) > 0.5) {
          const cell = this.grid[x][z];
          cell.type = TILE.GOLD;
          cell.gold = 300 + Math.floor(hash2(x, z, this.seed + 3) * 400);
        }
      }
    }

    // A readable starter keep: central claimed chamber with four rough-hewn
    // approach tunnels.  The outer map remains hidden until explored.
    for (let x = center - 3; x <= center + 3; x++) {
      for (let z = center - 3; z <= center + 3; z++) {
        if (Math.abs(x - center) + Math.abs(z - center) <= 5) carve(x, z, TILE.CLAIMED);
      }
    }
    for (const [dx, dz] of CARDINAL) {
      for (let distance = 4; distance <= 10; distance++) {
        carve(center + dx * distance, center + dz * distance);
        if (distance < 8) carve(center + dx * distance + dz, center + dz * distance + dx);
      }
    }

    // Water and lava chambers sit far enough from the starting keep that they
    // are discoveries, not immediate movement blockers.
    this._paintPool(center - 14, center + 11, TILE.WATER, 4);
    this._paintPool(center + 15, center - 12, TILE.LAVA, 3);

    const heart = this.getCell(center, center);
    heart.type = TILE.HEART;
    heart.discovered = true;
    heart.visible = true;
    this.heartCell = heart;

    const portal = this.getCell(center + 10, center);
    if (portal) portal.type = TILE.PORTAL;
    this.reveal(center, center, 7);
  }

  _paintPool(cx, cz, type, radius) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      for (let z = cz - radius; z <= cz + radius; z++) {
        const distance = Math.hypot(x - cx, z - cz);
        if (distance <= radius - hash2(x, z, this.seed + 91) * 1.25) {
          const cell = this.getCell(x, z);
          if (cell) cell.type = type;
        }
      }
    }
  }

  _loadCells(source) {
    this._blankGrid();
    for (const data of source) {
      const cell = this.getCell(data.x, data.z);
      if (!cell) continue;
      if (Object.values(TILE).includes(data.type)) cell.type = data.type;
      cell.room = normaliseRoom(data.room || data.roomType);
      cell.discovered = Boolean(data.discovered);
      cell.visible = Boolean(data.visible);
      cell.gold = Number(data.gold || data.goldAmount || 0);
      if (cell.type === TILE.HEART) this.heartCell = cell;
    }
    if (!this.heartCell) {
      const center = Math.floor(this.gridSize / 2);
      this.heartCell = this.grid[center][center];
      this.heartCell.type = TILE.HEART;
      this.heartCell.discovered = true;
      this.heartCell.visible = true;
    }
  }

  // ------------------------------------------------------------
  // THIN-INSTANCE TEMPLATES
  // ------------------------------------------------------------

  _createTemplates() {
    const scene = this.scene;
    const mat = this.materials;
    const box = (name, material, options = {}) => this._template(
      name,
      BABYLON.MeshBuilder.CreateBox(`batch.${name}`, { width: 1, height: 1, depth: 1, ...options }, scene),
      material,
    );
    const cylinder = (name, material, options = {}) => this._template(
      name,
      BABYLON.MeshBuilder.CreateCylinder(`batch.${name}`, options, scene),
      material,
    );
    const sphere = (name, material, options = {}) => this._template(
      name,
      BABYLON.MeshBuilder.CreateSphere(`batch.${name}`, options, scene),
      material,
    );

    box('tile.rock', mat.rock);
    cylinder('tile.rockCrown', mat.rockEdge, { height: 1, diameterTop: 0.72, diameterBottom: 1, tessellation: 4 });
    box('tile.goldRock', mat.rock);
    sphere('tile.goldFleck', mat.gold, { diameter: 1, segments: 5 });
    box('tile.floor', mat.earth);
    box('tile.claimed', mat.claimed);
    box('tile.claimedInset', mat.claimedTrim);
    box('tile.wall', mat.reinforced);
    cylinder('tile.wallCrown', mat.reinforcedTrim, { height: 1, diameterTop: 0.86, diameterBottom: 1, tessellation: 4 });
    sphere('tile.wallStud', mat.reinforcedTrim, { diameter: 1, segments: 4 });
    box('tile.water', mat.water);
    box('tile.lava', mat.lava);
    sphere('tile.lavaCrust', mat.lavaCrust, { diameter: 1, segments: 4 });
    box('tile.fog', mat.fog);
    box('tile.mist', mat.mist);

    for (const [roomType, style] of Object.entries(ROOM_STYLE)) {
      box(`room.${roomType}`, mat[style.inset]);
    }

    // A compact modular prop kit.  Each primitive below is shared by many room
    // types and only its transform changes, keeping the total draw-call count
    // bounded as the dungeon expands.
    box('decor.gold', mat.gold);
    box('decor.wood', mat.wood);
    box('decor.leather', mat.leather);
    box('decor.straw', mat.straw);
    box('decor.iron', mat.blackIron);
    box('decor.bone', mat.bone);
    box('decor.blood', mat.blood);
    box('decor.parchment', mat.parchment);
    box('decor.runeViolet', mat.violetRune);
    box('decor.runeGreen', mat.greenRune);
    sphere('decor.egg', mat.bone, { diameter: 1, segments: 6 });
    cylinder('decor.post', mat.wood, { height: 1, diameter: 1, tessellation: 8 });
    cylinder('decor.ironPost', mat.blackIron, { height: 1, diameter: 1, tessellation: 8 });
    cylinder('decor.torch', mat.blackIron, { height: 1, diameter: 1, tessellation: 8 });
    sphere('decor.fire', mat.fire, { diameter: 1, segments: 5 });
    cylinder('decor.idol', mat.bone, { height: 1, diameterTop: 0.25, diameterBottom: 1, tessellation: 6 });
  }

  _template(key, mesh, material) {
    mesh.material = material;
    mesh.isPickable = (key.startsWith('tile.') || key.startsWith('room.'))
      && key !== 'tile.fog'
      && key !== 'tile.mist';
    mesh.thinInstanceEnablePicking = mesh.isPickable;
    mesh.receiveShadows = true;
    mesh.metadata = { dungeonBatch: key };
    mesh.alwaysSelectAsActiveMesh = false;
    // `scratch` is this frame's write target (grown, never shrunk); `data` is
    // the last buffer actually handed to Babylon, kept around only so the
    // post-scan diff has something stable to compare against (scratch itself
    // gets overwritten in place on the next rebuild).
    this.batches.set(key, { mesh, scratch: new Float32Array(0), count: 0, cells: [], data: null });
    return mesh;
  }

  _ensureScratch(batch, neededFloats) {
    if (batch.scratch.length >= neededFloats) return;
    const grown = new Float32Array(Math.max(neededFloats, batch.scratch.length * 2 || 256));
    grown.set(batch.scratch);
    batch.scratch = grown;
  }

  _add(key, cell, x, y, z, sx = 1, sy = 1, sz = 1, yaw = 0, pitch = 0, roll = 0) {
    const batch = this.batches.get(key);
    if (!batch) return;
    const index = batch.count++;
    this._ensureScratch(batch, (index + 1) * 16);
    this._scratchScale.set(sx, sy, sz);
    BABYLON.Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, this._scratchRotation);
    this._scratchPosition.set(x, y, z);
    BABYLON.Matrix.ComposeToRef(this._scratchScale, this._scratchRotation, this._scratchPosition, this._scratchMatrix);
    this._scratchMatrix.copyToArray(batch.scratch, index * 16);
    batch.cells[index] = cell || null;
  }

  _addTileVisual(cell) {
    const { x, z, type } = cell;
    const yaw = Math.floor(hash2(x, z, this.seed + 7) * 4) * Math.PI / 2;
    const variance = 0.94 + hash2(x, z, this.seed + 8) * 0.1;

    if (type === TILE.ROCK || type === TILE.GOLD) {
      const key = type === TILE.GOLD ? 'tile.goldRock' : 'tile.rock';
      this._add(key, cell, x, 0.5, z, 0.98, 1, 0.98, yaw);
      this._add('tile.rockCrown', cell, x, 1.02, z, variance, 0.18, variance, yaw + Math.PI / 4);
      if (type === TILE.GOLD) {
        for (let i = 0; i < 3; i++) {
          const angle = hash2(x, z, this.seed + 10 + i) * Math.PI * 2;
          this._add('tile.goldFleck', cell, 
            x + Math.cos(angle) * 0.27,
            0.56 + i * 0.16,
            z + Math.sin(angle) * 0.27,
            0.09, 0.16, 0.07,
            angle,
          );
        }
      }
      return;
    }

    if (type === TILE.REINFORCED) {
      this._add('tile.wall', cell, x, 0.46, z, 0.97, 0.92, 0.97);
      this._add('tile.wallCrown', cell, x, 0.94, z, 1, 0.12, 1, Math.PI / 4);
      for (const [ox, oz] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) {
        this._add('tile.wallStud', cell, x + ox, 1.02, z + oz, 0.09, 0.12, 0.09, Math.PI / 4);
      }
      return;
    }

    if (type === TILE.WATER || type === TILE.LAVA) {
      this._add(type === TILE.WATER ? 'tile.water' : 'tile.lava', cell, x, -0.01, z, 0.99, 0.06, 0.99);
      if (type === TILE.LAVA && hash2(x, z, this.seed + 11) > 0.4) {
        this._add('tile.lavaCrust', cell, 
          x + (hash2(x, z, 12) - 0.5) * 0.45,
          0.035,
          z + (hash2(x, z, 13) - 0.5) * 0.45,
          0.23, 0.035, 0.11,
          yaw,
        );
      }
      return;
    }

    // Heart and portal sit on claimed foundations.  Room floors use their
    // identity inset instead of the standard Keeper-red inset.
    const claimed = type === TILE.CLAIMED || type === TILE.HEART || type === TILE.PORTAL;
    this._add(claimed ? 'tile.claimed' : 'tile.floor', cell, x, 0, z, 0.99, 0.1, 0.99);
    if (cell.room) {
      this._add(`room.${cell.room}`, cell, x, 0.065, z, 0.82, 0.035, 0.82);
      this._addRoomDecor(cell);
    } else if (claimed) {
      this._add('tile.claimedInset', cell, x, 0.065, z, 0.78, 0.025, 0.78);
    }
  }

  _addRoomDecor(cell) {
    const style = ROOM_STYLE[cell.room];
    if (!style) return;
    const { x, z } = cell;
    const roll = hash2(x, z, this.seed + 103);
    if (roll > style.density) {
      if (roll > 0.9 && this._isRoomEdge(cell)) this._addTorch(cell);
      return;
    }
    const yaw = Math.floor(hash2(x, z, this.seed + 104) * 4) * Math.PI / 2;

    switch (style.prop) {
      case 'treasure':
        this._add('decor.gold', cell, x, 0.16, z, 0.55, 0.2, 0.48, yaw);
        this._add('decor.iron', cell, x, 0.28, z, 0.58, 0.07, 0.06, yaw);
        break;
      case 'bed':
        this._add('decor.straw', cell, x, 0.14, z, 0.68, 0.16, 0.48, yaw);
        this._add('decor.leather', cell, x, 0.23, z, 0.56, 0.08, 0.39, yaw);
        break;
      case 'nest':
        this._add('decor.straw', cell, x, 0.12, z, 0.65, 0.11, 0.62, yaw);
        this._add('decor.egg', cell, x + 0.08, 0.25, z - 0.06, 0.13, 0.2, 0.13, yaw);
        break;
      case 'dummy':
        this._add('decor.post', cell, x, 0.48, z, 0.12, 0.86, 0.12);
        this._add('decor.wood', cell, x, 0.67, z, 0.72, 0.1, 0.1, yaw);
        this._add('decor.leather', cell, x, 0.78, z, 0.27, 0.22, 0.18, yaw);
        break;
      case 'shelf':
        this._add('decor.wood', cell, x, 0.48, z, 0.72, 0.82, 0.15, yaw);
        for (let i = -1; i <= 1; i++) {
          this._add('decor.parchment', cell, 
            x + Math.cos(yaw) * i * 0.16,
            0.44 + (i & 1) * 0.15,
            z - Math.sin(yaw) * i * 0.16,
            0.09, 0.24, 0.12,
            yaw,
          );
        }
        this._add('decor.runeViolet', cell, x, 0.08, z, 0.22, 0.025, 0.22, yaw);
        break;
      case 'bars':
        for (let i = -1; i <= 1; i++) {
          this._add('decor.ironPost', cell, x + i * 0.24, 0.5, z, 0.045, 0.9, 0.045);
        }
        this._add('decor.iron', cell, x, 0.76, z, 0.64, 0.055, 0.055);
        break;
      case 'rack':
        for (const offset of [-0.27, 0.27]) {
          this._add('decor.post', cell, x + offset, 0.28, z, 0.07, 0.45, 0.07, 0, 0, offset);
        }
        this._add('decor.leather', cell, x, 0.28, z, 0.62, 0.055, 0.36, yaw);
        this._add('decor.blood', cell, x, 0.075, z, 0.48, 0.015, 0.35, yaw);
        break;
      case 'anvil':
        this._add('decor.iron', cell, x, 0.2, z, 0.32, 0.28, 0.26, yaw);
        this._add('decor.iron', cell, x, 0.42, z, 0.7, 0.16, 0.25, yaw);
        this._add('decor.fire', cell, x + 0.28, 0.16, z - 0.26, 0.12, 0.18, 0.12);
        break;
      case 'idol':
        this._add('decor.idol', cell, x, 0.4, z, 0.42, 0.72, 0.42, yaw);
        this._add('decor.runeGreen', cell, x, 0.08, z, 0.46, 0.025, 0.46, Math.PI / 4);
        break;
    }
  }

  _isRoomEdge(cell) {
    return CARDINAL.some(([dx, dz]) => this.getCell(cell.x + dx, cell.z + dz)?.room !== cell.room);
  }

  _addTorch(cell) {
    const direction = CARDINAL.find(([dx, dz]) => this.getCell(cell.x + dx, cell.z + dz)?.room !== cell.room) || [1, 0];
    const x = cell.x + direction[0] * 0.38;
    const z = cell.z + direction[1] * 0.38;
    this._add('decor.torch', cell, x, 0.43, z, 0.055, 0.45, 0.055);
    this._add('decor.fire', cell, x, 0.72, z, 0.11, 0.18, 0.11);
  }

  rebuildVisuals() {
    for (const batch of this.batches.values()) batch.count = 0;
    const liveLandmarks = new Set();

    for (let x = 0; x < this.gridSize; x++) {
      for (let z = 0; z < this.gridSize; z++) {
        const cell = this.grid[x][z];
        if (!cell.discovered) {
          this._add('tile.fog', cell, x, 0.6, z, 1, 1.2, 1);
          continue;
        }
        this._addTileVisual(cell);
        if (!cell.visible) this._add('tile.mist', cell, x, 0.2, z, 1, 0.4, 1);
        if (cell.type === TILE.HEART) {
          liveLandmarks.add(this._landmarkKey('heart', cell));
          this._createHeart(cell);
        } else if (cell.type === TILE.PORTAL) {
          liveLandmarks.add(this._landmarkKey('portal', cell));
          this._createPortal(cell);
        }
      }
    }
    this._removeStaleSpecials(liveLandmarks);

    for (const [key, batch] of this.batches) {
      const { mesh, cells } = batch;
      cells.length = batch.count;
      if (!batch.count) {
        if (mesh.isEnabled()) {
          mesh.thinInstanceCount = 0;
          mesh.setEnabled(false);
        }
        batch.data = null;
        this.batchCells.set(key, cells);
        continue;
      }
      // `scratch` holds this frame's freshly composed matrices; only the
      // used prefix is meaningful (the buffer is grow-only and may be
      // larger). Diff it against `data`, the buffer last handed to Babylon,
      // to avoid an upload when nothing actually moved.
      const length = batch.count * 16;
      const fresh = batch.scratch;
      let bufferChanged = !batch.data || batch.data.length !== length;
      if (!bufferChanged) {
        for (let i = 0; i < length; i++) {
          if (batch.data[i] !== fresh[i]) {
            bufferChanged = true;
            break;
          }
        }
      }
      if (bufferChanged) {
        const data = batch.data && batch.data.length === length ? batch.data : new Float32Array(length);
        data.set(fresh.subarray(0, length));
        mesh.setEnabled(true);
        mesh.thinInstanceSetBuffer('matrix', data, 16, false);
        mesh.thinInstanceCount = batch.count;
        mesh.thinInstanceRefreshBoundingInfo(true);
        batch.data = data;
      }
      mesh.metadata.instanceCells = cells;
      this.batchCells.set(key, cells);
    }
    this._dirty = false;
    // stats() is a full 4096-cell scan; the emitted detail is normally
    // discarded (subscribers key off the event name to invalidate their own
    // caches, see main.js/visuals.js), so hand back a lazy accessor and only
    // pay for the scan if something actually reads `.stats`.
    const world = this;
    this._emit('worldRebuilt', { get stats() { return world.stats(); } });
  }

  // ------------------------------------------------------------
  // ANIMATED LANDMARKS
  // ------------------------------------------------------------

  _createHeart(cell) {
    const landmarkKey = this._landmarkKey('heart', cell);
    if (this._specialsByCell.has(landmarkKey)) return this._specialsByCell.get(landmarkKey).root;
    const root = new BABYLON.TransformNode('landmark.dungeon-heart', this.scene);
    root.position.set(cell.x, 0.08, cell.z);
    root.metadata = { dungeonCell: cell, landmark: 'heart' };

    const dais = BABYLON.MeshBuilder.CreateCylinder('heart.dais', {
      height: 0.22, diameterTop: 1.35, diameterBottom: 1.6, tessellation: 8,
    }, this.scene);
    dais.parent = root;
    dais.material = this.materials.heartStone;
    dais.receiveShadows = true;

    const crystal = BABYLON.MeshBuilder.CreateCylinder('heart.crystal', {
      height: 1.55, diameterTop: 0.12, diameterBottom: 0.82, tessellation: 6,
    }, this.scene);
    crystal.parent = root;
    crystal.position.y = 0.88;
    crystal.material = this.materials.heartCrystal;
    crystal.isPickable = true;
    crystal.metadata = { dungeonCell: cell, landmark: 'heart' };

    const crown = BABYLON.MeshBuilder.CreateTorus('heart.crown', {
      diameter: 1.08, thickness: 0.07, tessellation: 20,
    }, this.scene);
    crown.parent = root;
    crown.position.y = 0.48;
    crown.material = this.materials.reinforcedTrim;

    for (let i = 0; i < 4; i++) {
      const shard = BABYLON.MeshBuilder.CreateCylinder(`heart.shard.${i}`, {
        height: 0.64, diameterTop: 0.04, diameterBottom: 0.22, tessellation: 5,
      }, this.scene);
      const angle = i * Math.PI / 2 + Math.PI / 4;
      shard.parent = root;
      shard.position.set(Math.cos(angle) * 0.64, 0.38, Math.sin(angle) * 0.64);
      shard.rotation.z = Math.cos(angle) * 0.28;
      shard.rotation.x = Math.sin(angle) * 0.28;
      shard.material = this.materials.heartCrystal;
    }
    this.environment.registerEmissive(crystal, 0, 0.04);
    const animated = { kind: 'heart', root, crystal, crown, phase: hash2(cell.x, cell.z) * 6 };
    this.specials.push(root);
    this.animated.push(animated);
    this._specialsByCell.set(landmarkKey, { root, animated });
    return root;
  }

  _createPortal(cell) {
    const landmarkKey = this._landmarkKey('portal', cell);
    if (this._specialsByCell.has(landmarkKey)) return this._specialsByCell.get(landmarkKey).root;
    const root = new BABYLON.TransformNode('landmark.portal', this.scene);
    root.position.set(cell.x, 0.1, cell.z);
    root.metadata = { dungeonCell: cell, landmark: 'portal' };

    const base = BABYLON.MeshBuilder.CreateCylinder('portal.base', {
      height: 0.2, diameterTop: 1.45, diameterBottom: 1.7, tessellation: 10,
    }, this.scene);
    base.parent = root;
    base.material = this.materials.portalStone;
    base.receiveShadows = true;

    const rings = [];
    for (let i = 0; i < 3; i++) {
      const ring = BABYLON.MeshBuilder.CreateTorus(`portal.ring.${i}`, {
        diameter: 0.78 + i * 0.28, thickness: 0.055, tessellation: 24,
      }, this.scene);
      ring.parent = root;
      ring.position.y = 0.18 + i * 0.025;
      ring.material = i === 1 ? this.materials.portalEnergy : this.materials.reinforcedTrim;
      ring.isPickable = true;
      ring.metadata = { dungeonCell: cell, landmark: 'portal' };
      rings.push(ring);
    }
    const energy = BABYLON.MeshBuilder.CreateCylinder('portal.energy', {
      height: 0.045, diameter: 0.72, tessellation: 24,
    }, this.scene);
    energy.parent = root;
    energy.position.y = 0.2;
    energy.material = this.materials.portalEnergy;
    energy.metadata = { dungeonCell: cell, landmark: 'portal' };

    this.environment.registerEmissive(energy, hash2(cell.x, cell.z) * 5, 0.07);
    const animated = { kind: 'portal', root, rings, energy, phase: hash2(cell.x, cell.z) * 6 };
    this.specials.push(root);
    this.animated.push(animated);
    this._specialsByCell.set(landmarkKey, { root, animated });
    return root;
  }

  _landmarkKey(kind, cell) {
    return `${kind}:${cell.x}:${cell.z}`;
  }

  _removeStaleSpecials(liveKeys) {
    let changed = false;
    for (const [key, item] of this._specialsByCell) {
      if (liveKeys.has(key)) continue;
      item.root.dispose(false, false);
      this._specialsByCell.delete(key);
      changed = true;
    }
    if (!changed) return;
    this.specials = this.specials.filter((root) => !root.isDisposed?.());
    this.animated = this.animated.filter((entry) => !entry.root.isDisposed?.());
    this._pruneAnimatedEmissives();
  }

  _pruneAnimatedEmissives() {
    this.environment.animatedEmissives = this.environment.animatedEmissives.filter(
      (entry) => entry.node && !entry.node.isDisposed?.(),
    );
  }

  _clearSpecials() {
    // Landmark meshes share the environment palette; never dispose those
    // materials when a visibility/tile rebuild replaces the nodes.
    for (const root of this.specials) root.dispose(false, false);
    this.specials.length = 0;
    this._specialsByCell.clear();
    this.animated.length = 0;
    // Drop disposed animation nodes retained by the shared environment.
    this._pruneAnimatedEmissives();
  }

  // ------------------------------------------------------------
  // PUBLIC GRID API
  // ------------------------------------------------------------

  getCell(x, z) {
    if (typeof x === 'object' && x) {
      z = x.z;
      x = x.x;
    }
    x = Math.floor(Number(x));
    z = Math.floor(Number(z));
    return this.grid[x]?.[z] || null;
  }

  isWalkable(x, z) {
    const cell = this.getCell(x, z);
    return Boolean(cell && (WALKABLE.has(cell.type) || cell.room));
  }

  setTile(x, z, type, options = {}) {
    const cell = this.getCell(x, z);
    if (!cell || !Object.values(TILE).includes(type)) return false;
    cell.type = type;
    if (type !== TILE.CLAIMED && type !== TILE.EARTH) cell.room = null;
    if (options.room !== undefined) cell.room = normaliseRoom(options.room);
    if (options.discovered !== undefined) cell.discovered = Boolean(options.discovered);
    if (options.visible !== undefined) cell.visible = Boolean(options.visible);
    if (type === TILE.HEART) this.heartCell = cell;
    this._changed(cell, 'tile');
    return true;
  }

  dig(x, z) {
    const cell = this.getCell(x, z);
    if (!cell || ![TILE.ROCK, TILE.GOLD, TILE.REINFORCED].includes(cell.type)) return false;
    const minedGold = cell.type === TILE.GOLD ? cell.gold : 0;
    cell.type = TILE.EARTH;
    cell.room = null;
    cell.gold = 0;
    cell.discovered = true;
    cell.visible = true;
    this._changed(cell, 'dig', { gold: minedGold });
    return { cell, gold: minedGold };
  }

  claim(x, z) {
    const cell = this.getCell(x, z);
    if (!cell || cell.type !== TILE.EARTH) return false;
    cell.type = TILE.CLAIMED;
    cell.discovered = true;
    cell.visible = true;
    this._changed(cell, 'claim');
    return true;
  }

  reinforce(x, z) {
    const cell = this.getCell(x, z);
    if (!cell || ![TILE.ROCK, TILE.EARTH, TILE.CLAIMED].includes(cell.type) || cell.type === TILE.HEART) return false;
    cell.type = TILE.REINFORCED;
    cell.room = null;
    cell.discovered = true;
    cell.visible = true;
    this._changed(cell, 'reinforce');
    return true;
  }

  buildRoom(roomOrX, cellsOrZ, maybeRoom) {
    let roomType;
    let targets;
    if (typeof roomOrX === 'number') {
      roomType = normaliseRoom(maybeRoom);
      targets = [{ x: roomOrX, z: cellsOrZ }];
    } else {
      roomType = normaliseRoom(roomOrX);
      targets = Array.isArray(cellsOrZ) ? cellsOrZ : [cellsOrZ];
    }
    if (!roomType) return 0;

    let built = 0;
    for (const target of targets) {
      const cell = this.getCell(target);
      if (!cell || ![TILE.EARTH, TILE.CLAIMED].includes(cell.type)) continue;
      cell.type = TILE.CLAIMED;
      cell.room = roomType;
      cell.discovered = true;
      cell.visible = true;
      built++;
      this._emit('cellChanged', { action: 'room', cell, room: roomType });
    }
    if (built) this._dirty = true;
    return built;
  }

  setVisibility(x, z, visible, discovered = visible) {
    const cell = this.getCell(x, z);
    if (!cell) return false;
    const nextVisible = Boolean(visible);
    const nextDiscovered = cell.discovered || Boolean(discovered);
    if (cell.visible === nextVisible && cell.discovered === nextDiscovered) return false;
    cell.visible = nextVisible;
    cell.discovered = nextDiscovered;
    this._dirty = true;
    this._emit('visibilityChanged', { cell, visible: nextVisible, discovered: nextDiscovered });
    return true;
  }

  reveal(cx, cz, radius = 4) {
    let changed = 0;
    const r2 = radius * radius;
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      for (let z = Math.floor(cz - radius); z <= Math.ceil(cz + radius); z++) {
        if ((x - cx) ** 2 + (z - cz) ** 2 > r2) continue;
        const cell = this.getCell(x, z);
        if (!cell) continue;
        if (!cell.discovered || !cell.visible) changed++;
        cell.discovered = true;
        cell.visible = true;
      }
    }
    if (changed) {
      this._dirty = true;
      this._emit('visibilityChanged', { x: cx, z: cz, radius, revealed: changed });
    }
    return changed;
  }

  hideAllVisible() {
    let changed = 0;
    for (const column of this.grid) {
      for (const cell of column) {
        if (!cell.visible) continue;
        cell.visible = false;
        changed++;
      }
    }
    if (changed) this._dirty = true;
    return changed;
  }

  randomWalkable(near = null, radius = Infinity) {
    const origin = near ? { x: Number(near.x), z: Number(near.z) } : null;
    const candidates = [];
    for (const column of this.grid) {
      for (const cell of column) {
        if (!this.isWalkable(cell) || !cell.discovered) continue;
        if (origin && Math.hypot(cell.x - origin.x, cell.z - origin.z) > radius) continue;
        candidates.push(cell);
      }
    }
    if (!candidates.length) return null;
    const cell = candidates[Math.floor(this._random() * candidates.length)];
    return new BABYLON.Vector3(cell.x, 0, cell.z);
  }

  getHeartPosition() {
    if (!this.heartCell) return new BABYLON.Vector3(0, 0, 0);
    return new BABYLON.Vector3(this.heartCell.x, 0, this.heartCell.z);
  }

  cellFromPick(pickInfo) {
    const mesh = pickInfo?.pickedMesh;
    if (!mesh) return null;
    if (mesh.metadata?.dungeonCell) {
      const cell = mesh.metadata.dungeonCell;
      return cell.discovered ? cell : null;
    }
    const key = mesh.metadata?.dungeonBatch;
    if (!key) return null;
    const index = pickInfo.thinInstanceIndex ?? pickInfo.instanceId;
    const cell = this.batchCells.get(key)?.[index] || null;
    return cell?.discovered ? cell : null;
  }

  resolvePick(pickInfo) {
    return this.cellFromPick(pickInfo);
  }

  getTileFromPick(pickInfo) {
    return this.cellFromPick(pickInfo);
  }

  getThinInstanceCell(mesh, index) {
    const key = mesh?.metadata?.dungeonBatch;
    return key ? (this.batchCells.get(key)?.[index] || null) : null;
  }

  getInstanceCell(mesh, index) {
    return this.getThinInstanceCell(mesh, index);
  }

  getMinimap() {
    const pixels = new Uint8ClampedArray(this.gridSize * this.gridSize * 4);
    const tileColors = {
      [TILE.ROCK]: [38, 31, 47],
      [TILE.GOLD]: [213, 151, 43],
      [TILE.EARTH]: [75, 56, 42],
      [TILE.CLAIMED]: [137, 43, 67],
      [TILE.REINFORCED]: [129, 108, 133],
      [TILE.WATER]: [28, 101, 137],
      [TILE.LAVA]: [235, 62, 19],
      [TILE.PORTAL]: [183, 76, 241],
      [TILE.HEART]: [255, 38, 82],
    };
    const roomColors = {
      [ROOM.TREASURY]: [242, 179, 46],
      [ROOM.LAIR]: [131, 65, 84],
      [ROOM.HATCHERY]: [159, 134, 54],
      [ROOM.TRAINING]: [164, 72, 54],
      [ROOM.LIBRARY]: [146, 79, 211],
      [ROOM.PRISON]: [100, 121, 143],
      [ROOM.TORTURE]: [151, 22, 39],
      [ROOM.WORKSHOP]: [204, 93, 31],
      [ROOM.TEMPLE]: [89, 198, 125],
    };
    for (let z = 0; z < this.gridSize; z++) {
      for (let x = 0; x < this.gridSize; x++) {
        const cell = this.grid[x][z];
        const offset = (z * this.gridSize + x) * 4;
        const rgb = !cell.discovered
          ? [6, 5, 10]
          : (roomColors[cell.room] || tileColors[cell.type] || [28, 23, 32]);
        const shade = cell.visible ? 1 : 0.48;
        pixels[offset] = rgb[0] * shade;
        pixels[offset + 1] = rgb[1] * shade;
        pixels[offset + 2] = rgb[2] * shade;
        pixels[offset + 3] = 255;
      }
    }
    return { pixels, width: this.gridSize, height: this.gridSize };
  }

  minimapSnapshot() {
    return this.getMinimap();
  }

  stats() {
    const tileCounts = Object.fromEntries(Object.values(TILE).map((type) => [type, 0]));
    const roomCounts = Object.fromEntries(Object.values(ROOM).map((type) => [type, 0]));
    let visible = 0;
    let discovered = 0;
    for (const column of this.grid) {
      for (const cell of column) {
        tileCounts[cell.type]++;
        if (cell.room) roomCounts[cell.room]++;
        if (cell.visible) visible++;
        if (cell.discovered) discovered++;
      }
    }
    let thinInstances = 0;
    let activeBatches = 0;
    for (const batch of this.batches.values()) {
      if (!batch.count) continue;
      activeBatches++;
      thinInstances += batch.count;
    }
    return {
      gridSize: this.gridSize,
      cells: this.gridSize * this.gridSize,
      visible,
      discovered,
      tiles: tileCounts,
      rooms: roomCounts,
      activeBatches,
      thinInstances,
      landmarks: this.specials.length,
    };
  }

  update(dt) {
    const safeDt = Math.min(Number(dt) || 0, 0.1);
    this._rebuildClock += safeDt;
    if (this._dirty && this._rebuildClock >= 0.05) {
      this._rebuildClock = 0;
      this.rebuildVisuals();
    }

    this.environment.update(safeDt);
    const time = this.environment.time;
    this.materials.lava.emissiveIntensity = 1.5 + Math.sin(time * 1.8) * 0.12;
    this.materials.water.emissiveIntensity = 0.28 + Math.sin(time * 0.72) * 0.035;
    for (const item of this.animated) {
      if (item.kind === 'heart') {
        const beat = Math.pow(Math.max(0, Math.sin(time * 3.4)), 7);
        item.crystal.scaling.y = 1 + beat * 0.07;
        item.crown.rotation.y += safeDt * 0.24;
      } else if (item.kind === 'portal') {
        for (let i = 0; i < item.rings.length; i++) {
          item.rings[i].rotation.y += safeDt * (0.4 + i * 0.22) * (i & 1 ? -1 : 1);
        }
        item.energy.position.y = 0.2 + Math.sin(time * 1.8 + item.phase) * 0.025;
      }
    }
  }

  dispose() {
    this._clearSpecials();
    for (const batch of this.batches.values()) batch.mesh.dispose(false, false);
    this.batches.clear();
    this.batchCells.clear();
    if (!this.runtime.environment) this.environment.dispose();
  }

  _changed(cell, action, detail = {}) {
    this._dirty = true;
    this._emit('cellChanged', { action, cell, ...detail });
  }

  _emit(name, detail) {
    this.runtime.events?.emit?.(name, detail);
    this.runtime.onWorldEvent?.(name, detail);
  }

  _random() {
    let value = this._randomState;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this._randomState = value >>> 0;
    return this._randomState / 4294967296;
  }
}
