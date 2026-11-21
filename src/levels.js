// 15 handcrafted-by-seed levels. Pure data + terrain height function (shared with the Node sim).

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BIOMES = {
  meadow: { name: 'Sunny Meadows', sky: 0x8fd3ff, horizon: 0xe8f6ff, fog: 0xcfeaff, grass: [0x7cc95a, 0x5fae47], rock: 0x9c8f7e, snow: 0xffffff, sun: 0xfff1d6, trees: ['tree_oak', 'tree_default', 'tree_fat'] },
  highland: { name: 'Pine Highlands', sky: 0x7fb6e8, horizon: 0xffd9c2, fog: 0xd9e2f0, grass: [0x5f9f5a, 0x47804a], rock: 0x8a8580, snow: 0xf4f7ff, sun: 0xffe2c0, trees: ['tree_pineDefaultA', 'tree_pineRoundC', 'tree_default'] },
  dusk: { name: 'Dusk Canyons', sky: 0x3a3f7a, horizon: 0xff9a62, fog: 0xc88a7a, grass: [0xc9935b, 0xa86d43], rock: 0x8c5a48, snow: 0xffe6d0, sun: 0xffb27a, trees: ['tree_pineRoundC', 'tree_fat', 'rock_tallA'] },
};

const LENGTHS = [90, 150, 220, 300, 400, 520, 650, 800, 960, 1130, 1320, 1520, 1740, 1980, 2250];
export const LEVEL_COUNT = LENGTHS.length;
export const LEVEL_NAMES = [
  'First Flight', 'Over the Hedge', 'Ring Runner', 'Windmill Lane', 'Thermal Valley',
  'Pine Pass', 'The Notch', 'Crosswind Ridge', 'Lift Off', 'Twin Peaks',
  'Ember Gulch', 'Tower Slalom', 'Gauntlet', 'Storm Front', 'The Long Haul',
];

export function makeLevel(n) {
  const R = rng(1000 + n * 7919);
  const L = LENGTHS[n];
  const biome = n < 5 ? 'meadow' : n < 10 ? 'highland' : 'dusk';
  const launchH = 12 + 2 * n;
  const W = 38 - Math.min(10, n); // half-width of the open valley
  const hillAmp = 2 + n * 0.8;
  const ph = [R() * 6.28, R() * 6.28, R() * 6.28];

  // ridges across the valley with a notch to fly through (from level 7)
  const ridges = [];
  if (n >= 6) {
    const count = n >= 12 ? 3 : n >= 9 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const z = -L * (0.3 + 0.55 * ((i + 0.5) / count)) + (R() - 0.5) * 30;
      ridges.push({ z, h: 10 + n * 1.1 + R() * 6, notchX: (R() - 0.5) * W, notchW: 13 - n * 0.25, width: 16 });
    }
  }

  const ground = (x, z) => {
    let h = hillAmp * (0.6 + 0.4 * Math.sin(z * 0.031 + ph[0]) * Math.sin(x * 0.045 + ph[1]) + 0.35 * Math.sin(z * 0.013 + x * 0.02 + ph[2]));
    // gentle runway near the cliff foot so early levels are forgiving
    const ax = Math.abs(x);
    if (ax > W) { const t = (ax - W) / 24; h += 42 * (1 - Math.exp(-t * t)); }
    for (const r of ridges) {
      const dz = (z - r.z) / r.width;
      const bump = Math.exp(-dz * dz * 2.2);
      const nx = (x - r.notchX) / r.notchW;
      const notch = Math.exp(-nx * nx * 2.5);
      h += r.h * bump * (1 - 0.95 * notch);
    }
    // launch cliff (plateau behind z = -6)
    const t = Math.min(1, Math.max(0, (z + 14) / 8));
    const s = t * t * (3 - 2 * t);
    h = h * (1 - s) + launchH * s;
    return h;
  };

  const wind = n >= 7 ? { x: (R() < 0.5 ? -1 : 1) * (1 + (n - 7) * 0.35), z: n >= 13 ? 1.5 : 0 } : { x: 0, z: 0 };

  // updraft columns
  const updrafts = [];
  if (n >= 4) {
    const k = 2 + Math.floor(n / 3);
    for (let i = 0; i < k; i++) {
      const z = -L * (0.15 + 0.75 * (i + R() * 0.6) / k);
      const x = (R() - 0.5) * W * 1.1;
      updrafts.push({ x, z, r: 7, power: 15 + n * 0.4, top: ground(x, z) + 55 });
    }
  }

  // collidable obstacles inside the valley
  const obstacles = [];
  const nObs = n === 0 ? 0 : Math.floor(L / (60 - n * 2.4));
  const kinds = n < 3 ? ['tree'] : n < 6 ? ['tree', 'tree', 'windmill'] : n < 10 ? ['tree', 'tree', 'pillar', 'windmill'] : ['pillar', 'tower', 'tree', 'pillar'];
  for (let i = 0; i < nObs; i++) {
    const z = -30 - R() * (L - 40);
    const x = (R() - 0.5) * W * 1.7;
    const kind = kinds[Math.floor(R() * kinds.length)];
    const spec = { tree: [1.4, 9], windmill: [2.6, 13], pillar: [2.4, 16 + n], tower: [3, 20 + n] }[kind];
    if (updrafts.some(u => Math.hypot(u.x - x, u.z - z) < u.r + 6)) continue;
    obstacles.push({ kind, x, z, r: spec[0], h: spec[1], rot: R() * 6.28 });
  }

  // rings: flying through gives a speed burst; laid along a gentle descending line
  const rings = [];
  const nRings = n < 2 ? 2 : 3 + Math.floor(n / 2);
  for (let i = 0; i < nRings; i++) {
    const z = -L * (0.12 + 0.8 * (i + 0.5) / nRings);
    const x = (R() - 0.5) * W * 0.9;
    const frac = -z / L;
    const y = Math.max(ground(x, z) + 6, launchH * (1 - frac) * 0.9 + 6 + R() * 8);
    rings.push({ x, y, z, r: 3.4 });
  }

  // coin trails
  const coins = [];
  const groups = Math.floor(L / 45) + 2;
  for (let g = 0; g < groups; g++) {
    const z0 = -20 - R() * (L - 20);
    const x0 = (R() - 0.5) * W * 1.2;
    const shape = R();
    const count = 5 + Math.floor(R() * 4);
    const base = Math.max(ground(x0, z0) + 4, launchH * (1 + z0 / L) * 0.8 + 3 + R() * 10);
    for (let i = 0; i < count; i++) {
      const z = z0 - i * 3.2;
      const x = shape < 0.4 ? x0 : x0 + Math.sin(i * 0.8) * 4;
      const y = shape > 0.7 ? base + Math.sin((i / (count - 1)) * Math.PI) * 5 : base;
      if (z > -12) continue;
      coins.push({ x, y: Math.max(y, ground(x, z) + 2.5), z });
    }
  }

  // decoration (non-colliding): flank mountains, side trees, clouds
  const decor = [];
  const B = BIOMES[biome];
  for (let z = 10; z > -L - 260; z -= 22 + R() * 20) {
    for (const side of [-1, 1]) {
      const x = side * (W + 30 + R() * 50);
      decor.push({ model: biome === 'meadow' ? (R() < 0.5 ? 'd_hills_A_trees' : 'd_hill_single_A') : R() < 0.5 ? 'd_mountain_A_grass_trees' : 'd_mountain_B_grass_trees', x, z, h: 40 + R() * 30, by: 'len', rot: R() * 6.28 });
      if (R() < 0.8) {
        const tx = side * (W - 2 + R() * 18);
        decor.push({ model: B.trees[Math.floor(R() * B.trees.length)], x: tx, z: z + R() * 10, h: 6 + R() * 5, rot: R() * 6.28 });
      }
    }
  }
  for (let i = 0; i < L / 30 + 8; i++) {
    decor.push({ model: R() < 0.5 ? 'd_cloud_big' : 'd_cloud_small', x: (R() - 0.5) * 260, z: -R() * (L + 200), y: launchH + 25 + R() * 45, h: 6 + R() * 8, rot: R() * 6.28, cloud: true });
  }

  return { n, name: LEVEL_NAMES[n], length: L, biome, launchH, W, ground, ridges, wind, updrafts, obstacles, rings, coins, decor };
}

export function updraftAt(level, x, y, z) {
  let a = 0;
  for (const u of level.updrafts) {
    const d = Math.hypot(x - u.x, z - u.z);
    if (d < u.r && y < u.top) a += u.power * (1 - d / u.r) * Math.min(1, (u.top - y) / 10);
  }
  return a;
}
