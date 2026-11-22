import * as THREE from 'three';
import { centred } from './assets.js';

// Upgrade parts bolted onto the plane, so it visibly evolves as you buy tiers.
// Plane space: nose toward -Z, Y up. `box` is the plane model's bounding box.
const RAMP = [0x9aa3ad, 0x4fc36a, 0x3d8bff, 0xa35cff, 0xffc83a]; // grey → green → blue → purple → gold
export const tierColor = t => RAMP[Math.min(4, Math.max(0, Math.floor((t - 1) / 2)))];
const WING_Y = { c172: 0.86, mq9: 0.5, citation2: 0.3, jet: 0.32, b789: 0.3, rocket: 0.5, ufo: 0.45 };
// high tiers glow, so a maxed part reads as special at a glance
const GLOW = { [RAMP[3]]: 0.35, [RAMP[4]]: 0.6 };

const mats = new Map();
function mat(color, metal = 0.3, emissive = 0) {
  emissive = emissive || GLOW[color] || 0;
  const key = color + ':' + metal + ':' + emissive;
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: 0.4, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive }));
  return mats.get(key);
}
const geoCache = new Map();
function geo(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }

function finGeo() {
  return geo('fin', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(1, 0); s.lineTo(0.75, 0.6); s.lineTo(0.15, 0.6); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false });
    g.translate(-0.5, 0, -0.03);
    return g;
  });
}

function flameMesh() {
  const g = geo('flame', () => { const c = new THREE.ConeGeometry(0.5, 2.2, 10, 1, true); c.rotateX(Math.PI / 2); c.translate(0, 0, 1.1); return c; });
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  const core = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  core.scale.set(0.45, 0.45, 0.6);
  m.add(core);
  m.visible = false;
  return m;
}

export function buildParts(formId, up, box) {
  const g = new THREE.Group();
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const span = size.x, len = size.z, h = size.y;
  const wingY = box.min.y + h * (WING_Y[formId] ?? 0.5);
  const bodyY = box.min.y + h * 0.4;
  const flames = [];
  const spinners = [];
  const t = k => up[k] || 0;

  // Wings: tip extensions grow with every tier, winglets from tier 5
  if (t('wings')) {
    const e = span * 0.04 * t('wings');
    const col = tierColor(t('wings'));
    for (const s of [-1, 1]) {
      const ext = new THREE.Mesh(geo('wingext', () => new THREE.BoxGeometry(1, 0.06, 1)), mat(col, 0.35));
      ext.scale.set(e, Math.max(0.5, h * 0.4), len * 0.13);
      ext.position.set(s * (span / 2 + e / 2 - span * 0.02), wingY, c.z + len * 0.04);
      g.add(ext);
      if (t('wings') >= 5) {
        const wl = new THREE.Mesh(finGeo(), mat(col, 0.4));
        wl.scale.set(len * 0.14, len * 0.1, 1);
        wl.rotation.y = Math.PI / 2;
        wl.position.set(s * (span / 2 + e - span * 0.02), wingY, c.z + len * 0.04);
        g.add(wl);
      }
    }
  }

  // Nose cone: longer and shinier
  if (t('nose')) {
    const l = len * (0.08 + 0.025 * t('nose'));
    const cone = new THREE.Mesh(geo('cone', () => { const k = new THREE.ConeGeometry(1, 1, 16); k.rotateX(-Math.PI / 2); return k; }), mat(t('nose') >= 7 ? 0xffd35a : 0xd9e1ea, 0.85));
    cone.scale.set(h * 0.16, h * 0.16, l);
    cone.position.set(0, bodyY + h * 0.05, box.min.z - l * 0.3);
    g.add(cone);
  }

  // Rocket engines (Rocketship model): 1 → 2 → 3, getting bigger
  if (t('engine')) {
    const n = t('engine') >= 7 ? 3 : t('engine') >= 4 ? 2 : 1;
    const sz = len * (0.17 + 0.012 * t('engine'));
    const spots = n === 1 ? [[0, box.min.y + h * 0.05]] : n === 2 ? [[-span * 0.11, wingY - h * 0.12], [span * 0.11, wingY - h * 0.12]] : [[-span * 0.13, wingY - h * 0.12], [span * 0.13, wingY - h * 0.12], [0, box.max.y - h * 0.05]];
    for (const [x, y] of spots) {
      const r = centred('p_rocket', sz);
      r.rotation.x = -Math.PI / 2; // model points +Y → point it forward (-Z)
      r.position.set(x, y, box.max.z - len * 0.25);
      g.add(r);
      const f = flameMesh();
      f.position.set(x, y, box.max.z - len * 0.25 + sz * 0.5);
      f.scale.setScalar(sz * 0.45);
      g.add(f);
      flames.push(f);
    }
  }

  // Fuel pods (Missile model) under the wings
  if (t('booster')) {
    const n = t('booster') >= 5 ? 4 : 2;
    const sz = len * (0.17 + 0.01 * t('booster'));
    const xs = n === 2 ? [0.26] : [0.2, 0.36];
    for (const s of [-1, 1]) for (const fx of xs) {
      const p = centred('p_pod', sz);
      p.rotation.x = -Math.PI / 2;
      p.position.set(s * span * fx, wingY - h * 0.16, c.z - len * 0.02);
      g.add(p);
    }
  }

  // Ailerons: tail fins, then canards up front
  if (t('handling')) {
    const col = tierColor(t('handling'));
    const fs = len * (0.14 + 0.012 * t('handling'));
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(finGeo(), mat(col, 0.3));
      fin.scale.set(fs, fs * 0.9, 1);
      fin.rotation.set(0, Math.PI / 2, s * 0.5);
      fin.position.set(s * span * 0.06, box.min.y + h * 0.55, box.max.z - fs * 0.5);
      g.add(fin);
      if (t('handling') >= 4) {
        const can = new THREE.Mesh(geo('wingext', () => new THREE.BoxGeometry(1, 0.06, 1)), mat(col, 0.3));
        can.scale.set(span * 0.1, 1, len * 0.06);
        can.position.set(s * span * 0.08, bodyY, box.min.z + len * 0.16);
        g.add(can);
      }
    }
  }

  // Landing gear: wheels (Kenney car kit), racing wheels from tier 5
  if (t('gear')) {
    const w = h * (0.22 + 0.02 * t('gear'));
    const model = t('gear') >= 5 ? 'p_wheel2' : 'p_wheel';
    const strutMat = mat(0x555c66, 0.6);
    const spots = [[0, box.min.z + len * 0.18], [-span * 0.09, c.z + len * 0.08], [span * 0.09, c.z + len * 0.08]];
    for (const [x, z] of spots) {
      const wh = centred(model, w);
      wh.position.set(x, box.min.y - w * 0.35, z);
      g.add(wh);
      spinners.push(wh);
      const strut = new THREE.Mesh(geo('strut', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 6)), strutMat);
      strut.scale.set(w * 0.12, w * 0.6, w * 0.12);
      strut.position.set(x, box.min.y - w * 0.05, z);
      g.add(strut);
    }
  }

  // Coin magnet on the roof
  if (t('magnet')) {
    const m = centred('p_magnet', len * (0.07 + 0.008 * t('magnet')));
    m.rotation.z = -Math.PI / 2; // U opens upward
    m.position.set(0, box.max.y + len * 0.04, c.z - len * 0.05);
    g.add(m);
    if (t('magnet') >= 5) {
      const halo = new THREE.Mesh(geo('halo', () => new THREE.TorusGeometry(1, 0.04, 6, 32)), mat(0x7fd9ff, 0, 0.8));
      halo.scale.setScalar(len * 0.1);
      halo.rotation.x = Math.PI / 2;
      halo.position.copy(m.position);
      g.add(halo);
      spinners.push(halo);
    }
  }

  // Lucky charm: golden star on the tail, plus a gem from tier 5
  if (t('luck')) {
    const s = centred('star', len * (0.07 + 0.008 * t('luck')));
    s.position.set(0, box.max.y + len * 0.03, box.max.z - len * 0.08);
    g.add(s);
    spinners.push(s);
    if (t('luck') >= 5) {
      const j = centred('jewel', len * 0.1);
      j.position.set(0, box.max.y + len * 0.14, box.max.z - len * 0.08);
      g.add(j);
      spinners.push(j);
    }
  }

  g.traverse(o => { if (o.isMesh && !o.material.transparent) o.castShadow = true; });
  return { group: g, flames, spinners };
}
