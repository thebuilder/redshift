import * as THREE from 'three';
import { Track, TRACK_HALF_WIDTH, TRACK_THICKNESS } from '../physics/Track';

export const NEON_RED = new THREE.Color(1, 0.035, 0.06);

export function neonMaterial(intensity = 6, color = NEON_RED) {
  return new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(intensity), fog: true });
}

/** Sweep a rectangle (in the track's lateral/up plane) along the track samples */
function sweep(track: Track, idx: number[], z0: number, z1: number, y0: number, y1: number, faces: ('top' | 'bottom' | 'in' | 'out')[], lift = 0.02) {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const corners: Record<string, [number, number, number, number, number, number]> = {
    // [zA,yA,zB,yB, nz, ny]
    top: [z0, y1, z1, y1, 0, 1],
    bottom: [z1, y0, z0, y0, 0, -1],
    in: [z0, y0, z0, y1, -1, 0],
    out: [z1, y1, z1, y0, 1, 0],
  };
  const P = new THREE.Vector3();
  for (const f of faces) {
    const [za, ya, zb, yb, nz, ny] = corners[f];
    const base = pos.length / 3;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const p = track.pos[i], U = track.U[i], R = track.R[i];
      for (const [z, y] of [[za, ya], [zb, yb]]) {
        P.copy(p).addScaledVector(R, z).addScaledVector(U, y + lift);
        pos.push(P.x, P.y, P.z);
        const n = new THREE.Vector3().addScaledVector(R, nz).addScaledVector(U, ny).normalize();
        nor.push(n.x, n.y, n.z);
      }
      const v = track.S[i] / 20;
      uv.push((za + TRACK_HALF_WIDTH) / (2 * TRACK_HALF_WIDTH), v, (zb + TRACK_HALF_WIDTH) / (2 * TRACK_HALF_WIDTH), v);
      if (k > 0) {
        const a = base + (k - 1) * 2, b = a + 1, c = a + 2, d = a + 3;
        index.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

function fixWinding(g: THREE.BufferGeometry) {
  // ensure triangle winding agrees with stored normals
  const idx = g.getIndex()!;
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
  const arr = idx.array as Uint32Array | Uint16Array;
  for (let t = 0; t < arr.length; t += 3) {
    a.fromBufferAttribute(p, arr[t]); b.fromBufferAttribute(p, arr[t + 1]); c.fromBufferAttribute(p, arr[t + 2]);
    nn.fromBufferAttribute(n, arr[t]);
    const fn = b.sub(a).cross(c.sub(a));
    if (fn.dot(nn) < 0) { const tmp = arr[t + 1]; arr[t + 1] = arr[t + 2]; arr[t + 2] = tmp; }
  }
  idx.needsUpdate = true;
}

export interface TrackVisual {
  group: THREE.Group;
}

/** `flight`: the design flight paths off the lip; no support may stand in them */
export function buildTrackVisual(track: Track, concrete: THREE.Texture, flight: THREE.Vector3[][] = []): TrackVisual {
  const group = new THREE.Group();
  const idx: number[] = [];
  for (let i = 0; i < track.pos.length; i += 2) idx.push(i);
  if (idx[idx.length - 1] !== track.pos.length - 1) idx.push(track.pos.length - 1);
  const HW = TRACK_HALF_WIDTH;

  const surfMat = new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const surf = sweep(track, idx, -HW, HW, 0, 0, ['top']);
  fixWinding(surf);
  const surface = new THREE.Mesh(surf, surfMat);
  surface.receiveShadow = true;
  group.add(surface);

  const structMat = new THREE.MeshStandardMaterial({ color: 0x55575c, roughness: 0.7, metalness: 0.3, envMapIntensity: 0.4 });
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.7, envMapIntensity: 0.35 });
  for (const s of [-1, 1]) {
    const zIn = s * HW, zOut = s * (HW + 0.35);
    const g = sweep(track, idx, Math.min(zIn, zOut), Math.max(zIn, zOut), 0, 0.32, s < 0 ? ['top', 'out', 'in'] : ['top', 'in', 'out']);
    fixWinding(g);
    const m = new THREE.Mesh(g, curbMat);
    m.receiveShadow = true;
    group.add(m);
  }
  const under = sweep(track, idx, -HW - 0.35, HW + 0.35, -TRACK_THICKNESS, 0, ['bottom', 'in', 'out']);
  fixWinding(under);
  group.add(new THREE.Mesh(under, structMat));

  // neon: on the curb tops, and along the underside edges
  const neon = neonMaterial(2.6);
  for (const s of [-1, 1]) {
    const z = s * (HW + 0.04);
    const g = sweep(track, idx, z - 0.05, z + 0.05, 0.32, 0.37, ['top', 'in', 'out']);
    fixWinding(g);
    group.add(new THREE.Mesh(g, neon));
    const z2 = s * (HW + 0.37);
    const g2 = sweep(track, idx, z2 - 0.04, z2 + 0.04, -TRACK_THICKNESS + 0.05, -TRACK_THICKNESS + 0.15, ['out', 'in', 'bottom']);
    fixWinding(g2);
    group.add(new THREE.Mesh(g2, neonMaterial(1.6)));
  }

  group.add(buildSupports(track, flight));
  return { group };
}

// ------------------------------------------------------------ supports
function buildSupports(track: Track, flight: THREE.Vector3[][]) {
  // the car's flight corridor: points along the design trajectories (skipping the first few
  // metres at the lip, where the supports legitimately sit right next to the car)
  const corridor: THREE.Vector3[] = [];
  for (const tr of flight) for (let i = 6; i < tr.length; i += 3) corridor.push(tr[i]);
  const FLY_R = 7;
  const inFlight = (p: THREE.Vector3) => {
    for (const c of corridor) if (c.distanceToSquared(p) < FLY_R * FLY_R) return true;
    return false;
  };
  const beams: { a: THREE.Vector3; b: THREE.Vector3; t: number }[] = [];
  const lamps: THREE.Vector3[] = [];
  // reject any member that would pass through (or sit under) another part of the track,
  // so loops never get columns running through their insides
  const tmpP = new THREE.Vector3();
  const rel = new THREE.Vector3();
  // every track sample in a 3x3 cell neighbourhood is tested, not just the nearest
  // one: a column dropping from an overhang must not pass through the road below
  const cell = 8;
  const cells = new Map<string, number[]>();
  for (let i = 0; i < track.pos.length; i += 2) {
    const k = `${Math.floor(track.pos[i].x / cell)},${Math.floor(track.pos[i].z / cell)}`;
    let a = cells.get(k);
    if (!a) cells.set(k, (a = []));
    a.push(i);
  }
  const hitsRoad = (p: THREE.Vector3, src: number) => {
    const cx = Math.floor(p.x / cell), cz = Math.floor(p.z / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const arr = cells.get(`${cx + dx},${cz + dz}`);
        if (!arr) continue;
        for (const i of arr) {
          rel.copy(p).sub(track.pos[i]);
          if (Math.abs(rel.dot(track.T[i])) > 0.6) continue;
          const lat = Math.abs(rel.dot(track.R[i]));
          const h = rel.dot(track.U[i]);
          if (src >= 0 && Math.abs(i - src) < 40) {
            // the column's own stretch of road: it may hang from the underside, but it
            // must never cut up through the slab (twisted, steeply banked sections)
            if (lat < TRACK_HALF_WIDTH + 0.4 && h > -TRACK_THICKNESS + 0.08 && h < 2.6) return true;
            continue;
          }
          if (lat > TRACK_HALF_WIDTH + 1.4) continue;
          if (h > -TRACK_THICKNESS - 1.6 && h < 2.6) return true;
        }
      }
    return false;
  };
  const blocked = (a: THREE.Vector3, b: THREE.Vector3, src: number) => {
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.ceil(len / 0.5));
    for (let k = 0; k <= n; k++) {
      tmpP.copy(a).lerp(b, k / n);
      if (track.insideLoop(tmpP)) return true;
      if (hitsRoad(tmpP, src)) return true;
      if (corridor.length && inFlight(tmpP)) return true;
    }
    return false;
  };
  let curSrc = -1;
  const add = (a: THREE.Vector3, b: THREE.Vector3, t = 0.32) => {
    if (a.distanceTo(b) <= 0.3) return false;
    if (blocked(a, b, curSrc)) return false;
    beams.push({ a: a.clone(), b: b.clone(), t });
    return true;
  };
  const step = 16; // samples (~4 m)
  type Col = { top: THREE.Vector3; bot: THREE.Vector3; hang: boolean };
  const left: (Col | null)[] = [];
  const right: (Col | null)[] = [];
  let maxY = 0;
  for (const p of track.pos) maxY = Math.max(maxY, p.y);

  // group inverted runs for gantries
  const inv: number[][] = [];
  let cur: number[] | null = null;
  for (let i = 0; i < track.pos.length; i += step) {
    const U = track.U[i];
    const p = track.pos[i];
    const elevated = p.y > 1.2;
    const cols: (Col | null)[] = [null, null];
    if (elevated) {
      // on banked and twisted stretches an edge column would cut through the tilted
      // slab, so a single column drops from the middle of the underside instead
      const banked = Math.abs(track.R[i].y) > 0.25;
      (banked ? [0] : [-1, 1]).forEach((s, k) => {
        const e = p.clone().addScaledVector(track.R[i], s * (TRACK_HALF_WIDTH - 0.6)).addScaledVector(U, -TRACK_THICKNESS);
        if (U.y > -0.2) {
          if (e.y > 0.4) cols[k] = { top: e, bot: new THREE.Vector3(e.x, 0, e.z), hang: false };
        } else {
          cols[k] = { top: e, bot: e.clone(), hang: true };
        }
      });
      if (U.y <= -0.2) {
        if (!cur) { cur = []; inv.push(cur); }
        cur.push(i);
      } else cur = null;
    } else cur = null;
    left.push(cols[0]);
    right.push(cols[1]);
  }

  // gantries for inverted sections
  const hangTop = new Map<number, number>();
  for (const run of inv) {
    let top = 0;
    for (const i of run) top = Math.max(top, track.pos[i].y);
    top += 7;
    for (const i of run) hangTop.set(i, top);
    // pylons beyond the run ends, both sides
    let iMin = run[0], iMax = run[0];
    for (const i of run) {
      if (track.pos[i].x < track.pos[iMin].x) iMin = i;
      if (track.pos[i].x > track.pos[iMax].x) iMax = i;
    }
    const minX = track.pos[iMin].x, maxX = track.pos[iMax].x;
    const pad = 8;
    for (const s of [-1, 1]) {
      // pylons stand clear of the track on both sides
      const zA = track.pos[iMin].clone().addScaledVector(track.R[iMin], s * (TRACK_HALF_WIDTH + 5)).z;
      const zB = track.pos[iMax].clone().addScaledVector(track.R[iMax], s * (TRACK_HALF_WIDTH + 5)).z;
      const ends = [new THREE.Vector3(minX - pad, top, zA), new THREE.Vector3(maxX + pad, top, zB)];
      for (const e of ends) {
        if (!add(e, new THREE.Vector3(e.x, 0, e.z), 0.7)) continue;
        lamps.push(e.clone().add(new THREE.Vector3(0, 0.6, 0)));
        // lattice on the pylon itself (two legs + zig-zag)
        const l0 = new THREE.Vector3(e.x - 0.9, 0, e.z), l1 = new THREE.Vector3(e.x + 0.9, 0, e.z);
        if (add(l0, l0.clone().setY(top), 0.3) && add(l1, l1.clone().setY(top), 0.3)) {
          for (let y = 0; y < top - 3; y += 4) {
            add(new THREE.Vector3(e.x - 0.9, y, e.z), new THREE.Vector3(e.x + 0.9, y + 4, e.z), 0.12);
          }
        }
      }
      add(ends[0], ends[1], 0.55);
      add(ends[0].clone().add(new THREE.Vector3(0, 1.6, 0)), ends[1].clone().add(new THREE.Vector3(0, 1.6, 0)), 0.3);
    }
  }

  const finishCol = (cols: (Col | null)[], k: number) => {
    const c = cols[k];
    if (!c) return;
    const i = k * step;
    curSrc = i;
    if (c.hang) {
      const top = hangTop.get(i) ?? c.top.y + 6;
      c.bot = new THREE.Vector3(c.top.x, top, c.top.z);
    }
    add(c.top, c.bot, c.hang ? 0.22 : 0.42);
  };
  for (let k = 0; k < left.length; k++) { finishCol(left, k); finishCol(right, k); }
  // bracing (only between columns that survived the clearance test)
  curSrc = -1;
  const kept = new Set(beams.map((b) => `${b.a.x.toFixed(2)},${b.a.y.toFixed(2)},${b.a.z.toFixed(2)}`));
  const alive = (c: Col | null) => !!c && kept.has(`${c.top.x.toFixed(2)},${c.top.y.toFixed(2)},${c.top.z.toFixed(2)}`);
  for (const cols of [left, right]) {
    for (let k = 0; k < cols.length - 1; k++) {
      const a = cols[k], b = cols[k + 1];
      if (!a || !b || a.hang !== b.hang || !alive(a) || !alive(b)) continue;
      const la = a.top.distanceTo(a.bot), lb = b.top.distanceTo(b.bot);
      if (la < 2 || lb < 2) continue;
      const n = Math.max(1, Math.floor(Math.min(la, lb) / 5));
      for (let j = 0; j < n; j++) {
        const t0 = j / n, t1 = (j + 1) / n;
        const a0 = a.top.clone().lerp(a.bot, t0), a1 = a.top.clone().lerp(a.bot, t1);
        const b0 = b.top.clone().lerp(b.bot, t0), b1 = b.top.clone().lerp(b.bot, t1);
        add(a0, b1, 0.12);
        add(b0, a1, 0.12);
        add(a1, b1, 0.14);
      }
    }
  }
  // lateral ties between the two sides
  for (let k = 0; k < left.length; k += 2) {
    const a = left[k], b = right[k];
    if (!a || !b || a.hang || !alive(a) || !alive(b)) continue;
    const la = a.top.distanceTo(a.bot);
    for (let y = 4; y < la; y += 7) {
      add(a.top.clone().lerp(a.bot, y / la), b.top.clone().lerp(b.bot, y / la), 0.14);
    }
  }

  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3b3e44, roughness: 0.5, metalness: 0.75, envMapIntensity: 0.6 });
  const mesh = new THREE.InstancedMesh(geo, mat, beams.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const sc = new THREE.Vector3();
  beams.forEach((bm, i) => {
    const d = bm.b.clone().sub(bm.a);
    const len = d.length();
    q.setFromUnitVectors(up, d.normalize());
    sc.set(bm.t, len, bm.t);
    m.compose(bm.a, q, sc);
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const g = new THREE.Group();
  g.add(mesh);
  // aviation lamps
  const lampMat = new THREE.MeshBasicMaterial({ color: NEON_RED.clone().multiplyScalar(4) });
  const lampGeo = new THREE.SphereGeometry(0.35, 10, 8);
  for (const l of lamps) {
    const s = new THREE.Mesh(lampGeo, lampMat);
    s.position.copy(l);
    s.userData.blink = Math.random() * 6;
    g.add(s);
  }
  return g;
}
