// ============================================================
// BABYLON AUDIO DIRECTOR — compact procedural spatial soundscape
// ============================================================
// No binary audio assets are required: every cue is built from oscillators and
// a cached noise buffer. The manager creates its AudioContext only after a user
// gesture, applies per-cue throttles, caps concurrent voices, and uses panners
// for world-space sounds. This also makes it a dependable fallback while final
// authored sound assets are being produced.

const AUDIO_CONFIG = Object.freeze({
  masterVolume: 0.64,
  effectsVolume: 0.78,
  ambienceVolume: 0.24,
  maxVoices: 24,
  rolloff: 1.25,
  refDistance: 2.2,
  maxDistance: 34,
});

const CUE_CONFIG = Object.freeze({
  dig:       { cooldown: 55,  gain: 0.66, duration: 0.34, spatial: true },
  claim:     { cooldown: 90,  gain: 0.72, duration: 0.62, spatial: true },
  portal:    { cooldown: 220, gain: 0.56, duration: 1.05, spatial: true },
  spawn:     { cooldown: 75,  gain: 0.72, duration: 0.72, spatial: true },
  despawn:   { cooldown: 75,  gain: 0.68, duration: 0.82, spatial: true },
  hit:       { cooldown: 35,  gain: 0.65, duration: 0.3, spatial: true },
  hit_metal: { cooldown: 35,  gain: 0.64, duration: 0.4, spatial: true },
  heal:      { cooldown: 110, gain: 0.66, duration: 0.92, spatial: true },
  lightning: { cooldown: 90, gain: 0.86, duration: 1.05, spatial: true },
  rally:     { cooldown: 300, gain: 0.78, duration: 1.35, spatial: true },
  ui_hover:  { cooldown: 28,  gain: 0.22, duration: 0.07, spatial: false },
  ui_accept: { cooldown: 45,  gain: 0.38, duration: 0.24, spatial: false },
  ui_cancel: { cooldown: 45,  gain: 0.34, duration: 0.2, spatial: false },
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setParam(param, value, time) {
  param.cancelScheduledValues(time);
  param.setValueAtTime(value, time);
}

function rampDown(param, startValue, start, end) {
  setParam(param, Math.max(0.0001, startValue), start);
  param.exponentialRampToValueAtTime(0.0001, end);
}

/**
 * Procedural Web Audio manager for the Babylon runtime.
 *
 * Public lifecycle: installUnlockListeners() -> resume() -> update(dt) -> dispose()
 * Public sound API: play(name, position?, options?), startAmbience(), stopAmbience()
 */
export class AudioDirector {
  constructor(runtime = {}) {
    this.runtime = runtime;
    this.world = null;
    this.context = null;
    this.master = null;
    this.effectsBus = null;
    this.ambienceBus = null;
    this.compressor = null;
    this.noiseBuffer = null;
    this.muted = false;
    this.volumes = {
      master: AUDIO_CONFIG.masterVolume,
      effects: AUDIO_CONFIG.effectsVolume,
      ambience: AUDIO_CONFIG.ambienceVolume,
    };
    this.voices = [];
    this.lastPlayed = new Map();
    this.ambience = null;
    this.unlockElement = null;
    this.unlockHandler = () => this.resume();
    this.disposed = false;
    if (typeof document !== 'undefined') this.installUnlockListeners(runtime.canvas || null);
  }

  attachWorld(world) {
    this.world = world || null;
    return this;
  }

  get ready() {
    return !!this.context && this.context.state === 'running';
  }

  /**
   * Installs autoplay-unlock listeners on the render canvas by default. It is
   * safe to call multiple times; the first successful resume removes them.
   */
  installUnlockListeners(element) {
    if (this.disposed) return;
    const next = element || (this.runtime.engine && this.runtime.engine.getRenderingCanvas
      ? this.runtime.engine.getRenderingCanvas()
      : document);
    this.removeUnlockListeners();
    this.unlockElement = next;
    ['pointerdown', 'touchstart', 'keydown'].forEach((eventName) => {
      next.addEventListener(eventName, this.unlockHandler, { passive: true });
    });
  }

  removeUnlockListeners() {
    if (!this.unlockElement) return;
    ['pointerdown', 'touchstart', 'keydown'].forEach((eventName) => {
      this.unlockElement.removeEventListener(eventName, this.unlockHandler);
    });
    this.unlockElement = null;
  }

  async resume() {
    if (this.disposed || !this._ensureContext()) return false;
    try {
      if (this.context.state === 'suspended') await this.context.resume();
      if (this.context.state === 'running') {
        this.removeUnlockListeners();
        if (!this.ambience) this.startAmbience();
        return true;
      }
    } catch (error) {
      console.warn('[AudioDirector] Browser refused to start audio.', error);
    }
    return false;
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (!this.master || !this.context) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0.0001 : this.volumes.master, now + 0.04);
  }

  setVolumes(volumes = {}) {
    this.volumes.master = clamp(volumes.master ?? this.volumes.master, 0, 1);
    this.volumes.effects = clamp(volumes.effects ?? volumes.sfx ?? this.volumes.effects, 0, 1);
    this.volumes.ambience = clamp(volumes.ambience ?? volumes.ambient ?? this.volumes.ambience, 0, 1);
    if (!this.context) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0.0001 : this.volumes.master, now, 0.025);
    this.effectsBus.gain.setTargetAtTime(this.volumes.effects, now, 0.025);
    this.ambienceBus.gain.setTargetAtTime(this.volumes.ambience, now, 0.08);
  }

  /**
   * Plays a registered procedural cue. Position may be a Babylon Vector3 or
   * any {x,y,z}; pass null for a non-spatial sound. Returns false if throttled.
   */
  play(name, position = null, options = {}) {
    if (this.disposed || this.muted || !this._ensureContext() || this.context.state !== 'running') return false;
    const cue = CUE_CONFIG[name];
    const synth = SYNTHS[name];
    if (!cue || !synth) return false;

    const nowMs = performance.now();
    const cooldown = options.cooldown ?? cue.cooldown;
    const previousPlay = this.lastPlayed.get(name);
    if (previousPlay != null && previousPlay + cooldown > nowMs) return false;
    this.lastPlayed.set(name, nowMs);
    this._trimVoices();
    if (this.voices.length >= AUDIO_CONFIG.maxVoices) this._stopVoice(this.voices[0], 0.015);

    const start = this.context.currentTime;
    const duration = options.duration ?? cue.duration;
    const output = this._makeVoiceOutput(position, options.spatial ?? cue.spatial, (options.gain ?? cue.gain) * (0.94 + Math.random() * 0.12));
    const nodes = synth(this, start, duration, output.input, options) || [];
    const voice = { nodes, output, endsAt: start + duration + 0.12, stopped: false };
    this.voices.push(voice);
    return true;
  }

  // Compatibility with the legacy playSfx(name, opts) calling style.
  playSfx(name, options = {}) {
    return this.play(name, options.position || null, options);
  }

  startAmbience(options = {}) {
    if (this.disposed || !this._ensureContext() || this.context.state !== 'running' || this.ambience) return false;
    const ctx = this.context;
    const now = ctx.currentTime;
    const output = ctx.createGain();
    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(options.gain ?? 0.34, now + 2.2);
    output.connect(this.ambienceBus);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 240;
    lowpass.Q.value = 0.8;
    lowpass.connect(output);

    const droneA = this._osc('sine', options.root ?? 43.65, now, null);
    const droneB = this._osc('triangle', (options.root ?? 43.65) * 1.498, now, null);
    const gainA = ctx.createGain();
    const gainB = ctx.createGain();
    gainA.gain.value = 0.32;
    gainB.gain.value = 0.09;
    droneA.connect(gainA).connect(lowpass);
    droneB.connect(gainB).connect(lowpass);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 165;
    noiseFilter.Q.value = 0.55;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.055;
    noise.connect(noiseFilter).connect(noiseGain).connect(output);
    noise.start(now);

    // Very slow modulation keeps the dungeon bed alive without rhythmic fatigue.
    const lfo = this._osc('sine', 0.071, now, null);
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.10;
    lfo.connect(lfoGain).connect(output.gain);

    this.ambience = { output, nodes: [droneA, droneB, noise, lfo] };
    return true;
  }

  stopAmbience(fadeSeconds = 0.8) {
    if (!this.ambience || !this.context) return;
    const ambience = this.ambience;
    const now = this.context.currentTime;
    rampDown(ambience.output.gain, Math.max(ambience.output.gain.value, 0.0001), now, now + Math.max(0.02, fadeSeconds));
    ambience.nodes.forEach((node) => {
      try { node.stop(now + Math.max(0.03, fadeSeconds) + 0.02); } catch (_) { /* already stopped */ }
    });
    this.ambience = null;
  }

  update() {
    if (this.disposed || !this.context) return;
    this._updateListener();
    this._trimVoices();
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.removeUnlockListeners();
    this.stopAmbience(0.03);
    this.voices.slice().forEach((voice) => this._stopVoice(voice, 0.01));
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') {
      try { await context.close(); } catch (_) { /* browser is already tearing down */ }
    }
  }

  _ensureContext() {
    if (this.context) return true;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return false;
    try {
      const ctx = new Context();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -15;
      compressor.knee.value = 15;
      compressor.ratio.value = 7;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.15;

      const master = ctx.createGain();
      const effectsBus = ctx.createGain();
      const ambienceBus = ctx.createGain();
      master.gain.value = this.muted ? 0.0001 : this.volumes.master;
      effectsBus.gain.value = this.volumes.effects;
      ambienceBus.gain.value = this.volumes.ambience;
      effectsBus.connect(master);
      ambienceBus.connect(master);
      master.connect(compressor).connect(ctx.destination);

      this.context = ctx;
      this.compressor = compressor;
      this.master = master;
      this.effectsBus = effectsBus;
      this.ambienceBus = ambienceBus;
      this.noiseBuffer = this._createNoiseBuffer(2.0);
      return true;
    } catch (error) {
      console.warn('[AudioDirector] Web Audio is unavailable.', error);
      return false;
    }
  }

  _createNoiseBuffer(seconds) {
    const buffer = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * seconds), this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < channel.length; i++) {
      // Slightly correlated noise is less brittle than raw white noise.
      previous = previous * 0.16 + (Math.random() * 2 - 1) * 0.84;
      channel[i] = previous;
    }
    return buffer;
  }

  _makeVoiceOutput(position, spatial, gainValue) {
    const ctx = this.context;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    if (!spatial || !position || !ctx.createPanner) {
      gain.connect(this.effectsBus);
      return { input: gain, gain, panner: null };
    }
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = AUDIO_CONFIG.refDistance;
    panner.maxDistance = AUDIO_CONFIG.maxDistance;
    panner.rolloffFactor = AUDIO_CONFIG.rolloff;
    panner.coneInnerAngle = 360;
    this._setNodePosition(panner, position);
    gain.connect(panner).connect(this.effectsBus);
    return { input: gain, gain, panner };
  }

  _updateListener() {
    const camera = this.runtime.camera || (this.runtime.scene && this.runtime.scene.activeCamera);
    if (!camera) return;
    const position = camera.globalPosition || camera.position;
    const target = camera.getTarget ? camera.getTarget() : null;
    let forward;
    if (target && position) {
      forward = { x: target.x - position.x, y: target.y - position.y, z: target.z - position.z };
      const length = Math.hypot(forward.x, forward.y, forward.z) || 1;
      forward.x /= length;
      forward.y /= length;
      forward.z /= length;
    } else {
      forward = { x: 0, y: 0, z: 1 };
    }
    const handedness = this.runtime.scene && this.runtime.scene.useRightHandedSystem ? 1 : -1;
    const listener = this.context.listener;
    const now = this.context.currentTime;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(position.x, now, 0.015);
      listener.positionY.setTargetAtTime(position.y, now, 0.015);
      listener.positionZ.setTargetAtTime(position.z * handedness, now, 0.015);
      listener.forwardX.setTargetAtTime(forward.x, now, 0.015);
      listener.forwardY.setTargetAtTime(forward.y, now, 0.015);
      listener.forwardZ.setTargetAtTime(forward.z * handedness, now, 0.015);
      listener.upX.setTargetAtTime(0, now, 0.015);
      listener.upY.setTargetAtTime(1, now, 0.015);
      listener.upZ.setTargetAtTime(0, now, 0.015);
    } else {
      listener.setPosition(position.x, position.y, position.z * handedness);
      listener.setOrientation(forward.x, forward.y, forward.z * handedness, 0, 1, 0);
    }
  }

  _setNodePosition(node, position) {
    const now = this.context.currentTime;
    const x = Number(position.x) || 0;
    const y = Number(position.y) || 0;
    const z = (Number(position.z) || 0) * (this.runtime.scene && this.runtime.scene.useRightHandedSystem ? 1 : -1);
    if (node.positionX) {
      node.positionX.setValueAtTime(x, now);
      node.positionY.setValueAtTime(y, now);
      node.positionZ.setValueAtTime(z, now);
    } else {
      node.setPosition(x, y, z);
    }
  }

  _osc(type, frequency, start, duration) {
    const oscillator = this.context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(1, frequency), start);
    oscillator.start(start);
    if (duration != null) oscillator.stop(start + duration + 0.025);
    return oscillator;
  }

  _noise(start, duration) {
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.start(start);
    source.stop(start + duration + 0.025);
    return source;
  }

  _filter(type, frequency, q = 1) {
    const filter = this.context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    return filter;
  }

  _envelope(start, peak, attack, release) {
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), start + Math.max(0.002, attack));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + release);
    return gain;
  }

  _trimVoices() {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      if (this.voices[i].endsAt <= now || this.voices[i].stopped) this.voices.splice(i, 1);
    }
  }

  _stopVoice(voice, fadeSeconds) {
    if (!voice || voice.stopped || !this.context) return;
    voice.stopped = true;
    const now = this.context.currentTime;
    const gain = voice.output && voice.output.gain;
    if (gain) rampDown(gain.gain, Math.max(gain.gain.value, 0.0001), now, now + fadeSeconds);
    voice.nodes.forEach((node) => {
      if (node && typeof node.stop === 'function') {
        try { node.stop(now + fadeSeconds + 0.02); } catch (_) { /* already stopped */ }
      }
    });
  }
}

// ---------- Procedural sound library ----------
// Synths connect into an already spatialized per-voice output and return source
// nodes so the voice limiter can stop them early when the battle gets crowded.
const SYNTHS = {
  dig(audio, t, duration, output) {
    const pitch = 0.93 + Math.random() * 0.15;
    const tick = audio._osc('square', 940 * pitch, t, duration * 0.42);
    tick.frequency.exponentialRampToValueAtTime(270 * pitch, t + duration * 0.34);
    const tickFilter = audio._filter('bandpass', 1450, 2.6);
    const tickGain = audio._envelope(t, 0.28, 0.002, duration * 0.38);
    tick.connect(tickFilter).connect(tickGain).connect(output);
    const thud = audio._osc('sine', 92, t, duration * 0.75);
    thud.frequency.exponentialRampToValueAtTime(39, t + duration * 0.55);
    const thudGain = audio._envelope(t, 0.5, 0.004, duration * 0.65);
    thud.connect(thudGain).connect(output);
    const grit = audio._noise(t, duration * 0.55);
    const gritFilter = audio._filter('bandpass', 2250, 0.8);
    const gritGain = audio._envelope(t, 0.22, 0.002, duration * 0.48);
    grit.connect(gritFilter).connect(gritGain).connect(output);
    return [tick, thud, grit];
  },

  claim(audio, t, duration, output) {
    const root = audio._osc('sine', 105, t, duration);
    root.frequency.exponentialRampToValueAtTime(54, t + duration * 0.7);
    const rootGain = audio._envelope(t, 0.42, 0.006, duration * 0.82);
    root.connect(rootGain).connect(output);
    const shimmer = [392, 523.25, 783.99].map((frequency, index) => {
      const start = t + 0.05 + index * 0.045;
      const oscillator = audio._osc('triangle', frequency, start, duration * 0.75);
      oscillator.connect(audio._envelope(start, 0.12 / (index + 1), 0.01, duration * 0.58)).connect(output);
      return oscillator;
    });
    return [root, ...shimmer];
  },

  portal(audio, t, duration, output) {
    const swirl = audio._osc('sawtooth', 138, t, duration);
    swirl.frequency.exponentialRampToValueAtTime(415, t + duration * 0.48);
    swirl.frequency.exponentialRampToValueAtTime(112, t + duration * 0.9);
    const filter = audio._filter('lowpass', 1200, 3.2);
    filter.frequency.setValueAtTime(420, t);
    filter.frequency.exponentialRampToValueAtTime(2300, t + duration * 0.5);
    const gain = audio._envelope(t, 0.3, 0.035, duration * 0.86);
    swirl.connect(filter).connect(gain).connect(output);
    const air = audio._noise(t, duration * 0.92);
    const airFilter = audio._filter('bandpass', 680, 1.5);
    const airGain = audio._envelope(t, 0.13, 0.04, duration * 0.8);
    air.connect(airFilter).connect(airGain).connect(output);
    return [swirl, air];
  },

  spawn(audio, t, duration, output) {
    const rise = audio._osc('sawtooth', 145, t, duration * 0.75);
    rise.frequency.exponentialRampToValueAtTime(660, t + duration * 0.58);
    const filter = audio._filter('lowpass', 1800, 1.4);
    const gain = audio._envelope(t, 0.3, 0.008, duration * 0.68);
    rise.connect(filter).connect(gain).connect(output);
    const ping = audio._osc('triangle', 1046.5, t + duration * 0.25, duration * 0.45);
    ping.connect(audio._envelope(t + duration * 0.25, 0.13, 0.005, duration * 0.38)).connect(output);
    return [rise, ping];
  },

  despawn(audio, t, duration, output) {
    const fall = audio._osc('sawtooth', 620, t, duration * 0.85);
    fall.frequency.exponentialRampToValueAtTime(78, t + duration * 0.73);
    const filter = audio._filter('lowpass', 1550, 1.3);
    const gain = audio._envelope(t, 0.27, 0.016, duration * 0.76);
    fall.connect(filter).connect(gain).connect(output);
    const air = audio._noise(t, duration * 0.72);
    const airFilter = audio._filter('bandpass', 510, 1.2);
    airFilter.frequency.exponentialRampToValueAtTime(155, t + duration * 0.68);
    air.connect(airFilter).connect(audio._envelope(t, 0.15, 0.02, duration * 0.65)).connect(output);
    return [fall, air];
  },

  hit(audio, t, duration, output) {
    const body = audio._osc('sine', 195, t, duration * 0.72);
    body.frequency.exponentialRampToValueAtTime(63, t + duration * 0.52);
    body.connect(audio._envelope(t, 0.54, 0.002, duration * 0.62)).connect(output);
    const noise = audio._noise(t, duration * 0.45);
    noise.connect(audio._filter('lowpass', 730, 0.7)).connect(audio._envelope(t, 0.23, 0.001, duration * 0.38)).connect(output);
    return [body, noise];
  },

  hit_metal(audio, t, duration, output) {
    const clang = audio._osc('square', 610 + Math.random() * 90, t, duration * 0.55);
    clang.frequency.exponentialRampToValueAtTime(245, t + duration * 0.45);
    clang.connect(audio._filter('bandpass', 1120, 5)).connect(audio._envelope(t, 0.34, 0.002, duration * 0.5)).connect(output);
    const ring = audio._osc('sine', 2300 + Math.random() * 350, t, duration * 0.88);
    ring.connect(audio._envelope(t, 0.15, 0.002, duration * 0.8)).connect(output);
    return [clang, ring];
  },

  heal(audio, t, duration, output) {
    const frequencies = [523.25, 659.25, 783.99, 1046.5];
    return frequencies.map((frequency, index) => {
      const start = t + index * 0.075;
      const oscillator = audio._osc(index === 3 ? 'sine' : 'triangle', frequency, start, duration * 0.75);
      oscillator.connect(audio._envelope(start, 0.19 / (1 + index * 0.2), 0.012, duration * 0.58)).connect(output);
      return oscillator;
    });
  },

  lightning(audio, t, duration, output) {
    const crack = audio._noise(t, duration * 0.42);
    const crackFilter = audio._filter('highpass', 1150, 0.8);
    crackFilter.frequency.exponentialRampToValueAtTime(4200, t + duration * 0.12);
    crack.connect(crackFilter).connect(audio._envelope(t, 0.72, 0.001, duration * 0.31)).connect(output);
    const thunder = audio._osc('sine', 104, t + 0.035, duration * 0.9);
    thunder.frequency.exponentialRampToValueAtTime(28, t + duration * 0.72);
    thunder.connect(audio._envelope(t + 0.035, 0.64, 0.008, duration * 0.75)).connect(output);
    const body = audio._osc('sawtooth', 186, t, duration * 0.34);
    body.frequency.exponentialRampToValueAtTime(55, t + duration * 0.28);
    body.connect(audio._filter('lowpass', 1050, 1)).connect(audio._envelope(t, 0.24, 0.002, duration * 0.3)).connect(output);
    return [crack, thunder, body];
  },

  rally(audio, t, duration, output) {
    const root = 146.83;
    const notes = [root, root * 1.5, root * 2, root * 2.5];
    const horn = notes.map((frequency, index) => {
      const start = t + index * 0.085;
      const oscillator = audio._osc('sawtooth', frequency, start, duration * 0.74);
      oscillator.connect(audio._filter('lowpass', 1450 + index * 190, 1.8))
        .connect(audio._envelope(start, 0.18, 0.025, duration * 0.58)).connect(output);
      return oscillator;
    });
    const drum = audio._osc('sine', 102, t, duration * 0.26);
    drum.frequency.exponentialRampToValueAtTime(41, t + duration * 0.2);
    drum.connect(audio._envelope(t, 0.52, 0.003, duration * 0.23)).connect(output);
    return [...horn, drum];
  },

  ui_hover(audio, t, duration, output) {
    const oscillator = audio._osc('sine', 980, t, duration);
    oscillator.frequency.exponentialRampToValueAtTime(1120, t + duration * 0.8);
    oscillator.connect(audio._envelope(t, 0.22, 0.002, duration * 0.78)).connect(output);
    return [oscillator];
  },

  ui_accept(audio, t, duration, output) {
    return [523.25, 783.99].map((frequency, index) => {
      const start = t + index * 0.045;
      const oscillator = audio._osc('triangle', frequency, start, duration * 0.78);
      oscillator.connect(audio._envelope(start, 0.24, 0.004, duration * 0.62)).connect(output);
      return oscillator;
    });
  },

  ui_cancel(audio, t, duration, output) {
    const oscillator = audio._osc('triangle', 420, t, duration);
    oscillator.frequency.exponentialRampToValueAtTime(180, t + duration * 0.78);
    oscillator.connect(audio._envelope(t, 0.24, 0.003, duration * 0.7)).connect(output);
    return [oscillator];
  },
};
