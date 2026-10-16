// steer across the runway, then let the autopilot fly: does an off-axis launch still land?
import { LEVELS } from '../src/levels/levels';
import { buildLevel } from '../src/levels/LevelBuilder';
import { CarSim, emptyInput } from '../src/physics/CarSim';
import { Autopilot } from '../src/game/Autopilot';
for (const def of LEVELS) {
  const out: string[] = [];
  for (const dir of [-1, 1]) {
    const lv = buildLevel(def); const sim = new CarSim(lv.track, lv.terrain, lv.startS); const ap = new Autopilot(); const inp = emptyInput();
    for (let i = 0; i < 240 * 40; i++) {
      ap.update(sim, inp);
      if (sim.phase === 'rail') inp.steer = sim.s < lv.track.rampStartS() - 10 ? (Math.abs(sim.lat) < 3.5 ? dir : 0) : dir * 0.6;
      sim.step(1 / 240, inp);
      if (sim.phase === 'landed' || sim.phase === 'crashed') break;
    }
    out.push(`${dir > 0 ? 'R' : 'L'}:${sim.phase}${sim.crashReason ? '(' + sim.crashReason + ')' : ''}`);
  }
  console.log(def.id, def.name, out.join('  '));
}
