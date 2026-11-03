/* Proves the atlas no longer depends on which monospace the OS resolves.
 * Rasterises the same charset three ways and compares the ink ramp. */
const puppeteer = require('/tmp/pup/node_modules/puppeteer-core');
const URL = process.env.GAME_URL;

(async () => {
  const r = await fetch(URL.replace('https://', 'https://') + 'assets/glyphmono.woff2');
  const body = await r.arrayBuffer();
  console.log('asset', JSON.stringify({
    status: r.status, type: r.headers.get('content-type'), bytes: body.byteLength,
    magic: String.fromCharCode(...new Uint8Array(body.slice(0, 4))),
  }));

  const b = await puppeteer.launch({
    executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--user-data-dir=/tmp/cmp/fp1'],
  });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
  await p.setViewport({ width: 1000, height: 700 });
  await p.goto(URL + '?name=FPIN', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((res) => setTimeout(res, 6000));

  const out = await p.evaluate(async () => {
    const g = window.__game;
    const loaded = await document.fonts.load('bold 32px "GlyphMono"').then((f) => f.length);
    const inkOf = (family) => {
      const chars = Array.from(g.pass.chars);
      const a = document.createElement('canvas');
      a.width = 16 * 20; a.height = Math.ceil(chars.length / 16) * 32;
      const x = a.getContext('2d', { willReadFrequently: true });
      x.fillStyle = '#000'; x.fillRect(0, 0, a.width, a.height);
      x.fillStyle = '#fff'; x.textBaseline = 'top'; x.textRendering = 'geometricPrecision';
      x.font = `bold 32px ${family}`;
      for (let i = 0; i < chars.length; i++) x.fillText(chars[i], (i % 16) * 20, Math.floor(i / 16) * 32);
      const d = x.getImageData(0, 0, a.width, a.height).data;
      return [...chars].map((c, i) => {
        let s = 0;
        for (let y = 0; y < 32; y++) for (let xx = 0; xx < 20; xx++) s += d[((Math.floor(i / 16) * 32 + y) * a.width + ((i % 16) * 20 + xx)) * 4];
        return +(s / (32 * 20 * 255)).toFixed(3);
      });
    };
    const pinned = inkOf('"GlyphMono"');
    const bogus = inkOf('"NoSuchFace AT ALL", "AlsoMissing"');
    const live = Array.from(g.pass.chars).map((c, i) => {
      let s = 0;
      for (let k = 0; k < g.pass.SIG_N; k++) s += g.pass.sigs[i * g.pass.SIG_N + k];
      return +(s / g.pass.SIG_N).toFixed(3);
    });
    const diff = (A, B) => +(A.reduce((a, v, i) => a + Math.abs(v - B[i]), 0) / A.length).toFixed(4);
    // Blank cells would mean the subset is missing a charset glyph.
    const blanks = Array.from(g.pass.chars).map((c, i) => (c !== ' ' && pinned[i] === 0 ? c : null)).filter(Boolean);
    return {
      faces: loaded, set: g.pass.cfg.set, n: g.pass.chars.length,
      pinnedVsBogus: diff(pinned, bogus),
      pinnedVsLiveAtlas: diff(pinned, live),
      blankGlyphs: blanks,
      sample: pinned.slice(0, 6).concat(live.slice(0, 6)),
    };
  });
  console.log(JSON.stringify(out, null, 1));

  // Now the same for every charset: a subset glyph that does not exist shows as blank.
  const sets = await p.evaluate(async () => {
    const g = window.__game, res = {};
    for (const name of ['standard', 'blocks', 'binary', 'detailed', 'minimal', 'alphabetic', 'numeric', 'math', 'emoji', 'custom']) {
      g.pass.cfg.set = name;
      g.pass.buildAtlas();
      const blanks = [];
      Array.from(g.pass.chars).forEach((c, i) => {
        if (c === ' ') return;
        let s = 0;
        for (let k = 0; k < g.pass.SIG_N; k++) s += g.pass.sigs[i * g.pass.SIG_N + k];
        if (s === 0) blanks.push(c);
      });
      res[name] = { chars: Array.from(g.pass.chars).length, blanks };
    }
    g.pass.cfg.set = 'detailed'; g.pass.buildAtlas(); g.pass.buildTiles();
    return res;
  });
  console.log('charsets', JSON.stringify(sets));
  console.log('errs', errs);
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
