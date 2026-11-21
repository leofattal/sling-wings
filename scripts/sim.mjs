// Autopilot balance check: how far does a decent pilot get on each level per upgrade tier?
import { makeStats, newFlight, stepFlight, TRIM } from '../src/physics.js';
import { makeLevel, updraftAt, LEVEL_COUNT } from '../src/levels.js';

function fly(n, up, plane) {
  const lv = makeLevel(n), st = makeStats(up, plane);
  const s = newFlight(0, lv.launchH + 2.2, -4, st.launch, 0.3, 0, st.fuel);
  const env = { wind: lv.wind, updraft: (x, y, z) => updraftAt(lv, x, y, z) };
  const dt = 1 / 120;
  let hits = 0;
  while (s.t < 240) {
    const g = lv.ground(s.x, s.z);
    // steering target: notch of the next ridge, else a nearby updraft when low, else centre
    let tx = 0;
    const ridge = lv.ridges.find(r => r.z < s.z + 5 && r.z > s.z - 160);
    const lowAlt = s.y - g < 18;
    const ud = lv.updrafts.find(u => u.z < s.z - 5 && u.z > s.z - 90);
    if (ridge) tx = ridge.notchX; else if (lowAlt && ud) tx = ud.x;
    const inUp = updraftAt(lv, s.x, s.y, s.z) > 0;
    const desiredPsi = Math.atan2(-(tx - s.x), 40);
    const steer = Math.max(-1, Math.min(1, -(desiredPsi - s.psi) * 3));
    let pitch = (s.v - TRIM * 1.1) * 0.12 - s.gamma * 0.6 + (inUp ? 0.3 : 0);
    if (s.y - g < 6) pitch += 0.4;
    const boost = s.v < TRIM * 1.35;
    stepFlight(s, { pitch: Math.max(-1, Math.min(1, pitch)), steer, boost }, st, dt, env);
    for (const o of lv.obstacles) if (Math.hypot(o.x - s.x, o.z - s.z) < o.r && s.y < lv.ground(o.x, o.z) + o.h) { hits++; break; }
    if (s.y < lv.ground(s.x, s.z) + 0.5) break;
    if (-s.z > lv.length) return { win: true, d: lv.length, t: s.t };
  }
  return { win: false, d: Math.round(-s.z), t: s.t };
}
const tier = k => ({ sling: k, wings: k, booster: k, engine: k, handling: k, magnet: k });
const rows = [];
for (let n = 0; n < LEVEL_COUNT; n++) {
  const r = { lvl: n + 1, len: makeLevel(n).length };
  for (const k of [0, 1, 2, 3, 4, 5]) { const f = fly(n, tier(k), 'c172'); r['t' + k] = f.win ? 'WIN' : f.d; }
  for (const p of ['mq9', 'jet', 'b789']) { const f = fly(n, tier(5), p); r[p] = f.win ? 'WIN' : f.d; }
  rows.push(r);
}
console.table(rows);
