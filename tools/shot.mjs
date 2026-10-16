import { chromium } from 'playwright-core';
const [,, url, out, wait = '4000', evalJs = '', w = '1600', h = '900'] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(+wait);
if (evalJs) {
  const steps = evalJs.split('||');
  for (const st of steps) {
    if (st.startsWith('wait:')) { await page.waitForTimeout(+st.slice(5)); continue; }
    if (st.startsWith('shot:')) { await page.screenshot({ path: st.slice(5), timeout: 180000 }); continue; }
    const r = await page.evaluate(st);
    if (r !== undefined) logs.push('[eval] ' + JSON.stringify(r));
  }
}
await page.screenshot({ path: out, timeout: 180000 });
console.log(logs.slice(-30).join('\n'));
await browser.close();
