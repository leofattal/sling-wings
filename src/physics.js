// Pure flight model + game data (no three.js, so scripts/sim.mjs can run it in Node).
//
// Point-mass glider with a flight-path angle (gamma), heading (psi) and bank:
//   dv/dt     = -g sin(gamma) - drag + thrust
//   dgamma/dt = (lift cos(bank) - g cos(gamma)) / v
//   dpsi/dt   =  lift sin(bank) / (v cos(gamma))
// Lift = kL v^2 * (pitch command), so the plane swoops: dive to gain speed, pull up to trade it
// for height, exactly like a paper plane. Forward is -Z, psi > 0 turns left.

export const G = 9.81;
export const TRIM = 13; // speed (m/s) where wings carry exactly 1 g

export const UPGRADES = [
  { id: 'sling', name: 'Slingshot', desc: 'Faster launch', icon: '🎯', costs: [40, 90, 180, 340, 600] },
  { id: 'wings', name: 'Wings', desc: 'Glide farther', icon: '🪽', costs: [50, 110, 220, 400, 700] },
  { id: 'booster', name: 'Fuel Tank', desc: 'Longer boost', icon: '⛽', costs: [45, 100, 200, 380, 650] },
  { id: 'engine', name: 'Rocket', desc: 'Stronger boost', icon: '🚀', costs: [60, 130, 260, 450, 800] },
  { id: 'handling', name: 'Ailerons', desc: 'Sharper steering', icon: '🕹️', costs: [30, 70, 140, 260, 450] },
  { id: 'magnet', name: 'Coin Magnet', desc: 'Bigger pickup', icon: '🧲', costs: [35, 80, 160, 300, 520] },
];
export const MAX_TIER = 5;

// Plane models (CC-BY, credited in the README). len = displayed length in metres.
export const PLANES = [
  { id: 'c172', name: 'Skipper', file: 'c172', cost: 0, len: 3.2, gr: 1, launch: 1, thrust: 1, handling: 1, coin: 1, blurb: 'Trusty trainer' },
  { id: 'mq9', name: 'Drifter', file: 'mq9', cost: 450, len: 3.0, gr: 1.25, launch: 1, thrust: 0.9, handling: 0.95, coin: 1, blurb: 'Long wings, glides forever' },
  { id: 'citation2', name: 'Courier', file: 'citation2', cost: 1200, len: 3.4, gr: 1.15, launch: 1.1, thrust: 1.25, handling: 1.1, coin: 1.1, blurb: 'Quick and nimble' },
  { id: 'jet', name: 'Falcon', file: 'jet', cost: 2600, len: 3.6, gr: 1.25, launch: 1.15, thrust: 1.45, handling: 1.2, coin: 1.25, blurb: 'Rocket-hungry speedster' },
  { id: 'b789', name: 'Jumbo', file: 'b789', cost: 5200, len: 4.6, gr: 1.5, launch: 1.1, thrust: 1.6, handling: 0.9, coin: 1.5, blurb: 'Huge wings, huge payday' },
];

export function makeStats(up, planeId) {
  const p = PLANES.find(q => q.id === planeId) || PLANES[0];
  return {
    launch: (17 + 4.5 * up.sling) * p.launch,
    gr: (4.6 + 1.5 * up.wings) * p.gr,
    fuel: [1.5, 3, 4.5, 6.5, 8.5, 11][up.booster],
    thrust: (6.5 + 2 * up.engine) * p.thrust,
    bank: Math.min(1.15, (0.6 + 0.09 * up.handling) * p.handling),
    roll: 2.4 + 0.5 * up.handling,
    pitchGain: 1.0 + 0.08 * up.handling,
    magnet: 1.8 + 1.3 * up.magnet,
    coinMul: p.coin,
  };
}

export function newFlight(x, y, z, speed, gamma, psi, fuel) {
  return { x, y, z, v: speed, gamma, psi, bank: 0, fuel, boosting: false, t: 0, dist: 0 };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// input: { pitch: -1..1 (+ = climb), steer: -1..1 (+ = right), boost: bool }
// env:   { wind: {x,z}, updraft(x, y, z) -> m/s^2 upward }
export function stepFlight(s, input, st, dt, env) {
  const kL = G / (TRIM * TRIM);
  const kD = G / (st.gr * TRIM * TRIM);
  const v = Math.max(s.v, 3);

  const bankT = -clamp(input.steer, -1, 1) * st.bank;
  s.bank += (bankT - s.bank) * Math.min(1, dt * st.roll);
  const cb = Math.cos(s.bank);

  // pitch command: 1 = level flight lift, partly auto-compensating for bank
  let cmd = (1 + 1.15 * clamp(input.pitch, -1, 1) * st.pitchGain) / (0.35 + 0.65 * cb);
  let lift = kL * v * v * cmd;
  lift = clamp(lift, -1.5 * G, 3.5 * G);
  const liftRatio = lift / Math.max(1e-3, kL * v * v);
  const drag = kD * v * v * (0.55 + 0.45 * liftRatio * liftRatio);

  let thrust = 0;
  s.boosting = false;
  if (input.boost && s.fuel > 0) { thrust = st.thrust; s.fuel = Math.max(0, s.fuel - dt); s.boosting = true; }

  const up = env.updraft ? env.updraft(s.x, s.y, s.z) : 0;
  const sg = Math.sin(s.gamma), cg = Math.cos(s.gamma);

  s.v = v + (-G * sg - drag + thrust + up * sg) * dt;
  s.gamma += ((lift * cb - G * cg + up * cg) / v) * dt;
  s.psi += ((lift * Math.sin(s.bank)) / (v * Math.max(0.3, cg))) * dt;
  s.v = clamp(s.v, 3, 95);
  s.gamma = clamp(s.gamma, -1.35, 1.25);

  const ncg = Math.cos(s.gamma);
  const dx = -Math.sin(s.psi) * ncg * s.v + (env.wind?.x || 0);
  const dz = -Math.cos(s.psi) * ncg * s.v + (env.wind?.z || 0);
  s.x += dx * dt; s.z += dz * dt;
  s.y += Math.sin(s.gamma) * s.v * dt;
  s.dist = Math.max(s.dist, -s.z);
  s.t += dt;
  return s;
}
