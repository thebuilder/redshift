import * as THREE from 'three';
import { CarSim } from '../physics/CarSim';
import { buildBodyGeometry, buildCabinGeometry } from '../render/CarModel';
import { silhouetteGeometries } from '../render/CarAsset';
import { SPEC } from '../physics/CarSim';

/**
 * 3D attitude sphere rendered into a HUD slot via scissor: a gimballed sphere
 * with a red horizon, the car in its true attitude (heading normalised to the
 * direction of travel) and the ideal landing attitude as a red ghost.
 */
export class Attitude {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private car = new THREE.Group();
  private ghost: THREE.LineSegments;
  private el: HTMLElement;
  private sphere = new THREE.Group();

  constructor(el: HTMLElement) {
    this.el = el;
    this.camera.position.set(-3.4, 1.5, 3.4);
    this.camera.lookAt(0, 0, 0);
    // sphere wireframe
    const lines: number[] = [];
    const R = 1.2;
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = R * Math.sin((lat * Math.PI) / 180), r = R * Math.cos((lat * Math.PI) / 180);
      for (let i = 0; i < 48; i++) {
        const a0 = (i / 48) * Math.PI * 2, a1 = ((i + 1) / 48) * Math.PI * 2;
        if (lat !== 0) lines.push(r * Math.cos(a0), y, r * Math.sin(a0), r * Math.cos(a1), y, r * Math.sin(a1));
      }
    }
    for (let lon = 0; lon < 180; lon += 30) {
      for (let i = 0; i < 48; i++) {
        const a0 = (i / 48) * Math.PI * 2, a1 = ((i + 1) / 48) * Math.PI * 2;
        const c = Math.cos((lon * Math.PI) / 180), s = Math.sin((lon * Math.PI) / 180);
        lines.push(R * Math.cos(a0) * c, R * Math.sin(a0), R * Math.cos(a0) * s, R * Math.cos(a1) * c, R * Math.sin(a1), R * Math.cos(a1) * s);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.sphere.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16 })));
    const hz = new THREE.Mesh(new THREE.TorusGeometry(R, 0.012, 6, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.08, 0.12).multiplyScalar(2) }));
    hz.rotation.x = Math.PI / 2;
    this.sphere.add(hz);
    // forward marker on the horizon
    const fm = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    fm.position.set(R + 0.08, 0, 0);
    fm.rotation.z = -Math.PI / 2;
    this.sphere.add(fm);
    this.scene.add(this.sphere);

    const s = 0.24;
    const sil = silhouetteGeometries(SPEC.comHeight);
    if (sil) {
      const light = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5, metalness: 0.1 });
      const glass = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.3 });
      sil.forEach((g) => this.car.add(new THREE.Mesh(g, light))); void glass;
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));
      const d = new THREE.DirectionalLight(0xffffff, 1.5); d.position.set(-2, 4, 3); this.scene.add(d);
    } else {
      const body = new THREE.Mesh(buildBodyGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xdddddd }));
      const cab = new THREE.Mesh(buildCabinGeometry(), new THREE.MeshBasicMaterial({ color: 0x2a2a2e }));
      this.car.add(body, cab);
    }
    this.car.scale.setScalar(s);
    this.scene.add(this.car);
    this.ghost = new THREE.LineSegments(new THREE.EdgesGeometry(sil ? sil[0] : buildBodyGeometry(), 28), new THREE.LineBasicMaterial({ color: new THREE.Color(1, 0.15, 0.2).multiplyScalar(2), transparent: true, opacity: 0.85 }));
    this.ghost.scale.setScalar(s);
    this.scene.add(this.ghost);
  }

  render(renderer: THREE.WebGLRenderer, sim: CarSim, target: THREE.Quaternion | null) {
    const rect = this.el.getBoundingClientRect();
    if (rect.width < 4 || this.el.offsetParent === null) return;
    // heading frame from the velocity (or car forward when slow)
    const v = sim.vel;
    let yaw: number;
    if (Math.hypot(v.x, v.z) > 3) yaw = Math.atan2(-v.z, v.x);
    else { const f = new THREE.Vector3(1, 0, 0).applyQuaternion(sim.quat); yaw = Math.atan2(-f.z, f.x); }
    const qh = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    this.car.quaternion.copy(qh).multiply(sim.quat);
    this.ghost.visible = !!target;
    if (target) this.ghost.quaternion.copy(qh).multiply(target);
    const h = window.innerHeight;
    renderer.setScissorTest(true);
    renderer.setScissor(rect.left, h - rect.bottom, rect.width, rect.height);
    renderer.setViewport(rect.left, h - rect.bottom, rect.width, rect.height);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  }
}
