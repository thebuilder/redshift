import * as THREE from 'three';
import { Track } from '../physics/Track';
import { Terrain, makeHill, Hill } from '../physics/Terrain';
import { CarSim, emptyInput, SPEC, G } from '../physics/CarSim';
import { LevelDef } from './levels';

export interface BuiltLevel {
  def: LevelDef;
  track: Track;
  terrain: Terrain;
  hill: Hill;
  startS: number;
  maxExitSpeed: number;
  exitPos: THREE.Vector3;
  exitVel: THREE.Vector3;
  designTraj: THREE.Vector3[][]; // lo, mid, hi
  bounds: THREE.Box3;
}

interface Traj { u: number[]; y: number[]; pts: THREE.Vector3[]; apexI: number }

export function ballistic(p0: THREE.Vector3, v0: THREE.Vector3, dir: THREE.Vector2, origin: THREE.Vector3): Traj {
  const p = p0.clone();
  const v = v0.clone();
  const k = (0.5 * SPEC.rho * SPEC.cdA) / SPEC.mass;
  const dt = 0.02;
  const out: Traj = { u: [], y: [], pts: [], apexI: 0 };
  let maxY = -Infinity;
  for (let t = 0; t < 30; t += dt) {
    const yb = p.y - SPEC.comHeight;
    const u = (p.x - origin.x) * dir.x + (p.z - origin.z) * dir.y;
    out.u.push(u);
    out.y.push(yb);
    out.pts.push(p.clone());
    if (yb > maxY) { maxY = yb; out.apexI = out.u.length - 1; }
    if (yb < -2) break;
    const sp = v.length();
    v.y -= G * dt;
    v.addScaledVector(v, -k * sp * dt);
    p.addScaledVector(v, dt);
  }
  return out;
}

/** u where the descending branch crosses height y */
export function crossDesc(tr: Traj, y: number): number | null {
  for (let i = Math.max(1, tr.apexI); i < tr.u.length; i++) {
    if (tr.y[i - 1] >= y && tr.y[i] < y) {
      const t = (tr.y[i - 1] - y) / (tr.y[i - 1] - tr.y[i]);
      return tr.u[i - 1] + (tr.u[i] - tr.u[i - 1]) * t;
    }
  }
  return null;
}
function crossAsc(tr: Traj, y: number): number | null {
  for (let i = 1; i <= tr.apexI; i++) {
    if (tr.y[i - 1] < y && tr.y[i] >= y) {
      const t = (y - tr.y[i - 1]) / (tr.y[i] - tr.y[i - 1]);
      return tr.u[i - 1] + (tr.u[i] - tr.u[i - 1]) * t;
    }
  }
  return null;
}
export function slopeAt(tr: Traj, u: number) {
  for (let i = Math.max(1, tr.apexI); i < tr.u.length; i++) {
    if (tr.u[i] >= u) return Math.atan2(tr.y[i - 1] - tr.y[i], Math.abs(tr.u[i] - tr.u[i - 1]) || 1e-6);
  }
  return 0.5;
}
/** first u after apex where trajectory goes below line y = h - (u-uS)*tb */
export function crossLine(tr: Traj, uS: number, h: number, tb: number): number | null {
  for (let i = Math.max(1, tr.apexI); i < tr.u.length; i++) {
    const l0 = h - (tr.u[i - 1] - uS) * tb;
    const l1 = h - (tr.u[i] - uS) * tb;
    const d0 = tr.y[i - 1] - l0, d1 = tr.y[i] - l1;
    if (d0 >= 0 && d1 < 0) {
      const t = d0 / (d0 - d1);
      return tr.u[i - 1] + (tr.u[i] - tr.u[i - 1]) * t;
    }
  }
  return null;
}

function transitionPts(uBot: number, beta: number, Rt: number) {
  const pts: [number, number][] = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const a = beta * (1 - i / n);
    pts.push([uBot + Rt * (Math.sin(beta) - Math.sin(a)), Rt * (1 - Math.cos(a))]);
  }
  return pts;
}

export function designHill(fLo: number, fHi: number, exitPos: THREE.Vector3, exitVel: THREE.Vector3, origin: THREE.Vector3, dir: THREE.Vector2): Hill {
  // A family of trajectories across the speed window. Search for the straight
  // landing slope (height, angle) that minimises the worst normal impact, then
  // add a knoll above it and a transition to flat ground below.
  const NF = 8;
  const fam: Traj[] = [];
  for (let i = 0; i <= NF; i++) fam.push(ballistic(exitPos, exitVel.clone().multiplyScalar(fLo + ((fHi - fLo) * i) / NF), dir, origin));
  const mid = fam[NF >> 1];
  const lo = fam[0];
  const apexLo = lo.y[lo.apexI];
  const yExit = exitPos.y - SPEC.comHeight;
  // land no sooner than ~2.4 s after the lip so there is time to fix the attitude
  const tIdx = Math.min(lo.y.length - 1, Math.round(2.4 / 0.02));
  const hTime = tIdx > lo.apexI ? lo.y[tIdx] : Infinity;
  const hMax = Math.max(4, Math.min(apexLo - 0.7 * (apexLo - yExit), apexLo - 10, hTime));
  const spread = fam[NF].u[fam[NF].u.length - 1] - lo.u[lo.u.length - 1];
  const back = Math.max(70, spread * 0.8 + 30);
  const lineY = (u: number, uS: number, hS: number, tb: number) => hS - (u - uS) * tb;
  const crossFrom = (tr: Traj, uStart: number, uS: number, hS: number, tb: number) => {
    // only the descending branch can land: never start the search on the climb
    let i = Math.max(tr.u.findIndex((uu) => uu >= uStart), tr.apexI);
    if (i < 1) i = 1;
    // steep launches pass under the extended line near the apex: wait until the
    // arc is above the landing line, then take the crossing on the way down
    while (i < tr.u.length && tr.y[i - 1] < lineY(tr.u[i - 1], uS, hS, tb)) i++;
    if (i >= tr.u.length - 1 || tr.u[i] > uS + 40) return null;
    for (; i < tr.u.length; i++) {
      const d1 = tr.y[i] - lineY(tr.u[i], uS, hS, tb);
      if (d1 < 0) {
        const d0 = tr.y[i - 1] - lineY(tr.u[i - 1], uS, hS, tb);
        const t = d0 / (d0 - d1);
        const u = tr.u[i - 1] + (tr.u[i] - tr.u[i - 1]) * t;
        const vx = (tr.u[i] - tr.u[i - 1]) / 0.02, vy = (tr.y[i] - tr.y[i - 1]) / 0.02;
        return { u, vx, vy };
      }
    }
    return null;
  };
  let best: { cost: number; uS: number; hS: number; beta: number; uLo: number; uHi: number; Rt: number; imp: number } | null = null;
  const why = { noUS: 0, beta: 0, cross: 0, rt: 0, ok: 0 };
  for (let hS = 3; hS <= hMax; hS += 0.5) {
    const uS = crossDesc(mid, hS);
    if (uS === null) { why.noUS++; continue; }
    const gamma = slopeAt(mid, uS);
    for (let db = -4; db <= 24; db += 1) {
      const beta = gamma - THREE.MathUtils.degToRad(db);
      if (beta < THREE.MathUtils.degToRad(6) || beta > THREE.MathUtils.degToRad(66)) { why.beta++; continue; }
      const tb = Math.tan(beta);
      let maxImp = 0, uLo = Infinity, uHi = -Infinity, ok = true;
      for (const tr of fam) {
        const c = crossFrom(tr, uS - back, uS, hS, tb);
        if (!c) { ok = false; why.cross++; break; }
        const nx = Math.sin(beta), ny = Math.cos(beta); // surface normal (u,y)
        const imp = -(c.vx * nx + c.vy * ny);
        maxImp = Math.max(maxImp, imp);
        uLo = Math.min(uLo, c.u); uHi = Math.max(uHi, c.u);
      }
      if (!ok) continue;
      const hEnd = lineY(uHi + 10, uS, hS, tb);
      const Rt = Math.min(70, hEnd / (1 - Math.cos(beta)));
      if (Rt < 14) { why.rt++; continue; }
      why.ok++;
      const cost = maxImp + 0.015 * hS;
      if (!best || cost < best.cost) best = { cost, uS, hS, beta, uLo, uHi, Rt, imp: maxImp };
    }
  }
  if (!best) throw new Error('hill design failed ' + JSON.stringify(why) + ' hMax ' + hMax.toFixed(1));
  const { uS, hS, beta, uLo, uHi, Rt } = best;
  const tb = Math.tan(beta);
  const uTop = uLo - 14;
  const yTop = lineY(uTop, uS, hS, tb);
  const uF = uTop - 6 - yTop / 2.75;
  const hB = Rt * (1 - Math.cos(beta));
  const uBot = uS + (hS - hB) / tb;
  const pts: [number, number][] = [[uF, 0], [uTop - 6, yTop], [uTop, yTop], [uBot, hB]];
  pts.push(...transitionPts(uBot, beta, Rt).slice(1));
  pts.push([pts[pts.length - 1][0] + 1, 0]);
  const hill = makeHill('hill', origin, dir, pts, uS, Math.max(9, (uHi - uLo) * 0.4), [uLo, uHi], 12);
  (hill as any).designImpact = best.imp;
  return hill;
}

function designDeck(lo: Traj, mid: Traj, hi: Traj, origin: THREE.Vector3, dir: THREE.Vector2): Hill {
  const apexLo = lo.y[lo.apexI];
  const hD = Math.max(6, apexLo - 4);
  const uAsc = crossAsc(lo, hD + 2.5) ?? lo.u[lo.apexI] * 0.5;
  const uA = uAsc + 4;
  const uMidCross = crossDesc(mid, hD) ?? lo.u[lo.apexI] + 30;
  const uB = Math.max(uMidCross + 10, (crossDesc(hi, hD) ?? uMidCross) + 22);
  const beta = THREE.MathUtils.degToRad(32);
  const Rt = 34;
  const hB = Rt * (1 - Math.cos(beta));
  const uBot = uB + (hD - hB) / Math.tan(beta);
  const front = THREE.MathUtils.degToRad(38);
  const uF = uA - hD / Math.tan(front);
  const pts: [number, number][] = [[uF, 0], [uA, hD], [uB, hD]];
  pts.push(...transitionPts(uBot, beta, Rt));
  pts.push([pts[pts.length - 1][0] + 1, 0]);
  const uHi = crossDesc(hi, hD) ?? uB;
  return makeHill('deck', origin, dir, pts, uMidCross, 12, [crossDesc(lo, hD) ?? uA, uHi], 13);
}

const cache = new Map<number, BuiltLevel>();

export function buildLevel(def: LevelDef): BuiltLevel {
  const hit = cache.get(def.id);
  if (hit) return hit;
  const track = new Track(def.segments);
  const terrain = new Terrain();
  const startS = 8;
  // design run: full throttle
  const sim = new CarSim(track, terrain, startS);
  const inp = emptyInput();
  inp.throttle = 1;
  const dt = 1 / 240;
  for (let i = 0; i < 240 * 40 && sim.phase === 'rail'; i++) sim.step(dt, inp);
  if (sim.lostGrip) throw new Error(`Level ${def.id}: design run lost grip`);
  const exitPos = sim.pos.clone();
  const exitVel = sim.vel.clone();
  const maxExitSpeed = sim.exitSpeed;
  const dir = new THREE.Vector2(exitVel.x, exitVel.z);
  if (dir.lengthSq() < 1e-4) dir.set(1, 0);
  dir.normalize();
  const origin = new THREE.Vector3(exitPos.x, 0, exitPos.z);
  const w = def.window ?? (def.landing === 'deck' ? [0.9, 0.99, 1.04] : [0.9, 1.0, 1.12]);
  const trajs = w.map((f) => ballistic(exitPos, exitVel.clone().multiplyScalar(f), dir, origin));
  // steep, fast launches spread out a lot: narrow the speed window until a hill fits
  let hill: Hill | null = null;
  if (def.landing === 'deck') hill = designDeck(trajs[0], trajs[1], trajs[2], origin, dir);
  else {
    let lo = w[0], hi = w[2];
    for (let k = 0; k < 6 && !hill; k++) {
      try { hill = designHill(lo, hi, exitPos, exitVel, origin, dir); }
      catch (e) { lo = 1 - (1 - lo) * 0.7; hi = 1 + (hi - 1) * 0.7; if (k === 5) throw e; }
    }
  }
  if (!hill) throw new Error('no hill');
  terrain.hills.push(hill);
  const bounds = track.bounds();
  bounds.expandByPoint(new THREE.Vector3(hill.bbox.min.x, 0, hill.bbox.min.y));
  bounds.expandByPoint(new THREE.Vector3(hill.bbox.max.x, 0, hill.bbox.max.y));
  const built: BuiltLevel = {
    def, track, terrain, hill, startS, maxExitSpeed, exitPos, exitVel,
    designTraj: trajs.map((t) => t.pts), bounds,
  };
  cache.set(def.id, built);
  return built;
}
