import * as THREE from 'three';

/**
 * Landing structures are heightfields so collision is continuous and robust:
 * a 1D profile h(u) along a heading, a flat top of half-width `halfWidth`,
 * and steep side banks.
 */
export interface Hill {
  kind: 'hill' | 'deck';
  origin: THREE.Vector3; // u = 0 here (on the ground)
  dir: THREE.Vector2; // heading in xz
  halfWidth: number;
  sideSlope: number; // rise per metre outside the top
  du: number;
  u0: number;
  h: Float32Array; // profile samples starting at u0
  /** landing target along u, and zone half length */
  targetU: number;
  zoneHalf: number;
  /** min/max u of the designed landing window */
  windowU: [number, number];
  bbox: THREE.Box2;
}

export function makeHill(
  kind: Hill['kind'],
  origin: THREE.Vector3,
  dir: THREE.Vector2,
  pts: [number, number][],
  target: number,
  zoneHalf: number,
  windowU: [number, number],
  halfWidth = 10,
): Hill {
  const du = 0.5;
  const u0 = pts[0][0];
  const u1 = pts[pts.length - 1][0];
  const n = Math.ceil((u1 - u0) / du) + 1;
  const h = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const u = u0 + i * du;
    while (j < pts.length - 2 && pts[j + 1][0] < u) j++;
    const [ua, ha] = pts[j];
    const [ub, hb] = pts[j + 1];
    const t = Math.min(1, Math.max(0, (u - ua) / (ub - ua || 1)));
    h[i] = Math.max(0, ha + (hb - ha) * t);
  }
  let maxH = 0;
  for (const v of h) maxH = Math.max(maxH, v);
  const sideSlope = 4;
  const reach = halfWidth + maxH / sideSlope + 1;
  const bbox = new THREE.Box2();
  const perp = new THREE.Vector2(-dir.y, dir.x);
  for (const uu of [u0, u1])
    for (const vv of [-reach, reach]) {
      bbox.expandByPoint(
        new THREE.Vector2(origin.x + dir.x * uu + perp.x * vv, origin.z + dir.y * uu + perp.y * vv),
      );
    }
  return { kind, origin, dir, halfWidth, sideSlope, du, u0, h, targetU: target, zoneHalf, windowU, bbox };
}

export function hillProfile(hill: Hill, u: number) {
  const f = (u - hill.u0) / hill.du;
  if (f <= 0 || f >= hill.h.length - 1) return 0;
  const i = Math.floor(f);
  const t = f - i;
  return hill.h[i] * (1 - t) + hill.h[i + 1] * t;
}

export function hillLocal(hill: Hill, x: number, z: number) {
  const dx = x - hill.origin.x, dz = z - hill.origin.z;
  const u = dx * hill.dir.x + dz * hill.dir.y;
  const v = -dx * hill.dir.y + dz * hill.dir.x;
  return { u, v };
}

export function hillHeight(hill: Hill, x: number, z: number) {
  if (x < hill.bbox.min.x || x > hill.bbox.max.x || z < hill.bbox.min.y || z > hill.bbox.max.y) return 0;
  const { u, v } = hillLocal(hill, x, z);
  const ph = hillProfile(hill, u);
  if (ph <= 0) return 0;
  const ex = Math.abs(v) - hill.halfWidth;
  if (ex <= 0) return ph;
  return Math.max(0, ph - ex * hill.sideSlope);
}

export class Terrain {
  hills: Hill[] = [];

  height(x: number, z: number) {
    let h = 0;
    for (const hill of this.hills) {
      const v = hillHeight(hill, x, z);
      if (v > h) h = v;
    }
    return h;
  }

  normal(x: number, z: number, out = new THREE.Vector3()) {
    const e = 0.15;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  }

  /** Raycast against the heightfield. Returns distance or -1. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxT: number): number {
    const f = (t: number) => o.y + d.y * t - this.height(o.x + d.x * t, o.z + d.z * t);
    let a = 0;
    let fa = f(0);
    if (fa <= 0) return 0;
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const b = (maxT * i) / steps;
      const fb = f(b);
      if (fb <= 0) {
        let lo = a, hi = b;
        for (let k = 0; k < 10; k++) {
          const m = (lo + hi) / 2;
          if (f(m) > 0) lo = m; else hi = m;
        }
        return (lo + hi) / 2;
      }
      a = b;
      fa = fb;
    }
    return -1;
  }

  /** Vertical penetration of a point into the terrain, projected on the normal. */
  penetration(p: THREE.Vector3, nOut: THREE.Vector3): number {
    const h = this.height(p.x, p.z);
    const dv = h - p.y;
    if (dv <= 0) return 0;
    this.normal(p.x, p.z, nOut);
    return dv * nOut.y;
  }

  hillAt(x: number, z: number): Hill | null {
    for (const hill of this.hills) if (hillHeight(hill, x, z) > 0.01) return hill;
    return null;
  }
}
