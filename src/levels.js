// 15 levels + Endless. Each valley is infinite and generated in deterministic 120 m chunks, so a
// flight can sail past the finish line and keep earning. Pure data (shared with the Node sim).

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
  meadow: { name: 'Sunny Meadows', sky: 0x8fd3ff, horizon: 0xe8f6ff, fog: 0xcfeaff, grass: [0x7cc95a, 0x5fae47], rock: 0x9c8f7e, snow: 0xffffff, sun: 0xfff1d6, trees: ['tree_oak', 'tree_default', 'tree_fat'], hills: ['d_hills_A_trees', 'd_hill_single_A'] },
  highland: { name: 'Pine Highlands', sky: 0x7fb6e8, horizon: 0xffd9c2, fog: 0xd9e2f0, grass: [0x5f9f5a, 0x47804a], rock: 0x8a8580, snow: 0xf4f7ff, sun: 0xffe2c0, trees: ['tree_pineDefaultA', 'tree_pineRoundC', 'tree_default'], hills: ['d_mountain_A_grass_trees', 'd_mountain_B_grass_trees'] },
  dusk: { name: 'Dusk Canyons', sky: 0x3a3f7a, horizon: 0xff9a62, fog: 0xc88a7a, grass: [0xc9935b, 0xa86d43], rock: 0x8c5a48, snow: 0xffe6d0, sun: 0xffb27a, trees: ['tree_pineRoundC', 'tree_fat', 'rock_tallA'], hills: ['d_mountain_A_grass_trees', 'd_mountain_B_grass_trees'] },
};

export const CHUNK = 120;
const LENGTHS = [150, 260, 380, 520, 680, 860, 1050, 1260, 1500, 1760, 2050, 2380, 2750, 3200, 3800];
export const LEVEL_COUNT = LENGTHS.length;
export const ENDLESS = LEVEL_COUNT; // level index 15
export const ENDLESS_UNLOCK = 5; // levels cleared needed
export const LEVEL_NAMES = [
  'First Flight', 'Over the Hedge', 'Ring Runner', 'Windmill Lane', 'Balloon Festival',
  'Pine Pass', 'The Notch', 'Crosswind Ridge', 'Lift Off', 'Twin Peaks',
  'Ember Gulch', 'Tower Slalom', 'Gauntlet', 'Storm Front', 'The Long Haul', 'Endless Valley',
];
export const LEVEL_TIPS = [
  'Drag back from the plane and let go!',
  'Dive to gain speed, pull up to trade it for height.',
  'Fly through rings for a speed burst + fuel.',
  'Windmills ahead: steer around them. Close calls pay!',
  'Hit hot-air balloons to bounce up into the sky.',
  'Glowing columns are updrafts. Ride them up!',
  'A ridge blocks the valley. Find the notch!',
  'Crosswind! It pushes you sideways.',
  'Gems float up high. Climb for them.',
  'Lots of ridges. Keep your height.',
  'Dusk canyons: rock pillars everywhere.',
  'Towers! Weave between them.',
  'Seagulls slow you down. Dodge the flocks!',
  'Headwind and crosswind. Good luck.',
  'The longest valley. Make every metre count.',
  'No finish line. How far can you go?',
];

// difficulty settings for an effective level number (0..14)
function settings(n) {
  return {
    hillAmp: 2 + n * 0.8,
    ridgeChance: n < 6 ? 0 : 0.16 + (n - 6) * 0.035,
    ridgeH: 10 + n * 1.1,
    notchW: 13 - n * 0.25,
    obstaclesPerChunk: n === 0 ? 0.4 : 1.2 + n * 0.32,
    kinds: n < 3 ? ['tree'] : n < 6 ? ['tree', 'tree', 'windmill'] : n < 10 ? ['tree', 'tree', 'pillar', 'windmill'] : ['pillar', 'tower', 'tree', 'pillar'],
    updraftChance: n < 3 ? 0.12 : 0.3 + n * 0.02,
    rings: n < 2 ? 0.6 : 0.8 + n * 0.05,
    coinGroups: 2.2,
    balloons: n < 2 ? 0.15 : n === 4 ? 1.6 : 0.35,
    birds: n < 6 ? 0 : n === 12 ? 1 : 0.25 + (n - 6) * 0.05,
    gems: n < 3 ? 0.15 : 0.35,
    fuel: n < 2 ? 0.1 : 0.3,
    stars: 0.12,
  };
}

export function makeLevel(n) {
  const endless = n === ENDLESS;
  const L = endless ? Infinity : LENGTHS[n];
  const biome = endless ? 'highland' : n < 5 ? 'meadow' : n < 10 ? 'highland' : 'dusk';
  const R0 = rng(1000 + n * 7919);
  const launchH = endless ? 30 : 12 + 2 * n;
  const W = endless ? 30 : 38 - Math.min(10, n);
  const ph = [R0() * 6.28, R0() * 6.28, R0() * 6.28];
  const windSign = R0() < 0.5 ? -1 : 1;
  const wind = endless ? { x: windSign * 1.2, z: 0 } : n >= 7 ? { x: windSign * (1 + (n - 7) * 0.35), z: n >= 13 ? 1.5 : 0 } : { x: 0, z: 0 };
  const nAt = k => (endless ? Math.min(14, 3 + (k * CHUNK) / 450) : n);
  const S = k => settings(Math.floor(nAt(Math.max(0, k))));
  const B = BIOMES[biome];

  // ridges are decided first per chunk, independent of other content (ground() needs them)
  const ridgeCache = new Map();
  const ridgeOf = k => {
    if (k < 2) return null;
    if (ridgeCache.has(k)) return ridgeCache.get(k);
    const R = rng(5000 + n * 104729 + k * 131);
    const s = S(k);
    let r = null;
    if (R() < s.ridgeChance) r = { z: -(k + 0.5) * CHUNK, h: s.ridgeH + R() * 6, notchX: (R() - 0.5) * W, notchW: s.notchW, width: 16 };
    ridgeCache.set(k, r);
    return r;
  };

  const ground = (x, z) => {
    const hillAmp = S(Math.floor(-z / CHUNK)).hillAmp;
    let h = hillAmp * (0.6 + 0.4 * Math.sin(z * 0.031 + ph[0]) * Math.sin(x * 0.045 + ph[1]) + 0.35 * Math.sin(z * 0.013 + x * 0.02 + ph[2]));
    const ax = Math.abs(x);
    if (ax > W) { const t = (ax - W) / 24; h += 42 * (1 - Math.exp(-t * t)); }
    const k = Math.floor(-z / CHUNK);
    for (let j = k - 1; j <= k + 1; j++) {
      const r = ridgeOf(j);
      if (!r) continue;
      const dz = (z - r.z) / r.width;
      if (dz * dz > 9) continue;
      const nx = (x - r.notchX) / r.notchW;
      h += r.h * Math.exp(-dz * dz * 2.2) * (1 - 0.95 * Math.exp(-nx * nx * 2.5));
    }
    const t = Math.min(1, Math.max(0, (z + 14) / 8));
    const s = t * t * (3 - 2 * t);
    return h * (1 - s) + launchH * s;
  };

  const chunkCache = new Map();
  const chunk = k => {
    if (chunkCache.has(k)) return chunkCache.get(k);
    const R = rng(9000 + n * 15485863 + (k + 5) * 7727);
    const s = S(k);
    const z0 = -k * CHUNK, z1 = -(k + 1) * CHUNK;
    const zr = () => z0 + (z1 - z0) * R();
    const xr = f => (R() - 0.5) * W * f;
    const c = { k, coins: [], rings: [], obstacles: [], updrafts: [], decor: [], balloons: [], birds: [], gems: [], fuels: [], stars: [], ridge: ridgeOf(k) };
    const count = rate => Math.floor(rate) + (R() < rate % 1 ? 1 : 0);
    const ok = z => z < -26;

    for (let z = z0; z > z1; z -= 22 + R() * 20) {
      for (const side of [-1, 1]) {
        c.decor.push({ model: B.hills[Math.floor(R() * B.hills.length)], x: side * (W + 30 + R() * 50), z, h: 40 + R() * 30, by: 'len', rot: R() * 6.28 });
        if (R() < 0.8) c.decor.push({ model: B.trees[Math.floor(R() * B.trees.length)], x: side * (W - 2 + R() * 18), z: z - R() * 10, h: 6 + R() * 5, rot: R() * 6.28 });
      }
    }
    for (let i = 0; i < 4; i++) c.decor.push({ model: R() < 0.5 ? 'd_cloud_big' : 'd_cloud_small', x: (R() - 0.5) * 260, z: zr(), y: launchH + 25 + R() * 45, h: 6 + R() * 8, rot: R() * 6.28, cloud: true });
    if (k < 0) { chunkCache.set(k, c); return c; }

    for (let i = 0, m = count(s.updraftChance); i < m && k >= 1; i++) {
      const z = zr(), x = xr(1.1);
      c.updrafts.push({ x, z, r: 7, power: 15 + nAt(k) * 0.4, top: ground(x, z) + 55 });
    }
    for (let i = 0, m = count(s.obstaclesPerChunk); i < m; i++) {
      const z = zr(), x = xr(1.7);
      const kind = s.kinds[Math.floor(R() * s.kinds.length)];
      const rot = R() * 6.28;
      if (!ok(z) || c.updrafts.some(u => Math.hypot(u.x - x, u.z - z) < u.r + 6)) continue;
      const spec = { tree: [1.4, 9], windmill: [2.6, 13], pillar: [2.4, 16 + nAt(k)], tower: [3, 20 + nAt(k)] }[kind];
      c.obstacles.push({ kind, x, z, r: spec[0], h: spec[1], rot, near: false });
    }
    for (let i = 0, m = count(s.rings); i < m; i++) {
      const z = zr(), x = xr(0.9), y = 6 + R() * 14;
      if (ok(z)) c.rings.push({ x, y: ground(x, z) + y, z, r: 3.4 });
    }
    for (let g = 0, m = count(s.coinGroups); g < m; g++) {
      const z0g = zr(), x0 = xr(1.2), shape = R(), len = 6 + Math.floor(R() * 5);
      const base = ground(x0, z0g) + 3 + R() * 14;
      for (let i = 0; i < len; i++) {
        const z = z0g - i * 3.2;
        if (!ok(z)) continue;
        const x = shape < 0.4 ? x0 : x0 + Math.sin(i * 0.8) * 4;
        const y = shape > 0.7 ? base + Math.sin((i / (len - 1)) * Math.PI) * 5 : base;
        c.coins.push({ x, y: Math.max(y, ground(x, z) + 2.5), z });
      }
    }
    const scatter = (rate, list, lo, span, extra = () => ({})) => {
      for (let i = 0, m = count(rate); i < m; i++) {
        const z = zr(), x = xr(1.1), y = lo + R() * span, e = extra();
        if (ok(z)) list.push({ x, y: ground(x, z) + y, z, ...e });
      }
    };
    scatter(s.balloons, c.balloons, 6, 12, () => ({ r: 3.2, variant: R() < 0.5 ? 0 : 1, bob: R() * 6.28 }));
    scatter(s.birds, c.birds, 8, 16, () => ({ amp: 8 + R() * 10, ph: R() * 6.28, speed: 0.5 + R() * 0.5, n: 3 + Math.floor(R() * 4), hit: false }));
    scatter(s.gems, c.gems, 24, 18);
    scatter(s.fuel, c.fuels, 4, 10);
    scatter(s.stars, c.stars, 10, 20);
    chunkCache.set(k, c);
    return c;
  };

  return { n, endless, name: LEVEL_NAMES[n], length: L, biome, launchH, W, ground, wind, chunk, ridgeOf };
}

export const chunkIndex = z => Math.floor(-z / CHUNK);

export function updraftAt(level, x, y, z) {
  let a = 0;
  const k = chunkIndex(z);
  for (let j = Math.max(0, k - 1); j <= k + 1; j++) {
    for (const u of level.chunk(j).updrafts) {
      const d = Math.hypot(x - u.x, z - u.z);
      if (d < u.r && y < u.top) a += u.power * (1 - d / u.r) * Math.min(1, (u.top - y) / 10);
    }
  }
  return a;
}

export function levelLength(n) { return n === ENDLESS ? Infinity : LENGTHS[n]; }
