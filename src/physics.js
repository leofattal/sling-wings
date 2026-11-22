// Pure flight model + progression data (no three.js, so scripts/sim.mjs can run it in Node).
//
// Point-mass glider with a flight-path angle (gamma), heading (psi) and bank:
//   dv/dt     = -g sin(gamma) - drag + thrust
//   dgamma/dt = (lift cos(bank) - g cos(gamma)) / v
//   dpsi/dt   =  lift sin(bank) / (v cos(gamma))
// Lift = kL v^2 * (pitch command), so the plane swoops: dive to gain speed, pull up to trade it
// for height. Forward is -Z, psi > 0 turns left.

export const G = 9.81;
export const TRIM = 13; // speed (m/s) where wings carry exactly 1 g
export const MAX_TIER = 8;

const curve = base => [1, 2.2, 4.2, 7, 11, 16, 23, 32].map(m => Math.round((base * m) / 5) * 5);

export const UPGRADES = [
  { id: 'sling', name: 'Slingshot', desc: 'Launch harder', icon: '🎯', costs: curve(40), part: 'Bigger, tougher slingshot' },
  { id: 'wings', name: 'Wings', desc: 'Glide farther', icon: '🪽', costs: curve(55), part: 'Wing extensions & winglets' },
  { id: 'nose', name: 'Nose Cone', desc: 'Less drag at speed', icon: '🔺', costs: curve(45), part: 'Aero nose cone' },
  { id: 'booster', name: 'Fuel Tank', desc: 'Longer rocket burns', icon: '⛽', costs: curve(45), part: 'Under-wing fuel pods' },
  { id: 'engine', name: 'Rocket', desc: 'Stronger boost', icon: '🚀', costs: curve(60), part: 'Rocket engines (1 → 3)' },
  { id: 'handling', name: 'Ailerons', desc: 'Sharper steering', icon: '🕹️', costs: curve(30), part: 'Tail fins & canards' },
  { id: 'gear', name: 'Landing Gear', desc: 'Bounce off the ground', icon: '🛞', costs: curve(50), part: 'Wheels, then skids' },
  { id: 'magnet', name: 'Coin Magnet', desc: 'Bigger pickup radius', icon: '🧲', costs: curve(35), part: 'Roof magnet' },
  { id: 'luck', name: 'Lucky Charm', desc: 'Every coin worth more', icon: '🍀', costs: curve(70), part: 'Golden tail star' },
];
export const TOTAL_TIERS = UPGRADES.length * MAX_TIER;

// Evolution chain: each airframe needs enough upgrade tiers bought, plus coins.
// Plane models are CC-BY (credited in the README). len = displayed length in metres.
// Forms evolve by merging two of the previous form in the garage.
export const FORMS = [
  { id: 'c172', name: 'Skipper', file: 'c172', need: 0, cost: 0, len: 3.2, gr: 1, launch: 1, thrust: 1, handling: 1, coin: 1, blurb: 'A trusty little trainer.' },
  { id: 'mq9', name: 'Drifter', file: 'mq9', need: 8, cost: 500, len: 3.2, gr: 1.15, launch: 1.05, thrust: 1.05, handling: 1, coin: 1.1, blurb: 'Long drone wings that never want to land.' },
  { id: 'citation2', name: 'Courier', file: 'citation2', need: 20, cost: 1600, len: 3.5, gr: 1.25, launch: 1.1, thrust: 1.2, handling: 1.1, coin: 1.2, blurb: 'A business jet with real thrust.' },
  { id: 'jet', name: 'Falcon', file: 'jet', need: 36, cost: 4200, len: 3.7, gr: 1.35, launch: 1.17, thrust: 1.4, handling: 1.2, coin: 1.35, blurb: 'Sleek, fast and hungry for rockets.' },
  { id: 'b789', name: 'Jumbo', file: 'b789', need: 54, cost: 9500, len: 4.8, gr: 1.55, launch: 1.2, thrust: 1.6, handling: 0.95, coin: 1.6, blurb: 'Gigantic wings, gigantic payouts.' },
  { id: 'rocket', name: 'Comet', path: 'parts/rocket2', orient: 'up', need: 0, cost: 0, len: 3.8, gr: 1.6, launch: 1.32, thrust: 2.0, handling: 1.2, coin: 2.0, blurb: 'Less plane, more rocket. Burns bright, flies far.' },
  { id: 'ufo', name: 'Orbiter', path: 'planes/ufo', orient: 'flat', need: 0, cost: 0, len: 4.4, gr: 1.85, launch: 1.4, thrust: 2.3, handling: 1.45, coin: 2.6, blurb: 'The final form. Nobody knows how it flies.' },
];

export function makeStats(up, formId) {
  const f = FORMS.find(q => q.id === formId) || FORMS[0];
  const t = k => up[k] || 0;
  return {
    launch: (17 + 3.1 * t('sling')) * f.launch,
    gr: (4.6 + 1.05 * t('wings')) * f.gr,
    paras: 1 - 0.055 * t('nose'),
    fuel: 1.5 + 1.35 * t('booster'),
    thrust: (6.5 + 1.35 * t('engine')) * f.thrust,
    bank: Math.min(1.15, (0.6 + 0.06 * t('handling')) * f.handling),
    roll: 2.4 + 0.35 * t('handling'),
    pitchGain: 1.0 + 0.05 * t('handling'),
    bounces: Math.ceil(t('gear') / 2),
    gearTier: t('gear'),
    magnet: 1.8 + 0.85 * t('magnet'),
    coinMul: f.coin * (1 + 0.08 * t('luck')),
  };
}

export function newFlight(x, y, z, speed, gamma, psi, fuel, bounces = 0) {
  return { x, y, z, v: speed, gamma, psi, bank: 0, fuel, boosting: false, t: 0, dist: 0, bounces, maxV: speed, maxAlt: 0 };
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

  const cmd = (1 + 1.15 * clamp(input.pitch, -1, 1) * st.pitchGain) / (0.35 + 0.65 * cb);
  const lift = clamp(kL * v * v * cmd, -1.5 * G, 3.5 * G);
  const liftRatio = lift / Math.max(1e-3, kL * v * v);
  // parasitic drag grows with v^2 (nose cone cuts it), induced drag with how hard you pull
  const drag = kD * v * v * (0.55 * st.paras + 0.45 * liftRatio * liftRatio);

  let thrust = 0;
  s.boosting = false;
  if (input.boost && s.fuel > 0) { thrust = st.thrust; s.fuel = Math.max(0, s.fuel - dt); s.boosting = true; }

  const up = env.updraft ? env.updraft(s.x, s.y, s.z) : 0;
  const sg = Math.sin(s.gamma), cg = Math.cos(s.gamma);

  s.v = v + (-G * sg - drag + thrust + up * sg) * dt;
  s.gamma += ((lift * cb - G * cg + up * cg) / v) * dt;
  s.psi += ((lift * Math.sin(s.bank)) / (v * Math.max(0.3, cg))) * dt;
  s.v = clamp(s.v, 3, 110);
  s.gamma = clamp(s.gamma, -1.35, 1.25);
  s.psi = clamp(s.psi, -1.4, 1.4); // never fly back toward the slingshot

  const ncg = Math.cos(s.gamma);
  s.x += (-Math.sin(s.psi) * ncg * s.v + (env.wind?.x || 0)) * dt;
  s.z += (-Math.cos(s.psi) * ncg * s.v + (env.wind?.z || 0)) * dt;
  s.y += Math.sin(s.gamma) * s.v * dt;
  s.dist = Math.max(s.dist, -s.z);
  s.maxV = Math.max(s.maxV, s.v);
  s.t += dt;
  return s;
}

// Ground contact: bounce on landing gear if the angle is shallow enough, else end the flight.
// Returns 'bounce' | 'perfect' | 'landed' | 'crash'.
export function touchdown(s, st) {
  const steep = s.gamma < -0.6;
  if (s.bounces > 0 && !steep && s.v > 9) {
    s.bounces--;
    s.gamma = 0.22 + 0.03 * st.gearTier;
    s.v *= 0.8 + 0.015 * st.gearTier;
    return 'bounce';
  }
  if (s.gamma > -0.22 && s.v < 24 + st.gearTier * 1.5) return 'perfect';
  if (s.gamma > -0.45 && s.v < 34) return 'landed';
  return 'crash';
}
