import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import carB64 from '../assets/car.glb?b64';

/** The Blender-modelled car, loaded once at boot. Ground at y = 0, +X forward, +Z right. */
export let carAsset: THREE.Group | null = null;

export async function loadCarAsset() {
  try {
    // the model is embedded as a plain base64 string and decoded here (hosted pages
    // block fetch() of data: URLs, and a binary data: URL can't go into a shared page)
    const bin = atob(carB64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const data: ArrayBuffer = buf.buffer;
    const gltf = await new GLTFLoader().parseAsync(data, '');
    carAsset = gltf.scene;
    // guard against degenerate normals: they turn into NaN pixels that bloom smears into black blocks
    carAsset.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const n = m.geometry.getAttribute('normal');
      let bad = !n;
      if (n) for (let i = 0; i < n.count && !bad; i++) {
        const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
        const l = x * x + y * y + z * z;
        if (!(l > 1e-6) || !Number.isFinite(l)) bad = true;
      }
      if (bad) m.geometry.computeVertexNormals();
    });
  } catch (e) {
    console.warn('car.glb failed to load, using procedural car', e);
  }
}

const BODY_PARTS = ['Body', 'Greenhouse'];
const partOf = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (BODY_PARTS.includes(p.name)) return p.name; return null; };

/** Body + canopy geometry in the car's centre-of-mass frame (for HUD gizmo and ghost). */
export function silhouetteGeometries(comHeight: number): THREE.BufferGeometry[] | null {
  if (!carAsset) return null;
  const out: THREE.BufferGeometry[] = [];
  carAsset.updateMatrixWorld(true);
  carAsset.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !partOf(m)) return;
    const g = m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.applyMatrix4(m.matrixWorld);
    g.translate(0, -comHeight, 0);
    out.push(g);
  });
  return out.length ? out : null;
}
