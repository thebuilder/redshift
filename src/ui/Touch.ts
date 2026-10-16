import type { Action } from '../core/Input';

/** Analog/held state the touch controls feed into the input system */
export interface TouchState {
  stickX: number;
  stickY: number;
  throttle: number;
  brake: number;
  lift: number;
  yawL: number;
  yawR: number;
}

export type TouchMode = 'hidden' | 'ground' | 'air';

/**
 * On-screen controls for phones and tablets.
 *
 * Left thumb: a floating stick that appears wherever it lands (steer on the ground,
 * pitch and roll in the air). Right thumb: the big button is THROTTLE on the ground and
 * becomes LIFT (belly blasts) once airborne, with BRAKE beside it on the ground and the two
 * YAW blasts above it in the air. Camera, retry and pause sit in the top corner.
 */
export class TouchControls {
  readonly state: TouchState = { stickX: 0, stickY: 0, throttle: 0, brake: 0, lift: 0, yawL: 0, yawR: 0 };
  private root: HTMLDivElement;
  private zone: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickLabel: HTMLDivElement;
  private stickId = -1;
  private ox = 0;
  private oy = 0;
  private mode: TouchMode = 'hidden';
  private readonly R = 58; // stick travel in px

  constructor(private push: (a: Action) => void) {
    const root = document.createElement('div');
    root.id = 'touch';
    root.className = 'hidden';
    root.innerHTML = `
      <div class="t-zone"><div class="t-hint">STEER</div></div>
      <div class="t-base"><div class="t-knob"></div></div>
      <button class="t-btn t-primary t-thr" data-k="throttle"><span>THROTTLE</span></button>
      <button class="t-btn t-second t-brk" data-k="brake"><span>BRAKE</span></button>
      <button class="t-btn t-primary t-lift" data-k="lift"><span>LIFT</span></button>
      <button class="t-btn t-yaw t-yawl" data-k="yawL"><span>&#9664; YAW</span></button>
      <button class="t-btn t-yaw t-yawr" data-k="yawR"><span>YAW &#9654;</span></button>
      <div class="t-top">
        <button class="t-sys" data-a="camera" aria-label="Camera">CAM</button>
        <button class="t-sys" data-a="restart" aria-label="Retry">&#8635;</button>
        <button class="t-sys" data-a="pause" aria-label="Pause">II</button>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.zone = root.querySelector('.t-zone')!;
    this.base = root.querySelector('.t-base')!;
    this.knob = root.querySelector('.t-knob')!;
    this.stickLabel = root.querySelector('.t-hint')!;

    // held buttons: each keeps its own pointer, so several can be held at once
    root.querySelectorAll<HTMLButtonElement>('.t-btn').forEach((b) => {
      const k = b.dataset.k as keyof TouchState;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        this.state[k] = 1;
        b.classList.add('on');
        if (navigator.vibrate) navigator.vibrate(k === 'lift' ? 12 : 6);
      };
      const up = (e: PointerEvent) => {
        e.preventDefault();
        this.state[k] = 0;
        b.classList.remove('on');
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
    });
    root.querySelectorAll<HTMLButtonElement>('.t-sys').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.push(b.dataset.a as Action);
        if (navigator.vibrate) navigator.vibrate(5);
      });
    });

    // floating stick
    this.zone.addEventListener('pointerdown', (e) => {
      if (this.stickId >= 0) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      try { this.zone.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      this.ox = e.clientX;
      this.oy = e.clientY;
      this.base.style.transform = `translate(${this.ox}px, ${this.oy}px)`;
      this.base.classList.add('on');
      this.moveKnob(0, 0);
    });
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      e.preventDefault();
      let dx = e.clientX - this.ox, dy = e.clientY - this.oy;
      const d = Math.hypot(dx, dy);
      // let the base follow a thumb that slides past the edge, so the stick never "sticks"
      if (d > this.R * 1.35) {
        const k = (d - this.R * 1.35) / d;
        this.ox += dx * k;
        this.oy += dy * k;
        this.base.style.transform = `translate(${this.ox}px, ${this.oy}px)`;
        dx = e.clientX - this.ox;
        dy = e.clientY - this.oy;
      }
      this.moveKnob(dx, dy);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.base.classList.remove('on');
      this.state.stickX = this.state.stickY = 0;
      this.knob.style.transform = '';
    };
    this.zone.addEventListener('pointerup', release);
    this.zone.addEventListener('pointercancel', release);
    this.zone.addEventListener('lostpointercapture', release);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private moveKnob(dx: number, dy: number) {
    const R = this.R;
    const d = Math.hypot(dx, dy);
    const cl = d > R ? R / d : 1;
    const kx = dx * cl, ky = dy * cl;
    this.knob.style.transform = `translate(${kx}px, ${ky}px)`;
    // small dead zone, then a gentle curve so small corrections stay small
    const shape = (v: number) => {
      const a = Math.abs(v);
      if (a < 0.08) return 0;
      const t = (a - 0.08) / 0.92;
      return Math.sign(v) * (0.35 * t + 0.65 * t * t);
    };
    this.state.stickX = shape(kx / R);
    this.state.stickY = shape(ky / R);
  }

  setMode(m: TouchMode) {
    if (m === this.mode) return;
    this.mode = m;
    this.root.classList.toggle('hidden', m === 'hidden');
    this.root.classList.toggle('air', m === 'air');
    this.root.classList.toggle('ground', m === 'ground');
    this.stickLabel.textContent = m === 'air' ? 'PITCH · ROLL' : 'STEER';
    // a button that is no longer shown must not stay held
    const shown: (keyof TouchState)[] = m === 'air' ? ['lift', 'yawL', 'yawR'] : m === 'ground' ? ['throttle', 'brake'] : [];
    for (const k of ['throttle', 'brake', 'lift', 'yawL', 'yawR'] as (keyof TouchState)[]) {
      if (!shown.includes(k)) this.state[k] = 0;
    }
    this.root.querySelectorAll<HTMLElement>('.t-btn').forEach((b) => {
      if (!shown.includes(b.dataset.k as keyof TouchState)) b.classList.remove('on');
    });
    if (m === 'hidden') {
      this.state.stickX = this.state.stickY = 0;
      this.stickId = -1;
      this.base.classList.remove('on');
    }
  }
}
