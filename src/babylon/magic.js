// ============================================================
// BABYLON MAGIC DIRECTOR
// ============================================================
// A data-driven, DK2-inspired spellbook. All casts validate before charging,
// use simulation-time cooldowns and refund mana when an execution hook fails.
// Creature modifiers share one status container with defenses, preventing
// overlapping haste/fear/chicken effects from corrupting base statistics.

const B = window.BABYLON;

export const SPELL_DEFINITIONS = Object.freeze({
  createImp: Object.freeze({ name: 'Create Imp', mana: 55, cooldown: 2.5, research: 0, requires: [], target: 'tile' }),
  possess: Object.freeze({ name: 'Possession', mana: 20, cooldown: 5, research: 0, requires: [], target: 'friendly' }),
  heal: Object.freeze({ name: 'Heal', mana: 35, cooldown: 3.5, research: 0, requires: ['createImp'], target: 'friendly' }),
  lightning: Object.freeze({ name: 'Lightning', mana: 55, cooldown: 5, research: 0, requires: ['heal'], target: 'tile' }),
  rally: Object.freeze({ name: 'Call to Arms', mana: 45, cooldown: 7, research: 0, requires: ['createImp'], target: 'tile' }),
  haste: Object.freeze({ name: 'Speed Monster', mana: 40, cooldown: 5, research: 0, requires: ['heal'], target: 'friendly' }),
  sight: Object.freeze({ name: 'Sight of Evil', mana: 30, cooldown: 8, research: 0, requires: ['createImp'], target: 'tile' }),
  protect: Object.freeze({ name: 'Protect Creature', mana: 50, cooldown: 7, research: 160, requires: ['heal'], target: 'friendly' }),
  conceal: Object.freeze({ name: 'Conceal Creature', mana: 45, cooldown: 8, research: 185, requires: ['sight'], target: 'friendly' }),
  chicken: Object.freeze({ name: 'Turn to Chicken', mana: 65, cooldown: 10, research: 230, requires: ['lightning'], target: 'hostile' }),
  tremor: Object.freeze({ name: 'Tremor', mana: 100, cooldown: 16, research: 270, requires: ['rally', 'lightning'], target: 'tile' }),
  createGold: Object.freeze({ name: 'Create Gold', mana: 95, cooldown: 14, research: 310, requires: ['tremor'], target: 'tile' }),
  inferno: Object.freeze({ name: 'Inferno', mana: 120, cooldown: 20, research: 340, requires: ['tremor'], target: 'tile' }),
  turncoat: Object.freeze({ name: 'Turncoat', mana: 125, cooldown: 22, research: 380, requires: ['conceal', 'chicken'], target: 'hostile' }),
});

const SPELL_ALIASES = Object.freeze({
  summon: 'createImp', summonImp: 'createImp', create_imp: 'createImp',
  possession: 'possess', callToArms: 'rally', call_to_arms: 'rally', cta: 'rally',
  speed: 'haste', speedMonster: 'haste', sightOfEvil: 'sight', sight_of_evil: 'sight',
  protectCreature: 'protect', concealCreature: 'conceal', turnToChicken: 'chicken',
  earthquake: 'tremor', makeGold: 'createGold', firestorm: 'inferno', convert: 'turncoat',
});

const DEFAULT_UNLOCKED = Object.freeze(['createImp', 'possess', 'heal', 'lightning', 'rally', 'haste', 'sight']);

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function canonical(name) { return SPELL_ALIASES[name] || name; }
function colorNumber(value) {
  if (typeof value === 'number') return value;
  return typeof value === 'string' && value.startsWith('#') ? Number.parseInt(value.slice(1), 16) : 0xffffff;
}
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

function activeBonusHp(data) {
  return Object.values(data.dkStatuses).reduce((sum, status) => sum + (status?.remaining > 0 ? status.bonusHp || 0 : 0), 0);
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

export class MagicDirector {
  constructor(runtime, world, entities, effects = null, audio = null) {
    if (!B) throw new Error('MagicDirector requires window.BABYLON.');
    this.runtime = runtime || {};
    this.world = world;
    this.entities = entities;
    this.effects = effects;
    this.audio = audio;
    this.cooldowns = Object.fromEntries(Object.keys(SPELL_DEFINITIONS).map((name) => [name, 0]));
    this.unlocked = new Set((this.runtime.initialSpells || DEFAULT_UNLOCKED).map(canonical));
    this.researchProgress = Object.create(null);
    this.researchTarget = null;
    this._internalMana = Number(this.runtime.initialMana ?? 500);
    this.maxMana = Number(this.runtime.maxMana ?? this.runtime.state?.manaMax ?? 1000);
    this._internalResearch = Number(this.runtime.initialResearch ?? 0);
    this._time = 0;
    this._infernos = [];
    this.possessed = null;
    this.lastError = '';
    this._disposed = false;
  }

  // ------------------------------------------------------------
  // Spellbook, research and resources
  // ------------------------------------------------------------

  spellbook() {
    return Object.fromEntries(Object.entries(SPELL_DEFINITIONS).map(([id, def]) => [id, {
      id, ...def, unlocked: this.isUnlocked(id), cooldownRemaining: this.cooldowns[id],
      progress: Number(this.researchProgress[id] || 0), ready: this.isReady(id),
    }]));
  }

  getResearchTree() { return this.spellbook(); }
  isUnlocked(name) { return this.unlocked.has(canonical(name)); }
  spellResearched(name) { return this.isUnlocked(name); }
  getMana() {
    const value = this.runtime.economy?.get?.('mana');
    return Number.isFinite(value) ? value : this._internalMana;
  }
  setMana(amount) {
    const next = clamp(Number(amount) || 0, 0, this.maxMana);
    const current = this.getMana();
    if (next > current) this._refundMana(next - current);
    else if (next < current) this._spendMana(current - next);
    return this.getMana();
  }
  addMana(amount) {
    amount = Math.max(0, Number(amount) || 0);
    if (this.runtime.economy?.add) this.runtime.economy.add('mana', amount);
    else this._internalMana = Math.min(this.maxMana, this._internalMana + amount);
    return this.getMana();
  }
  getResearch() {
    const value = this._economySupports('research') ? this.runtime.economy.get('research') : NaN;
    return Number.isFinite(value) ? value : this._internalResearch;
  }
  addResearchResource(amount) {
    amount = Math.max(0, Number(amount) || 0);
    if (this._economySupports('research') && this.runtime.economy?.add) this.runtime.economy.add('research', amount);
    else this._internalResearch += amount;
    return this.getResearch();
  }

  getCost(name) {
    name = canonical(name);
    const def = SPELL_DEFINITIONS[name];
    if (!def) return Infinity;
    if (name !== 'createImp') return def.mana;
    const count = this._entities('dungeon').filter((entity) => entity.type === 'imp' && entity.hp > 0).length;
    return def.mana + Math.min(180, Math.max(0, count - 3) * 18);
  }

  getCooldown(name) { return Math.max(0, Number(this.cooldowns[canonical(name)]) || 0); }
  cooldownProgress(name) {
    name = canonical(name);
    const def = SPELL_DEFINITIONS[name];
    return def ? 1 - clamp(this.getCooldown(name) / Math.max(0.01, def.cooldown), 0, 1) : 0;
  }
  isReady(name) {
    name = canonical(name);
    return this.isUnlocked(name) && this.getCooldown(name) <= 0 && this._canAffordMana(this.getCost(name));
  }
  spellReady(name) { return this.isReady(name); }

  canResearch(name) {
    name = canonical(name);
    const def = SPELL_DEFINITIONS[name];
    if (!def) return { ok: false, reason: `Unknown spell: ${name}` };
    if (this.isUnlocked(name)) return { ok: false, reason: 'Already researched' };
    const missing = def.requires.filter((requirement) => !this.isUnlocked(requirement));
    return missing.length ? { ok: false, reason: `Requires ${missing.map((id) => SPELL_DEFINITIONS[id].name).join(' and ')}`, missing } : { ok: true, cost: def.research };
  }

  beginResearch(name) {
    name = canonical(name);
    const check = this.canResearch(name);
    if (!check.ok) return this._fail(check.reason);
    this.researchTarget = name;
    this.researchProgress[name] ||= 0;
    this.runtime.events?.emit?.('researchStarted', { spell: name, definition: SPELL_DEFINITIONS[name] });
    return true;
  }
  selectResearch(name) { return this.beginResearch(name); }
  setResearchTarget(name) { return this.beginResearch(name); }

  addResearch(points) {
    if (!this.researchTarget) return false;
    const name = this.researchTarget;
    const def = SPELL_DEFINITIONS[name];
    this.researchProgress[name] = Math.max(0, Number(this.researchProgress[name] || 0) + Math.max(0, Number(points) || 0));
    if (this.researchProgress[name] < def.research) return this.researchProgress[name];
    this.unlock(name);
    this.researchTarget = null;
    return true;
  }

  researchSpell(name, options = {}) {
    name = canonical(name);
    const check = this.canResearch(name);
    if (!check.ok) return this._fail(check.reason);
    if (!options.free && !this._spendResearch(check.cost)) return this._fail(`Need ${check.cost} research`);
    return this.unlock(name, options);
  }

  unlock(name, options = {}) {
    name = canonical(name);
    if (!SPELL_DEFINITIONS[name]) return false;
    if (!options.ignoreRequirements) {
      const missing = SPELL_DEFINITIONS[name].requires.filter((requirement) => !this.isUnlocked(requirement));
      if (missing.length) return this._fail(`Missing prerequisite: ${missing.join(', ')}`);
    }
    this.unlocked.add(name);
    this.researchProgress[name] = SPELL_DEFINITIONS[name].research;
    this.runtime.events?.emit?.('spellUnlocked', { spell: name, definition: SPELL_DEFINITIONS[name] });
    this._sound('ui_accept');
    return true;
  }

  // ------------------------------------------------------------
  // Compatibility spell API
  // ------------------------------------------------------------

  cast(name, target, z = undefined) {
    name = canonical(name);
    switch (name) {
      case 'createImp': return this.castCreateImp(target, z);
      case 'possess': return this.castPossess(target);
      case 'heal': return this.castHeal(target);
      case 'lightning': return this.castLightning(target, z);
      case 'rally': return this.castRally(target, z);
      case 'haste': return this.castHaste(target);
      case 'sight': return this.castSight(target, z);
      case 'protect': return this.castProtect(target);
      case 'conceal': return this.castConceal(target);
      case 'chicken': return this.castChicken(target);
      case 'tremor': return this.castTremor(target, z);
      case 'createGold': return this.castCreateGold(target, z);
      case 'inferno': return this.castInferno(target, z);
      case 'turncoat': return this.castTurncoat(target);
      default: return this._fail(`Unknown spell: ${name}`);
    }
  }
  castSpell(name, target, z = undefined) { return this.cast(name, target, z); }

  castCreateImp(target, z = undefined) {
    const point = this._point(target, z);
    const cell = this.world?.getCell?.(point.x, point.z);
    if (!cell || !this.world?.isWalkable?.(point.x, point.z)) return this._fail('Create Imp needs a walkable tile');
    if (!cell.discovered || (!cell.room && !['claimed', 'heart'].includes(cell.type))) return this._fail('Create Imp needs owned dungeon ground');
    return this._commit('createImp', point, () => {
      const imp = this.entities?.spawnImp?.(point.x, point.z) || this.entities?.summonImp?.(point.x, point.z) || this.entities?.spawn?.('imp', point.x, point.z);
      if (!imp) return false;
      this._sound('spawn', point);
      return true;
    });
  }
  castSummon(target, z = undefined) { return this.castCreateImp(target, z); }
  castSummonImp(target, z = undefined) { return this.castCreateImp(target, z); }

  castHeal(target) {
    const entity = this._entity(target);
    if (!this._friendly(entity)) return this._fail('Heal needs one of your living creatures');
    if (entity.hp >= entity.maxHp) return this._fail('Target is already at full health');
    return this._commit('heal', entity, () => {
      const restored = Math.max(28, Math.round(entity.maxHp * 0.36));
      if (this.entities?.heal?.(entity, restored) === false) return false;
      this._sound('heal', entity.root.position);
      return true;
    });
  }

  castLightning(target, z = undefined) {
    const point = this._point(target, z);
    if (!this._validPoint(point, true)) return this._fail('Lightning needs a revealed dungeon tile');
    return this._commit('lightning', point, () => {
      const victims = this._entities().filter((entity) => entity.faction !== 'dungeon' && distance2(entity.root.position, point) <= 1.65 ** 2);
      for (const entity of victims) this._damage(entity, 48, point);
      const from = new B.Vector3(point.x, 8.5, point.z);
      this.effects?.lightning?.(from, point, { color: 0xb9e8ff, secondaryColor: 0x538dff, width: 1.2, duration: 0.23, shake: 0.48 });
      this._effect('burst', point, 0xc8edff, 1.35);
      this._sound('lightning', point);
      return true;
    });
  }

  castRally(target, z = undefined) {
    const point = this._point(target, z);
    if (!this._validPoint(point, true) || !this.world?.isWalkable?.(point.x, point.z)) return this._fail('Call to Arms needs walkable revealed ground');
    return this._commit('rally', point, () => {
      if (this.entities?.setRally?.(point.x, point.z, 12) === false) return false;
      this._sound('rally', point);
      return true;
    });
  }
  castCallToArms(target, z = undefined) { return this.castRally(target, z); }

  castHaste(target) {
    const entity = this._entity(target);
    if (!this._friendly(entity)) return this._fail('Speed Monster needs one of your creatures');
    return this._commit('haste', entity, () => {
      this._applyStatus(entity, 'haste', { duration: 15, speedMultiplier: 1.55, damageMultiplier: 1.22 });
      this._effect('rally', entity.root.position, 0xffd64c, 0.76);
      this._sound('heal', entity.root.position);
      return true;
    });
  }

  castSight(target, z = undefined) {
    const point = this._point(target, z);
    if (!this._validPoint(point, false)) return this._fail('Sight of Evil needs a dungeon tile');
    return this._commit('sight', point, () => {
      this.world?.reveal?.(point.x, point.z, 6);
      this._effect('rally', point, 0xa881ff, 1.4);
      return true;
    });
  }
  castSightOfEvil(target, z = undefined) { return this.castSight(target, z); }

  castProtect(target) {
    const entity = this._entity(target);
    if (!this._friendly(entity)) return this._fail('Protect needs one of your creatures');
    return this._commit('protect', entity, () => {
      this._applyStatus(entity, 'protect', { duration: 18, bonusHp: 70 });
      this._effect('healing', entity.root.position, 0x72c9ff, 1.05);
      return true;
    });
  }

  castConceal(target) {
    const entity = this._entity(target);
    if (!this._friendly(entity)) return this._fail('Conceal needs one of your creatures');
    return this._commit('conceal', entity, () => {
      this._applyStatus(entity, 'conceal', { duration: 13, hidden: true, speedMultiplier: 0.92 });
      for (const enemy of this._entities()) if (enemy.target === entity) enemy.target = null;
      this._effect('burst', entity.root.position, 0x8a65c7, 0.92);
      return true;
    });
  }

  castChicken(target) {
    const entity = this._entity(target);
    if (!this._hostile(entity)) return this._fail('Turn to Chicken needs a hostile creature');
    return this._commit('chicken', entity, () => {
      this._applyStatus(entity, 'chicken', { duration: 12, scaleMultiplier: 0.55, speedMultiplier: 0.78, damageMultiplier: 0.14 });
      entity.target = null;
      this.entities?.setState?.(entity, 'flee');
      this._effect('spawn', entity.root.position, 0xfff0a1, 1.0);
      return true;
    });
  }

  castTremor(target, z = undefined) {
    const point = this._point(target, z);
    if (!this._validPoint(point, true)) return this._fail('Tremor needs a revealed dungeon tile');
    return this._commit('tremor', point, () => {
      for (const entity of this._entities()) {
        if (entity.faction !== 'dungeon' && distance2(entity.root.position, point) <= 4.4 ** 2) this._damage(entity, 46, point);
      }
      for (const defense of this.runtime.defenses?.list?.() || []) {
        if (distance2(defense, point) > 3.6 ** 2) continue;
        if (defense.category === 'door') this.runtime.defenses.damageDoor?.(defense, 24);
        else this.runtime.defenses.damageTrap?.(defense, 24);
      }
      for (let ring = 1; ring <= 4; ring++) this._effect('hit', { x: point.x + Math.cos(ring * 2.2) * ring * 0.55, y: 0.1, z: point.z + Math.sin(ring * 2.2) * ring * 0.55 }, 0xc49b6b, 0.75);
      this.effects?.shake?.(0.75, 0.85, { frequency: 28 });
      this._sound('hit_metal', point);
      return true;
    });
  }

  castCreateGold(target, z = undefined) {
    const point = this._point(target, z);
    const cell = this.world?.getCell?.(point.x, point.z);
    if (!cell || !cell.discovered || !this.world?.isWalkable?.(point.x, point.z)) return this._fail('Create Gold needs revealed walkable ground');
    return this._commit('createGold', point, () => {
      const economy = this.runtime.economy;
      if (economy?.add) economy.add('gold', 325);
      else this.runtime.gold = Math.max(0, Number(this.runtime.gold) || 0) + 325;
      this._effect('spawn', point, 0xffd34f, 1.25);
      this._sound('claim', point);
      return true;
    });
  }

  castInferno(target, z = undefined) {
    const point = this._point(target, z);
    if (!this._validPoint(point, true)) return this._fail('Inferno needs a revealed dungeon tile');
    return this._commit('inferno', point, () => {
      this._infernos.push({ x: point.x, z: point.z, radius: 3.1, remaining: 6.2, tick: 0, owner: 'dungeon' });
      this._effect('burst', point, 0xff5a24, 1.75);
      this.effects?.shake?.(0.34, 0.42);
      this._sound('lightning', point);
      return true;
    });
  }

  castTurncoat(target) {
    const entity = this._entity(target);
    if (!this._hostile(entity)) return this._fail('Turncoat needs a hostile creature');
    return this._commit('turncoat', entity, () => {
      this._applyStatus(entity, 'turncoat', { duration: 16, faction: 'dungeon', damageMultiplier: 1.08 });
      entity.target = null;
      entity.destination = null;
      if (entity.path) entity.path.length = 0;
      this.entities?.setState?.(entity, 'idle');
      this._effect('rally', entity.root.position, 0xe151ff, 1.2);
      return true;
    });
  }

  // Possession remains useful even before a first-person camera is installed:
  // it disables AI and exposes commandPossessed for direct click-to-move.
  castPossess(target) {
    const entity = this._entity(target);
    if (!this._friendly(entity)) return this._fail('Possession needs one of your creatures');
    if (!this.isReady('possess')) return this._fail(this._readinessReason('possess'));
    const cost = this.getCost('possess');
    if (!this._spendMana(cost)) return this._fail(`Need ${cost} mana`);
    try {
      this.releasePossession();
      const external = this.runtime.beginPossession?.(entity);
      if (external === false) throw new Error('Possession camera refused the target');
      const finish = (result) => {
        if (result === false) {
          this._refundMana(cost);
          return this._fail('Possession failed');
        }
        this.possessed = entity;
        entity.userData ||= {};
        entity.userData.possessed = true;
        entity.userData.wasAutonomous = entity.autonomous;
        entity.autonomous = false;
        this.cooldowns.possess = SPELL_DEFINITIONS.possess.cooldown;
        this.runtime.possession = { entity, director: this };
        this.runtime.events?.emit?.('spellCast', { spell: 'possess', target: entity, cost });
        return true;
      };
      return external?.then ? Promise.resolve(external).then(finish).catch((error) => {
        this._refundMana(cost); console.warn('[MagicDirector] Possession hook failed.', error); return this._fail('Possession failed');
      }) : finish(external);
    } catch (error) {
      this._refundMana(cost);
      return this._fail(error.message || 'Possession failed');
    }
  }

  releasePossession() {
    const entity = this.possessed;
    if (!entity) return false;
    this.runtime.endPossession?.(entity);
    entity.autonomous = entity.userData?.wasAutonomous !== false;
    if (entity.userData) { delete entity.userData.possessed; delete entity.userData.wasAutonomous; }
    if (this.runtime.possession?.entity === entity) this.runtime.possession = null;
    this.possessed = null;
    return true;
  }

  commandPossessed(destination) {
    if (!this.possessed || this.possessed.hp <= 0) return false;
    return this.entities?.moveTo?.(this.possessed, destination, { state: 'walk' }) ?? false;
  }

  // ------------------------------------------------------------
  // Simulation and snapshot
  // ------------------------------------------------------------

  update(dt, time = undefined) {
    if (this._disposed) return;
    const step = clamp(Number(dt) || 0, 0, 0.1);
    this._time = Number.isFinite(time) ? time : this._time + step;
    for (const name of Object.keys(this.cooldowns)) this.cooldowns[name] = Math.max(0, this.cooldowns[name] - step);
    if (!this.runtime.economy && step > 0) this._internalMana = Math.min(this.maxMana, this._internalMana + step * 3.5);
    const living = this._entities();
    this._updateStatuses(living, step);
    this._updateInfernos(living, step);
    if (this.possessed && (this.possessed.hp <= 0 || this.possessed.state === 'death')) this.releasePossession();
    for (const enemy of living) {
      if (enemy.target?.userData?.concealed) enemy.target = null;
    }
  }

  snapshot() {
    const activeStatuses = [];
    for (const entity of this._entities()) {
      for (const [name, status] of Object.entries(entity.userData?.dkStatuses || {})) {
        if (name.startsWith('magic:') && status.remaining > 0) activeStatuses.push({ entityId: entity.id, name: name.slice(6), remaining: status.remaining });
      }
    }
    return {
      mana: this.getMana(), maxMana: this.maxMana, research: this.getResearch(),
      unlocked: Array.from(this.unlocked), cooldowns: { ...this.cooldowns },
      researchTarget: this.researchTarget, researchProgress: { ...this.researchProgress },
      possessedId: this.possessed?.id || null, infernos: this._infernos.map(({ x, z, radius, remaining }) => ({ x, z, radius, remaining })),
      activeStatuses,
    };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.releasePossession();
    for (const entity of this._entities()) {
      const data = statusState(entity);
      for (const key of Object.keys(data.dkStatuses)) if (key.startsWith('magic:')) delete data.dkStatuses[key];
      recomputeStatusModifiers(entity);
    }
    this._infernos.length = 0;
  }

  // ------------------------------------------------------------
  // Internal execution and status helpers
  // ------------------------------------------------------------

  _commit(name, target, execute) {
    name = canonical(name);
    if (!this.isReady(name)) return this._fail(this._readinessReason(name));
    const cost = this.getCost(name);
    if (!this._spendMana(cost)) return this._fail(`Need ${cost} mana`);
    try {
      const result = execute();
      if (result === false) {
        this._refundMana(cost);
        return this._fail(`${SPELL_DEFINITIONS[name].name} failed`);
      }
      this.cooldowns[name] = SPELL_DEFINITIONS[name].cooldown;
      this.runtime.events?.emit?.('spellCast', { spell: name, target, cost });
      return result ?? true;
    } catch (error) {
      this._refundMana(cost);
      console.warn(`[MagicDirector] ${name} failed.`, error);
      return this._fail(`${SPELL_DEFINITIONS[name].name} failed`);
    }
  }

  _readinessReason(name) {
    name = canonical(name);
    if (!SPELL_DEFINITIONS[name]) return `Unknown spell: ${name}`;
    if (!this.isUnlocked(name)) return `${SPELL_DEFINITIONS[name].name} has not been researched`;
    if (this.getCooldown(name) > 0) return `${SPELL_DEFINITIONS[name].name} is recharging`;
    return `Need ${this.getCost(name)} mana`;
  }

  _applyStatus(entity, name, options) {
    const data = statusState(entity);
    const key = `magic:${name}`;
    const beforeBonus = activeBonusHp(data);
    data.dkStatuses[key] = { source: 'magic', remaining: options.duration, ...options };
    const addedBonus = Math.max(0, activeBonusHp(data) - beforeBonus);
    if (addedBonus) entity.hp += addedBonus;
    recomputeStatusModifiers(entity);
  }

  _updateStatuses(living, dt) {
    for (const entity of living) {
      const data = statusState(entity);
      let changed = false;
      for (const [key, status] of Object.entries(data.dkStatuses)) {
        if (!key.startsWith('magic:')) continue;
        status.remaining -= dt;
        if (status.remaining <= 0) {
          if (key === 'magic:turncoat') { entity.target = null; entity.destination = null; if (entity.path) entity.path.length = 0; }
          delete data.dkStatuses[key];
          changed = true;
        }
      }
      if (changed) recomputeStatusModifiers(entity);
    }
  }

  _updateInfernos(living, dt) {
    for (let i = this._infernos.length - 1; i >= 0; i--) {
      const zone = this._infernos[i];
      zone.remaining -= dt;
      zone.tick -= dt;
      if (zone.tick <= 0) {
        zone.tick = 0.55;
        for (const entity of living) {
          if (entity.faction !== zone.owner && distance2(entity.root.position, zone) <= zone.radius ** 2) this._damage(entity, 12, zone);
        }
        for (let spark = 0; spark < 3; spark++) {
          const angle = this._time * 2.7 + spark * 2.094;
          this._effect('burst', { x: zone.x + Math.cos(angle) * zone.radius * 0.55, y: 0.25, z: zone.z + Math.sin(angle) * zone.radius * 0.55 }, 0xff5726, 0.8);
        }
      }
      if (zone.remaining <= 0) this._infernos.splice(i, 1);
    }
  }

  _point(value, z = undefined) {
    if (typeof value === 'number') return new B.Vector3(value, 0, Number(z) || 0);
    if (value instanceof B.Vector3) return value.clone();
    if (value?.root?.position) return value.root.position.clone();
    if (value?.position) return this._point(value.position);
    if (value?.cell) return this._point(value.cell);
    return new B.Vector3(Number(value?.x) || 0, Number(value?.y) || 0, Number(value?.z) || 0);
  }

  _entity(value) {
    if (!value) return null;
    if (value.root && value.id) return value;
    if (typeof value === 'string' || typeof value === 'number') return this.entities?.get?.(value) || this.entities?.getById?.(value) || null;
    return this.entities?.fromPick?.(value) || value.metadata?.entity || value.parent?.metadata?.entity || null;
  }
  _friendly(entity) { return Boolean(entity && entity.faction === 'dungeon' && entity.hp > 0 && entity.state !== 'death'); }
  _hostile(entity) { return Boolean(entity && entity.faction !== 'dungeon' && entity.hp > 0 && entity.state !== 'death'); }
  _entities(faction = null) {
    const values = this.entities?.getAll?.(faction) || this.entities?.list?.(faction) || [];
    return values.filter((entity) => entity?.root && entity.hp > 0 && entity.state !== 'death');
  }
  _validPoint(point, mustBeDiscovered) {
    const cell = this.world?.getCell?.(point.x, point.z);
    return Boolean(cell && (!mustBeDiscovered || cell.discovered));
  }
  _damage(entity, amount, source) {
    const reduction = Object.values(entity.userData?.dkStatuses || {}).reduce((value, status) => status?.remaining > 0 ? value * (status.damageTakenMultiplier ?? 1) : value, 1);
    return this.entities?.takeDamage?.(entity, Math.max(1, amount * reduction), source) ?? false;
  }

  _canAffordMana(amount) {
    if (this.runtime.economy?.canAfford) return this.runtime.economy.canAfford('mana', amount) !== false;
    return this.getMana() >= amount;
  }
  _spendMana(amount) {
    if (!this._canAffordMana(amount)) return false;
    if (this.runtime.economy?.spend) return this.runtime.economy.spend('mana', amount) !== false;
    this._internalMana -= amount;
    return true;
  }
  _refundMana(amount) {
    if (this.runtime.economy?.add) this.runtime.economy.add('mana', amount);
    else this._internalMana = Math.min(this.maxMana, this._internalMana + amount);
  }
  _spendResearch(amount) {
    const economy = this.runtime.economy;
    if (this._economySupports('research')) {
      if (economy.canAfford?.('research', amount) === false) return false;
      return economy.spend?.('research', amount) !== false;
    }
    if (this._internalResearch < amount) return false;
    this._internalResearch -= amount;
    return true;
  }
  _economySupports(resource) {
    const snapshot = this.runtime.economy?.snapshot?.();
    return Boolean(snapshot && Object.prototype.hasOwnProperty.call(snapshot, resource));
  }
  _fail(reason) {
    this.lastError = String(reason || 'Spell failed');
    this._sound('ui_cancel');
    this.runtime.events?.emit?.('spellFailed', { reason: this.lastError });
    return false;
  }
  _sound(name, position = null) { this.audio?.play?.(name, position) || this.audio?.playSfx?.(name, { position }); }
  _effect(kind, position, color, scale) {
    if (!this.effects) return;
    const method = kind === 'burst' ? 'burst' : kind;
    try {
      if (typeof this.effects[method] === 'function') this.effects[method](position, { color: colorNumber(color), scale });
      else this.effects.burst?.(position, { kind, color: colorNumber(color), scale });
    } catch (_) { /* VFX is deliberately non-authoritative. */ }
  }
}
