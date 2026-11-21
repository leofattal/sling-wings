// Autopilot balance check: how far does a decent pilot get on each level per upgrade tier?
import { makeStats, newFlight, stepFlight, touchdown, TRIM, UPGRADES } from '../src/physics.js';
import { makeLevel, updraftAt, LEVEL_COUNT, chunkIndex } from '../src/levels.js';

function fly(n, up, form) {
  const lv = makeLevel(n), st = makeStats(up, form);
  const s = newFlight(0, lv.launchH + 5, 0.6, st.launch, 0.3, 0, st.fuel, st.bounces);
  const env = { wind: lv.wind, updraft: (x, y, z) => updraftAt(lv, x, y, z) };
  const dt = 1 / 120;
  while (s.t < 400) {
    const g = lv.ground(s.x, s.z);
    const k = chunkIndex(s.z);
    let tx = 0;
    for (let j = k; j <= k + 1; j++) { const r = lv.ridgeOf(j); if (r && r.z < s.z) { tx = r.notchX; break; } }
    const inUp = updraftAt(lv, s.x, s.y, s.z) > 0;
    if (!tx && s.y - g < 18) { const ud = lv.chunk(k + 1).updrafts[0] || lv.chunk(k).updrafts.find(u => u.z < s.z - 5); if (ud) tx = ud.x; }
    const desiredPsi = Math.atan2(-(tx - s.x), 40);
    const steer = Math.max(-1, Math.min(1, -(desiredPsi - s.psi) * 3));
    let pitch = (s.v - TRIM * 1.1) * 0.12 - s.gamma * 0.6 + (inUp ? 0.3 : 0);
    if (s.y - g < 6) pitch += 0.4;
    stepFlight(s, { pitch: Math.max(-1, Math.min(1, pitch)), steer, boost: s.v < TRIM * 1.35 }, st, dt, env);
    if (s.y < lv.ground(s.x, s.z) + 0.5) { s.y = lv.ground(s.x, s.z) + 0.6; if (touchdown(s, st) !== 'bounce') break; }
  }
  return -s.z >= lv.length ? 'WIN' : Math.round(-s.z);
}
const tier = k => Object.fromEntries(UPGRADES.map(u => [u.id, k]));
const rows = [];
for (let n = 0; n < LEVEL_COUNT; n++) {
  const r = { lvl: n + 1, len: makeLevel(n).length };
  for (const k of [0, 1, 2, 3, 4, 5, 6, 8]) r['t' + k] = fly(n, tier(k), 'c172');
  r['t4 courier'] = fly(n, tier(4), 'citation2');
  r['t6 falcon'] = fly(n, tier(6), 'jet');
  r['t8 jumbo'] = fly(n, tier(8), 'b789');
  rows.push(r);
}
console.table(rows);
