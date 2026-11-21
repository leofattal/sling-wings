import * as THREE from 'three';
import { BIOMES } from './levels.js';
import { place } from './assets.js';

// Builds everything for one level into a single group (disposed on level change).
export function buildWorld(level, scene, lights) {
  const B = BIOMES[level.biome];
  const root = new THREE.Group();
  const disposables = [];
  const keep = (...xs) => { disposables.push(...xs); return xs[0]; };

  // sky + fog
  scene.background = skyTexture(B);
  disposables.push(scene.background);
  scene.fog = new THREE.Fog(B.fog, 90, 420);
  lights.hemi.color.set(B.sky); lights.hemi.groundColor.set(B.grass[1]);
  lights.sun.color.set(B.sun);

  // terrain
  const L = level.length;
  const width = 420, len = L + 420, zc = -L / 2 - 60;
  const geo = keep(new THREE.PlaneGeometry(width, len, 105, Math.min(700, Math.round(len / 4))));
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, zc);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const g0 = new THREE.Color(B.grass[0]), g1 = new THREE.Color(B.grass[1]), rk = new THREE.Color(B.rock), sn = new THREE.Color(B.snow);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = level.ground(x, z);
    pos.setY(i, h);
    const n = Math.sin(x * 0.3) * Math.sin(z * 0.27) * 0.5 + 0.5;
    c.copy(g0).lerp(g1, n);
    const rel = h - (z > -10 ? level.launchH : 0);
    if (rel > 14) c.lerp(rk, Math.min(1, (rel - 14) / 14));
    if (rel > 40) c.lerp(sn, Math.min(1, (rel - 40) / 15));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 })));
  terrain.receiveShadow = true;
  root.add(terrain);

  // decor
  for (const d of level.decor) {
    const m = place(d.model, d.h, d.by);
    m.position.set(d.x, d.cloud ? d.y : level.ground(d.x, d.z) - 0.5, d.z);
    m.rotation.y = d.rot;
    if (d.cloud) m.userData.drift = 0.6 + (d.rot % 1);
    root.add(m);
  }

  // obstacles
  const spinners = [];
  for (const o of level.obstacles) {
    const name = o.kind === 'tree' ? B.trees[Math.floor(o.rot * 10) % B.trees.length] : { windmill: 'windmill', pillar: 'rock_tallA', tower: 'tower' }[o.kind];
    const m = place(name, o.h);
    m.position.set(o.x, level.ground(o.x, o.z) - 0.3, o.z);
    m.rotation.y = o.rot;
    root.add(m);
  }

  // updrafts: soft glowing column + rising sparkles
  const updraftFx = [];
  const upMat = keep(new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: true }));
  const sparkGeo = keep(new THREE.OctahedronGeometry(0.35));
  const sparkMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  for (const u of level.updrafts) {
    const gy = level.ground(u.x, u.z);
    const h = u.top - gy;
    const cyl = new THREE.Mesh(keep(new THREE.CylinderGeometry(u.r, u.r * 0.7, h, 24, 1, true)), upMat);
    cyl.position.set(u.x, gy + h / 2, u.z);
    root.add(cyl);
    const sparks = new THREE.InstancedMesh(sparkGeo, sparkMat, 40);
    const seeds = [];
    for (let i = 0; i < 40; i++) seeds.push({ a: Math.random() * 6.28, r: Math.random() * u.r * 0.85, y: Math.random() * h, s: 6 + Math.random() * 8 });
    sparks.userData = { seeds, u, gy, h };
    root.add(sparks);
    updraftFx.push(sparks);
  }

  // rings
  const ringGeo = keep(new THREE.TorusGeometry(3.4, 0.38, 12, 40));
  const ringMat = keep(new THREE.MeshStandardMaterial({ color: 0xffc83a, emissive: 0xff8a00, emissiveIntensity: 0.8, roughness: 0.35, metalness: 0.3 }));
  const ringDone = keep(new THREE.MeshStandardMaterial({ color: 0x7dffb2, emissive: 0x1fbf6a, emissiveIntensity: 0.6, transparent: true, opacity: 0.45 }));
  const rings = level.rings.map(r => {
    const m = new THREE.Mesh(ringGeo, ringMat);
    m.position.set(r.x, r.y, r.z);
    m.castShadow = true;
    root.add(m);
    return { ...r, mesh: m, taken: false, doneMat: ringDone };
  });

  // coins
  const coins = level.coins.map(cn => {
    const m = place('coin', 1.5);
    m.children[0].position.y -= 0.75;
    m.position.set(cn.x, cn.y, cn.z);
    root.add(m);
    return { ...cn, mesh: m, taken: false, pull: 0 };
  });

  // finish gate: two towers + banner
  const fz = -L, fxs = [-12, 12];
  for (const fx of fxs) {
    const t = place('tower', 16);
    t.position.set(fx, level.ground(fx, fz) - 0.5, fz);
    root.add(t);
  }
  const bannerTex = keep(checkerTexture());
  const banner = new THREE.Mesh(keep(new THREE.PlaneGeometry(24, 3)), keep(new THREE.MeshStandardMaterial({ map: bannerTex, side: THREE.DoubleSide })));
  const gy = Math.max(level.ground(-12, fz), level.ground(12, fz));
  banner.position.set(0, gy + 17, fz);
  root.add(banner);
  const finishWall = new THREE.Mesh(keep(new THREE.PlaneGeometry(400, 200)), keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide })));
  finishWall.position.set(0, gy + 90, fz);
  root.add(finishWall);

  // slingshot on the cliff
  const sling = buildSlingshot(keep);
  sling.group.position.set(0, level.launchH, 0);
  root.add(sling.group);

  scene.add(root);
  return {
    root, rings, coins, updraftFx, sling, spinners,
    dispose() {
      scene.remove(root);
      disposables.forEach(d => d.dispose?.());
      root.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
    },
  };
}

function buildSlingshot(keep) {
  const group = new THREE.Group();
  const wood = keep(new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 }));
  const dark = keep(new THREE.MeshStandardMaterial({ color: 0x5b3a1a, roughness: 0.9 }));
  const post = keep(new THREE.CylinderGeometry(0.28, 0.36, 3.2, 10));
  const arm = keep(new THREE.CylinderGeometry(0.22, 0.26, 2.6, 10));
  const base = new THREE.Mesh(post, wood); base.position.y = 1.6; group.add(base);
  const tips = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Mesh(arm, wood);
    a.position.set(s * 0.75, 3.9, 0); a.rotation.z = -s * 0.5; group.add(a);
    const cap = new THREE.Mesh(keep(new THREE.SphereGeometry(0.3, 10, 8)), dark);
    cap.position.set(s * 1.4, 5.05, 0); group.add(cap);
    tips.push(new THREE.Vector3(s * 1.4, 5.05, 0));
  }
  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // bands: a 3-point line strip tip -> pouch -> tip
  const bandGeo = keep(new THREE.BufferGeometry());
  bandGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const band = new THREE.Line(bandGeo, keep(new THREE.LineBasicMaterial({ color: 0x3a1f12 })));
  band.frustumCulled = false;
  group.add(band);
  const bandTube = new THREE.Group(); group.add(bandTube);
  const tubeMat = keep(new THREE.MeshStandardMaterial({ color: 0x2b1a12, roughness: 0.6 }));
  const tubeGeo = keep(new THREE.CylinderGeometry(0.09, 0.09, 1, 6));
  tubeGeo.translate(0, 0.5, 0);
  const tubes = [new THREE.Mesh(tubeGeo, tubeMat), new THREE.Mesh(tubeGeo, tubeMat)];
  tubes.forEach(t => bandTube.add(t));
  const up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3();
  function setPouch(local) {
    const p = bandGeo.attributes.position;
    p.setXYZ(0, tips[0].x, tips[0].y, tips[0].z); p.setXYZ(1, local.x, local.y, local.z); p.setXYZ(2, tips[1].x, tips[1].y, tips[1].z);
    p.needsUpdate = true;
    for (let i = 0; i < 2; i++) {
      tmp.subVectors(local, tips[i]);
      tubes[i].position.copy(tips[i]);
      tubes[i].scale.set(1, tmp.length(), 1);
      tubes[i].quaternion.setFromUnitVectors(up, tmp.normalize());
    }
  }
  setPouch(new THREE.Vector3(0, 5.0, 0.6));
  return { group, setPouch, rest: new THREE.Vector3(0, 5.0, 0.6) };
}

function skyTexture(B) {
  const cv = document.createElement('canvas');
  cv.width = 4; cv.height = 256;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  const hex = n => '#' + n.toString(16).padStart(6, '0');
  grad.addColorStop(0, hex(B.sky));
  grad.addColorStop(0.62, hex(B.horizon));
  grad.addColorStop(1, hex(B.fog));
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function checkerTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 32;
  const g = cv.getContext('2d');
  for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 16, y * 16, 16, 16); }
  g.fillStyle = '#ffcf33'; g.font = 'bold 22px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(84, 3, 88, 26);
  g.fillStyle = '#ffcf33'; g.fillText('FINISH', 128, 17);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
