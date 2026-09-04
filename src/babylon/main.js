// ============================================================
// DUNGEON HEART — BABYLON EDITION ENTRY POINT
// ============================================================
// The rewrite deliberately keeps orchestration here and rendering/gameplay in
// focused modules. That lets authored GLB content replace procedural fallback
// models without coupling the simulation back to a particular mesh layout.

import { createBabylonRuntime } from './core.js';
import { DungeonWorld } from './world.js';
import { EntityDirector } from './entities.js';
import { DefensesDirector } from './defenses.js';
import { MagicDirector } from './magic.js';
import { EffectsDirector } from './effects.js';
import { AudioDirector } from './audio.js';
import { DungeonUI } from './ui.js';
import { InputController } from './input.js';

const VERSION = 'v1.0.0-babylon';

function maybeCall(owner, names, ...args) {
  if (!owner) return undefined;
  for (const name of Array.isArray(names) ? names : [names]) {
    if (typeof owner[name] === 'function') return owner[name](...args);
  }
  return undefined;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function entityPosition(entity) {
  return entity?.root?.position || entity?.node?.position || entity?.mesh?.position || entity?.position || null;
}

class BabylonGameApp {
  constructor() {
    this.runtime = null;
    this.world = null;
    this.entities = null;
    this.defenses = null;
    this.magic = null;
    this.effects = null;
    this.audio = null;
    this.ui = null;
    this.input = null;
    this.lastUiUpdate = -Infinity;
    this.lastUiWallTime = -Infinity;
    this.lastMinimapUpdate = -Infinity;
    this.minimap = null;
    this.seeded = false;
    this._lastHeartHitFx = -Infinity;
    this._shakeOffset = { alpha: 0, beta: 0 };
    this._disposed = false;
    this.state = {
      started: false,
      paused: true,
      gameOver: null,
      elapsed: 0,
      wave: 0,
      nextWaveAt: 38,
      gold: 625,
      mana: 220,
      manaMax: 350,
      work: 48,
      research: 0,
      heartHp: 500,
      heartMaxHp: 500,
      mode: 'dig',
      quality: 'auto',
    };
  }

  async boot() {
    this.runtime = await createBabylonRuntime({
      canvasId: 'renderCanvas',
      quality: this.state.quality,
      preferWebGPU: true,
      captureGpuFrameTime: false,
    });

    // Input checks runtime state directly so menu pause and keyboard pause use
    // the exact same flag as the render loop.
    this.runtime.state = this.state;
    this.runtime.isPaused = () => this.state.paused || !this.state.started;
    this.runtime.setPaused = (paused) => this.setPaused(paused);
    this.runtime.togglePause = () => this.setPaused(!this.state.paused);
    this.runtime.economy = this._createEconomyApi();
    this.runtime.events = this._createEventBus();
    this.runtime.maxMana = this.state.manaMax;

    await this._preloadConfiguredAssets();

    this.audio = new AudioDirector(this.runtime);
    this.effects = new EffectsDirector(this.runtime);
    this.world = new DungeonWorld(this.runtime);
    this.effects.attachWorld(this.world);
    this.entities = new EntityDirector(this.runtime, this.world, this.effects);
    this.defenses = new DefensesDirector(this.runtime, this.world, this.entities, this.effects, this.audio);
    this.runtime.defenses = this.defenses;
    this.magic = new MagicDirector(this.runtime, this.world, this.entities, this.effects, this.audio);
    this.runtime.spells = this.magic;

    await Promise.resolve(maybeCall(this.audio, ['init', 'ready']));
    await Promise.resolve(maybeCall(this.entities, ['init', 'ready']));

    this.ui = new DungeonUI({
      start: (kind) => this.start(kind),
      pause: (paused) => this.setPaused(paused),
      modeChange: (mode) => {
        const accepted = this.input?.setMode(mode);
        if (accepted !== false) this.state.mode = mode;
        else {
          this.ui?.setMode(this.state.mode);
          this.ui?.pushEvent('That command is not available yet', { tone: 'danger' });
        }
      },
      action: (action, payload) => this.handleUiAction(action, payload),
      qualityChange: (tier) => this.setQuality(tier),
    });

    this.input = new InputController(
      this.runtime,
      this.world,
      this.entities,
      this.effects,
      this.ui,
    );
    this.input.setMode(this.state.mode);
    this.input.setEnabled(false);

    this.effects.setScreenShakeHook?.((offset) => this.applyScreenShake(offset));
    this._installWorldEvents();
    this._installGameEvents();
    this._configureAmbientEffects();
    this._seed(false);
    this.ui.showStart(true);
    this.ui.update(this.snapshot(true));

    const bootStatus = document.getElementById('boot-status');
    if (bootStatus) {
      bootStatus.classList.add('is-complete');
      window.setTimeout(() => bootStatus.remove(), 420);
    }

    this.runtime.start(() => this.frame());
    window.__DUNGEON_HEART__ = this;
  }

  _createEconomyApi() {
    const resourceNames = new Set(['gold', 'mana', 'work', 'research']);
    const canonicalResource = (resource) => resource === 'manufacturing' ? 'work' : resource;
    const normalise = (resourceOrCosts, amount) => {
      if (typeof resourceOrCosts === 'string') return { [canonicalResource(resourceOrCosts)]: Number(amount) || 0 };
      if (!resourceOrCosts || typeof resourceOrCosts !== 'object') return {};
      return Object.fromEntries(Object.entries(resourceOrCosts).map(([resource, value]) => [canonicalResource(resource), value]));
    };
    const validEntries = (costs) => Object.entries(costs)
      .filter(([resource, value]) => resourceNames.has(resource) && Number(value) > 0)
      .map(([resource, value]) => [resource, Number(value)]);

    return {
      get: (resource) => {
        const canonical = canonicalResource(resource);
        return resourceNames.has(canonical) ? Number(this.state[canonical]) || 0 : 0;
      },
      snapshot: () => ({ gold: this.state.gold, mana: this.state.mana, work: this.state.work, research: this.state.research }),
      canAfford: (resourceOrCosts, amount) => validEntries(normalise(resourceOrCosts, amount))
        .every(([resource, cost]) => this.state[resource] >= cost),
      spend: (resourceOrCosts, amount) => {
        const entries = validEntries(normalise(resourceOrCosts, amount));
        if (!entries.every(([resource, cost]) => this.state[resource] >= cost)) return false;
        for (const [resource, cost] of entries) this.state[resource] -= cost;
        return true;
      },
      add: (resource, amount) => {
        const canonical = canonicalResource(resource);
        if (!resourceNames.has(canonical) || !Number.isFinite(Number(amount))) return false;
        const maximum = canonical === 'mana' ? this.state.manaMax : Infinity;
        this.state[canonical] = Math.max(0, Math.min(maximum, this.state[canonical] + Number(amount)));
        return this.state[canonical];
      },
    };
  }

  _createEventBus() {
    const listeners = new Map();
    return {
      on: (name, listener) => {
        if (typeof listener !== 'function') return () => {};
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(listener);
        return () => listeners.get(name)?.delete(listener);
      },
      off: (name, listener) => listeners.get(name)?.delete(listener),
      emit: (name, detail) => {
        for (const listener of listeners.get(name) || []) listener(detail);
      },
      clear: () => listeners.clear(),
    };
  }

  async _preloadConfiguredAssets() {
    const manifest = window.DUNGEON_ASSET_MANIFEST;
    if (!manifest || typeof manifest !== 'object') return;
    const results = await this.runtime.assetLibrary.loadManifest(manifest, { continueOnError: true });
    const failures = results.filter?.((result) => result?.status === 'rejected') || [];
    if (failures.length) console.warn(`${failures.length} optional dungeon assets failed to load; using procedural fallbacks.`);
  }

  _installWorldEvents() {
    this.runtime.onWorldEvent = (name, detail = {}) => {
      const cell = detail.cell || detail;
      if (!Number.isFinite(cell.x) || !Number.isFinite(cell.z)) return;
      const point = { x: cell.x, y: 0.12, z: cell.z };
      if (detail.action === 'dig') this.effects.dig(point);
      else if (detail.action === 'claim' || detail.action === 'room') this.effects.claim(point);
      this.audio.play?.(detail.action === 'dig' ? 'dig' : 'claim', point);
    };
  }

  _installGameEvents() {
    this.runtime.events.on('defenseTriggered', ({ defense }) => {
      this.ui.pushEvent(`${defense?.name || 'Dungeon defense'} triggered`, { tone: 'danger', icon: '▲' });
    });
    this.runtime.events.on('spellFailed', ({ reason }) => {
      this.ui.pushEvent(reason || 'The spell fizzled', { tone: 'danger', icon: '×' });
    });
    this.runtime.events.on('spellUnlocked', ({ definition }) => {
      this.ui.pushEvent(`${definition?.name || 'A new spell'} has been researched`, { tone: 'good', icon: '✦' });
    });
    document.addEventListener('dungeon:spell-cast', (event) => {
      const spell = event.detail?.spell;
      this.ui.pushEvent(`${spell || 'Spell'} unleashed`, { tone: 'magic' });
    });
    document.addEventListener('dungeon:pause-changed', (event) => {
      this.setPaused(Boolean(event.detail?.paused));
    });
    window.addEventListener('beforeunload', () => this.dispose(), { once: true });
  }

  _configureAmbientEffects() {
    const size = this.world.gridSize || 64;
    this.effects.setAmbientEmbers?.({ minX: 0, maxX: size, minZ: 0, maxZ: size, minY: 0.1, maxY: 2.8 });
  }

  _seed(testing) {
    if (this.seeded) return;
    this.seeded = true;
    const heart = this.world.getHeartPosition();
    const spots = [
      [heart.x - 1, heart.z], [heart.x + 1, heart.z],
      [heart.x, heart.z - 1], [heart.x, heart.z + 1],
    ];
    for (const [x, z] of spots) this.entities.spawnImp?.(x, z);

    this.entities.spawnCreature?.('troll', heart.x - 3, heart.z + 2);
    this.entities.spawnCreature?.('warlock', heart.x + 3, heart.z + 2);
    this.entities.spawnCreature?.('bileDemon', heart.x, heart.z + 4);
    if (testing) {
      this.entities.spawnCreature?.('fly', heart.x - 4, heart.z - 2);
      this.entities.spawnHero?.('knight');
      this.entities.spawnHero?.('archer');
    }
  }

  start(kind = 'new') {
    this.state.started = true;
    this.state.paused = false;
    this.input?.setEnabled(true);
    this.input?.setPaused(false);
    this.ui?.showStart(false);
    this.ui?.showPause(false);
    maybeCall(this.audio, ['unlock', 'resume']);
    if (kind === 'testing') {
      const heart = this.world.getHeartPosition();
      this.entities.spawnCreature?.('fly', heart.x - 4, heart.z - 2);
      this.entities.spawnHero?.('knight');
      this.entities.spawnHero?.('archer');
    }
    this.ui?.pushEvent(kind === 'testing' ? 'Testing dungeon awakened' : 'The Dungeon Heart awakens', { tone: 'good' });
  }

  setPaused(paused) {
    if (!this.state.started && !paused) return true;
    this.state.paused = Boolean(paused);
    this.ui?.showPause(this.state.paused && this.state.started);
    this.input?.setEnabled(!this.state.paused && this.state.started);
    return this.state.paused;
  }

  setQuality(tier) {
    const profile = this.runtime.setQuality(tier);
    this.state.quality = profile.name;
    this.effects.setQualityTier?.(profile.name);
    this.ui.pushEvent(`Rendering quality: ${profile.name}`, { tone: 'system' });
  }

  handleUiAction(action, payload) {
    if (action === 'resume') return this.setPaused(false);
    if (action === 'restart') return window.location.reload();
    if (action === 'main-menu' || action === 'quit') return window.location.reload();
    if (action === 'clear-selection') return this.input?.clearSelection();
    if (action === 'recenter') return this.focusHeart();
    if (action === 'zoom-in' || action === 'zoom-out') {
      const camera = this.runtime?.camera;
      if (!camera) return;
      const factor = action === 'zoom-in' ? 0.82 : 1.22;
      camera.radius = Math.max(camera.lowerRadiusLimit || 7, Math.min(camera.upperRadiusLimit || 80, camera.radius * factor));
      return camera.radius;
    }
    const defense = this.defenses?.get?.(payload);
    if (action === 'lock-door') return this.defenses?.lockDoor?.(defense);
    if (action === 'unlock-door') return this.defenses?.unlockDoor?.(defense);
    if (action === 'repair-door') return this.defenses?.repairDoor?.(defense);
    if (action === 'arm-trap') return this.defenses?.armTrap?.(defense);
    if (action === 'disarm-trap') return this.defenses?.disarmTrap?.(defense);
    if (action === 'reload-trap') return this.defenses?.reloadTrap?.(defense);
    if (action === 'sell-defense') {
      const refund = defense?.category === 'door'
        ? this.defenses?.sellDoor?.(defense)
        : this.defenses?.sellTrap?.(defense);
      if (refund !== false) {
        this.input?.clearSelection();
        this.ui?.pushEvent(`Defense sold for ${refund} work`, { tone: 'system', icon: '¤' });
      }
      return refund;
    }
    if (action === 'focus-threat' || action === 'focus-creature') {
      const entity = maybeCall(this.entities, ['getById', 'findById'], payload);
      const position = entityPosition(entity);
      if (position && this.runtime.camera?.target) this.runtime.camera.target.copyFrom(position);
      return;
    }
    maybeCall(this.entities, ['handleAction', 'command'], action, payload);
  }

  focusHeart() {
    const position = this.world?.getHeartPosition?.();
    const target = this.runtime?.camera?.target;
    if (!position || !target) return false;
    if (typeof target.copyFromFloats === 'function') target.copyFromFloats(position.x, 0, position.z);
    else if (typeof target.copyFrom === 'function') target.copyFrom(position);
    return true;
  }

  applyScreenShake(offset = {}) {
    const camera = this.runtime?.camera;
    if (!camera) return;
    // Effects sends frame-local values. Apply only the delta from the previous
    // sample so the final zero sample restores the exact unshaken camera.
    const nextAlpha = Number(offset.roll || offset.x || 0) * 0.003;
    const nextBeta = Number(offset.y || 0) * 0.002;
    camera.alpha += nextAlpha - this._shakeOffset.alpha;
    camera.beta += nextBeta - this._shakeOffset.beta;
    this._shakeOffset.alpha = nextAlpha;
    this._shakeOffset.beta = nextBeta;
  }

  frame() {
    const engine = this.runtime.engine;
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
    const active = this.state.started && !this.state.paused && !this.state.gameOver;

    if (active) {
      this.state.elapsed += dt;
      this._tickEconomy(dt);
      this._tickResearch(dt);
      this._tickWaves();
      this._tickHeartCombat(dt);
      this.entities.update?.(dt, this.state.elapsed);
      this.defenses.update?.(dt, this.state.elapsed);
      this.magic.update?.(dt, this.state.elapsed);
    }

    // World ambience and pooled effects can remain subtly alive behind menus;
    // simulation-owned entity decisions remain paused above.
    this.world.update?.(active ? dt : dt * 0.18, this.state.elapsed);
    this.effects.update?.(active ? dt : dt * 0.18, this.state.elapsed);
    this.audio.update?.(dt, this.runtime.camera);

    const wallTime = performance.now();
    const uiDue = active
      ? this.state.elapsed - this.lastUiUpdate >= 0.18
      : wallTime - this.lastUiWallTime >= 400;
    if (uiDue) {
      this.lastUiUpdate = this.state.elapsed;
      this.lastUiWallTime = wallTime;
      this.ui.update(this.snapshot());
    }
    this.runtime.scene.render();
  }

  _tickEconomy(dt) {
    const worldStats = this.world.stats?.();
    const claimed = worldStats?.tiles?.claimed || 0;
    this.state.mana = Math.min(this.state.manaMax, this.state.mana + dt * (1.2 + claimed * 0.018));
    this.state.work = Math.min(999, this.state.work + dt * 0.07 * Math.max(1, this._entities('imps').length));
  }

  _tickResearch(dt) {
    const libraries = this.world.stats?.().rooms?.library || 0;
    if (!libraries || !this.magic) return;
    if (!this.magic.researchTarget) {
      const next = Object.keys(this.magic.spellbook?.() || {})
        .find((name) => !this.magic.isUnlocked(name) && this.magic.canResearch(name).ok);
      if (next) this.magic.beginResearch(next);
    }
    if (this.magic.researchTarget) this.magic.addResearch(dt * (1.6 + Math.sqrt(libraries) * 2.4));
  }

  _tickWaves() {
    if (this.state.elapsed < this.state.nextWaveAt) return;
    this.state.wave += 1;
    this.state.nextWaveAt = this.state.elapsed + Math.max(22, 42 - this.state.wave * 1.5);
    const count = Math.min(2 + this.state.wave, 7);
    const types = ['knight', 'archer', 'priest'];
    for (let i = 0; i < count; i++) this.entities.spawnHero?.(types[i % types.length]);
    this.ui.pushEvent(`Invasion wave ${this.state.wave} breaches the tunnels`, { tone: 'danger' });
    this.audio.play?.('portal');
  }

  _tickHeartCombat(dt) {
    const heart = this.world.getHeartPosition();
    const attackers = this._entities('heroes').filter((entity) => {
      const position = entityPosition(entity);
      return entity.hp > 0 && entity.state !== 'death' && position
        && Math.hypot(position.x - heart.x, position.z - heart.z) <= 1.55;
    });
    if (!attackers.length) return;

    const damagePerSecond = attackers.reduce((total, entity) => total + Math.max(3, Number(entity.damage) || 8) * 0.42, 0);
    this.state.heartHp = Math.max(0, this.state.heartHp - damagePerSecond * dt);
    if (this.state.elapsed - this._lastHeartHitFx >= 0.5) {
      this._lastHeartHitFx = this.state.elapsed;
      this.effects.hit?.({ x: heart.x, y: 0.65, z: heart.z }, { color: 0xff365c, scale: 0.8, shake: true });
      this.audio.play?.('hit', heart);
    }
    if (this.state.heartHp <= 0) this._endGame(false);
  }

  _endGame(victory) {
    if (this.state.gameOver) return;
    this.state.gameOver = {
      victory: Boolean(victory),
      stats: {
        'Waves survived': this.state.wave,
        'Dungeon age': `${Math.floor(this.state.elapsed)}s`,
        'Creatures commanded': this._entities('creatures').length,
        'Territory claimed': this.world.stats?.().tiles?.claimed || 0,
      },
    };
    this.state.paused = true;
    this.input?.setEnabled(false);
    this.ui?.showGameOver(this.state.gameOver);
  }

  _entities(kind) {
    const direct = this.entities?.[kind];
    if (Array.isArray(direct)) return direct;
    const listed = maybeCall(this.entities, ['list', 'getEntities'], kind);
    return asArray(listed);
  }

  _unitView(entity, hostile = false) {
    const data = entity?.metadata || entity?.data || entity || {};
    const hp = data.hp ?? entity?.hp ?? 1;
    const maxHp = data.maxHp ?? entity?.maxHp ?? hp;
    const position = entityPosition(entity);
    const heart = this.world.getHeartPosition();
    return {
      id: data.id ?? entity?.id,
      name: data.name || data.type || data.species || (hostile ? 'Invader' : 'Creature'),
      type: data.type || data.species,
      level: data.level || 1,
      hp,
      maxHp,
      status: data.state || data.status || (hostile ? 'Advancing' : 'Idle'),
      distance: position ? Math.hypot(position.x - heart.x, position.z - heart.z) : null,
      icon: hostile ? '⚔' : data.type === 'imp' ? '♦' : '♟',
    };
  }

  _selectionView(selection) {
    if (!selection) return null;
    if (selection.defense) {
      const defense = selection.defense;
      const isDoor = defense.category === 'door';
      return {
        id: defense.id,
        kicker: isDoor ? 'Dungeon door' : 'Workshop trap',
        title: defense.name || defense.kind,
        detail: isDoor
          ? `${defense.locked ? 'Locked' : 'Automatic'} · ${Math.ceil(defense.hp)} integrity`
          : `${defense.armed ? 'Armed' : defense.reloading ? 'Reloading' : 'Unarmed'} · ${defense.charges}/${defense.maxCharges} charges`,
        health: defense.hp,
        maxHealth: defense.maxHp,
        icon: isDoor ? '▣' : '▲',
        actions: isDoor
          ? [
            { id: defense.locked ? 'unlock-door' : 'lock-door', label: defense.locked ? 'Unlock' : 'Lock', icon: defense.locked ? '◇' : '◆' },
            { id: 'repair-door', label: 'Repair', icon: '⚒' },
            { id: 'sell-defense', label: 'Sell', icon: '¤' },
          ]
          : [
            { id: defense.armed ? 'disarm-trap' : 'arm-trap', label: defense.armed ? 'Disarm' : 'Arm', icon: defense.armed ? '◇' : '◆' },
            { id: 'reload-trap', label: 'Reload', icon: '⚙' },
            { id: 'sell-defense', label: 'Sell', icon: '¤' },
          ],
      };
    }
    if (selection.entity) {
      const selected = selection.entity;
      return {
        id: selected.id,
        kicker: selected.type || 'Creature',
        title: selected.name || selected.type || 'Selected creature',
        detail: selected.state || 'Awaiting orders',
        health: selected.hp,
        maxHealth: selected.maxHp,
        icon: selected.type === 'imp' ? '♦' : '♟',
      };
    }
    return null;
  }

  _modeStates() {
    if (!this.magic) return [];
    return Object.values(this.magic.spellbook()).map((spell) => ({
      id: spell.id,
      cost: this.magic.getCost(spell.id),
      disabled: !spell.unlocked,
    }));
  }

  snapshot(forceMinimap = false) {
    const imps = this._entities('imps');
    const creatures = this._entities('creatures');
    const heroes = this._entities('heroes');
    const nextIn = Math.max(0, this.state.nextWaveAt - this.state.elapsed);
    const performance = this.runtime.performance.snapshot();
    const selection = this.input?.selection || null;

    if (forceMinimap || this.state.elapsed - this.lastMinimapUpdate >= 0.6) {
      this.lastMinimapUpdate = this.state.elapsed;
      this.minimap = maybeCall(this.world, ['getMinimap', 'minimapSnapshot']);
    }

    return {
      version: VERSION,
      paused: this.state.paused,
      mode: this.state.mode,
      modes: this._modeStates(),
      resources: {
        gold: this.state.gold,
        mana: this.state.mana,
        manaMax: this.state.manaMax,
        work: this.state.work,
        imps: imps.length,
        creatures: creatures.length,
      },
      heart: { hp: this.state.heartHp, maxHp: this.state.heartMaxHp },
      invasion: { number: this.state.wave, nextIn, active: heroes.length > 0 },
      roster: [...imps, ...creatures].slice(0, 24).map((entity) => this._unitView(entity, false)),
      threats: heroes.slice(0, 16).map((entity) => this._unitView(entity, true)),
      context: this._selectionView(selection),
      defenses: this.defenses?.snapshot?.(),
      magic: this.magic?.snapshot?.(),
      performance: { ...performance, quality: this.runtime.quality.name },
      minimap: this.minimap,
    };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this.runtime?.camera && (this._shakeOffset.alpha || this._shakeOffset.beta)) {
      this.runtime.camera.alpha -= this._shakeOffset.alpha;
      this.runtime.camera.beta -= this._shakeOffset.beta;
      this._shakeOffset.alpha = 0;
      this._shakeOffset.beta = 0;
    }
    if (this.runtime) this.runtime.onWorldEvent = null;
    this.input?.dispose();
    this.ui?.dispose();
    this.magic?.dispose?.();
    this.defenses?.dispose?.();
    this.entities?.dispose?.();
    this.effects?.dispose();
    this.audio?.dispose?.();
    this.world?.dispose?.();
    this.runtime?.events?.clear?.();
    this.runtime?.dispose();
    if (window.__DUNGEON_HEART__ === this) delete window.__DUNGEON_HEART__;
  }
}

function showBootError(error) {
  console.error(error);
  const boot = document.getElementById('boot-status');
  if (boot) {
    boot.classList.add('is-error');
    boot.innerHTML = `<strong>The dungeon could not awaken.</strong><span>${String(error?.message || error)}</span>`;
  }
}

const app = new BabylonGameApp();
app.boot().catch(showBootError);

export { BabylonGameApp };
