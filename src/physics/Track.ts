import * as THREE from 'three';

/**
 * Track segments are described in the car's local frame:
 *  - straight: drive forward `length` metres
 *  - arc: pitch the track up by `angle` degrees around a circle of `radius`
 *    (a 360 arc is a loop, 540 is a loop-and-a-half)
 *  - lateral: shift sideways (metres, +right) smoothly over the segment so loops
 *    do not intersect themselves
 *  - roll: twist the track around its own axis (degrees) over the segment
 */
export type Segment =
  | { type: 'straight'; length: number; lateral?: number; roll?: number }
  | { type: 'arc'; angle: number; radius: number; lateral?: number; roll?: number };

export interface TrackSample {
  pos: THREE.Vector3;
  T: THREE.Vector3; // tangent (forward)
  U: THREE.Vector3; // surface normal (up)
  R: THREE.Vector3; // right
  kappa: THREE.Vector3; // curvature vector dT/ds
  omega: THREE.Vector3; // frame angular velocity per metre travelled (world)
  quat: THREE.Quaternion;
  s: number;
}

export const TRACK_HALF_WIDTH = 5;
export const TRACK_THICKNESS = 0.7;

const DS = 0.25;
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

function lateralProfile(t: number) {
  // 0..1 with zero slope at both ends
  return t - Math.sin(2 * Math.PI * t) / (2 * Math.PI);
}

export class Track {
  pos: THREE.Vector3[] = [];
  T: THREE.Vector3[] = [];
  U: THREE.Vector3[] = [];
  R: THREE.Vector3[] = [];
  K: THREE.Vector3[] = [];
  W: THREE.Vector3[] = [];
  Q: THREE.Quaternion[] = [];
  S: number[] = [];
  length = 0;
  /** s where each segment starts */
  segStart: number[] = [];
  segments: Segment[];
  /** loop and half-pipe circles (arcs of 120 deg or more) for keeping scenery out of them */
  loops: { center: THREE.Vector3; axis: THREE.Vector3; radius: number; latMin: number; latMax: number }[] = [];
  private grid = new Map<string, number[]>();
  private cell = 8;

  constructor(segments: Segment[]) {
    this.segments = segments;
    this.build();
    this.buildGrid();
    this.segments.forEach((seg, k) => {
      if (seg.type !== 'arc' || Math.abs(seg.angle) < 120) return;
      const s0 = this.segStart[k];
      const s1 = k + 1 < this.segStart.length ? this.segStart[k + 1] : this.length;
      const f = this.sample(s0 + 0.5);
      const center = f.pos.clone().addScaledVector(f.U, seg.radius);
      const axis = f.R.clone();
      axis.y = 0; axis.normalize();
      let latMin = Infinity, latMax = -Infinity;
      for (let i = 0; i < this.pos.length; i++) {
        if (this.S[i] < s0 || this.S[i] > s1) continue;
        const l = this.pos[i].clone().sub(center).dot(axis);
        latMin = Math.min(latMin, l); latMax = Math.max(latMax, l);
      }
      this.loops.push({ center, axis, radius: seg.radius, latMin, latMax });
    });
  }

  private build() {
    const rawPos: THREE.Vector3[] = [];
    const rawUp: THREE.Vector3[] = [];
    const base = new THREE.Vector3(0, 0, 0);
    const off = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const tmpQ = new THREE.Quaternion();
    const fwd = new THREE.Vector3();
    rawPos.push(base.clone());
    rawUp.push(new THREE.Vector3(0, 1, 0));
    const segStartIdx: number[] = [];

    let bank = 0; // accumulated roll (rad)
    for (const seg of this.segments) {
      segStartIdx.push(rawPos.length - 1);
      const len = seg.type === 'straight' ? seg.length : (seg.radius * Math.abs(seg.angle) * Math.PI) / 180;
      const n = Math.max(1, Math.ceil(len / DS));
      const ds = len / n;
      const right0 = Z.clone().applyQuaternion(q);
      right0.y = 0;
      if (right0.lengthSq() < 1e-6) right0.set(0, 0, 1);
      right0.normalize();
      const off0 = off.clone();
      const lateral = seg.lateral ?? 0;
      const roll = ((seg.roll ?? 0) * Math.PI) / 180;
      const dTheta = seg.type === 'arc' ? (Math.sign(seg.angle) * ds) / seg.radius : 0;
      // a twist that starts at ground level pivots on its low edge, so that edge
      // stays on the ground and the high side lifts (instead of the road sinking in)
      const groundTwist = roll !== 0 && base.y + off.y < 1;
      const bank0 = bank;
      const edgeLift = (b: number) => new THREE.Vector3().addScaledVector(right0, Math.sign(b) * TRACK_HALF_WIDTH * (1 - Math.cos(b))).add(new THREE.Vector3(0, TRACK_HALF_WIDTH * Math.abs(Math.sin(b)), 0));
      const lift0 = edgeLift(bank0);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        if (dTheta !== 0) q.multiply(tmpQ.setFromAxisAngle(Z, dTheta / 2));
        fwd.copy(X).applyQuaternion(q);
        base.addScaledVector(fwd, ds);
        if (dTheta !== 0) q.multiply(tmpQ.setFromAxisAngle(Z, dTheta / 2));
        // ground twists ease in and out (no kink where the road starts to lift);
        // twists on a lip keep a constant rate so the spin carries into the air
        const ease = (x: number) => x * x * (3 - 2 * x);
        const dRoll = groundTwist ? roll * (ease(t) - ease((i - 1) / n)) : roll / n;
        if (roll !== 0) q.multiply(tmpQ.setFromAxisAngle(X, dRoll));
        q.normalize();
        off.copy(off0).addScaledVector(right0, lateral * lateralProfile(t));
        if (groundTwist) off.add(edgeLift(bank0 + roll * ease(t)).sub(lift0));
        rawPos.push(base.clone().add(off));
        rawUp.push(new THREE.Vector3(0, 1, 0).applyQuaternion(q));
      }
      bank += roll;
    }

    const N = rawPos.length;
    // arc length
    let s = 0;
    for (let i = 0; i < N; i++) {
      if (i > 0) s += rawPos[i].distanceTo(rawPos[i - 1]);
      this.S.push(s);
    }
    this.length = s;
    this.segStart = segStartIdx.map((i) => this.S[i]);
    for (let i = 0; i < N; i++) {
      const a = rawPos[Math.max(0, i - 1)];
      const b = rawPos[Math.min(N - 1, i + 1)];
      const T = b.clone().sub(a).normalize();
      const U = rawUp[i].clone().addScaledVector(T, -rawUp[i].dot(T)).normalize();
      const R = new THREE.Vector3().crossVectors(T, U).normalize();
      this.pos.push(rawPos[i]);
      this.T.push(T);
      this.U.push(U);
      this.R.push(R);
      const m = new THREE.Matrix4().makeBasis(T, U, R);
      this.Q.push(new THREE.Quaternion().setFromRotationMatrix(m));
    }
    for (let i = 0; i < N; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(N - 1, i + 1);
      const dsI = this.S[i1] - this.S[i0] || 1;
      this.K.push(this.T[i1].clone().sub(this.T[i0]).divideScalar(dsI));
      // frame angular velocity per metre
      const dq = this.Q[i1].clone().multiply(this.Q[i0].clone().invert());
      if (dq.w < 0) {
        dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w;
      }
      const sinHalf = Math.sqrt(dq.x * dq.x + dq.y * dq.y + dq.z * dq.z);
      const w = new THREE.Vector3();
      if (sinHalf > 1e-9) {
        const angle = 2 * Math.atan2(sinHalf, dq.w);
        w.set(dq.x, dq.y, dq.z).multiplyScalar(angle / sinHalf / dsI);
      }
      this.W.push(w);
    }
  }

  private key(x: number, z: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }

  private buildGrid() {
    for (let i = 0; i < this.pos.length; i += 2) {
      const p = this.pos[i];
      const k = this.key(p.x, p.z);
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(i);
    }
  }

  private index(s: number) {
    const S = this.S;
    if (s <= 0) return 0;
    if (s >= this.length) return S.length - 2;
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (S[mid] <= s) lo = mid; else hi = mid;
    }
    return lo;
  }

  sample(s: number, out?: TrackSample): TrackSample {
    const o = out ?? {
      pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3(),
      kappa: new THREE.Vector3(), omega: new THREE.Vector3(), quat: new THREE.Quaternion(), s: 0,
    };
    const i = this.index(s);
    const s0 = this.S[i], s1 = this.S[i + 1];
    let t = (s - s0) / (s1 - s0 || 1);
    o.s = s;
    if (s < 0) {
      // extrapolate backwards along start tangent
      o.pos.copy(this.pos[0]).addScaledVector(this.T[0], s);
      t = 0;
    } else if (s > this.length) {
      o.pos.copy(this.pos[this.pos.length - 1]).addScaledVector(this.T[this.T.length - 1], s - this.length);
      t = 1;
    } else {
      o.pos.lerpVectors(this.pos[i], this.pos[i + 1], t);
    }
    t = Math.min(1, Math.max(0, t));
    o.T.lerpVectors(this.T[i], this.T[i + 1], t).normalize();
    o.U.lerpVectors(this.U[i], this.U[i + 1], t);
    o.U.addScaledVector(o.T, -o.U.dot(o.T)).normalize();
    o.R.crossVectors(o.T, o.U).normalize();
    o.kappa.lerpVectors(this.K[i], this.K[i + 1], t);
    o.omega.lerpVectors(this.W[i], this.W[i + 1], t);
    o.quat.slerpQuaternions(this.Q[i], this.Q[i + 1], t);
    return o;
  }

  /**
   * Find the track surface near a world point. Returns local coordinates relative
   * to the nearest sample: lateral offset and height above the surface.
   */
  query(p: THREE.Vector3): { idx: number; lateral: number; height: number; along: number; dist: number } | null {
    const cx = Math.floor(p.x / this.cell), cz = Math.floor(p.z / this.cell);
    let best = -1, bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const arr = this.grid.get(`${cx + dx},${cz + dz}`);
        if (!arr) continue;
        for (const i of arr) {
          const d = this.pos[i].distanceToSquared(p);
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    if (best < 0) return null;
    // refine with neighbours
    for (let k = Math.max(0, best - 2); k <= Math.min(this.pos.length - 1, best + 2); k++) {
      const d = this.pos[k].distanceToSquared(p);
      if (d < bestD) { bestD = d; best = k; }
    }
    const rel = p.clone().sub(this.pos[best]);
    return {
      idx: best,
      lateral: rel.dot(this.R[best]),
      height: rel.dot(this.U[best]),
      along: rel.dot(this.T[best]),
      dist: Math.sqrt(bestD),
    };
  }

  /** true if p is inside the open space of one of the loops */
  insideLoop(p: THREE.Vector3, margin = 1.5) {
    for (const L of this.loops) {
      const d = p.clone().sub(L.center);
      const lat = d.dot(L.axis);
      if (lat < L.latMin - TRACK_HALF_WIDTH - 1.5 || lat > L.latMax + TRACK_HALF_WIDTH + 1.5) continue;
      d.addScaledVector(L.axis, -lat);
      if (d.length() < L.radius - margin) return true;
    }
    return false;
  }

  /** s of the first point where the track leaves the ground */
  rampStartS(): number {
    for (let i = 0; i < this.pos.length; i++) if (this.pos[i].y > 0.3 || this.U[i].y < 0.995) return this.S[Math.max(0, i - 4)];
    return this.length;
  }

  bounds() {
    const b = new THREE.Box3();
    for (const p of this.pos) b.expandByPoint(p);
    return b;
  }
}
