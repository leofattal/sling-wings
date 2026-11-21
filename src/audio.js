// Procedural audio (no files): a small mixing desk with reverb + compressor, continuous flight
// layers (wind, prop engine, rocket roar, slingshot creak), layered one-shots, and a generative
// background music loop.
let ctx = null, master, sfxBus, musicBus, reverb, noiseBuf;
let layers = null;
let sfxOn = true, musicOn = true;
try { sfxOn = localStorage.getItem('sw.sfx') !== '0'; musicOn = localStorage.getItem('sw.music') !== '0'; } catch (e) { /* storage blocked */ }

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master = ctx.createGain(); master.gain.value = 0.9;
  master.connect(comp).connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? 1 : 0; sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? 0.32 : 0; musicBus.connect(master);
  // generated reverb impulse
  reverb = ctx.createConvolver();
  const len = ctx.sampleRate * 1.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  reverb.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.22;
  reverb.connect(wet).connect(master);
  // brown-ish noise buffer
  const nl = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, nl, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < nl; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; nd[i] = last * 3.5 + (Math.random() * 2 - 1) * 0.05; }
  buildLayers();
  startMusic();
}

const noiseSrc = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
const filt = (type, f, q = 1) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

function buildLayers() {
  // wind: two bands, with slow random gusts
  const windLo = filt('lowpass', 400), windHi = filt('bandpass', 1800, 0.6);
  const windG = gain(0), windHG = gain(0);
  const n1 = noiseSrc(); n1.connect(windLo).connect(windG).connect(sfxBus);
  const n2 = noiseSrc(); n2.playbackRate.value = 1.3; n2.connect(windHi).connect(windHG).connect(sfxBus);
  // prop engine: detuned saws with an amplitude "chop" LFO = propeller blades
  const engF = filt('lowpass', 600, 2), engG = gain(0);
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 70;
  const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 70.7;
  const chop = gain(0.5), lfo = ctx.createOscillator(); lfo.frequency.value = 28;
  const lfoAmt = gain(0.5); lfo.connect(lfoAmt).connect(chop.gain);
  o1.connect(chop); o2.connect(chop); chop.connect(engF).connect(engG).connect(sfxBus);
  [o1, o2, lfo].forEach(o => o.start());
  // rocket: roaring noise + low rumble + crackle
  const rkF = filt('lowpass', 1400, 0.7), rkG = gain(0);
  const rn = noiseSrc(); rn.playbackRate.value = 0.7; rn.connect(rkF).connect(rkG).connect(sfxBus);
  const rum = ctx.createOscillator(); rum.type = 'triangle'; rum.frequency.value = 48; rum.start();
  const rumG = gain(0); rum.connect(rumG).connect(sfxBus);
  const crk = gain(0), crkF = filt('highpass', 2500); const cn = noiseSrc(); cn.connect(crkF).connect(crk).connect(sfxBus);
  rkG.connect(reverb);
  // slingshot creak (rubber stretch): bandpassed saw whose pitch follows the pull
  const crF = filt('bandpass', 500, 6), crG = gain(0);
  const cro = ctx.createOscillator(); cro.type = 'sawtooth'; cro.frequency.value = 90; cro.start();
  cro.connect(crF).connect(crG).connect(sfxBus);
  layers = { windLo, windG, windHi, windHG, engF, engG, o1, o2, lfo, rkF, rkG, rumG, crk, crF, crG, cro, gust: 0 };
}

export function setFlightSound(speed, boosting, flying, propOn = true) {
  if (!layers) return;
  const t = ctx.currentTime, L = layers;
  L.gust += (Math.random() - 0.5) * 0.08; L.gust *= 0.98;
  const gust = 1 + L.gust * 2;
  const on = flying ? 1 : 0;
  L.windG.gain.setTargetAtTime(on * Math.min(0.45, 0.05 + speed * 0.007) * gust, t, 0.2);
  L.windLo.frequency.setTargetAtTime(220 + speed * 26, t, 0.2);
  L.windHG.gain.setTargetAtTime(on * Math.max(0, speed - 20) * 0.004 * gust, t, 0.2);
  L.windHi.frequency.setTargetAtTime(1200 + speed * 30, t, 0.2);
  const rpm = 60 + speed * 2.4 + (boosting ? 40 : 0);
  L.o1.frequency.setTargetAtTime(rpm, t, 0.15); L.o2.frequency.setTargetAtTime(rpm * 1.01, t, 0.15);
  L.lfo.frequency.setTargetAtTime(rpm * 0.4, t, 0.15);
  L.engG.gain.setTargetAtTime(on * (propOn ? 0.05 : 0), t, 0.3);
  L.engF.frequency.setTargetAtTime(400 + speed * 12, t, 0.2);
  const b = on && boosting ? 1 : 0;
  L.rkG.gain.setTargetAtTime(b * 0.55, t, 0.05);
  L.rumG.gain.setTargetAtTime(b * 0.25, t, 0.05);
  L.crk.gain.setTargetAtTime(b * (Math.random() < 0.3 ? 0.25 : 0.02), t, 0.01);
}

export function setStretch(power) {
  if (!layers) return;
  const t = ctx.currentTime;
  layers.crG.gain.setTargetAtTime(power > 0.02 ? 0.05 + power * 0.06 : 0, t, 0.04);
  layers.cro.frequency.setTargetAtTime(70 + power * 140, t, 0.05);
  layers.crF.frequency.setTargetAtTime(400 + power * 900, t, 0.05);
}

/* ---------------- one-shots ---------------- */
function out(pan = 0, wet = 0) {
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : gain(1);
  if (p.pan) p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(sfxBus);
  if (wet) { const w = gain(wet); p.connect(w); w.connect(reverb); }
  return p;
}
function tone(f, dur, { type = 'sine', vol = 0.2, slide = 0, at = 0, pan = 0, wet = 0.3, attack = 0.005 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out(pan, wet));
  o.start(t); o.stop(t + dur + 0.05);
}
function bell(f, dur, vol, at = 0, pan = 0) { // two inharmonic partials = bell / chime
  tone(f, dur, { vol, at, pan, wet: 0.5 });
  tone(f * 2.76, dur * 0.6, { vol: vol * 0.4, at, pan, wet: 0.5 });
  tone(f * 5.4, dur * 0.3, { vol: vol * 0.15, at, pan, wet: 0.5 });
}
function noise(dur, { type = 'bandpass', f = 1000, f2 = 0, q = 1, vol = 0.3, at = 0, pan = 0, wet = 0.2, attack = 0.005 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 1.6;
  const b = filt(type, f, q);
  if (f2) b.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(b).connect(g).connect(out(pan, wet));
  s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
let combo = 0, comboT = 0;

export const sfx = {
  coin(pan) {
    const now = performance.now();
    combo = now - comboT < 450 ? Math.min(combo + 1, PENTA.length - 1) : 0; comboT = now;
    bell(988 * Math.pow(2, PENTA[combo] / 12), 0.35, 0.07, 0, pan);
  },
  gem(pan) { [0, 4, 7, 12, 16].forEach((s, i) => bell(1175 * Math.pow(2, s / 12), 0.5, 0.06, i * 0.05, pan)); },
  star() { [0, 4, 7, 11, 14, 19].forEach((s, i) => bell(784 * Math.pow(2, s / 12), 0.6, 0.07, i * 0.06)); noise(0.8, { f: 3000, f2: 9000, vol: 0.08, wet: 0.6 }); },
  fuel(pan) { for (let i = 0; i < 3; i++) tone(260 + i * 90, 0.12, { type: 'sine', vol: 0.15, slide: 160, at: i * 0.07, pan }); },
  ring(pan) {
    noise(0.45, { f: 500, f2: 4000, q: 2, vol: 0.18, pan, wet: 0.4 });
    [0, 4, 7, 12].forEach((s, i) => tone(523 * Math.pow(2, s / 12), 0.35, { type: 'triangle', vol: 0.1, at: 0.04 + i * 0.05, pan, wet: 0.5 }));
  },
  balloon(pan) { tone(220, 0.5, { type: 'sine', vol: 0.3, slide: 400, pan }); tone(330, 0.4, { type: 'triangle', vol: 0.12, slide: -120, at: 0.1, pan }); noise(0.15, { f: 800, vol: 0.12, pan }); },
  bird(pan) { for (let i = 0; i < 3; i++) tone(1300 - i * 200, 0.09, { type: 'square', vol: 0.05, slide: 600, at: i * 0.09, pan, wet: 0.2 }); noise(0.4, { f: 2500, vol: 0.12, pan, wet: 0.2 }); },
  nearMiss(pan) { noise(0.5, { type: 'bandpass', f: 300, f2: 2500, q: 3, vol: 0.3, pan, wet: 0.3, attack: 0.15 }); },
  milestone() { bell(1319, 0.5, 0.08); bell(1760, 0.6, 0.08, 0.09); },
  stretchClick() { tone(180 + Math.random() * 40, 0.04, { type: 'triangle', vol: 0.05, wet: 0 }); },
  launch() {
    tone(160, 0.5, { type: 'sawtooth', vol: 0.18, slide: 700 });           // twang up
    tone(98, 0.6, { type: 'triangle', vol: 0.2, slide: -40, wet: 0.4 });   // body thunk
    noise(0.7, { type: 'bandpass', f: 400, f2: 3000, q: 1.5, vol: 0.25, wet: 0.3 }); // whoosh
  },
  bounce() { tone(140, 0.35, { type: 'sine', vol: 0.35, slide: 260 }); noise(0.2, { f: 300, vol: 0.2 }); },
  crash() {
    noise(0.9, { type: 'lowpass', f: 1800, f2: 200, vol: 0.5, wet: 0.4 });
    tone(70, 0.7, { type: 'sine', vol: 0.5, slide: -40 });
    for (let i = 0; i < 6; i++) noise(0.08, { f: 2000 + Math.random() * 3000, q: 6, vol: 0.15, at: 0.1 + Math.random() * 0.6, pan: Math.random() * 2 - 1 });
  },
  land() { noise(1.0, { f: 900, f2: 250, q: 1.5, vol: 0.25, wet: 0.1, attack: 0.02 }); tone(90, 0.3, { vol: 0.2 }); },
  finish() { [0, 4, 7, 12, 16].forEach((s, i) => { tone(523 * Math.pow(2, s / 12), 0.5, { type: 'triangle', vol: 0.12, at: i * 0.1, wet: 0.5 }); tone(523 * Math.pow(2, (s - 12) / 12), 0.5, { type: 'sine', vol: 0.08, at: i * 0.1 }); }); },
  perfect() { [0, 7, 12, 16, 19, 24].forEach((s, i) => bell(659 * Math.pow(2, s / 12), 0.7, 0.07, i * 0.08)); },
  win() { [0, 4, 7, 12].forEach((s, i) => tone(392 * Math.pow(2, s / 12), 0.6, { type: 'square', vol: 0.05, at: i * 0.13, wet: 0.5 })); bell(1568, 1.2, 0.06, 0.55); },
  buy() { bell(1568, 0.3, 0.08); bell(2093, 0.4, 0.08, 0.07); noise(0.15, { type: 'highpass', f: 5000, vol: 0.08, at: 0.02 }); },
  evolve() { tone(200, 1.4, { type: 'sawtooth', vol: 0.08, slide: 1400, wet: 0.6, attack: 0.3 }); [0, 4, 7, 11, 14, 19, 24].forEach((s, i) => bell(523 * Math.pow(2, s / 12), 0.9, 0.07, 1 + i * 0.07)); },
  mission() { bell(1047, 0.4, 0.07); bell(1319, 0.4, 0.07, 0.1); bell(1568, 0.6, 0.07, 0.2); },
  click() { tone(900, 0.04, { type: 'triangle', vol: 0.05, wet: 0 }); },
  deny() { tone(150, 0.2, { type: 'square', vol: 0.07, slide: -40, wet: 0 }); },
  coinTick() { tone(2200 + Math.random() * 300, 0.03, { type: 'square', vol: 0.025, wet: 0 }); },
};

/* ---------------- music ---------------- */
// I–vi–IV–V in C, soft pad + pentatonic arpeggio + bass. Scheduled ahead on the audio clock.
const CHORDS = [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]];
let musicTimer = 0, nextBeat = 0, beat = 0, intensity = 0;
function startMusic() {
  nextBeat = ctx.currentTime + 0.1;
  musicTimer = setInterval(scheduleMusic, 100);
}
export function setMusicIntensity(v) { intensity = v; }
function mnote(f, t, dur, type, vol, dest = musicBus) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
}
function scheduleMusic() {
  if (!ctx || ctx.state !== 'running') return;
  const spb = 60 / (96 + intensity * 24) / 2; // eighth notes
  while (nextBeat < ctx.currentTime + 0.3) {
    const t = nextBeat, bar = Math.floor(beat / 8) % 4, step = beat % 8;
    const ch = CHORDS[bar];
    const root = 130.81; // C3
    if (step === 0) {
      ch.forEach(s => mnote(root * 2 * Math.pow(2, s / 12), t, spb * 8, 'triangle', 0.05));
      mnote(root / 2 * Math.pow(2, ch[0] / 12), t, spb * 3, 'sine', 0.22);
    }
    if (step === 4) mnote(root / 2 * Math.pow(2, ch[0] / 12), t, spb * 2, 'sine', 0.16);
    const arp = [0, 1, 2, 1, 2, 0, 2, 1][step];
    const oct = step >= 4 ? 2 : 1;
    if (intensity > 0.3 || step % 2 === 0) mnote(root * 2 * oct * Math.pow(2, ch[arp] / 12), t, spb * 1.4, 'square', 0.025 + intensity * 0.01);
    if (intensity > 0.5 && (step === 2 || step === 6)) { // soft hat
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; const hp = filt('highpass', 7000); const g = gain(0.04);
      g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      s.connect(hp).connect(g).connect(musicBus); s.start(t, Math.random()); s.stop(t + 0.06);
    }
    nextBeat += spb; beat++;
  }
}

export function toggleSfx() { sfxOn = !sfxOn; if (sfxBus) sfxBus.gain.value = sfxOn ? 1 : 0; try { localStorage.setItem('sw.sfx', sfxOn ? '1' : '0'); } catch (e) { /* ignore */ } return sfxOn; }
export function toggleMusic() { musicOn = !musicOn; if (musicBus) musicBus.gain.setTargetAtTime(musicOn ? 0.32 : 0, ctx.currentTime, 0.2); try { localStorage.setItem('sw.music', musicOn ? '1' : '0'); } catch (e) { /* ignore */ } return musicOn; }
export const isSfxOn = () => sfxOn;
export const isMusicOn = () => musicOn;
