import * as THREE from 'three';
import { CarSim, EXHAUSTS, NOZZLES, SPEC } from '../physics/CarSim';
import { Guidance } from '../render/Guidance';

const $ = (id: string) => document.getElementById(id)!;
const NS = 'http://www.w3.org/2000/svg';

function arcPath(f: number, r = 54) {
  const a0 = (135 * Math.PI) / 180;
  const sweep = 270 * Math.max(0.0001, Math.min(1, f));
  const a1 = a0 + (sweep * Math.PI) / 180;
  const x0 = 60 + r * Math.cos(a0), y0 = 60 + r * Math.sin(a0);
  const x1 = 60 + r * Math.cos(a1), y1 = 60 + r * Math.sin(a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

class Gauge {
  private val: SVGPathElement;
  private root: HTMLElement;
  private last = -1;
  constructor(id: string) {
    this.root = $(id);
    const svg = this.root.querySelector('svg')!;
    (svg.querySelector('.g-bg') as SVGPathElement).setAttribute('d', arcPath(1));
    this.val = svg.querySelector('.g-val') as SVGPathElement;
    const ticks = svg.querySelector('.ticks')!;
    for (let i = 0; i <= 27; i++) {
      const a = ((135 + (270 * i) / 27) * Math.PI) / 180;
      const l = document.createElementNS(NS, 'line');
      const r0 = i % 3 === 0 ? 45 : 47.5;
      l.setAttribute('x1', `${60 + r0 * Math.cos(a)}`);
      l.setAttribute('y1', `${60 + r0 * Math.sin(a)}`);
      l.setAttribute('x2', `${60 + 50 * Math.cos(a)}`);
      l.setAttribute('y2', `${60 + 50 * Math.sin(a)}`);
      ticks.appendChild(l);
    }
  }
  set(f: number, hot = false) {
    const q = Math.round(f * 400) / 400;
    if (q !== this.last) { this.val.setAttribute('d', arcPath(q)); this.last = q; }
    this.root.classList.toggle('hot', hot);
  }
}

function plume(svg: SVGSVGElement, x: number, y: number, dx: number, dy: number, len = 17, w = 7) {
  const px = -dy, py = dx;
  const p = document.createElementNS(NS, 'path');
  const tipx = x + dx * len, tipy = y + dy * len;
  p.setAttribute('d', `M ${x + px * 1.2} ${y + py * 1.2} L ${tipx + px * w * 0.5} ${tipy + py * w * 0.5} Q ${tipx + dx * 3} ${tipy + dy * 3} ${tipx - px * w * 0.5} ${tipy - py * w * 0.5} L ${x - px * 1.2} ${y - py * 1.2} Z`);
  p.setAttribute('class', 'ex-plume');
  svg.appendChild(p);
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('cx', `${x}`); c.setAttribute('cy', `${y}`); c.setAttribute('r', '1.6');
  c.setAttribute('class', 'ex-port');
  svg.appendChild(c);
  return p;
}

function shape(svg: SVGSVGElement, d: string, cls: string) {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('class', cls);
  svg.appendChild(p);
}
function caption(svg: SVGSVGElement, text: string, x: number, y: number) {
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', `${x}`); t.setAttribute('y', `${y}`); t.setAttribute('class', 'ex-cap'); t.setAttribute('text-anchor', 'middle');
  t.textContent = text;
  svg.appendChild(t);
}

export class Hud {
  root = $('hud');
  private speed = new Gauge('g-speed');
  private force = new Gauge('g-force');
  private alt = new Gauge('g-alt');
  private plumes: { el: SVGPathElement; idx: number[] }[] = [];
  private msgEl = $('h-msg');
  private subEl = $('h-sub');
  private msgTimer = 0;
  private els = {
    speed: $('v-speed'), mph: $('v-mph'), g: $('v-g'), df: $('v-df'), alt: $('v-alt'), vs: $('v-vs'),
    pitch: $('v-pitch'), roll: $('v-roll'), yaw: $('v-yaw'), active: $('v-active'), tank: $('v-tank'), tankp: $('v-tankp'),
    phase: $('h-phase'), time: $('h-time'), cam: $('h-cam'), assist: $('h-assist'), guide: $('h-guide'),
    align: $('v-align'), impact: $('v-impact'), tti: $('v-tti'), keys: $('h-keys'),
  };
  private lastText = new Map<HTMLElement, string>();
  private sm = { align: 0, impact: 0, tti: 0, on: false };

  constructor() {
    this.buildExhaust();
  }

  private buildExhaust() {
    const defs = '';
    const top = $('ex-top') as unknown as SVGSVGElement;
    top.innerHTML = defs;
    shape(top, 'M 33 12 L 47 12 L 56 24 L 57 82 L 53 88 L 27 88 L 23 82 L 24 24 Z', 'ex-body');
    shape(top, 'M 30 34 L 50 34 L 52 66 L 28 66 Z', 'ex-glass');
    caption(top, 'TOP · YAW', 40, 100);
    this.plumes.push({ el: plume(top, 24, 22, -1, 0), idx: [8] });
    this.plumes.push({ el: plume(top, 56, 22, 1, 0), idx: [9] });
    this.plumes.push({ el: plume(top, 23, 80, -1, 0), idx: [10] });
    this.plumes.push({ el: plume(top, 57, 80, 1, 0), idx: [11] });
    this.plumes.push({ el: plume(top, 40, 89, 0, 1, 6, 14), idx: [-1] }); // rear launch exhausts

    const side = $('ex-side') as unknown as SVGSVGElement;
    side.innerHTML = defs;
    shape(side, 'M 8 50 L 8 34 L 26 30 L 44 20 L 60 20 L 72 32 L 90 40 L 90 48 L 86 52 L 12 52 Z', 'ex-body');
    shape(side, 'M 30 30 L 45 22 L 58 22 L 68 32 Z', 'ex-glass');
    caption(side, 'SIDE · PITCH · LIFT', 48, 80);
    this.plumes.push({ el: plume(side, 76, 52, 0, 1, 18, 8), idx: [0, 1] });
    this.plumes.push({ el: plume(side, 20, 52, 0, 1, 18, 8), idx: [2, 3] });
    this.plumes.push({ el: plume(side, 72, 33, 0, -1), idx: [4, 5] });
    this.plumes.push({ el: plume(side, 18, 32, 0, -1), idx: [6, 7] });
    this.plumes.push({ el: plume(side, 8, 46, -1, 0, 7, 6), idx: [-1] }); // rear launch exhausts

    const rear = $('ex-rear') as unknown as SVGSVGElement;
    rear.innerHTML = defs;
    shape(rear, 'M 14 56 L 14 40 L 22 34 L 28 22 L 52 22 L 58 34 L 66 40 L 66 56 Z', 'ex-body');
    shape(rear, 'M 30 24 L 50 24 L 55 34 L 25 34 Z', 'ex-glass');
    caption(rear, 'REAR · ROLL', 40, 80);
    this.plumes.push({ el: plume(rear, 20, 56, 0, 1), idx: [0, 2] });
    this.plumes.push({ el: plume(rear, 60, 56, 0, 1), idx: [1, 3] });
    this.plumes.push({ el: plume(rear, 22, 35, 0, -1), idx: [4, 6] });
    this.plumes.push({ el: plume(rear, 58, 35, 0, -1), idx: [5, 7] });
  }

  private text(el: HTMLElement, s: string) {
    if (this.lastText.get(el) === s) return;
    this.lastText.set(el, s);
    el.textContent = s;
  }

  show(on: boolean) { this.root.classList.toggle('hidden', !on); }

  message(text: string, sub = '', dur = 1.6, red = false) {
    this.msgEl.textContent = text;
    this.subEl.textContent = sub;
    this.msgEl.classList.toggle('red', red);
    this.msgEl.classList.add('show');
    this.subEl.classList.toggle('show', !!sub);
    this.msgTimer = dur;
  }
  clearMessage() { this.msgTimer = 0; this.msgEl.classList.remove('show'); this.subEl.classList.remove('show'); }

  setLevel(num: number, name: string) {
    this.text($('h-lvlnum'), String(num).padStart(2, '0'));
    this.text($('h-lvlname'), name);
  }
  setCam(mode: string) { this.text(this.els.cam, `CAM · ${mode.toUpperCase()}`); }
  setAssist(on: boolean) {
    this.text(this.els.assist, on ? 'ASSIST · RATE' : 'ASSIST · OFF');
    this.els.assist.classList.toggle('on', on);
  }
  setKeys(html: string) { this.els.keys.innerHTML = html; this.els.keys.classList.remove('fade'); }
  fadeKeys() { this.els.keys.classList.add('fade'); }

  update(dt: number, sim: CarSim, runTime: number, phaseLabel: string, guide: Guidance) {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) { this.msgEl.classList.remove('show'); this.subEl.classList.remove('show'); }
    }
    const sp = sim.speed;
    const kmh = sp * 3.6;
    this.text(this.els.speed, kmh.toFixed(0));
    this.text(this.els.mph, (sp * 2.23694).toFixed(0));
    this.speed.set(kmh / 400, kmh > 300);
    const g = sim.gForce;
    this.text(this.els.g, g < 10 ? g.toFixed(1) : g.toFixed(0));
    this.force.set(g / 12, g > 8);
    const dfKg = sim.phase === 'rail' ? sim.downforce / 9.81 : sim.normalForce / 9.81;
    this.text(this.els.df, dfKg.toFixed(0));
    const alt = sim.altitude();
    this.text(this.els.alt, alt < 100 ? alt.toFixed(1) : alt.toFixed(0));
    this.alt.set(alt / 120, alt > 60);
    this.text(this.els.vs, sim.vel.y.toFixed(1));
    // attitude: pitch and roll relative to the horizon
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(sim.quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(sim.quat);
    const right = new THREE.Vector3(0, 0, 1).applyQuaternion(sim.quat);
    const pitch = THREE.MathUtils.radToDeg(Math.atan2(fwd.y, Math.hypot(fwd.x, fwd.z)));
    let roll = THREE.MathUtils.radToDeg(Math.atan2(-right.y, up.y));
    if (Math.abs(roll) > 179.5) roll = 180;
    this.text(this.els.pitch, pitch.toFixed(0));
    this.text(this.els.roll, roll.toFixed(0));
    const wb = sim.angVel.clone().applyQuaternion(sim.quat.clone().invert());
    this.text(this.els.yaw, THREE.MathUtils.radToDeg(-wb.y).toFixed(0));
    // exhausts
    let active = 0;
    for (let i = 0; i < NOZZLES.length; i++) if (sim.nozzle[i] > 30) active++;
    if (sim.exhaust > 0.05) active += EXHAUSTS.length;
    this.text(this.els.active, `${active} / ${NOZZLES.length + EXHAUSTS.length}`);
    for (const p of this.plumes) {
      let f = 0;
      for (const i of p.idx) f = Math.max(f, i < 0 ? sim.exhaust : sim.nozzle[i] / 1500);
      const o = Math.min(1, f);
      p.el.style.opacity = o.toFixed(2);
      p.el.style.transform = '';
    }
    const tank = sim.airFrac;
    this.els.tank.style.transform = `scaleX(${tank.toFixed(3)})`;
    this.text(this.els.tankp, `${(tank * 100).toFixed(0)}%`);
    this.text(this.els.phase, phaseLabel);
    this.els.phase.classList.toggle('on', sim.phase === 'air');
    this.text(this.els.time, runTime.toFixed(2));
    // guidance strip
    const showGuide = sim.phase === 'air' && guide.enabled && !!guide.prediction?.hit;
    this.els.guide.classList.toggle('hidden', !showGuide);
    if (showGuide) {
      // low-pass the readouts so they settle instead of flickering frame to frame
      const sm = this.sm;
      if (!sm.on) { sm.align = guide.alignError; sm.impact = guide.impactSpeed; sm.tti = guide.timeToImpact; sm.on = true; }
      const k = 1 - Math.exp(-dt / 0.35);
      sm.align += (guide.alignError - sm.align) * k;
      sm.impact += (guide.impactSpeed - sm.impact) * k;
      sm.tti = Math.abs(guide.timeToImpact - sm.tti) > 0.6 ? guide.timeToImpact : sm.tti + (guide.timeToImpact - sm.tti) * Math.min(1, k * 3);
      this.text(this.els.align, `${Math.round(sm.align / 2) * 2}°`);
      this.els.align.classList.toggle('bad', sm.align > 20);
      this.text(this.els.impact, (Math.round(sm.impact * 2) / 2).toFixed(1));
      this.els.impact.classList.toggle('bad', sm.impact > 8);
      this.text(this.els.tti, sm.tti.toFixed(1));
    } else this.sm.on = false;
    void SPEC;
  }
}
