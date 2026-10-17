/**
 * WebAudio synthesis for every sound in the game.
 *
 * There are no audio files: gunshots are shaped noise bursts, explosions add a
 * pitched-down sine, pickups are short FM blips and the jetpack is a looped noise
 * source whose gain tracks how hard the player is thrusting.
 */

let ctx = null;
let master = null;
let noiseBuffer = null;
const loops = { jet: null };
let muted = false;

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);

  const seconds = 2;
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

/** Must be called from a user gesture on most browsers. */
export function unlockAudio() {
  const c = ensureContext();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

export function setMuted(value) {
  muted = !!value;
  if (master) master.gain.value = muted ? 0 : 0.55;
}

export function isMuted() {
  return muted;
}

function now() {
  return ctx.currentTime;
}

function noise(duration, { gain = 0.4, type = 'lowpass', freq = 1200, q = 1, attack = 0.002, sweep = 0 } = {}) {
  const c = ensureContext();
  if (!c || muted) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, now());
  if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), now() + duration);
  filter.Q.value = q;
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, now());
  env.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), now() + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, now() + duration);
  src.connect(filter).connect(env).connect(master);
  src.start();
  src.stop(now() + duration + 0.02);
}

function tone(freq, duration, { gain = 0.25, type = 'sine', to = null, attack = 0.004 } = {}) {
  const c = ensureContext();
  if (!c || muted) return;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now());
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now() + duration);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, now());
  env.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), now() + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, now() + duration);
  osc.connect(env).connect(master);
  osc.start();
  osc.stop(now() + duration + 0.02);
}

const SHOT_PROFILE = {
  sidearm: { gain: 0.34, freq: 1500, dur: 0.11, tone: 210, type: 'square' },
  ripper: { gain: 0.22, freq: 2000, dur: 0.07, tone: 300, type: 'square' },
  bulldog: { gain: 0.30, freq: 1250, dur: 0.13, tone: 170, type: 'sawtooth' },
  boomstick: { gain: 0.46, freq: 800, dur: 0.3, tone: 90, type: 'sawtooth' },
  longshot: { gain: 0.5, freq: 1900, dur: 0.22, tone: 130, type: 'square' },
  shredder: { gain: 0.18, freq: 2400, dur: 0.05, tone: 380, type: 'square' },
  flamer: { gain: 0.1, freq: 900, dur: 0.08, tone: 140, type: 'triangle' },
  rocket: { gain: 0.44, freq: 500, dur: 0.4, tone: 80, type: 'sawtooth' },
  frag: { gain: 0.3, freq: 700, dur: 0.16, tone: 150, type: 'triangle' },
  basher: { gain: 0.24, freq: 2600, dur: 0.09, tone: 420, type: 'triangle' },
};

export function playShot(weaponId, distanceGain = 1) {
  const p = SHOT_PROFILE[weaponId] ?? SHOT_PROFILE.sidearm;
  const g = Math.max(0.02, p.gain * distanceGain);
  noise(p.dur, { gain: g, freq: p.freq, sweep: 0.35, q: 1.2 });
  tone(p.tone, p.dur * 1.2, { gain: g * 0.5, type: p.type, to: p.tone * 0.55 });
}

export function playExplosion(distanceGain = 1) {
  const g = Math.max(0.05, distanceGain);
  noise(0.7, { gain: 0.55 * g, freq: 900, sweep: 0.08, q: 0.7 });
  tone(120, 0.65, { gain: 0.5 * g, type: 'sine', to: 32 });
  tone(70, 0.9, { gain: 0.35 * g, type: 'triangle', to: 24 });
}

export function playHitMark() {
  tone(1500, 0.06, { gain: 0.13, type: 'square', to: 1100 });
}

export function playHurt() {
  noise(0.16, { gain: 0.3, freq: 500, sweep: 0.4 });
  tone(180, 0.18, { gain: 0.2, type: 'sawtooth', to: 90 });
}

export function playDeath() {
  tone(420, 0.9, { gain: 0.3, type: 'sawtooth', to: 60 });
  noise(0.5, { gain: 0.2, freq: 400, sweep: 0.2 });
}

export function playPickup() {
  tone(880, 0.1, { gain: 0.18, type: 'triangle', to: 1320 });
  tone(1320, 0.12, { gain: 0.12, type: 'sine' });
}

export function playReload(stage = 0) {
  noise(0.05, { gain: 0.16, freq: 3200, type: 'highpass' });
  tone(stage ? 520 : 380, 0.05, { gain: 0.1, type: 'square' });
}

export function playJump() {
  tone(240, 0.12, { gain: 0.14, type: 'triangle', to: 420 });
}

export function playKill() {
  tone(660, 0.1, { gain: 0.2, type: 'square' });
  setTimeout(() => tone(990, 0.14, { gain: 0.18, type: 'square' }), 80);
}

export function playCountdownBeep(final = false) {
  tone(final ? 1200 : 700, final ? 0.4 : 0.12, { gain: 0.22, type: 'square' });
}

export function playMatchEnd(win = true) {
  const notes = win ? [523, 659, 784, 1047] : [523, 440, 349, 262];
  notes.forEach((f, i) => setTimeout(() => tone(f, 0.28, { gain: 0.2, type: 'triangle' }), i * 150));
}

/** Continuous jetpack rumble; call with the current thrust intensity (0..1). */
export function setJetIntensity(intensity) {
  const c = ensureContext();
  if (!c || muted) {
    if (loops.jet) loops.jet.gain.gain.value = 0;
    return;
  }
  if (!loops.jet) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 620;
    filter.Q.value = 0.8;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(master);
    src.start();
    loops.jet = { src, gain };
  }
  const target = Math.max(0, Math.min(1, intensity)) * 0.24;
  loops.jet.gain.gain.setTargetAtTime(target, now(), 0.05);
}

export function stopAllLoops() {
  setJetIntensity(0);
}
