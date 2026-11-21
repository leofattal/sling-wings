import * as THREE from 'three';
import { loadAll, planeModel } from './assets.js';
import { buildWorld } from './world.js';
import { makeLevel, updraftAt, LEVEL_COUNT, LEVEL_NAMES } from './levels.js';
import { makeStats, newFlight, stepFlight, UPGRADES, PLANES, MAX_TIER } from './physics.js';
import { initAudio, setFlightSound, sfx, toggleMute, isMuted } from './audio.js';
import { startDisplayXR } from './displayxr.js';
import './style.css';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEBUG = location.search.includes('debug');

/* ---------------- save ---------------- */
const SAVE_KEY = 'slingwings.v1';
const save = { coins: 0, up: Object.fromEntries(UPGRADES.map(u => [u.id, 0])), planes: ['c172'], plane: 'c172', cleared: 0, best: Array(LEVEL_COUNT).fill(0) };
try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s) Object.assign(save, s, { up: { ...save.up, ...s.up } }); } catch (e) { /* fresh save */ }
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage blocked: progress lasts this session */ } };

/* ---------------- renderer ---------------- */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const MOBILE = window.matchMedia?.('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
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
let phase = 'loading'; // loading | title | aim | fly | end
let levelN = 0, LV = null, world = null, plane = null, planeId = null, st = null, flight = null;
let earned = { coins: 0, rings: 0 }, endInfo = null, endT = 0;
const aim = { power: 0, yaw: 0, pitch: 0.25, dragging: false, sx: 0, sy: 0, keyCharge: false, chargeDir: 1 };
const input = { pitch: 0, steer: 0, boost: false };
const keys = new Set();
const joy = { active: false, id: -1, sx: 0, sy: 0, x: 0, y: 0 };
let boostTouch = false;

// trajectory preview dots
const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }), 36);
dots.frustumCulled = false;
scene.add(dots);

// boost flame + contrail
const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.8, 10), new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.9 }));
flame.rotation.x = -Math.PI / 2;
const TRAIL_N = 90;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
trail.frustumCulled = false;
scene.add(trail);
let trailCount = 0, trailTick = 0;

/* ---------------- level setup ---------------- */
function loadLevel(n) {
  levelN = n;
  world?.dispose();
  LV = makeLevel(n);
  world = buildWorld(LV, scene, lights);
  setPlane(save.plane);
  st = makeStats(save.up, save.plane);
  flight = null;
  aim.power = 0; aim.yaw = 0; aim.pitch = 0.25;
  placeOnSling();
  trailCount = 0; trail.visible = false;
  $('hLvl').textContent = `${n + 1} · ${LV.name}`;
  $('hBest').style.left = `${clamp(save.best[n] / LV.length, 0, 1) * 100}%`;
  $('hWindBox').style.display = LV.wind.x || LV.wind.z ? '' : 'none';
  const w = LV.wind;
  $('hWind').textContent = (w.x > 0 ? '→' : w.x < 0 ? '←' : '') + (w.z > 0 ? '↓' : '') + ' ' + Math.round(Math.hypot(w.x, w.z) * 3.6);
}

function setPlane(id) {
  if (plane && planeId === id) return;
  if (plane) scene.remove(plane);
  plane = planeModel(id);
  planeId = id;
  plane.rotation.order = 'YXZ';
  plane.traverse(o => { if (o.isMesh) o.castShadow = true; });
  flame.position.set(0, 0, (PLANES.find(p => p.id === id)?.len || 3.2) * 0.5 + 0.8);
  plane.add(flame);
  flame.visible = false;
  scene.add(plane);
}

const launchOrigin = () => new THREE.Vector3(0, LV.launchH + 5.0, 0.6);
function aimDir() {
  return new THREE.Vector3(-Math.sin(aim.yaw) * Math.cos(aim.pitch), Math.sin(aim.pitch), -Math.cos(aim.yaw) * Math.cos(aim.pitch));
}
function placeOnSling() {
  const d = aimDir();
  const pull = aim.power * 3.2;
  const p = launchOrigin().addScaledVector(d, -pull);
  plane.position.copy(p);
  plane.rotation.set(aim.pitch, aim.yaw, 0);
  const local = p.clone().sub(world.sling.group.position);
  local.addScaledVector(d, -(PLANES.find(q => q.id === planeId).len * 0.45));
  world.sling.setPouch(local);
  updatePreview();
}

function launchSpeed() { return st.launch * (0.35 + 0.65 * aim.power); }
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
    const sc = 1 - i / dots.count * 0.6;
    m.makeScale(sc, sc, sc).setPosition(s.x, s.y, s.z);
    dots.setMatrixAt(i, m);
  }
  dots.instanceMatrix.needsUpdate = true;
}

function fire() {
  if (aim.power < 0.12) { aim.power = 0; placeOnSling(); return; }
  const o = launchOrigin();
  flight = newFlight(o.x, o.y, o.z, launchSpeed(), aim.pitch, aim.yaw, st.fuel);
  earned = { coins: 0, rings: 0 };
  phase = 'fly';
  sfx.launch();
  snapT = 0.35;
  dots.visible = false;
  trail.visible = true; trailCount = 0;
  hint(MOBILE ? 'Drag to steer · hold 🔥 to boost' : 'W/S climb & dive · A/D steer · Space boost', 3500);
  $('boostBtn').classList.add('armed');
}
let snapT = 0;

/* ---------------- flight step ---------------- */
const FIXED = 1 / 120;
let acc = 0, last = performance.now();
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3();
let shake = 0;

function readInput() {
  let p = 0, s = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) p += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) p -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
  if (joy.active) { p += joy.y; s += joy.x; }
  input.pitch = clamp(p, -1, 1);
  input.steer = clamp(s, -1, 1);
  input.boost = keys.has('Space') || keys.has('ShiftLeft') || boostTouch;
}

function physicsStep(dt) {
  const s = flight;
  const pz = s.z;
  stepFlight(s, input, st, dt, { wind: LV.wind, updraft: (x, y, z) => updraftAt(LV, x, y, z) });
  // rings
  for (const r of world.rings) {
    if (r.taken) continue;
    if (pz > r.z && s.z <= r.z && Math.hypot(s.x - r.x, s.y - r.y) < r.r + 0.3) {
      r.taken = true; r.mesh.material = r.doneMat;
      s.v = Math.min(95, s.v + 7);
      s.fuel = Math.min(st.fuel, s.fuel + 0.6);
      earned.rings++;
      sfx.ring(); toast('RING! +speed'); shake = 0.15;
    }
  }
  // finish
  if (s.z <= -LV.length) return endFlight(true, 'finish');
  // ground / obstacles
  const g = LV.ground(s.x, s.z);
  if (s.y < g + 0.55) return endFlight(false, s.gamma > -0.3 && s.v < 26 ? 'landed' : 'crash');
  for (const o of LV.obstacles) {
    if (Math.abs(o.z - s.z) < o.r + 1 && Math.hypot(o.x - s.x, o.z - s.z) < o.r + 0.6 && s.y < LV.ground(o.x, o.z) + o.h * 0.92) return endFlight(false, 'hit');
  }
  if (s.t > 300) return endFlight(false, 'landed');
}

function stepCoins(dt) {
  const p = plane.position;
  const r2 = st.magnet * st.magnet;
  for (const c of world.coins) {
    if (c.taken) continue;
    const m = c.mesh;
    m.rotation.y += dt * 3;
    if (phase !== 'fly') continue;
    const dz = m.position.z - p.z;
    if (dz > 8 || dz < -60) continue;
    const d2 = m.position.distanceToSquared(p);
    if (d2 < r2 || c.pull > 0) {
      c.pull = Math.min(1, c.pull + dt * 4);
      m.position.lerp(p, Math.min(1, dt * (6 + 18 * c.pull)));
    }
    if (m.position.distanceToSquared(p) < 2.6) {
      c.taken = true; m.visible = false; earned.coins++;
      sfx.coin();
      $('hCoins').textContent = earned.coins;
    }
  }
}

function endFlight(win, how) {
  if (phase !== 'fly') return;
  phase = 'end';
  endT = 0;
  $('boostBtn').classList.remove('armed');
  const dist = win ? LV.length : Math.max(0, Math.round(-flight.z));
  const prevBest = save.best[levelN];
  save.best[levelN] = Math.max(prevBest, dist);
  const firstClear = win && save.cleared <= levelN;
  const rows = [];
  rows.push(['Distance ' + dist + ' m', Math.floor(dist / 4)]);
  if (earned.coins) rows.push([`Coins × ${earned.coins}`, earned.coins * 3]);
  if (earned.rings) rows.push([`Rings × ${earned.rings}`, earned.rings * 6]);
  if (win) rows.push([firstClear ? 'Level clear (first time ×2)' : 'Level clear', (40 + 25 * levelN) * (firstClear ? 2 : 1)]);
  if (dist > prevBest && prevBest > 0 && !win) rows.push(['New best!', 15]);
  let total = rows.reduce((a, r) => a + r[1], 0);
  const mul = st.coinMul;
  if (mul > 1) { const bonus = Math.round(total * (mul - 1)); rows.push([`${PLANES.find(p => p.id === save.plane).name} bonus`, bonus]); total += bonus; }
  save.coins += total;
  if (win) save.cleared = Math.max(save.cleared, levelN + 1);
  persist();
  endInfo = { win, how, dist, rows, total, prevBest };
  if (win) { sfx.win(); toast('FINISH!'); } else { sfx.crash(); shake = how === 'landed' ? 0.2 : 0.6; toast(how === 'landed' ? 'Touchdown' : 'Crash!'); }
  setFlightSound(0, false, false);
}

/* ---------------- per-frame update ---------------- */
let hudT = 0;
function step(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (phase === 'loading') return;

  if (phase === 'aim' && aim.keyCharge) {
    aim.power += aim.chargeDir * dt * 0.9;
    if (aim.power >= 1) { aim.power = 1; aim.chargeDir = -1; }
    if (aim.power <= 0.15 && aim.chargeDir < 0) { aim.power = 0.15; aim.chargeDir = 1; }
    placeOnSling();
  }
  if (phase === 'aim') {
    const ay = (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0) - (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0);
    const ap = (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0) - (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0);
    if (ay || ap) { aim.yaw = clamp(aim.yaw + ay * dt * 0.6, -0.5, 0.5); aim.pitch = clamp(aim.pitch + ap * dt * 0.5, 0.05, 0.75); placeOnSling(); }
  }

  if (phase === 'fly') {
    readInput();
    acc += dt;
    while (acc >= FIXED && phase === 'fly') { physicsStep(FIXED); acc -= FIXED; }
    if (flight) {
      plane.position.set(flight.x, flight.y, flight.z);
      plane.rotation.set(flight.gamma, flight.psi, flight.bank * 1.1);
      flame.visible = flight.boosting;
      if (flight.boosting) flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
      setFlightSound(flight.v, flight.boosting, true);
    }
  }
  if (phase === 'end' && flight) {
    endT += dt;
    // tumble / skid to a stop
    flight.v *= Math.exp(-dt * 3);
    const g = LV.ground(plane.position.x, plane.position.z);
    tmp.set(-Math.sin(flight.psi), 0, -Math.cos(flight.psi)).multiplyScalar(flight.v * dt);
    if (endInfo && !endInfo.win) {
      plane.position.add(tmp);
      plane.position.y = Math.max(g + 0.5, plane.position.y - dt * 8);
      if (endInfo.how !== 'landed') { plane.rotation.z += dt * flight.v * 0.15; plane.rotation.x *= 0.95; }
      else plane.rotation.x *= 0.9;
    } else {
      flight.z -= 20 * dt; flight.y += 4 * dt;
      plane.position.set(flight.x, flight.y, flight.z);
      plane.rotation.x = 0.2; plane.rotation.z = Math.sin(endT * 3) * 0.3;
    }
    flame.visible = false;
    if (endT > 1.6 && endInfo && !endInfo.shown) { endInfo.shown = true; showResult(); }
  }

  // snap animation for the bands
  if (snapT > 0) {
    snapT -= dt;
    const k = Math.max(0, snapT / 0.35);
    const r = world.sling.rest.clone();
    r.z += Math.sin(k * 18) * k * 1.2;
    world.sling.setPouch(r);
  }

  stepCoins(dt);
  animateWorld(dt, now);
  updateTrail();
  updateCamera(dt);
  updateSun();

  hudT -= dt;
  if (hudT <= 0 && (phase === 'fly' || phase === 'end') && flight) {
    hudT = 0.08;
    const d = Math.max(0, -flight.z);
    $('hDist').textContent = `${Math.round(d)} / ${LV.length} m`;
    $('hProg').style.width = `${clamp(d / LV.length, 0, 1) * 100}%`;
    $('hSpd').textContent = Math.round(flight.v * 3.6);
    $('hAlt').textContent = Math.max(0, Math.round(flight.y - LV.ground(flight.x, flight.z)));
    $('hFuel').style.width = `${(flight.fuel / st.fuel) * 100}%`;
  }
}

function animateWorld(dt, now) {
  for (const r of world.rings) r.mesh.rotation.z += dt * (r.taken ? 2 : 0.6);
  for (const sp of world.updraftFx) {
    const { seeds, u, gy, h } = sp.userData;
    const m = new THREE.Matrix4();
    seeds.forEach((s, i) => {
      s.y = (s.y + dt * s.s) % h;
      s.a += dt * 1.5;
      m.makeTranslation(u.x + Math.cos(s.a) * s.r, gy + s.y, u.z + Math.sin(s.a) * s.r);
      sp.setMatrixAt(i, m);
    });
    sp.instanceMatrix.needsUpdate = true;
  }
}

function updateTrail() {
  if (!trail.visible || phase !== 'fly') return;
  if (++trailTick % 3) return;
  const a = trailGeo.attributes.position.array;
  a.copyWithin(3, 0, (TRAIL_N - 1) * 3);
  tmp.set(0, 0, 1.6).applyEuler(plane.rotation).add(plane.position);
  a[0] = tmp.x; a[1] = tmp.y; a[2] = tmp.z;
  trailCount = Math.min(TRAIL_N, trailCount + 1);
  if (trailCount === 1) for (let i = 1; i < TRAIL_N; i++) a.set([tmp.x, tmp.y, tmp.z], i * 3);
  trailGeo.attributes.position.needsUpdate = true;
}

function updateCamera(dt) {
  let want, look;
  if (phase === 'aim' || phase === 'title') {
    const o = launchOrigin();
    const d = aimDir();
    want = o.clone().add(new THREE.Vector3(d.x * -9, 3.2, 10 + aim.power * 2));
    look = o.clone().addScaledVector(d, 25);
    look.y = o.y - 1;
    if (phase === 'title') { const t = performance.now() / 6000; want.set(Math.sin(t) * 16, LV.launchH + 9, 6 + Math.cos(t) * 10); look.set(0, LV.launchH, -40); }
  } else {
    const back = new THREE.Vector3(Math.sin(flight.psi), 0, Math.cos(flight.psi));
    const dist = 8.5 + (flight.v - 13) * 0.06;
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
function toast(t) { const el = $('hToast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 900); }
function screen(id) { for (const s of ['title', 'shop', 'result', 'loading']) $(s).classList.toggle('show', s === id); }
function showHud(on) { $('hud').classList.toggle('hidden', !on); document.body.classList.toggle('flying', on); }

function showTitle() {
  phase = 'title';
  showHud(false);
  setFlightSound(0, false, false);
  $('tCoins').textContent = save.coins;
  const grid = $('levels');
  grid.innerHTML = '';
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const b = document.createElement('button');
    const locked = i > save.cleared;
    const band = i < 5 ? 'b1' : i < 10 ? 'b2' : 'b3';
    b.className = `lv ${band} ${i < save.cleared ? 'done' : i === save.cleared ? 'next' : ''} ${locked ? 'locked' : ''}`;
    b.innerHTML = `<b>${locked ? '🔒' : i + 1}</b><span>${LEVEL_NAMES[i]}</span><em>${save.best[i] ? 'best ' + save.best[i] + ' m' : makeLevelLen(i) + ' m'}</em>`;
    b.disabled = locked;
    b.onclick = () => { initAudio(); startLevel(i); };
    grid.appendChild(b);
  }
  screen('title');
}
const lenCache = {};
function makeLevelLen(i) { return (lenCache[i] ??= makeLevel(i).length); }

function startLevel(n) {
  if (n !== levelN || !LV || flight) loadLevel(n);
  st = makeStats(save.up, save.plane);
  setPlane(save.plane);
  flight = null; aim.power = 0; placeOnSling();
  phase = 'aim';
  screen(null);
  showHud(true);
  $('hCoins').textContent = '0';
  $('hDist').textContent = `0 / ${LV.length} m`; $('hProg').style.width = '0%';
  $('hSpd').textContent = '0'; $('hAlt').textContent = '0'; $('hFuel').style.width = '100%';
  const tips = [
    'Drag back from the plane and let go!',
    'Fly through rings for a speed burst.',
    'Rings refill a bit of rocket fuel.',
    'Windmills ahead — steer around them.',
    'Glowing columns are updrafts: ride them up!',
    'Dive to gain speed, pull up to trade it for height.',
    'A ridge blocks the valley — find the notch!',
    'Crosswind! It pushes you sideways.',
    'Save your rocket for when you slow down.',
    'Two ridges this time.',
    'Dusk canyons: rock pillars everywhere.',
    'Towers! Weave between them.',
    'Every trick you know.',
    'Headwind and crosswind. Good luck.',
    'The longest valley. Make every metre count.',
  ];
  hint((MOBILE ? '👆 ' : '🖱 ') + tips[n] + (MOBILE ? '' : '  (or hold Space)'), 0);
}

function showResult() {
  const r = endInfo;
  $('rTitle').textContent = r.win ? '🏁 Level cleared!' : r.how === 'hit' ? '💥 Smack!' : r.how === 'landed' ? '🛬 Touchdown' : '💥 Crashed';
  $('rSub').textContent = r.win ? `${LV.name} complete.` : `${Math.max(0, LV.length - r.dist)} m to go. Upgrade in the hangar and try again!`;
  $('rDist').textContent = `${r.dist} / ${LV.length} m`;
  $('rBar').style.width = '0%';
  requestAnimationFrame(() => requestAnimationFrame(() => ($('rBar').style.width = `${clamp(r.dist / LV.length, 0, 1) * 100}%`)));
  $('rEarn').innerHTML = r.rows.map(([k, v]) => `<span>${k}</span><b>+${v}</b>`).join('') + `<span class="tot">Total</span><b class="tot">🪙 ${r.total}</b>`;
  const hasNext = levelN + 1 < LEVEL_COUNT && save.cleared > levelN;
  $('rNext').style.display = r.win && hasNext ? '' : 'none';
  $('rRetry').textContent = r.win ? '↻ Replay' : '↻ Retry';
  if (r.win && levelN + 1 >= LEVEL_COUNT) $('rSub').textContent = 'You beat all 15 valleys! Keep flying for coins and planes.';
  screen('result');
  showHud(false);
  ($('rNext').style.display === '' ? $('rNext') : $('rRetry')).focus();
}

function showShop() {
  phase = phase === 'end' ? 'end' : 'title';
  showHud(false);
  renderShop();
  screen('shop');
}
function renderShop() {
  $('sCoins').textContent = save.coins;
  const up = $('upCards'); up.innerHTML = '';
  for (const u of UPGRADES) {
    const t = save.up[u.id];
    const cost = t < MAX_TIER ? u.costs[t] : 0;
    const c = document.createElement('div');
    c.className = 'card';
    c.innerHTML = `<div class="t">${u.icon} ${u.name}</div><div class="d">${u.desc}</div><div class="pips">${Array.from({ length: MAX_TIER }, (_, i) => `<i class="${i < t ? 'on' : ''}"></i>`).join('')}</div>`;
    const b = document.createElement('button');
    if (t >= MAX_TIER) { b.textContent = 'MAX'; b.className = 'max'; b.disabled = true; }
    else { b.textContent = `Upgrade · 🪙 ${cost}`; if (save.coins < cost) b.className = 'poor'; }
    b.onclick = () => {
      if (t >= MAX_TIER) return;
      if (save.coins < cost) return sfx.deny();
      save.coins -= cost; save.up[u.id]++; persist(); sfx.buy(); renderShop();
    };
    c.appendChild(b);
    up.appendChild(c);
  }
  const pc = $('planeCards'); pc.innerHTML = '';
  for (const p of PLANES) {
    const owned = save.planes.includes(p.id);
    const c = document.createElement('div');
    c.className = 'card' + (save.plane === p.id ? ' sel' : '');
    const perks = [`glide ×${p.gr}`, p.thrust !== 1 && `rocket ×${p.thrust}`, p.coin > 1 && `coins ×${p.coin}`].filter(Boolean).join(' · ');
    c.innerHTML = `<div class="t">✈ ${p.name}</div><div class="d">${p.blurb}</div><div class="stat">${perks}</div>`;
    const b = document.createElement('button');
    if (save.plane === p.id) { b.textContent = 'Flying this'; b.className = 'using'; }
    else if (owned) { b.textContent = 'Use'; }
    else { b.textContent = `Buy · 🪙 ${p.cost}`; if (save.coins < p.cost) b.className = 'poor'; }
    b.onclick = () => {
      if (save.plane === p.id) return;
      if (!owned) { if (save.coins < p.cost) return sfx.deny(); save.coins -= p.cost; save.planes.push(p.id); sfx.buy(); }
      save.plane = p.id; persist(); renderShop();
    };
    c.appendChild(b);
    pc.appendChild(c);
  }
}

$('tShop').onclick = () => { initAudio(); showShop(); };
$('sBack').onclick = () => showTitle();
$('sFly').onclick = () => { initAudio(); startLevel(endInfo && !endInfo.win ? levelN : Math.min(save.cleared, LEVEL_COUNT - 1)); };
$('rShop').onclick = () => showShop();
$('rRetry').onclick = () => { loadLevel(levelN); startLevel(levelN); };
$('rNext').onclick = () => startLevel(levelN + 1);
$('hExit').onclick = () => { if (phase === 'fly') endFlight(false, 'crash'); else showTitle(); };
$('hMute').onclick = () => { initAudio(); $('hMute').textContent = toggleMute() ? '🔇' : '🔊'; };
$('hMute').textContent = isMuted() ? '🔇' : '🔊';

/* ---------------- input ---------------- */
const pullMax = () => Math.min(window.innerWidth, window.innerHeight) * 0.32;
canvas.addEventListener('pointerdown', e => {
  initAudio();
  if (phase === 'aim') {
    aim.dragging = true; aim.sx = e.clientX; aim.sy = e.clientY; aim.keyCharge = false;
    canvas.setPointerCapture(e.pointerId);
    hint('', 0);
  } else if (phase === 'fly' && !joy.active) {
    joy.active = true; joy.id = e.pointerId; joy.sx = e.clientX; joy.sy = e.clientY; joy.x = joy.y = 0;
    canvas.setPointerCapture(e.pointerId);
  }
});
let lastStretch = 0;
canvas.addEventListener('pointermove', e => {
  if (phase === 'aim' && aim.dragging) {
    const m = pullMax();
    const dx = e.clientX - aim.sx, dy = e.clientY - aim.sy;
    const prev = aim.power;
    aim.power = clamp(Math.hypot(dx, dy) / m, 0, 1);
    aim.yaw = clamp((dx / m) * 0.45, -0.5, 0.5);
    aim.pitch = clamp(0.08 + 0.5 * clamp(dy / m, 0, 1), 0.05, 0.75);
    if (Math.abs(aim.power - prev) > 0.05 && performance.now() - lastStretch > 60) { sfx.stretch(); lastStretch = performance.now(); }
    placeOnSling();
  } else if (joy.active && e.pointerId === joy.id) {
    const m = Math.min(window.innerWidth, window.innerHeight) * 0.18;
    joy.x = clamp((e.clientX - joy.sx) / m, -1, 1);
    joy.y = clamp(-(e.clientY - joy.sy) / m, -1, 1);
  }
});
const endPointer = e => {
  if (phase === 'aim' && aim.dragging) { aim.dragging = false; fire(); }
  if (joy.active && e.pointerId === joy.id) { joy.active = false; joy.x = joy.y = 0; }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
const bb = $('boostBtn');
bb.addEventListener('pointerdown', e => { e.preventDefault(); boostTouch = true; bb.classList.add('on'); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => bb.addEventListener(ev, () => { boostTouch = false; bb.classList.remove('on'); }));

window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && phase !== 'title') e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  initAudio();
  if (phase === 'aim' && e.code === 'Space') { aim.keyCharge = true; aim.chargeDir = 1; aim.power = Math.max(aim.power, 0.15); hint('', 0); }
  if (e.code === 'KeyR' && (phase === 'fly' || phase === 'end')) { screen(null); loadLevel(levelN); startLevel(levelN); }
  if (e.code === 'Escape') { if (phase === 'fly') endFlight(false, 'crash'); else if (phase === 'aim') showTitle(); }
});
window.addEventListener('keyup', e => {
  keys.delete(e.code);
  if (phase === 'aim' && e.code === 'Space' && aim.keyCharge) { aim.keyCharge = false; fire(); }
});
window.addEventListener('blur', () => { keys.clear(); boostTouch = false; });

/* ---------------- loop + boot ---------------- */
function monoFrame(now) {
  if (dxr && dxr.active) return;
  requestAnimationFrame(monoFrame);
  step(now);
  renderer.render(scene, camera);
}

(async () => {
  await loadAll((d, n) => { $('loadBar').style.width = `${(d / n) * 100}%`; });
  loadLevel(Math.min(save.cleared, LEVEL_COUNT - 1));
  showTitle();
  requestAnimationFrame(monoFrame);
  startDisplayXR({
    THREE, renderer, scene, camera, canvas,
    step: () => { step(performance.now()); },
    convergence: () => camera.position.distanceTo(plane ? plane.position : camLook),
    onLost: () => { resize(); requestAnimationFrame(monoFrame); badge(false); },
  }).then(c => { dxr = c; if (c && c.active) badge(true); });
})();

function badge(on) { const b = $('dxrBadge'); b.textContent = on ? 'DisplayXR 3D' : '2D'; b.classList.toggle('on', on); }

if (DEBUG) window.__sw = {
  get phase() { return phase; }, get flight() { return flight; }, get level() { return LV; }, save,
  start: n => startLevel(n), aim, fire, keys, endFlight,
  give: c => { save.coins += c; persist(); },
};
