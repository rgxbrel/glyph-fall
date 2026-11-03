// Verifies the stride fix (sigs ink) and the background-mix fix (canvas stats).
const puppeteer = require('/tmp/pup/node_modules/puppeteer-core');
const GAME_URL = process.env.GAME_URL;

(async () => {
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--user-data-dir=/tmp/cmp/pV' + process.pid],
  });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
  await p.setViewport({ width: 1000, height: 700 });
  await p.goto(GAME_URL + '?name=VERIFY', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 9000));
  await p.evaluate(() => {
    const ps = window.__game.pass;
    Object.assign(ps.cfg, { set: 'detailed', scale: 1, colorMode: 0, brightness: 0, grainIntensity: 4 });
  });
  await new Promise(r => setTimeout(r, 2500));

  const out = await p.evaluate(() => {
    const ps = window.__game.pass;
    const avg = ci => {
      let s = 0;
      for (let k = 0; k < ps.SIG_N; k++) s += ps.sigs[ci * ps.SIG_N + k];
      return s / ps.SIG_N;
    };
    const ink = {};
    for (const ch of [' ', '.', '`', '^', '@', '#', 'M', '$', 'I']) {
      const i = ps.chars.indexOf(ch);
      ink[ch] = i < 0 ? null : +avg(i).toFixed(3);
    }
    const d = ps.ctx.getImageData(0, 0, ps.W, ps.H).data;
    let sum = 0, black = 0, n = 0, rg = 0, rb = 0;
    const lum = [];
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const L = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
      sum += L; n++; lum.push(L);
      if (R === 0 && G === 0 && B === 0) black++;
      rg += Math.abs(R - G); rb += Math.abs(R - B);
    }
    lum.sort((a, b) => a - b);
    const q = f => +lum[Math.floor(f * (n - 1))].toFixed(3);
    return {
      ink, fps: document.body.innerText.match(/\d+ fps[^\n]*/)?.[0] ?? '?',
      mean: +(sum / n).toFixed(4), p10: q(0.10), p50: q(0.50), p90: q(0.90),
      pctBlack: +(100 * black / n).toFixed(1),
      meanRG: +(rg / n).toFixed(2), meanRB: +(rb / n).toFixed(2),
    };
  });
  console.log(JSON.stringify(out, null, 1));
  console.log('errs', errs.length, errs.slice(0, 3).join(' | '));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
