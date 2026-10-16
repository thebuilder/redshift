import * as THREE from 'three';
import { CarSim, predictTrajectory, Prediction, SPEC } from '../physics/CarSim';
import { buildBodyGeometry } from './CarModel';
import { silhouetteGeometries } from './CarAsset';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Lunar-lander style guidance: predicted ballistic arc, impact reticle aligned
 * to the landing surface and a holographic ghost showing the ideal attitude.
 */
export class Guidance {
  group = new THREE.Group();
  private dots: THREE.Points;
  private dotGeo: THREE.BufferGeometry;
  private reticle: THREE.Group;
  private ghost: THREE.LineSegments;
  private ringMat: THREE.MeshBasicMaterial;
  private ghostMat: THREE.LineBasicMaterial;
  prediction: Prediction | null = null;
  /** angle (deg) between current attitude and ideal touchdown attitude */
  alignError = 0;
  targetQuat = new THREE.Quaternion();
  timeToImpact = 0;
  impactSpeed = 0;
  enabled = true;
  private N = 240;

  constructor() {
    this.dotGeo = new THREE.BufferGeometry();
    this.dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.dotGeo.setAttribute('t', new THREE.BufferAttribute(new Float32Array(this.N), 1).setUsage(THREE.DynamicDrawUsage));
    const dm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(1, 0.15, 0.2) } },
      vertexShader: `attribute float t; varying float vT; void main(){ vT = t; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = clamp(240.0/ -mv.z, 2.0, 7.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vT; void main(){ vec2 d = gl_PointCoord-0.5; float a = smoothstep(0.5,0.15,length(d)); gl_FragColor = vec4(mix(vec3(1.0), uColor, vT)*2.0, a*(1.0-vT*0.6)); }`,
    });
    this.dots = new THREE.Points(this.dotGeo, dm);
    this.dots.frustumCulled = false;
    this.group.add(this.dots);

    this.reticle = new THREE.Group();
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(2), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.85, 48), this.ringMat);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(4.2, 4.3, 64), this.ringMat);
    this.reticle.add(ring, ring2);
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 1.6), this.ringMat);
      const a = (i * Math.PI) / 2;
      tick.position.set(Math.cos(a) * 3.6, Math.sin(a) * 3.6, 0);
      tick.rotation.z = a + Math.PI / 2;
      this.reticle.add(tick);
    }
    this.group.add(this.reticle);

    const sil = silhouetteGeometries(SPEC.comHeight);
    const edges = new THREE.EdgesGeometry(sil ? mergeGeometries(sil.map((g) => { const c = g.clone(); for (const k of Object.keys(c.attributes)) if (k !== 'position') c.deleteAttribute(k); return c; })) : buildBodyGeometry(), 28);
    this.ghostMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(1.6), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ghost = new THREE.LineSegments(edges, this.ghostMat);
    this.group.add(this.ghost);
    this.group.visible = false;
  }

  update(sim: CarSim, t: number) {
    const show = this.enabled && sim.phase === 'air';
    this.group.visible = show;
    if (sim.phase !== 'air') { this.prediction = null; return; }
    const pred = predictTrajectory(sim.pos, sim.vel, sim.terrain, 14, 0.05);
    this.prediction = pred;
    this.timeToImpact = pred.time;
    const n = pred.normal;
    this.impactSpeed = -pred.vel.dot(n);
    // ideal attitude at impact
    const vPlane = pred.vel.clone().addScaledVector(n, -pred.vel.dot(n));
    if (vPlane.lengthSq() < 1) vPlane.set(1, 0, 0);
    vPlane.normalize();
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(sim.quat);
    const fp = fwd.addScaledVector(n, -fwd.dot(n));
    const sign = fp.dot(vPlane) < -0.2 ? -1 : 1;
    const tf = vPlane.clone().multiplyScalar(sign);
    const tr = new THREE.Vector3().crossVectors(tf, n).normalize();
    const tu = new THREE.Vector3().crossVectors(tr, tf).normalize();
    this.targetQuat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tf, tu, tr));
    this.alignError = THREE.MathUtils.radToDeg(sim.quat.angleTo(this.targetQuat));

    // dots
    const P = this.dotGeo.getAttribute('position') as THREE.BufferAttribute;
    const T = this.dotGeo.getAttribute('t') as THREE.BufferAttribute;
    const pts = pred.points;
    const stride = Math.max(1, Math.floor(pts.length / this.N));
    let k = 0;
    for (let i = 2; i < pts.length && k < this.N; i += stride, k++) {
      P.setXYZ(k, pts[i].x, pts[i].y - SPEC.comHeight * 0.5, pts[i].z);
      T.setX(k, i / pts.length);
    }
    for (; k < this.N; k++) { P.setXYZ(k, 0, -1000, 0); T.setX(k, 1); }
    P.needsUpdate = true;
    T.needsUpdate = true;
    this.dotGeo.setDrawRange(0, this.N);

    // reticle
    this.reticle.visible = pred.hit;
    this.ghost.visible = pred.hit && pred.time < 6;
    if (pred.hit) {
      this.reticle.position.copy(pred.point).addScaledVector(n, 0.08);
      this.reticle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const pulse = 1 + 0.06 * Math.sin(t * 8);
      this.reticle.scale.setScalar(pulse);
      const good = THREE.MathUtils.clamp(1 - this.alignError / 40, 0, 1);
      this.ringMat.color.setRGB(2, 0.2 + 1.8 * good, 0.25 + 1.75 * good);
      this.ghost.position.copy(pred.point).addScaledVector(n, SPEC.comHeight);
      this.ghost.quaternion.copy(this.targetQuat);
      this.ghostMat.opacity = 0.25 + 0.35 * Math.min(1, 2 / Math.max(0.5, pred.time));
      this.ghostMat.color.setRGB(1.6, 0.3 + 1.3 * good, 0.35 + 1.25 * good);
    }
  }
}
