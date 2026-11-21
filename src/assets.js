import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PLANES } from './physics.js';

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
};
for (const p of PLANES) FILES['plane_' + p.id] = 'planes/' + p.file;

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
  const p = PLANES.find(q => q.id === id) || PLANES[0];
  const name = 'plane_' + p.id;
  const bb = bboxes[name];
  const dim = bb.getSize(new THREE.Vector3());
  const s = p.len / Math.max(dim.x, dim.z);
  const inner = store[name].clone(true);
  inner.scale.setScalar(s);
  const c = bb.getCenter(new THREE.Vector3());
  inner.position.set(-c.x * s, -c.y * s, -c.z * s);
  const turn = new THREE.Group();
  turn.rotation.y = -Math.PI / 2;
  turn.add(inner);
  const wrap = new THREE.Group();
  wrap.add(turn);
  return wrap;
}
