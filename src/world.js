import * as THREE from 'three';
import { BIOMES, CHUNK, chunkIndex } from './levels.js';
import { place, centred } from './assets.js';

// Streams the valley in CHUNK-long slices around the plane: terrain, scenery, pickups, hazards.
const BEHIND = 2;

export function buildWorld(level, scene, lights, slingTier, AHEAD = 5) {
  const B = BIOMES[level.biome];
  const root = new THREE.Group();
  const shared = [];
  const keep = x => { shared.push(x); return x; };

  scene.background = keep(skyTexture(B));
  scene.fog = new THREE.Fog(B.fog, 90, 430);
  lights.hemi.color.set(B.sky); lights.hemi.groundColor.set(B.grass[1]);
  lights.sun.color.set(B.sun);

  const terrainMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  const ringGeo = keep(new THREE.TorusGeometry(3.4, 0.38, 12, 40));
  const ringMat = keep(new THREE.MeshStandardMaterial({ color: 0xffc83a, emissive: 0xff8a00, emissiveIntensity: 0.8, roughness: 0.35, metalness: 0.3 }));
  const ringDone = keep(new THREE.MeshStandardMaterial({ color: 0x7dffb2, emissive: 0x1fbf6a, emissiveIntensity: 0.6, transparent: true, opacity: 0.45 }));
  const upMat = keep(new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  const sparkGeo = keep(new THREE.OctahedronGeometry(0.35));
  const sparkMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const glowTex = keep(glowTexture());
  const glowMats = {};
  const glowMat = color => (glowMats[color] ??= keep(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  const balloonVariants = [0, 0.33, 0.6, 0.85].map(h => tintedBalloon(h, keep));
  const g0 = new THREE.Color(B.grass[0]), g1 = new THREE.Color(B.grass[1]), rk = new THREE.Color(B.rock), sn = new THREE.Color(B.snow);

  const chunks = new Map(); // k -> { group, disp, data }
  const live = { rings: [], coins: [], updraftFx: [], birds: [], balloons: [] };

  function buildChunk(k) {
    const data = level.chunk(k);
    const group = new THREE.Group();
    const disp = [];
    const z0 = -k * CHUNK;

    // terrain slice
    const geo = new THREE.PlaneGeometry(420, CHUNK, 84, CHUNK / 4);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, z0 - CHUNK / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = level.ground(x, z);
      pos.setY(i, h);
      c.copy(g0).lerp(g1, Math.sin(x * 0.3) * Math.sin(z * 0.27) * 0.5 + 0.5);
      const rel = h - (z > -10 ? level.launchH : 0);
      if (rel > 14) c.lerp(rk, Math.min(1, (rel - 14) / 14));
      if (rel > 40) c.lerp(sn, Math.min(1, (rel - 40) / 15));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, terrainMat);
    terrain.receiveShadow = true;
    group.add(terrain);
    disp.push(geo);

    for (const d of data.decor) {
      if (d.cloud && level.biome === 'dusk') continue; // clouds read as floating rocks at dusk
      const m = place(d.model, d.h, d.by);
      m.position.set(d.x, d.cloud ? d.y : level.ground(d.x, d.z) - 0.5, d.z);
      m.rotation.y = d.rot;
      group.add(m);
    }
    for (const o of data.obstacles) {
      const name = o.kind === 'tree' ? B.trees[Math.floor(o.rot * 10) % B.trees.length] : { windmill: 'windmill', pillar: 'rock_tallA', tower: 'tower' }[o.kind];
      const m = place(name, o.h);
      m.position.set(o.x, level.ground(o.x, o.z) - 0.3, o.z);
      m.rotation.y = o.rot;
      group.add(m);
    }
    for (const u of data.updrafts) {
      const gy = level.ground(u.x, u.z), h = u.top - gy;
      const cg = new THREE.CylinderGeometry(u.r, u.r * 0.7, h, 24, 1, true);
      disp.push(cg);
      const cyl = new THREE.Mesh(cg, upMat);
      cyl.position.set(u.x, gy + h / 2, u.z);
      group.add(cyl);
      const sparks = new THREE.InstancedMesh(sparkGeo, sparkMat, 40);
      const seeds = Array.from({ length: 40 }, () => ({ a: Math.random() * 6.28, r: Math.random() * u.r * 0.85, y: Math.random() * h, s: 6 + Math.random() * 8 }));
      sparks.userData = { seeds, u, gy, h };
      sparks.frustumCulled = false;
      group.add(sparks);
      disp.push(sparks);
      live.updraftFx.push(sparks);
    }
    for (const r of data.rings) {
      const m = new THREE.Mesh(ringGeo, r.taken ? ringDone : ringMat);
      m.position.set(r.x, r.y, r.z);
      group.add(m);
      r.mesh = m; r.doneMat = ringDone;
      live.rings.push(r);
    }
    for (const cn of data.coins) {
      if (cn.taken) continue;
      const m = centred('coin', 1.5);
      m.position.set(cn.x, cn.y, cn.z);
      group.add(m);
      cn.mesh = m; cn.pull = 0; cn.kind = 'coin';
      live.coins.push(cn);
    }
    const pickup = (list, model, size, kind, glow) => {
      for (const p of list) {
        if (p.taken) continue;
        const m = centred(model, size);
        m.position.set(p.x, p.y, p.z);
        const s = new THREE.Sprite(glowMat(glow));
        s.scale.setScalar(size * 2.4);
        m.add(s);
        group.add(m);
        p.mesh = m; p.kind = kind; p.pull = 0;
        live.coins.push(p);
      }
    };
    pickup(data.gems, 'jewel', 1.6, 'gem', 0x7fb4ff);
    pickup(data.fuels, 'gascan', 1.7, 'fuel', 0xff8a5a);
    pickup(data.stars, 'star', 2, 'star', 0xffe27a);
    for (const b of data.balloons) {
      const m = balloonVariants[(b.variant + Math.floor(b.bob * 10)) % balloonVariants.length].clone(true);
      m.position.set(b.x, b.y - 3.6, b.z);
      group.add(m);
      b.mesh = m;
      live.balloons.push(b);
    }
    for (const f of data.birds) {
      const flock = new THREE.Group();
      f.members = [];
      for (let i = 0; i < f.n; i++) {
        const bird = centred('seagull', 1.5);
        bird.position.set((i % 3) * 1.7 - 1.7, Math.floor(i / 3) * 0.9 + (i % 2) * 0.4, -i * 1.1);
        bird.userData.ph = i * 0.7;
        flock.add(bird);
        f.members.push(bird);
      }
      flock.position.set(f.x, f.y, f.z);
      group.add(flock);
      f.mesh = flock;
      live.birds.push(f);
    }

    if (Number.isFinite(level.length) && -level.length <= z0 && -level.length > z0 - CHUNK) addFinish(group, disp, -level.length);
    root.add(group);
    chunks.set(k, { group, disp, data });
  }

  function addFinish(group, disp, fz) {
    const gy = Math.max(level.ground(-12, fz), level.ground(12, fz));
    for (const fx of [-12, 12]) {
      const t = place('tower', 16);
      t.position.set(fx, level.ground(fx, fz) - 0.5, fz);
      group.add(t);
      const f = place('flag', 4);
      f.position.set(fx, gy + 16, fz);
      group.add(f);
    }
    const tex = checkerTexture();
    const pg = new THREE.PlaneGeometry(24, 3), pm = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide });
    disp.push(tex, pg, pm);
    const banner = new THREE.Mesh(pg, pm);
    banner.position.set(0, gy + 17, fz);
    group.add(banner);
    const wg = new THREE.PlaneGeometry(400, 200), wm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide });
    disp.push(wg, wm);
    const wall = new THREE.Mesh(wg, wm);
    wall.position.set(0, gy + 90, fz);
    group.add(wall);
  }

  function dropChunk(k) {
    const c = chunks.get(k);
    root.remove(c.group);
    c.disp.forEach(d => d.dispose?.());
    const kids = new Set(c.group.children);
    for (const key of ['rings', 'coins', 'birds', 'balloons']) live[key] = live[key].filter(x => !kids.has(x.mesh));
    live.updraftFx = live.updraftFx.filter(x => !kids.has(x));
    chunks.delete(k);
  }

  // keep chunks [k-BEHIND, k+AHEAD] around z; at most `budget` new chunks per call
  function update(z, budget = 1) {
    const k = Math.max(0, chunkIndex(z));
    for (const key of [...chunks.keys()]) if (key < k - BEHIND || key > k + AHEAD) dropChunk(key);
    for (let j = k - BEHIND; j <= k + AHEAD && budget > 0; j++) {
      if (!chunks.has(j)) { buildChunk(j); budget--; }
    }
  }
  update(0, 99);

  const sling = buildSlingshot(keep, slingTier);
  sling.group.position.set(0, level.launchH, 0);
  root.add(sling.group);
  scene.add(root);

  return {
    root, live, sling, update,
    dispose() {
      for (const k of [...chunks.keys()]) dropChunk(k);
      scene.remove(root);
      shared.forEach(d => d.dispose?.());
    },
  };
}

function tintedBalloon(hue, keep) {
  const m = place('balloon', 8);
  if (hue === 0) return m;
  m.traverse(o => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map(mt => {
      const hsl = {}; mt.color.getHSL(hsl);
      if (hsl.s < 0.15) return mt;
      const n = keep(mt.clone());
      n.color.setHSL((hsl.h + hue) % 1, Math.min(1, hsl.s * 1.4), hsl.l);
      return n;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
  return m;
}

function buildSlingshot(keep, tier) {
  const group = new THREE.Group();
  const woodCol = new THREE.Color(0x8a5a2b).lerp(new THREE.Color(tier >= 8 ? 0xffc83a : 0x9aa6b4), Math.min(1, tier / 7));
  const wood = keep(new THREE.MeshStandardMaterial({ color: woodCol, roughness: 0.8 - tier * 0.06, metalness: Math.min(0.8, tier * 0.1) }));
  const dark = keep(new THREE.MeshStandardMaterial({ color: tier >= 4 ? 0xd94a3a : 0x5b3a1a, roughness: 0.6, metalness: tier >= 4 ? 0.4 : 0 }));
  const band = keep(new THREE.MeshStandardMaterial({ color: tier >= 6 ? 0x3d8bff : tier >= 3 ? 0x4fc36a : 0x2b1a12, roughness: 0.6 }));
  const sc = 1 + tier * 0.05;
  const post = keep(new THREE.CylinderGeometry(0.28 * sc, 0.36 * sc, 3.2, 10));
  const arm = keep(new THREE.CylinderGeometry(0.22 * sc, 0.26 * sc, 2.6, 10));
  const base = new THREE.Mesh(post, wood); base.position.y = 1.6; group.add(base);
  const tips = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Mesh(arm, wood);
    a.position.set(s * 0.75, 3.9, 0); a.rotation.z = -s * 0.5; group.add(a);
    const cap = new THREE.Mesh(keep(new THREE.SphereGeometry(0.3 * sc, 10, 8)), dark);
    cap.position.set(s * 1.4, 5.05, 0); group.add(cap);
    tips.push(new THREE.Vector3(s * 1.4, 5.05, 0));
    if (tier >= 3) {
      const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(0.3 * sc, 0.06, 6, 16)), dark);
      ring.position.set(s * 1.05, 4.5, 0); ring.rotation.set(Math.PI / 2, 0, -s * 0.5); group.add(ring);
    }
  }
  if (tier >= 5) {
    const b = new THREE.Mesh(keep(new THREE.CylinderGeometry(1.2, 1.5, 0.6, 8)), keep(new THREE.MeshStandardMaterial({ color: 0x8c8f96, roughness: 0.9, flatShading: true })));
    b.position.y = 0.3; group.add(b);
  }
  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const tubeGeo = keep(new THREE.CylinderGeometry(0.09 + tier * 0.01, 0.09 + tier * 0.01, 1, 6));
  tubeGeo.translate(0, 0.5, 0);
  const tubes = [new THREE.Mesh(tubeGeo, band), new THREE.Mesh(tubeGeo, band)];
  tubes.forEach(t => group.add(t));
  const up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3();
  function setPouch(local) {
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

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

function checkerTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 32;
  const g = cv.getContext('2d');
  for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 16, y * 16, 16, 16); }
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(84, 3, 88, 26);
  g.fillStyle = '#ffcf33'; g.font = 'bold 22px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('FINISH', 128, 17);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
