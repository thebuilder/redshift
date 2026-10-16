import * as THREE from 'three';
import { Terrain } from '../physics/Terrain';

/**
 * Simulated smoke.
 *
 * Every puff is a particle advected through a divergence-free curl-noise
 * velocity field (so it swirls and curls instead of drifting in straight lines),
 * with buoyancy that decays as the smoke cools, ground collision that turns
 * downward momentum into sideways spreading, entrainment in the car's wake and
 * the air blasts, and growth/thinning as it diffuses. Each puff is lit on the
 * CPU from the scene's lights, sorted back to front and drawn as soft,
 * self-shaded billboards.
 */

export interface SmokeLight {
  pos: THREE.Vector3;
  color: THREE.Color; // pre-multiplied by intensity
  range: number;
  dir?: THREE.Vector3; // spot direction
  cos?: number; // spot cone cosine
  /** spot lights: fade the light in over this distance from the source */
  near?: number;
}

export interface SmokeEmit {
  size?: number;
  grow?: number;
  life?: number;
  alpha?: number;
  heat?: number; // initial buoyancy (m/s^2)
  drag?: number; // relaxation rate towards the ambient flow
  albedo?: number;
  turb?: number;
  /** minimum brightness (self-lit vapour) */
  glow?: number;
}

export interface SmokeContext {
  time: number;
  camera: THREE.Camera;
  terrain: Terrain;
  carPos: THREE.Vector3;
  carVel: THREE.Vector3;
  jets: { pos: THREE.Vector3; dir: THREE.Vector3; force: number }[];
  dynLights: SmokeLight[];
}

function smokeAtlas(): THREE.Texture {
  const S = 256, C = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(S, S);
  // value noise
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const G = 64;
  const grid = new Float32Array(G * G).map(() => rnd());
  const vn = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const s = (t: number) => t * t * (3 - 2 * t);
    const a = grid[((yi & 63) * G + (xi & 63))], b = grid[((yi & 63) * G + ((xi + 1) & 63))];
    const c = grid[(((yi + 1) & 63) * G + (xi & 63))], d = grid[(((yi + 1) & 63) * G + ((xi + 1) & 63))];
    const u = s(xf), v = s(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x: number, y: number) => {
    let f = 0, amp = 0.5, fr = 1;
    for (let o = 0; o < 5; o++) { f += vn(x * fr, y * fr) * amp; amp *= 0.5; fr *= 2.03; }
    return f;
  };
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * C, oy = Math.floor(cell / 2) * C;
    const off = cell * 17.3;
    // cauliflower puff: union of lobes, each lit from above
    const lobes: [number, number, number][] = [[0, 0.08, 0.5]];
    const nl = 6 + cell;
    for (let l = 0; l < nl; l++) {
      const a = rnd() * Math.PI * 2, d = 0.22 + rnd() * 0.3;
      lobes.push([Math.cos(a) * d, Math.sin(a) * d * 0.85, 0.2 + rnd() * 0.22]);
    }
    for (let y = 0; y < C; y++)
      for (let x = 0; x < C; x++) {
        const px = (x - C / 2) / (C / 2), py = (y - C / 2) / (C / 2);
        const n = fbm(x / 13 + off, y / 13 + off * 0.7);
        const n2 = fbm(x / 5 + off * 1.3, y / 5);
        let dens = 0, light = 0;
        for (const [lx, ly, lr] of lobes) {
          const dx = (px - lx) / lr, dy = (py - ly) / lr;
          const r = Math.sqrt(dx * dx + dy * dy) + (n - 0.5) * 0.5;
          const dl = Math.max(0, 1 - r);
          const dd = dl * dl * (3 - 2 * dl);
          if (dd > dens * 0.9) {
            // top-lit lobe: bright crown, darker belly
            const lit = 0.5 + 0.5 * Math.max(-1, Math.min(1, -dy * 0.8)) * Math.sqrt(Math.max(0, 1 - Math.min(1, r)));
            light = dd > dens ? lit : (light + lit) * 0.5;
          }
          dens = Math.max(dens, dd);
        }
        const rr = Math.sqrt(px * px + py * py);
        dens *= Math.max(0, 1 - Math.pow(rr / 1.0, 6)) * (0.65 + 0.5 * n2);
        const L = Math.max(0, Math.min(1, 0.42 + 0.58 * light + 0.18 * (n2 - 0.5))) * 255;
        const i = ((oy + y) * S + (ox + x)) * 4;
        img.data[i] = L; img.data[i + 1] = L; img.data[i + 2] = L;
        img.data[i + 3] = Math.max(0, Math.min(1, dens * 1.15)) * 255;
      }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const tmp = new THREE.Vector3();

export class Smoke {
  points: THREE.Points;
  private N: number;
  private P: Float32Array; private V: Float32Array;
  private age: Float32Array; private life: Float32Array;
  private s0: Float32Array; private grow: Float32Array;
  private a0: Float32Array; private heat: Float32Array; private drag: Float32Array;
  private albedo: Float32Array; private glow: Float32Array; private turb: Float32Array; private seed: Float32Array;
  private rot: Float32Array; private rotV: Float32Array; private frame: Float32Array;
  private rPos: Float32Array; private rCol: Float32Array; private rSize: Float32Array; private rAlpha: Float32Array; private rRot: Float32Array; private rFrame: Float32Array;
  private order: Uint32Array; private depth: Float32Array; private alive: Uint32Array;
  private geo: THREE.BufferGeometry;
  private head = 0;
  lights: SmokeLight[] = [];
  ambient = new THREE.Color(0.16, 0.15, 0.17);
  moonDir = new THREE.Vector3(-0.4, 0.8, 0.45).normalize();
  moonColor = new THREE.Color(0.5, 0.52, 0.6);
  wind = new THREE.Vector3(0.7, 0, 0.35);

  constructor(n = 2600) {
    this.N = n;
    const f = () => new Float32Array(n);
    this.P = new Float32Array(n * 3); this.V = new Float32Array(n * 3);
    this.age = f(); this.life = f(); this.s0 = f(); this.grow = f(); this.a0 = f(); this.heat = f(); this.drag = f();
    this.albedo = f(); this.glow = f(); this.turb = f(); this.seed = f(); this.rot = f(); this.rotV = f(); this.frame = f();
    this.rPos = new Float32Array(n * 3); this.rCol = new Float32Array(n * 3); this.rSize = f(); this.rAlpha = f(); this.rRot = f(); this.rFrame = f();
    this.order = new Uint32Array(n); this.depth = f(); this.alive = new Uint32Array(n);
    const g = new THREE.BufferGeometry();
    const dyn = (arr: Float32Array, k: number) => new THREE.BufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', dyn(this.rPos, 3));
    g.setAttribute('color', dyn(this.rCol, 3));
    g.setAttribute('size', dyn(this.rSize, 1));
    g.setAttribute('alpha', dyn(this.rAlpha, 1));
    g.setAttribute('rot', dyn(this.rRot, 1));
    g.setAttribute('frame', dyn(this.rFrame, 1));
    g.setIndex(new THREE.BufferAttribute(this.order, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { map: { value: smokeAtlas() }, uScale: { value: 600 }, uFog: { value: new THREE.Color(0x030203) }, uFogD: { value: 0.0021 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color; attribute float rot; attribute float frame;
        uniform float uScale; uniform float uFogD;
        varying float vA; varying vec3 vC; varying float vR; varying vec2 vOff; varying float vFog;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = -mv.z;
          // pull the billboard toward the camera so it doesn't slice through the ground
          mv.xyz += normalize(-mv.xyz) * min(size * 0.38, d * 0.5);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(size * uScale / max(0.3, -mv.z), 700.0);
          float near = smoothstep(1.2, 6.0, d); // smoke thins out right in front of the lens so it never blinds the camera
          vA = alpha * near; vC = color; vR = rot;
          vOff = vec2(mod(frame, 2.0), floor(frame / 2.0)) * 0.5;
          float f = d * uFogD; vFog = 1.0 - exp(-f * f);
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 uFog;
        varying float vA; varying vec3 vC; varying float vR; varying vec2 vOff; varying float vFog;
        void main(){
          vec2 p = gl_PointCoord - 0.5;
          float c = cos(vR), s = sin(vR);
          p = mat2(c, -s, s, c) * p * 0.98 + 0.5;
          vec4 t = texture2D(map, vOff + clamp(p, 0.03, 0.97) * 0.5);
          // round mask: however bright a puff is lit, its billboard never shows a square edge
          float rr = length(gl_PointCoord - 0.5);
          float a = t.a * vA * smoothstep(0.5, 0.36, rr);
          if (a < 0.004) discard;
          vec3 col = mix(vC * t.rgb, uFog, vFog);
          gl_FragColor = vec4(col, a * (1.0 - vFog * 0.6));
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  setViewport(heightPx: number, fovDeg: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  clear() { this.life.fill(0); this.age.fill(0); this.geo.setDrawRange(0, 0); }

  emit(p: THREE.Vector3, v: THREE.Vector3, o: SmokeEmit = {}) {
    const i = this.head;
    this.head = (this.head + 1) % this.N;
    this.P[i * 3] = p.x; this.P[i * 3 + 1] = p.y; this.P[i * 3 + 2] = p.z;
    this.V[i * 3] = v.x; this.V[i * 3 + 1] = v.y; this.V[i * 3 + 2] = v.z;
    this.age[i] = 0;
    this.life[i] = o.life ?? 5;
    this.s0[i] = o.size ?? 1.5;
    this.grow[i] = o.grow ?? 3;
    this.a0[i] = o.alpha ?? 0.4;
    this.heat[i] = o.heat ?? 0.8;
    this.drag[i] = o.drag ?? 1.6;
    this.albedo[i] = (o.albedo ?? 0.95) * (0.82 + Math.random() * 0.3);
    this.turb[i] = o.turb ?? 1;
    this.glow[i] = o.glow ?? 0;
    this.seed[i] = Math.random() * 100;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.rotV[i] = (Math.random() - 0.5) * 0.6;
    this.frame[i] = Math.floor(Math.random() * 4);
  }

  /** curl of a cheap analytic vector potential -> divergence-free swirling flow */
  private curl(x: number, y: number, z: number, t: number, out: THREE.Vector3) {
    let cx = 0, cy = 0, cz = 0;
    let amp = 1, f = 0.09;
    for (let o = 0; o < 2; o++) {
      const a = f, b = f * 1.31, c = f * 0.87, d = f * 1.17, e = f * 1.07, g = f * 0.93;
      const w = 0.35 * (o + 1);
      const sx = Math.sin(a * y + w * t + o * 3.1), cxz = Math.cos(b * z), sxz = Math.sin(b * z), cxy = Math.cos(a * y + w * t + o * 3.1);
      const sy = Math.sin(c * z + w * t + o * 1.7), cyx = Math.cos(d * x), syx = Math.sin(d * x), cyz = Math.cos(c * z + w * t + o * 1.7);
      const sz = Math.sin(e * x + w * t + o * 2.3), czy = Math.cos(g * y), szy = Math.sin(g * y), czx = Math.cos(e * x + w * t + o * 2.3);
      // psi = (sx*cxz, sy*cyx, sz*czy)
      const dPzdy = -g * sz * szy, dPydz = c * cyz * cyx;
      const dPxdz = -b * sx * sxz, dPzdx = e * czx * czy;
      const dPydx = -d * sy * syx, dPxdy = a * cxy * cxz;
      cx += amp * (dPzdy - dPydz) / f;
      cy += amp * (dPxdz - dPzdx) / f;
      cz += amp * (dPydx - dPxdy) / f;
      amp *= 0.55; f *= 2.4;
    }
    return out.set(cx, cy, cz);
  }

  update(dt: number, ctx: SmokeContext) {
    if (dt <= 0) return;
    const { P, V } = this;
    const cam = ctx.camera;
    const camPos = cam.position;
    const camFwd = tmp.set(0, 0, -1).applyQuaternion(cam.quaternion).clone();
    const turbV = new THREE.Vector3();
    const car = ctx.carPos, cv = ctx.carVel;
    const carSpeed = cv.length();
    const lights = this.lights.concat(ctx.dynLights);
    const L = new THREE.Vector3();
    let count = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const age = this.age[i];
      if (age >= this.life[i]) { this.life[i] = 0; continue; }
      const k = i * 3;
      let x = P[k], y = P[k + 1], z = P[k + 2];
      let vx = V[k], vy = V[k + 1], vz = V[k + 2];
      // ambient flow: wind + curl noise turbulence that grows as the plume develops
      this.curl(x + this.seed[i], y, z - this.seed[i], ctx.time, turbV);
      const ta = this.turb[i] * (0.6 + 1.8 * Math.min(1, age / 1.5));
      const tx = this.wind.x + turbV.x * ta, ty = this.wind.y + turbV.y * ta * 0.6, tz = this.wind.z + turbV.z * ta;
      const rel = 1 - Math.exp(-this.drag[i] * dt);
      vx += (tx - vx) * rel; vy += (ty - vy) * rel; vz += (tz - vz) * rel;
      // buoyancy: hot smoke rises, cools off over ~1.5 s
      vy += this.heat[i] * Math.exp(-age / 1.6) * dt;
      // car wake: entrain smoke behind and around the car, push it out of the body
      const dx = x - car.x, dy = y - car.y, dz = z - car.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 90 && carSpeed > 1) {
        const d = Math.sqrt(d2);
        // the wake only drags air behind the car, and only at a fraction of its speed;
        // smoke must never ride along with the car as a halo around it
        const behind = -(dx * cv.x + dy * cv.y + dz * cv.z) / (carSpeed * Math.max(d, 0.1));
        const fall = (1 - d / 9.5) ** 2 * Math.max(0, behind);
        const e = Math.min(1, fall * 1.6 * dt);
        vx += (cv.x * 0.45 - vx) * e; vy += (cv.y * 0.45 - vy) * e * 0.5; vz += (cv.z * 0.45 - vz) * e;
        // keep older smoke out of the body; fresh exhaust leaving a nozzle is left alone
        if (d < 2.2 && age > 0.3) {
          const push = (2.2 - d) * (6 + carSpeed * 0.15) * dt / Math.max(0.2, d);
          vx += dx * push; vy += Math.abs(dy) * push * 0.5; vz += dz * push;
        }
      }
      // air blasts blow the smoke around
      for (const j of ctx.jets) {
        const jx = x - j.pos.x, jy = y - j.pos.y, jz = z - j.pos.z;
        const along = jx * j.dir.x + jy * j.dir.y + jz * j.dir.z;
        if (along < -0.5 || along > 14) continue;
        const rx = jx - j.dir.x * along, ry = jy - j.dir.y * along, rz = jz - j.dir.z * along;
        const rad = Math.sqrt(rx * rx + ry * ry + rz * rz);
        const cone = 0.6 + Math.max(0, along) * 0.35;
        if (rad > cone * 1.6) continue;
        const s = (j.force / 7000) * 60 * dt * (1 - rad / (cone * 1.6)) / (1 + along * 0.25);
        vx += j.dir.x * s + (rx / (rad + 0.1)) * s * 0.4;
        vy += j.dir.y * s + (ry / (rad + 0.1)) * s * 0.4;
        vz += j.dir.z * s + (rz / (rad + 0.1)) * s * 0.4;
      }
      x += vx * dt; y += vy * dt; z += vz * dt;
      // ground: slide and spread instead of sinking
      const size = this.s0[i] + this.grow[i] * Math.sqrt(age);
      const h = ctx.terrain.height(x, z);
      const floor = h + size * 0.22;
      if (y < floor) {
        y = floor;
        if (vy < 0) {
          const hs = Math.hypot(vx, vz);
          const spread = -vy * 0.75;
          if (hs > 0.01) { vx += (vx / hs) * spread; vz += (vz / hs) * spread; }
          else { const a = this.seed[i]; vx += Math.cos(a) * spread; vz += Math.sin(a) * spread; }
          vy *= -0.08;
        }
        // drag along the ground
        const gd = Math.exp(-0.9 * dt);
        vx *= gd; vz *= gd;
      }
      P[k] = x; P[k + 1] = y; P[k + 2] = z;
      V[k] = vx; V[k + 1] = vy; V[k + 2] = vz;
      this.rot[i] += this.rotV[i] * dt;

      // opacity: fade in fast, thin out as it expands, fade at end of life
      const t = age / this.life[i];
      const fin = Math.min(1, age / 0.12);
      const thin = Math.pow(this.s0[i] / size, 0.55);
      const alpha = this.a0[i] * fin * thin * Math.pow(1 - t, 1.3);

      // lighting
      const alb = this.albedo[i];
      let r = this.ambient.r, g = this.ambient.g, b = this.ambient.b;
      const toCamx = camPos.x - x, toCamy = camPos.y - y, toCamz = camPos.z - z;
      const tcl = Math.hypot(toCamx, toCamy, toCamz) || 1;
      // moon with forward scattering
      const md = -(this.moonDir.x * toCamx + this.moonDir.y * toCamy + this.moonDir.z * toCamz) / tcl;
      const phase = 0.55 + 0.9 * Math.pow(Math.max(0, md), 6);
      r += this.moonColor.r * phase; g += this.moonColor.g * phase; b += this.moonColor.b * phase;
      for (const l of lights) {
        L.set(l.pos.x - x, l.pos.y - y, l.pos.z - z);
        const dl2 = L.lengthSq();
        const rr = l.range * l.range;
        if (dl2 > rr * 6) continue;
        let att = 1 / (1 + (dl2 / rr) * 3);
        if (l.dir) {
          const dl = Math.sqrt(dl2) || 1;
          const c = -(L.x * l.dir.x + L.y * l.dir.y + L.z * l.dir.z) / dl;
          const cone = Math.min(1, Math.max(0, (c - l.cos!) / (1 - l.cos!) * 3));
          att *= cone * cone;
          // looking into the beam through the smoke
          const sc = (L.x * toCamx + L.y * toCamy + L.z * toCamz) / (dl * tcl);
          att *= 0.6 + 0.8 * Math.max(0, -sc);
          // no hot spot right at the lamp: the beam builds up over the first couple of metres
          if (l.near) att *= Math.min(1, dl / l.near) ** 2;
        }
        r += l.color.r * att; g += l.color.g * att; b += l.color.b * att;
      }
      this.rPos[count * 3] = x; this.rPos[count * 3 + 1] = y; this.rPos[count * 3 + 2] = z;
      const gl = this.glow[i];
      this.rCol[count * 3] = Math.max(r * alb, gl); this.rCol[count * 3 + 1] = Math.max(g * alb, gl); this.rCol[count * 3 + 2] = Math.max(b * alb, gl * 1.05);
      this.rSize[count] = size;
      this.rAlpha[count] = alpha;
      this.rRot[count] = this.rot[i];
      this.rFrame[count] = this.frame[i];
      this.depth[count] = (x - camPos.x) * camFwd.x + (y - camPos.y) * camFwd.y + (z - camPos.z) * camFwd.z;
      this.alive[count] = count;
      count++;
    }
    // back-to-front
    const idx = Array.from(this.alive.subarray(0, count));
    const dep = this.depth;
    idx.sort((a, b) => dep[b] - dep[a]);
    for (let i = 0; i < count; i++) this.order[i] = idx[i];
    this.geo.setDrawRange(0, count);
    for (const n of ['position', 'color', 'size', 'alpha', 'rot', 'frame']) (this.geo.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
    this.geo.getIndex()!.needsUpdate = true;
  }

  get activeCount() { return this.geo.drawRange.count; }
}
