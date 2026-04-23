// ============================================================
// AUDIO — procedural Web Audio synth (no asset files)
// ============================================================
// Every sound is synthesized from oscillators + filtered noise + gain envelopes.
// A single AudioContext is lazily created on first user gesture (browser
// autoplay policy) and routed through a master gain for global mute.
//
// Each sound effect has throttle (min interval between fires) and slight
// per-play pitch/gain variation so repeated triggers don't sound robotic.

import { GAME, heartRef } from './state.js';

export const audio = {
  ctx: null,
  master: null,
  muted: false,
  lastPlayed: {},        // name → DOMHighResTimeStamp of last fire
  whiteBuf: null,
  heartbeatTimer: null,
  droneNodes: null,      // optional low drone for invasion tension
};

function _makeWhiteNoise(ctx, seconds) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function ensureAudio() {
  if (!audio.ctx) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      audio.ctx = new Ctx();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = audio.muted ? 0 : 0.45;
      audio.master.connect(audio.ctx.destination);
      audio.whiteBuf = _makeWhiteNoise(audio.ctx, 1.2);
      _startHeartbeat();
    } catch (e) {
      console.warn('[audio] unavailable', e);
      return false;
    }
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
  return true;
}

export function setMuted(m) {
  audio.muted = !!m;
  if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.45;
  const btn = document.getElementById('muteBtn');
  if (btn) btn.textContent = audio.muted ? '🔇' : '🔊';
}

// Core play dispatcher — throttling + dispatch to synth function
export function playSfx(name, opts) {
  if (!audio.ctx || audio.muted) return;
  opts = opts || {};
  const now = performance.now();
  const minGap = opts.minInterval != null ? opts.minInterval : 60;
  if ((audio.lastPlayed[name] || 0) + minGap > now) return;
  audio.lastPlayed[name] = now;
  const fn = SYNTHS[name];
  if (fn) fn(opts);
}

// ---------- Synth primitives ----------
function _osc(type, freq, t0, dur) {
  const ctx = audio.ctx;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
  return o;
}
function _gain(t0, peak, attack, decay) {
  const ctx = audio.ctx;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  return g;
}
function _noise(t0, dur) {
  const ctx = audio.ctx;
  const n = ctx.createBufferSource();
  n.buffer = audio.whiteBuf;
  n.start(t0);
  n.stop(t0 + dur + 0.02);
  return n;
}
function _filter(type, freq, Q) {
  const f = audio.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (Q != null) f.Q.value = Q;
  return f;
}

// ---------- Sound library ----------
export const SYNTHS = {
  // Pick striking rock: bright tick + low thud + noise debris
  dig: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    const pv = 1 + (Math.random() - 0.5) * 0.1;   // pitch variance
    // Tick
    const o1 = _osc('square', 1100 * pv, t, 0.12);
    o1.frequency.exponentialRampToValueAtTime(280, t + 0.08);
    const g1 = _gain(t, 0.22, 0.002, 0.1);
    o1.connect(g1).connect(audio.master);
    // Thud
    const o2 = _osc('sine', 85, t, 0.2);
    o2.frequency.exponentialRampToValueAtTime(38, t + 0.12);
    const g2 = _gain(t, 0.35, 0.005, 0.18);
    o2.connect(g2).connect(audio.master);
    // Debris
    const n = _noise(t, 0.12);
    const nf = _filter('bandpass', 2500, 1.2);
    const ng = _gain(t, 0.18, 0.001, 0.1);
    n.connect(nf).connect(ng).connect(audio.master);
  },

  // Soft thud when a tile is claimed by an imp
  claim: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    const o = _osc('sine', 140, t, 0.3);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.2);
    const g = _gain(t, 0.28, 0.003, 0.25);
    o.connect(g).connect(audio.master);
    const n = _noise(t, 0.15);
    const nf = _filter('lowpass', 400, 1);
    const ng = _gain(t, 0.1, 0.001, 0.12);
    n.connect(nf).connect(ng).connect(audio.master);
  },

  // Metallic clank: wall reinforced or wall captured
  reinforce: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    const o1 = _osc('square', 320, t, 0.18);
    o1.frequency.exponentialRampToValueAtTime(180, t + 0.12);
    const g1 = _gain(t, 0.22, 0.003, 0.15);
    const f = _filter('bandpass', 600, 3);
    o1.connect(f).connect(g1).connect(audio.master);
    // Ring tail
    const o2 = _osc('triangle', 880, t, 0.25);
    const g2 = _gain(t, 0.08, 0.003, 0.22);
    o2.connect(g2).connect(audio.master);
  },

  // Coin clatter — fires on every gold deposit
  coin: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    const base = 1600 + Math.random() * 500;
    [1, 1.9, 2.7].forEach((m, i) => {
      const o = _osc('sine', base * m, t, 0.35);
      const g = _gain(t + i * 0.01, 0.14 / (i + 1), 0.003, 0.3);
      o.connect(g).connect(audio.master);
    });
  },

  // Low confirm chime for designating a room / claiming a portal
  confirm: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    const freqs = [220, 330, 440];  // major triad-ish
    freqs.forEach((f, i) => {
      const o = _osc('triangle', f, t + i * 0.03, 0.6);
      const g = _gain(t + i * 0.03, 0.13, 0.01, 0.45);
      o.connect(g).connect(audio.master);
    });
  },

  // Magical whoosh — portal claim / hand pickup / hand drop
  whoosh: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    const n = _noise(t, 0.45);
    const f = _filter('bandpass', 600, 4);
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.35);
    const g = _gain(t, 0.18, 0.02, 0.4);
    n.connect(f).connect(g).connect(audio.master);
    // Shimmer
    const o = _osc('sine', 800, t, 0.4);
    o.frequency.exponentialRampToValueAtTime(1600, t + 0.35);
    const g2 = _gain(t, 0.08, 0.02, 0.35);
    o.connect(g2).connect(audio.master);
  },

  // Creature birth / portal spawn — bright pulse
  spawn: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    const o1 = _osc('sawtooth', 200, t, 0.3);
    o1.frequency.exponentialRampToValueAtTime(600, t + 0.18);
    const g1 = _gain(t, 0.18, 0.005, 0.25);
    const lp = _filter('lowpass', 1500, 2);
    o1.connect(lp).connect(g1).connect(audio.master);
    // Flutter
    const o2 = _osc('triangle', 1200, t, 0.2);
    const g2 = _gain(t, 0.1, 0.01, 0.18);
    o2.connect(g2).connect(audio.master);
  },

  // Sword swing — filtered noise whoosh, short
  swing: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    const n = _noise(t, 0.15);
    const f = _filter('bandpass', 1200, 3);
    f.frequency.setValueAtTime(800, t);
    f.frequency.linearRampToValueAtTime(2400, t + 0.12);
    const g = _gain(t, 0.2, 0.005, 0.12);
    n.connect(f).connect(g).connect(audio.master);
  },

  // Creature buzz — happy/neutral fly ambient. Short resonant buzz with
  // per-play frequency variance so a swarm doesn't sound like a drone.
  buzz: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    const pv = 1 + (Math.random() - 0.5) * 0.25;
    const base = 180 * pv;
    const o = _osc('sawtooth', base, t, 0.28);
    o.frequency.linearRampToValueAtTime(base * 1.12, t + 0.12);
    o.frequency.linearRampToValueAtTime(base, t + 0.25);
    const f = _filter('lowpass', 900, 1);
    const g = _gain(t, 0.1, 0.02, 0.22);
    o.connect(f).connect(g).connect(audio.master);
    // Low harmonic for body
    const o2 = _osc('triangle', base * 0.5, t, 0.28);
    const g2 = _gain(t, 0.06, 0.02, 0.22);
    o2.connect(g2).connect(audio.master);
  },

  // Creature grumble — angry fly. Lower, dissonant, longer. Also fires
  // on brawl hits as a secondary vocal under the hit_soft thud.
  grumble: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    const pv = 1 + (Math.random() - 0.5) * 0.15;
    const base = 90 * pv;
    const o = _osc('sawtooth', base, t, 0.45);
    o.frequency.linearRampToValueAtTime(base * 0.75, t + 0.35);
    const f = _filter('lowpass', 500, 1);
    const g = _gain(t, 0.16, 0.01, 0.4);
    o.connect(f).connect(g).connect(audio.master);
    // Noise scrape on top — rasp in the voice
    const n = _noise(t, 0.3);
    const nf = _filter('bandpass', 400, 2);
    const ng = _gain(t, 0.06, 0.02, 0.26);
    n.connect(nf).connect(ng).connect(audio.master);
  },

  // Slap — sharp whip-crack thwack + a tiny creature yelp on top
  slap: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    // Whip-crack: fast high noise burst through a bandpass
    const n = _noise(t, 0.12);
    const nf = _filter('bandpass', 2800, 4);
    nf.frequency.setValueAtTime(3200, t);
    nf.frequency.exponentialRampToValueAtTime(900, t + 0.08);
    const ng = _gain(t, 0.5, 0.001, 0.08);
    n.connect(nf).connect(ng).connect(audio.master);
    // Body: short down-sweep sine thump
    const o = _osc('sine', 480, t, 0.12);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    const g = _gain(t, 0.35, 0.001, 0.1);
    o.connect(g).connect(audio.master);
    // Yelp: high triangle blip with pitch variance
    const pv = 1 + (Math.random() - 0.5) * 0.2;
    const y = _osc('triangle', 1400 * pv, t + 0.03, 0.18);
    y.frequency.exponentialRampToValueAtTime(700 * pv, t + 0.18);
    const yg = _gain(t + 0.03, 0.18, 0.004, 0.16);
    y.connect(yg).connect(audio.master);
  },

  // Hit on flesh / creature — dull thud + squelch
  hit_soft: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    const o = _osc('sine', 180, t, 0.18);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    const g = _gain(t, 0.32, 0.002, 0.16);
    o.connect(g).connect(audio.master);
    const n = _noise(t, 0.1);
    const nf = _filter('lowpass', 800, 1);
    const ng = _gain(t, 0.14, 0.001, 0.09);
    n.connect(nf).connect(ng).connect(audio.master);
  },

  // Hit on armor — metallic clash
  hit_metal: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    const o1 = _osc('square', 520, t, 0.18);
    o1.frequency.exponentialRampToValueAtTime(280, t + 0.12);
    const f = _filter('bandpass', 900, 5);
    const g1 = _gain(t, 0.22, 0.001, 0.15);
    o1.connect(f).connect(g1).connect(audio.master);
    // High ring
    const o2 = _osc('triangle', 2400, t, 0.3);
    const g2 = _gain(t, 0.1, 0.002, 0.25);
    o2.connect(g2).connect(audio.master);
  },

  // Deep boom when heart takes damage
  heart_hit: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    const o = _osc('sine', 70, t, 0.6);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    const g = _gain(t, 0.55, 0.005, 0.55);
    o.connect(g).connect(audio.master);
    const n = _noise(t, 0.2);
    const nf = _filter('lowpass', 200, 1);
    const ng = _gain(t, 0.3, 0.002, 0.18);
    n.connect(nf).connect(ng).connect(audio.master);
  },

  // Enemy death — puff + low sigh
  death: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    const o = _osc('sawtooth', 320, t, 0.35);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.3);
    const lp = _filter('lowpass', 1200, 1);
    const g = _gain(t, 0.22, 0.005, 0.3);
    o.connect(lp).connect(g).connect(audio.master);
    const n = _noise(t, 0.25);
    const nf = _filter('highpass', 1000, 1);
    const ng = _gain(t, 0.15, 0.005, 0.22);
    n.connect(nf).connect(ng).connect(audio.master);
  },

  // Wave warning — brass horn alarm, two notes
  alarm: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    // First blast
    [220, 330].forEach((f, i) => {
      const o = _osc('sawtooth', f, t, 0.6);
      const filter = _filter('lowpass', 1600, 2);
      const g = _gain(t, 0.18, 0.03, 0.55);
      o.connect(filter).connect(g).connect(audio.master);
    });
    // Second blast, a fifth higher
    [330, 495].forEach((f, i) => {
      const o = _osc('sawtooth', f, t + 0.35, 0.6);
      const filter = _filter('lowpass', 2000, 2);
      const g = _gain(t + 0.35, 0.18, 0.03, 0.55);
      o.connect(filter).connect(g).connect(audio.master);
    });
  },

  // Battle drum — on wave spawn
  drum: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const dt = i * 0.16;
      const o = _osc('sine', 120, t + dt, 0.2);
      o.frequency.exponentialRampToValueAtTime(50, t + dt + 0.15);
      const g = _gain(t + dt, 0.38, 0.002, 0.18);
      o.connect(g).connect(audio.master);
      const n = _noise(t + dt, 0.1);
      const nf = _filter('bandpass', 300, 1);
      const ng = _gain(t + dt, 0.18, 0.001, 0.08);
      n.connect(nf).connect(ng).connect(audio.master);
    }
  },

  // Game over — deep discord
  game_over: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    [55, 58.27, 82.41, 87.31].forEach((f, i) => {  // dissonant cluster (low C, slightly detuned)
      const o = _osc('sawtooth', f, t, 3.5);
      o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 2.8);
      const lp = _filter('lowpass', 800, 2);
      const g = _gain(t, 0.12, 0.05, 3.2);
      o.connect(lp).connect(g).connect(audio.master);
    });
    // Shattering noise
    const n = _noise(t, 1.5);
    const nf = _filter('highpass', 2000, 1);
    const ng = _gain(t, 0.2, 0.005, 1.4);
    n.connect(nf).connect(ng).connect(audio.master);
  },

  // Lightning spell — bright crackle + deep thunder
  lightning: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    // Sharp crackle
    const n = _noise(t, 0.4);
    const f = _filter('highpass', 1500, 1);
    f.frequency.setValueAtTime(600, t);
    f.frequency.linearRampToValueAtTime(3800, t + 0.12);
    const g = _gain(t, 0.4, 0.003, 0.35);
    n.connect(f).connect(g).connect(audio.master);
    // Thunder rumble follows
    const o = _osc('sine', 95, t + 0.06, 0.7);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.55);
    const g2 = _gain(t + 0.06, 0.48, 0.015, 0.6);
    o.connect(g2).connect(audio.master);
    // Mid harmonic for body
    const o2 = _osc('sawtooth', 180, t, 0.25);
    o2.frequency.exponentialRampToValueAtTime(60, t + 0.2);
    const lp = _filter('lowpass', 1200, 1);
    const g3 = _gain(t, 0.18, 0.002, 0.22);
    o2.connect(lp).connect(g3).connect(audio.master);
  },

  // Heal spell — rising bright chime (major triad arpeggio)
  heal: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => {  // C5, E5, G5, C6
      const o = _osc('triangle', f, t + i * 0.06, 0.55);
      const g = _gain(t + i * 0.06, 0.14, 0.008, 0.45);
      o.connect(g).connect(audio.master);
    });
    // Warm sub undertone
    const sub = _osc('sine', 130.81, t, 0.6);  // C3
    const gs = _gain(t, 0.1, 0.02, 0.55);
    sub.connect(gs).connect(audio.master);
  },

  // Spell failed (cooldown / no gold) — short descending tone
  spell_fail: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    const o = _osc('sawtooth', 260, t, 0.22);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
    const lp = _filter('lowpass', 600, 1);
    const g = _gain(t, 0.2, 0.005, 0.2);
    o.connect(lp).connect(g).connect(audio.master);
  },

  // Level up — rising triad with shimmer tail
  levelup: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = _osc('triangle', f, t + i * 0.05, 0.4);
      const g = _gain(t + i * 0.05, 0.17, 0.008, 0.35);
      o.connect(g).connect(audio.master);
    });
    // Shimmer
    const sh = _osc('sine', 1046.50, t + 0.12, 0.35);
    const gsh = _gain(t + 0.12, 0.12, 0.01, 0.32);
    sh.connect(gsh).connect(audio.master);
  },

  // Victory fanfare — triumphant stacked chords, rising
  victory: () => {
    const ctx = audio.ctx, t = ctx.currentTime;
    // Chord 1: C major (C4, E4, G4)
    [261.63, 329.63, 392.00].forEach((f) => {
      const o = _osc('triangle', f, t, 1.6);
      const g = _gain(t, 0.18, 0.03, 1.5);
      o.connect(g).connect(audio.master);
    });
    // Chord 2: F major (F4, A4, C5) at 0.35s
    [349.23, 440.00, 523.25].forEach((f) => {
      const o = _osc('triangle', f, t + 0.35, 1.6);
      const g = _gain(t + 0.35, 0.18, 0.03, 1.5);
      o.connect(g).connect(audio.master);
    });
    // Chord 3: G → C resolution (G4, B4, D5, G5), held brightly
    [392.00, 493.88, 587.33, 783.99].forEach((f) => {
      const o = _osc('sawtooth', f, t + 0.75, 2.4);
      const lp = _filter('lowpass', 2800, 1);
      const g = _gain(t + 0.75, 0.14, 0.04, 2.3);
      o.connect(lp).connect(g).connect(audio.master);
    });
    // Low sub for weight
    const sub = _osc('sine', 130.81, t, 3.2);  // C3
    const gs = _gain(t, 0.18, 0.05, 3.1);
    sub.connect(gs).connect(audio.master);
  },
};

// Ambient dungeon heartbeat — low thump-thump every ~1.6s when playing
function _startHeartbeat() {
  if (audio.heartbeatTimer) clearInterval(audio.heartbeatTimer);
  audio.heartbeatTimer = setInterval(() => {
    if (!audio.ctx || audio.muted || audio.ctx.state !== 'running') return;
    if (GAME.over) return;
    // Heart HP modulates rate: low HP = faster (panic). Guard heart reference.
    const heart = heartRef.heart;
    const frac = (heart && heart.userData.maxHp)
      ? heart.userData.hp / heart.userData.maxHp : 1;
    const ctx = audio.ctx, t = ctx.currentTime;
    const vol = 0.15 + (1 - frac) * 0.2;  // louder when critical
    [[55, 0], [42, 0.18]].forEach(([freq, delay]) => {
      const o = _osc('sine', freq, t + delay, 0.3);
      o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + delay + 0.22);
      const g = _gain(t + delay, vol, 0.005, 0.25);
      o.connect(g).connect(audio.master);
    });
  }, 1600);
}
