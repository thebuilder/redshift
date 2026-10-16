// Headless validator: builds every level, flies it with the autopilot and
// reports landing quality. Run: npm run sim
import { LEVELS } from '../src/levels/levels';
import { buildLevel } from '../src/levels/LevelBuilder';
import { CarSim, emptyInput } from '../src/physics/CarSim';
import { Autopilot } from '../src/game/Autopilot';
import { hillHeight } from '../src/physics/Terrain';

const only = process.argv[2] ? Number(process.argv[2]) : 0;
const throttles = (process.argv[3] ?? '1').split(',').map(Number);

for (const def of LEVELS) {
  if (only && def.id !== only) continue;
  let lv;
  try { lv = buildLevel(def); } catch (e) { console.log(`\n#${def.id} ${def.name} BUILD FAILED: ${(e as Error).message}`); continue; }
  const h = lv.hill;
  let overlap = 0;
  for (let i = 0; i < lv.track.pos.length; i += 4) {
    const p = lv.track.pos[i];
    if (p.y < 1.0 && hillHeight(h, p.x, p.z) > 0) overlap++;
    for (const side of [-5.5, 5.5]) {
      const q = p.clone().addScaledVector(lv.track.R[i], side);
      if (q.y < 1.0 && hillHeight(h, q.x, q.z) > 0) overlap++;
    }
  }
  let maxH = 0; for (const v of h.h) maxH = Math.max(maxH, v);
  console.log(`\n#${def.id} ${def.name}  len=${lv.track.length.toFixed(0)}m exit=${(lv.maxExitSpeed * 3.6).toFixed(0)}km/h at (${lv.exitPos.x.toFixed(0)},${lv.exitPos.y.toFixed(0)},${lv.exitPos.z.toFixed(0)}) hill u0=${h.u0.toFixed(0)} len=${(h.h.length * h.du).toFixed(0)} maxH=${maxH.toFixed(1)} target=${h.targetU.toFixed(0)} overlap=${overlap}`);
  for (const thr of throttles) {
    const sim = new CarSim(lv.track, lv.terrain, lv.startS);
    const ap = new Autopilot();
    ap.throttle = thr;
    const inp = emptyInput();
    const dt = 1 / 240;
    let minN = Infinity, maxG = 0;
    for (let i = 0; i < 240 * 45; i++) {
      ap.update(sim, inp);
      sim.step(dt, inp);
      if (sim.phase === 'rail') { minN = Math.min(minN, sim.normalForce); maxG = Math.max(maxG, sim.gForce); }
      if (sim.phase === 'landed' || sim.phase === 'crashed') {
        if (sim.phase === 'landed') break;
        if (sim.phase === 'crashed') break;
      }
    }
    const td = sim.touchdown;
    console.log(`  thr=${thr} phase=${sim.phase}${sim.crashReason ? ' (' + sim.crashReason + ')' : ''} exit=${(sim.exitSpeed * 3.6).toFixed(0)} air=${sim.airTime.toFixed(1)}s rot=${(sim.rotation * 57.3).toFixed(0)}° maxAlt=${sim.maxAlt.toFixed(0)} tank=${(sim.airFrac * 100).toFixed(0)}% minN=${(minN / 1000).toFixed(1)}kN maxG=${maxG.toFixed(1)}`);
    if (td) {
      const { u } = { u: (td.point.x - h.origin.x) * h.dir.x + (td.point.z - h.origin.z) * h.dir.y };
      console.log(`    touchdown tilt=${td.tiltDeg.toFixed(1)}° impact=${td.impact.toFixed(1)}m/s slip=${td.slipDeg.toFixed(1)}° spin=${td.spinDeg.toFixed(0)}°/s rev=${td.reverse} u=${u.toFixed(0)} (target ${h.targetU.toFixed(0)}) y=${td.point.y.toFixed(1)}`);
    }
  }
}
