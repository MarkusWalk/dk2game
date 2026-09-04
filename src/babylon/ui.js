// ============================================================
// BABYLON CLIENT UI
// ============================================================
// A self-contained, DOM-driven interface for the Babylon renderer. The game
// simulation owns the data; this class only renders snapshots and emits user
// intent through callbacks. All markup lives below #ui-root and all styling is
// scoped below #babylon-app so the frozen Three.js client remains untouched.

const DEFAULT_MODES = [
  { id: 'dig',       label: 'Excavate',       icon: '⛏', shortcut: '1', group: 'orders',   hint: 'Mark earth and gold for excavation' },
  { id: 'claim',     label: 'Claim',          icon: '◆', shortcut: '2', group: 'orders',   hint: 'Claim open ground for your dungeon' },
  { id: 'hand',      label: 'Hand of Evil',   icon: '✦', shortcut: '8', group: 'orders',   hint: 'Pick up and drop loyal creatures' },
  { id: 'sell',      label: 'Sell',            icon: '¤', shortcut: null, group: 'orders',   hint: 'Sell a room, door, or trap' },
  { id: 'treasury',  label: 'Treasury',        icon: '◈', shortcut: '3', group: 'rooms',    hint: 'Secure chambers that store gold', cost: 50 },
  { id: 'lair',      label: 'Lair',            icon: '◒', shortcut: '4', group: 'rooms',    hint: 'Resting quarters for your creatures', cost: 75 },
  { id: 'hatchery',  label: 'Hatchery',        icon: '◉', shortcut: '5', group: 'rooms',    hint: 'Grow food for hungry creatures', cost: 85 },
  { id: 'training',  label: 'Training Room',   icon: '⚔', shortcut: '6', group: 'rooms',    hint: 'Train creatures for battle', cost: 120 },
  { id: 'library',   label: 'Library',         icon: '☰', shortcut: '7', group: 'rooms',    hint: 'Research arcane powers', cost: 150 },
  { id: 'workshop',  label: 'Workshop',        icon: '⚙', shortcut: null, group: 'rooms',    hint: 'Manufacture traps and doors', cost: 175 },
  { id: 'woodDoor',  label: 'Ironwood Door',   icon: '▫', shortcut: null, group: 'defenses', hint: 'Cheap automatic corridor gate', cost: 10, resource: 'work' },
  { id: 'bracedDoor', label: 'Braced Door',    icon: '▤', shortcut: null, group: 'defenses', hint: 'A reinforced mid-tier gate', cost: 18, resource: 'work' },
  { id: 'steelDoor', label: 'Steel Door',      icon: '▣', shortcut: null, group: 'defenses', hint: 'A durable anti-melee barrier', cost: 30, resource: 'work' },
  { id: 'magicDoor', label: 'Magic Door',      icon: '◫', shortcut: null, group: 'defenses', hint: 'An arcane gate that punishes attackers', cost: 42, resource: 'work' },
  { id: 'spikeTrap', label: 'Spike Trap',      icon: '▲', shortcut: null, group: 'defenses', hint: 'Hidden pressure spikes that slow intruders', cost: 7, resource: 'work' },
  { id: 'sentryTrap', label: 'Sentry Trap',    icon: '⌾', shortcut: null, group: 'defenses', hint: 'A direct-fire corridor turret', cost: 16, resource: 'work' },
  { id: 'lightningTrap', label: 'Arc Trap',    icon: 'ϟ', shortcut: null, group: 'defenses', hint: 'Reusable area lightning trap', cost: 20, resource: 'work' },
  { id: 'fearTrap',  label: 'Fear Trap',       icon: '☠', shortcut: null, group: 'defenses', hint: 'Breaks an invasion and drives heroes back', cost: 14, resource: 'work' },
  { id: 'gasTrap',   label: 'Gas Trap',        icon: '♨', shortcut: null, group: 'defenses', hint: 'Lingering poison for tight passages', cost: 18, resource: 'work' },
  { id: 'boulderTrap', label: 'Boulder Trap',  icon: '●', shortcut: null, group: 'defenses', hint: 'A brutal one-charge rolling strike', cost: 28, resource: 'work' },
  { id: 'alarmTrap', label: 'Alarm Trap',      icon: '!', shortcut: null, group: 'defenses', hint: 'Reveals intruders and rallies defenders', cost: 10, resource: 'work' },
  { id: 'createImp', label: 'Create Imp',      icon: '♦', shortcut: 'I', group: 'spells',    hint: 'Summon a worker; each additional Imp costs more', cost: 55, resource: 'mana' },
  { id: 'possess',   label: 'Possession',      icon: '◉', shortcut: 'P', group: 'spells',    hint: 'Take direct command of a loyal creature', cost: 20, resource: 'mana' },
  { id: 'heal',      label: 'Heal',            icon: '✚', shortcut: '9', group: 'spells',    hint: 'Restore a loyal creature', cost: 35, resource: 'mana' },
  { id: 'lightning', label: 'Lightning',       icon: 'ϟ', shortcut: '0', group: 'spells',    hint: 'Strike revealed ground with arcane force', cost: 55, resource: 'mana' },
  { id: 'rally',     label: 'Call to Arms',    icon: '⚑', shortcut: '-', group: 'spells',    hint: 'Rally creatures to one location', cost: 45, resource: 'mana' },
  { id: 'haste',     label: 'Speed Monster',   icon: '»', shortcut: '=', group: 'spells',    hint: 'Quicken and embolden a loyal creature', cost: 40, resource: 'mana' },
  { id: 'sight',     label: 'Sight of Evil',   icon: '⊙', shortcut: null, group: 'spells',    hint: 'Reveal a section of the unknown dungeon', cost: 30, resource: 'mana' },
  { id: 'protect',   label: 'Protect',         icon: '⬡', shortcut: null, group: 'spells',    hint: 'Ward a creature with temporary vitality', cost: 50, resource: 'mana', disabled: true },
  { id: 'conceal',   label: 'Conceal',         icon: '◌', shortcut: null, group: 'spells',    hint: 'Hide a creature from hostile sight', cost: 45, resource: 'mana', disabled: true },
  { id: 'chicken',   label: 'Chicken',         icon: '♧', shortcut: null, group: 'spells',    hint: 'Briefly reduce an enemy to helpless prey', cost: 65, resource: 'mana', disabled: true },
  { id: 'tremor',    label: 'Tremor',          icon: '≋', shortcut: null, group: 'spells',    hint: 'Shake a defended area and break fortifications', cost: 100, resource: 'mana', disabled: true },
  { id: 'createGold', label: 'Create Gold',    icon: '◈', shortcut: null, group: 'spells',    hint: 'Convert scarce mana into emergency gold', cost: 95, resource: 'mana', disabled: true },
  { id: 'inferno',   label: 'Inferno',         icon: '♨', shortcut: null, group: 'spells',    hint: 'Create a short-lived zone of searing fire', cost: 120, resource: 'mana', disabled: true },
  { id: 'turncoat',  label: 'Turncoat',        icon: '⇄', shortcut: null, group: 'spells',    hint: 'Turn an enemy against its allies for a short time', cost: 125, resource: 'mana', disabled: true },
];

const GROUPS = [
  { id: 'orders', label: 'Orders' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'defenses', label: 'Defences' },
  { id: 'spells', label: 'Sorcery' },
];

const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function asNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function formatNumber(value) {
  const n = asNumber(value);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.floor(n).toLocaleString('en-US');
}

function formatTime(value) {
  const seconds = Math.max(0, Math.ceil(asNumber(value)));
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/**
 * Responsive HUD for the Babylon client.
 *
 * Callback signatures:
 *   start(kind)                    kind: "new" | "testing"
 *   pause(paused)
 *   modeChange(modeId)
 *   action(actionId, payload)
 *   qualityChange(quality)         low | medium | high | ultra
 */
export class DungeonUI {
  constructor(callbacks = {}) {
    this.callbacks = {
      start: callbacks.start || (() => {}),
      pause: callbacks.pause || (() => {}),
      modeChange: callbacks.modeChange || (() => {}),
      action: callbacks.action || (() => {}),
      qualityChange: callbacks.qualityChange || (() => {}),
    };
    this.mode = 'dig';
    this.group = 'orders';
    this.quality = 'high';
    this.modes = DEFAULT_MODES.map((mode) => ({ ...mode }));
    this.events = [];
    this.isPaused = false;
    this.disposed = false;
    this._unitSignatures = { threats: '', roster: '', context: '', modes: '' };

    const app = document.getElementById('babylon-app');
    this.root = document.getElementById('ui-root');
    if (!this.root && app) {
      this.root = makeElement('div');
      this.root.id = 'ui-root';
      app.appendChild(this.root);
    }
    if (!this.root) throw new Error('DungeonUI requires #ui-root inside #babylon-app');

    this.root.replaceChildren();
    this.root.classList.add('dungeon-ui-root');
    this._build();
    this._bind();
    this._renderModes();
    this.setMode(this.mode);
    this.showStart(true);
  }

  _build() {
    this.root.innerHTML = `
      <div class="dui" data-ui="shell">
        <div class="dui-vignette" aria-hidden="true"></div>
        <header class="dui-topbar" aria-label="Dungeon status">
          <section class="dui-heart" data-tooltip="The Dungeon Heart — defend it at all costs">
            <span class="dui-heart-gem" aria-hidden="true">♦</span>
            <span class="dui-heart-copy">
              <span class="dui-eyebrow">Dungeon Heart</span>
              <span class="dui-meter dui-meter--heart"><span data-ui="heart-fill"></span></span>
            </span>
            <strong data-ui="heart-value">500 / 500</strong>
          </section>

          <section class="dui-resources" aria-label="Resources">
            <div class="dui-resource dui-resource--gold" data-tooltip="Gold held in your treasuries">
              <span class="dui-resource-icon" aria-hidden="true">◈</span>
              <span><small>Gold</small><strong data-ui="gold">0</strong></span>
            </div>
            <div class="dui-resource dui-resource--mana" data-tooltip="Mana available for sorcery">
              <span class="dui-resource-icon" aria-hidden="true">✦</span>
              <span><small>Mana</small><strong><span data-ui="mana">0</span><em> / <span data-ui="mana-max">0</span></em></strong></span>
            </div>
            <div class="dui-resource dui-resource--work" data-tooltip="Manufacturing points for doors and traps">
              <span class="dui-resource-icon" aria-hidden="true">⚙</span>
              <span><small>Work</small><strong data-ui="work">0</strong></span>
            </div>
            <div class="dui-resource dui-resource--forces" data-tooltip="Workers and fighting creatures">
              <span class="dui-resource-icon" aria-hidden="true">♟</span>
              <span><small>Forces</small><strong><span data-ui="imps">0</span><em> + </em><span data-ui="creatures">0</span></strong></span>
            </div>
          </section>

          <section class="dui-system-controls">
            <div class="dui-wave" data-tooltip="Current invasion wave">
              <small>Invasion</small>
              <strong>Wave <span data-ui="wave">0</span></strong>
              <span data-ui="wave-time">—</span>
            </div>
            <button class="dui-perf" type="button" data-ui-action="quality" data-tooltip="Change rendering quality">
              <span class="dui-perf-dot"></span>
              <span><strong data-ui="fps">— FPS</strong><small data-ui="quality">High</small></span>
            </button>
            <button class="dui-icon-button" type="button" data-ui-action="pause" aria-label="Pause game" data-tooltip="Pause [Esc]">Ⅱ</button>
          </section>
        </header>

        <aside class="dui-build-panel" aria-label="Build and command palette">
          <div class="dui-panel-crown">
            <div><small>Keeper's</small><strong>Command</strong></div>
            <button class="dui-collapse" type="button" data-ui-action="collapse-build" aria-label="Collapse build palette">‹</button>
          </div>
          <nav class="dui-tabs" data-ui="tabs" aria-label="Command categories"></nav>
          <div class="dui-mode-grid" data-ui="mode-grid"></div>
          <div class="dui-palette-tip"><kbd>[</kbd><kbd>]</kbd><span>Cycle tools</span></div>
        </aside>

        <section class="dui-event-feed" data-ui="event-feed" aria-live="polite" aria-label="Dungeon events"></section>

        <aside class="dui-side-stack">
          <section class="dui-panel dui-threats" aria-label="Approaching threats">
            <button class="dui-panel-heading" type="button" data-ui-action="toggle-threats" aria-expanded="true">
              <span><i class="dui-alert-dot"></i> Threats</span><strong data-ui="threat-count">0</strong>
            </button>
            <div class="dui-unit-list" data-ui="threat-list"></div>
          </section>
          <section class="dui-panel dui-roster" aria-label="Creature roster">
            <button class="dui-panel-heading" type="button" data-ui-action="toggle-roster" aria-expanded="true">
              <span>Dungeon Roster</span><strong data-ui="roster-count">0</strong>
            </button>
            <div class="dui-unit-list" data-ui="roster-list"></div>
          </section>
        </aside>

        <section class="dui-minimap-frame" aria-label="Dungeon minimap">
          <div class="dui-minimap-heading"><span>Dominion</span><small data-ui="coordinates">—</small></div>
          <div class="dui-minimap-wrap">
            <canvas class="dui-minimap" data-ui="minimap" width="192" height="192"></canvas>
            <i class="dui-minimap-reticle" aria-hidden="true"></i>
          </div>
          <div class="dui-minimap-actions">
            <button type="button" data-ui-action="zoom-out" aria-label="Zoom out" data-tooltip="Zoom out [Z]">−</button>
            <button type="button" data-ui-action="recenter" aria-label="Center on Dungeon Heart" data-tooltip="Recenter [Space]">◎</button>
            <button type="button" data-ui-action="zoom-in" aria-label="Zoom in" data-tooltip="Zoom in [X]">+</button>
          </div>
        </section>

        <section class="dui-context" data-ui="context" aria-label="Selection and actions">
          <div class="dui-context-portrait" data-ui="context-icon" aria-hidden="true">♦</div>
          <div class="dui-context-copy">
            <small data-ui="context-kicker">Command selected</small>
            <strong data-ui="context-title">Excavate</strong>
            <span data-ui="context-detail">Mark earth and gold for excavation</span>
            <span class="dui-meter dui-meter--context"><span data-ui="context-fill"></span></span>
          </div>
          <div class="dui-context-actions" data-ui="context-actions"></div>
          <button class="dui-context-close" type="button" data-ui-action="clear-selection" aria-label="Clear selection">×</button>
        </section>

        <div class="dui-shortcuts" aria-hidden="true"><kbd>WASD</kbd> Move <kbd>Q E</kbd> Rotate <kbd>Wheel</kbd> Zoom <kbd>Esc</kbd> Pause</div>

        <section class="dui-screen is-visible" data-ui="start-screen" role="dialog" aria-modal="true" aria-labelledby="dui-start-title">
          <div class="dui-screen-embers" aria-hidden="true"></div>
          <div class="dui-screen-card dui-screen-card--start">
            <div class="dui-sigil" aria-hidden="true"><span>♦</span></div>
            <p class="dui-overtitle">The realm beneath awaits</p>
            <h1 id="dui-start-title">Dungeon<br><span>Heart</span></h1>
            <p class="dui-screen-lead">Carve your kingdom into the deep. Gather creatures, command the dark, and let no hero reach your heart.</p>
            <div class="dui-screen-buttons">
              <button class="dui-menu-button dui-menu-button--primary" type="button" data-ui-action="start-new"><span>Awaken the Heart</span><kbd>Enter</kbd></button>
              <button class="dui-menu-button" type="button" data-ui-action="start-testing"><span>Enter Proving Grounds</span></button>
              <button class="dui-menu-button" type="button" data-ui-action="show-controls"><span>Keeper's Codex</span></button>
            </div>
            <div class="dui-screen-meta"><span data-ui="version">Babylon Edition</span><span>WebGPU / WebGL</span></div>
          </div>
        </section>

        <section class="dui-screen" data-ui="pause-screen" role="dialog" aria-modal="true" aria-labelledby="dui-pause-title" aria-hidden="true">
          <div class="dui-screen-card dui-screen-card--compact">
            <p class="dui-overtitle">The dungeon holds its breath</p>
            <h2 id="dui-pause-title">Paused</h2>
            <div class="dui-screen-buttons">
              <button class="dui-menu-button dui-menu-button--primary" type="button" data-ui-action="resume"><span>Return to the Depths</span><kbd>Esc</kbd></button>
              <button class="dui-menu-button" type="button" data-ui-action="show-controls"><span>Keeper's Codex</span></button>
              <button class="dui-menu-button" type="button" data-ui-action="restart"><span>Begin Anew</span></button>
              <button class="dui-menu-button dui-menu-button--danger" type="button" data-ui-action="quit"><span>Abandon Dungeon</span></button>
            </div>
          </div>
        </section>

        <section class="dui-screen" data-ui="game-over-screen" role="dialog" aria-modal="true" aria-labelledby="dui-game-over-title" aria-hidden="true">
          <div class="dui-screen-card dui-screen-card--compact">
            <div class="dui-sigil dui-sigil--broken" data-ui="result-sigil" aria-hidden="true">♦</div>
            <p class="dui-overtitle" data-ui="result-kicker">Your dominion has ended</p>
            <h2 id="dui-game-over-title" data-ui="result-title">Dungeon Fallen</h2>
            <p class="dui-screen-lead" data-ui="result-detail">The heroes reached the heart. Only ash remains.</p>
            <dl class="dui-result-stats" data-ui="result-stats"></dl>
            <div class="dui-screen-buttons">
              <button class="dui-menu-button dui-menu-button--primary" type="button" data-ui-action="restart"><span>Rise Again</span></button>
              <button class="dui-menu-button" type="button" data-ui-action="quit"><span>Return to the Veil</span></button>
            </div>
          </div>
        </section>

        <section class="dui-codex" data-ui="codex" role="dialog" aria-modal="true" aria-label="Keeper's Codex" aria-hidden="true">
          <div class="dui-codex-card">
            <header><div><small>Keeper's</small><h2>Codex</h2></div><button type="button" data-ui-action="hide-controls" aria-label="Close controls">×</button></header>
            <div class="dui-control-grid">
              <div><kbd>W A S D</kbd><span>Pan across your dungeon</span></div>
              <div><kbd>Q / E</kbd><span>Rotate the view</span></div>
              <div><kbd>Z / X</kbd><span>Zoom out or in</span></div>
              <div><kbd>Space</kbd><span>Return to the Heart</span></div>
              <div><kbd>1 – 0</kbd><span>Select tools and powers</span></div>
              <div><kbd>[ / ]</kbd><span>Cycle available tools</span></div>
              <div><kbd>Drag</kbd><span>Paint orders and rooms</span></div>
              <div><kbd>Right click</kbd><span>Cancel an order</span></div>
              <div><kbd>Esc</kbd><span>Cancel or pause</span></div>
            </div>
            <button class="dui-menu-button dui-menu-button--primary" type="button" data-ui-action="hide-controls"><span>Understood</span></button>
          </div>
        </section>
      </div>`;

    this.nodes = {};
    this.root.querySelectorAll('[data-ui]').forEach((node) => {
      this.nodes[node.dataset.ui] = node;
    });
    this.minimapCanvas = this.nodes.minimap;
  }

  _bind() {
    this._onClick = (event) => {
      const button = event.target.closest('button');
      if (!button || !this.root.contains(button)) return;
      const mode = button.dataset.mode;
      if (mode) {
        this._selectMode(mode, true);
        return;
      }
      const group = button.dataset.group;
      if (group) {
        this.group = group;
        this._renderModes();
        return;
      }
      const action = button.dataset.uiAction;
      if (action) this._handleAction(action, button);
    };
    this.root.addEventListener('click', this._onClick);

    this._onKeyDown = (event) => {
      if (this.disposed || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const key = event.key;
      if (key === 'Enter' && this.nodes['start-screen'].classList.contains('is-visible')) {
        this._handleAction('start-new');
        event.preventDefault();
        return;
      }
      if (key === 'Escape') {
        if (this.nodes.codex.classList.contains('is-visible')) this._handleAction('hide-controls');
        else if (!this.nodes['start-screen'].classList.contains('is-visible') && !this.nodes['game-over-screen'].classList.contains('is-visible')) {
          this._handleAction(this.isPaused ? 'resume' : 'pause');
        }
        event.preventDefault();
        return;
      }
      if (key === '[' || key === ']') {
        this._cycleMode(key === ']' ? 1 : -1);
        event.preventDefault();
        return;
      }
      const normalized = key.length === 1 ? key.toUpperCase() : key;
      const match = this.modes.find((item) => item.shortcut && item.shortcut.toUpperCase() === normalized && !item.disabled);
      if (match) {
        this._selectMode(match.id, true);
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  _handleAction(action, button) {
    switch (action) {
      case 'start-new':
        this.showStart(false);
        this.callbacks.start('new');
        break;
      case 'start-testing':
        this.showStart(false);
        this.callbacks.start('testing');
        break;
      case 'pause':
        this.showPause(true);
        this.callbacks.pause(true);
        break;
      case 'resume':
        this.showPause(false);
        this.callbacks.pause(false);
        break;
      case 'restart':
      case 'quit':
      case 'recenter':
      case 'zoom-in':
      case 'zoom-out':
      case 'clear-selection':
        this.callbacks.action(action);
        break;
      case 'quality':
        this.quality = QUALITY_ORDER[(QUALITY_ORDER.indexOf(this.quality) + 1) % QUALITY_ORDER.length];
        this.nodes.quality.textContent = this.quality[0].toUpperCase() + this.quality.slice(1);
        this.callbacks.qualityChange(this.quality);
        break;
      case 'collapse-build':
        this.nodes.shell.classList.toggle('is-build-collapsed');
        button.setAttribute('aria-label', this.nodes.shell.classList.contains('is-build-collapsed') ? 'Expand build palette' : 'Collapse build palette');
        break;
      case 'toggle-threats':
      case 'toggle-roster': {
        const panel = button.closest('.dui-panel');
        const collapsed = panel.classList.toggle('is-collapsed');
        button.setAttribute('aria-expanded', String(!collapsed));
        break;
      }
      case 'show-controls':
        this.nodes.codex.classList.add('is-visible');
        this.nodes.codex.setAttribute('aria-hidden', 'false');
        this.nodes.codex.querySelector('button').focus();
        break;
      case 'hide-controls':
        this.nodes.codex.classList.remove('is-visible');
        this.nodes.codex.setAttribute('aria-hidden', 'true');
        break;
      default:
        this.callbacks.action(action);
    }
  }

  _selectMode(mode, notify) {
    const definition = this.modes.find((item) => item.id === mode);
    if (!definition || definition.disabled) return;
    this.mode = mode;
    this.group = definition.group;
    this._renderModes();
    this.nodes['context-kicker'].textContent = 'Command selected';
    this.nodes['context-title'].textContent = definition.label;
    this.nodes['context-detail'].textContent = definition.hint || 'Ready for your command';
    this.nodes['context-icon'].textContent = definition.icon || '◆';
    this.nodes.context.classList.add('has-command');
    if (notify) this.callbacks.modeChange(mode);
  }

  _cycleMode(direction) {
    const activeModes = this.modes.filter((mode) => !mode.disabled);
    if (!activeModes.length) return;
    const current = Math.max(0, activeModes.findIndex((mode) => mode.id === this.mode));
    const next = (current + direction + activeModes.length) % activeModes.length;
    this._selectMode(activeModes[next].id, true);
  }

  _renderModes() {
    const tabs = this.nodes.tabs;
    tabs.replaceChildren();
    GROUPS.forEach((group) => {
      const button = makeElement('button', group.id === this.group ? 'is-active' : '', group.label);
      button.type = 'button';
      button.dataset.group = group.id;
      button.setAttribute('aria-pressed', String(group.id === this.group));
      tabs.appendChild(button);
    });

    const grid = this.nodes['mode-grid'];
    grid.replaceChildren();
    this.modes.filter((mode) => mode.group === this.group).forEach((mode) => {
      const button = makeElement('button', 'dui-mode');
      button.type = 'button';
      button.dataset.mode = mode.id;
      button.dataset.tooltip = mode.hint || mode.label;
      button.classList.toggle('is-selected', mode.id === this.mode);
      button.disabled = Boolean(mode.disabled);
      button.setAttribute('aria-pressed', String(mode.id === this.mode));
      button.setAttribute('aria-label', `${mode.label}${mode.shortcut ? `, shortcut ${mode.shortcut}` : ''}`);
      const icon = makeElement('span', 'dui-mode-icon', mode.icon || '◆');
      icon.setAttribute('aria-hidden', 'true');
      const copy = makeElement('span', 'dui-mode-copy');
      copy.appendChild(makeElement('strong', '', mode.label));
      if (mode.cost != null) {
        const cost = makeElement('small', `is-${mode.resource || 'gold'}`, `${mode.cost} ${mode.resource === 'mana' ? 'mana' : mode.resource === 'work' ? 'work' : 'gold'}`);
        copy.appendChild(cost);
      } else {
        copy.appendChild(makeElement('small', '', mode.hint || 'Command'));
      }
      button.append(icon, copy);
      if (mode.shortcut) button.appendChild(makeElement('kbd', '', mode.shortcut));
      grid.appendChild(button);
    });
  }

  setMode(mode) {
    this._selectMode(mode, false);
  }

  getMode() {
    return this.mode;
  }

  /** Update any subset of the displayed state. Missing properties are ignored. */
  update(snapshot = {}) {
    if (this.disposed || !snapshot) return;
    const resources = snapshot.resources || snapshot;
    this._setText('gold', resources.gold, formatNumber);
    this._setText('mana', resources.mana, formatNumber);
    this._setText('mana-max', resources.manaMax, formatNumber);
    this._setText('work', resources.work ?? resources.manufacturing, formatNumber);
    this._setText('imps', resources.imps, formatNumber);
    this._setText('creatures', resources.creatures, formatNumber);

    const heart = snapshot.heart || {};
    const heartHp = heart.hp ?? snapshot.heartHp;
    const heartMax = heart.maxHp ?? snapshot.heartMaxHp;
    if (heartHp != null || heartMax != null) {
      const hp = asNumber(heartHp);
      const maxHp = Math.max(1, asNumber(heartMax, 1));
      this.nodes['heart-fill'].style.width = `${clamp01(hp / maxHp) * 100}%`;
      this.nodes['heart-value'].textContent = `${Math.ceil(hp)} / ${Math.ceil(maxHp)}`;
      this.nodes.heart?.classList.toggle('is-critical', hp / maxHp <= 0.25);
    }

    const invasion = snapshot.invasion || snapshot.wave || {};
    if (typeof snapshot.wave === 'number') this.nodes.wave.textContent = String(snapshot.wave);
    else if (invasion.number != null) this.nodes.wave.textContent = String(invasion.number);
    const waveTime = invasion.time ?? invasion.nextIn ?? snapshot.waveTime;
    if (waveTime != null) this.nodes['wave-time'].textContent = invasion.active ? (invasion.label || 'Under attack') : formatTime(waveTime);

    if (snapshot.mode) this.setMode(snapshot.mode);
    if (Array.isArray(snapshot.modes)) this._updateModes(snapshot.modes);
    if (Array.isArray(snapshot.threats)) this._renderUnits('threats', snapshot.threats);
    if (Array.isArray(snapshot.roster)) this._renderUnits('roster', snapshot.roster);
    if (snapshot.context !== undefined) this._renderContext(snapshot.context);
    if (snapshot.performance) this._updatePerformance(snapshot.performance);
    if (snapshot.coordinates != null) this.nodes.coordinates.textContent = String(snapshot.coordinates);
    if (snapshot.minimap) this._updateMinimap(snapshot.minimap);
    if (snapshot.version != null) this.nodes.version.textContent = String(snapshot.version);
    if (snapshot.paused != null && Boolean(snapshot.paused) !== this.isPaused) this.showPause(Boolean(snapshot.paused));
    if (snapshot.gameOver) this.showGameOver(snapshot.gameOver);
  }

  _setText(name, value, formatter = String) {
    if (value == null || !this.nodes[name]) return;
    this.nodes[name].textContent = formatter(value);
  }

  _updateModes(changes) {
    let changed = false;
    changes.forEach((change) => {
      if (!change || !change.id) return;
      const existing = this.modes.find((mode) => mode.id === change.id);
      if (existing) {
        const hasDifference = Object.entries(change).some(([key, value]) => existing[key] !== value);
        if (hasDifference) {
          Object.assign(existing, change);
          changed = true;
        }
      } else {
        this.modes.push({ group: 'orders', icon: '◆', ...change });
        changed = true;
      }
    });
    if (changed) this._renderModes();
  }

  _renderUnits(kind, units) {
    const signature = JSON.stringify(units.map((unit) => [unit.id, unit.name, unit.type, unit.level, unit.hp, unit.maxHp, unit.status, unit.icon, unit.distance]));
    if (signature === this._unitSignatures[kind]) return;
    this._unitSignatures[kind] = signature;
    const list = this.nodes[`${kind === 'threats' ? 'threat' : 'roster'}-list`];
    const count = this.nodes[`${kind === 'threats' ? 'threat' : 'roster'}-count`];
    count.textContent = String(units.length);
    list.replaceChildren();
    if (!units.length) {
      list.appendChild(makeElement('div', 'dui-empty', kind === 'threats' ? 'The tunnels are quiet' : 'Your halls stand empty'));
      return;
    }
    units.slice(0, kind === 'threats' ? 4 : 7).forEach((unit) => {
      const button = makeElement('button', 'dui-unit');
      button.type = 'button';
      const action = kind === 'threats' ? 'focus-threat' : 'focus-creature';
      button.addEventListener('click', () => this.callbacks.action(action, unit.id ?? unit));
      const portrait = makeElement('span', `dui-unit-portrait ${kind === 'threats' ? 'is-hostile' : ''}`, unit.icon || String(unit.name || unit.type || '?').charAt(0).toUpperCase());
      const body = makeElement('span', 'dui-unit-body');
      const header = makeElement('span', 'dui-unit-title');
      header.append(makeElement('strong', '', unit.name || unit.type || 'Unknown'));
      header.append(makeElement('small', '', unit.level != null ? `Lv ${unit.level}` : unit.distance != null ? `${Math.round(unit.distance)}m` : unit.status || ''));
      const meter = makeElement('span', 'dui-unit-meter');
      const fill = makeElement('span');
      fill.style.width = `${clamp01(asNumber(unit.hp, 1) / Math.max(1, asNumber(unit.maxHp, 1))) * 100}%`;
      meter.appendChild(fill);
      const status = makeElement('span', 'dui-unit-status', unit.status || (kind === 'threats' ? 'Advancing' : 'Idle'));
      body.append(header, meter, status);
      button.append(portrait, body);
      list.appendChild(button);
    });
  }

  _renderContext(context) {
    if (!context) {
      const definition = this.modes.find((mode) => mode.id === this.mode);
      if (definition) this._selectMode(definition.id, false);
      this.nodes['context-actions'].replaceChildren();
      this.nodes['context-fill'].style.width = '0%';
      return;
    }
    this.nodes['context-kicker'].textContent = context.kicker || context.type || 'Selected';
    this.nodes['context-title'].textContent = context.title || context.name || 'Unknown';
    this.nodes['context-detail'].textContent = context.detail || context.status || '';
    this.nodes['context-icon'].textContent = context.icon || String(context.title || context.name || '?').charAt(0).toUpperCase();
    const value = context.health ?? context.progress;
    const max = context.maxHealth ?? context.max ?? 1;
    this.nodes['context-fill'].style.width = value == null ? '0%' : `${clamp01(asNumber(value) / Math.max(1, asNumber(max, 1))) * 100}%`;
    const actions = this.nodes['context-actions'];
    actions.replaceChildren();
    (context.actions || []).slice(0, 4).forEach((action) => {
      const button = makeElement('button', 'dui-context-action');
      button.type = 'button';
      button.disabled = Boolean(action.disabled);
      button.dataset.tooltip = action.hint || action.label;
      button.append(makeElement('span', '', action.icon || '◆'), makeElement('strong', '', action.label || action.id));
      if (action.shortcut) button.appendChild(makeElement('kbd', '', action.shortcut));
      button.addEventListener('click', () => this.callbacks.action(action.id, context.id));
      actions.appendChild(button);
    });
  }

  _updatePerformance(performance) {
    const fps = Math.max(0, Math.round(asNumber(performance.fps)));
    this.nodes.fps.textContent = fps ? `${fps} FPS` : '— FPS';
    const badge = this.nodes.fps.closest('.dui-perf');
    badge.classList.toggle('is-warn', fps > 0 && fps < 45);
    badge.classList.toggle('is-bad', fps > 0 && fps < 30);
    if (performance.quality && QUALITY_ORDER.includes(String(performance.quality).toLowerCase())) {
      this.quality = String(performance.quality).toLowerCase();
      this.nodes.quality.textContent = this.quality[0].toUpperCase() + this.quality.slice(1);
    }
    const details = [];
    if (performance.drawCalls != null) details.push(`${performance.drawCalls} draws`);
    if (performance.frameMs != null) details.push(`${Number(performance.frameMs).toFixed(1)}ms`);
    if (details.length) badge.dataset.tooltip = details.join(' · ');
  }

  _updateMinimap(minimap) {
    const canvas = this.minimapCanvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (minimap instanceof ImageData) {
      const scratch = document.createElement('canvas');
      scratch.width = minimap.width;
      scratch.height = minimap.height;
      scratch.getContext('2d').putImageData(minimap, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(scratch, 0, 0, canvas.width, canvas.height);
      return;
    }
    if (minimap.pixels && minimap.width && minimap.height) {
      const data = minimap.pixels instanceof Uint8ClampedArray ? minimap.pixels : new Uint8ClampedArray(minimap.pixels);
      this._updateMinimap(new ImageData(data, minimap.width, minimap.height));
      return;
    }
    if (typeof CanvasImageSource !== 'undefined' && minimap instanceof CanvasImageSource) {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(minimap, 0, 0, canvas.width, canvas.height);
    }
  }

  pushEvent(message, options = {}) {
    if (this.disposed || message == null) return;
    if (typeof options === 'string') options = { tone: options };
    const item = {
      id: `${Date.now()}-${Math.random()}`,
      message: String(message),
      tone: options.tone || 'neutral',
      icon: options.icon || (options.tone === 'danger' ? '!' : options.tone === 'success' ? '✓' : '◆'),
    };
    this.events.unshift(item);
    this.events.length = Math.min(this.events.length, 5);
    const feed = this.nodes['event-feed'];
    const row = makeElement('div', `dui-event is-${item.tone}`);
    row.dataset.eventId = item.id;
    row.append(makeElement('span', 'dui-event-icon', item.icon), makeElement('p', '', item.message));
    feed.prepend(row);
    while (feed.childElementCount > 5) feed.lastElementChild.remove();
    window.setTimeout(() => {
      if (!this.disposed && row.isConnected) row.classList.add('is-fading');
    }, asNumber(options.duration, 6500));
  }

  showStart(value = true) {
    const visible = typeof value === 'object' ? value.visible !== false : Boolean(value);
    if (typeof value === 'object' && value.version != null) this.nodes.version.textContent = String(value.version);
    this._showScreen('start-screen', visible);
    if (visible) window.requestAnimationFrame(() => this.nodes['start-screen'].querySelector('button')?.focus());
  }

  showPause(value = true) {
    this.isPaused = Boolean(value);
    this._showScreen('pause-screen', this.isPaused);
    if (this.isPaused) window.requestAnimationFrame(() => this.nodes['pause-screen'].querySelector('button')?.focus());
  }

  showGameOver(result = {}) {
    if (result === false || result == null) {
      this._showScreen('game-over-screen', false);
      return;
    }
    if (result === true) result = {};
    const victory = Boolean(result.victory);
    this.nodes['result-sigil'].classList.toggle('is-victory', victory);
    this.nodes['result-kicker'].textContent = result.kicker || (victory ? 'The realm kneels before you' : 'Your dominion has ended');
    this.nodes['result-title'].textContent = result.title || (victory ? 'Dungeon Ascendant' : 'Dungeon Fallen');
    this.nodes['result-detail'].textContent = result.detail || (victory ? 'The final champion has fallen. Your dark reign begins.' : 'The heroes reached the heart. Only ash remains.');
    const stats = this.nodes['result-stats'];
    stats.replaceChildren();
    Object.entries(result.stats || {}).slice(0, 4).forEach(([label, value]) => {
      stats.append(makeElement('dt', '', label), makeElement('dd', '', value));
    });
    this._showScreen('game-over-screen', true);
    window.requestAnimationFrame(() => this.nodes['game-over-screen'].querySelector('button')?.focus());
  }

  _showScreen(name, visible) {
    const screen = this.nodes[name];
    screen.classList.toggle('is-visible', visible);
    screen.setAttribute('aria-hidden', String(!visible));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeEventListener('click', this._onClick);
    window.removeEventListener('keydown', this._onKeyDown);
    this.root.replaceChildren();
    this.root.classList.remove('dungeon-ui-root');
  }
}
