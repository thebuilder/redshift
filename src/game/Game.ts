import * as THREE from 'three';
import { LEVELS } from '../levels/levels';
import { buildLevel, BuiltLevel } from '../levels/LevelBuilder';
import { CarSim, emptyInput, NOZZLES, SPEC, CarInput, EXHAUSTS } from '../physics/CarSim';
import { Autopilot } from './Autopilot';
import { scoreRun, saveBest, loadBest, RunResult } from './Scoring';
import { buildStaticWorld, buildLevelScene, makeEnvironment, LevelScene, WorldStatic } from '../render/World';
import { createCar, CarVisual } from '../render/CarModel';
import { createEffects } from '../render/Particles';
import { Smoke, SmokeLight } from '../render/Smoke';
import { PostFX } from '../render/PostFX';
import { CameraRig, CAM_MODES } from '../render/CameraRig';
import { Guidance } from '../render/Guidance';
import { Hud } from '../ui/Hud';
import { Attitude } from '../ui/Attitude';
import { Input, Action } from '../core/Input';
import { Audio } from '../core/Audio';
import { profilePaths } from '../ui/Profile';
import { IS_TOUCH, QUALITY } from '../core/Device';
import { TouchControls } from '../ui/Touch';

/** level hints name keyboard keys; on a touch screen, name the on-screen controls instead */
function touchHint(h: string) {
  return h
    .replace(/W\/S pitch the nose/g, 'push the left stick up or down to pitch the nose')
    .replace(/Push W/g, 'Push the left stick up')
    .replace(/\(A\/D\)/g, '(left stick sideways)')
    .replace(/with A\/D/g, 'with the left stick')
    .replace(/\(S\)/g, '(pull the stick back)')
    .replace(/Hold SPACE/g, 'Hold LIFT')
    .replace(/SPACE/g, 'LIFT');
}

type State = 'menu' | 'intro' | 'countdown' | 'run' | 'finish' | 'result' | 'paused';
const STEP = 1 / 240;
const $ = (id: string) => document.getElementById(id)!;

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  rig: CameraRig;
  post: PostFX;
  world: WorldStatic;
  levelScene: LevelScene | null = null;
  car: CarVisual;
  fx: ReturnType<typeof createEffects>;
  smoke = new Smoke(QUALITY.smoke);
  private touch: TouchControls | null = null;
  guide = new Guidance();
  hud = new Hud();
  att: Attitude;
  input = new Input();
  audio = new Audio();
  levelIdx = 0;
  level!: BuiltLevel;
  sim!: CarSim;
  ap = new Autopilot();
  state: State = 'menu';
  prevState: State = 'menu';
  attract = true;
  stateTime = 0;
  runTime = 0;
  private acc = 0;
  private inp: CarInput = emptyInput();
  private time = 0;
  private result: RunResult | null = null;
  private camIdx = 0;
  private goAt = 0;
  private lightsShown = 0;
  private emitCarry = new Float32Array(48);
  /** where each nozzle was last frame, so plume puffs are laid down along its path instead of in clumps */
  private nozPrev = NOZZLES.map(() => new THREE.Vector3());
  private nozPrevOk = NOZZLES.map(() => false);
  private exPrev = EXHAUSTS.map(() => new THREE.Vector3());
  private exPrevOk = EXHAUSTS.map(() => false);
  private launchBurst = false;
  private menuSel = 0;
  private flash = 0;
  private assistPref = true;
  private keysShownAt = 0;
  private attractEnd = 0;
  // render interpolation between the last two physics steps (removes stepping jitter at speed)
  private alpha = 1;
  private prev = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), s: 0, lat: 0, valid: false };
  private cur = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), s: 0, lat: 0 };
  private snapPrev() {
    const p = this.prev, s = this.sim;
    p.pos.copy(s.pos); p.quat.copy(s.quat); p.s = s.s; p.lat = s.lat; p.valid = true;
  }
  private applyInterp() {
    const s = this.sim, c = this.cur, p = this.prev;
    c.pos.copy(s.pos); c.quat.copy(s.quat); c.s = s.s; c.lat = s.lat;
    if (!p.valid || this.alpha >= 1 || p.pos.distanceToSquared(c.pos) > 100) return;
    const a = this.alpha;
    s.pos.lerpVectors(p.pos, c.pos, a);
    s.quat.slerpQuaternions(p.quat, c.quat, a);
    s.s = p.s + (c.s - p.s) * a;
    s.lat = p.lat + (c.lat - p.lat) * a;
  }
  private restoreInterp() {
    const s = this.sim, c = this.cur;
    s.pos.copy(c.pos); s.quat.copy(c.quat); s.s = c.s; s.lat = c.lat;
  }
  private wheelW = new Float32Array(4); // visual wheel angular speed (rad/s)
  private skid = new Float32Array(4);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const env = makeEnvironment(this.renderer);
    this.scene.environment = env;
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x030203, 0.0021);
    this.world = buildStaticWorld();
    this.scene.add(this.world.group);
    this.car = createCar(env);
    this.scene.add(this.car.group);
    this.fx = createEffects(this.scene);
    this.scene.add(this.smoke.points);
    this.scene.add(this.guide.group);
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.post = new PostFX(this.renderer, this.scene, this.rig.camera);
    this.att = new Attitude($('att-view'));
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.buildMenu();
    this.bindButtons();
    $('m-mute').addEventListener('click', () => this.toggleMute());
    $('intro').addEventListener('click', () => { if (this.state === 'intro') { this.audio.init(); this.enterCountdown(); } });
    // any key (except Esc, which goes back) starts the ramp from the intro card
    window.addEventListener('keydown', (e) => {
      if (this.state !== 'intro' || this.attract || e.repeat || e.code === 'Escape' || e.code === 'Backspace') return;
      if (this.stateTime < 0.25) return;
      this.audio.init();
      this.enterCountdown();
    });
    const unlock = () => { this.audio.init(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('touchend', unlock);
    window.addEventListener('keydown', unlock);
    // touch devices get on-screen controls; a hybrid laptop gets them on its first touch
    if (IS_TOUCH) this.enableTouch();
    else window.addEventListener('touchstart', () => this.enableTouch(), { once: true, passive: true });
    // leaving the app (or switching tabs) mid-run pauses it
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.state === 'run' || this.state === 'countdown')) this.togglePause();
    });
    const params = new URLSearchParams(location.search);
    const lvl = Number(params.get('level') || 0);
    const cam = params.get('cam');
    if (cam && CAM_MODES.includes(cam as any)) { this.camIdx = CAM_MODES.indexOf(cam as any); }
    if (lvl >= 1 && lvl <= LEVELS.length) {
      this.loadLevel(lvl - 1);
      this.attract = params.get('auto') === '1';
      this.enterIntro();
    } else {
      this.loadLevel(0);
      this.startAttract();
    }
    (window as any).__redshift = this;
    if (location.hash === '#cartest') this.startCarTest();
  }

  // ------------------------------------------------------------------ setup
  private enableTouch() {
    if (this.touch) return;
    this.touch = new TouchControls((a) => this.input.push(a));
    this.input.touch = this.touch.state;
    document.body.classList.add('touch');
    $('m-mute').textContent = this.audio.muted ? 'Sound off' : 'Sound on';
    document.querySelector('.intro-go')!.textContent = 'Tap to start';
  }

  /** which on-screen controls make sense right now */
  private updateTouch() {
    if (!this.touch) return;
    const live = !this.attract && (this.state === 'countdown' || this.state === 'run' || (this.state === 'finish' && this.sim.phase !== 'crashed'));
    const s = this.sim;
    const ground = s.phase === 'rail' || s.grounded || s.phase === 'landed';
    this.touch.setMode(!live ? 'hidden' : ground ? 'ground' : 'air');
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    const ph = h * this.renderer.getPixelRatio();
    for (const p of this.fx.all) p.setViewport(ph, this.rig.camera.fov);
    this.smoke.setViewport(ph, this.rig.camera.fov);
  }

  private buildMenu() {
    const host = $('levels');
    host.innerHTML = '';
    const best = loadBest();
    LEVELS.forEach((def, i) => {
      const lv = buildLevel(def);
      const p = profilePaths(lv, 200, 46, 3);
      const b = best[def.id];
      const el = document.createElement('button');
      el.className = 'lv' + (i === this.menuSel ? ' sel' : '');
      el.innerHTML = `<div class="n">${String(i + 1).padStart(2, '0')}</div><div class="t">${def.name}</div><div class="k">${def.tag}</div>
        <svg viewBox="0 0 200 46" preserveAspectRatio="xMidYMid meet">${this.profileSvg(p)}</svg>
        ${b ? `<div class="best">${b.total.toLocaleString('en-US')}<b>${b.grade}</b></div>` : ''}`;
      el.addEventListener('click', () => { this.audio.init(); this.audio.click(); this.startLevel(i); });
      el.addEventListener('mouseenter', () => { this.menuSel = i; this.markSel(); });
      host.appendChild(el);
    });
  }
  private profileSvg(p: ReturnType<typeof profilePaths>) {
    return `<path class="gr" d="${p.ground}"/><path class="hf" d="${p.hillFill}"/><path class="h" d="${p.hill}"/>` +
      `<path class="tr" d="${p.traj}"/><path class="rk" d="${p.track}"/>` +
      `<circle class="lp" cx="${p.lip.x}" cy="${p.lip.y}" r="1.6"/>` +
      `<line class="tg" x1="${p.target.x}" y1="${p.target.y - 5}" x2="${p.target.x}" y2="${p.target.y + 1}"/><circle class="tgd" cx="${p.target.x}" cy="${p.target.y - 6.5}" r="1.5"/>`;
  }

  private markSel() {
    document.querySelectorAll('.lv').forEach((e, i) => e.classList.toggle('sel', i === this.menuSel));
  }

  private bindButtons() {
    document.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => this.handleAction((b as HTMLElement).dataset.act as string));
    });
  }

  private handleAction(a: string) {
    this.audio.click();
    if (a === 'retry') this.retry();
    else if (a === 'next') this.next();
    else if (a === 'menu') this.toMenu();
    else if (a === 'resume') this.togglePause();
  }

  private screens(show: { menu?: boolean; intro?: boolean; results?: boolean; pause?: boolean; hud?: boolean }) {
    $('menu').classList.toggle('hidden', !show.menu);
    $('intro').classList.toggle('hidden', !show.intro);
    $('results').classList.toggle('hidden', !show.results);
    $('pause').classList.toggle('hidden', !show.pause);
    this.hud.show(!!show.hud);
  }

  loadLevel(i: number) {
    this.levelIdx = i;
    this.level = buildLevel(LEVELS[i]);
    if (this.levelScene) {
      this.scene.remove(this.levelScene.group);
      this.levelScene.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    this.levelScene = buildLevelScene(this.level);
    this.scene.add(this.levelScene.group);
    this.rig.stations = this.levelScene.cameraStations;
    this.smoke.lights = this.levelScene.smokeLights;
    this.hud.setLevel(i + 1, LEVELS[i].name);
    this.resetRun();
  }

  private resetRun() {
    this.sim = new CarSim(this.level.track, this.level.terrain, this.level.startS);
    this.sim.assist = this.assistPref;
    this.ap.reset();
    this.ap.skill = this.attract ? 0.85 + Math.random() * 0.15 : 1;
    this.ap.throttle = this.attract ? 0.88 + Math.random() * 0.12 : 1;
    this.runTime = 0;
    this.acc = 0;
    this.prev.valid = false;
    this.launchBurst = false;
    this.result = null;
    for (const p of this.fx.all) p.clear();
    this.smoke.clear();
    this.car.update(this.sim, 0);
    this.car.group.updateMatrixWorld();
    this.rig.snap(this.sim);
    this.levelScene?.setStartLights(0);
    this.lightsShown = 0;
    this.flash = 0;
  }

  private setState(s: State) {
    this.prevState = this.state;
    this.state = s;
    this.stateTime = 0;
    document.body.dataset.state = s;
  }

  // ------------------------------------------------------------------ flow
  startAttract() {
    this.attract = true;
    this.rig.mode = 'cinematic';
    this.rig.override = null;
    this.resetRun();
    this.setState('menu');
    this.screens({ menu: true });
    this.buildMenu();
  }

  startLevel(i: number) {
    this.attract = false;
    if (i !== this.levelIdx || !this.levelScene) this.loadLevel(i);
    this.enterIntro();
  }

  private enterIntro() {
    this.resetRun();
    const def = LEVELS[this.levelIdx];
    $('i-num').textContent = `RAMP ${String(this.levelIdx + 1).padStart(2, '0')} / ${LEVELS.length}`;
    $('i-name').textContent = def.name;
    $('i-tag').textContent = def.tag;
    $('i-hint').textContent = this.touch ? touchHint(def.hint) : def.hint;
    const p = profilePaths(this.level, 400, 120, 6);
    $('i-profile').innerHTML = this.profileSvg(p);
    this.rig.override = 'intro';
    this.setState('intro');
    this.screens({ intro: true });
    this.audio.whoosh();
  }

  private enterCountdown() {
    this.rig.override = null;
    this.rig.mode = this.attract ? 'cinematic' : CAM_MODES[this.camIdx];
    this.rig.snap(this.sim);
    this.hud.setCam(this.rig.mode);
    this.hud.setAssist(this.sim.assist);
    this.setState('countdown');
    this.goAt = 2.9 + Math.random() * 0.6;
    this.lightsShown = 0;
    this.screens({ hud: true });
    this.hud.clearMessage();
    if (this.keysShownAt < 2) {
      this.hud.setKeys(`<kbd>W</kbd> throttle &nbsp; <kbd>S</kbd> brake<br>Airborne: <kbd>W</kbd><kbd>S</kbd> pitch · <kbd>A</kbd><kbd>D</kbd> roll · <kbd>Q</kbd><kbd>E</kbd> yaw<br><kbd>Space</kbd> belly blasts · <kbd>C</kbd> camera · <kbd>R</kbd> retry`);
      this.keysShownAt++;
    } else this.hud.setKeys('');
  }

  retry() {
    if (this.state === 'menu') return;
    this.resetRun();
    this.screens({ hud: true });
    this.enterCountdown();
  }

  next() {
    if (this.levelIdx + 1 >= LEVELS.length) { this.toMenu(); return; }
    this.loadLevel(this.levelIdx + 1);
    this.enterIntro();
  }

  toMenu() {
    this.menuSel = this.levelIdx;
    this.startAttract();
  }

  togglePause() {
    if (this.state === 'paused') {
      this.state = this.prevState;
      this.screens({ hud: true });
    } else if (this.state === 'run' || this.state === 'countdown') {
      this.prevState = this.state;
      this.state = 'paused';
      this.screens({ hud: true, pause: true });
    }
  }

  // ------------------------------------------------------------------ loop
  tick(dtRaw: number) {
    const dt = Math.min(0.05, dtRaw);
    this.time += dt;
    this.stateTime += dt;
    this.updateTouch();
    const actions = this.input.consume();
    for (const a of actions) this.onAction(a);
    const raw = this.input.read();

    let simulate = false;
    switch (this.state) {
      case 'menu':
        simulate = true;
        break;
      case 'intro':
        if (this.attract && this.stateTime > 3.2) this.enterCountdown();
        break;
      case 'countdown': {
        const n = Math.min(5, Math.floor((this.stateTime - 0.4) / 0.5) + 1);
        if (n > this.lightsShown && this.stateTime > 0.4 && this.stateTime < this.goAt) {
          this.lightsShown = n;
          this.levelScene?.setStartLights(n);
          this.audio.beep(false);
        }
        if (this.stateTime >= this.goAt) {
          this.levelScene?.setStartLights(0, 'off');
          this.audio.beep(true);
          this.hud.message('GO', '', 0.8);
          this.setState('run');
        }
        break;
      }
      case 'run':
      case 'finish':
        simulate = true;
        break;
      case 'result':
        simulate = true;
        break;
      case 'paused':
        break;
    }

    this.alpha = 1;
    if (simulate) {
      this.acc += dt;
      while (this.acc >= STEP) {
        this.mapInput(raw);
        this.snapPrev();
        this.sim.step(STEP, this.inp);
        this.acc -= STEP;
      }
      this.alpha = this.acc / STEP;
      if (this.state === 'run') this.runTime += dt;
      this.handleEvents();
    } else if (this.state === 'countdown') {
      // revving at the line
      this.inp.throttle = Math.max(raw.up, raw.throttle);
    }

    if (this.state === 'finish' && this.stateTime > (this.sim.phase === 'crashed' ? 2.6 : 1.4)) this.finishRun();
    if (this.state === 'result' && this.attract && this.stateTime > 3) this.next();
    if (this.state === 'menu') {
      if (this.sim.phase === 'landed' || this.sim.phase === 'crashed') {
        this.attractEnd += dt;
        if (this.attractEnd > 4) {
          this.attractEnd = 0;
          this.loadLevel((this.levelIdx + 1) % LEVELS.length);
        }
      } else this.attractEnd = 0;
    }

    this.carTestTick(dt);
    this.render(dt);
  }

  private mapInput(raw: ReturnType<Input['read']>) {
    const inp = this.inp;
    if (this.attract || this.state === 'menu') {
      this.ap.update(this.sim, inp);
      return;
    }
    inp.throttle = inp.brake = inp.steer = inp.pitch = inp.roll = inp.yaw = inp.lift = 0;
    if (this.state !== 'run' && this.state !== 'finish' && this.state !== 'result') return;
    if (this.state === 'result' || (this.state === 'finish' && this.sim.phase === 'crashed')) { inp.brake = 1; return; }
    const sim = this.sim;
    const clamp = (x: number) => Math.max(-1, Math.min(1, x));
    if (sim.phase === 'rail') {
      inp.throttle = Math.max(raw.up, raw.throttle);
      inp.brake = Math.max(raw.down, raw.brake);
      inp.steer = clamp(raw.right - raw.left + raw.stickX);
    } else if (sim.grounded || sim.phase === 'landed') {
      inp.throttle = Math.max(raw.up, raw.throttle);
      inp.brake = Math.max(raw.down, raw.brake, this.state === 'finish' ? 0.4 : 0);
      inp.steer = clamp(raw.right - raw.left + raw.stickX);
      inp.lift = raw.lift;
    } else {
      inp.pitch = clamp(raw.down - raw.up + raw.stickY);
      inp.roll = clamp(raw.right - raw.left + raw.stickX);
      inp.yaw = clamp(raw.yawR - raw.yawL);
      inp.lift = raw.lift;
    }
  }

  private onAction(a: Action) {
    this.audio.init();
    if (this.state === 'menu') {
      if (a === 'left') { this.menuSel = (this.menuSel + LEVELS.length - 1) % LEVELS.length; this.markSel(); this.audio.click(); }
      if (a === 'right') { this.menuSel = (this.menuSel + 1) % LEVELS.length; this.markSel(); this.audio.click(); }
      if (a === 'upNav') { this.menuSel = (this.menuSel + LEVELS.length - 5) % LEVELS.length; this.markSel(); this.audio.click(); }
      if (a === 'downNav') { this.menuSel = (this.menuSel + 5) % LEVELS.length; this.markSel(); this.audio.click(); }
      if (a === 'confirm') this.startLevel(this.menuSel);
      if (a === 'mute') this.toggleMute();
      return;
    }
    if (a === 'mute') { this.toggleMute(); return; }
    if (this.state === 'intro') {
      if (a === 'confirm' && this.input.usingPad) this.enterCountdown();
      if (a === 'pause' || a === 'back') this.toMenu();
      return;
    }
    if (this.state === 'result') {
      if (a === 'restart') this.retry();
      if (a === 'confirm' || a === 'next') this.next();
      if (a === 'pause' || a === 'back') this.toMenu();
      if (a === 'camera') this.cycleCamera();
      return;
    }
    if (this.state === 'paused') {
      if (a === 'pause' || a === 'confirm') this.togglePause();
      if (a === 'restart') this.retry();
      if (a === 'back') this.toMenu();
      return;
    }
    if (a === 'pause') this.togglePause();
    if (a === 'restart') this.retry();
    if (a === 'camera') this.cycleCamera();
    if (a === 'assist') {
      this.sim.assist = !this.sim.assist;
      this.assistPref = this.sim.assist;
      this.hud.setAssist(this.sim.assist);
      this.hud.message(this.sim.assist ? 'ASSIST ON' : 'ASSIST OFF', this.sim.assist ? 'rate hold · blasts damp rotation' : 'raw thrust · you own the momentum', 1.2);
    }
    if (a === 'guide') {
      this.guide.enabled = !this.guide.enabled;
      this.hud.message(this.guide.enabled ? 'GUIDANCE ON' : 'GUIDANCE OFF', '', 1);
    }
  }

  private toggleMute() {
    this.audio.setMuted(!this.audio.muted);
    $('m-mute').textContent = (this.audio.muted ? 'Sound off' : 'Sound on') + (this.touch ? '' : ' (M)');
  }

  private cycleCamera() {
    this.camIdx = (this.camIdx + 1) % CAM_MODES.length;
    this.rig.mode = CAM_MODES[this.camIdx];
    if (this.rig.override === 'results' && this.state !== 'result') this.rig.override = null;
    this.hud.setCam(this.rig.mode);
  }

  private handleEvents() {
    const sim = this.sim;
    const playing = !this.attract && this.state !== 'menu';
    for (const e of sim.drainEvents()) {
      switch (e.type) {
        case 'takeoff':
          this.audio.whoosh();
          if (playing) this.hud.message('AIRBORNE', `${(e.data.speed * 3.6).toFixed(0)} KM/H OFF THE LIP`, 1.3);
          if (playing) this.hud.fadeKeys();
          break;
        case 'lostGrip':
          if (playing) this.hud.message('LOST GRIP', 'not enough speed to stay on the track', 2.2, true);
          break;
        case 'touchdown': {
          const td = e.data;
          const k = Math.min(1, td.impact / 12);
          this.audio.thud(k);
          this.rig.shake(0.3 + k * 1.2);
          this.burstSmoke(td.point, 90 + k * 160, k);
          if (td.impact > 6) this.burstSparks(td.point, 40 + k * 80);
          if (playing && sim.phase !== 'crashed') {
            const v = td.tiltDeg < 6 && td.impact < 4 ? 'BUTTER' : td.tiltDeg < 15 && td.impact < 7 ? 'TOUCHDOWN' : 'HEAVY';
            this.hud.message(v, `${td.tiltDeg.toFixed(1)}° · ${td.impact.toFixed(1)} M/S`, 1.4);
          }
          break;
        }
        case 'bounce':
          this.burstSmoke(sim.pos.clone().setY(sim.pos.y - 0.5), 30, 0.3);
          break;
        case 'crash':
          this.audio.crash();
          this.rig.shake(1.5);
          this.flash = 0.6;
          this.burstSparks(sim.pos, 160);
          this.burstSmoke(sim.pos, 160, 1, 0.55);
          if (playing) this.hud.message('WRECKED', e.data.reason, 2.6, true);
          if (this.state === 'run') this.setState('finish');
          break;
        case 'settled':
          if (this.state === 'run') this.setState('finish');
          break;
      }
    }
  }

  private finishRun() {
    const r = scoreRun(this.sim, this.level, this.runTime);
    this.result = r;
    this.setState('result');
    if (this.attract) return;
    const isBest = saveBest(LEVELS[this.levelIdx].id, r);
    if (!r.crashed) this.audio.success();
    this.rig.override = this.rig.mode === 'cinematic' ? null : 'results';
    this.showResults(r, isBest);
  }

  private showResults(r: RunResult, isBest: boolean) {
    const def = LEVELS[this.levelIdx];
    $('r-grade').textContent = r.crashed ? '✕' : r.grade;
    $('r-grade').classList.toggle('crash', r.crashed);
    $('r-verdict').textContent = r.crashed ? r.reason : `${r.verdict} LANDING`;
    $('r-verdict').classList.toggle('crash', r.crashed);
    $('r-level').textContent = `${String(this.levelIdx + 1).padStart(2, '0')} · ${def.name} · ${r.time.toFixed(2)} S`;
    $('r-best').textContent = isBest && !r.crashed ? 'NEW BEST' : '';
    const host = $('r-lines');
    host.innerHTML = '';
    r.lines.forEach((l, i) => {
      const d = document.createElement('div');
      d.className = 'res-line';
      d.style.animationDelay = `${0.15 + i * 0.07}s`;
      const q = l.quality;
      d.innerHTML = `<div class="l">${l.label}</div><div class="p">${l.points.toLocaleString('en-US')}</div><div class="d">${l.detail}</div>${q !== undefined ? `<div class="q"><i class="${q < 0.5 ? 'low' : ''}" style="width:${(q * 100).toFixed(0)}%"></i></div>` : ''}`;
      host.appendChild(d);
    });
    const tot = $('r-total');
    const start = performance.now();
    const anim = () => {
      const t = Math.min(1, (performance.now() - start) / 900);
      tot.textContent = Math.round(r.total * (1 - Math.pow(1 - t, 3))).toLocaleString('en-US');
      if (t < 1) requestAnimationFrame(anim);
    };
    anim();
    (document.querySelector('[data-act="next"]') as HTMLElement).innerHTML = this.levelIdx + 1 >= LEVELS.length ? '<kbd>Enter</kbd> Finish' : '<kbd>Enter</kbd> Next ramp';
    this.screens({ results: true, hud: false });
  }

  // ------------------------------------------------------------------ GPU diagnostics (#cartest)
  private testIdx = -1;
  private testTimer = 0;
  private testEl: HTMLElement | null = null;
  private testUndo: (() => void) | null = null;
  private startCarTest() {
    this.loadLevel(0);
    this.attract = false;
    this.enterIntro();
    $('intro').classList.add('hidden');
    this.rig.override = 'intro';
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:12px;left:12px;z-index:99;font:600 22px monospace;color:#fff;background:rgba(0,0,0,.75);padding:10px 14px;white-space:pre';
    document.body.appendChild(el);
    this.testEl = el;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    (this as any).gpuInfo = `${dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)} | depth ${gl.getParameter(gl.DEPTH_BITS)} | dpr ${devicePixelRatio}`;
  }
  private carMats() {
    const set = new Set<THREE.Material>();
    this.car.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) set.add(m.material as THREE.Material); });
    return [...set];
  }
  private testVariants: [string, () => () => void][] = [
    ['1 normal (no post)', () => () => {}],
    ['2 glass hidden', () => { const g = this.carMats().filter((m) => m.transparent); g.forEach((m) => (m.visible = false)); return () => g.forEach((m) => (m.visible = true)); }],
    ['3 car FrontSide', () => { const ms = this.carMats(); const prev = ms.map((m) => m.side); ms.forEach((m) => { m.side = THREE.FrontSide; m.needsUpdate = true; }); return () => ms.forEach((m, i) => { m.side = prev[i]; m.needsUpdate = true; }); }],
    ['4 no shadows', () => { const l: THREE.Mesh[] = []; this.car.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && (m.castShadow || m.receiveShadow)) { l.push(m); m.castShadow = m.receiveShadow = false; } }); return () => l.forEach((m) => { m.castShadow = m.receiveShadow = true; }); }],
    ['5 plain white material', () => { const map = new Map<THREE.Mesh, THREE.Material>(); const w = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5, side: THREE.DoubleSide }); this.car.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { map.set(m, m.material as THREE.Material); m.material = w; } }); return () => map.forEach((mat, m) => (m.material = mat)); }],
    ['6 road offset off', () => { const l: THREE.Material[] = []; this.levelScene!.group.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material; if (m && m.polygonOffset) { l.push(m); m.polygonOffset = false; m.needsUpdate = true; } }); return () => l.forEach((m) => { m.polygonOffset = true; m.needsUpdate = true; }); }],
    ['7 car only', () => { const h: THREE.Object3D[] = []; this.scene.children.forEach((c) => { if (c !== this.car.group && c.visible) { h.push(c); c.visible = false; } }); const bg = this.scene.background; this.scene.background = new THREE.Color(0x3a3a40); return () => { h.forEach((c) => (c.visible = true)); this.scene.background = bg; }; }],
    ['8 normals', () => { const map = new Map<THREE.Mesh, THREE.Material>(); const w = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }); this.car.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { map.set(m, m.material as THREE.Material); m.material = w; } }); return () => map.forEach((mat, m) => (m.material = mat)); }],
  ];
  private carTestTick(_dt: number) {}
  private renderCarTest() {
    const r = this.renderer;
    const W = window.innerWidth, H = window.innerHeight;
    const cols = 4, rows = 2, cw = Math.floor(W / cols), ch = Math.floor(H / rows);
    const cam = this.rig.camera;
    const aspect = cam.aspect;
    cam.aspect = cw / ch; cam.updateProjectionMatrix();
    r.setScissorTest(true);
    this.testVariants.forEach(([, apply], i) => {
      const x = (i % cols) * cw, y = H - (Math.floor(i / cols) + 1) * ch;
      r.setViewport(x, y, cw, ch); r.setScissor(x, y, cw, ch);
      const undo = apply();
      r.render(this.scene, cam);
      undo();
    });
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
    cam.aspect = aspect; cam.updateProjectionMatrix();
    if (this.testEl && !this.testEl.dataset.done) {
      this.testEl.dataset.done = '1';
      this.testEl.innerHTML = this.testVariants.map(([n], i) => `<div style="position:fixed;left:${(i % cols) * (100 / cols)}%;top:${Math.floor(i / cols) * 50}%;padding:6px 10px;background:rgba(0,0,0,.7);font:600 14px monospace;color:#fff">${n}</div>`).join('') +
        `<div style="position:fixed;left:0;right:0;bottom:0;padding:6px 10px;background:rgba(0,0,0,.8);font:600 13px monospace;color:#fff">${(this as any).gpuInfo}</div>`;
      this.testEl.style.cssText = 'position:fixed;inset:0;z-index:99;pointer-events:none';
    }
  }

  /** test hook: run the physics forward without rendering */
  debugAdvance(sec: number, auto = true) {
    if (['menu', 'intro', 'countdown'].includes(this.state)) { this.rig.override = null; this.screens({ hud: true }); this.levelScene?.setStartLights(0, 'off'); this.setState('run'); }
    const n = Math.round(sec / STEP);
    for (let i = 0; i < n; i++) {
      if (auto) this.ap.update(this.sim, this.inp);
      this.sim.step(STEP, this.inp);
      if (i % 24 === 0) this.rig.update(STEP * 24, this.sim, this.level.terrain);
    }
    this.runTime += sec;
    this.handleEvents();
    for (let i = 0; i < 30; i++) this.rig.update(0.05, this.sim, this.level.terrain);
    return { phase: this.sim.phase, pos: this.sim.pos.toArray().map((v) => +v.toFixed(1)), speed: +(this.sim.speed * 3.6).toFixed(0) };
  }
  setCam(mode: 'chase' | 'dash' | 'cinematic') { this.camIdx = CAM_MODES.indexOf(mode); this.rig.mode = mode; this.hud.setCam(mode); }

  // ------------------------------------------------------------------ effects
  private burstSmoke(p: THREE.Vector3, n: number, k: number, albedo = 0.9) {
    const v = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const base = this.sim.vel;
    const nrm = this.level.terrain.normal(p.x, p.z);
    const t1 = new THREE.Vector3(1, 0, 0).addScaledVector(nrm, -nrm.x).normalize();
    const t2 = new THREE.Vector3().crossVectors(nrm, t1);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * (7 + k * 14);
      // blast out along the surface, carried forward by the car's momentum
      v.copy(t1).multiplyScalar(Math.cos(a) * sp).addScaledVector(t2, Math.sin(a) * sp).addScaledVector(nrm, 0.5 + Math.random() * (2 + k * 3));
      v.addScaledVector(base, 0.2 + Math.random() * 0.45);
      pos.copy(p).addScaledVector(t1, (Math.random() - 0.5) * 4).addScaledVector(t2, (Math.random() - 0.5) * 2.5).addScaledVector(nrm, 0.3 + Math.random() * 0.6);
      this.smoke.emit(pos, v, {
        size: 1.2 + Math.random() * 2.2, grow: 3.2 + Math.random() * 3.5 + k * 2, life: 4.5 + Math.random() * 4,
        alpha: 0.32 + 0.2 * k, heat: 0.6 + Math.random() * 0.8, drag: 0.9 + Math.random() * 0.6, albedo, turb: 1.2,
      });
    }
  }

  private burstSparks(p: THREE.Vector3, n: number) {
    const v = new THREE.Vector3();
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      v.set((Math.random() - 0.5) * 22, Math.random() * 12, (Math.random() - 0.5) * 22).addScaledVector(this.sim.vel, 0.5);
      col.setRGB(3, 0.7 + Math.random() * 0.8, 0.3);
      this.fx.sparks.emit(p, v, 0.12 + Math.random() * 0.1, 0.5 + Math.random() * 0.8, col, 1);
    }
  }

  private emitContinuous(dt: number) {
    const sim = this.sim;
    const m = this.car.group.matrixWorld;
    const q = this.car.group.quaternion;
    const pos = new THREE.Vector3();
    const v = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const tmpV = new THREE.Vector3();
    const jetCol = new THREE.Color(0.38, 0.45, 0.62);
    for (let i = 0; i < NOZZLES.length; i++) {
      const f = sim.nozzle[i];
      if (f < 40) { this.emitCarry[i] = 0; continue; }
      const big = f > 2000;
      // the jet itself: a short, tight, fast streak right at the nozzle. Cold air is
      // nearly invisible, so this stays small; the smoke plume below does the talking
      const k = Math.min(1, f / (big ? SPEC.liftForce * 0.5 : 1500));
      this.emitCarry[i] += dt * (big ? 70 : 50) * k;
      const nz = NOZZLES[i];
      dir.copy(nz.force).negate().applyQuaternion(q);
      while (this.emitCarry[i] >= 1) {
        this.emitCarry[i] -= 1;
        pos.copy(nz.pos).applyMatrix4(m).addScaledVector(dir, 0.05 + Math.random() * (big ? 0.35 : 0.22));
        v.copy(dir).multiplyScalar(big ? 26 : 18).add(sim.vel);
        this.fx.jets.emit(pos, v, big ? 0.16 + Math.random() * 0.06 : 0.09 + Math.random() * 0.04, 0.035 + Math.random() * 0.03, jetCol, big ? 0.32 : 0.26, 0.5);
      }
    }
    // wheels stop spinning in the air; on touchdown they skid until spun up again
    for (let i = 0; i < 4; i++) {
      const ws = sim.wheels[i];
      if (sim.phase === 'rail') { this.wheelW[i] = sim.v / SPEC.wheelR; this.skid[i] = 0; continue; }
      const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const ground = sim.vel.dot(fwd) / SPEC.wheelR;
      if (ws.contact) {
        const diff = ground - this.wheelW[i];
        const acc = 160 * dt * Math.sign(diff);
        this.wheelW[i] += Math.abs(acc) > Math.abs(diff) ? diff : acc;
        this.skid[i] = Math.min(1, Math.abs(diff) * SPEC.wheelR / 12);
      } else {
        this.wheelW[i] *= Math.exp(-1.2 * dt);
        this.skid[i] = 0;
      }
    }
    // tyre smoke: launch burnout, touchdown skids and slides
    for (let i = 0; i < 4; i++) {
      const ws = sim.wheels[i];
      const slip = Math.max(ws.slip, this.skid[i]);
      if (!ws.contact || slip < 0.12) continue;
      if (sim.phase === 'rail' && i < 2) continue;
      this.emitCarry[12 + i] += slip * dt * (sim.phase === 'rail' ? 55 : 110);
      while (this.emitCarry[12 + i] >= 1) {
        this.emitCarry[12 + i] -= 1;
        pos.set(i < 2 ? SPEC.wheelX : -SPEC.wheelX, -SPEC.comHeight + 0.25, i % 2 ? SPEC.wheelZ : -SPEC.wheelZ).applyMatrix4(m);
        pos.addScaledVector(sim.vel, -Math.random() * dt);
        v.set((Math.random() - 0.5) * 4, 0.6 + Math.random() * 1.8, (Math.random() - 0.5) * 4).addScaledVector(sim.vel, 0.3 + Math.random() * 0.25);
        this.smoke.emit(pos, v, { size: 0.8 + Math.random() * 0.7, grow: 2.8 + Math.random() * 2, life: 4.5 + Math.random() * 3.5, alpha: 0.42 * Math.min(1, slip * 1.6), heat: 1.0, drag: 1.3, turb: 1.1 });
      }
    }
    // air-blast plumes: every firing nozzle lays a continuous trail of lit smoke.
    // Puffs are spread along the path the nozzle travelled this frame, start dense
    // and small at the nozzle, get blown out along the jet, slow to the still air
    // and then bloom and drift like the tyre smoke does
    for (let i = 0; i < NOZZLES.length; i++) {
      const f = sim.nozzle[i];
      const nz = NOZZLES[i];
      pos.copy(nz.pos).applyMatrix4(m);
      const prev = this.nozPrev[i];
      const had = this.nozPrevOk[i] && prev.distanceToSquared(pos) < 100;
      if (f < 250) { this.nozPrevOk[i] = false; this.emitCarry[20 + i] = 0; continue; }
      const big = i < 4 && f > 2000;
      const k = Math.min(1, f / (big ? SPEC.liftForce * 0.6 : 1500));
      this.emitCarry[20 + i] += dt * (big ? 85 : 48) * (0.35 + 0.65 * k);
      dir.copy(nz.force).negate().applyQuaternion(q);
      const n = Math.floor(this.emitCarry[20 + i]);
      this.emitCarry[20 + i] -= n;
      for (let j = 0; j < n; j++) {
        const t = (j + Math.random()) / n;
        const p = had ? prev.clone().lerp(pos, t) : pos.clone();
        p.addScaledVector(dir, (big ? 0.4 : 0.25) + Math.random() * (big ? 0.8 : 0.5));
        // jet speed relative to the car, plus the car's own motion; random spread makes a cone
        const js = (big ? 16 : 11) * (0.6 + 0.4 * k) * (0.75 + Math.random() * 0.5);
        v.copy(dir).multiplyScalar(js).add(sim.vel)
          .add(tmpV.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(big ? 4 : 3));
        this.smoke.emit(p, v, {
          size: (big ? 0.55 : 0.4) + Math.random() * 0.3,
          grow: (big ? 2.6 : 2.0) + Math.random() * 1.2,
          life: (big ? 2.8 : 2.0) + Math.random() * 1.6,
          alpha: (big ? 0.2 : 0.16) + 0.1 * k,
          heat: 0.08, drag: 2.8, albedo: 1.0, turb: 1.2, glow: 0.04,
        });
      }
      prev.copy(pos);
      this.nozPrevOk[i] = true;
    }
    // launch: the rear exhausts blast compressed air out the back. A hot white core at
    // each pipe and a thick, rolling smoke trail that billows along the runway
    const ex = sim.exhaust;
    const back = tmpV.set(-1, 0, 0).applyQuaternion(q).clone();
    // off the line the blast hits the runway and billows out in a big cloud
    const ls = 1 - Math.min(1, sim.speed / 22);
    if (!this.launchBurst && ex > 0.3 && sim.speed < 8) {
      this.launchBurst = true;
      // the blast deflects off the runway and rolls out to both sides of the car
      const side = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      for (let k = 0; k < 34; k++) {
        const sgn = k % 2 ? 1 : -1;
        const p = sim.pos.clone().addScaledVector(back, 3.4 + Math.random() * 3).addScaledVector(side, sgn * (0.6 + Math.random() * 1.2));
        p.y = this.level.terrain.height(p.x, p.z) + 0.3 + Math.random() * 0.4;
        v.copy(side).multiplyScalar(sgn * (5 + Math.random() * 9)).addScaledVector(back, 1 + Math.random() * 4).add(tmpV.set(0, 0.8 + Math.random() * 1.8, 0));
        this.smoke.emit(p, v, { size: 1.0 + Math.random() * 1.2, grow: 3.5 + Math.random() * 3, life: 5 + Math.random() * 4, alpha: 0.27, heat: 0.7, drag: 1.0, albedo: 1.0, turb: 1.25, glow: 0.1 });
      }
    }
    for (let i = 0; i < EXHAUSTS.length; i++) {
      pos.copy(EXHAUSTS[i]).applyMatrix4(m);
      const prev = this.exPrev[i];
      const had = this.exPrevOk[i] && prev.distanceToSquared(pos) < 100;
      if (ex < 0.05) { this.exPrevOk[i] = false; this.emitCarry[32 + i] = 0; this.emitCarry[36 + i] = 0; continue; }
      // core streak
      this.emitCarry[36 + i] += dt * 70 * ex;
      while (this.emitCarry[36 + i] >= 1) {
        this.emitCarry[36 + i] -= 1;
        const p = pos.clone().addScaledVector(back, 0.04 + Math.random() * 0.3);
        v.copy(back).multiplyScalar(30).add(sim.vel);
        this.fx.jets.emit(p, v, 0.1 + Math.random() * 0.05, 0.035 + Math.random() * 0.03, jetCol, 0.3 * ex, 0.5);
      }
      // smoke
      this.emitCarry[32 + i] += dt * 60 * ex * (1 + 1.2 * ls);
      const n = Math.floor(this.emitCarry[32 + i]);
      this.emitCarry[32 + i] -= n;
      for (let j = 0; j < n; j++) {
        const t = (j + Math.random()) / n;
        const p = had ? prev.clone().lerp(pos, t) : pos.clone();
        p.addScaledVector(back, 0.3 + Math.random() * 0.7);
        // blasted backwards relative to the car: off the line the smoke is shot back
        // along the runway; at speed it is left hanging in the car's wake
        // at low speed the jet slams into the runway and fans out sideways
        const fan = 3 + 9 * ls;
        v.copy(back).multiplyScalar((14 + Math.random() * 10) * ex).add(sim.vel)
          .add(new THREE.Vector3((Math.random() - 0.5) * fan, Math.random() * (1.5 + 2 * ls), (Math.random() - 0.5) * fan));
        this.smoke.emit(p, v, {
          size: 0.6 + Math.random() * 0.5 + 0.9 * ls, grow: 3.2 + Math.random() * 2.2 + 2.2 * ls, life: 3.6 + Math.random() * 3 + 2 * ls,
          alpha: 0.13 + 0.13 * ex + 0.12 * ls, heat: 0.55, drag: 2.0, albedo: 1.0, turb: 1.25, glow: 0.11,
        });
      }
      prev.copy(pos);
      this.exPrevOk[i] = true;
    }
    const lift = Math.max(0, sim.nozzle[0] - 1600) / SPEC.liftForce;
    const alt = sim.altitude();
    if (lift > 0.1 && alt < 14 && sim.phase !== 'rail') {
      const down = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
      if (down.y < -0.5) {
        const tg = alt / -down.y;
        const hit = sim.pos.clone().addScaledVector(down, tg + SPEC.comHeight);
        hit.y = this.level.terrain.height(hit.x, hit.z) + 0.3;
        const strength = lift * (1 - alt / 14);
        const n = strength * dt * 60;
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 8 + Math.random() * 10 * strength;
          v.set(Math.cos(a) * sp, 0.6 + Math.random() * 1.5, Math.sin(a) * sp).addScaledVector(sim.vel, 0.3);
          this.smoke.emit(hit, v, { size: 1 + Math.random(), grow: 3, life: 3 + Math.random() * 2, alpha: 0.22 * strength + 0.06, heat: 0.4, drag: 1.1, albedo: 0.8 });
        }
      }
    }
    if (sim.bodyContact && sim.scrapeIntensity > 0.15 && Math.random() < sim.scrapeIntensity) {
      pos.copy(sim.pos).setY(sim.pos.y - 0.4);
      for (let k = 0; k < 4; k++) {
        v.set((Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8).addScaledVector(sim.vel, 0.7);
        this.fx.sparks.emit(pos, v, 0.1, 0.4 + Math.random() * 0.4, new THREE.Color(3, 1, 0.3), 1);
      }
    }
  }

  private updateSmoke(dt: number) {
    const sim = this.sim;
    const q = sim.quat;
    const jets: { pos: THREE.Vector3; dir: THREE.Vector3; force: number }[] = [];
    for (let i = 0; i < NOZZLES.length; i++) {
      const f = sim.nozzle[i];
      if (f < 600) continue;
      jets.push({ pos: NOZZLES[i].pos.clone().applyQuaternion(q).add(sim.pos), dir: NOZZLES[i].force.clone().negate().applyQuaternion(q), force: f });
    }
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const dyn: SmokeLight[] = [
      { pos: sim.pos.clone().addScaledVector(fwd, -2.6).addScaledVector(up, 0.3), color: new THREE.Color(1, 0.04, 0.06).multiplyScalar(0.55), range: 3 },
      { pos: sim.pos.clone().addScaledVector(up, -0.5), color: new THREE.Color(1, 0.08, 0.12).multiplyScalar(0.25), range: 2.5 },
    ];
    // the headlight is a full-width light bar: light the smoke from five points along it,
    // with the same wide, slightly downward wash as the real spot light
    const right = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const beam = fwd.clone().addScaledVector(up, -0.08).normalize();
    for (let k = -2; k <= 2; k++) {
      dyn.push({ pos: sim.pos.clone().addScaledVector(fwd, 2.3).addScaledVector(up, -0.1).addScaledVector(right, k * 0.32), color: new THREE.Color(1, 1, 1).multiplyScalar(0.26), range: 30, dir: beam, cos: Math.cos(0.9), near: 2.5 });
    }
    this.smoke.update(dt, { time: this.time, camera: this.rig.camera, terrain: this.level.terrain, carPos: sim.pos, carVel: sim.vel, jets, dynLights: dyn });
  }

  // ------------------------------------------------------------------ render
  private phaseLabel() {
    const s = this.sim;
    if (this.state === 'countdown') return 'LAUNCH CONTROL';
    if (this.state === 'paused') return 'PAUSED';
    switch (s.phase) {
      case 'rail': return s.altitude() > 1 ? (s.normalForce > 0 ? 'ON THE RAMP' : 'LOSING GRIP') : 'RUNWAY';
      case 'air': return s.lostGrip ? 'FALLING' : 'AIRBORNE';
      case 'landing': return 'TOUCHDOWN';
      case 'landed': return 'LANDED';
      case 'crashed': return 'WRECKED';
    }
  }

  private render(dt: number) {
    const sim = this.sim;
    const paused = this.state === 'paused';
    this.applyInterp();
    this.car.update(sim, paused ? 0 : dt);
    this.car.group.updateMatrixWorld();
    if (!paused) {
      this.emitContinuous(dt);
      for (const p of this.fx.all) p.update(dt);
    }
    this.guide.update(sim, this.time);
    if (this.state === 'menu' || this.attract) this.guide.group.visible = false;
    this.rig.update(paused ? 0 : dt, sim, this.level.terrain);
    this.car.setCockpit(this.rig.mode === 'dash' && !this.rig.override);
    this.rig.camera.updateMatrixWorld();
    if (!paused) this.updateSmoke(dt);
    this.world.update(this.time, sim.pos);
    this.levelScene?.update(this.time);
    // post
    const sp = sim.speed;
    const speedFx = this.rig.mode === 'chase' && sim.phase === 'rail' ? THREE.MathUtils.clamp((sp - 45) / 50, 0, 0.55) : 0;
    const g = this.post.grade.uniforms;
    g.uSpeed.value += (speedFx - g.uSpeed.value) * Math.min(1, dt * 4);
    this.flash *= Math.exp(-dt * 5);
    g.uFlash.value = this.flash * 0.35;
    for (const p of this.fx.all) p.setViewport(window.innerHeight * this.renderer.getPixelRatio(), this.rig.camera.fov);
    this.smoke.setViewport(window.innerHeight * this.renderer.getPixelRatio(), this.rig.camera.fov);
    // audio
    let jets = 0, lift = 0;
    for (let i = 0; i < NOZZLES.length; i++) jets += sim.nozzle[i] / 1500;
    for (let i = 0; i < 4; i++) lift += Math.max(0, sim.nozzle[i] - 1500) / 7000 / 4;
    const active = this.state !== 'menu' && this.state !== 'intro';
    this.audio.update({ speed: sp, throttle: this.inp.throttle, onGround: sim.phase === 'rail' || sim.grounded, jets, lift, inAir: sim.phase === 'air', active: active || this.state === 'menu', exhaust: sim.exhaust });
    if (this.testEl) this.renderCarTest();
    else this.post.render(this.time);
    this.restoreInterp();
    const hudOn = !this.hud.root.classList.contains('hidden');
    if (hudOn) {
      this.hud.update(dt, sim, this.runTime, this.phaseLabel(), this.guide);
      this.att.render(this.renderer, sim, sim.phase === 'air' && this.guide.prediction?.hit ? this.guide.targetQuat : null);
    }
  }
}
