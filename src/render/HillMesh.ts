import * as THREE from 'three';
import { Hill, hillHeight, hillProfile } from '../physics/Terrain';
import { neonMaterial, NEON_RED } from './TrackMesh';
import { textTexture, wallTexture } from './Textures';

export function buildHillVisual(hill: Hill, slab: THREE.Texture) {
  const group = new THREE.Group();
  const dir = new THREE.Vector3(hill.dir.x, 0, hill.dir.y);
  const perp = new THREE.Vector3(-hill.dir.y, 0, hill.dir.x);
  let maxH = 0;
  for (const v of hill.h) maxH = Math.max(maxH, v);
  const reach = hill.halfWidth + maxH / hill.sideSlope + 0.6;
  const u0 = hill.u0, u1 = hill.u0 + (hill.h.length - 1) * hill.du;
  const vs: number[] = [];
  const nb = 6;
  for (let i = 0; i <= nb; i++) vs.push(-reach + ((reach - hill.halfWidth) * i) / nb);
  const nt = 8;
  for (let i = 1; i < nt; i++) vs.push(-hill.halfWidth + (2 * hill.halfWidth * i) / nt);
  for (let i = 0; i <= nb; i++) vs.push(hill.halfWidth + ((reach - hill.halfWidth) * i) / nb);
  const us: number[] = [];
  for (let u = u0; u <= u1 + 1e-6; u += 1) us.push(u);
  const NV = vs.length, NU = us.length;
  // grid positions and smooth normals from the heightfield
  const G: THREE.Vector3[] = [];
  const N: THREE.Vector3[] = [];
  const tmpN = new THREE.Vector3();
  for (const u of us)
    for (const v of vs) {
      const p = hill.origin.clone().addScaledVector(dir, u).addScaledVector(perp, v);
      p.y = hillHeight(hill, p.x, p.z) + 0.01;
      G.push(p);
      const e = 0.2;
      const hx = hillHeight(hill, p.x + e, p.z) - hillHeight(hill, p.x - e, p.z);
      const hz = hillHeight(hill, p.x, p.z + e) - hillHeight(hill, p.x, p.z - e);
      N.push(tmpN.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize().clone());
    }
  // surface distance along u (per column) and along v (per row) -> no stretching on slopes
  const du = new Float32Array(NU * NV), dv = new Float32Array(NU * NV);
  for (let j = 0; j < NV; j++) for (let i = 1; i < NU; i++) du[i * NV + j] = du[(i - 1) * NV + j] + G[i * NV + j].distanceTo(G[(i - 1) * NV + j]);
  const jc = vs.reduce((best, v, j) => (Math.abs(v) < Math.abs(vs[best]) ? j : best), 0);
  for (let i = 0; i < NU; i++) {
    for (let j = jc + 1; j < NV; j++) dv[i * NV + j] = dv[i * NV + j - 1] + G[i * NV + j].distanceTo(G[i * NV + j - 1]);
    for (let j = jc - 1; j >= 0; j--) dv[i * NV + j] = dv[i * NV + j + 1] - G[i * NV + j].distanceTo(G[i * NV + j + 1]);
  }
  const top = { pos: [] as number[], nor: [] as number[], uv: [] as number[] };
  const wall = { pos: [] as number[], nor: [] as number[], uv: [] as number[] };
  const qn = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let i = 0; i < NU - 1; i++)
    for (let j = 0; j < NV - 1; j++) {
      const ids = [i * NV + j, i * NV + j + 1, (i + 1) * NV + j, (i + 1) * NV + j + 1];
      const [A, B, C, D] = ids.map((k) => G[k]);
      if (A.y < 0.03 && B.y < 0.03 && C.y < 0.03 && D.y < 0.03) continue; // flat ground: nothing to draw
      e1.subVectors(D, A); e2.subVectors(B, C);
      qn.crossVectors(e1, e2).normalize();
      if (qn.y < 0) qn.negate();
      const isTop = qn.y > 0.72 && Math.abs(vs[j] + vs[j + 1]) / 2 <= hill.halfWidth + 0.01;
      const tgt = isTop ? top : wall;
      const front = Math.abs(qn.dot(dir)) > Math.abs(qn.dot(perp));
      const tri = [ids[0], ids[1], ids[2], ids[1], ids[3], ids[2]];
      for (const k of tri) {
        const p = G[k];
        tgt.pos.push(p.x, p.y, p.z);
        if (isTop) { const nn = N[k]; tgt.nor.push(nn.x, nn.y, nn.z); tgt.uv.push(dv[k] / 10, du[k] / 10); }
        else {
          tgt.nor.push(qn.x, qn.y, qn.z);
          const hz = front ? p.clone().sub(hill.origin).dot(perp) : p.clone().sub(hill.origin).dot(dir);
          tgt.uv.push(hz / 4, p.y / 4);
        }
      }
    }
  const mk = (d: typeof top) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(d.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
    // winding to match the (upward) normals
    const P = g.getAttribute('position'), Nn = g.getAttribute('normal');
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (let t = 0; t < P.count; t += 3) {
      a.fromBufferAttribute(P, t); b.fromBufferAttribute(P, t + 1); c.fromBufferAttribute(P, t + 2); n.fromBufferAttribute(Nn, t);
      if (b.clone().sub(a).cross(c.clone().sub(a)).dot(n) < 0) {
        for (const attr of [P, Nn, g.getAttribute('uv')]) {
          const sz = attr.itemSize, arr = attr.array as Float32Array;
          for (let q = 0; q < sz; q++) { const x = arr[(t + 1) * sz + q]; arr[(t + 1) * sz + q] = arr[(t + 2) * sz + q]; arr[(t + 2) * sz + q] = x; }
        }
      }
    }
    return g;
  };
  const mat = new THREE.MeshStandardMaterial({ map: slab, roughness: 0.8, envMapIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const mesh = new THREE.Mesh(mk(top), mat);
  mesh.receiveShadow = true;
  group.add(mesh);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), color: 0xe6e6ee, roughness: 0.5, metalness: 0.35, envMapIntensity: 0.9 });
  const wallMesh = new THREE.Mesh(mk(wall), wallMat);
  wallMesh.receiveShadow = true;
  group.add(wallMesh);

  // glowing plinth where the structure meets the ground
  {
    const toe: THREE.Vector3[][] = [[], []];
    for (let u = u0; u <= u1; u += 0.5) {
      const ph = hillProfile(hill, u);
      if (ph < 0.3) continue;
      const vt = hill.halfWidth + ph / hill.sideSlope + 0.15;
      [-1, 1].forEach((sd, k) => toe[k].push(hill.origin.clone().addScaledVector(dir, u).addScaledVector(perp, sd * vt).setY(0.05)));
    }
    const base = neonMaterial(2.6);
    for (const line of toe) if (line.length > 1) group.add(vband(line, 0.32, base));
    // lit seams running up the side walls every 10 m
    const seam = neonMaterial(1.3);
    for (let u = Math.ceil(u0 / 10) * 10; u < u1; u += 10) {
      const ph = hillProfile(hill, u);
      if (ph < 2) continue;
      for (const sd of [-1, 1]) {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 12; k++) {
          const hh = ph * (k / 12);
          const vv = hill.halfWidth + (ph - hh) / hill.sideSlope + 0.03;
          pts.push(hill.origin.clone().addScaledVector(dir, u).addScaledVector(perp, sd * vv).setY(hh));
        }
        group.add(ribbon(pts, dir, 0.12, seam));
      }
    }
    // front toe across the run-up
    let uf = u0;
    while (uf < u1 && hillProfile(hill, uf) < 0.3) uf += 0.25;
    const vEdge = hill.halfWidth + hillProfile(hill, uf) / hill.sideSlope;
    const fr: THREE.Vector3[] = [];
    for (let v = -vEdge; v <= vEdge + 1e-6; v += 0.5) fr.push(hill.origin.clone().addScaledVector(dir, uf - 0.3).addScaledVector(perp, v).setY(0.05));
    group.add(vband(fr, 0.32, base));
  }

  // ---------- markings: neon lines following the surface
  const lineAcross = (u: number, mat: THREE.Material, w = 0.35) => {
    const pts: THREE.Vector3[] = [];
    for (let v = -hill.halfWidth; v <= hill.halfWidth + 1e-6; v += 0.5) {
      const p = hill.origin.clone().addScaledVector(dir, u).addScaledVector(perp, v);
      p.y = hillHeight(hill, p.x, p.z) + 0.04;
      pts.push(p);
    }
    group.add(ribbon(pts, dir, w, mat));
  };
  const lineAlong = (v: number, mat: THREE.Material, w = 0.3, from = u0, to = u1) => {
    const pts: THREE.Vector3[] = [];
    for (let u = from; u <= to; u += 0.5) {
      const p = hill.origin.clone().addScaledVector(dir, u).addScaledVector(perp, v);
      p.y = hillHeight(hill, p.x, p.z) + 0.05;
      if (p.y > 0.06) pts.push(p);
    }
    if (pts.length > 1) group.add(ribbon(pts, perp, w, mat));
  };
  const neon = neonMaterial(2.4);
  const neonDim = neonMaterial(0.9);
  const white = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(1.4) });
  lineAlong(-hill.halfWidth + 0.2, neon, 0.3);
  lineAlong(hill.halfWidth - 0.2, neon, 0.3);
  const zA = hill.targetU - hill.zoneHalf, zB = hill.targetU + hill.zoneHalf;
  lineAcross(zA, neon, 0.45);
  lineAcross(zB, neon, 0.45);
  lineAcross(hill.targetU, white, 0.5);
  for (let u = Math.ceil(u0 / 10) * 10; u < u1; u += 10) {
    if (hillProfile(hill, u) < 0.5) continue;
    if (Math.abs(u - hill.targetU) < 2) continue;
    lineAcross(u, neonDim, 0.12);
  }
  // zone fill
  {
    const pos: number[] = [];
    const idx: number[] = [];
    const NU = Math.max(2, Math.ceil((zB - zA) / 1));
    for (let i = 0; i <= NU; i++) {
      const u = zA + ((zB - zA) * i) / NU;
      for (const v of [-hill.halfWidth, hill.halfWidth]) {
        const p = hill.origin.clone().addScaledVector(dir, u).addScaledVector(perp, v);
        p.y = hillHeight(hill, p.x, p.z) + 0.03;
        pos.push(p.x, p.y, p.z);
      }
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const zg = new THREE.BufferGeometry();
    zg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    zg.setIndex(idx);
    const zm = new THREE.Mesh(zg, new THREE.MeshBasicMaterial({ color: NEON_RED.clone().multiplyScalar(0.9), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    zm.renderOrder = 2;
    group.add(zm);
    zm.userData.pulse = true;
    group.userData.zone = zm;
  }
  // distance boards standing beside the landing area (ski-jump style)
  {
    const postMat = new THREE.MeshStandardMaterial({ color: 0x222328, metalness: 0.7, roughness: 0.45 });
    for (let u = Math.ceil(hill.windowU[0] / 20) * 20; u <= hill.windowU[1] + 20; u += 20) {
      const h = hillProfile(hill, u);
      if (h < 0.5) continue;
      const tex = textTexture(`${Math.round(u)} M`, { w: 256, h: 96, color: '#ffffff', bg: 'rgba(12,12,15,0.92)', font: '600 56px "Chakra Petch", monospace' });
      for (const sd of [-1, 1]) {
        const base = hill.origin.clone().addScaledVector(dir, u).addScaledVector(perp, sd * (hill.halfWidth - 0.6));
        base.y = hillHeight(hill, base.x, base.z);
        const board = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.82), new THREE.MeshBasicMaterial({ map: tex, toneMapped: true }));
        board.position.copy(base).add(new THREE.Vector3(0, 1.5, 0));
        board.lookAt(board.position.clone().sub(dir));
        group.add(board);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), postMat);
        post.position.copy(base).add(new THREE.Vector3(0, 0.55, 0));
        group.add(post);
      }
    }
  }
  // K marker sign on the side
  {
    const p = hill.origin.clone().addScaledVector(dir, hill.targetU).addScaledVector(perp, hill.halfWidth + 2);
    const h = hillProfile(hill, hill.targetU);
    const tex = textTexture('LAND', { w: 512, h: 160, color: '#fff', bg: 'rgba(0,0,0,0)' });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.9), new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(1, 0.2, 0.25).multiplyScalar(1.6), side: THREE.DoubleSide, depthWrite: false }));
    sign.position.set(p.x, h + 5, p.z);
    sign.lookAt(sign.position.clone().sub(dir));
    group.add(sign);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.2, h + 4, 0.2), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    pole.position.set(p.x, (h + 4) / 2, p.z);
    group.add(pole);
  }
  return group;
}

function ribbon(pts: THREE.Vector3[], side: THREE.Vector3, w: number, mat: THREE.Material) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i].clone().addScaledVector(side, -w / 2);
    const b = pts[i].clone().addScaledVector(side, w / 2);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, mat);
  (m.material as THREE.Material).side = THREE.DoubleSide;
  return m;
}

/** vertical glowing band standing on a ground line */
function vband(pts: THREE.Vector3[], h: number, mat: THREE.Material) {
  const pos: number[] = [];
  const idx: number[] = [];
  pts.forEach((p, i) => {
    pos.push(p.x, 0.02, p.z, p.x, h, p.z);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, mat);
  (m.material as THREE.Material).side = THREE.DoubleSide;
  return m;
}
