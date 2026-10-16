export interface RawInput {
  up: number;
  down: number;
  left: number;
  right: number;
  yawL: number;
  yawR: number;
  lift: number;
  /** analog stick (gamepad) overrides: -1..1 */
  stickX: number;
  stickY: number;
  throttle: number;
  brake: number;
}

export type Action = 'restart' | 'camera' | 'assist' | 'guide' | 'pause' | 'confirm' | 'next' | 'mute' | 'back' | 'left' | 'right' | 'upNav' | 'downNav';

const KEYMAP: Record<string, Action> = {
  KeyR: 'restart', KeyC: 'camera', KeyF: 'assist', KeyG: 'guide', Escape: 'pause', KeyP: 'pause',
  Enter: 'confirm', KeyN: 'next', KeyM: 'mute', Backspace: 'back',
};

import type { TouchState } from '../ui/Touch';

export class Input {
  private keys = new Set<string>();
  /** on-screen touch controls, when the device has them */
  touch: TouchState | null = null;
  private actions: Action[] = [];
  private padPrev: boolean[] = [];
  usingPad = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      this.usingPad = false;
      const a = KEYMAP[e.code];
      if (a) this.actions.push(a);
      if (e.code === 'ArrowLeft') this.actions.push('left');
      if (e.code === 'ArrowRight') this.actions.push('right');
      if (e.code === 'ArrowUp') this.actions.push('upNav');
      if (e.code === 'ArrowDown') this.actions.push('downNav');
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private k(...codes: string[]) {
    for (const c of codes) if (this.keys.has(c)) return 1;
    return 0;
  }

  read(): RawInput {
    const r: RawInput = {
      up: this.k('KeyW', 'ArrowUp'),
      down: this.k('KeyS', 'ArrowDown'),
      left: this.k('KeyA', 'ArrowLeft'),
      right: this.k('KeyD', 'ArrowRight'),
      yawL: this.k('KeyQ'),
      yawR: this.k('KeyE'),
      lift: this.k('Space'),
      stickX: 0, stickY: 0, throttle: 0, brake: 0,
    };
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const lx = dz(p.axes[0] ?? 0), ly = dz(p.axes[1] ?? 0), rx = dz(p.axes[2] ?? 0);
      const bt = (i: number) => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
      const any = Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + p.buttons.reduce((s, b) => s + b.value, 0) > 0.05;
      if (any) this.usingPad = true;
      r.stickX += lx;
      r.stickY += ly;
      r.throttle = Math.max(r.throttle, bt(7));
      r.brake = Math.max(r.brake, bt(6));
      r.lift = Math.max(r.lift, bt(0));
      r.yawL = Math.max(r.yawL, bt(4), rx < 0 ? -rx : 0);
      r.yawR = Math.max(r.yawR, bt(5), rx > 0 ? rx : 0);
      const map: [number, Action][] = [[3, 'camera'], [2, 'assist'], [9, 'pause'], [8, 'restart'], [1, 'back'], [0, 'confirm'], [14, 'left'], [15, 'right'], [12, 'upNav'], [13, 'downNav']];
      for (const [i, a] of map) {
        const pressed = !!p.buttons[i]?.pressed;
        if (pressed && !this.padPrev[i]) this.actions.push(a);
        this.padPrev[i] = pressed;
      }
      break;
    }
    const t = this.touch;
    if (t) {
      r.stickX += t.stickX;
      r.stickY += t.stickY;
      r.throttle = Math.max(r.throttle, t.throttle);
      r.brake = Math.max(r.brake, t.brake);
      r.lift = Math.max(r.lift, t.lift);
      r.yawL = Math.max(r.yawL, t.yawL);
      r.yawR = Math.max(r.yawR, t.yawR);
    }
    return r;
  }

  push(a: Action) { this.actions.push(a); }

  consume(): Action[] {
    const a = this.actions;
    this.actions = [];
    return a;
  }
}
