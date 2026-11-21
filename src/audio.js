// Tiny WebAudio synth: wind that follows airspeed, plus blips. No audio files needed.
let ctx = null, windGain = null, windFilter = null, boostGain = null, muted = false;
try { muted = localStorage.getItem('sw.muted') === '1'; } catch (e) { /* storage blocked */ }

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  const mk = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
  windFilter = ctx.createBiquadFilter(); windFilter.type = 'lowpass'; windFilter.frequency.value = 400;
  windGain = ctx.createGain(); windGain.gain.value = 0;
  mk().connect(windFilter).connect(windGain).connect(ctx.destination);
  const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 900; bf.Q.value = 0.7;
  boostGain = ctx.createGain(); boostGain.gain.value = 0;
  mk().connect(bf).connect(boostGain).connect(ctx.destination);
}

export function setFlightSound(speed, boosting, flying) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const on = flying && !muted;
  windGain.gain.setTargetAtTime(on ? Math.min(0.5, 0.04 + speed * 0.008) : 0, t, 0.15);
  windFilter.frequency.setTargetAtTime(250 + speed * 28, t, 0.2);
  boostGain.gain.setTargetAtTime(on && boosting ? 0.35 : 0, t, 0.06);
}

function tone(freq, dur, type = 'sine', vol = 0.2, slide = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
}

let coinPitch = 0, coinT = 0;
export const sfx = {
  coin() { const now = performance.now(); coinPitch = now - coinT < 400 ? Math.min(coinPitch + 1, 10) : 0; coinT = now; tone(1100 * Math.pow(1.06, coinPitch), 0.12, 'square', 0.06); },
  ring() { tone(660, 0.25, 'triangle', 0.18, 500); setTimeout(() => tone(990, 0.3, 'triangle', 0.15, 300), 70); },
  launch() { tone(220, 0.35, 'sawtooth', 0.12, 500); },
  stretch() { tone(160, 0.05, 'triangle', 0.05); },
  crash() { tone(120, 0.5, 'sawtooth', 0.22, -80); },
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.18), i * 110)); },
  buy() { tone(880, 0.1, 'square', 0.08); setTimeout(() => tone(1320, 0.15, 'square', 0.08), 80); },
  deny() { tone(180, 0.18, 'square', 0.08); },
};

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('sw.muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
  return muted;
}
export const isMuted = () => muted;
