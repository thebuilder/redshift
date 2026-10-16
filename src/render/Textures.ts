import * as THREE from 'three';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  return { c, g };
}

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, count: number, r: () => number, alpha: number, light = false) {
  for (let i = 0; i < count; i++) {
    const x = r() * w, y = r() * h, s = 0.5 + r() * 2.5;
    const v = light ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    g.fillRect(x, y, s, s);
  }
}

/** Light concrete road surface. u across the 10 m width, v = 20 m along. */
export function concreteTexture(): THREE.Texture {
  const W = 1024, H = 1024;
  const { c, g } = canvas(W, H);
  const r = rand(7);
  g.fillStyle = '#b9b9b6';
  g.fillRect(0, 0, W, H);
  // blotches
  for (let i = 0; i < 260; i++) {
    const x = r() * W, y = r() * H, rad = 20 + r() * 120;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const d = r() < 0.5;
    grd.addColorStop(0, d ? 'rgba(90,90,90,0.08)' : 'rgba(255,255,255,0.07)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  noise(g, W, H, 60000, r, 0.18);
  noise(g, W, H, 30000, r, 0.15, true);
  // panel seams every 5 m
  g.fillStyle = 'rgba(40,40,40,0.35)';
  for (let k = 0; k < 4; k++) g.fillRect(0, (k * H) / 4, W, 2);
  g.fillRect(W / 2 - 1, 0, 2, H);
  // tyre marks
  for (let i = 0; i < 14; i++) {
    const x = W * (0.3 + r() * 0.4);
    g.fillStyle = `rgba(20,20,20,${0.04 + r() * 0.06})`;
    g.fillRect(x, 0, 6 + r() * 10, H);
  }
  // lane paint
  const line = (u: number, wpx: number, col: string, dash = 0) => {
    g.fillStyle = col;
    if (!dash) g.fillRect(u * W - wpx / 2, 0, wpx, H);
    else for (let y = 0; y < H; y += dash * 2) g.fillRect(u * W - wpx / 2, y, wpx, dash);
  };
  line(0.335, 9, 'rgba(250,250,250,0.92)');
  line(0.665, 9, 'rgba(250,250,250,0.92)');
  line(0.04, 14, 'rgba(200,20,30,0.85)');
  line(0.96, 14, 'rgba(200,20,30,0.85)');
  noise(g, W, H, 9000, r, 0.25);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Plain concrete for landing hills (no lane lines). */
export function slabTexture(): THREE.Texture {
  const W = 512, H = 512;
  const { c, g } = canvas(W, H);
  const r = rand(11);
  g.fillStyle = '#c4c4c1';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 120; i++) {
    const x = r() * W, y = r() * H, rad = 20 + r() * 90;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, r() < 0.5 ? 'rgba(80,80,80,0.08)' : 'rgba(255,255,255,0.06)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  noise(g, W, H, 30000, r, 0.16);
  noise(g, W, H, 12000, r, 0.12, true);
  g.fillStyle = 'rgba(30,30,30,0.3)';
  g.fillRect(0, 0, W, 2);
  g.fillRect(0, 0, 2, H);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function asphaltTexture(): THREE.Texture {
  const W = 512, H = 512;
  const { c, g } = canvas(W, H);
  const r = rand(3);
  g.fillStyle = '#0d0d0f';
  g.fillRect(0, 0, W, H);
  noise(g, W, H, 40000, r, 0.25, true);
  noise(g, W, H, 20000, r, 0.4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function rimTexture(): THREE.Texture {
  const S = 256;
  const { c, g } = canvas(S, S);
  const cx = S / 2;
  g.fillStyle = '#0b0b0c';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#d9d9d6';
  g.beginPath();
  g.arc(cx, cx, S * 0.47, 0, Math.PI * 2);
  g.fill();
  // turbine spokes
  g.fillStyle = '#151517';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.save();
    g.translate(cx, cx);
    g.rotate(a);
    g.beginPath();
    g.moveTo(S * 0.06, -S * 0.02);
    g.quadraticCurveTo(S * 0.25, -S * 0.1, S * 0.45, -S * 0.02);
    g.lineTo(S * 0.45, S * 0.05);
    g.quadraticCurveTo(S * 0.25, -S * 0.01, S * 0.06, S * 0.04);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.strokeStyle = '#ff2236';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cx, S * 0.1, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#222';
  g.beginPath();
  g.arc(cx, cx, S * 0.07, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Soft radial gradient (for glows, smoke, light pools) */
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128, stops?: [number, string][]): THREE.Texture {
  const { c, g } = canvas(size, size);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  if (stops) for (const [o, col] of stops) grd.addColorStop(o, col);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function smokeTexture(): THREE.Texture {
  const S = 128;
  const { c, g } = canvas(S, S);
  const r = rand(5);
  for (let i = 0; i < 26; i++) {
    const x = S / 2 + (r() - 0.5) * S * 0.4, y = S / 2 + (r() - 0.5) * S * 0.4;
    const rad = S * (0.15 + r() * 0.25);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.22)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function textTexture(text: string, opts: { w?: number; h?: number; font?: string; color?: string; bg?: string } = {}) {
  const w = opts.w ?? 512, h = opts.h ?? 128;
  const { c, g } = canvas(w, h);
  if (opts.bg) { g.fillStyle = opts.bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = opts.color ?? '#fff';
  g.font = opts.font ?? `700 ${Math.floor(h * 0.7)}px "Chakra Petch", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** dark steel panelling for the sides of landing structures: 1 m panels, seams and bolts */
export function wallTexture(): THREE.Texture {
  const S = 512;
  const { c, g } = canvas(S, S);
  const r = rand(21);
  g.fillStyle = '#1b1c21';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const k = 0.9 + r() * 0.2;
      g.fillStyle = `rgba(${Math.round(30 * k)},${Math.round(31 * k)},${Math.round(37 * k)},1)`;
      g.fillRect(i * 128 + 3, j * 128 + 3, 122, 122);
    }
  noise(g, S, S, 14000, r, 0.25);
  noise(g, S, S, 6000, r, 0.06, true);
  g.fillStyle = 'rgba(0,0,0,0.85)';
  for (let i = 0; i <= 4; i++) { g.fillRect(i * 128 - 2, 0, 4, S); g.fillRect(0, i * 128 - 2, S, 4); }
  g.fillStyle = 'rgba(120,120,130,0.45)';
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (const [dx, dy] of [[10, 10], [118, 10], [10, 118], [118, 118]]) g.fillRect(i * 128 + dx - 2, j * 128 + dy - 2, 4, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
