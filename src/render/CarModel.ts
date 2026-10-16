import * as THREE from 'three';
import { CarSim, EXHAUSTS, NOZZLES, SPEC, WHEELS } from '../physics/CarSim';
import { radialTexture, rimTexture } from './Textures';
import { carAsset } from './CarAsset';

// Body stations: x, half width, bottom, sill, belt, top-centre (heights above ground)
const BODY: [number, number, number, number, number, number][] = [
  [2.36, 0.78, 0.24, 0.3, 0.44, 0.47],
  [2.18, 0.9, 0.2, 0.3, 0.53, 0.58],
  [1.75, 0.97, 0.19, 0.32, 0.66, 0.74],
  [1.05, 1.0, 0.19, 0.34, 0.79, 0.88],
  [0.0, 1.0, 0.19, 0.34, 0.82, 0.87],
  [-1.0, 1.0, 0.19, 0.34, 0.84, 0.88],
  [-1.7, 0.99, 0.2, 0.36, 0.86, 0.92],
  [-2.15, 0.95, 0.24, 0.4, 0.88, 0.93],
  [-2.32, 0.88, 0.32, 0.45, 0.85, 0.89],
];

// Cabin stations: x, base half width, roof half width, roof height
const CABIN: [number, number, number, number][] = [
  [1.08, 0.82, 0.05, 0.885],
  [0.62, 0.86, 0.5, 1.04],
  [0.1, 0.87, 0.6, 1.2],
  [-0.4, 0.87, 0.6, 1.24],
  [-1.0, 0.86, 0.55, 1.19],
  [-1.6, 0.83, 0.44, 1.06],
  [-2.12, 0.78, 0.25, 0.935],
];

function lerpStation<T extends number[]>(arr: T[], x: number, col: number) {
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i], b = arr[i + 1];
    if (x <= a[0] && x >= b[0]) {
      const t = (a[0] - x) / (a[0] - b[0]);
      return a[col] + (b[col] - a[col]) * t;
    }
  }
  return arr[arr.length - 1][col];
}

/** Loft rings between stations into a flat-shaded non-indexed geometry */
function loft(rings: THREE.Vector3[][], colors: number[][] | null, capFront: boolean, capBack: boolean) {
  const pos: number[] = [];
  const col: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ca: number, cb: number, cc: number, outward: THREE.Vector3 | null) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const centroid = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
    const ref = outward ?? centroid.clone().sub(new THREE.Vector3(centroid.x, 0.6, 0));
    if (n.dot(ref) < 0) { const t = b; b = c; c = t; const tc = cb; cb = cc; cc = tc; }
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    col.push(ca, ca, ca, cb, cb, cb, cc, cc, cc);
  };
  for (let s = 0; s < rings.length - 1; s++) {
    const r0 = rings[s], r1 = rings[s + 1];
    const M = r0.length;
    for (let i = 0; i < M; i++) {
      const j = (i + 1) % M;
      const c0 = colors ? colors[s][i] : 1, c1 = colors ? colors[s][j] : 1;
      const cc = Math.min(c0, c1);
      pushTri(r0[i], r1[i], r1[j], cc, cc, cc, null);
      pushTri(r0[i], r1[j], r0[j], cc, cc, cc, null);
    }
  }
  const cap = (ring: THREE.Vector3[], dir: number, ci: number) => {
    const cen = new THREE.Vector3();
    ring.forEach((p) => cen.add(p));
    cen.divideScalar(ring.length);
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      pushTri(cen, ring[i], ring[j], ci, ci, ci, new THREE.Vector3(dir, 0, 0));
    }
  };
  if (capFront) cap(rings[0], 1, 0.9);
  if (capBack) cap(rings[rings.length - 1], -1, 0.9);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function buildBodyGeometry() {
  const ground = -SPEC.comHeight;
  const xs: number[] = [];
  for (let i = 0; i < BODY.length; i++) {
    xs.push(BODY[i][0]);
    if (i < BODY.length - 1) xs.push((BODY[i][0] + BODY[i + 1][0]) / 2);
  }
  const rings: THREE.Vector3[][] = [];
  const colors: number[][] = [];
  for (const x of xs) {
    const hw = lerpStation(BODY, x, 1);
    const yb = lerpStation(BODY, x, 2) + ground;
    const ys = lerpStation(BODY, x, 3) + ground;
    const ybl = lerpStation(BODY, x, 4) + ground;
    const yt = lerpStation(BODY, x, 5) + ground;
    const half: [number, number, number][] = [
      [0, yb, 0.06],
      [hw - 0.14, yb, 0.06],
      [hw - 0.02, yb + 0.09, 0.06],
      [hw, ys, 0.06],
      [hw + 0.012, (ys + ybl) / 2, 0.93],
      [hw - 0.05, ybl, 0.93],
      [hw * 0.58, yt - 0.012, 0.93],
      [0, yt, 0.93],
    ];
    const ring: THREE.Vector3[] = [];
    const cr: number[] = [];
    for (const [z, y, c] of half) { ring.push(new THREE.Vector3(x, y, z)); cr.push(c); }
    for (let i = half.length - 2; i >= 1; i--) { ring.push(new THREE.Vector3(x, half[i][1], -half[i][0])); cr.push(half[i][2]); }
    rings.push(ring);
    colors.push(cr);
  }
  return loft(rings, colors, true, true);
}

export function buildCabinGeometry() {
  const ground = -SPEC.comHeight;
  const rings: THREE.Vector3[][] = [];
  for (const [x, bw, rw, ry] of CABIN) {
    const yBase = lerpStation(BODY, x, 5) + ground - 0.02;
    const yr = ry + ground;
    const ring = [
      new THREE.Vector3(x, yBase, 0),
      new THREE.Vector3(x, yBase, bw),
      new THREE.Vector3(x, yr, rw),
      new THREE.Vector3(x, yr + 0.015, 0),
      new THREE.Vector3(x, yr, -rw),
      new THREE.Vector3(x, yBase, -bw),
    ];
    rings.push(ring);
  }
  const g = loft(rings, null, true, true);
  g.deleteAttribute('color');
  return g;
}

export interface CarVisual {
  group: THREE.Group;
  update(sim: CarSim, dt: number): void;
  nozzleWorld(i: number, out: THREE.Vector3): THREE.Vector3;
  setLights(on: boolean): void;
  bodyMat: THREE.MeshPhysicalMaterial;
  /** hide the roof/glass for the cockpit camera so the view is open */
  setCockpit(on: boolean): void;
}

export function createCar(envMap: THREE.Texture | null): CarVisual {
  const group = new THREE.Group();
  group.name = 'car';
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0xe8e8e4, metalness: 0.12, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1,
  });
  // reflective tinted glass from outside, see-through from inside (front faces only)
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x2a1c12, metalness: 0.4, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8,
    transparent: true, opacity: 0.86, depthWrite: false, side: THREE.FrontSide,
  });
  const interior = new THREE.MeshStandardMaterial({ color: 0x0c0b0d, roughness: 0.75, metalness: 0.05 });
  const seat = new THREE.MeshStandardMaterial({ color: 0x151213, roughness: 0.6, metalness: 0.05 });
  const screen = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.16, 0.2).multiplyScalar(1.6) });
  const carbon = new THREE.MeshPhysicalMaterial({ color: 0x0d0e10, roughness: 0.35, metalness: 0.5, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  const ground = -SPEC.comHeight;
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.55, metalness: 0.4 });
  const white = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(3) });
  const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.04, 0.06).multiplyScalar(3.5) });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x09090a, roughness: 0.85 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9b9b6, roughness: 0.3, metalness: 0.65, envMapIntensity: 0.9 });
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.35, metalness: 0.6 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x6b5638, roughness: 0.3, metalness: 0.95 });
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    b.position.set(x, y, z);
    group.add(b);
    return b;
  };
  let frontBar: THREE.Object3D;
  let rearBar: THREE.Object3D;
  const wheelGroups: THREE.Group[] = [];
  const spinners: THREE.Group[] = [];
  let wing: THREE.Object3D | null = null;
  let greenhouse: THREE.Object3D | undefined;
  let dashCanvas: HTMLCanvasElement | null = null;
  let dashTex: THREE.CanvasTexture | null = null;
  let dashTimer = 0;
  let mapCanvas: HTMLCanvasElement | null = null;
  let mapTex: THREE.CanvasTexture | null = null;
  let mapBg: { track: unknown; img: HTMLCanvasElement; map: (x: number, y: number) => [number, number] } | null = null;
  let yoke: THREE.Group | null = null;
  const yokeAxis = new THREE.Vector3(1, 0, 0);
  let yokeAngle = 0;
  let wingAoa = 0.2;
  let lastSpeed = 0;

  if (carAsset) {
    const src = carAsset.clone(true);
    const mats: Record<string, THREE.Material> = {
      Paint: bodyMat, Glass: glassMat, Trim: dark, Tire: tireMat, Rim: rimMat, Spoke: spokeMat, LightFront: white, LightRear: red, Nozzle: bronze,
      Interior: interior, Seat: seat, Screen: screen, Carbon: carbon,
    };
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const old = m.material as THREE.Material;
      m.material = mats[old.name] ?? dark;
      if (m.material !== glassMat) (m.material as THREE.Material).side = THREE.DoubleSide;
      else m.renderOrder = 3;
      m.castShadow = m.material !== glassMat;
      m.receiveShadow = true;
    });
    const holder = new THREE.Group();
    holder.position.y = ground;
    holder.add(src);
    group.add(holder);
    ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'].forEach((name, i) => {
      const node = src.getObjectByName(name)!;
      const z = node.position.z;
      node.parent!.remove(node);
      node.position.set(0, 0, 0);
      const g = new THREE.Group();
      g.position.set(WHEELS[i].x, 0, z);
      const spin = new THREE.Group();
      spin.add(node);
      g.add(spin);
      group.add(g);
      wheelGroups.push(g);
      spinners.push(spin);
    });
    wing = src.getObjectByName('Wing') ?? null;
    // live dash display replaces the placeholder screen slab
    const scr = src.getObjectByName('Screen');
    if (scr) {
      scr.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).visible = false; });
      dashCanvas = document.createElement('canvas');
      dashCanvas.width = 512; dashCanvas.height = 128;
      dashTex = new THREE.CanvasTexture(dashCanvas);
      dashTex.colorSpace = THREE.SRGBColorSpace;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.14), new THREE.MeshBasicMaterial({ map: dashTex, toneMapped: false }));
      plane.rotation.y = -Math.PI / 2;
      plane.position.x = -0.012;
      scr.add(plane);
    }
    // centre screen: live side-profile map of the ramp, landing hill and the car
    const scrC = src.getObjectByName('ScreenC');
    if (scrC) {
      scrC.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).visible = false; });
      mapCanvas = document.createElement('canvas');
      mapCanvas.width = 340; mapCanvas.height = 200;
      mapTex = new THREE.CanvasTexture(mapCanvas);
      mapTex.colorSpace = THREE.SRGBColorSpace;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), new THREE.MeshBasicMaterial({ map: mapTex, toneMapped: false }));
      plane.rotation.y = -Math.PI / 2;
      plane.position.x = -0.012;
      scrC.add(plane);
    }
    // yoke: gather its parts under a pivot on the steering column so it can turn
    group.updateMatrixWorld(true);
    const yokeParts = ['YokeRim', 'YokeGripL', 'YokeGripR', 'YokeSpokes', 'YokeHub', 'YokeHub_bore'].map((n) => src.getObjectByName(n)).filter(Boolean) as THREE.Object3D[];
    if (yokeParts.length) {
      yoke = new THREE.Group();
      // yoke centre and column axis, converted from the Blender build (x fwd, y left, z up)
      yoke.position.set(0.28, 0.75 + ground, -0.4);
      group.add(yoke);
      group.updateMatrixWorld(true);
      yokeAxis.set(Math.cos(0.38), Math.sin(0.38), 0).normalize();
      for (const o of yokeParts) yoke.attach(o);
    }
    const cabinLight = new THREE.PointLight(0xffd8d0, 0.35, 2.2, 2);
    cabinLight.position.set(-0.2, 0.55, 0);
    group.add(cabinLight);
    greenhouse = src.getObjectByName('Greenhouse');
    frontBar = src.getObjectByName('LightBarF') ?? new THREE.Object3D();
    rearBar = src.getObjectByName('LightBarR') ?? new THREE.Object3D();
  } else {
    bodyMat.vertexColors = true;
    bodyMat.flatShading = true;
    const body = new THREE.Mesh(buildBodyGeometry(), bodyMat);
    body.castShadow = true;
    group.add(body);
    const cabin = new THREE.Mesh(buildCabinGeometry(), glassMat);
    cabin.castShadow = true;
    group.add(cabin);
    box(0.5, 0.04, 1.62, 2.18, ground + 0.17, 0, dark);
    box(0.45, 0.16, 1.7, -2.12, ground + 0.3, 0, dark);
    frontBar = box(0.02, 0.022, 1.5, 2.372, ground + 0.452, 0, white);
    rearBar = box(0.02, 0.03, 1.66, -2.335, ground + 0.835, 0, red);
    const archGeo = new THREE.CircleGeometry(0.47, 32, 0, Math.PI);
    for (const w of WHEELS) {
      const a = new THREE.Mesh(archGeo, dark);
      a.position.set(w.x, ground + 0.36, Math.sign(w.z) * 1.003);
      if (w.z < 0) a.rotation.y = Math.PI;
      group.add(a);
    }
    const rimTex = new THREE.MeshStandardMaterial({ map: rimTexture(), roughness: 0.35, metalness: 0.6 });
    const tireGeo = new THREE.CylinderGeometry(SPEC.wheelR, SPEC.wheelR, 0.27, 32);
    tireGeo.rotateX(Math.PI / 2);
    const rimGeo = new THREE.CircleGeometry(SPEC.wheelR * 0.86, 32);
    WHEELS.forEach((w) => {
      const g = new THREE.Group();
      g.position.set(w.x, 0, w.z * 1.05);
      const spin = new THREE.Group();
      spin.add(new THREE.Mesh(tireGeo, tireMat));
      const rim = new THREE.Mesh(rimGeo, rimTex);
      rim.position.z = Math.sign(w.z) * 0.137;
      if (w.z < 0) rim.rotation.y = Math.PI;
      spin.add(rim);
      g.add(spin);
      group.add(g);
      wheelGroups.push(g);
      spinners.push(spin);
    });
  }

  // nozzle glows
  const glowTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64, [[0.25, 'rgba(200,225,255,0.6)']]);
  const glows: THREE.Sprite[] = [];
  for (const nz of NOZZLES) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xcfe4ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.position.copy(nz.pos);
    s.scale.setScalar(0.01);
    group.add(s);
    glows.push(s);
    const port = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), dark);
    port.position.copy(nz.pos).addScaledVector(nz.force, -0.02);
    port.lookAt(port.position.clone().addScaledVector(nz.force, -1).applyMatrix4(new THREE.Matrix4()));
    group.add(port);
  }

  // the four rear exhausts: the launch blast comes out of these
  const pipeGlows: THREE.Sprite[] = [];
  for (const p of EXHAUSTS) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xcfe4ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.position.copy(p).add(new THREE.Vector3(-0.03, 0, 0));
    s.scale.setScalar(0.01);
    group.add(s);
    pipeGlows.push(s);
  }

  // car lights
  // soft underglow: a wide additive light pool instead of a point light hot spot
  const glowMat = new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,30,45,0.9)', 'rgba(255,0,0,0)', 128, [[0.35, 'rgba(255,25,40,0.35)']]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 });
  const under = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 3.2), glowMat);
  under.rotation.x = -Math.PI / 2;
  under.position.set(0, ground + 0.03, 0);
  under.renderOrder = 2;
  group.add(under);
  // two wide headlights at the corners of the light bar
  // the light bar casts one wide, even wash plus a soft fan of light on the road ahead
  const headLight = new THREE.SpotLight(0xf2f4ff, 95, 85, 0.95, 1.0, 1.7);
  // the lamp sits just ahead of the nose: anywhere inside the body it floods the bumper
  // and splitter at point-blank range and shows up as a white-hot patch on the car
  headLight.position.set(2.75, ground + 0.46, 0);
  headLight.target.position.set(20, ground - 1.0, 0);
  group.add(headLight, headLight.target);
  const fanCanvas = document.createElement('canvas');
  fanCanvas.width = 256; fanCanvas.height = 256;
  {
    const c = fanCanvas.getContext('2d')!;
    const img = c.createImageData(256, 256);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        const fx = x / 255, fy = y / 255; // fx along travel (0 = bumper), fy across
        const spread = 0.28 + 0.72 * fx; // widens with distance like a bar's beam
        const across = Math.abs(fy - 0.5) * 2 / spread;
        const a = Math.max(0, 1 - across * across) * Math.pow(1 - fx, 1.4) * Math.min(1, fx * 8);
        const i = (y * 256 + x) * 4;
        img.data[i] = 235; img.data[i + 1] = 240; img.data[i + 2] = 255; img.data[i + 3] = a * 255;
      }
    c.putImageData(img, 0, 0);
  }
  const fanTex = new THREE.CanvasTexture(fanCanvas);
  const fanMat = new THREE.MeshBasicMaterial({ map: fanTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.22 });
  const fan = new THREE.Mesh(new THREE.PlaneGeometry(16, 9), fanMat);
  fan.rotation.x = -Math.PI / 2;
  fan.position.set(2.4 + 8, ground + 0.035, 0);
  fan.renderOrder = 2;
  group.add(fan);
  const head = { set visible(v: boolean) { headLight.visible = v; fan.visible = v; } };
  const tail = new THREE.PointLight(0xff1020, 1.2, 5, 2);
  tail.position.set(-3.1, ground + 0.8, 0);
  group.add(tail);

  const tmp = new THREE.Vector3();
  let lightsOn = true;

  return {
    group,
    bodyMat,
    setCockpit(on: boolean) { if (greenhouse) greenhouse.visible = !on; },
    setLights(on: boolean) {
      lightsOn = on;
      frontBar.visible = on; rearBar.visible = on; head.visible = on; under.visible = on;
    },
    nozzleWorld(i, out) {
      return out.copy(NOZZLES[i].pos).applyMatrix4(group.matrixWorld);
    },
    update(sim, dt) {
      group.position.copy(sim.pos);
      group.quaternion.copy(sim.quat);
      // yoke follows the front wheels (about 1.6 rad lock to lock each way)
      if (yoke) {
        const target = -(sim.wheels[0].steer / 0.45) * 1.6;
        yokeAngle += (target - yokeAngle) * Math.min(1, dt * 14);
        yoke.quaternion.setFromAxisAngle(yokeAxis, yokeAngle);
      }
      if (mapCanvas && mapTex && dashTimer - dt <= 0) {
        const g = mapCanvas.getContext('2d')!;
        if (!mapBg || mapBg.track !== sim.track) {
          const img = document.createElement('canvas'); img.width = 340; img.height = 200;
          const c = img.getContext('2d')!;
          const tp = sim.track.pos;
          const hill = sim.terrain.hills[0];
          let minX = Infinity, maxX = -Infinity, maxY = 1;
          const hp: [number, number][] = [];
          if (hill) for (let k = 0; k < hill.h.length; k += 2) { const u = hill.u0 + k * hill.du; const x = hill.origin.x + hill.dir.x * u; hp.push([x, hill.h[k]]); }
          for (const p of tp) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
          for (const [x, y] of hp) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
          const sc = Math.min(316 / (maxX - minX || 1), 150 / maxY);
          const map = (x: number, y: number): [number, number] => [12 + (x - minX) * sc, 186 - y * sc];
          c.fillStyle = '#060405'; c.fillRect(0, 0, 340, 200);
          c.strokeStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); c.moveTo(8, 186); c.lineTo(332, 186); c.stroke();
          c.fillStyle = 'rgba(255,40,56,0.22)'; c.strokeStyle = '#ff2a3a'; c.lineWidth = 2;
          c.beginPath(); hp.forEach(([x, y], k) => { const [a, b] = map(x, y); k ? c.lineTo(a, b) : c.moveTo(a, b); }); c.closePath(); c.fill(); c.stroke();
          c.strokeStyle = '#e8e8ee'; c.lineWidth = 2.2; c.beginPath();
          tp.forEach((p, k) => { if (k % 3) return; const [a, b] = map(p.x, p.y); k ? c.lineTo(a, b) : c.moveTo(a, b); }); c.stroke();
          c.fillStyle = '#ff2a3a'; c.fillRect(0, 0, 340, 3);
          mapBg = { track: sim.track, img, map };
        }
        g.drawImage(mapBg.img, 0, 0);
        const [cx, cy] = mapBg.map(sim.pos.x, sim.pos.y - 0.55);
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.stroke();
        mapTex.needsUpdate = true;
      }
      dashTimer -= dt;
      if (dashCanvas && dashTex && dashTimer <= 0) {
        dashTimer = 0.1;
        const g = dashCanvas.getContext('2d')!;
        g.fillStyle = '#050405'; g.fillRect(0, 0, 512, 128);
        g.fillStyle = '#ff2a3a'; g.fillRect(0, 0, 512, 3);
        g.font = '600 64px "Chakra Petch", monospace'; g.textBaseline = 'middle';
        g.fillStyle = '#ffffff'; g.textAlign = 'right';
        g.fillText(String(Math.round(sim.speed * 3.6)), 210, 66);
        g.font = '500 18px "Chakra Petch", monospace'; g.textAlign = 'left'; g.fillStyle = '#ff6a74';
        g.fillText('KM/H', 220, 84);
        g.fillStyle = '#9a8f92'; g.fillText('AIR', 300, 44); g.fillText('G', 300, 92);
        g.fillStyle = '#2a1416'; g.fillRect(340, 36, 150, 14);
        g.fillStyle = '#ff2a3a'; g.fillRect(340, 36, 150 * sim.airFrac, 14);
        g.fillStyle = '#ffffff'; g.font = '600 26px "Chakra Petch", monospace';
        g.fillText(sim.gForce.toFixed(1), 340, 92);
        dashTex.needsUpdate = true;
      }
      // active rear wing: steep for downforce at low speed, flat (low drag) at speed,
      // stands up as an air brake when decelerating hard, neutral in flight
      if (wing && dt > 0) {
        const sp = sim.speed;
        const decel = (lastSpeed - sp) / dt;
        lastSpeed = sp;
        let aoa = THREE.MathUtils.lerp(16, 3, THREE.MathUtils.clamp(sp / 70, 0, 1));
        if (sim.phase === 'air') aoa = 6;
        else if (decel > 9 && sp > 8) aoa = 34;
        aoa = THREE.MathUtils.degToRad(aoa);
        wingAoa += (aoa - wingAoa) * Math.min(1, dt * 4);
        wing.rotation.z = -wingAoa;
      }
      for (let i = 0; i < 4; i++) {
        const ws = sim.wheels[i];
        const wg = wheelGroups[i];
        // centre sits (rest - compression) below the mount
        const comp = ws.contact ? ws.x : 0;
        wg.position.y = SPEC.mountY - (SPEC.suspRest - comp);
        wg.rotation.y = -ws.steer;
        spinners[i].rotation.z = -ws.spin;
      }
      for (let i = 0; i < NOZZLES.length; i++) {
        const f = sim.nozzle[i] / 1500;
        const g = glows[i];
        const target = Math.min(1, f);
        const m = g.material as THREE.SpriteMaterial;
        m.opacity += (target * 0.55 - m.opacity) * Math.min(1, dt * 30);
        // just the hot mouth of the nozzle, never a halo around the car
        g.scale.setScalar((i < 4 ? 0.2 : 0.13) * (0.9 + 0.25 * Math.min(1, f)) * (0.9 + Math.random() * 0.2));
        g.visible = m.opacity > 0.02;
      }
      for (let i = 0; i < pipeGlows.length; i++) {
        const g = pipeGlows[i];
        const m = g.material as THREE.SpriteMaterial;
        m.opacity += (sim.exhaust * 0.6 - m.opacity) * Math.min(1, dt * 25);
        g.scale.setScalar(0.16 * (0.9 + Math.random() * 0.25));
        g.visible = m.opacity > 0.02;
      }
      const flicker = sim.phase === 'crashed' ? (Math.random() < 0.3 ? 0 : 1) : 1;
      // fade the light pool with height above the surface it lights
      const agl = sim.altitude();
      glowMat.opacity = lightsOn ? 0.55 * flicker * Math.max(0, 1 - agl / 1.5) : 0;
      under.visible = glowMat.opacity > 0.01;
      // the road wash only makes sense with the car level on its wheels: tilted, the flat
      // decal would hang in the air as a lit rectangle
      const levelK = THREE.MathUtils.smoothstep(new THREE.Vector3(0, 1, 0).applyQuaternion(sim.quat).y, 0.94, 0.99);
      fanMat.opacity = lightsOn ? 0.22 * Math.max(0, 1 - agl / 0.8) * levelK : 0;
      fan.visible = fanMat.opacity > 0.01;
      (red.color as THREE.Color).setRGB(3.5 * flicker, 0.14 * flicker, 0.21 * flicker);
      void tmp;
    },
  };
}
