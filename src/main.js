import * as THREE from 'three';
import { loadAll, planeModel } from './assets.js';
import { buildWorld } from './world.js';
import { buildParts } from './parts.js';
import { makeLevel, updraftAt, chunkIndex, CHUNK, LEVEL_COUNT, LEVEL_NAMES, LEVEL_TIPS, ENDLESS, ENDLESS_UNLOCK, levelLength } from './levels.js';
import { makeStats, newFlight, stepFlight, touchdown, UPGRADES, FORMS, MAX_TIER, TOTAL_TIERS } from './physics.js';
import { initAudio, setFlightSound, setStretch, setMusicIntensity, sfx, toggleSfx, toggleMusic, isSfxOn, isMusicOn } from './audio.js';
import { startDisplayXR } from './displayxr.js';
import './style.css';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEBUG = location.search.includes('debug');
const ALL = LEVEL_COUNT + 1; // 15 levels + endless

/* ---------------- save ---------------- */
const SAVE_KEY = 'slingwings.v2';
const save = {
  coins: 0, up: Object.fromEntries(UPGRADES.map(u => [u.id, 0])), form: 'c172', forms: ['c172'],
  cleared: 0, best: Array(ALL).fill(0), stars: Array(LEVEL_COUNT).fill(0), missions: [],
  stats: { flights: 0, totalDist: 0, bestSpeed: 0, bestAlt: 0, earned: 0, perfect: 0, merges: 0 },
  garage: [0, -1, -1, -1, -1, -1, -1, -1], bought: 0, garageT: Date.now(), bank: 0, launch: 'sling', boost: 1,
};
let hadSave = false;
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (s) { hadSave = true; Object.assign(save, s, { up: { ...save.up, ...s.up }, stats: { ...save.stats, ...s.stats } }); }
  else {
    const v1 = JSON.parse(localStorage.getItem('slingwings.v1'));
    if (v1) { save.coins = v1.coins || 0; save.cleared = v1.cleared || 0; Object.assign(save.up, v1.up || {}); (v1.best || []).forEach((b, i) => (save.best[i] = b)); }
  }
} catch (e) { /* fresh save */ }
while (save.best.length < ALL) save.best.push(0);
// saves from before the garage: park the best plane you already evolved in the first bay
if (!Array.isArray(save.garage) || save.garage.length !== 8) save.garage = [0, -1, -1, -1, -1, -1, -1, -1];
if (hadSave && !JSON.parse(localStorage.getItem(SAVE_KEY) || '{}').garage) save.garage[0] = Math.max(0, ...save.forms.map(id => FORMS.findIndex(f => f.id === id)));
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage blocked */ } };
const tiersBought = () => UPGRADES.reduce((a, u) => a + save.up[u.id], 0);
const formOf = id => FORMS.find(f => f.id === id) || FORMS[0];

/* ---------------- missions ---------------- */
const MISSIONS = [
  { id: 'd500', text: 'Fly 500 m in one flight', reward: 80, test: f => f.dist >= 500 },
  { id: 'd1500', text: 'Fly 1,500 m in one flight', reward: 250, test: f => f.dist >= 1500 },
  { id: 'd3000', text: 'Fly 3,000 m in one flight', reward: 700, test: f => f.dist >= 3000 },
  { id: 'd5000', text: 'Fly 5,000 m in one flight', reward: 1500, test: f => f.dist >= 5000 },
  { id: 'v150', text: 'Hit 150 km/h', reward: 120, test: f => f.maxV * 3.6 >= 150 },
  { id: 'v250', text: 'Hit 250 km/h', reward: 450, test: f => f.maxV * 3.6 >= 250 },
  { id: 'a50', text: 'Climb 50 m above the ground', reward: 120, test: f => f.maxAlt >= 50 },
  { id: 'a100', text: 'Climb 100 m above the ground', reward: 400, test: f => f.maxAlt >= 100 },
  { id: 'c50', text: 'Grab 50 coins in one flight', reward: 200, test: f => f.coins >= 50 },
  { id: 'c150', text: 'Grab 150 coins in one flight', reward: 600, test: f => f.coins >= 150 },
  { id: 'r10', text: 'Fly through 10 rings in one flight', reward: 300, test: f => f.rings >= 10 },
  { id: 'perfect', text: 'Make a perfect landing', reward: 100, test: f => f.landing === 'perfect' },
  { id: 'b3', text: 'Bounce 3 times in one flight', reward: 250, test: f => f.bounces >= 3 },
  { id: 'nm5', text: '5 close calls in one flight', reward: 250, test: f => f.nearMiss >= 5 },
  { id: 'bl5', text: 'Bounce off 5 balloons in one flight', reward: 250, test: f => f.balloons >= 5 },
  { id: 'g5', text: 'Collect 5 gems in one flight', reward: 300, test: f => f.gems >= 5 },
  { id: 'evo2', text: 'Evolve into the Courier', reward: 400, test: () => save.forms.includes('citation2') },
  { id: 'evo4', text: 'Evolve into the Jumbo', reward: 2000, test: () => save.forms.includes('b789') },
  { id: 'evo6', text: 'Evolve into the Orbiter', reward: 5000, test: () => save.forms.includes('ufo') },
  { id: 'm10', text: 'Merge 10 planes in the garage', reward: 300, test: () => save.stats.merges >= 10 },
  { id: 'rw', text: 'Perfect runway takeoff', reward: 150, test: f => f.perfectTakeoff },
  { id: 'lv5', text: 'Clear level 5', reward: 250, test: () => save.cleared >= 5 },
  { id: 'lv10', text: 'Clear level 10', reward: 800, test: () => save.cleared >= 10 },
  { id: 'lv15', text: 'Clear all 15 levels', reward: 2500, test: () => save.cleared >= 15 },
  { id: 'stars', text: 'Earn 30 stars', reward: 1000, test: () => save.stars.reduce((a, s) => a + popcount(s), 0) >= 30 },
  { id: 'endless', text: 'Endless: fly 3,000 m', reward: 900, test: f => f.endless && f.dist >= 3000 },
  { id: 'total', text: 'Fly 25 km in total', reward: 1200, test: () => save.stats.totalDist >= 25000 },
];
const popcount = s => (s & 1) + ((s >> 1) & 1) + ((s >> 2) & 1);

/* ---------------- renderer ---------------- */
const canvas = $('c');
const MOBILE = window.matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
// graphics quality: auto adapts pixel density (and shadows) to the measured frame rate
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } } };
let quality = store.get('sw.quality', 'auto'); // auto | high | low
const DPR_STEPS = [2, 1.5, 1.25, 1];
let dprStep = MOBILE ? 1 : 0;
const AHEAD = MOBILE ? 4 : 5;
function applyQuality() {
  const dpr = window.devicePixelRatio || 1;
  const step = quality === 'high' ? 0 : quality === 'low' ? 3 : dprStep;
  renderer.setPixelRatio(Math.min(dpr, DPR_STEPS[step]));
  const shadows = !(quality === 'low' || (quality === 'auto' && dprStep >= 3));
  if (renderer.shadowMap.enabled !== shadows) { renderer.shadowMap.enabled = shadows; scene?.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
  resize();
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_STEPS[dprStep]));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 560);
const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x5fae47, 1.1);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
sun.shadow.bias = -0.0006;
scene.add(hemi, sun, sun.target);
const lights = { hemi, sun };

let dxr = null;
function resize() {
  if (dxr && dxr.active) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = w < h ? 62 : 50; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/* ---------------- game state ---------------- */
let phase = 'loading'; // loading | title | hangar | aim | fly | end
let levelN = 0, LV = null, world = null, plane = null, parts = null, st = null, flight = null;
let fs = null, endInfo = null, endT = 0, starT = 0;
const aim = { power: 0, yaw: 0, pitch: 0.25, dragging: false, sx: 0, sy: 0, keyCharge: false, chargeDir: 1 };
const input = { pitch: 0, steer: 0, boost: false };
const keys = new Set();
const joy = { active: false, id: -1, sx: 0, sy: 0, x: 0, y: 0 };
let boostTouch = false;

const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }), 36);
dots.frustumCulled = false;
scene.add(dots);

const baseFlame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.8, 10), new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.9 }));
baseFlame.rotation.x = -Math.PI / 2;
const TRAIL_N = 90;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
trail.frustumCulled = false;
scene.add(trail);
let trailCount = 0, trailTick = 0;

// burst particles (coins, crashes, balloons)
const BURST_N = 160;
const burst = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshBasicMaterial({ color: 0xffffff }), BURST_N);
burst.frustumCulled = false;
burst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BURST_N * 3), 3);
scene.add(burst);
const parts3 = Array.from({ length: BURST_N }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3() }));
let burstI = 0;
function spawnBurst(pos, color, n = 12, speed = 6) {
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    const q = parts3[burstI]; burst.setColorAt(burstI, c);
    q.life = 0.6 + Math.random() * 0.4; q.p.copy(pos);
    q.v.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
    burstI = (burstI + 1) % BURST_N;
  }
  burst.instanceColor.needsUpdate = true;
}

/* ---------------- level & plane setup ---------------- */
function loadLevel(n) {
  levelN = n;
  world?.dispose();
  LV = makeLevel(n);
  world = buildWorld(LV, scene, lights, save.up.sling, AHEAD);
  buildRunway();
  syncLaunchMode();
  buildPlane();
  flight = null;
  aim.power = 0; aim.yaw = 0; aim.pitch = 0.25;
  placeOnSling();
  trailCount = 0; trail.visible = false;
}

function buildPlane() {
  if (plane) scene.remove(plane);
  plane = planeModel(save.form);
  plane.rotation.order = 'YXZ';
  plane.traverse(o => { if (o.isMesh) o.castShadow = true; });
  parts = buildParts(save.form, save.up, plane.userData.box);
  plane.add(parts.group);
  if (!parts.flames.length) {
    baseFlame.position.set(0, 0, plane.userData.box.max.z + 0.8);
    plane.add(baseFlame);
    parts.flames.push(baseFlame);
  }
  parts.flames.forEach(f => (f.visible = false));
  scene.add(plane);
  st = makeStats(save.up, save.form);
}

const launchOrigin = () => new THREE.Vector3(0, LV.launchH + 5.0, 0.6);
const aimDir = () => new THREE.Vector3(-Math.sin(aim.yaw) * Math.cos(aim.pitch), Math.sin(aim.pitch), -Math.cos(aim.yaw) * Math.cos(aim.pitch));
function placeOnSling() {
  const d = aimDir();
  const p = launchOrigin().addScaledVector(d, -aim.power * 3.2);
  plane.position.copy(p);
  plane.rotation.set(aim.pitch, aim.yaw, 0);
  const local = p.clone().sub(world.sling.group.position);
  local.addScaledVector(d, -(plane.userData.box.max.z * 0.9));
  world.sling.setPouch(local);
  updatePreview();
}
const launchSpeed = () => st.launch * (0.35 + 0.65 * aim.power);
function updatePreview() {
  const show = phase === 'aim' && aim.power > 0.08;
  dots.visible = show;
  if (!show) return;
  const o = launchOrigin();
  const s = newFlight(o.x, o.y, o.z, launchSpeed(), aim.pitch, aim.yaw, 0);
  const env = { wind: LV.wind };
  const m = new THREE.Matrix4();
  for (let i = 0; i < dots.count; i++) {
    for (let k = 0; k < 8; k++) stepFlight(s, { pitch: 0, steer: 0, boost: false }, st, 1 / 60, env);
    const sc = 1 - (i / dots.count) * 0.6;
    m.makeScale(sc, sc, sc).setPosition(s.x, s.y, s.z);
    dots.setMatrixAt(i, m);
  }
  dots.instanceMatrix.needsUpdate = true;
}

function aimMeterUpdate() {
  const m = $('aimMeter');
  m.classList.toggle('on', phase === 'aim' && aim.power > 0.02);
  m.textContent = `Power ${Math.round(aim.power * 100)}% · Angle ${Math.round((aim.pitch * 180) / Math.PI)}°`;
  $('hand').classList.remove('on');
}
function fire() {
  setStretch(0);
  $('aimMeter').classList.remove('on');
  $('hand').classList.remove('on');
  if (aim.power < 0.12) { aim.power = 0; placeOnSling(); return; }
  launchFlight(launchOrigin(), launchSpeed(), aim.pitch, aim.yaw);
  snapT = 0.35;
}
function launchFlight(o, speed, pitch, yaw) {
  flight = newFlight(o.x, o.y, o.z, speed, pitch, yaw, st.fuel, st.bounces);
  document.body.classList.remove('aiming');
  if (save.boost > 1) setTimeout(() => toast(`⚡ Lucky flight: coins ×${save.boost}`), 400);
  fs = { coins: 0, gems: 0, stars: 0, fuels: 0, rings: 0, balloons: 0, nearMiss: 0, bounces: 0, birds: 0, milestones: 0, milestoneCoins: 0, crossed: false, maxAlt: 0, maxV: 0, landing: null, dist: 0, endless: LV.endless, live: 0 };
  starT = 0;
  phase = 'fly';
  sfx.launch(); buzz(30);
  dots.visible = false;
  trail.visible = true; trailCount = 0;
  hint(MOBILE ? 'Drag to steer · hold 🔥 to boost' : 'W/S climb & dive · A/D steer · Space boost', 3500);
  $('boostBtn').classList.add('armed');
}
let snapT = 0;

/* ---------------- flight step ---------------- */
const FIXED = 1 / 120;
let acc = 0, last = performance.now();
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
let shake = 0;

function readInput() {
  let p = 0, s = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) p += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) p -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
  if (joy.active) { p += joy.y; s += joy.x; }
  if (tilt.on && tilt.ok) { p += tilt.pitch; s += tilt.steer; }
  input.pitch = clamp(p, -1, 1);
  input.steer = clamp(s, -1, 1);
  input.boost = keys.has('Space') || keys.has('ShiftLeft') || boostTouch;
}
const buzz = ms => { try { navigator.vibrate?.(ms); } catch (e) { /* unsupported */ } };
const panOf = x => clamp((x - flight.x) / 12, -1, 1);
const coinValue = () => (starT > 0 ? 6 : 3);

function physicsStep(dt) {
  const s = flight;
  const pz = s.z;
  stepFlight(s, input, st, dt, { wind: LV.wind, updraft: (x, y, z) => updraftAt(LV, x, y, z) });
  const g = LV.ground(s.x, s.z);
  fs.maxAlt = Math.max(fs.maxAlt, s.y - g);
  fs.maxV = Math.max(fs.maxV, s.v);
  if (starT > 0) starT -= dt;

  // distance milestones every 250 m
  const ms = Math.floor(-s.z / 250);
  if (ms > fs.milestones) {
    fs.milestones = ms;
    const bonus = 10 + 2 * ms;
    fs.milestoneCoins += bonus;
    sfx.milestone();
    toast(`${ms * 250} m!  +${bonus}`);
  }
  // finish line (flight continues: keep going for distance + a landing bonus)
  if (!fs.crossed && -s.z >= LV.length) {
    fs.crossed = true;
    sfx.finish();
    toast('🏁 FINISH! Keep flying, then land it!');
    spawnBurst(plane.position, 0xffcf33, 30, 10);
  }

  const k = chunkIndex(s.z);
  for (let j = Math.max(0, k - 1); j <= k + 1; j++) {
    const c = LV.chunk(j);
    for (const r of c.rings) {
      if (r.taken) continue;
      if (pz > r.z && s.z <= r.z && Math.hypot(s.x - r.x, s.y - r.y) < r.r + 0.3) {
        r.taken = true; if (r.mesh) r.mesh.material = r.doneMat;
        s.v = Math.min(110, s.v + 7);
        s.fuel = Math.min(st.fuel, s.fuel + 0.6);
        fs.rings++;
        sfx.ring(panOf(r.x)); toast('RING! +speed'); shake = 0.15; buzz(20);
        spawnBurst(tmp.set(r.x, r.y, r.z), 0xffc83a, 16, 8);
      }
    }
    for (const o of c.obstacles) {
      const d = Math.hypot(o.x - s.x, o.z - s.z);
      const top = LV.ground(o.x, o.z) + o.h * 0.92;
      if (d < o.r + 0.6 && s.y < top) return endFlight('hit');
      if (!o.near && pz > o.z && s.z <= o.z && d < o.r + 3.5 && s.y < top + 2) {
        o.near = true; fs.nearMiss++;
        sfx.nearMiss(panOf(o.x)); toast('Close call! +8');
      }
    }
    for (const b of c.balloons) {
      if (b.taken) continue;
      if (tmp.set(b.x, b.y, b.z).distanceTo(tmp2.set(s.x, s.y, s.z)) < b.r + 1.2) {
        b.taken = true; fs.balloons++;
        s.gamma = Math.max(s.gamma, 0.55); s.v = Math.max(s.v, 18) + 3;
        sfx.balloon(panOf(b.x)); toast('Boing!'); buzz(25);
        spawnBurst(tmp, 0xff6b9a, 14, 7);
      }
    }
    for (const f of c.birds) {
      if (f.hit || !f.mesh) continue;
      if (f.mesh.position.distanceTo(tmp.set(s.x, s.y, s.z)) < 3.2) {
        f.hit = true; fs.birds++;
        s.v *= 0.72;
        sfx.bird(panOf(f.mesh.position.x)); toast('Bird strike!'); shake = 0.35; buzz([30, 30, 30]);
        spawnBurst(f.mesh.position, 0xffffff, 18, 6);
      }
    }
  }
  if (s.y < g + 0.55) {
    const res = touchdown(s, st);
    s.y = g + 0.6;
    if (res === 'bounce') {
      fs.bounces++;
      sfx.bounce(); toast('Bounce! +10'); shake = 0.3; buzz(40);
      spawnBurst(plane.position, 0x9c8f7e, 10, 4);
      return;
    }
    return endFlight(res);
  }
  if (s.t > 600) endFlight('landed');
}

function stepPickups(dt) {
  const p = plane.position;
  const mag = st.magnet * (starT > 0 ? 2.5 : 1);
  for (const c of world.live.coins) {
    if (c.taken) continue;
    const m = c.mesh;
    m.rotation.y += dt * 3;
    if (phase !== 'fly') continue;
    const dz = m.position.z - p.z;
    if (dz > 8 || dz < -60) continue;
    const d2 = m.position.distanceToSquared(p);
    if (d2 < mag * mag || c.pull > 0) {
      c.pull = Math.min(1, c.pull + dt * 4);
      m.position.lerp(p, Math.min(1, dt * (6 + 18 * c.pull)));
    }
    if (m.position.distanceToSquared(p) < 2.8) {
      c.taken = true; m.visible = false;
      const pan = panOf(m.position.x);
      if (c.kind === 'gem') { fs.gems++; sfx.gem(pan); toast('💎 Gem! +15'); spawnBurst(m.position, 0x7fb4ff, 14, 6); }
      else if (c.kind === 'fuel') { fs.fuels++; flight.fuel = Math.min(st.fuel, flight.fuel + st.fuel * 0.4); sfx.fuel(pan); toast('⛽ Fuel!'); }
      else if (c.kind === 'star') { fs.stars++; starT = 8; flight.fuel = st.fuel; sfx.star(); toast('⭐ STAR POWER! Double coins'); spawnBurst(m.position, 0xffe27a, 24, 9); }
      else { fs.coins++; fs.live += coinValue(); sfx.coin(pan); spawnBurst(m.position, 0xffd34a, 5, 3); }
    }
  }
}

function tally(how) {
  const d = Math.max(0, Math.round(-flight.z));
  fs.dist = d; fs.landing = how;
  const rows = [];
  const add = (label, v) => { if (v > 0) rows.push([label, Math.round(v)]); };
  add(`Distance ${d} m`, d / 4);
  add(`Milestones × ${fs.milestones}`, fs.milestoneCoins);
  add(`Coins × ${fs.coins}`, fs.live);
  add(`Gems × ${fs.gems}`, fs.gems * 15);
  add(`Rings × ${fs.rings}`, fs.rings * 6);
  add(`Balloons × ${fs.balloons}`, fs.balloons * 4);
  add(`Close calls × ${fs.nearMiss}`, fs.nearMiss * 8);
  add(`Bounces × ${fs.bounces}`, fs.bounces * 10);
  add(`Top speed ${Math.round(fs.maxV * 3.6)} km/h`, (fs.maxV * 3.6) / 10);
  add(`Max height ${Math.round(fs.maxAlt)} m`, fs.maxAlt / 3);
  const lb = (fs.crossed ? 1.5 : 1);
  if (how === 'perfect') add(fs.crossed ? 'Perfect landing past the finish' : 'Perfect landing', (30 + 4 * levelN) * lb);
  else if (how === 'landed') add('Safe landing', 10 * lb);
  return { d, rows };
}

function endFlight(how) {
  if (phase !== 'fly') return;
  $('joy').classList.remove('on'); joy.active = false;
  phase = 'end';
  endT = 0;
  $('boostBtn').classList.remove('armed');
  setMusicIntensity(0);
  const { d, rows } = tally(how);
  const win = fs.crossed;
  const prevBest = save.best[levelN];
  save.best[levelN] = Math.max(prevBest, d);
  let total = rows.reduce((a, r) => a + r[1], 0);
  const firstClear = win && !LV.endless && save.cleared <= levelN;
  if (win && !LV.endless) rows.push([firstClear ? 'Level clear (first time ×2)' : 'Level clear', (40 + 25 * levelN) * (firstClear ? 2 : 1)]);
  if (d > prevBest && prevBest > 0) rows.push(['New personal best!', 20]);
  // stars
  let newStars = 0, starsNow = 0;
  if (!LV.endless) {
    const prev = save.stars[levelN];
    let s = prev;
    if (win) s |= 1;
    if (fs.coins >= Math.ceil(levelCoinCount(levelN) * 0.5)) s |= 2;
    if (win && how === 'perfect') s |= 4;
    newStars = popcount(s) - popcount(prev);
    save.stars[levelN] = s; starsNow = s;
    if (newStars) rows.push([`New stars × ${newStars}`, newStars * 50]);
  }
  total = rows.reduce((a, r) => a + r[1], 0);
  const lucky = save.boost > 1 ? save.boost : 1;
  const mul = st.coinMul * lucky;
  if (mul > 1.001) { const bonus = Math.round(total * (mul - 1)); rows.push([`${formOf(save.form).name}${lucky > 1 ? ', lucky flight' : ''} & charm bonus ×${mul.toFixed(2)}`, bonus]); total += bonus; }
  save.boost = 1;
  if (win && !LV.endless) save.cleared = Math.max(save.cleared, levelN + 1);
  save.stats.flights++; save.stats.totalDist += d;
  save.stats.bestSpeed = Math.max(save.stats.bestSpeed, Math.round(fs.maxV * 3.6));
  save.stats.bestAlt = Math.max(save.stats.bestAlt, Math.round(fs.maxAlt));
  if (how === 'perfect') save.stats.perfect++;
  // missions
  const done = [];
  for (const m of MISSIONS) if (!save.missions.includes(m.id) && m.test(fs)) { save.missions.push(m.id); done.push(m); }
  const missionCoins = done.reduce((a, m) => a + m.reward, 0);
  total += missionCoins;
  save.coins += total; save.stats.earned += total;
  persist();
  endInfo = { win, how, dist: d, rows, total, prevBest, done, stars: starsNow, newStars, shown: false };
  if (how === 'perfect') { sfx.perfect(); toast('✨ PERFECT LANDING'); }
  else if (how === 'landed') { sfx.land(); toast('Touchdown'); shake = 0.2; }
  else { sfx.crash(); shake = 0.6; buzz([80, 40, 120]); toast(how === 'hit' ? 'Smack!' : 'Crash!'); spawnBurst(plane.position, 0x8a5a2b, 30, 9); }
  if (done.length) setTimeout(() => sfx.mission(), 700);
  setFlightSound(0, false, false);
}

const coinCountCache = {};
function levelCoinCount(n) {
  if (coinCountCache[n] != null) return coinCountCache[n];
  const lv = makeLevel(n);
  let c = 0;
  for (let k = 0; k * CHUNK < lv.length; k++) c += lv.chunk(k).coins.filter(q => q.z >= -lv.length).length;
  return (coinCountCache[n] = c);
}

/* ---------------- per-frame update ---------------- */
let hudT = 0;
function step(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (phase === 'loading') return;

  if (phase === 'aim') {
    if (aim.keyCharge) {
      aim.power += aim.chargeDir * dt * 0.9;
      if (aim.power >= 1) { aim.power = 1; aim.chargeDir = -1; }
      if (aim.power <= 0.15 && aim.chargeDir < 0) { aim.power = 0.15; aim.chargeDir = 1; }
      setStretch(aim.power);
      placeOnSling();
      aimMeterUpdate();
    }
    const ay = (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0) - (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0);
    const ap = (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0) - (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0);
    if (runwayMode()) stepRunway(dt, ay);
    else if (ay || ap) { aim.yaw = clamp(aim.yaw + ay * dt * 0.6, -0.5, 0.5); aim.pitch = clamp(aim.pitch + ap * dt * 0.5, 0.05, 0.75); placeOnSling(); }
  }

  if (phase === 'fly') {
    readInput();
    acc += dt;
    while (acc >= FIXED && phase === 'fly') { physicsStep(FIXED); acc -= FIXED; }
    if (flight) {
      plane.position.set(flight.x, flight.y, flight.z);
      plane.rotation.set(flight.gamma, flight.psi, flight.bank * 1.1);
      for (const f of parts.flames) { f.visible = flight.boosting; if (f.visible) f.scale.z = f.scale.x * (0.8 + Math.random() * 0.5); }
      setFlightSound(flight.v, flight.boosting, true, save.form === 'c172' || save.form === 'mq9');
      setMusicIntensity(clamp((flight.v - 12) / 30, 0, 1));
      world.update(flight.z);
    }
  }
  if (phase === 'end' && flight) {
    endT += dt;
    flight.v *= Math.exp(-dt * 3);
    const g = LV.ground(plane.position.x, plane.position.z);
    tmp.set(-Math.sin(flight.psi), 0, -Math.cos(flight.psi)).multiplyScalar(flight.v * dt);
    plane.position.add(tmp);
    plane.position.y = Math.max(g + 0.5, plane.position.y - dt * 8);
    if (endInfo.how === 'crash' || endInfo.how === 'hit') { plane.rotation.z += dt * flight.v * 0.15; plane.rotation.x *= 0.95; }
    else { plane.rotation.x *= 0.9; plane.rotation.z *= 0.9; }
    parts.flames.forEach(f => (f.visible = false));
    if (endT > 1.6 && !endInfo.shown) { endInfo.shown = true; showResult(); }
  }

  if (snapT > 0) {
    snapT -= dt;
    const k = Math.max(0, snapT / 0.35);
    const r = world.sling.rest.clone();
    r.z += Math.sin(k * 18) * k * 1.2;
    world.sling.setPouch(r);
  }

  if (evoT > 0) {
    evoT += dt;
    const x = Math.max(0, evoT - 0.35);
    plane.scale.setScalar(Math.max(0.01, 1 - Math.exp(-5 * x) * Math.cos(11 * x)));
    plane.rotation.y += dt * (0.6 + 7 * Math.exp(-1.2 * x));
  }
  for (const s of parts.spinners) s.rotation.y += dt * 2;
  stepPickups(dt);
  animateWorld(dt, now);
  updateTrail();
  updateCamera(dt);
  updateSun();

  hudT -= dt;
  if (hudT <= 0 && (phase === 'fly' || phase === 'end') && flight) {
    hudT = 0.08;
    const d = Math.max(0, -flight.z);
    const L = LV.length;
    $('hDist').textContent = Number.isFinite(L) ? `${Math.round(d)} / ${L} m` : `${Math.round(d)} m`;
    $('hProg').style.width = `${Number.isFinite(L) ? clamp(d / L, 0, 1) * 100 : (d % 250) / 2.5}%`;
    $('hSpd').textContent = Math.round(flight.v * 3.6);
    $('hAlt').textContent = Math.max(0, Math.round(flight.y - LV.ground(flight.x, flight.z)));
    $('hFuel').style.width = `${(flight.fuel / st.fuel) * 100}%`;
    $('hCoins').textContent = fs ? fs.live + fs.gems * 15 + fs.milestoneCoins : 0;
    $('hBounce').textContent = '🛞'.repeat(flight.bounces);
    $('hStar').classList.toggle('on', starT > 0);
  }
}

function animateWorld(dt, now) {
  const t = now / 1000;
  for (const r of world.live.rings) r.mesh.rotation.z += dt * (r.taken ? 2 : 0.6);
  const m = new THREE.Matrix4();
  for (const sp of world.live.updraftFx) {
    const { seeds, u, gy, h } = sp.userData;
    seeds.forEach((s, i) => {
      s.y = (s.y + dt * s.s) % h; s.a += dt * 1.5;
      m.makeTranslation(u.x + Math.cos(s.a) * s.r, gy + s.y, u.z + Math.sin(s.a) * s.r);
      sp.setMatrixAt(i, m);
    });
    sp.instanceMatrix.needsUpdate = true;
  }
  for (const b of world.live.balloons) {
    if (b.taken) { b.mesh.position.y += dt * 12; b.mesh.scale.multiplyScalar(1 - dt * 0.8); continue; }
    b.mesh.position.y = b.y - 3.6 + Math.sin(t * 0.8 + b.bob) * 0.6;
  }
  for (const f of world.live.birds) {
    const x = f.x + Math.sin(t * f.speed + f.ph) * f.amp;
    const vx = Math.cos(t * f.speed + f.ph);
    f.mesh.position.x = x;
    f.mesh.rotation.y = vx > 0 ? 0 : Math.PI; // seagull model faces +X
    if (f.hit) f.mesh.position.y += dt * 4;
    f.members.forEach(b => { b.position.y += Math.sin(t * 6 + b.userData.ph) * dt * 0.8; b.rotation.x = Math.sin(t * 8 + b.userData.ph) * 0.25; });
  }
  // particles
  for (let i = 0; i < BURST_N; i++) {
    const q = parts3[i];
    if (q.life > 0) { q.life -= dt; q.v.y -= 9 * dt; q.p.addScaledVector(q.v, dt); }
    const s = Math.max(0, q.life) * 1.4;
    m.makeScale(s, s, s).setPosition(q.p);
    burst.setMatrixAt(i, m);
  }
  burst.instanceMatrix.needsUpdate = true;
}

function updateTrail() {
  if (!trail.visible || phase !== 'fly') return;
  if (++trailTick % 3) return;
  const a = trailGeo.attributes.position.array;
  a.copyWithin(3, 0, (TRAIL_N - 1) * 3);
  tmp.set(0, 0, plane.userData.box.max.z).applyEuler(plane.rotation).add(plane.position);
  a[0] = tmp.x; a[1] = tmp.y; a[2] = tmp.z;
  trailCount = Math.min(TRAIL_N, trailCount + 1);
  if (trailCount === 1) for (let i = 1; i < TRAIL_N; i++) a.set([tmp.x, tmp.y, tmp.z], i * 3);
  trailGeo.attributes.position.needsUpdate = true;
  trail.material.color.set(starT > 0 ? 0xffe27a : 0xffffff);
}

function updateCamera(dt) {
  let want, look;
  const t = performance.now() / 1000;
  if (phase === 'hangar') {
    const a = t * 0.35, r = 4 + plane.userData.box.getSize(tmp).z * 2.3;
    want = plane.position.clone().add(new THREE.Vector3(Math.sin(a) * r, r * 0.3, Math.cos(a) * r));
    look = plane.position.clone();
    // wide screens: the hangar panel covers the left, so frame the plane on the right
    if (evoT > 0) { want.copy(plane.position).add(tmp.set(Math.sin(a) * r * 0.75, r * 0.18, Math.cos(a) * r * 0.75)); look.y -= r * 0.12; }
    else if (window.innerWidth > 820) look.add(tmp.set(-Math.cos(a), 0, Math.sin(a)).multiplyScalar(r * 0.28));
    else look.y -= r * 0.18;
  } else if (phase === 'aim' && runwayMode()) {
    const portrait = window.innerHeight > window.innerWidth;
    const b = tmp.set(Math.sin(rw.yaw), 0, Math.cos(rw.yaw));
    want = plane.position.clone().addScaledVector(b, portrait ? 12 : 9); want.y += portrait ? 4.2 : 3;
    look = plane.position.clone().addScaledVector(b, -22); look.y += 0.5;
  } else if (phase === 'aim' || phase === 'title') {
    const o = launchOrigin();
    const d = aimDir();
    const portrait = window.innerHeight > window.innerWidth;
    want = o.clone().add(new THREE.Vector3(d.x * -9, portrait ? 6.5 : 3.2, (portrait ? 15 : 10) + aim.power * (portrait ? 4 : 2)));
    look = o.clone().addScaledVector(d, 25);
    look.y = o.y - 1;
    if (phase === 'title') { want.set(Math.sin(t / 6) * 16, LV.launchH + 9, 6 + Math.cos(t / 6) * 10); look.set(0, LV.launchH, -40); }
  } else {
    const back = new THREE.Vector3(Math.sin(flight.psi), 0, Math.cos(flight.psi));
    const dist = 8.5 + (flight.v - 13) * 0.06 + plane.userData.box.getSize(tmp).z * 0.6;
    want = plane.position.clone().addScaledVector(back, dist);
    want.y += 2.6 - Math.sin(flight.gamma) * 2.2;
    const gy = LV.ground(want.x, want.z) + 1.5;
    if (want.y < gy) want.y = gy;
    look = plane.position.clone().addScaledVector(back, -10);
    look.y = plane.position.y + Math.sin(flight.gamma) * 3;
    if (phase === 'end') { want = plane.position.clone().add(new THREE.Vector3(Math.sin(endT * 0.6) * 10, 5, Math.cos(endT * 0.6) * 10)); look = plane.position.clone(); }
  }
  const k = 1 - Math.exp(-dt * (phase === 'fly' ? 5 : 3));
  camPos.lerp(want, camPos.lengthSq() === 0 ? 1 : k);
  camLook.lerp(look, camLook.lengthSq() === 0 ? 1 : k * 1.4);
  camera.position.copy(camPos);
  if (shake > 0) { shake = Math.max(0, shake - dt); camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; }
  camera.lookAt(camLook);
}

function updateSun() {
  const p = plane ? plane.position : camLook;
  sun.target.position.copy(p);
  sun.position.copy(p).add(tmp.set(-30, 60, 25));
}

/* ---------------- UI ---------------- */
let hintTimer = 0;
function hint(text, ms) { $('hHint').textContent = text; clearTimeout(hintTimer); if (ms) hintTimer = setTimeout(() => ($('hHint').textContent = ''), ms); }
let toastTimer = 0;
function toast(t) { const el = $('hToast'); el.textContent = t; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1100); }
function screen(id) { for (const s of ['title', 'shop', 'result', 'loading', 'missions']) $(s).classList.toggle('show', s === id); }
function showHud(on) { $('hud').classList.toggle('hidden', !on); document.body.classList.toggle('flying', on); if (!on) document.body.classList.remove('aiming'); }
const starStr = s => [1, 2, 4].map(b => (s & b ? '★' : '☆')).join('');
const fmt = n => n.toLocaleString('en-US');

function showTitle() {
  if (flight || phase === 'hangar') loadLevel(levelN);
  phase = 'title';
  showHud(false);
  setFlightSound(0, false, false);
  $('tCoins').textContent = fmt(save.coins);
  const totalStars = save.stars.reduce((a, s) => a + popcount(s), 0);
  $('tStars').textContent = `${totalStars}/${LEVEL_COUNT * 3}`;
  $('tMissions').textContent = `🎯 Missions ${save.missions.length}/${MISSIONS.length}`;
  const grid = $('levels');
  grid.innerHTML = '';
  for (let i = 0; i < ALL; i++) {
    const endless = i === ENDLESS;
    const locked = endless ? save.cleared < ENDLESS_UNLOCK : i > save.cleared;
    const b = document.createElement('button');
    const band = endless ? 'b4' : i < 5 ? 'b1' : i < 10 ? 'b2' : 'b3';
    b.className = `lv ${band} ${!endless && i < save.cleared ? 'done' : !endless && i === save.cleared ? 'next' : ''} ${locked ? 'locked' : ''} ${endless ? 'endless' : ''}`;
    const sub = endless ? (locked ? `clear ${ENDLESS_UNLOCK} levels` : save.best[i] ? `best ${fmt(save.best[i])} m` : 'no finish line') : save.best[i] ? `best ${fmt(save.best[i])} m` : `${fmt(levelLength(i))} m`;
    b.innerHTML = `<b>${locked ? '🔒' : endless ? '∞' : i + 1}</b><span>${LEVEL_NAMES[i]}</span><em>${sub}</em>${!endless && !locked ? `<i class="st">${starStr(save.stars[i])}</i>` : ''}`;
    b.disabled = locked;
    b.onclick = () => { initAudio(); sfx.click(); startLevel(i); };
    grid.appendChild(b);
  }
  screen('title');
}

function showMissions() {
  const list = $('mList');
  list.innerHTML = MISSIONS.map(m => `<div class="mission ${save.missions.includes(m.id) ? 'done' : ''}"><span>${save.missions.includes(m.id) ? '✅' : '⬜'} ${m.text}</span><b>🪙 ${fmt(m.reward)}</b></div>`).join('');
  const s = save.stats;
  $('mStats').innerHTML = `Flights <b>${fmt(s.flights)}</b> · Total distance <b>${fmt(Math.round(s.totalDist))} m</b> · Top speed <b>${s.bestSpeed} km/h</b> · Max height <b>${s.bestAlt} m</b> · Perfect landings <b>${s.perfect}</b> · Coins earned <b>${fmt(s.earned)}</b>`;
  screen('missions');
}

function startLevel(n) {
  if (n !== levelN || !LV || flight || phase === 'hangar') loadLevel(n);
  else { buildPlane(); placeOnSling(); }
  flight = null; fs = null; aim.power = 0; placeOnSling();
  phase = 'aim';
  screen(null);
  showHud(true);
  const L = LV.length;
  $('hLvl').textContent = LV.endless ? '∞ Endless Valley' : `${n + 1} · ${LV.name}`;
  $('hBest').style.left = `${Number.isFinite(L) ? clamp(save.best[n] / L, 0, 1) * 100 : 0}%`;
  $('hBest').style.display = Number.isFinite(L) && save.best[n] ? '' : 'none';
  $('hWindBox').style.display = LV.wind.x || LV.wind.z ? '' : 'none';
  const w = LV.wind;
  $('hWind').textContent = (w.x > 0 ? '→' : w.x < 0 ? '←' : '') + (w.z > 0 ? '↓' : '') + ' ' + Math.round(Math.hypot(w.x, w.z) * 3.6);
  $('hCoins').textContent = '0';
  $('hDist').textContent = Number.isFinite(L) ? `0 / ${L} m` : '0 m';
  $('hProg').style.width = '0%';
  $('hSpd').textContent = '0'; $('hAlt').textContent = '0'; $('hFuel').style.width = '100%';
  $('hBounce').textContent = '🛞'.repeat(st.bounces);
  document.body.classList.add('aiming');
  syncLaunchMode();
  if (runwayMode()) resetRunway();
  hint(runwayMode() ? `${MOBILE ? '👆 Hold' : '🖱 Hold the mouse or Space'} to race down the runway · let go on the green to take off` : (MOBILE ? '👆 ' : '🖱 ') + LEVEL_TIPS[n] + (MOBILE ? '' : '  (or hold Space)'), 0);
  $('hand').classList.toggle('on', MOBILE && save.stats.flights < 3 && !runwayMode());
  $('aimMeter').classList.remove('on');
  if (tilt.on) tilt.calibrate = true;
}

function showResult() {
  const r = endInfo;
  const titles = { perfect: '✨ Perfect landing!', landed: '🛬 Touchdown', crash: '💥 Crashed', hit: '💥 Smack!' };
  $('rTitle').textContent = (r.win && !LV.endless ? '🏁 Cleared! ' : '') + titles[r.how];
  $('rSub').textContent = LV.endless ? `Endless Valley: ${fmt(r.dist)} m (best ${fmt(save.best[levelN])} m)`
    : r.win ? `${LV.name} complete.` : `${fmt(Math.max(0, LV.length - r.dist))} m to go. Upgrade in the hangar and try again!`;
  $('rStars').textContent = LV.endless ? '' : starStr(r.stars);
  $('rStars').title = '★ finish · ★ grab half the coins · ★ perfect landing after the finish';
  const L = LV.length;
  $('rDist').textContent = Number.isFinite(L) ? `${fmt(r.dist)} / ${fmt(L)} m` : `${fmt(r.dist)} m`;
  $('rBar').style.width = '0%';
  requestAnimationFrame(() => requestAnimationFrame(() => ($('rBar').style.width = `${Number.isFinite(L) ? clamp(r.dist / L, 0, 1) * 100 : 100}%`)));
  const rows = r.rows.map(([k, v]) => `<span>${k}</span><b>+${fmt(v)}</b>`);
  r.done.forEach(m => rows.push(`<span class="ms">🎯 Mission: ${m.text}</span><b class="ms">+${fmt(m.reward)}</b>`));
  $('rEarn').innerHTML = rows.join('') + `<span class="tot">Total</span><b class="tot">🪙 <i id="rTotal">0</i></b>`;
  countUp($('rTotal'), r.total);
  const hasNext = !LV.endless && levelN + 1 < LEVEL_COUNT && save.cleared > levelN;
  $('rNext').style.display = r.win && hasNext ? '' : 'none';
  $('rRetry').textContent = r.win ? '↻ Replay' : '↻ Retry';
  if (r.win && levelN + 1 >= LEVEL_COUNT && !LV.endless) $('rSub').textContent = 'You beat all 15 valleys! Try Endless, collect stars, max your plane.';
  dealCards();
  screen('result');
  showHud(false);
  ($('rNext').style.display === '' ? $('rNext') : $('rRetry')).focus();
}
function countUp(el, target) {
  const t0 = performance.now(), dur = Math.min(1400, 300 + target * 2);
  let lastTick = 0;
  const f = now => {
    const k = Math.min(1, (now - t0) / dur);
    el.textContent = fmt(Math.round(target * (1 - Math.pow(1 - k, 3))));
    if (now - lastTick > 45 && k < 1) { sfx.coinTick(); lastTick = now; }
    if (k < 1) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}

/* ---------------- hangar ---------------- */
function showShop() {
  if (flight || phase === 'end') loadLevel(levelN);
  else rebuildPreview();
  phase = 'hangar';
  plane.position.set(0, LV.launchH + 6, -30);
  plane.rotation.set(0, 0, 0);
  showHud(false);
  renderShop();
  screen('shop');
}
function rebuildPreview() {
  const pos = plane.position.clone();
  buildPlane();
  plane.position.copy(pos);
  world.dispose();
  world = buildWorld(LV, scene, lights, save.up.sling, AHEAD);
  syncLaunchMode();
}
function renderShop() {
  $('sCoins').textContent = fmt(save.coins);
  const bought = tiersBought();
  $('sTiers').textContent = `${bought}/${TOTAL_TIERS}`;
  const up = $('upCards'); up.innerHTML = '';
  for (const u of UPGRADES) {
    const t = save.up[u.id];
    const cost = t < MAX_TIER ? u.costs[t] : 0;
    const c = document.createElement('div');
    c.className = 'card';
    c.innerHTML = `<div class="t">${u.icon} ${u.name}</div><div class="d">${u.desc}<br><small>${u.part}</small></div><div class="pips">${Array.from({ length: MAX_TIER }, (_, i) => `<i class="${i < t ? 'on' : ''}"></i>`).join('')}</div>`;
    const b = document.createElement('button');
    if (t >= MAX_TIER) { b.textContent = 'MAX'; b.className = 'max'; b.disabled = true; }
    else { b.textContent = `Upgrade · 🪙 ${fmt(cost)}`; if (save.coins < cost) b.className = 'poor'; }
    b.onclick = () => {
      if (t >= MAX_TIER) return;
      if (save.coins < cost) return sfx.deny();
      save.coins -= cost; save.up[u.id]++; persist(); sfx.buy();
      rebuildPreview(); renderShop();
      spawnBurst(plane.position, 0xffc83a, 24, 6);
    };
    c.appendChild(b);
    up.appendChild(c);
  }
  renderGarage();
  renderForms();
}

$('tShop').onclick = () => { initAudio(); sfx.click(); showShop(); };
$('tMissions').onclick = () => { initAudio(); sfx.click(); showMissions(); };
$('mBack').onclick = () => { sfx.click(); showTitle(); };
$('sBack').onclick = () => { sfx.click(); showTitle(); };
$('sFly').onclick = () => { initAudio(); sfx.click(); startLevel(endInfo && !endInfo.win ? levelN : Math.min(save.cleared, LEVEL_COUNT - 1)); };
$('rShop').onclick = () => { sfx.click(); showShop(); };
$('rRetry').onclick = () => { sfx.click(); startLevel(levelN); };
$('rNext').onclick = () => { sfx.click(); startLevel(levelN + 1); };
$('rLevels').onclick = () => { sfx.click(); showTitle(); };
$('hExit').onclick = () => { if (phase === 'fly') endFlight('crash'); else showTitle(); };
const syncAudioBtns = () => { $('hMute').textContent = isSfxOn() ? '🔊' : '🔇'; for (const id of ['hMusic', 'tMusic']) { $(id).textContent = isMusicOn() ? '🎵' : '🎵̸'; $(id).classList.toggle('off', !isMusicOn()); } };
$('hMute').onclick = () => { initAudio(); toggleSfx(); syncAudioBtns(); };
$('hMusic').onclick = $('tMusic').onclick = () => { initAudio(); toggleMusic(); syncAudioBtns(); };
syncAudioBtns();

/* ---------------- input ---------------- */
const pullMax = () => (window.innerHeight > window.innerWidth ? window.innerHeight * 0.26 : Math.min(window.innerWidth, window.innerHeight) * 0.32);
canvas.addEventListener('pointerdown', e => {
  initAudio();
  if (phase === 'aim' && runwayMode()) {
    rw.holding = true; rw.started = true; rw.sx = e.clientX; rw.y0 = rw.yaw;
    canvas.setPointerCapture(e.pointerId);
    hint('', 0);
  } else if (phase === 'aim') {
    aim.dragging = true; aim.sx = e.clientX; aim.sy = e.clientY; aim.keyCharge = false;
    canvas.setPointerCapture(e.pointerId);
    hint('', 0);
  } else if (phase === 'fly' && !joy.active) {
    joy.active = true; joy.id = e.pointerId; joy.sx = e.clientX; joy.sy = e.clientY; joy.x = joy.y = 0;
    showJoy(e.clientX, e.clientY, 0, 0);
    canvas.setPointerCapture(e.pointerId);
  }
});
let lastStretch = 0;
canvas.addEventListener('pointermove', e => {
  if (phase === 'aim' && runwayMode() && rw.holding) {
    rw.yaw = clamp(rw.y0 - ((e.clientX - rw.sx) / pullMax()) * 0.5, -0.35, 0.35);
  } else if (phase === 'aim' && aim.dragging) {
    const m = pullMax();
    const dx = e.clientX - aim.sx, dy = e.clientY - aim.sy;
    const prev = aim.power;
    aim.power = clamp(Math.hypot(dx, dy) / m, 0, 1);
    aim.yaw = clamp((dx / m) * 0.45, -0.5, 0.5);
    aim.pitch = clamp(0.08 + 0.5 * clamp(dy / m, 0, 1), 0.05, 0.75);
    setStretch(aim.power);
    aimMeterUpdate();
    if (Math.abs(aim.power - prev) > 0.06 && performance.now() - lastStretch > 70) { sfx.stretchClick(); lastStretch = performance.now(); }
    placeOnSling();
  } else if (joy.active && e.pointerId === joy.id) {
    const m = Math.min(window.innerWidth, window.innerHeight) * 0.18;
    joy.x = clamp((e.clientX - joy.sx) / m, -1, 1);
    joy.y = clamp(-(e.clientY - joy.sy) / m, -1, 1);
    showJoy(joy.sx, joy.sy, joy.x, -joy.y);
  }
});
const endPointer = e => {
  if (phase === 'aim' && runwayMode() && rw.holding) releaseRunway();
  if (phase === 'aim' && aim.dragging) { aim.dragging = false; fire(); }
  if (joy.active && e.pointerId === joy.id) { joy.active = false; joy.x = joy.y = 0; $('joy').classList.remove('on'); }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
const bb = $('boostBtn');
bb.addEventListener('pointerdown', e => { e.preventDefault(); boostTouch = true; bb.classList.add('on'); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => bb.addEventListener(ev, () => { boostTouch = false; bb.classList.remove('on'); }));

window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && (phase === 'aim' || phase === 'fly')) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  initAudio();
  if (phase === 'aim' && runwayMode() && e.code === 'Space') { rw.holding = true; rw.started = true; hint('', 0); }
  else if (phase === 'aim' && e.code === 'Space') { aim.keyCharge = true; aim.chargeDir = 1; aim.power = Math.max(aim.power, 0.15); hint('', 0); }
  if (e.code === 'KeyR' && (phase === 'fly' || phase === 'end')) { screen(null); startLevel(levelN); }
  if (e.code === 'Escape') { if (phase === 'fly') endFlight('crash'); else if (phase === 'aim') showTitle(); }
});
window.addEventListener('keyup', e => {
  keys.delete(e.code);
  if (phase === 'aim' && runwayMode() && e.code === 'Space' && rw.holding) releaseRunway();
  if (phase === 'aim' && e.code === 'Space' && aim.keyCharge) { aim.keyCharge = false; fire(); }
});
window.addEventListener('blur', () => { keys.clear(); boostTouch = false; });

/* ---------------- runway launch ---------------- */
// An elevated runway behind the start line: hold to accelerate, let go in the green zone to rotate
// steeply into the air (a "perfect takeoff"), or roll off the end at a shallow angle.
const RW_LEN = 70, RW_ZONE = 16;
const rw = { z: 0, x: 0, v: 0, yaw: 0, y0: 0, sx: 0, holding: false, started: false };
let runway = null;
const runwayMode = () => save.launch === 'runway';
function buildRunway() {
  if (runway) { scene.remove(runway.group); runway.group.traverse(o => o.geometry?.dispose()); }
  let top = -Infinity;
  for (let z = -2; z <= RW_LEN; z += 4) for (const x of [-3, 0, 3]) top = Math.max(top, LV.ground(x, z));
  const y = Math.max(top + 1.4, LV.launchH + 1.4);
  const g = new THREE.Group();
  const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
  const box = (w, h, d, m, x, yy, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, yy, z); b.castShadow = b.receiveShadow = true; g.add(b); return b; };
  box(6, 0.5, RW_LEN, M(0x3b4150), 0, y - 0.25, RW_LEN / 2);
  const white = M(0xf4f6fa), yellow = M(0xffc83a);
  for (let z = RW_ZONE + 3; z < RW_LEN - 2; z += 5) box(0.22, 0.04, 2.4, white, 0, y + 0.01, z);
  box(0.15, 0.04, RW_LEN, yellow, -2.8, y + 0.01, RW_LEN / 2);
  box(0.15, 0.04, RW_LEN, yellow, 2.8, y + 0.01, RW_LEN / 2);
  const zone = box(5.4, 0.04, RW_ZONE, M(0x4fc36a, { emissive: 0x2a8a3a, emissiveIntensity: 0.5 }), 0, y + 0.02, RW_ZONE / 2);
  zone.castShadow = false;
  box(6, 0.12, 0.5, M(0xe8374f), 0, y + 0.02, 0.25); // flat red edge line at the end of the deck
  const pillar = M(0x8d96a5);
  for (const z of [6, 24, 42, 60]) for (const x of [-2.4, 2.4]) {
    const h = y - LV.ground(x, z);
    if (h > 0.4) box(0.5, h, 0.5, pillar, x, y - h / 2, z);
  }
  scene.add(g);
  runway = { group: g, y };
}
function syncLaunchMode() {
  const r = runwayMode();
  if (runway) runway.group.visible = r;
  if (world) world.sling.group.visible = !r;
  $('launchMode').textContent = r ? '🛫 Runway · tap for slingshot' : '🎯 Slingshot · tap for runway';
}
function resetRunway() {
  Object.assign(rw, { z: RW_LEN - 5, x: 0, v: 0, yaw: 0, holding: false, started: false });
  dots.visible = false;
  placeOnRunway();
}
function placeOnRunway() {
  plane.position.set(rw.x, runway.y - plane.userData.box.min.y * 0.9, rw.z);
  plane.rotation.set(rw.v > 1 ? -0.015 : 0, rw.yaw, 0);
}
const rwMax = () => st.launch * 1.06;
function stepRunway(dt, keySteer) {
  if (keySteer) rw.yaw = clamp(rw.yaw + keySteer * dt * 0.5, -0.35, 0.35);
  const vmax = rwMax(), a = (vmax * vmax) / (2 * (RW_LEN - 5 - RW_ZONE * 0.4));
  if (rw.holding) rw.v = Math.min(vmax, rw.v + a * dt);
  else rw.v = Math.max(0, rw.v - 2.5 * dt);
  rw.x = clamp(rw.x - Math.sin(rw.yaw) * rw.v * dt, -2.3, 2.3);
  rw.z -= Math.cos(rw.yaw) * rw.v * dt;
  placeOnRunway();
  setFlightSound(rw.v, false, rw.started, save.form === 'c172' || save.form === 'mq9');
  const m = $('aimMeter');
  m.classList.toggle('on', rw.started);
  m.textContent = rw.z <= RW_ZONE ? `${Math.round(rw.v * 3.6)} km/h · LET GO!` : `${Math.round(rw.v * 3.6)} km/h · ${Math.round((rw.v / vmax) * 100)}%`;
  if (rw.z <= 0) takeoff(false);
}
function releaseRunway() {
  rw.holding = false;
  if (rw.z <= RW_ZONE && rw.v > rwMax() * 0.55) takeoff(true);
}
function takeoff(perfect) {
  $('aimMeter').classList.remove('on');
  // leave the deck level: a perfect release keeps the nose flat with extra speed, otherwise it dips
  const speed = rw.v * (perfect ? 1.1 : 1);
  launchFlight(new THREE.Vector3(rw.x, plane.position.y, rw.z), speed, perfect ? 0 : -0.08, rw.yaw);
  fs.perfectTakeoff = perfect;
  if (perfect) { setTimeout(() => toast('🛫 PERFECT TAKEOFF'), 150); sfx.ring(0); buzz(30); }
}
$('launchMode').onclick = () => {
  if (phase !== 'aim' || rw.started) return;
  sfx.click();
  save.launch = runwayMode() ? 'sling' : 'runway'; persist();
  syncLaunchMode();
  aim.power = 0; placeOnSling();
  if (runwayMode()) resetRunway();
  startLevel(levelN);
};

/* ---------------- garage: merge to evolve, earn while away ---------------- */
const FORM_ICON = ['🛩️', '🛰️', '🛫', '🦅', '✈️', '🚀', '🛸'];
const MAXF = FORMS.length - 1;
const AWAY_CAP_MIN = 120; // the garage stops earning after 2 hours
const rateOf = L => Math.round(0.5 * 2.05 ** L * 10) / 10; // coins per minute
const garageRate = () => Math.round(save.garage.reduce((a, L) => a + (L >= 0 ? rateOf(L) : 0), 0) * 10) / 10;
const bestForm = () => Math.max(0, ...save.forms.map(id => FORMS.findIndex(f => f.id === id)));
const spawnLevel = () => Math.max(0, bestForm() - 3);
const buyCost = () => Math.round(250 * 1.13 ** save.bought);
function accrue() {
  const now = Date.now(), r = garageRate();
  const mins = clamp((now - save.garageT) / 60000, 0, AWAY_CAP_MIN);
  save.bank = Math.min(r * AWAY_CAP_MIN, save.bank + r * mins);
  save.garageT = now;
}
function collect() {
  accrue();
  const c = Math.floor(save.bank);
  if (c <= 0) { sfx.deny(); return 0; }
  save.bank -= c; save.coins += c; save.stats.earned += c;
  persist(); sfx.mission();
  return c;
}
let gSel = -1;
function renderGarage(pop = -1) {
  const g = $('garage');
  g.innerHTML = '';
  const selL = gSel >= 0 ? save.garage[gSel] : -2;
  save.garage.forEach((L, i) => {
    const d = document.createElement('div');
    d.dataset.i = i;
    d.className = `gt ${L >= 0 ? 'full lv' + L : ''} ${i === gSel ? 'sel' : ''} ${i !== gSel && L === selL && L < MAXF ? 'match' : ''} ${i === pop ? 'pop' : ''}`;
    if (L >= 0) d.innerHTML = `<span class="lvb">${L + 1}</span><span class="e">${FORM_ICON[L]}</span><span class="n">${FORMS[L].name}</span><span class="rate">+${rateOf(L)}/m</span>`;
    d.title = L >= 0 ? `${FORMS[L].name}: earns ${rateOf(L)} coins a minute` : 'Empty bay';
    g.appendChild(d);
  });
  const free = save.garage.indexOf(-1), cost = buyCost(), b = $('gBuy');
  b.textContent = free < 0 ? 'Garage full: merge!' : `Buy ${FORMS[spawnLevel()].name} · 🪙 ${fmt(cost)}`;
  b.classList.toggle('poor', free < 0 || save.coins < cost);
  $('gMerge').disabled = !findPair();
  $('sCoins').textContent = fmt(save.coins);
  updateCollect();
}
function updateCollect() { accrue(); $('gCollect').textContent = `🪙 ${fmt(Math.floor(save.bank))} · +${garageRate()}/min`; }
setInterval(() => { if (phase === 'hangar') updateCollect(); }, 1000);
function renderForms() {
  const ev = $('evoChain');
  ev.innerHTML = '';
  FORMS.forEach((f, i) => {
    const owned = save.forms.includes(f.id);
    const b = document.createElement('button');
    b.className = 'fm' + (save.form === f.id ? ' sel' : '');
    b.disabled = !owned;
    b.innerHTML = `<b>${FORM_ICON[i]} ${f.name}</b><span>${owned ? `glide ×${f.gr} · coins ×${f.coin}` : `🔒 merge 2 ${FORMS[i - 1].name}s`}</span>`;
    b.title = f.blurb;
    b.onclick = () => { if (save.form === f.id) return; sfx.click(); save.form = f.id; persist(); rebuildPreview(); renderShop(); };
    ev.appendChild(b);
  });
}
function findPair() {
  for (let L = 0; L < MAXF; L++) {
    const idx = save.garage.flatMap((v, i) => (v === L ? [i] : []));
    if (idx.length >= 2) return [idx[0], idx[1]];
  }
  return null;
}
// merge bay a into bay b; returns the new form if this is the first time it was made
function mergeInto(a, b) {
  const L = save.garage[b] + 1;
  save.garage[a] = -1; save.garage[b] = L;
  save.stats.merges++;
  const f = FORMS[L];
  if (save.forms.includes(f.id)) return null;
  save.forms.push(f.id);
  if (L > FORMS.findIndex(q => q.id === save.form)) save.form = f.id; // never swap you into a weaker plane
  return f;
}
function dropOn(a, b) {
  const A = save.garage[a], B = save.garage[b];
  if (A < 0 || a === b) return renderGarage();
  accrue();
  if (A === B && A < MAXF) {
    const nf = mergeInto(a, b);
    persist(); sfx.buy(); buzz(25);
    renderGarage(b);
    spawnBurst(plane.position, 0xffc83a, 16, 5);
    if (nf) evolveScene(FORMS[FORMS.indexOf(nf) - 1], nf);
  } else {
    save.garage[b] = A; save.garage[a] = B;
    persist(); sfx.click(); renderGarage(b);
  }
}
function tapTile(i) {
  if (gSel < 0) { if (save.garage[i] >= 0) { gSel = i; sfx.click(); } return renderGarage(); }
  const a = gSel; gSel = -1;
  if (a === i) return renderGarage();
  dropOn(a, i);
}
let gDrag = null;
$('garage').addEventListener('pointerdown', e => {
  const t = e.target.closest('.gt');
  if (t) gDrag = { i: +t.dataset.i, x: e.clientX, y: e.clientY, moved: false, el: t };
});
window.addEventListener('pointermove', e => {
  if (gDrag && !gDrag.moved && save.garage[gDrag.i] >= 0 && Math.hypot(e.clientX - gDrag.x, e.clientY - gDrag.y) > 14) { gDrag.moved = true; gDrag.el.classList.add('drag'); }
});
window.addEventListener('pointerup', e => {
  if (!gDrag) return;
  const d = gDrag; gDrag = null;
  if (!d.moved) return tapTile(d.i);
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.gt');
  gSel = -1;
  if (el) dropOn(d.i, +el.dataset.i); else renderGarage();
});
window.addEventListener('pointercancel', () => { if (gDrag) { gDrag = null; renderGarage(); } });
$('gBuy').onclick = () => {
  initAudio();
  const free = save.garage.indexOf(-1), cost = buyCost();
  if (free < 0 || save.coins < cost) return sfx.deny();
  accrue();
  save.coins -= cost; save.bought++; save.garage[free] = spawnLevel();
  persist(); sfx.buy();
  gSel = -1; renderGarage(free);
};
$('gMerge').onclick = () => {
  accrue();
  let pair, newest = null, n = 0;
  while ((pair = findPair())) { const nf = mergeInto(pair[0], pair[1]); if (nf && (!newest || FORMS.indexOf(nf) > FORMS.indexOf(newest))) newest = nf; n++; }
  if (!n) return sfx.deny();
  persist(); sfx.buy(); buzz(25); gSel = -1;
  renderGarage();
  toast(`⚡ ${n} merge${n > 1 ? 's' : ''}`);
  if (newest) evolveScene(FORMS[FORMS.indexOf(newest) - 1], newest);
};
$('gCollect').onclick = () => { initAudio(); if (collect()) { spawnBurst(plane.position, 0xffd34a, 30, 7); renderShop(); } };

/* ---------------- evolution moment ---------------- */
let evoT = 0;
function evolveScene(from, to) {
  rebuildPreview();
  evoT = 0.001;
  plane.scale.setScalar(0.01);
  const i = FORMS.indexOf(to);
  $('evoName').textContent = `${FORM_ICON[i]} ${to.name}`;
  $('evoFrom').textContent = `${from.name} → ${to.name}. ${to.blurb}`;
  $('evoStats').textContent = `glide ×${to.gr} · launch ×${to.launch} · rocket ×${to.thrust} · coins ×${to.coin}`;
  const fl = $('flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
  $('shop').classList.remove('show');
  $('evo').classList.add('show');
  sfx.evolve(); buzz([40, 60, 40, 60, 140]);
  [0x3d8bff, 0xa35cff, 0xffc83a, 0xffffff].forEach((c, k) => setTimeout(() => spawnBurst(plane.position, c, 40, 8 + k * 2), 350 + k * 260));
  setTimeout(() => sfx.win(), 900);
}
$('evoOk').onclick = () => {
  sfx.click();
  $('evo').classList.remove('show');
  evoT = 0; plane.scale.setScalar(1); plane.rotation.set(0, 0, 0);
  screen('shop'); renderShop();
};

/* ---------------- reward cards after each flight ---------------- */
function dealCards() {
  const el = $('rCards');
  el.innerHTML = '';
  if (endInfo.dist < 20) { $('rPick').style.display = 'none'; return; }
  $('rPick').style.display = '';
  // free tiers only up to a cap that rises as you clear levels, so coins still matter
  const cap = Math.min(MAX_TIER, 1 + Math.floor(save.cleared / 3));
  const ups = UPGRADES.filter(u => save.up[u.id] < cap).sort(() => Math.random() - 0.5);
  const pouch = Math.round((12 + 8 * Math.min(levelN, 14)) * (0.8 + Math.random() * 0.5));
  // at most one free upgrade per deal, and only some of the time
  const deck = Math.random() < 0.55 ? ups.slice(0, 1).map(u => ({ kind: 'up', u })) : [];
  deck.push({ kind: 'coin', n: pouch });
  while (deck.length < 3) deck.push(deck.some(c => c.kind === 'boost') ? { kind: 'coin', n: Math.round(pouch * 1.4) } : { kind: 'boost' });
  deck.sort(() => Math.random() - 0.5);
  deck.forEach(c => {
    const b = document.createElement('button');
    if (c.kind === 'up') { b.className = 'pc rare'; b.innerHTML = `<i class="i">${c.u.icon}</i><b>${c.u.name} +1</b><span>Free tier ${save.up[c.u.id] + 1}</span>`; }
    else if (c.kind === 'coin') { b.className = 'pc coin'; b.innerHTML = `<i class="i">🪙</i><b>+${fmt(c.n)} coins</b><span>Coin pouch</span>`; }
    else { b.className = 'pc'; b.innerHTML = `<i class="i">⚡</i><b>Lucky flight</b><span>Next flight ×1.25 coins</span>`; }
    b.onclick = () => {
      if (c.kind === 'up') save.up[c.u.id]++;
      else if (c.kind === 'coin') { save.coins += c.n; save.stats.earned += c.n; }
      else save.boost = 1.25;
      persist(); sfx.buy();
      [...el.children].forEach(x => { x.disabled = true; x.classList.add(x === b ? 'taken' : 'gone'); });
    };
    el.appendChild(b);
  });
}

/* ---------------- away earnings ---------------- */
function checkAway() {
  const away = Date.now() - save.garageT;
  accrue(); persist();
  const n = Math.floor(save.bank);
  if (away < 3 * 60000 || n < 10) return;
  const mins = Math.min(AWAY_CAP_MIN, Math.floor(away / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  $('awayTxt').innerHTML = `Your garage planes earned <b>🪙 ${fmt(n)}</b> over ${h ? h + 'h ' : ''}${m}m (+${garageRate()} a minute). The garage earns for up to 2 hours while you're away.`;
  $('away').classList.add('show');
}
$('awayGo').onclick = () => { initAudio(); collect(); $('away').classList.remove('show'); if (phase === 'title') showTitle(); };

/* ---------------- mobile helpers ---------------- */
function showJoy(x, y, dx, dy) {
  const j = $('joy');
  j.classList.add('on');
  j.style.left = x + 'px'; j.style.top = y + 'px';
  j.firstElementChild.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
}
// Tilt steering: roll steers, pitch tilt climbs/dives, relative to how you hold the phone at launch.
const tilt = { on: store.get('sw.tilt', '0') === '1', ok: false, steer: 0, pitch: 0, base: null, calibrate: true };
function onOrient(e) {
  if (e.beta == null) return;
  tilt.ok = true;
  const ang = (screen.orientation?.angle ?? window.orientation ?? 0) % 360;
  let roll, nose; // roll: left/right tilt, nose: toward/away tilt
  if (ang === 90) { roll = e.beta; nose = -e.gamma; }
  else if (ang === 270 || ang === -90) { roll = -e.beta; nose = e.gamma; }
  else { roll = e.gamma; nose = e.beta; }
  if (tilt.calibrate || !tilt.base) { tilt.base = { roll, nose }; tilt.calibrate = false; }
  const dz = (v, d) => (Math.abs(v) < d ? 0 : v - Math.sign(v) * d);
  tilt.steer = clamp(dz(roll - tilt.base.roll, 3) / 22, -1, 1);
  tilt.pitch = clamp(-dz(nose - tilt.base.nose, 4) / 22, -1, 1);
}
async function setTilt(on) {
  if (on && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
    try { if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') on = false; } catch (e) { on = false; }
  }
  tilt.on = on; tilt.calibrate = true;
  store.set('sw.tilt', on ? '1' : '0');
  window.removeEventListener('deviceorientation', onOrient);
  if (on) window.addEventListener('deviceorientation', onOrient);
  syncChips();
}
function syncChips() {
  $('optTilt').classList.toggle('on', tilt.on);
  $('optTilt').style.display = MOBILE ? '' : 'none';
  const fsOk = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  $('optFull').style.display = fsOk ? '' : 'none';
  $('optFull').classList.toggle('on', !!(document.fullscreenElement || document.webkitFullscreenElement));
  $('optQuality').textContent = `✨ Graphics: ${{ auto: 'Auto', high: 'High', low: 'Battery saver' }[quality]}`;
}
$('optTilt').onclick = () => { initAudio(); sfx.click(); setTilt(!tilt.on); };
$('optFull').onclick = async () => {
  sfx.click();
  const d = document, el = d.documentElement;
  try {
    if (d.fullscreenElement || d.webkitFullscreenElement) await (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else await (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
  } catch (e) { /* refused */ }
  setTimeout(syncChips, 300);
};
$('optQuality').onclick = () => {
  sfx.click();
  quality = { auto: 'high', high: 'low', low: 'auto' }[quality];
  store.set('sw.quality', quality);
  if (quality === 'auto') dprStep = MOBILE ? 1 : 0;
  applyQuality(); syncChips();
};
document.addEventListener('fullscreenchange', syncChips);
if (tilt.on) setTilt(true); else syncChips();
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('visibilitychange', () => { if (document.hidden && phase === 'fly') { keys.clear(); boostTouch = false; } });
window.addEventListener('orientationchange', () => { tilt.calibrate = true; setTimeout(resize, 250); });

/* ---------------- loop + boot ---------------- */
let fpsT = 0, fpsN = 0;
function sampleFps(now) {
  if (quality !== 'auto' || phase !== 'fly') { fpsT = now; fpsN = 0; return; }
  fpsN++;
  if (now - fpsT > 2500) {
    const fps = (fpsN * 1000) / (now - fpsT);
    if (fps < 42 && dprStep < 3) { dprStep++; applyQuality(); }
    fpsT = now; fpsN = 0;
  }
}
function monoFrame(now) {
  if (dxr && dxr.active) return;
  requestAnimationFrame(monoFrame);
  sampleFps(now);
  step(now);
  renderer.render(scene, camera);
}

function badge(on) { const b = $('dxrBadge'); b.textContent = on ? 'DisplayXR 3D' : '2D'; b.classList.toggle('on', on); }

(async () => {
  await loadAll((d, n) => { $('loadBar').style.width = `${(d / n) * 100}%`; });
  loadLevel(Math.min(save.cleared, LEVEL_COUNT - 1));
  showTitle();
  checkAway();
  requestAnimationFrame(monoFrame);
  startDisplayXR({
    THREE, renderer, scene, camera, canvas,
    step: () => { step(performance.now()); },
    convergence: () => camera.position.distanceTo(plane ? plane.position : camLook),
    onLost: () => { resize(); requestAnimationFrame(monoFrame); badge(false); },
  }).then(c => { dxr = c; if (c && c.active) badge(true); });
})();

if (DEBUG) window.__sw = {
  get phase() { return phase; }, get flight() { return flight; }, get level() { return LV; }, get fs() { return fs; }, save,
  start: n => startLevel(n), aim, fire, keys, endFlight, shop: showShop, persist,
  give: c => { save.coins += c; persist(); },
  garage: () => save.garage, render: () => renderShop(), evolve: L => evolveScene(FORMS[L - 1], FORMS[L]), away: mins => { save.garageT -= mins * 60000; checkAway(); },
  maxAll: () => { UPGRADES.forEach(u => (save.up[u.id] = MAX_TIER)); persist(); },
};
