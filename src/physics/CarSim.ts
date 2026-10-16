import * as THREE from 'three';
import { Track, TrackSample, TRACK_HALF_WIDTH } from './Track';
import { Terrain } from './Terrain';

/*
 * Car body frame: +X forward, +Y up, +Z right. Origin = centre of mass.
 *
 * Two regimes:
 *  - RAIL: constrained to the track spline (1 DOF). Normal force is solved
 *    from curvature, gravity and downforce. If it goes negative the car
 *    loses grip and becomes a free body.
 *  - FREE: full 6-DOF rigid body with gravity, drag, 12 air-blast nozzles,
 *    4 raycast suspension wheels with tyre friction and body contact points.
 */

export const G = 9.81;

export const SPEC = {
  mass: 1800,
  inertia: new THREE.Vector3(820, 3800, 3400), // roll (x), yaw (y), pitch (z)
  comHeight: 0.55,
  maxDriveForce: 54000, // ~3 g launch
  power: 1.0e6, // W -> 0-60 mph in ~0.95 s
  brakeForce: 38000,
  rho: 1.225,
  cdA: 0.85,
  clA: 2.4, // aero downforce on rails
  fanForce: 9000, // active ground-effect fan on rails (N)
  crr: 0.012,
  wheelX: 1.45,
  wheelZ: 0.86,
  wheelR: 0.36,
  mountY: 0.125,
  suspRest: 0.42,
  suspTravel: 0.3,
  k: 42000,
  c: 4600,
  kBump: 450000,
  mu: 1.35,
  latStiff: 9000,
  // air blasts
  attForce: 1750,
  sideForce: 2200,
  liftForce: 10000,
  downMax: 11800,
  tank: 190000, // N*s of compressed air
  maxRate: new THREE.Vector3(3.4, 2.0, 2.6), // rad/s in rate-assist mode
  crashImpact: 38, // m/s: only a truly absurd drop breaks the car; hard landings just score badly
};

export interface Nozzle {
  name: string;
  pos: THREE.Vector3; // body
  force: THREE.Vector3; // unit force direction on car (blast goes opposite)
  max: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// positions match the bronze pipes/ports on the Blender model (car_build.py)
export const NOZZLES: Nozzle[] = [
  { name: 'FL▼', pos: V(1.0, -0.4, -0.86), force: V(0, 1, 0), max: SPEC.downMax },
  { name: 'FR▼', pos: V(1.0, -0.4, 0.86), force: V(0, 1, 0), max: SPEC.downMax },
  { name: 'RL▼', pos: V(-1.0, -0.4, -0.86), force: V(0, 1, 0), max: SPEC.downMax },
  { name: 'RR▼', pos: V(-1.0, -0.4, 0.86), force: V(0, 1, 0), max: SPEC.downMax },
  { name: 'FL▲', pos: V(1.62, 0.2, -0.7), force: V(0, -1, 0), max: SPEC.attForce },
  { name: 'FR▲', pos: V(1.62, 0.2, 0.7), force: V(0, -1, 0), max: SPEC.attForce },
  { name: 'RL▲', pos: V(-1.95, 0.39, -0.88), force: V(0, -1, 0), max: SPEC.attForce },
  { name: 'RR▲', pos: V(-1.95, 0.39, 0.88), force: V(0, -1, 0), max: SPEC.attForce },
  { name: 'F◀', pos: V(2.15, -0.12, -0.88), force: V(0, 0, 1), max: SPEC.sideForce },
  { name: 'F▶', pos: V(2.15, -0.12, 0.88), force: V(0, 0, -1), max: SPEC.sideForce },
  { name: 'R◀', pos: V(-2.2, 0.05, -0.94), force: V(0, 0, 1), max: SPEC.sideForce },
  { name: 'R▶', pos: V(-2.2, 0.05, 0.94), force: V(0, 0, -1), max: SPEC.sideForce },
];

/** the four rear exhaust pipes (body frame): compressed air blasts out of these for the launch */
export const EXHAUSTS = [-0.47, -0.16, 0.16, 0.47].map((z) => V(-2.43, 0.41 - SPEC.comHeight, z));
/** how much of the drive comes from the rear air blast: all of it off the line, fading out by ~230 km/h */
export function exhaustShare(speed: number) {
  return Math.max(0, Math.min(1, 1.15 - speed / 55));
}

export const WHEELS = [
  V(SPEC.wheelX, SPEC.mountY, -SPEC.wheelZ),
  V(SPEC.wheelX, SPEC.mountY, SPEC.wheelZ),
  V(-SPEC.wheelX, SPEC.mountY, -SPEC.wheelZ),
  V(-SPEC.wheelX, SPEC.mountY, SPEC.wheelZ),
];

// body collision hull points (body frame)
const BODY_POINTS: { p: THREE.Vector3; top: boolean }[] = [
  { p: V(2.3, -0.3, -0.8), top: false }, { p: V(2.3, -0.3, 0.8), top: false },
  { p: V(-2.25, -0.25, -0.9), top: false }, { p: V(-2.25, -0.25, 0.9), top: false },
  { p: V(0, -0.36, -0.95), top: false }, { p: V(0, -0.36, 0.95), top: false },
  { p: V(2.3, 0.0, 0), top: false }, { p: V(-2.3, 0.35, 0), top: false },
  { p: V(1.0, 0.33, -1.0), top: true }, { p: V(1.0, 0.33, 1.0), top: true },
  { p: V(-1.8, 0.4, -0.98), top: true }, { p: V(-1.8, 0.4, 0.98), top: true },
  { p: V(0.0, 0.68, -0.6), top: true }, { p: V(0.0, 0.68, 0.6), top: true },
  { p: V(-1.0, 0.62, 0), top: true }, { p: V(0.6, 0.45, 0), top: true },
];

export interface CarInput {
  throttle: number;
  brake: number;
  steer: number; // +right
  pitch: number; // +nose up
  roll: number; // +right side down
  yaw: number; // +right
  lift: number;
}

export const emptyInput = (): CarInput => ({ throttle: 0, brake: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, lift: 0 });

export type Phase = 'rail' | 'air' | 'landing' | 'landed' | 'crashed';

export interface Touchdown {
  time: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  tiltDeg: number;
  impact: number; // m/s along normal
  slipDeg: number;
  spinDeg: number; // deg/s
  reverse: boolean;
  speed: number;
}

export interface SimEvent {
  type: 'takeoff' | 'touchdown' | 'crash' | 'settled' | 'lostGrip' | 'bottomOut' | 'scrape' | 'bounce';
  t: number;
  data?: any;
}

interface WheelState {
  x: number; // compression
  xPrev: number;
  contact: boolean;
  spin: number;
  steer: number;
  hitPoint: THREE.Vector3;
  normal: THREE.Vector3;
  load: number;
  slip: number;
}

const tv1 = new THREE.Vector3();
const tv2 = new THREE.Vector3();
const tv3 = new THREE.Vector3();
const tv4 = new THREE.Vector3();
const tv5 = new THREE.Vector3();
const tq = new THREE.Quaternion();
const GRAV = new THREE.Vector3(0, -G, 0);

export class CarSim {
  track: Track;
  terrain: Terrain;
  phase: Phase = 'rail';
  time = 0;

  // rail state
  s = 0;
  v = 0;
  /** lateral offset from the track centre line (m, +right) and heading relative to the track (rad, +right) */
  lat = 0;
  psi = 0;
  private psiRate = 0;
  private fr: TrackSample;

  // rigid body state (always valid; synced from rail when on rails)
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  quat = new THREE.Quaternion();
  angVel = new THREE.Vector3(); // world

  air = SPEC.tank;
  assist = true;
  /** rate-hold only kicks in once the pilot has used the attitude controls in this flight */
  assistEngaged = false;
  nozzle = new Float32Array(NOZZLES.length); // current force (N)
  /** rear exhaust blast, 0..1 (visual, audio, HUD) */
  exhaust = 0;
  wheels: WheelState[] = WHEELS.map(() => ({
    x: 0, xPrev: 0, contact: false, spin: 0, steer: 0, hitPoint: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), load: 0, slip: 0,
  }));
  bodyContact = false;
  scrapeIntensity = 0;

  events: SimEvent[] = [];

  // telemetry
  gForce = 1;
  downforce = 0; // N
  accel = 0;
  normalForce = 0;
  lostGrip = false;
  crashReason = '';
  touchdown: Touchdown | null = null;
  takeoffTime = -1;
  exitSpeed = 0;
  maxSpeed = 0;
  maxAlt = 0;
  airTime = 0;
  rotation = 0; // integrated rad in air
  flips = 0;
  sinceExit = 0;
  private landTimer = 0;
  private airborneAgain = 0;
  launched = false;

  constructor(track: Track, terrain: Terrain, startS = 6) {
    this.track = track;
    this.terrain = terrain;
    this.s = startS;
    this.fr = track.sample(startS);
    this.syncFromRail();
    // start with the suspension at its static ride height
    for (const w of this.wheels) { w.contact = true; w.load = (SPEC.mass * G) / 4; w.x = w.load / SPEC.k; w.xPrev = w.x; }
  }

  get forward() { return tv1.set(1, 0, 0).applyQuaternion(this.quat).clone(); }
  get up() { return tv1.set(0, 1, 0).applyQuaternion(this.quat).clone(); }
  get speed() { return this.phase === 'rail' ? Math.abs(this.v) : this.vel.length(); }
  get airFrac() { return this.air / SPEC.tank; }
  get onRail() { return this.phase === 'rail'; }
  get grounded() {
    let n = 0;
    for (const w of this.wheels) if (w.contact) n++;
    return n >= 2;
  }

  altitude() {
    if (this.phase === 'rail') return Math.max(0, this.pos.y - SPEC.comHeight);
    return Math.max(0, this.pos.y - SPEC.comHeight - this.terrain.height(this.pos.x, this.pos.z));
  }

  private emit(type: SimEvent['type'], data?: any) {
    this.events.push({ type, t: this.time, data });
  }

  private syncFromRail() {
    const f = this.fr;
    this.pos.copy(f.pos).addScaledVector(f.U, SPEC.comHeight).addScaledVector(f.R, this.lat);
    this.quat.copy(f.quat).multiply(tq.setFromAxisAngle(tv1.set(0, 1, 0), -this.psi));
    const c = Math.cos(this.psi), sn = Math.sin(this.psi);
    this.vel.copy(f.T).multiplyScalar(this.v * c).addScaledVector(f.R, this.v * sn);
    this.angVel.copy(f.omega).multiplyScalar(this.v * c).addScaledVector(f.U, -this.psiRate);
  }

  step(dt: number, inp: CarInput) {
    this.time += dt;
    if (this.phase === 'rail') this.stepRail(dt, inp);
    else this.stepFree(dt, inp);
    const sp = this.speed;
    if (sp > this.maxSpeed) this.maxSpeed = sp;
  }

  // ---------------------------------------------------------------- RAIL
  private driveForce(throttle: number, speed: number) {
    return throttle * Math.min(SPEC.maxDriveForce, SPEC.power / Math.max(0.5, speed));
  }

  private stepRail(dt: number, inp: CarInput) {
    const m = SPEC.mass;
    const f = this.track.sample(this.s, this.fr);
    const v = this.v;
    const sp = Math.abs(v);
    const drive = this.driveForce(inp.throttle, sp);
    this.exhaust = inp.throttle * exhaustShare(sp);
    const brake = inp.brake * SPEC.brakeForce * (sp > 0.05 ? Math.sign(v) : 0);
    const D = 0.5 * SPEC.rho * SPEC.clA * v * v + SPEC.fanForce * Math.min(1, sp / 6);
    const gT = GRAV.dot(f.T);
    const gU = GRAV.dot(f.U);
    const kU = f.kappa.dot(f.U);
    const N = m * v * v * kU - m * gU + D;
    const drag = 0.5 * SPEC.rho * SPEC.cdA * v * Math.abs(v);
    const rr = SPEC.crr * Math.max(N, 0) * Math.sign(v);
    let a = (drive - brake - drag - rr) / m + gT;
    if (sp < 0.05 && inp.throttle < 0.01 && Math.abs(gT) < 0.5) a = 0;
    this.v += a * dt;
    if (inp.brake > 0 && Math.sign(this.v) !== Math.sign(v) && Math.abs(gT) < 0.5) this.v = 0;
    // steering on the track: heading follows the wheel, the car drifts across the width
    const steerMax = 0.13 / (1 + sp * 0.03);
    const psiTarget = inp.steer * steerMax;
    this.psiRate = (psiTarget - this.psi) * 5;
    this.psi += this.psiRate * dt;
    this.s += this.v * Math.cos(this.psi) * dt;
    this.lat += this.v * Math.sin(this.psi) * dt;
    const latMax = TRACK_HALF_WIDTH - 1.05;
    if (Math.abs(this.lat) > latMax) {
      // brush the curb: stop at the wall, bounce the heading back, scrub a little speed
      this.lat = Math.sign(this.lat) * latMax;
      if (Math.sign(this.psi) === Math.sign(this.lat)) { this.psi = -this.psi * 0.3; this.psiRate = 0; }
      this.v *= 1 - 0.25 * dt;
      this.scrapeIntensity = Math.min(1, sp / 40);
    } else this.scrapeIntensity = 0;
    if (this.s < 0) { this.s = 0; this.v = Math.max(0, this.v); }
    this.accel = a;
    this.normalForce = N;
    this.downforce = D;
    // specific force felt by the driver
    tv2.copy(f.T).multiplyScalar(a - gT).addScaledVector(f.kappa, v * v).sub(GRAV);
    this.gForce = tv2.length() / G;
    if (v > 1) this.launched = true;

    // wheels (visual + feel)
    const load = Math.max(0, N) / 4;
    for (const w of this.wheels) {
      w.contact = N > 0;
      w.load = load;
      w.x = Math.min(SPEC.suspTravel, load / SPEC.k);
      w.spin += (this.v / SPEC.wheelR) * dt;
      w.steer = WHEELS.indexOf(WHEELS[this.wheels.indexOf(w)]) < 2 ? THREE.MathUtils.clamp(this.psi * 4 + this.psiRate * 0.3, -0.45, 0.45) : 0;
      // the air blast does most of the shoving off the line, so the tyres only chirp
      w.slip = inp.throttle > 0.5 && sp < 10 ? 0.45 * (1 - sp / 10) : 0;
    }
    this.air = Math.min(SPEC.tank, this.air + SPEC.tank * 0.6 * dt);
    this.nozzle.fill(0);

    this.track.sample(this.s, this.fr);
    this.syncFromRail();

    if (N < 0 && this.fr.pos.y > 0.5) {
      this.lostGrip = true;
      this.emit('lostGrip');
      this.toFree();
      return;
    }
    if (this.s >= this.track.length) {
      this.exitSpeed = Math.abs(this.v);
      this.toFree();
      this.emit('takeoff', { speed: this.exitSpeed });
    }
  }

  private toFree() {
    this.phase = 'air';
    this.assistEngaged = false;
    this.takeoffTime = this.time;
    this.sinceExit = 0;
    for (const w of this.wheels) { w.contact = false; w.x = 0; w.xPrev = 0; }
  }

  // ---------------------------------------------------------------- FREE
  private stepFree(dt: number, inp: CarInput) {
    const m = SPEC.mass;
    const I = SPEC.inertia;
    const q = this.quat;
    const pos = this.pos;
    const vel = this.vel;
    const w = this.angVel;
    this.sinceExit += dt;

    const F = tv4.set(0, -G * m, 0);
    const Tq = tv5.set(0, 0, 0);
    const sp = vel.length();
    F.addScaledVector(vel, -0.5 * SPEC.rho * SPEC.cdA * sp);
    // slight aerodynamic angular damping
    Tq.addScaledVector(w, -60);

    const qInv = tq.copy(q).invert();
    const wb = tv3.copy(w).applyQuaternion(qInv);

    const addForceAt = (fWorld: THREE.Vector3, pWorld: THREE.Vector3) => {
      F.add(fWorld);
      const r = tv1.copy(pWorld).sub(pos);
      Tq.add(r.cross(fWorld));
    };

    // ------------------- contacts first (need grounded state for thrusters)
    const upW = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const fwdW = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const down = upW.clone().negate();
    const L = SPEC.suspRest + SPEC.wheelR;
    let contacts = 0;
    let firstWheelContact: { point: THREE.Vector3; normal: THREE.Vector3 } | null = null;
    let maxImpact = 0;
    for (let i = 0; i < WHEELS.length; i++) {
      const ws = this.wheels[i];
      const mount = WHEELS[i].clone().applyQuaternion(q).add(pos);
      const t = this.terrain.raycast(mount, down, L);
      const wasContact = ws.contact;
      ws.xPrev = ws.x;
      const front = i < 2;
      const steerMax = 0.45 / (1 + sp * 0.08);
      ws.steer += (inp.steer * steerMax * (front ? 1 : 0) - ws.steer) * Math.min(1, dt * 10);
      if (t < 0) {
        ws.contact = false;
        ws.x = 0;
        ws.load = 0;
        ws.slip = 0;
        // free spinning wheel slows a little
        ws.spin += 0;
        continue;
      }
      ws.contact = true;
      contacts++;
      const x = L - t;
      ws.x = Math.min(x, SPEC.suspTravel + 0.12);
      const cp = mount.clone().addScaledVector(down, t);
      const n = this.terrain.normal(cp.x, cp.z, ws.normal);
      ws.hitPoint.copy(cp);
      const vcp = tv2.copy(w).cross(tv1.copy(cp).sub(pos)).add(vel);
      const vn = vcp.dot(n);
      if (!wasContact) {
        maxImpact = Math.max(maxImpact, -vn);
        if (!firstWheelContact) firstWheelContact = { point: cp.clone(), normal: n.clone() };
      }
      let xdot = wasContact ? (x - ws.xPrev) / dt : -vn;
      let Fs = SPEC.k * x + SPEC.c * xdot;
      if (x > SPEC.suspTravel) {
        Fs += SPEC.kBump * (x - SPEC.suspTravel) + 9000 * Math.max(0, xdot);
        if (xdot > 4) this.emit('bottomOut', { speed: xdot });
      }
      Fs = Math.max(0, Fs) * Math.max(0, upW.dot(n));
      ws.load = Fs;
      const fs = n.clone().multiplyScalar(Fs);
      // tyre
      const wf = fwdW.clone();
      if (ws.steer !== 0) wf.applyAxisAngle(upW, -ws.steer);
      wf.addScaledVector(n, -wf.dot(n)).normalize();
      const right = new THREE.Vector3().crossVectors(wf, n).normalize();
      const vLong = vcp.dot(wf);
      const vLat = vcp.dot(right);
      let fLat = -vLat * SPEC.latStiff;
      let fLong = 0;
      const canDrive = this.phase === 'landed' || this.phase === 'landing';
      if (canDrive) fLong += this.driveForce(inp.throttle, Math.abs(vLong)) / 4;
      const brakeIn = Math.max(inp.brake, this.phase === 'crashed' ? 0.5 : 0);
      fLong += -Math.max(-SPEC.brakeForce / 4, Math.min(SPEC.brakeForce / 4, vLong * SPEC.latStiff)) * brakeIn;
      fLong += -Math.sign(vLong) * Math.min(Math.abs(vLong) * 400, SPEC.crr * Fs);
      const maxF = SPEC.mu * Fs;
      const mag = Math.hypot(fLat, fLong);
      ws.slip = maxF > 0 ? Math.min(1, Math.max(0, mag / maxF - 0.7) * 2) : 0;
      if (mag > maxF && mag > 0) { fLat *= maxF / mag; fLong *= maxF / mag; }
      fs.addScaledVector(right, fLat).addScaledVector(wf, fLong);
      addForceAt(fs, cp);
      ws.spin += (vLong / SPEC.wheelR) * dt;
    }

    // ------------------- body contacts
    this.bodyContact = false;
    this.scrapeIntensity = 0;
    let topHit = 0;
    let bodyHit = 0;
    const nTmp = new THREE.Vector3();
    for (const bp of BODY_POINTS) {
      const p = bp.p.clone().applyQuaternion(q).add(pos);
      const depth = this.terrain.penetration(p, nTmp);
      if (depth <= 0) continue;
      this.bodyContact = true;
      const vp = tv2.copy(w).cross(tv1.copy(p).sub(pos)).add(vel);
      const vn = vp.dot(nTmp);
      let Fn = 260000 * depth - 14000 * vn;
      if (Fn < 0) Fn = 0;
      const vt = vp.clone().addScaledVector(nTmp, -vn);
      const vtl = vt.length();
      const Ft = vtl > 1e-4 ? vt.multiplyScalar(-Math.min(0.75 * Fn, vtl * 4000) / vtl) : vt.set(0, 0, 0);
      this.scrapeIntensity = Math.max(this.scrapeIntensity, Math.min(1, vtl / 20));
      const fw = nTmp.clone().multiplyScalar(Fn).add(Ft);
      addForceAt(fw, p);
      if (-vn > 0) {
        if (bp.top) topHit = Math.max(topHit, -vn);
        else bodyHit = Math.max(bodyHit, -vn);
      }
    }

    this.exhaust = this.phase === 'landed' || this.phase === 'landing' ? inp.throttle * exhaustShare(this.vel.length()) : 0;
    // ------------------- air blasts
    const airborne = contacts < 2 && !this.bodyContact;
    this.nozzle.fill(0);
    if (this.phase !== 'crashed' && this.phase !== 'landed' && this.air > 0) {
      let cx: number, cy: number, cz: number;
      const att = !(contacts >= 3);
      // the launch spin carries until the pilot first touches the attitude controls;
      // from then on rate-assist holds whatever rotation rate the stick asks for
      if (Math.abs(inp.roll) + Math.abs(inp.pitch) + Math.abs(inp.yaw) > 0.05) this.assistEngaged = true;
      if (att) {
        if (this.assist && this.assistEngaged) {
          const R = SPEC.maxRate;
          const dx = inp.roll * R.x - wb.x;
          const dy = -inp.yaw * R.y - wb.y;
          const dz = inp.pitch * R.z - wb.z;
          const dead = (d: number) => (Math.abs(d) < 0.015 ? 0 : d);
          cx = THREE.MathUtils.clamp(dead(dx) * 1.6, -1, 1);
          cy = THREE.MathUtils.clamp(dead(dy) * 2.6, -1, 1);
          cz = THREE.MathUtils.clamp(dead(dz) * 2.4, -1, 1);
        } else {
          cx = inp.roll;
          cy = -inp.yaw;
          cz = inp.pitch;
        }
      } else {
        cx = cy = cz = 0;
      }
      const cmd = this.nozzle;
      const A = SPEC.attForce;
      const S = SPEC.sideForce;
      // pitch (+z torque = nose up): front-down + rear-up, else rear-down + front-up
      if (cz > 0) { cmd[0] += cz * A; cmd[1] += cz * A; cmd[6] += cz * A; cmd[7] += cz * A; }
      else if (cz < 0) { cmd[2] -= cz * A; cmd[3] -= cz * A; cmd[4] -= cz * A; cmd[5] -= cz * A; }
      // roll (+x torque = right side down): left-down + right-up
      if (cx > 0) { cmd[0] += cx * A; cmd[2] += cx * A; cmd[5] += cx * A; cmd[7] += cx * A; }
      else if (cx < 0) { cmd[1] -= cx * A; cmd[3] -= cx * A; cmd[4] -= cx * A; cmd[6] -= cx * A; }
      // yaw (+y torque = nose left): front pushed left (-z force) + rear pushed right
      if (cy > 0) { cmd[9] += cy * S; cmd[10] += cy * S; }
      else if (cy < 0) { cmd[8] -= cy * S; cmd[11] -= cy * S; }
      if (inp.lift > 0) for (let i = 0; i < 4; i++) cmd[i] += inp.lift * SPEC.liftForce;
      let total = 0;
      for (let i = 0; i < NOZZLES.length; i++) {
        cmd[i] = Math.min(cmd[i], NOZZLES[i].max);
        total += cmd[i];
      }
      const use = total * dt;
      if (use > this.air) {
        const k = this.air / use;
        for (let i = 0; i < cmd.length; i++) cmd[i] *= k;
        this.air = 0;
      } else this.air -= use;
      for (let i = 0; i < NOZZLES.length; i++) {
        if (cmd[i] <= 0) continue;
        const nz = NOZZLES[i];
        const fWorld = nz.force.clone().multiplyScalar(cmd[i]).applyQuaternion(q);
        const pW = nz.pos.clone().applyQuaternion(q).add(pos);
        addForceAt(fWorld, pW);
      }
    }

    // ------------------- integrate
    vel.addScaledVector(F, dt / m);
    pos.addScaledVector(vel, dt);
    const tb = Tq.applyQuaternion(qInv);
    const Iw = tv2.set(I.x * wb.x, I.y * wb.y, I.z * wb.z);
    const gyro = tv1.copy(wb).cross(Iw);
    wb.x += ((tb.x - gyro.x) / I.x) * dt;
    wb.y += ((tb.y - gyro.y) / I.y) * dt;
    wb.z += ((tb.z - gyro.z) / I.z) * dt;
    w.copy(wb).applyQuaternion(q);
    const wl = w.length();
    if (wl > 1e-8) {
      const dq = new THREE.Quaternion().setFromAxisAngle(tv1.copy(w).divideScalar(wl), wl * dt);
      q.premultiply(dq).normalize();
    }

    // ------------------- telemetry
    tv2.copy(F).divideScalar(m).sub(GRAV);
    this.gForce = tv2.length() / G;
    this.normalForce = 0;
    this.downforce = 0;
    for (const ws of this.wheels) this.normalForce += ws.load;

    if (this.phase === 'air') {
      this.airTime += dt;
      this.rotation += wl * dt;
      this.maxAlt = Math.max(this.maxAlt, this.altitude());
    }

    // ------------------- phase logic
    const tilt = Math.acos(THREE.MathUtils.clamp(upW.y, -1, 1));
    if (this.phase === 'air') {
      // ramp strike
      if (this.sinceExit > 0.25) {
        const tqy = this.track.query(pos);
        if (tqy && tqy.dist < 14 && Math.abs(tqy.along) < 1.5 && this.track.pos[tqy.idx].y > 0.6 && Math.abs(tqy.lateral) < TRACK_HALF_WIDTH + 1.2 && tqy.height > -1.6 && tqy.height < 1.0) {
          this.crash('HIT THE RAMP');
          return;
        }
      }
      if (firstWheelContact || this.bodyContact) {
        const n = firstWheelContact ? firstWheelContact.normal : nTmp.clone();
        const pt = firstWheelContact ? firstWheelContact.point : pos.clone();
        const tiltDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(upW.dot(n), -1, 1)));
        const vn = Math.max(maxImpact, -vel.dot(n));
        const vPlane = vel.clone().addScaledVector(n, -vel.dot(n));
        const fPlane = fwdW.clone().addScaledVector(n, -fwdW.dot(n));
        let slip = 0;
        let reverse = false;
        if (vPlane.length() > 2 && fPlane.length() > 0.1) {
          const c = vPlane.normalize().dot(fPlane.normalize());
          reverse = c < 0;
          slip = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(c))));
        }
        this.touchdown = {
          time: this.time, point: pt, normal: n.clone(), tiltDeg, impact: vn, slipDeg: slip,
          spinDeg: THREE.MathUtils.radToDeg(wl), reverse, speed: sp,
        };
        this.phase = 'landing';
        this.landTimer = 0;
        this.emit('touchdown', this.touchdown);
        if (!firstWheelContact && (topHit > 1.5 || tiltDeg > 60)) { this.crash(tiltDeg > 100 ? 'LANDED ON THE ROOF' : 'BODY STRIKE'); return; }
        if (tiltDeg > 70) { this.crash('TOO MUCH TILT'); return; }
        if (vn > SPEC.crashImpact) { this.crash('SUSPENSION FAILURE'); return; }
      }
    } else if (this.phase === 'landing') {
      this.landTimer += dt;
      if (topHit > 2.5) { this.crash('ROLLED OVER'); return; }
      if (bodyHit > 24) { this.crash('BOTTOMED OUT'); return; }
      if (tilt > THREE.MathUtils.degToRad(80) && this.bodyContact) { this.crash('ROLLED OVER'); return; }
      if (maxImpact > SPEC.crashImpact && this.landTimer < 0.6) { this.crash('SUSPENSION FAILURE'); return; }
      if (airborne) {
        this.airborneAgain += dt;
        if (this.airborneAgain > 0.05 && this.airborneAgain - dt <= 0.05) this.emit('bounce');
      } else this.airborneAgain = 0;
      if (this.landTimer > 0.75 && contacts >= 3 && wl < 1.4) {
        this.phase = 'landed';
        this.emit('settled');
      }
      if (this.landTimer > 6) { this.phase = 'landed'; this.emit('settled'); }
    } else if (this.phase === 'landed') {
      if (topHit > 3 || (tilt > THREE.MathUtils.degToRad(85) && this.bodyContact)) this.crash('ROLLED OVER');
    }
    if (pos.y < -5) pos.y = 0.6; // safety
  }

  crash(reason: string) {
    if (this.phase === 'crashed') return;
    this.phase = 'crashed';
    this.crashReason = reason;
    this.emit('crash', { reason });
  }

  /** Called when crashing into the ramp structure: bounce the car off it */
  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}

// --------------------------------------------------------------- prediction
export interface Prediction {
  points: THREE.Vector3[];
  hit: boolean;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  time: number;
  vel: THREE.Vector3;
}

export function predictTrajectory(pos: THREE.Vector3, vel: THREE.Vector3, terrain: Terrain, maxT = 14, dt = 0.04): Prediction {
  const p = pos.clone();
  const v = vel.clone();
  const pts: THREE.Vector3[] = [p.clone()];
  const k = (0.5 * SPEC.rho * SPEC.cdA) / SPEC.mass;
  for (let t = 0; t < maxT; t += dt) {
    const sp = v.length();
    v.y -= G * dt;
    v.addScaledVector(v, -k * sp * dt);
    const prev = p.clone();
    p.addScaledVector(v, dt);
    const h = terrain.height(p.x, p.z) + SPEC.comHeight;
    if (p.y <= h) {
      // refine
      let lo = 0, hi = 1;
      for (let i = 0; i < 8; i++) {
        const m = (lo + hi) / 2;
        const q = prev.clone().lerp(p, m);
        if (q.y > terrain.height(q.x, q.z) + SPEC.comHeight) lo = m; else hi = m;
      }
      const hp = prev.clone().lerp(p, (lo + hi) / 2);
      pts.push(hp.clone());
      const ground = hp.clone();
      ground.y = terrain.height(hp.x, hp.z);
      const nrm = new THREE.Vector3();
      for (const [ox, oz] of [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) nrm.add(terrain.normal(hp.x + ox, hp.z + oz));
      return { points: pts, hit: true, point: ground, normal: nrm.normalize(), time: t + dt, vel: v };
    }
    pts.push(p.clone());
  }
  return { points: pts, hit: false, point: p, normal: new THREE.Vector3(0, 1, 0), time: maxT, vel: v };
}
