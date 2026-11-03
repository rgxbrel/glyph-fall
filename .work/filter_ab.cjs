// A/B the source-sample filter on ONE frozen frame: bilinear (the shipped port,
// mirrors the original's linear sampler) vs nearest texel (what the port did
// before). Same page, same sceneImg, same T, grain off => the only difference is
// the filter. Also reports the stock-config canvas stats against the reference.
const puppeteer = require('/tmp/pup/node_modules/puppeteer-core');
const URL = process.env.GAME_URL || 'http://127.0.0.1:8780';

const REF = { mean: 0.0779, p10: 0.061, p50: 0.071, p90: 0.101, pctBlack: 0, meanRG: 4.36, meanRB: 9.16 };

(async () => {
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--user-data-dir=/tmp/cmp/pAB' + process.pid],
  });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await p.setViewport({ width: 1000, height: 700 });
  await p.goto(URL + '?name=FLT' + process.pid, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 9000));

  const out = await p.evaluate((ref) => {
    const ps = window.__game.pass;
    const stats = () => {
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
      const q = (f) => +lum[Math.floor(f * (n - 1))].toFixed(3);
      return { mean: +(sum / n).toFixed(4), p10: q(0.1), p50: q(0.5), p90: q(0.9),
        pctBlack: +(100 * black / n).toFixed(1), meanRG: +(rg / n).toFixed(2), meanRB: +(rb / n).toFixed(2) };
    };
    const dist = (s) => +Math.hypot(
      (s.mean - ref.mean) / ref.mean, (s.p50 - ref.p50) / ref.p50, (s.p90 - ref.p90) / ref.p90,
      (s.meanRG - ref.meanRG) / ref.meanRG, (s.meanRB - ref.meanRB) / ref.meanRB).toFixed(4);

    // Freeze: grain off, no RAF interference while we compare.
    ps.cfg.grain = false;
    const T = ps.time;
    ps.render(T);
    const A = { ch: ps.cellChar.slice(), r: ps.cellR.slice(), g: ps.cellG.slice(), b: ps.cellB.slice(), stats: stats() };

    // Nearest-texel sampler: exactly what the port did before this change.
    const W = ps.W, H = ps.H, sd = ps.sceneImg.data;
    ps.sampleSource = (uvX, uvY, o) => {
      const x = Math.min(W - 1, Math.max(0, Math.floor(uvX * W)));
      const y = Math.min(H - 1, Math.max(0, Math.floor(uvY * H)));
      const i4 = (y * W + x) * 4;
      o[0] = sd[i4]; o[1] = sd[i4 + 1]; o[2] = sd[i4 + 2];
      return o;
    };
    ps.cellDone.fill(-1);
    ps.render(T);
    const B = { ch: ps.cellChar.slice(), r: ps.cellR.slice(), g: ps.cellG.slice(), b: ps.cellB.slice(), stats: stats() };

    const n = A.ch.length;
    let diff = 0, colorSum = 0, maxd = 0;
    const hist = {};
    for (let i = 0; i < n; i++) {
      if (A.ch[i] !== B.ch[i]) {
        diff++;
        const k = ps.chars[A.ch[i]] + '->' + ps.chars[B.ch[i]];
        hist[k] = (hist[k] || 0) + 1;
      }
      const dr = A.r[i] - B.r[i], dg = A.g[i] - B.g[i], db = A.b[i] - B.b[i];
      const m = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
      if (m > maxd) maxd = m;
      colorSum += (dr * dr + dg * dg + db * db) / 3;
    }
    // How many of the differences land on the same glyph family (adjacent index)?
    let adjacent = 0;
    for (let i = 0; i < n; i++) if (A.ch[i] !== B.ch[i] && Math.abs(A.ch[i] - B.ch[i]) === 1) adjacent++;

    ps.cfg.grain = true;
    ps.cellDone.fill(-1);
    ps.render(performance.now());
    return {
      cells: n,
      glyphChanged: diff, glyphChangedPct: +(100 * diff / n).toFixed(1),
      changedByAdjacentIndex: adjacent,
      colorRMS: +Math.sqrt(colorSum / n).toFixed(2), maxColorDelta: maxd,
      topTransitions: Object.entries(hist).sort((x, y) => y[1] - x[1]).slice(0, 6)
        .map(([k, v]) => k + ':' + v),
      bilinearStats: A.stats, nearestStats: B.stats,
      refDistanceBilinear: dist(A.stats), refDistanceNearest: dist(B.stats),
      fps: document.getElementById('fps')?.textContent,
    };
  }, REF);

  console.log(JSON.stringify(out, null, 1));
  console.log('errs', errs.length, errs.slice(0, 3).join(' | '));
  await p.screenshot({ path: '/tmp/cmp/filter-ab.png' });
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
