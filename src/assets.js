import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FORMS } from './physics.js';

// Planes: Sketchfab CC-BY 4.0 (see public/models/planes/README.md). Scenery: KayKit + Kenney (CC0).
const FILES = {
  coin: 'coin/coin-gold',
  d_cloud_big: 'kk/d_cloud_big', d_cloud_small: 'kk/d_cloud_small',
  d_hill_single_A: 'kk/d_hill_single_A', d_hills_A_trees: 'kk/d_hills_A_trees',
  d_mountain_A_grass_trees: 'kk/d_mountain_A_grass_trees', d_mountain_B_grass_trees: 'kk/d_mountain_B_grass_trees',
  windmill: 'kk/b_windmill_red', tower: 'kk/b_tower_A_red', flag: 'kk/p_flag_red',
  tree_default: 'nature/tree_default', tree_oak: 'nature/tree_oak', tree_fat: 'nature/tree_fat',
  tree_pineDefaultA: 'nature/tree_pineDefaultA', tree_pineRoundC: 'nature/tree_pineRoundC',
  rock_tallA: 'nature/rock_tallA', rock_largeA: 'nature/rock_largeA',
  // pickups & hazards (Poly Pizza: Poly by Google CC-BY 3.0, Quaternius CC0; Kenney CC0)
  balloon: 'items/balloon', seagull: 'items/seagull', gascan: 'items/gascan',
  jewel: 'coin/jewel', star: 'coin/star',
  // bolt-on plane parts
  p_rocket: 'parts/rocket2', p_pod: 'parts/rocket3', p_magnet: 'parts/magnet',
  p_wheel: 'parts/wheel-default', p_wheel2: 'parts/wheel-racing',
};
for (const p of FORMS) FILES['plane_' + p.id] = p.path || 'planes/' + p.file;

const store = {};
const bboxes = {};

export async function loadAll(onProgress) {
  const loader = new GLTFLoader();
  const names = Object.keys(FILES);
  let done = 0;
  await Promise.all(names.map(async n => {
    try {
      const g = await loader.loadAsync('/models/' + FILES[n] + '.glb');
      g.scene.traverse(o => {
        if (o.isMesh) {
          o.castShadow = !n.startsWith('d_cloud') && !n.startsWith('d_m') && !n.startsWith('d_h');
          o.receiveShadow = true;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => { if (m.map) m.map.anisotropy = 4; if ('metalness' in m) m.metalness = Math.min(m.metalness || 0, n.startsWith('plane') ? 0.35 : 0.1); });
        }
      });
      store[n] = g.scene;
      bboxes[n] = new THREE.Box3().setFromObject(g.scene);
    } catch (e) {
      console.warn('model failed', n, e);
      store[n] = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff00ff }));
      bboxes[n] = new THREE.Box3().setFromObject(store[n]);
    }
    done++; onProgress?.(done, names.length);
  }));
}

// Clone a model scaled so its height (or longest side with by:'len') equals `size`, feet on y=0.
export function place(name, size, by = 'height') {
  const src = store[name];
  const bb = bboxes[name];
  const dim = bb.getSize(new THREE.Vector3());
  const ref = by === 'height' ? dim.y : Math.max(dim.x, dim.z);
  const s = size / (ref || 1);
  const inner = src.clone(true);
  inner.scale.setScalar(s);
  const c = bb.getCenter(new THREE.Vector3());
  inner.position.set(-c.x * s, -bb.min.y * s, -c.z * s);
  const wrap = new THREE.Group();
  wrap.add(inner);
  return wrap;
}

// Plane: source models are Y-up with the nose toward -X; we turn them to face -Z and centre them.
export function planeModel(id) {
  const p = FORMS.find(q => q.id === id) || FORMS[0];
  const name = 'plane_' + p.id;
  const bb = bboxes[name];
  const dim = bb.getSize(new THREE.Vector3());
  const s = p.len / (p.orient ? Math.max(dim.x, dim.y, dim.z) : Math.max(dim.x, dim.z));
  const inner = store[name].clone(true);
  inner.scale.setScalar(s);
  // the saucer ships with a pure-black hull: repaint it silver and make its lights glow
  if (p.id === 'ufo') inner.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material.clone();
    if (m.name === 'base') { m.color.set(0xc9d3de); m.metalness = 0.55; m.roughness = 0.3; }
    else { m.emissive = m.color.clone(); m.emissiveIntensity = 0.9; }
    o.material = m;
  });
  const c = bb.getCenter(new THREE.Vector3());
  inner.position.set(-c.x * s, -c.y * s, -c.z * s);
  const turn = new THREE.Group();
  // planes model their nose along -X; the rocket stands nose-up (+Y); the saucer is round
  if (p.orient === 'up') turn.rotation.x = -Math.PI / 2;
  else if (p.orient !== 'flat') turn.rotation.y = -Math.PI / 2;
  turn.add(inner);
  const wrap = new THREE.Group();
  wrap.add(turn);
  wrap.updateMatrixWorld(true);
  wrap.userData.box = new THREE.Box3().setFromObject(wrap);
  return wrap;
}

// Clone a model normalised so its longest side = size, centred on the origin.
export function centred(name, size) {
  const bb = bboxes[name];
  const dim = bb.getSize(new THREE.Vector3());
  const s = size / Math.max(dim.x, dim.y, dim.z);
  const inner = store[name].clone(true);
  inner.scale.setScalar(s);
  const c = bb.getCenter(new THREE.Vector3());
  inner.position.set(-c.x * s, -c.y * s, -c.z * s);
  const wrap = new THREE.Group();
  wrap.add(inner);
  return wrap;
}
export const modelSize = name => bboxes[name].getSize(new THREE.Vector3());
