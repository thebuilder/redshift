// Renders one gameplay segment for the demo video at a fixed 30 fps, straight from the
// WebGL canvas (no HUD). The autopilot flies; the game otherwise runs as a player session.
// node tools/demo.mjs <url> <outDir> <level> <camera: chase|side> <tailSeconds> [w h]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const [,, url, out, level, cam, tail = '1', w = '1280', h = '720'] = process.argv;
mkdirSync(out, { recursive: true });
const FPS = 30;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await p.goto(`${url}?level=${level}`);
await p.waitForTimeout(4000);
await p.evaluate(([cam]) => {
  const g = window.__redshift;
  document.getElementById('boot').style.display = 'none';
  g.renderer.shadowMap.enabled = false;
  g.att.render = () => {};
  g.ap.skill = 1; g.ap.throttle = 1;
  g.mapInput = function () {
    const st = this.state;
    if (st === 'run' || st === 'finish') this.ap.update(this.sim, this.inp);
    else { this.inp.throttle = this.inp.brake = this.inp.steer = this.inp.pitch = this.inp.roll = this.inp.yaw = this.inp.lift = 0; }
  };
  g.enterCountdown(); g.goAt = 2.9; g.stateTime = 2.35;
  g.setCam('chase');
  // tracking camera: rides alongside the car at a fixed offset so it stays big in frame
  const rampS = g.level.track.rampStartS();
  const f = g.level.track.sample(rampS);
  const side = f.R.clone().multiplyScalar(-1);
  const look = g.sim.pos.clone();
  const pos = g.sim.pos.clone().addScaledVector(side, 24).setY(4);
  const want = pos.clone();
  const orig = g.rig.update.bind(g.rig);
  g.rig.update = function (dt, sim, terrain) {
    orig(dt, sim, terrain);
    if (cam !== 'side') return;
    const c = this.camera;
    want.copy(sim.pos).addScaledVector(side, 24);
    want.y = Math.max(3, 2.5 + sim.pos.y * 0.55);
    pos.lerp(want, Math.min(1, dt * 2.2));
    look.lerp(sim.pos, Math.min(1, dt * 7));
    c.position.copy(pos); c.up.set(0, 1, 0); c.lookAt(look); c.fov = 44; c.updateProjectionMatrix();
  };
}, [cam]);
let n = 0, after = -1;
if (process.env.PEEK) {
  // composition check: a still every half second of game time
  for (let k = 0; k < +process.env.PEEK; k++) {
    const data = await p.evaluate(() => { const g = window.__redshift; for (let i = 0; i < 15; i++) { g.sim.step(1 / 240, g.inp); } for (let i = 0; i < 14; i++) g.tick(1 / 30); g.tick(1 / 30); return document.getElementById('gl').toDataURL('image/jpeg', 0.85); });
    writeFileSync(`${out}/peek${k}.jpg`, Buffer.from(data.split(',')[1], 'base64'));
  }
  await b.close();
  process.exit(0);
}
for (let i = 0; i < FPS * 30; i++) {
  const [data, st, ph] = await p.evaluate(() => { const g = window.__redshift; g.tick(1 / 30); return [document.getElementById('gl').toDataURL('image/jpeg', 0.93), g.state, g.sim.phase]; });
  writeFileSync(`${out}/f${String(++n).padStart(5, '0')}.jpg`, Buffer.from(data.split(',')[1], 'base64'));
  const done = ph === 'landed' || ph === 'crashed' || st === 'finish' || st === 'result';
  if (done && after < 0) after = i;
  if (after >= 0 && i - after >= +tail * FPS) break;
  if (i % 30 === 0) console.log(out, i, st, ph);
}
console.log('frames', n);
await b.close();
