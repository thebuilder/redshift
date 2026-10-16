import * as THREE from 'three';
import { QUALITY } from '../core/Device';
import { BuiltLevel } from '../levels/LevelBuilder';
import { buildTrackVisual, neonMaterial, NEON_RED } from './TrackMesh';
import { buildHillVisual } from './HillMesh';
import { asphaltTexture, concreteTexture, radialTexture, slabTexture } from './Textures';
import { TRACK_HALF_WIDTH } from '../physics/Track';
import type { SmokeLight } from './Smoke';
import { hillHeight } from '../physics/Terrain';

let concrete: THREE.Texture | null = null;
let slab: THREE.Texture | null = null;

export function makeEnvironment(renderer: THREE.WebGLRenderer) {
  // a dark studio with a large softbox overhead and red strips around
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x020203);
  const box = (w: number, h: number, color: THREE.Color, pos: THREE.Vector3, look: THREE.Vector3) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.lookAt(look);
    env.add(m);
  };
  const O = new THREE.Vector3();
  box(14, 6, new THREE.Color(1, 1, 1).multiplyScalar(2.2), new THREE.Vector3(0, 10, 0), O);
  box(3, 30, new THREE.Color(1, 1, 1).multiplyScalar(0.8), new THREE.Vector3(10, 4, 0), O);
  box(3, 30, new THREE.Color(1, 1, 1).multiplyScalar(0.5), new THREE.Vector3(-10, 4, 0), O);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    box(5, 0.35, NEON_RED.clone().multiplyScalar(2), new THREE.Vector3(Math.cos(a) * 12, 0.4, Math.sin(a) * 12), O);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.035);
  pm.dispose();
  return rt.texture;
}

export interface WorldStatic {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  update(t: number, focus: THREE.Vector3): void;
}

/** Things shared by all levels: ground, sky, stars, skyline, lights */
export function buildStaticWorld(): WorldStatic {
  const group = new THREE.Group();
  // ground with a faint red survey grid baked in through onBeforeCompile
  const asphalt = asphaltTexture();
  asphalt.repeat.set(900, 900);
  const groundMat = new THREE.MeshStandardMaterial({ map: asphalt, color: 0x9a9a9a, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.25 });
  groundMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec2 g = abs(fract(vWPos.xz / 25.0 - 0.5) - 0.5) * 25.0;
          float line = 1.0 - smoothstep(0.0, 0.12, min(g.x, g.y));
          vec2 g2 = abs(fract(vWPos.xz / 125.0 - 0.5) - 0.5) * 125.0;
          float line2 = 1.0 - smoothstep(0.0, 0.25, min(g2.x, g2.y));
          float d = length(vWPos.xz - cameraPosition.xz);
          float fade = exp(-d * 0.0035);
          totalEmissiveRadiance += vec3(1.0, 0.04, 0.06) * (line * 0.05 + line2 * 0.16) * fade;
        }`,
      );
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 120, 120), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  group.add(ground);

  // sky dome with a deep red horizon glow
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(4200, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `varying vec3 vP; void main(){
        float h = max(vP.y, 0.0);
        vec3 c = vec3(0.004,0.004,0.006);
        c += vec3(0.11,0.008,0.012) * exp(-h*14.0);
        c += vec3(0.02,0.0,0.004) * exp(-h*3.0);
        gl_FragColor = vec4(c,1.0);
      }`,
    }),
  );
  sky.renderOrder = -10;
  group.add(sky);

  // stars
  {
    const n = 2600;
    const pos = new Float32Array(n * 3);
    const sz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random(), v = Math.random() * 0.9 + 0.08;
      const th = u * Math.PI * 2, ph = Math.acos(1 - v);
      const r = 3900;
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      sz[i] = Math.random() < 0.05 ? 3.2 : 1 + Math.random() * 1.4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(sz, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `attribute float size; uniform float uTime; varying float vA;
        void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
          gl_PointSize = size; vA = 0.55 + 0.45*sin(uTime*1.3 + position.x*0.37 + position.z*0.11); }`,
      fragmentShader: `varying float vA; void main(){ vec2 d = gl_PointCoord-0.5; float a = smoothstep(0.5,0.0,length(d)); gl_FragColor = vec4(vec3(0.8,0.85,1.0), a*vA*0.8);} `,
    });
    const stars = new THREE.Points(g, m);
    stars.userData.mat = m;
    group.add(stars);
    group.userData.stars = m;
  }

  // distant skyline: clusters of lights and blinking red tower tops
  {
    const n = 2200;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const cluster = Math.floor(a / (Math.PI / 5));
      const r = 2300 + Math.random() * 900 + cluster * 40;
      const tall = Math.random() < 0.08;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = tall ? 40 + Math.random() * 160 : Math.random() * 25;
      pos[i * 3 + 2] = Math.sin(a) * r;
      const red = tall || Math.random() < 0.25;
      col[i * 3] = 1; col[i * 3 + 1] = red ? 0.12 : 0.75; col[i * 3 + 2] = red ? 0.12 : 0.55;
      ph[i] = tall ? Math.random() * 6 : -1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `attribute vec3 color; attribute float phase; uniform float uTime; varying vec3 vC; varying float vA;
        void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
          gl_PointSize = phase >= 0.0 ? 3.0 : 2.0; vC = color;
          vA = phase >= 0.0 ? step(0.5, fract(uTime*0.6 + phase)) : 0.55; }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord-0.5; float a = smoothstep(0.5,0.1,length(d)); gl_FragColor = vec4(vC*1.6, a*vA);} `,
    });
    const city = new THREE.Points(g, m);
    group.add(city);
    group.userData.city = m;
  }

  const hemi = new THREE.HemisphereLight(0x8890a8, 0x200608, 0.35);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xc8d0ff, 0.75);
  sun.position.set(-60, 120, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(QUALITY.shadowMap, QUALITY.shadowMap);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  group.add(sun, sun.target);

  return {
    group,
    sun,
    update(t, focus) {
      (group.userData.stars as THREE.ShaderMaterial).uniforms.uTime.value = t;
      (group.userData.city as THREE.ShaderMaterial).uniforms.uTime.value = t;
      sun.target.position.copy(focus);
      sun.position.copy(focus).add(new THREE.Vector3(-60, 140, 80));
    },
  };
}

export interface LevelScene {
  group: THREE.Group;
  startLights: THREE.Mesh[];
  setStartLights(n: number, color?: 'red' | 'off'): void;
  update(t: number): void;
  cameraStations: { pos: THREE.Vector3; focus: THREE.Vector3; radius: number }[];
  smokeLights: SmokeLight[];
}

export function buildLevelScene(level: BuiltLevel): LevelScene {
  if (!concrete) concrete = concreteTexture();
  if (!slab) slab = slabTexture();
  const group = new THREE.Group();
  const smokeLights: SmokeLight[] = [];
  const track = level.track;
  group.add(buildTrackVisual(track, concrete, level.designTraj).group);
  const hillG = buildHillVisual(level.hill, slab);
  group.add(hillG);

  const pool = radialTexture('rgba(255,40,50,0.9)', 'rgba(255,0,0,0)', 128, [[0.3, 'rgba(255,30,40,0.35)']]);
  const poolMat = new THREE.MeshBasicMaterial({ map: pool, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(0.45, 0.45, 0.45) });
  // runway edge light: frangible stem, dark housing, glowing glass dome and halo
  const stemGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.32, 10);
  stemGeo.translate(0, 0.16, 0);
  const houseGeo = new THREE.CylinderGeometry(0.15, 0.17, 0.09, 20);
  houseGeo.translate(0, 0.365, 0);
  const domeGeo = new THREE.SphereGeometry(0.13, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  domeGeo.translate(0, 0.41, 0);
  const baseGeo = new THREE.CylinderGeometry(0.2, 0.24, 0.05, 20);
  baseGeo.translate(0, 0.025, 0);
  const lampMetal = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, metalness: 0.8, roughness: 0.35 });
  const domeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.05, 0.08).multiplyScalar(4) });
  const haloTex = radialTexture('rgba(255,60,70,1)', 'rgba(255,0,0,0)', 64, [[0.18, 'rgba(255,40,50,0.55)']]);
  const haloMat = new THREE.SpriteMaterial({ map: haloTex, color: 0xff3040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 });

  // runway lamps (on ground-level track) every 10 m
  const rampS = track.rampStartS();
  for (let s = 4; s < rampS; s += 10) {
    const f = track.sample(s);
    for (const side of [-1, 1]) {
      const p = f.pos.clone().addScaledVector(f.R, side * (TRACK_HALF_WIDTH + 2.2));
      const lamp = new THREE.Group();
      lamp.add(new THREE.Mesh(baseGeo, lampMetal), new THREE.Mesh(stemGeo, lampMetal), new THREE.Mesh(houseGeo, lampMetal), new THREE.Mesh(domeGeo, domeMat));
      const halo = new THREE.Sprite(haloMat);
      halo.position.y = 0.45;
      halo.scale.setScalar(1.1);
      lamp.add(halo);
      lamp.position.copy(p).setY(0);
      smokeLights.push({ pos: p.clone().setY(0.6), color: new THREE.Color(1, 0.05, 0.07).multiplyScalar(0.9), range: 4.5 });
      group.add(lamp);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(5, 9), poolMat);
      glow.rotation.x = -Math.PI / 2;
      glow.rotation.z = Math.atan2(f.T.z, f.T.x) - Math.PI / 2;
      glow.position.copy(p).addScaledVector(f.R, -side * 1.6).setY(0.02);
      group.add(glow);
    }
  }
  // long red strip far side of runway (like the reference shots)
  {
    const f0 = track.sample(0), f1 = track.sample(rampS);
    const a = f0.pos.clone().addScaledVector(f0.R, -(TRACK_HALF_WIDTH + 9));
    const b = f1.pos.clone().addScaledVector(f1.R, -(TRACK_HALF_WIDTH + 9));
    // run 30 m past both ends of the runway, but stop short of a landing hill
    const ab = b.clone().sub(a).normalize();
    const clearAt = (p: THREE.Vector3) => hillHeight(level.hill, p.x, p.z) <= 0 && hillHeight(level.hill, p.x + ab.z * 4, p.z - ab.x * 4) <= 0;
    let ea = 0, eb = 0;
    while (ea < 30 && clearAt(a.clone().addScaledVector(ab, -(ea + 3)))) ea += 1;
    while (eb < 30 && clearAt(b.clone().addScaledVector(ab, eb + 3))) eb += 1;
    a.addScaledVector(ab, -ea);
    b.addScaledVector(ab, eb);
    const len = a.distanceTo(b);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.12), neonMaterial(3.5));
    strip.position.copy(a).lerp(b, 0.5).setY(0.06);
    strip.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    group.add(strip);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(len, 14), new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,40,50,0.5)', 'rgba(255,0,0,0)', 128), color: new THREE.Color(0.35, 0.35, 0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.rotation.z = -Math.atan2(b.z - a.z, b.x - a.x);
    glow.position.copy(strip.position).setY(0.03);
    glow.scale.set(1, 1, 1);
    group.add(glow);
  }

  // start gantry (F1-style lights)
  const startLights: THREE.Mesh[] = [];
  {
    // in front of the car, but never out on the ramp itself (short run-ups)
    const f = track.sample(Math.max(level.startS + 2.5, Math.min(level.startS + 9, rampS - 3)));
    const H = 6.5;
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2c31, metalness: 0.8, roughness: 0.4 });
    for (const side of [-1, 1]) {
      const p = f.pos.clone().addScaledVector(f.R, side * (TRACK_HALF_WIDTH + 1.2));
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, H, 0.4), metal);
      post.position.copy(p).setY(H / 2);
      group.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 2 * TRACK_HALF_WIDTH + 3), metal);
    beam.position.copy(f.pos).setY(H);
    beam.rotation.y = -Math.atan2(f.T.z, f.T.x);
    group.add(beam);
    for (let i = 0; i < 5; i++) {
      for (const row of [0.18, -0.18]) {
        const l = new THREE.Mesh(new THREE.CircleGeometry(0.17, 16), new THREE.MeshBasicMaterial({ color: 0x220304 }));
        l.position.copy(f.pos).addScaledVector(f.R, (i - 2) * 0.75).setY(H + row);
        l.position.addScaledVector(f.T, -0.41);
        l.lookAt(l.position.clone().addScaledVector(f.T, -1));
        group.add(l);
        startLights.push(l);
      }
    }
  }

  // floodlight towers + light beams around the ramp
  const rampEnd = track.length;
  const rampMidS = (rampS + rampEnd) / 2;
  // a level frame from the runway (the ramp's own frame can point up or twist)
  const f0r = track.sample(Math.max(0, rampS - 1));
  const fm = { T: f0r.T.clone().setY(0).normalize(), R: f0r.R.clone().setY(0).normalize() };
  void rampMidS;
  const bb = new THREE.Box3();
  for (let i = 0; i < track.pos.length; i++) if (track.S[i] >= rampS) bb.expandByPoint(track.pos[i]);
  const center = bb.getCenter(new THREE.Vector3());
  const size = bb.getSize(new THREE.Vector3());
  const beamsGroup = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x24262b, metalness: 0.7, roughness: 0.5 });
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x111215, metalness: 0.6, roughness: 0.4 });
  const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.95, 2.1) });
  const beamMat = (color: THREE.Color, k: number) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uColor: { value: color }, uI: { value: k } },
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = uv.y; vec4 wp = modelMatrix*vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uI; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vec3 n = vN / max(length(vN), 1e-4); vec3 v = vV / max(length(vV), 1e-4); float edge = clamp(abs(dot(n, v)), 0.0, 1.0); float fall = pow(clamp(1.0 - vY, 0.0, 1.0) + 1e-5, 1.7); gl_FragColor = vec4(uColor * uI * fall * (0.25 + 0.75 * edge), 1.0); }`,
  });
  /** cone that starts at the lens (origin, radius r0) and widens along +Y */
  const beamGeo = (len: number, r0: number, r1: number) => {
    const g = new THREE.CylinderGeometry(r1, r0, len, 32, 1, true);
    g.translate(0, len / 2, 0);
    return g;
  };
  const UP = new THREE.Vector3(0, 1, 0);
  const corridor: THREE.Vector3[] = [];
  for (const tr of level.designTraj) for (let i = 6; i < tr.length; i += 3) corridor.push(tr[i]);
  /** true if p is within r metres of where the car flies */
  const inFlight = (p: THREE.Vector3, r: number) => corridor.some((c) => c.distanceToSquared(p) < r * r);
  /** true when nothing of the track or the landing hill is within r metres (horizontally) of p */
  const clearOfTrack = (p: THREE.Vector3, r: number) => {
    for (let i = 0; i < track.pos.length; i += 4) {
      const q = track.pos[i];
      if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 < (r + TRACK_HALF_WIDTH) ** 2) return false;
    }
    return hillHeight(level.hill, p.x, p.z) <= 0 && hillHeight(level.hill, p.x + r, p.z) <= 0 && hillHeight(level.hill, p.x - r, p.z) <= 0
      && hillHeight(level.hill, p.x, p.z + r) <= 0 && hillHeight(level.hill, p.x, p.z - r) <= 0;
  };
  /** slide a fixture outward until it stands clear of the track and the hill */
  const placeClear = (p: THREE.Vector3, out: THREE.Vector3, r: number) => {
    const o = out.clone().setY(0).normalize();
    for (let k = 0; k < 20 && !clearOfTrack(p, r); k++) p.addScaledVector(o, 4);
    return clearOfTrack(p, r);
  };
  const floodBeam = beamMat(new THREE.Color(0.8, 0.85, 1.0), 0.055);
  const flood: THREE.SpotLight[] = [];
  /** floodlight on a mast: lamp head aimed at the target, real spot light, visible beam from the lens */
  const addFlood = (pos: THREE.Vector3, target: THREE.Vector3, intensity: number, angle: number) => {
    if (track.insideLoop(pos, -6) || track.insideLoop(pos.clone().setY(1), -6)) return;
    for (let y = 0; y <= pos.y; y += 3) if (inFlight(pos.clone().setY(y), 8)) return;
    const sp = new THREE.SpotLight(0xf0f2ff, intensity, 520, angle, 0.6, 2);
    sp.position.copy(pos);
    sp.target.position.copy(target);
    group.add(sp, sp.target);
    flood.push(sp);
    const dir = target.clone().sub(pos).normalize();
    smokeLights.push({ pos: pos.clone(), color: new THREE.Color(0.9, 0.93, 1).multiplyScalar(1.6), range: 170, dir, cos: Math.cos(angle) });
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.6, pos.y, 0.6), metal);
    mast.position.set(pos.x, pos.y / 2, pos.z);
    group.add(mast);
    const head = new THREE.Group();
    head.position.copy(pos);
    head.quaternion.setFromUnitVectors(UP, dir);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.0, 2.0), housingMat);
    housing.position.y = -0.5;
    const lens = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 1.6), lensMat);
    lens.position.y = 0.02;
    const len = pos.distanceTo(target) * 0.6;
    const beam = new THREE.Mesh(beamGeo(len, 1.2, Math.tan(angle) * len * 0.9 + 1.2), floodBeam);
    head.add(housing, lens, beam);
    group.add(head);
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.25, 0.25), metal);
    yoke.position.copy(pos).add(new THREE.Vector3(0, -0.9, 0));
    yoke.lookAt(target.x, yoke.position.y, target.z);
    group.add(yoke);
  };
  {
    const aim = center.clone().setY(Math.max(4, center.y * 0.7));
    const off = size.z / 2 + 38;
    for (const side of [-1, 1])
      for (const along of [-0.35, 0.45]) {
        const p = center.clone().addScaledVector(fm.R, side * off).addScaledVector(fm.T, along * Math.max(40, size.x)).setY(30);
        if (!placeClear(p, fm.R.clone().multiplyScalar(side), 6)) continue;
        addFlood(p, aim, 6500, 0.4);
      }
    // landing hill, lit from both sides
    const hd = new THREE.Vector3(level.hill.dir.x, 0, level.hill.dir.y);
    const hp = level.hill.origin.clone().addScaledVector(hd, level.hill.targetU);
    hp.y = 0;
    for (const side of [-1, 1]) {
      const lp = hp.clone().add(new THREE.Vector3(-hd.z * 48 * side, 34, hd.x * 48 * side)).addScaledVector(hd, -15 * side);
      if (!placeClear(lp, new THREE.Vector3(-hd.z * side, 0, hd.x * side), 6)) continue;
      addFlood(lp, hp.clone().setY(8), 6000, 0.48);
    }
    // sky searchlights on both sides of the ramp: housing and beam move together
    const skyMat = beamMat(new THREE.Color(0.75, 0.82, 1.0), 0.07);
    const skyGeo = beamGeo(170, 0.42, 5.5);
    for (const side of [-1, 1]) {
      const base = new THREE.Vector3(center.x, 0, center.z).addScaledVector(fm.R, side * (size.z / 2 + 18));
      // the whole bank of four must stand clear of the road, so slide it out together
      const o = fm.R.clone().multiplyScalar(side).setY(0).normalize();
      for (let k = 0; k < 20; k++) {
        let ok = true;
        for (let i = 0; i < 4 && ok; i++) ok = clearOfTrack(base.clone().addScaledVector(fm.T, (i - 1.5) * 5), 5);
        if (ok) break;
        base.addScaledVector(o, 4);
      }
      for (let i = 0; i < 4; i++) {
        const fix = new THREE.Group();
        fix.position.copy(base).addScaledVector(fm.T, (i - 1.5) * 5).setY(0.6);
        if (track.insideLoop(fix.position, -5)) continue;
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1.0, 20), housingMat);
        can.position.y = -0.5;
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.44, 20), lensMat);
        lens.rotation.x = -Math.PI / 2;
        lens.position.y = 0.01;
        fix.add(can, lens, new THREE.Mesh(skyGeo, skyMat));
        const stand = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 1.4), metal);
        stand.position.copy(fix.position).setY(0.3);
        group.add(stand);
        fix.userData.phase = i * 0.9 + (side > 0 ? 2 : 0);
        fix.userData.tilt = side * (0.18 + i * 0.07);
        fix.userData.lean = (i - 1.5) * 0.12;
        beamsGroup.add(fix);
      }
    }
    group.add(beamsGroup);
  }
  const redFill = new THREE.PointLight(0xff1020, 400, 120, 2);
  redFill.position.set(center.x, 3, center.z - size.z / 2 - 14);
  group.add(redFill);
  smokeLights.push({ pos: redFill.position.clone(), color: new THREE.Color(1, 0.06, 0.1).multiplyScalar(0.8), range: 40 });

  // cinematic camera stations
  const stations: LevelScene['cameraStations'] = [];
  {
    const f0 = track.sample(level.startS + 30);
    stations.push({ pos: f0.pos.clone().addScaledVector(f0.R, -18).add(new THREE.Vector3(0, 2.5, 0)).addScaledVector(f0.T, 25), focus: f0.pos.clone(), radius: 40 });
    const dist = Math.max(55, Math.max(size.x, size.y) * 1.25);
    stations.push({ pos: center.clone().addScaledVector(fm.R, -dist).setY(Math.max(6, center.y * 0.6)).addScaledVector(fm.T, -10), focus: center.clone(), radius: Math.max(size.x, size.y) * 0.8 + 20 });
    // mid flight
    const traj = level.designTraj[1];
    const mid = traj[Math.floor(traj.length * 0.45)];
    const hdir = new THREE.Vector3(level.hill.dir.x, 0, level.hill.dir.y);
    const hperp = new THREE.Vector3(-hdir.z, 0, hdir.x);
    stations.push({ pos: mid.clone().addScaledVector(hperp, -70).setY(Math.max(8, mid.y * 0.7)), focus: mid.clone(), radius: 60 });
    const land = level.hill.origin.clone().addScaledVector(hdir, level.hill.targetU);
    land.y = 0;
    stations.push({ pos: land.clone().addScaledVector(hperp, -42).addScaledVector(hdir, 30).setY(10), focus: land.clone(), radius: 70 });
  }

  const lamps: THREE.Object3D[] = [];
  group.traverse((o) => { if (o.userData.blink !== undefined) lamps.push(o); });

  return {
    group,
    startLights,
    cameraStations: stations,
    smokeLights,
    setStartLights(n, color) {
      startLights.forEach((l, i) => {
        const on = Math.floor(i / 2) < n && color !== 'off';
        (l.material as THREE.MeshBasicMaterial).color.copy(on ? NEON_RED.clone().multiplyScalar(5) : new THREE.Color(0x200304));
      });
    },
    update(t) {
      beamsGroup.children.forEach((c) => {
        const u = c.userData;
        c.rotation.set(Math.sin(t * 0.27 + u.phase * 1.3) * 0.1 + u.tilt, 0, u.lean + Math.sin(t * 0.35 + u.phase) * 0.12, 'XYZ');
      });
      for (const l of lamps) l.visible = Math.sin(t * 2.2 + l.userData.blink) > -0.2;
      const zone = hillG.userData.zone as THREE.Mesh;
      if (zone) (zone.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.08 * Math.sin(t * 3);
    },
  };
}
