import * as THREE from 'three';
import { CarSim } from '../physics/CarSim';
import { Track, TRACK_HALF_WIDTH } from '../physics/Track';
import { Terrain } from '../physics/Terrain';
import { LevelScene } from './World';

export type CamMode = 'chase' | 'dash' | 'cinematic';
export const CAM_MODES: CamMode[] = ['chase', 'dash', 'cinematic'];

const tv = new THREE.Vector3();
const tv2 = new THREE.Vector3();

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  mode: CamMode = 'chase';
  override: 'intro' | 'results' | null = null;
  private pos = new THREE.Vector3(0, 3, -10);
  private look = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private fov = 62;
  private station = -1;
  private orbit = 0;
  private shakeAmt = 0;
  private t = 0;
  private wasRail = true;
  private freeDir = new THREE.Vector3(-1, 0.3, 0).normalize();
  private cutTimer = 0;
  stations: LevelScene['cameraStations'] = [];

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 6000);
  }

  shake(a: number) { this.shakeAmt = Math.min(1.5, this.shakeAmt + a); }

  snap(sim: CarSim) {
    this.computeRailChase(sim, this.pos, this.look, this.up);
    this.camera.position.copy(this.pos);
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.look);
    this.station = -1;
    this.wasRail = true;
  }

  private computeRailChase(sim: CarSim, pos: THREE.Vector3, look: THREE.Vector3, up: THREE.Vector3) {
    const track: Track = sim.track;
    const sp = Math.abs(sim.v);
    const dist = 9.5 + Math.min(4, sp * 0.04);
    const f = track.sample(sim.s - dist);
    pos.copy(f.pos).addScaledVector(f.U, 2.7).addScaledVector(f.R, sim.lat * 0.75);
    const fwd = tv.set(1, 0, 0).applyQuaternion(sim.quat);
    const cu = tv2.set(0, 1, 0).applyQuaternion(sim.quat);
    look.copy(sim.pos).addScaledVector(cu, 0.7).addScaledVector(fwd, 3.5);
    up.copy(f.U);
  }

  update(dt: number, sim: CarSim, terrain: Terrain) {
    const cam = this.camera;
    const speed = sim.speed;
    let targetFov = 62;
    const desiredPos = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();
    const desiredUp = new THREE.Vector3(0, 1, 0);
    let posRate = 6, lookRate = 10, upRate = 3;
    const carUp = new THREE.Vector3(0, 1, 0).applyQuaternion(sim.quat);
    const carFwd = new THREE.Vector3(1, 0, 0).applyQuaternion(sim.quat);

    if (this.override) {
      this.orbit += dt * (this.override === 'intro' ? 0.28 : 0.18);
      const r = this.override === 'intro' ? 8.5 : 12;
      const base = this.override === 'intro' ? Math.PI * 0.75 : 0;
      const ang = base + this.orbit;
      const hdir = new THREE.Vector3(carFwd.x, 0, carFwd.z).normalize();
      const side = new THREE.Vector3(-hdir.z, 0, hdir.x);
      desiredPos.copy(sim.pos).addScaledVector(hdir, Math.cos(ang) * r).addScaledVector(side, Math.sin(ang) * r);
      desiredPos.y = sim.pos.y + (this.override === 'intro' ? 1.4 : 3.2);
      desiredLook.copy(sim.pos).add(new THREE.Vector3(0, 0.2, 0));
      targetFov = this.override === 'intro' ? 42 : 46;
      posRate = 3;
      lookRate = 6;
    } else if (this.mode === 'dash') {
      // driver's eye, left-hand drive
      // driver's eye, left seat, low behind the yoke
      desiredPos.set(-0.08, 0.36, -0.4).applyQuaternion(sim.quat).add(sim.pos);
      desiredLook.copy(desiredPos).addScaledVector(carFwd, 20).addScaledVector(carUp, -1.6);
      desiredUp.copy(carUp);
      targetFov = 70 + Math.min(14, speed * 0.1);
      posRate = lookRate = upRate = 1000;
    } else if (this.mode === 'cinematic' && this.stations.length) {
      // pick the station whose focus is nearest (normalised by its radius)
      let best = this.station, bestScore = Infinity;
      this.stations.forEach((st, i) => {
        const sc = st.focus.distanceTo(sim.pos) / st.radius;
        const bias = i === this.station ? 0.75 : 1;
        if (sc * bias < bestScore) { bestScore = sc * bias; best = i; }
      });
      this.cutTimer -= dt;
      if (best !== this.station && this.cutTimer <= 0) {
        this.station = best;
        this.cutTimer = 1.2;
        const st = this.stations[best];
        this.pos.copy(st.pos);
        this.look.copy(sim.pos);
        this.fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(12 / st.pos.distanceTo(sim.pos))), 6, 55);
      }
      const st = this.stations[Math.max(0, this.station)];
      desiredPos.copy(st.pos);
      desiredLook.copy(sim.pos).addScaledVector(sim.vel, 0.08);
      const d = st.pos.distanceTo(sim.pos);
      targetFov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(13 / d)), 6, 55);
      posRate = 2; lookRate = 7;
    } else {
      // chase
      if (sim.phase === 'rail') {
        this.computeRailChase(sim, desiredPos, desiredLook, desiredUp);
        posRate = 25; lookRate = 30; upRate = 12;
        this.freeDir.copy(desiredPos).sub(sim.pos).normalize();
        this.wasRail = true;
        targetFov = 60 + Math.min(20, speed * 0.16);
      } else {
        // lazy follow: keep the current bearing, drift behind the velocity
        const v = sim.vel;
        const hv = new THREE.Vector3(v.x, 0, v.z);
        if (hv.lengthSq() < 4) hv.set(carFwd.x, 0, carFwd.z);
        hv.normalize();
        const elev = sim.phase === 'air' ? 0.32 : 0.22;
        const want = hv.clone().negate().multiplyScalar(Math.cos(elev)).add(new THREE.Vector3(0, Math.sin(elev), 0)).normalize();
        const rate = this.wasRail ? 0.9 : 1.6;
        this.freeDir.lerp(want, 1 - Math.exp(-rate * dt)).normalize();
        const dist = sim.phase === 'air' ? 15 : 12;
        desiredPos.copy(sim.pos).addScaledVector(this.freeDir, dist);
        desiredLook.copy(sim.pos).addScaledVector(v, 0.06);
        posRate = 7; lookRate = 12; upRate = 1.8;
        targetFov = 62 + Math.min(14, speed * 0.1);
        if (sim.phase !== 'air') this.wasRail = false;
      }
    }

    // smoothing
    const a = 1 - Math.exp(-posRate * dt);
    this.pos.lerp(desiredPos, a);
    this.look.lerp(desiredLook, 1 - Math.exp(-lookRate * dt));
    this.up.lerp(desiredUp, 1 - Math.exp(-upRate * dt)).normalize();
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-4 * dt));

    // collision: stay above terrain, out of the track slab
    if (this.mode !== 'dash' || this.override) {
      const minY = terrain.height(this.pos.x, this.pos.z) + 1.2;
      if (this.pos.y < minY) this.pos.y = minY;
      if (sim.phase !== 'rail' || this.mode !== 'chase') {
        const q = sim.track.query(this.pos);
        if (q && Math.abs(q.lateral) < TRACK_HALF_WIDTH + 1 && Math.abs(q.along) < 1.5 && q.height < 1.3 && q.height > -2.5) {
          this.pos.addScaledVector(sim.track.U[q.idx], 1.3 - q.height);
        }
      }
    }

    // shake
    this.shakeAmt *= Math.exp(-3.5 * dt);
    // smooth low-frequency road buzz (chase cam only) plus impact shake; never per-frame random jitter
    this.t += dt;
    const buzz = this.mode === 'chase' && !this.override && sim.phase === 'rail' ? Math.min(0.012, speed * 0.00015) : 0;
    const amp = buzz + this.shakeAmt * (this.mode === 'dash' ? 0.06 : 0.22);
    cam.position.copy(this.pos);
    if (amp > 0.0003) {
      const t = this.t;
      cam.position.add(new THREE.Vector3(Math.sin(t * 23.1) + Math.sin(t * 37.7) * 0.5, Math.sin(t * 29.3 + 1.3) + Math.sin(t * 41.9) * 0.5, Math.sin(t * 19.7 + 2.1)).multiplyScalar(amp * 0.6));
    }
    cam.up.copy(this.up);
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
