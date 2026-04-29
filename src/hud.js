// ============================================================
// HUD
// ============================================================
// Compact "Imps · Cr · Gold" summary always visible; clicking expands the
// full detail panel with stats, rooms, job queues, gold. Helper buttons for
// legend / recenter / mute live in the top-right corner.
//
// updateHUD runs every frame; the detail panel short-circuits if collapsed.
// updateCombatHud syncs the heart HP bar and wave countdown.

import {
  GRID_SIZE, ROOM_TREASURY, ROOM_LAIR, ROOM_HATCHERY,
  ROOM_TRAINING, ROOM_LIBRARY, ROOM_WORKSHOP, FINAL_WAVE, SPECIES,
  SPELL_RESEARCH_COST,
  AFFINITY, LEAVING_HAPPINESS, PAY_DAY_INTERVAL,
} from './constants.js';
import {
  imps, creatures, portals, grid, jobs, stats, invasion, GAME, heartRef,
  cameraControls, infoPanel, payDay, sim,
} from './state.js';
import { ensureAudio, setMuted, audio } from './audio.js';
import { recenterCamera } from './camera-controls.js';
import { getHatcheryFoodTotals } from './rooms.js';

// HUD DOM references — resolved lazily (after DOMContentLoaded)
let refs = null;
function _getRefs() {
  if (refs) return refs;
  refs = {
    hudEl: document.getElementById('hud'),
    hudSummary: document.getElementById('hudSummary'),
    hudImp: document.getElementById('impCount'),
    hudCreatures: document.getElementById('creatureCount'),
    hudPortals: document.getElementById('portalCount'),
    hudTiles: document.getElementById('tilesDug'),
    hudClaimed: document.getElementById('tilesClaimed'),
    hudWalls: document.getElementById('wallsReinforced'),
    hudCaptured: document.getElementById('wallsCaptured'),
    hudRoomTreasury: document.getElementById('roomTreasury'),
    hudRoomLair: document.getElementById('roomLair'),
    hudRoomHatchery: document.getElementById('roomHatchery'),
    hudRoomTraining: document.getElementById('roomTraining'),
    hudRoomLibrary: document.getElementById('roomLibrary'),
    hudRoomWorkshop: document.getElementById('roomWorkshop'),
    hudResearch: document.getElementById('researchPts'),
    hudMfg: document.getElementById('mfgPts'),
    hudFood: document.getElementById('foodCount'),
    rosterPanel: document.getElementById('rosterPanel'),
    rosterList: document.getElementById('rosterList'),
    rosterToggle: document.getElementById('rosterToggle'),
    hudQDig: document.getElementById('qDig'),
    hudQClaim: document.getElementById('qClaim'),
    hudQClaimWall: document.getElementById('qClaimWall'),
    hudQReinforce: document.getElementById('qReinforce'),
    hudGold: document.getElementById('goldCount'),
    hudHauling: document.getElementById('haulingCount'),
    sumImps: document.getElementById('sumImps'),
    sumCreatures: document.getElementById('sumCreatures'),
    sumGold: document.getElementById('sumGold'),
    sumMana: document.getElementById('sumMana'),
    hudMana: document.getElementById('manaCount'),
    legendEl: document.getElementById('legend'),
    helpBtn: document.getElementById('helpBtn'),
    instructionsEl: document.getElementById('instructions'),
    instructionsClose: document.getElementById('instructionsClose'),
    recenterBtn: document.getElementById('recenterBtn'),
    muteBtn: document.getElementById('muteBtn'),
    heartHpEl: document.getElementById('heartHp'),
    heartHpFillEl: document.getElementById('heartHpFill'),
    heartHpValEl: document.getElementById('heartHpVal'),
    waveNumEl: document.getElementById('waveNum'),
    waveTimerEl: document.getElementById('waveTimer'),
    waveLabelEl: document.getElementById('waveLabel'),
    bossHpEl: document.getElementById('bossHp'),
    bossHpFillEl: document.getElementById('bossHpFill'),
  };
  return refs;
}

export function updateHUD() {
  const r = _getRefs();
  // Compact-bar values — updated every tick regardless of expanded state
  r.sumImps.textContent = imps.length;
  r.sumCreatures.textContent = creatures.length;
  r.sumGold.textContent = stats.goldTotal;
  if (r.sumMana) r.sumMana.textContent = Math.floor(stats.mana);

  // Skip the detail work if the panel is collapsed — saves a per-frame grid scan
  if (!r.hudEl.classList.contains('expanded')) return;

  r.hudImp.textContent = imps.length;
  r.hudCreatures.textContent = creatures.length;
  const claimedPortals = portals.filter(p => p.claimed).length;
  r.hudPortals.textContent = claimedPortals + '/' + portals.length;
  r.hudTiles.textContent = stats.tilesDug;
  r.hudClaimed.textContent = stats.tilesClaimed;
  r.hudWalls.textContent = stats.wallsReinforced;
  r.hudCaptured.textContent = stats.wallsCaptured;
  let rt = 0, rl = 0, rh = 0, rtr = 0, rlib = 0, rws = 0;
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      const rr = grid[x][z].roomType;
      if      (rr === ROOM_TREASURY) rt++;
      else if (rr === ROOM_LAIR)     rl++;
      else if (rr === ROOM_HATCHERY) rh++;
      else if (rr === ROOM_TRAINING) rtr++;
      else if (rr === ROOM_LIBRARY)  rlib++;
      else if (rr === ROOM_WORKSHOP) rws++;
    }
  }
  r.hudRoomTreasury.textContent = rt;
  r.hudRoomLair.textContent = rl;
  r.hudRoomHatchery.textContent = rh;
  if (r.hudRoomTraining) r.hudRoomTraining.textContent = rtr;
  if (r.hudRoomLibrary)  r.hudRoomLibrary.textContent = rlib;
  if (r.hudRoomWorkshop) r.hudRoomWorkshop.textContent = rws;
  if (r.hudResearch) {
    // Show lifetime points; if a research target is active, append progress.
    const tgt = stats.researchTarget;
    if (tgt) {
      const prog = Math.floor(stats.researchProgress[tgt] || 0);
      const cost = SPELL_RESEARCH_COST[tgt] || 0;
      r.hudResearch.textContent = `${Math.floor(stats.research || 0)} — ${tgt} ${prog}/${cost}`;
    } else {
      r.hudResearch.textContent = Math.floor(stats.research || 0);
    }
  }
  if (r.hudMfg)          r.hudMfg.textContent = Math.floor(stats.manufacturing || 0);
  if (r.hudFood) {
    const totals = getHatcheryFoodTotals();
    r.hudFood.textContent = totals.current + ' / ' + totals.max;
  }
  let qd = 0, qc = 0, qcw = 0, qr = 0;
  for (const j of jobs) {
    if (j.type === 'dig') qd++;
    else if (j.type === 'claim') qc++;
    else if (j.type === 'claim_wall') qcw++;
    else if (j.type === 'reinforce') qr++;
  }
  r.hudQDig.textContent = qd;
  r.hudQClaim.textContent = qc;
  r.hudQClaimWall.textContent = qcw;
  r.hudQReinforce.textContent = qr;
  r.hudGold.textContent = stats.goldTotal;
  let carrying = 0;
  for (const imp of imps) carrying += imp.userData.carrying;
  r.hudHauling.textContent = carrying;
  if (r.hudMana) r.hudMana.textContent = Math.floor(stats.mana) + ' / ' + stats.manaMax;
}

// ---- Roster panel ----
// Lists each living creature with species, level, HP bar, mood dot. Click a row
// to pan the camera to that creature. Rendered on a throttle (not per-frame)
// because DOM diff-less innerHTML replaces would be wasteful at 60Hz.
let _rosterLastRender = 0;
const ROSTER_INTERVAL_MS = 300;

function _rosterRowHtml(c, idx) {
  const ud = c.userData;
  const sp = SPECIES[ud.species] || SPECIES.fly;
  const hpFrac = Math.max(0, ud.hp / ud.maxHp);
  const hpPct = (hpFrac * 100).toFixed(0);
  const happy = ud.happiness != null ? ud.happiness : 1;
  const moodClass = happy >= 0.7 ? 'mood-happy' : happy <= 0.35 ? 'mood-angry' : 'mood-mid';
  const colorHex = '#' + sp.color.toString(16).padStart(6, '0');
  return `<div class="r-row" data-idx="${idx}">
    <span class="r-icon" style="background:${colorHex}">${sp.letter}</span>
    <span class="r-name">${sp.name} <span class="r-lv">L${ud.level}</span></span>
    <span class="r-hpbar"><span class="r-hpfill" style="width:${hpPct}%"></span></span>
    <span class="r-mood ${moodClass}"></span>
  </div>`;
}

// ============================================================
// CREATURE INFO PANEL — opens when a roster row or world creature is clicked.
// Shows portrait, vitals, moves, likes/dislikes, current state.
// ============================================================
function _bar(label, frac, color) {
  const pct = Math.max(0, Math.min(1, frac)) * 100;
  return `<div class="info-bar">
    <span class="info-bar-lbl">${label}</span>
    <span class="info-bar-track"><span class="info-bar-fill" style="width:${pct.toFixed(0)}%;background:${color}"></span></span>
  </div>`;
}

function _likesDislikes(species) {
  const aff = AFFINITY[species];
  if (!aff) return '';
  const likes = [], dislikes = [];
  for (const k of Object.keys(aff)) {
    const v = aff[k];
    const sp = SPECIES[k];
    if (!sp) continue;
    if (v > 0) likes.push(sp.name);
    else if (v < 0) dislikes.push(sp.name);
  }
  if (likes.length === 0 && dislikes.length === 0) return '';
  let html = '';
  if (likes.length) html += `<div class="info-aff likes"><b>Likes:</b> ${likes.join(', ')}</div>`;
  if (dislikes.length) html += `<div class="info-aff dislikes"><b>Dislikes:</b> ${dislikes.join(', ')}</div>`;
  return html;
}

function _renderInfoPanel() {
  const c = infoPanel.target;
  const root = document.getElementById('infoPanel');
  if (!root) return;
  if (!c || !c.userData || c.userData.hp <= 0) {
    root.classList.add('hidden');
    infoPanel.target = null;
    return;
  }
  root.classList.remove('hidden');
  const ud = c.userData;
  const sp = SPECIES[ud.species] || SPECIES.fly;
  const colorHex = '#' + sp.color.toString(16).padStart(6, '0');
  // Portrait
  const portrait = document.getElementById('infoPortrait');
  if (portrait) {
    portrait.style.background = colorHex;
    portrait.textContent = sp.letter;
  }
  // Titles
  const nameEl = document.getElementById('infoName');
  const subEl  = document.getElementById('infoSub');
  if (nameEl) nameEl.textContent = sp.name;
  if (subEl)  subEl.textContent  = `Level ${ud.level || 1}  ·  ${(ud.state || 'idle').replace('_',' ')}`;

  // Body
  const body = document.getElementById('infoBody');
  if (!body) return;
  const hpFrac = ud.hp / ud.maxHp;
  const xpFrac = (ud.xp || 0) / Math.max(1, _xpToNext(ud.level || 1));
  const hunger = ud.needs ? ud.needs.hunger : 0;
  const sleep  = ud.needs ? ud.needs.sleep  : 0;
  const anger  = ud.anger || 0;
  const happy  = ud.happiness != null ? ud.happiness : 1;
  const moodLabel = happy >= 0.7 ? 'Content' : happy <= 0.35 ? 'Furious' : happy <= LEAVING_HAPPINESS ? 'Packing bags' : 'Restless';
  const primary  = sp.atk ? `${sp.atk} dmg / ${sp.atkCooldown}s` : '—';
  const sec = sp.secondaryMove;
  const secReady = sec && (ud.level || 1) >= sec.learnedAt;
  const secLine = sec
    ? (secReady
        ? `<span class="info-move-name">${sec.name}</span> — ${sec.atk} dmg / ${sec.cooldown}s`
        : `<span class="info-move-locked">${sec.name} (unlocks at L${sec.learnedAt})</span>`)
    : 'None';

  body.innerHTML =
    _bar('HP',     hpFrac, '#ff6060') +
    _bar('XP',     xpFrac, '#ffd060') +
    _bar('Hunger', hunger, '#90c050') +
    _bar('Sleep',  sleep,  '#60a0ff') +
    _bar('Anger',  anger,  '#ff4030') +
    `<div class="info-row"><span>Mood</span><b class="${happy <= LEAVING_HAPPINESS ? 'info-bad' : ''}">${moodLabel}</b></div>` +
    `<div class="info-row"><span>Goal</span><b>${(ud.goal || ud.state || 'wander').replace('_',' ')}</b></div>` +
    `<div class="info-row"><span>Pay due</span><b>${Math.max(0, Math.round((90 - (ud.paySince || 0)) | 0))}s</b></div>` +
    `<h3>Moves</h3>` +
    `<div class="info-move"><span>Primary</span><span>${primary}</span></div>` +
    `<div class="info-move"><span>Secondary</span><span>${secLine}</span></div>` +
    _likesDislikes(ud.species);
}
// Tiny duplicate of xpToNext from xp.js — avoids a hud↔xp import cycle.
function _xpToNext(level) { return Math.round(30 * Math.pow(1.6, (level || 1) - 1)); }

export function showCreatureInfo(c) {
  if (!c || !c.userData) return;
  infoPanel.target = c;
  _renderInfoPanel();
}
export function hideCreatureInfo() {
  infoPanel.target = null;
  const root = document.getElementById('infoPanel');
  if (root) root.classList.add('hidden');
}
export function tickInfoPanel() {
  if (infoPanel.target) _renderInfoPanel();
}

// ============================================================
// PAY-DAY BANNER + countdown
// ============================================================
export function tickPaydayHud() {
  const root = document.getElementById('paydayBanner');
  const sub  = document.getElementById('paydaySub');
  if (!root) return;
  const now = sim.time;
  if (now < payDay.bannerUntil) {
    root.classList.remove('hidden');
    if (sub) {
      sub.textContent = payDay.unpaidCount > 0
        ? `${payDay.unpaidCount} UNPAID — anger rising`
        : 'All wages issued';
      sub.classList.toggle('warn', payDay.unpaidCount > 0);
    }
  } else {
    root.classList.add('hidden');
  }
  // Optional countdown text on the existing wave-timer slot — wired below.
  void PAY_DAY_INTERVAL;
}

export function updateRoster(force) {
  const r = _getRefs();
  if (!r.rosterList) return;
  if (r.rosterPanel && r.rosterPanel.classList.contains('collapsed')) return;
  const now = performance.now();
  if (!force && now - _rosterLastRender < ROSTER_INTERVAL_MS) return;
  _rosterLastRender = now;
  if (creatures.length === 0) {
    r.rosterList.innerHTML = '<div class="r-empty">No creatures yet</div>';
    return;
  }
  let html = '';
  for (let i = 0; i < creatures.length; i++) html += _rosterRowHtml(creatures[i], i);
  r.rosterList.innerHTML = html;
}

// Combat-specific HUD updates (heart HP bar, wave countdown).
// Called every frame from the animation loop.
export function updateCombatHud(t) {
  const r = _getRefs();
  const heart = heartRef.heart;
  if (!heart) return;
  const ud = heart.userData;
  const frac = Math.max(0, ud.hp / ud.maxHp);
  if (r.heartHpFillEl) r.heartHpFillEl.style.width = (frac * 100).toFixed(1) + '%';
  if (r.heartHpValEl)  r.heartHpValEl.textContent = Math.ceil(ud.hp) + ' / ' + ud.maxHp;
  if (r.heartHpEl) r.heartHpEl.classList.toggle('crit', frac < 0.25);

  // Wave counter shows progress toward the final boss (wave N / FINAL_WAVE)
  if (r.waveNumEl) {
    r.waveNumEl.textContent = invasion.waveNumber + ' / ' + FINAL_WAVE;
  }
  if (r.waveTimerEl && r.waveLabelEl) {
    if (GAME.over) {
      r.waveLabelEl.textContent = '';
      r.waveTimerEl.textContent = GAME.won ? 'VICTORY' : 'DEFEAT';
    } else if (invasion.boss) {
      r.waveLabelEl.textContent = '';
      r.waveTimerEl.textContent = 'BOSS ON THE FIELD';
    } else if (invasion.nextWaveAt === Infinity) {
      r.waveLabelEl.textContent = '';
      r.waveTimerEl.textContent = '—';
    } else {
      r.waveLabelEl.textContent = 'Next in';
      const remaining = Math.max(0, invasion.nextWaveAt - t);
      if (remaining > 60) r.waveTimerEl.textContent = Math.ceil(remaining / 60) + 'm';
      else r.waveTimerEl.textContent = Math.ceil(remaining) + 's';
    }
  }

  // Boss HP bar — visible only while boss is on the field
  if (r.bossHpEl) {
    const boss = invasion.boss;
    if (boss && boss.userData.hp > 0) {
      const bf = Math.max(0, boss.userData.hp / boss.userData.maxHp);
      if (r.bossHpFillEl) r.bossHpFillEl.style.width = (bf * 100).toFixed(1) + '%';
      r.bossHpEl.classList.add('visible');
    } else {
      r.bossHpEl.classList.remove('visible');
    }
  }
}

// ============================================================
// EVENT FEED — rolling log of short dungeon events
// ============================================================
// Callers push short strings (≤60 chars). Entries fade after a few seconds.
// Designed to be cheap to call from anywhere: no DOM lookup on the hot path
// when the feed element isn't in the DOM yet.
const EVENT_FEED_MAX = 6;
const EVENT_FEED_TTL_MS = 6000;
const _eventFeed = [];  // { text, expiresAt }
let _eventFeedEl = null;
let _eventFeedChecked = false;

function _resolveEventFeedEl() {
  if (_eventFeedChecked) return _eventFeedEl;
  _eventFeedChecked = true;
  _eventFeedEl = document.getElementById('eventFeed');
  return _eventFeedEl;
}

export function pushEvent(text) {
  if (!text) return;
  const now = performance.now();
  _eventFeed.push({ text: String(text).slice(0, 80), expiresAt: now + EVENT_FEED_TTL_MS });
  if (_eventFeed.length > EVENT_FEED_MAX) _eventFeed.splice(0, _eventFeed.length - EVENT_FEED_MAX);
  _renderEventFeed(now);
}

function _renderEventFeed(now) {
  const el = _resolveEventFeedEl();
  if (!el) return;
  // Drop expired
  while (_eventFeed.length && _eventFeed[0].expiresAt < now) _eventFeed.shift();
  if (_eventFeed.length === 0) { el.innerHTML = ''; return; }
  let html = '';
  for (const e of _eventFeed) {
    const remaining = Math.max(0, e.expiresAt - now);
    const opacity = Math.min(1, remaining / 1200).toFixed(2);
    html += `<div class="ev" style="opacity:${opacity}">${_escape(e.text)}</div>`;
  }
  el.innerHTML = html;
}

function _escape(s) {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Called every frame from main.js to age entries without requiring a new push.
export function tickEventFeed() {
  if (_eventFeed.length === 0) return;
  _renderEventFeed(performance.now());
}

// --- Panel toggles + button wiring ---
export function installHud() {
  const r = _getRefs();

  // Default: HUD expanded on wide screens, collapsed on narrow ones
  if (window.innerWidth > 720) r.hudEl.classList.add('expanded');

  r.hudSummary.addEventListener('click', () => r.hudEl.classList.toggle('expanded'));

  r.helpBtn.addEventListener('click', () => {
    const nowVisible = !r.legendEl.classList.contains('visible');
    r.legendEl.classList.toggle('visible', nowVisible);
    r.helpBtn.classList.toggle('active', nowVisible);
    // Clicking help also brings instructions back if they were dismissed
    if (nowVisible) r.instructionsEl.classList.remove('hidden');
  });

  if (r.recenterBtn) r.recenterBtn.addEventListener('click', () => recenterCamera());

  // Roster panel — toggle on header click, click a row to pan the camera there.
  if (r.rosterPanel && r.rosterList) {
    const collapse = (collapsed) => {
      r.rosterPanel.classList.toggle('collapsed', collapsed);
      if (r.rosterToggle) r.rosterToggle.textContent = collapsed ? '+' : '−';
      if (!collapsed) updateRoster(true);
    };
    if (r.rosterToggle) {
      r.rosterToggle.addEventListener('click', () => {
        collapse(!r.rosterPanel.classList.contains('collapsed'));
      });
    }
    r.rosterList.addEventListener('click', (ev) => {
      const row = ev.target.closest('.r-row');
      if (!row) return;
      const idx = parseInt(row.dataset.idx, 10);
      const c = creatures[idx];
      if (c) {
        cameraControls.target.x = c.position.x;
        cameraControls.target.z = c.position.z;
        // Open the info panel for this creature so it's a single click to
        // both pan + inspect — matches DK2's roster-row interaction.
        showCreatureInfo(c);
      }
    });
    // Narrow screens default to collapsed so the panel doesn't hog the viewport.
    if (window.innerWidth <= 720) collapse(true);
  }
  // Info panel close button
  const infoClose = document.getElementById('infoClose');
  if (infoClose) infoClose.addEventListener('click', () => hideCreatureInfo());

  if (r.muteBtn) r.muteBtn.addEventListener('click', () => {
    ensureAudio();
    setMuted(!audio.muted);
  });

  // Unlock AudioContext on the FIRST user gesture of any kind.
  // Browsers block autoplay; this promotes the context to "running" state as soon
  // as the player taps anywhere (canvas, button, key). No sound plays on this
  // gesture itself — we just need the context alive for later plays.
  function _unlockAudioOnce() {
    ensureAudio();
    window.removeEventListener('pointerdown', _unlockAudioOnce, true);
    window.removeEventListener('keydown', _unlockAudioOnce, true);
    window.removeEventListener('touchstart', _unlockAudioOnce, true);
  }
  window.addEventListener('pointerdown', _unlockAudioOnce, true);
  window.addEventListener('keydown', _unlockAudioOnce, true);
  window.addEventListener('touchstart', _unlockAudioOnce, true);

  r.instructionsClose.addEventListener('click', () => r.instructionsEl.classList.add('hidden'));

  // On narrow screens, auto-dismiss the instructions after 15s so they don't
  // permanently cover the play area. User can always bring them back via "?".
  if (window.innerWidth <= 720) {
    setTimeout(() => r.instructionsEl.classList.add('hidden'), 15000);
  }
}
