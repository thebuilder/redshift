// Rough-pilot check: hands off in the air, or holding the car level with belly blasts near the ground.
import * as THREE from 'three';
import { LEVELS } from '../src/levels/levels';
import { buildLevel } from '../src/levels/LevelBuilder';
import { CarSim, emptyInput, SPEC } from '../src/physics/CarSim';
for (const mode of ['handsoff', 'level']) {
  const out: string[] = [];
  for (const def of LEVELS) {
    const lv = buildLevel(def);
    const sim = new CarSim(lv.track, lv.terrain, lv.startS);
    const inp = emptyInput();
    for (let i = 0; i < 240 * 40; i++) {
      inp.throttle = sim.phase === 'rail' ? 1 : 0; inp.pitch = inp.roll = inp.yaw = inp.lift = 0;
      if (mode === 'level' && sim.phase === 'air') {
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(sim.quat);
        const err = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0));
        const wb = err.multiplyScalar(2.5).applyQuaternion(sim.quat.clone().invert());
        inp.roll = THREE.MathUtils.clamp(wb.x / SPEC.maxRate.x, -1, 1);
        inp.pitch = THREE.MathUtils.clamp(wb.z / SPEC.maxRate.z, -1, 1);
        if (up.y < -0.2) inp.pitch = 1;
        if (sim.altitude() < 25 && sim.vel.y < -6 && up.y > 0.8) inp.lift = 1;
      }
      sim.step(1 / 240, inp);
      if (sim.phase === 'landed' || sim.phase === 'crashed') break;
    }
    const td = sim.touchdown;
    out.push(`${def.id}:${sim.phase}${sim.crashReason ? '(' + sim.crashReason + ')' : ''}${td ? ` tilt ${td.tiltDeg.toFixed(0)} imp ${td.impact.toFixed(1)}` : ''}`);
  }
  console.log(mode, '\n  ' + out.join('\n  '));
}
