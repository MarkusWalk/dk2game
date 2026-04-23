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
  GRID_SIZE, ROOM_TREASURY, ROOM_LAIR, ROOM_HATCHERY, FINAL_WAVE,
} from './constants.js';
import {
  imps, creatures, portals, grid, jobs, stats, invasion, GAME, heartRef,
} from './state.js';
import { ensureAudio, setMuted, audio } from './audio.js';
import { recenterCamera } from './camera-controls.js';

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
    hudQDig: document.getElementById('qDig'),
    hudQClaim: document.getElementById('qClaim'),
    hudQClaimWall: document.getElementById('qClaimWall'),
    hudQReinforce: document.getElementById('qReinforce'),
    hudGold: document.getElementById('goldCount'),
    hudHauling: document.getElementById('haulingCount'),
    sumImps: document.getElementById('sumImps'),
    sumCreatures: document.getElementById('sumCreatures'),
    sumGold: document.getElementById('sumGold'),
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
  let rt = 0, rl = 0, rh = 0;
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      const rr = grid[x][z].roomType;
      if (rr === ROOM_TREASURY) rt++;
      else if (rr === ROOM_LAIR) rl++;
      else if (rr === ROOM_HATCHERY) rh++;
    }
  }
  r.hudRoomTreasury.textContent = rt;
  r.hudRoomLair.textContent = rl;
  r.hudRoomHatchery.textContent = rh;
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
