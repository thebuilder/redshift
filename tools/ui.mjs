// UI layout check: title screen and results card at common phone and tablet sizes (touch).
import { chromium } from 'playwright-core';
const [,, url, outDir = '/tmp', sizes = '390x844,844x390,360x740,740x360,667x375,375x667,1024x768'] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const s of sizes.split(',')) {
  const [w, h] = s.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(3500);
  await page.evaluate(() => { document.getElementById('boot').style.display = 'none'; window.__redshift.tick(1 / 30); });
  await page.screenshot({ path: `${outDir}/ui_menu_${s}.png` });
  const info = await page.evaluate(() => {
    const g = window.__redshift;
    g.startLevel(0); g.attract = false; g.debugAdvance(0.01);
    for (let i = 0; i < 300; i++) { g.debugAdvance(0.1); if (g.sim.phase === 'landed' || g.sim.phase === 'crashed') break; }
    g.debugAdvance(1.5);
    g.finishRun();
    g.tick(1 / 30);
    // reveal the staggered rows straight away for the screenshot
    document.querySelectorAll('.res-line').forEach((e) => { e.style.animation = 'none'; e.style.opacity = '1'; });
    const card = document.querySelector('.res-card').getBoundingClientRect();
    const acts = document.querySelector('.res-actions').getBoundingClientRect();
    return { card: [card.top, card.bottom].map(Math.round), actions: [acts.top, acts.bottom].map(Math.round), vh: innerHeight };
  });
  console.log(s, JSON.stringify(info));
  await page.screenshot({ path: `${outDir}/ui_res_${s}.png` });
  await ctx.close();
}
await browser.close();
