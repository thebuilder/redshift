import * as THREE from 'three';
import { CarSim, CarInput, SPEC, G, predictTrajectory, Prediction } from '../physics/CarSim';

/**
 * Lunar-lander style autopilot: aligns the car with the predicted landing
 * surface and fires the belly blasts to cut the impact speed. Used for the
 * attract mode and the headless level validator.
 */
export class Autopilot {
  throttle = 1;
  private sign = 0;
  lastPrediction: Prediction | null = null;
  skill = 1; // 0..1 sloppiness for attract mode

  reset() { this.sign = 0; }

  update(sim: CarSim, out: CarInput) {
    out.steer = 0; out.pitch = 0; out.roll = 0; out.yaw = 0; out.lift = 0; out.brake = 0;
    if (sim.phase === 'rail') {
      out.throttle = this.throttle;
      return;
    }
    out.throttle = 0;
    if (sim.phase === 'landed' || sim.phase === 'crashed') {
      out.brake = 1;
      return;
    }
    if (sim.phase === 'landing') {
      out.brake = 0.3;
    }
    const pred = predictTrajectory(sim.pos, sim.vel, sim.terrain, 14, 0.05);
    this.lastPrediction = pred;
    const n = pred.normal;
    const vPlane = pred.vel.clone().addScaledVector(n, -pred.vel.dot(n));
    if (vPlane.lengthSq() < 1) vPlane.copy(sim.forward).addScaledVector(n, -sim.forward.dot(n));
    vPlane.normalize();
    const fwdNow = sim.forward;
    if (this.sign === 0 || pred.time > 2.5) {
      // choose forward or reverse landing: whichever is closer to current heading
      // (projected onto the surface), with a bias to forward
      const f = fwdNow.clone().addScaledVector(n, -fwdNow.dot(n));
      this.sign = f.dot(vPlane) < -0.35 ? -1 : 1;
    }
    const tf = vPlane.clone().multiplyScalar(this.sign);
    const tr = new THREE.Vector3().crossVectors(tf, n).normalize();
    const tu = new THREE.Vector3().crossVectors(tr, tf).normalize();
    const m = new THREE.Matrix4().makeBasis(tf, tu, tr);
    const qt = new THREE.Quaternion().setFromRotationMatrix(m);
    const qe = qt.multiply(sim.quat.clone().invert());
    if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; qe.w = -qe.w; }
    const sinHalf = Math.hypot(qe.x, qe.y, qe.z);
    const wDes = new THREE.Vector3();
    if (sinHalf > 1e-6) {
      const ang = 2 * Math.atan2(sinHalf, qe.w);
      wDes.set(qe.x, qe.y, qe.z).multiplyScalar(ang / sinHalf);
    }
    // time-aware gain: rotate faster when landing is close
    const kp = THREE.MathUtils.clamp(3.2 / Math.max(0.6, pred.time), 1.0, 3.5) * this.skill;
    wDes.multiplyScalar(kp);
    const lim = 2.6;
    if (wDes.length() > lim) wDes.setLength(lim);
    const wb = wDes.applyQuaternion(sim.quat.clone().invert());
    const R = SPEC.maxRate;
    out.roll = THREE.MathUtils.clamp(wb.x / R.x, -1, 1);
    out.yaw = THREE.MathUtils.clamp(-wb.y / R.y, -1, 1);
    out.pitch = THREE.MathUtils.clamp(wb.z / R.z, -1, 1);

    // belly blasts: suicide burn against the predicted landing plane
    const upAlign = sim.up.dot(n);
    const vnNow = -sim.vel.dot(n);
    const dist = sim.pos.clone().sub(pred.point).dot(n) - SPEC.comHeight;
    if (vnNow > 3 && upAlign > 0.8 && sim.phase === 'air' && dist > 0) {
      const netDecel = ((4 * SPEC.liftForce) / SPEC.mass) * upAlign - G * n.y;
      const vT = 2.5;
      const aReq = (vnNow * vnNow - vT * vT) / (2 * Math.max(0.3, dist));
      if (aReq > netDecel * 0.85) out.lift = 1;
    }
  }
}
