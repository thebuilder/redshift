import * as THREE from 'three';
import { radialTexture } from './Textures';

/**
 * CPU-simulated billboard particles (one draw call per system).
 */
export class Particles {
  points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grow: Float32Array;
  private baseAlpha: Float32Array;
  private rot: Float32Array;
  private head = 0;
  drag: number;
  gravity: number;
  buoyancy: number;
  private geo: THREE.BufferGeometry;

  constructor(n: number, opts: { additive: boolean; texture: THREE.Texture; drag?: number; gravity?: number; buoyancy?: number; soft?: boolean }) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.baseAlpha = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.drag = opts.drag ?? 1;
    this.gravity = opts.gravity ?? 0;
    this.buoyancy = opts.buoyancy ?? 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { map: { value: opts.texture }, uScale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color; attribute float rot;
        uniform float uScale; varying float vA; varying vec3 vC; varying float vR;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * uScale / max(0.5, -mv.z);
          vA = alpha; vC = color; vR = rot;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying float vA; varying vec3 vC; varying float vR;
        void main(){
          vec2 p = gl_PointCoord - 0.5;
          float c = cos(vR), s = sin(vR);
          p = mat2(c,-s,s,c) * p + 0.5;
          vec4 t = texture2D(map, p);
          gl_FragColor = vec4(vC * t.rgb, t.a * vA);
          if (gl_FragColor.a < 0.003) discard;
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = opts.additive ? 5 : 4;
  }

  setViewport(heightPx: number, fovDeg: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, size: number, life: number, color: THREE.Color, alpha = 1, grow = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i] = grow;
    this.baseAlpha[i] = alpha;
    this.alpha[i] = alpha;
    this.rot[i] = Math.random() * 6.28;
  }

  update(dt: number) {
    const k = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.gravity * dt + this.buoyancy * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05 && this.gravity > 0) { this.pos[i * 3 + 1] = 0.05; this.vel[i * 3 + 1] *= -0.35; }
      this.size[i] += this.grow[i] * dt;
      this.rot[i] += dt * 0.3;
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      this.alpha[i] = this.baseAlpha[i] * Math.max(0, fade);
      if (this.life[i] <= 0) this.alpha[i] = 0;
    }
    for (const name of ['position', 'color', 'size', 'alpha', 'rot']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}

export function createEffects(scene: THREE.Scene) {
  const jetTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64, [[0.3, 'rgba(255,255,255,0.45)']]);
  const sparkTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 32, [[0.2, 'rgba(255,255,255,0.8)']]);
  const jets = new Particles(3000, { additive: true, texture: jetTex, drag: 5 });
  const sparks = new Particles(900, { additive: true, texture: sparkTex, drag: 0.8, gravity: 9.8 });
  scene.add(jets.points, sparks.points);
  return { jets, sparks, all: [jets, sparks] };
}
