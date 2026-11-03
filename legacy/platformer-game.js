/*
 * GLYPH CLIMB — a platformer rendered through a Grainrad-style ASCII pass.
 *
 * scene (colour, low-res) -> per-cell luminance -> charset index, refined by
 * spatial similarity against a font atlas -> cell's own colour -> composite
 * tiles -> post (chroma / scanlines / grain / bloom / vignette / CRT).
 */
(() => {
  const out = document.getElementById('out');
  const ctx = out.getContext('2d', { alpha: false });
  const sceneC = document.createElement('canvas');
  const sceneX = sceneC.getContext('2d', { willReadFrequently: true });
  const bloomC = document.createElement('canvas');
  const bloomX = bloomC.getContext('2d', { willReadFrequently: true });

  // Exact charset strings from the Grainrad bundle (const Tn).
  const CHARSETS = {
    standard: ' .:-=+*#%@',
    blocks: ' ░▒▓█',
    binary: ' 01',
    detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    minimal: ' .:#',
    alphabetic: ' .icotCOXWM',
    numeric: ' 1234567890',
    math: ' .-+×÷=≠<>≤≥∞∑√∫',
    emoji: ' ·•○◎●◐◑◒◓◔◕◖◗',
    custom: ' .:+*#@',
  };

  // Defaults mirror the app's stock settings object (const Ge): grain is the
  // only post-effect on, spatialWeight 0 means pure index-ramp matching.
  const cfg = {
    set: 'standard',
    cell: 16,          // cellPx = CELL_BASE(8) * character.scale(2)
    scale: 2,
    spacing: 0,
    matchQuality: 'fast',
    brightnessWeight: 1, // 1 - spatialWeight
    brightnessMapping: 1,
    edgeEnhance: 0,
    blur: 0,
    quantizeColors: 0,
    colorMode: 0, // 0 original · 1 phosphor · 2 mono
    colorIntensity: 1,
    phosphor: '#00ff00',
    invert: false,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    hue: 0,
    gamma: 1,
    bloom: false,
    bloomThreshold: 0.3,
    bloomIntensity: 1.5,
    grain: true,
    grainIntensity: 35,
    grainSize: 2,
    grainSpeed: 50,
    chromatic: false,
    chromaticOffset: 2,
    scanlines: false,
    scanlineOpacity: 0.1,
    scanlineSpacing: 4,
    vignette: false,
    vignetteIntensity: 0.5,
    vignetteRadius: 0.5,
    crt: false,
    crtAmount: 0.1,
    bg: 0xff000000,
  };

  const SAMPLES = { fast: 2, balanced: 3, quality: 4 };

  const BASE_FONT = 8;                 // Grainrad's base font size, in CSS px
  let cellW = 9.6, cellH = 16;         // scale*8*0.6 × scale*8
  let sigSide = 2, SIG_N = 4;
  let chars = '', N = 0, atlas = null;
  let aW = 0, aH = 0, acw = 0, ach = 0; // atlas size and glyph cell
  let sigs = null;                       // Float32Array(N * SIG_N)
  let tiles = null;                      // Uint8Array(N * tileW * tileH)
  let tileW = 1, tileH = 1;
  let W = 0, H = 0, cellsX = 1, cellsY = 1, sceneW = 1, sceneH = 1;
  let outImg = null, out32 = null, sceneImg = null;
  let pxCell = null, pxTx = null, pxTy = null;

  const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  function setQuality(q) {
    cfg.matchQuality = q;
    sigSide = SAMPLES[q];
    SIG_N = sigSide * sigSide;
    sigCache = new Float32Array(SIG_N);
    buildAtlas();
  }

  function setScale(s) {
    cfg.scale = s;
    cellW = s * BASE_FONT * 0.6;
    cellH = s * BASE_FONT;
    buildAtlas(); buildTiles(); resize();
  }

  // Atlas layout is fixed: 16 columns, glyph cell ceil(l*0.6) x l, bold mono.
  function buildAtlas() {
    chars = CHARSETS[cfg.set];
    N = chars.length;
    const l = Math.max(32, Math.ceil(32 * Math.max(1, Math.ceil(cfg.scale / 4) / 4)));
    acw = Math.ceil(l * 0.6); ach = l;
    const cols = 16, rows = Math.ceil(N / cols);
    aW = cols * acw; aH = rows * ach;
    const a = document.createElement('canvas');
    a.width = aW; a.height = aH;
    const ax = a.getContext('2d', { willReadFrequently: true });
    ax.fillStyle = '#000'; ax.fillRect(0, 0, aW, aH);
    ax.fillStyle = '#fff';
    ax.font = `bold ${l}px "JetBrains Mono", "SF Mono", "Fira Code", "DejaVu Sans Mono", monospace`;
    ax.textBaseline = 'top'; ax.textRendering = 'geometricPrecision';
    for (let i = 0; i < N; i++) ax.fillText(chars[i], (i % cols) * acw, Math.floor(i / cols) * ach);
    atlas = ax.getImageData(0, 0, aW, aH).data;
    // Per-character signature: coverage at each sample position of the glyph cell.
    sigs = new Float32Array(N * SIG_N);
    for (let ci = 0; ci < N; ci++) {
      const ox = (ci % cols) * acw, oy = Math.floor(ci / cols) * ach;
      for (let sy = 0; sy < sigSide; sy++) {
        for (let sx = 0; sx < sigSide; sx++) {
          const bx = Math.floor(sx * acw / sigSide), by = Math.floor(sy * ach / sigSide);
          const ex = Math.min(acw, Math.floor((sx + 1) * acw / sigSide));
          const ey = Math.min(ach, Math.floor((sy + 1) * ach / sigSide));
          let sum = 0, cnt = 0;
          for (let y = by; y < ey; y++)
            for (let x = bx; x < ex; x++) { sum += atlas[(oy + y) * aW + (ox + x)]; cnt++; }
          sigs[ci * SIG_N + sy * sigSide + sx] = cnt ? sum / (cnt * 255) : 0;
        }
      }
    }
  }

  // Pre-render every glyph as a coverage mask at cell resolution; the composite
  // multiplies that coverage by the cell colour, like mix(bg, color, intensity).
  function buildTiles() {
    if (!atlas) return;
    tileW = Math.ceil(cellW); tileH = Math.ceil(cellH);
    const cols = 16;
    tiles = new Uint8Array(N * tileW * tileH);
    const gap = cfg.spacing * 0.5, half = gap * 0.5, area = 1 - gap, inv = 1 / area;
    for (let ci = 0; ci < N; ci++) {
      const aox = (ci % cols) * acw, aoy = Math.floor(ci / cols) * ach;
      for (let py = 0; py < tileH; py++) {
        for (let px = 0; px < tileW; px++) {
          const u = (px + 0.5) / tileW, v = (py + 0.5) / tileH;
          let mask = 0;
          if (!(u < half || u > 1 - half || v < half || v > 1 - half)) {
            const rx = Math.min(1, Math.max(0, (u - half) * inv));
            const ry = Math.min(1, Math.max(0, (v - half) * inv));
            const axp = Math.min(acw - 1, Math.floor(rx * acw));
            const ayp = Math.min(ach - 1, Math.floor(ry * ach));
            mask = atlas[(aoy + ayp) * aW + (aox + axp)];
          }
          tiles[ci * tileW * tileH + py * tileW + px] = mask;
        }
      }
    }
  }

  const _pc = [0, 0, 0];
  function processColor(r, g, b) {
    let rr = r / 255, gg = g / 255, bb = b / 255;
    if (cfg.gamma !== 1) {
      const ig = 1 / cfg.gamma;
      rr = Math.pow(rr, ig); gg = Math.pow(gg, ig); bb = Math.pow(bb, ig);
    }
    const br = cfg.brightness * 0.005;
    if (br) { rr += br; gg += br; bb += br; }
    if (cfg.contrast) {
      const k = (cfg.contrast + 100) * 0.01;
      rr = (rr - 0.5) * k + 0.5; gg = (gg - 0.5) * k + 0.5; bb = (bb - 0.5) * k + 0.5;
    }
    if (cfg.saturation) {
      const s = 1 + cfg.saturation * 0.01;
      const l = rr * 0.299 + gg * 0.587 + bb * 0.114;
      rr = l + (rr - l) * s; gg = l + (gg - l) * s; bb = l + (bb - l) * s;
    }
    _pc[0] = Math.min(255, Math.max(0, rr)) * 255;
    _pc[1] = Math.min(255, Math.max(0, gg)) * 255;
    _pc[2] = Math.min(255, Math.max(0, bb)) * 255;
    return _pc;
  }

  // The compute shader's source-brightness chain, verbatim in operation order.
  function sourceBrightness(r, g, b) {
    let v = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    v = Math.pow(v, 1 / cfg.gamma);
    v += cfg.brightness * 0.005;
    v = (v - 0.5) * ((cfg.contrast + 100) * 0.01) + 0.5;
    v = Math.pow(Math.min(1, Math.max(0, v)), cfg.brightnessMapping);
    if (cfg.invert) v = 1 - v;
    return Math.min(1, Math.max(0, v));
  }

  function pickChar(samples, b) {
    // >= 0.99 brightness weight is the shader's fast path: pure index ramp.
    if (cfg.brightnessWeight >= 0.99) {
      return Math.min(N - 1, (Math.min(b, 0.9999) * N) | 0);
    }
    const expected = b * (N - 1);
    const w = cfg.brightnessWeight, sw = 1 - w;
    let best = 0, bestScore = Infinity;
    for (let ci = 0; ci < N; ci++) {
      const indexDist = Math.abs(ci - expected) / N;
      let spatial = 0;
      const base = ci * SIG_N;
      for (let k = 0; k < SIG_N; k++) {
        const diff = samples[k] - sigs[base + k];
        spatial += diff * diff;
      }
      const score = indexDist * w + (spatial / SIG_N) * sw;
      if (score < bestScore) { bestScore = score; best = ci; }
    }
    return best;
  }

  // ---------------------------------------------------------------- game ----
  const WORLD = { w: 900, h: 5200 };
  const GRAV = 2300, JUMP = 860, MAXFALL = 1500;
  const MOVE_G = 5200, MOVE_A = 3000, MAX_VX = 360, FRIC_G = 26;

  let rng = mulberry(1337);
  function mulberry(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const P = { x: 450, y: 0, w: 34, h: 58, vx: 0, vy: 0, grounded: false, coyote: 0, buffer: 0, face: 1 };
  const game = {
    state: 'title', platforms: [], glyphs: [], spikes: [], pads: [], parts: [],
    cam: 0, topY: 0, height: 0, best: 0, collected: 0, t: 0, timeAlive: 0,
    glitch: 0, glitchAt: 2, shake: 0,
  };

  function buildLevel() {
    rng = mulberry((Math.random() * 1e9) | 0);
    game.platforms = []; game.glyphs = []; game.spikes = []; game.pads = []; game.parts = [];
    game.platforms.push({ x: 0, y: WORLD.h - 60, w: WORLD.w, h: 40, kind: 'ground' });
    let y = WORLD.h - 190;
    let i = 0;
    while (y > 260) {
      const w = 110 + Math.floor(rng() * 170);
      const x = Math.max(20, Math.min(WORLD.w - w - 20, rng() * (WORLD.w - w) - 10));
      const plat = { x, y, w, h: 20, kind: i % 7 === 3 ? 'move' : 'solid' };
      if (plat.kind === 'move') { plat.ox = x; plat.range = 90 + rng() * 110; plat.speed = 0.6 + rng() * 0.9; plat.phase = rng() * 6.28; }
      game.platforms.push(plat);
      if (i > 2 && rng() < 0.34 && plat.kind === 'solid') {
        const sw = 26 + rng() * 34;
        game.spikes.push({ x: x + 8 + rng() * (w - sw - 16), y: y - 20, w: sw, h: 20 });
      }
      if (rng() < 0.72) {
        game.glyphs.push({ x: x + w / 2, y: y - 74 - rng() * 60, r: 13, got: false, ph: rng() * 6.28 });
      }
      if (i % 8 === 7) game.pads.push({ x: WORLD.w / 2 - 70, y: y - 16, w: 140, h: 16, lit: 0 });
      if (rng() < 0.22) {
        const w2 = 80 + rng() * 90;
        game.platforms.push({ x: Math.max(20, Math.min(WORLD.w - w2 - 20, x + (rng() - 0.5) * 520)), y: y - 78, w: w2, h: 16, kind: 'thin' });
      }
      y -= 108 + rng() * 76;
      i++;
    }
    game.goalY = 200;
    game.topY = y;
  }

  function reset(run) {
    buildLevel();
    P.x = WORLD.w / 2 - P.w / 2; P.y = WORLD.h - 60 - P.h; P.vx = 0; P.vy = 0;
    game.cam = P.y - 520; game.collected = 0; game.height = 0; game.timeAlive = 0;
    game.checkpoint = { x: P.x, y: P.y };
    if (run) game.state = 'play';
  }

  const keys = new Set();
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ([' ', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) e.preventDefault();
    keys.add(k);
    if (k === ' ' || k === 'arrowup' || k === 'w') {
      if (game.state === 'title') { game.state = 'play'; reset(true); }
      P.buffer = 0.13;
    }
    if (game.state === 'win' && k === ' ') reset(true);
    hotkeys(k);
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  function spawn(x, y, n, col, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      game.parts.push({ x, y, vx: Math.cos(a) * spd * Math.random(), vy: Math.sin(a) * spd * Math.random() - 60, life: 0.5 + Math.random() * 0.5, col });
    }
  }

  function update(dt) {
    game.t += dt;
    if (game.state !== 'play') { updateParts(dt); return; }
    game.timeAlive += dt;

    const left = keys.has('arrowleft') || keys.has('a');
    const right = keys.has('arrowright') || keys.has('d');
    const acc = P.grounded ? MOVE_G : MOVE_A;
    if (left && !right) { P.vx -= acc * dt; P.face = -1; }
    else if (right && !left) { P.vx += acc * dt; P.face = 1; }
    else if (P.grounded) P.vx -= P.vx * Math.min(1, FRIC_G * dt);
    P.vx = Math.max(-MAX_VX, Math.min(MAX_VX, P.vx));

    P.vy += GRAV * dt;
    if (!keys.has(' ') && !keys.has('arrowup') && !keys.has('w') && P.vy < 0) P.vy += GRAV * 1.4 * dt;
    P.vy = Math.min(MAXFALL, P.vy);

    P.buffer -= dt; P.coyote -= dt;
    if (P.buffer > 0 && (P.grounded || P.coyote > 0)) {
      P.vy = -JUMP; P.grounded = false; P.coyote = 0; P.buffer = 0;
      spawn(P.x + P.w / 2, P.y + P.h, 8, 'rgba(255,235,130,1)', 160);
    }

    for (const pl of game.platforms) {
      if (pl.kind === 'move') pl.x = pl.ox + Math.sin(game.t * pl.speed + pl.phase) * pl.range;
    }

    const prevBottom = P.y + P.h;
    P.x += P.vx * dt;
    if (P.x < 6) { P.x = 6; P.vx = 0; }
    if (P.x + P.w > WORLD.w - 6) { P.x = WORLD.w - 6 - P.w; P.vx = 0; }
    P.y += P.vy * dt;

    const wasGrounded = P.grounded;
    P.grounded = false;
    for (const pl of game.platforms) {
      if (P.x + P.w < pl.x || P.x > pl.x + pl.w) continue;
      const bottom = P.y + P.h;
      if (P.vy >= 0 && prevBottom <= pl.y + 8 && bottom >= pl.y) {
        P.y = pl.y - P.h; P.vy = 0; P.grounded = true; P.coyote = 0.12;
      }
    }
    if (P.grounded && !wasGrounded) spawn(P.x + P.w / 2, P.y + P.h, 5, 'rgba(120,255,190,1)', 110);

    for (const g of game.glyphs) {
      if (g.got) continue;
      const dx = P.x + P.w / 2 - g.x, dy = P.y + P.h / 2 - g.y;
      if (dx * dx + dy * dy < (g.r + 26) * (g.r + 26)) {
        g.got = true; game.collected++;
        spawn(g.x, g.y, 14, 'rgba(255,214,64,1)', 220);
      }
    }
    for (const s of game.spikes) {
      if (P.x + P.w > s.x && P.x < s.x + s.w && P.y + P.h > s.y && P.y < s.y + s.h) die();
    }
    for (const pd of game.pads) {
      pd.lit = Math.max(0, pd.lit - dt * 2);
      if (P.x + P.w > pd.x && P.x < pd.x + pd.w && P.y + P.h > pd.y && P.y < pd.y + pd.h + 12) {
        if (!pd.active) { pd.lit = 1; game.checkpoint = { x: pd.x + pd.w / 2 - P.w / 2, y: pd.y - P.h - 2 }; }
        pd.active = true;
        P.vy = -JUMP * 1.35; P.grounded = false;
      } else pd.active = false;
    }

    const viewH = sceneH / WORLD.w * sceneW;
    const target = Math.max(0, Math.min(WORLD.h - viewH, P.y - viewH * 0.58));
    game.cam += (target - game.cam) * Math.min(1, 7 * dt);
    game.cam = Math.max(0, Math.min(WORLD.h - viewH, game.cam));

    game.height = Math.max(game.height, Math.round((WORLD.h - P.y) / 10));
    if (P.y < 250) {
      game.state = 'win';
      game.best = game.best ? Math.min(game.best, game.timeAlive) : game.timeAlive;
      spawn(P.x + P.w / 2, P.y, 60, 'rgba(160,255,120,1)', 340);
    }
    if (P.y > WORLD.h + 260) die();

    game.glitchAt -= dt;
    if (game.glitchAt <= 0) { game.glitch = 0.12 + Math.random() * 0.16; game.glitchAt = 1.6 + Math.random() * 3.4; }
    game.glitch = Math.max(0, game.glitch - dt);
    game.shake = Math.max(0, game.shake - dt * 3);
    updateParts(dt);
  }

  function updateParts(dt) {
    for (let i = game.parts.length - 1; i >= 0; i--) {
      const p = game.parts[i];
      p.life -= dt; p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.life <= 0) game.parts.splice(i, 1);
    }
  }

  function die() {
    spawn(P.x + P.w / 2, P.y + P.h / 2, 26, 'rgba(255,70,70,1)', 300);
    game.shake = 1;
    P.x = game.checkpoint.x; P.y = game.checkpoint.y; P.vx = 0; P.vy = 0;
  }

  // ---------------------------------------------------------------- scene ---
  function drawScene() {
    const sw = sceneW, sh = sceneH;
    const sx = sceneX;
    const sc = sw / WORLD.w;
    const camY = game.cam + (game.shake > 0 ? (Math.random() - 0.5) * 14 * game.shake : 0);

    const grd = sx.createLinearGradient(0, 0, 0, sh);
    grd.addColorStop(0, '#0a1030'); grd.addColorStop(0.55, '#070a16'); grd.addColorStop(1, '#04060c');
    sx.fillStyle = grd; sx.fillRect(0, 0, sw, sh);

    sx.save(); sx.scale(sc, sc); sx.translate(0, -camY);

    // parallax glyph rain
    sx.font = '600 22px ui-monospace, monospace'; sx.textAlign = 'center';
    for (let c = 0; c < 22; c++) {
      const x = 30 + c * 40;
      const speed = 40 + (c % 5) * 26;
      const off = (camY * 0.28 + game.t * speed);
      for (let k = 0; k < 26; k++) {
        const y = ((k * 190 + off) % (WORLD.h + 400)) - 200;
        const ch = CHARSETS.blocks[1 + ((c * 7 + k * 3) % 4)];
        sx.fillStyle = `rgba(40,90,150,${0.06 + 0.05 * Math.sin(game.t + k)})`;
        sx.fillText(ch, x, y);
      }
    }
    // structural lines
    sx.strokeStyle = 'rgba(70,110,140,0.25)'; sx.lineWidth = 2;
    for (let y = Math.floor(camY / 160) * 160; y < camY + sh / sc + 160; y += 160) {
      sx.beginPath(); sx.moveTo(0, y); sx.lineTo(WORLD.w, y); sx.stroke();
    }
    sx.strokeStyle = 'rgba(70,110,140,0.18)';
    for (let x = 0; x <= WORLD.w; x += 150) { sx.beginPath(); sx.moveTo(x, camY); sx.lineTo(x, camY + sh / sc); sx.stroke(); }

    // goal band
    sx.fillStyle = 'rgba(120,255,140,0.5)'; sx.fillRect(0, 150, WORLD.w, 8);
    sx.fillStyle = '#9dff6a'; sx.font = '700 30px ui-monospace, monospace';
    sx.fillText('SUMMIT', WORLD.w / 2, 120);

    for (const pd of game.pads) {
      sx.fillStyle = pd.lit > 0 ? '#eaffb0' : '#5fd6ff';
      sx.fillRect(pd.x, pd.y, pd.w, pd.h);
      sx.fillStyle = 'rgba(95,214,255,0.28)'; sx.fillRect(pd.x, pd.y - 46, pd.w, 4);
    }

    for (const pl of game.platforms) {
      if (pl.y - camY > sh / sc + 60 || pl.y - camY < -120) continue;
      const grad = sx.createLinearGradient(0, pl.y, 0, pl.y + pl.h);
      if (pl.kind === 'ground') { grad.addColorStop(0, '#ffb347'); grad.addColorStop(1, '#6b4310'); }
      else if (pl.kind === 'move') { grad.addColorStop(0, '#c2f5ff'); grad.addColorStop(1, '#2f6f80'); }
      else if (pl.kind === 'thin') { grad.addColorStop(0, '#ffd9a0'); grad.addColorStop(1, '#7a5322'); }
      else { grad.addColorStop(0, '#ffcf6a'); grad.addColorStop(1, '#8a5a17'); }
      sx.fillStyle = grad; sx.fillRect(pl.x, pl.y, pl.w, pl.h);
      sx.fillStyle = 'rgba(255,255,255,0.55)'; sx.fillRect(pl.x, pl.y, pl.w, 3);
    }

    for (const s of game.spikes) {
      const pulse = 0.65 + 0.35 * Math.sin(game.t * 6);
      sx.fillStyle = `rgba(255,${60 * pulse | 0},${60 * pulse | 0},1)`;
      for (let x = s.x; x < s.x + s.w - 4; x += 9) {
        sx.beginPath(); sx.moveTo(x, s.y + s.h); sx.lineTo(x + 4.5, s.y); sx.lineTo(x + 9, s.y + s.h); sx.closePath(); sx.fill();
      }
    }

    for (const g of game.glyphs) {
      if (g.got) continue;
      const bob = Math.sin(game.t * 2.4 + g.ph) * 5;
      const sq = 0.55 + 0.45 * Math.abs(Math.sin(game.t * 1.8 + g.ph));
      sx.save(); sx.translate(g.x, g.y + bob); sx.scale(sq, 1);
      sx.strokeStyle = '#ffd23f'; sx.lineWidth = 4;
      sx.beginPath(); sx.arc(0, 0, g.r, 0, 6.283); sx.stroke();
      sx.fillStyle = '#fff2a8'; sx.font = '700 15px ui-monospace, monospace'; sx.textAlign = 'center';
      sx.fillText('@', 0, 5); sx.restore();
    }

    for (const p of game.parts) {
      sx.fillStyle = p.col; sx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
      sx.fillRect(p.x - 3, p.y - 3, 6, 6); sx.globalAlpha = 1;
    }

    if (game.state !== 'title') drawPlayer(sx);
    sx.restore();

    // HUD lives in scene space so it goes through the ASCII pass too
    sceneHud(sx, sw, sh);
  }

  function drawPlayer(sx) {
    const x = P.x, y = P.y, w = P.w, h = P.h;
    const squash = P.grounded ? 1 : (P.vy < 0 ? 1.12 : 0.92);
    const hh = h * (2 - squash), ww = w * (squash - 0.5) + w * 0.5;
    const px = x + (w - ww) / 2, py = y + (h - hh);
    if (game.glitch > 0) {
      sx.fillStyle = 'rgba(255,40,120,0.75)'; sx.fillRect(px - 8, py + 6, ww + 16, 7);
      sx.fillStyle = 'rgba(40,255,220,0.75)'; sx.fillRect(px - 8, py + hh - 16, ww + 16, 6);
    }
    const g = sx.createLinearGradient(0, py, 0, py + hh);
    g.addColorStop(0, '#eafcff'); g.addColorStop(0.5, '#39e6ff'); g.addColorStop(1, '#0f6f96');
    sx.fillStyle = g; sx.fillRect(px, py, ww, hh);
    sx.fillStyle = '#04121c';
    sx.fillRect(px + (P.face > 0 ? ww * 0.5 : ww * 0.15), py + hh * 0.2, ww * 0.35, hh * 0.16);
    sx.fillStyle = '#c8fff0'; sx.fillRect(px + (P.face > 0 ? ww * 0.68 : ww * 0.2), py + hh * 0.23, 6, 6);
  }

  function sceneHud(sx, sw, sh) {
    if (game.state === 'title') {
      sx.fillStyle = 'rgba(4,7,12,0.72)'; sx.fillRect(0, 0, sw, sh);
      sx.textAlign = 'center';
      sx.fillStyle = '#d8fff0'; sx.font = `900 ${Math.round(sh * 0.11)}px ui-monospace, monospace`;
      sx.fillText('GLYPH', sw / 2, sh * 0.36);
      sx.fillText('CLIMB', sw / 2, sh * 0.52);
      sx.fillStyle = '#7fe9c0'; sx.font = `600 ${Math.round(sh * 0.035)}px ui-monospace, monospace`;
      sx.fillText('PRESS SPACE  /  SETAS PARA SUBIR', sw / 2, sh * 0.66);
      sx.fillStyle = '#4f9a7c'; sx.font = `500 ${Math.round(sh * 0.026)}px ui-monospace, monospace`;
      sx.fillText('ASCII BLOCK PASS  ·  GRAINRAD PIPELINE', sw / 2, sh * 0.74);
      return;
    }
    sx.textAlign = 'left';
    sx.fillStyle = 'rgba(3,6,10,0.68)'; sx.fillRect(0, 0, sw, 30);
    sx.fillStyle = '#c9ffe8'; sx.font = '700 24px ui-monospace, monospace';
    const m = Math.floor(game.timeAlive / 60), s = (game.timeAlive % 60).toFixed(1).padStart(4, '0');
    sx.fillText(`${String(game.height).padStart(4, '0')}m  GLYPH ${String(game.collected).padStart(3, '0')}  ${m}:${s}`, 8, 22);
    if (game.state === 'win') {
      sx.fillStyle = 'rgba(4,7,12,0.78)'; sx.fillRect(0, sh * 0.3, sw, sh * 0.3);
      sx.textAlign = 'center'; sx.fillStyle = '#c6ff8a';
      sx.font = `900 ${Math.round(sh * 0.1)}px ui-monospace, monospace`;
      sx.fillText('TOPO', sw / 2, sh * 0.44);
      sx.fillStyle = '#8fe8b0'; sx.font = '600 22px ui-monospace, monospace';
      sx.fillText(`${game.height}m  ${m}:${s}  ${game.collected} glyphs   [space] de novo`, sw / 2, sh * 0.55);
    }
  }

  // One pass, like the WGSL fragment: per output pixel we resolve which ASCII
  // cell it falls in (after CRT warp), pick that cell's glyph, and colour it
  // with the cell's own sampled colour. R/B re-resolve at a shifted x, which is
  // exactly the chromatic-aberration sampling in the original shader.
  let cellChar = null, cellR = null, cellG = null, cellB = null, cellDone = null;
  let sigCache = new Float32Array(16);
  let vigX = null, vigY = null, scanTable = null;

  function buildFxTables() {
    vigX = new Float32Array(W);
    vigY = new Float32Array(H);
    scanTable = new Float32Array(H);
    const sp = Math.max(1, cfg.scanlineSpacing);
    for (let x = 0; x < W; x++) {
      vigX[x] = cfg.vignette ? Math.abs((x + 0.5) / W * 2 - 1) : 0;
    }
    for (let y = 0; y < H; y++) {
      vigY[y] = cfg.vignette ? Math.abs((y + 0.5) / H * 2 - 1) : 0;
      const onScan = cfg.scanlines && cfg.scanlineOpacity > 0 && (y % (sp * 2)) < sp;
      scanTable[y] = onScan ? 1 - cfg.scanlineOpacity : 1;
    }
  }

  function resolveCell(cx, cy) {
    const i = cy * cellsX + cx;
    if (cellDone[i] === frameTag) return i;
    cellDone[i] = frameTag;
    const sd = sceneImg.data;
    // One textureSample at the cell centre, as the fragment shader does.
    const midX = Math.min(sceneW - 1, Math.floor((cx + 0.5) * cellW));
    const midY = Math.min(sceneH - 1, Math.floor((cy + 0.5) * cellH));
    const m4 = (midY * sceneW + midX) * 4;
    const r = sd[m4], g = sd[m4 + 1], b = sd[m4 + 2];
    const mapped = sourceBrightness(r, g, b);
    if (cfg.brightnessWeight < 0.99) {
      const stx = cellW / sigSide, sty = cellH / sigSide;
      for (let sy = 0; sy < sigSide; sy++) {
        const py = Math.min(sceneH - 1, Math.floor(cy * cellH + sy * sty + sty * 0.5));
        for (let sx = 0; sx < sigSide; sx++) {
          const px = Math.min(sceneW - 1, Math.floor(cx * cellW + sx * stx + stx * 0.5));
          const i4 = (py * sceneW + px) * 4;
          sigCache[sy * sigSide + sx] = sourceBrightness(sd[i4], sd[i4 + 1], sd[i4 + 2]);
        }
      }
    }
    cellChar[i] = pickChar(sigCache, mapped);
    let cr, cg, cb;
    if (cfg.colorMode === 1) {
      const ph = hex2rgb(cfg.phosphor);
      cr = ph[0] * mapped; cg = ph[1] * mapped; cb = ph[2] * mapped;
    } else if (cfg.colorMode === 2) {
      cr = cg = cb = mapped * 255;
    } else {
      const pp = processColor(r, g, b);
      cr = pp[0]; cg = pp[1]; cb = pp[2];
    }
    cellR[i] = Math.min(255, cr * cfg.colorIntensity) | 0;
    cellG[i] = Math.min(255, cg * cfg.colorIntensity) | 0;
    cellB[i] = Math.min(255, cb * cfg.colorIntensity) | 0;
    return i;
  }

  let frameTag = 0;

  function renderAscii() {
    sceneImg = sceneX.getImageData(0, 0, sceneW, sceneH);
    frameTag++;
    for (let cy = 0; cy < cellsY; cy++)
      for (let cx = 0; cx < cellsX; cx++) resolveCell(cx, cy);
    const tw = tileW, th = tileH, tsize = tw * th;
    const tileMask = tiles;
    const invW = 1 / W, invH = 1 / H;
    const invCW = 1 / cellW, invCH = 1 / cellH;
    const crtOn = cfg.crt, crtAmt = cfg.crtAmount * 55;
    const chroma = cfg.chromatic ? Math.round(cfg.chromaticOffset) : 0;
    const grainOn = cfg.grain, gs = Math.max(1, cfg.grainSize), gSeed = (game.t * cfg.grainSpeed) | 0;
    const vOn = cfg.vignette, vr = cfg.vignetteRadius, vInt = cfg.vignetteIntensity;
    const vDenom = Math.max(0.001, 1 - vr);
    const gAmp = cfg.grainIntensity * 2.55;
    const bg = cfg.bg;

    let o = 0;
    for (let y = 0; y < H; y++) {
      const rowK = scanTable[y];
      const vy2 = vigY[y] * vigY[y];
      for (let x = 0; x < W; x++, o++) {
        let ci, tx, ty;
        if (crtOn) {
          const nx = (x + 0.5) * invW * 2 - 1;
          const ny = (y + 0.5) * invH * 2 - 1;
          const warp = 1 + (nx * nx + ny * ny) * crtAmt;
          const sxp = (nx * warp * 0.5 + 0.5) * W;
          const syp = (ny * warp * 0.5 + 0.5) * H;
          if (sxp < 0 || sxp >= W || syp < 0 || syp >= H) { out32[o] = bg; continue; }
          const cx = Math.min(cellsX - 1, (sxp * invCW) | 0);
          const cy = Math.min(cellsY - 1, (syp * invCH) | 0);
          ci = resolveCell(cx, cy);
          tx = Math.min(tw - 1, (sxp - cx * cellW) | 0);
          ty = Math.min(th - 1, (syp - cy * cellH) | 0);
        } else {
          ci = pxCell[o]; tx = pxTx[o]; ty = pxTy[o];
        }
        const mask = tileMask[cellChar[ci] * tsize + ty * tw + tx] * 0.00392156862745098;
        let R = cellR[ci] * mask, G = cellG[ci] * mask, B = cellB[ci] * mask;
        if (chroma) {
          const xa = x - chroma, xb = x + chroma;
          const ca = (xa * invCW) | 0, cb2 = (xb * invCW) | 0, cy = (y * invCH) | 0;
          if (xa >= 0 && ca !== (x * invCW) | 0) R = cellR[resolveCell(Math.min(cellsX - 1, ca), cy)] * mask;
          if (xb < W && cb2 !== (x * invCW) | 0) B = cellB[resolveCell(Math.min(cellsX - 1, cb2), cy)] * mask;
        }
        let k = rowK;
        if (vOn) {
          const d = Math.sqrt(vigX[x] * vigX[x] + vy2);
          k *= 1 - Math.max(0, Math.min(1, (d - vr) / vDenom)) * vInt;
        }
        R *= k; G *= k; B *= k;
        if (grainOn) {
          let h = Math.imul((x / gs | 0) + 1, 374761393) ^ Math.imul((y / gs | 0) + gSeed + 7, 668265263);
          h = (h ^ (h >>> 13)) >>> 0;
          const n = (h / 4294967296 - 0.5) * gAmp;
          R += n; G += n; B += n;
        }
        out32[o] = (255 << 24) |
          ((B > 255 ? 255 : B < 0 ? 0 : B | 0) << 16) |
          ((G > 255 ? 255 : G < 0 ? 0 : G | 0) << 8) |
          (R > 255 ? 255 : R < 0 ? 0 : R | 0);
      }
    }
    ctx.putImageData(outImg, 0, 0);
    if (cfg.bloom && cfg.bloomIntensity > 0) bloomPass();
  }

  let brightImg = null;
  function bloomPass() {
    const d = outImg.data;
    if (!brightImg || brightImg.width !== W) brightImg = bloomX.createImageData(W, H);
    const bd = brightImg.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
      const k = l > 0.6 ? (l - 0.6) / 0.4 : 0;
      bd[i] = d[i] * k; bd[i + 1] = d[i + 1] * k; bd[i + 2] = d[i + 2] * k; bd[i + 3] = 255;
    }
    bloomX.putImageData(brightImg, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, cfg.bloomIntensity);
    ctx.filter = 'blur(4px)';
    ctx.drawImage(bloomC, 0, 0);
    ctx.filter = 'blur(10px)';
    ctx.globalAlpha = Math.min(1, cfg.bloomIntensity * 0.7);
    ctx.drawImage(bloomC, 0, 0);
    ctx.restore();
  }

  // ---------------------------------------------------------------- loop ----
  function resize() {
    const stage = document.getElementById('stage');
    const availW = stage.clientWidth, availH = stage.clientHeight;
    cellsX = Math.max(24, Math.floor((availW * 0.92) / cellW));
    cellsY = Math.max(16, Math.floor((availH * 0.94) / cellH));
    W = Math.floor(cellsX * cellW); H = cellsY * cellH;
    out.width = W; out.height = H;
    sceneW = W; sceneH = H;
    sceneC.width = sceneW; sceneC.height = sceneH;
    bloomC.width = W; bloomC.height = H;
    outImg = ctx.createImageData(W, H);
    out32 = new Uint32Array(outImg.data.buffer);
    const nCells = cellsX * cellsY;
    cellChar = new Uint16Array(nCells);
    cellR = new Uint8Array(nCells); cellG = new Uint8Array(nCells); cellB = new Uint8Array(nCells);
    cellDone = new Int32Array(nCells).fill(-1);
    buildTiles();
    buildFxTables();
    buildCellMap();
    const fit = Math.min(availW / W, availH / H, 1);
    out.style.width = `${Math.floor(W * fit)}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // Cell index and glyph texel offset per output pixel: the shader divides by a
  // fractional cellSize (9.6 x 16 at scale 2), so precompute it once per resize.
  function buildCellMap() {
    pxCell = new Int32Array(W * H);
    pxTx = new Uint8Array(W * H);
    pxTy = new Uint8Array(W * H);
    let o = 0;
    for (let y = 0; y < H; y++) {
      const cy = Math.min(cellsY - 1, (y / cellH) | 0);
      const ty = Math.min(tileH - 1, y - cy * cellH);
      for (let x = 0; x < W; x++, o++) {
        const cx = Math.min(cellsX - 1, (x / cellW) | 0);
        pxCell[o] = cy * cellsX + cx;
        pxTx[o] = Math.min(tileW - 1, x - cx * cellW);
        pxTy[o] = ty;
      }
    }
  }

  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    dt = Math.min(0.033, Math.max(0.001, dt));
    update(dt);
    drawScene();
    renderAscii();
    requestAnimationFrame(frame);
  }

  // ----------------------------------------------------------------- ui -----
  const PHOSPHORS = ['#00ff88', '#00ff00', '#ffbf00', '#00ffff', '#ff4fa3'];
  const MODES = ['original', 'phosphor', 'mono'];

  function el(id) { return document.getElementById(id); }
  function chip(parent, label, on, fn) {
    const b = document.createElement('button');
    b.textContent = label; if (on) b.classList.add('on');
    b.onclick = () => { fn(); syncUi(); };
    parent.appendChild(b); return b;
  }
  function syncUi() {
    [...el('sets').children].forEach((b, i) => b.classList.toggle('on', Object.keys(CHARSETS)[i] === cfg.set));
    [...el('modes').children].forEach((b, i) => b.classList.toggle('on', i === cfg.colorMode));
    [...el('phos').children].forEach((b, i) => b.classList.toggle('on', PHOSPHORS[i] === cfg.phosphor));
    const fxMap = { bloom: cfg.bloom, grain: cfg.grain, chromatic: cfg.chromatic, scanlines: cfg.scanlines, vignette: cfg.vignette, crt: cfg.crt };
    [...el('fx').children].forEach((b) => { const k = b.dataset.k; b.classList.toggle('on', !!fxMap[k]); });
    el('invBtn').classList.toggle('on', cfg.invert);
    el('scale').value = cfg.scale; el('spacing').value = cfg.spacing; el('bw').value = cfg.brightnessWeight;
    el('ci').value = cfg.colorIntensity; el('ch').value = cfg.chromaticOffset;
    el('so').value = cfg.scanlineOpacity; el('bl').value = cfg.bloomIntensity;
    el('scaleV').textContent = cfg.scale + ' · ' + (cellW | 0) + 'x' + cellH + ' · ' + cfg.matchQuality;
    el('spacingV').textContent = Number(cfg.spacing).toFixed(2);
    el('bwV').textContent = Number(cfg.brightnessWeight).toFixed(2);
    el('ciV').textContent = Number(cfg.colorIntensity).toFixed(2);
    el('chV').textContent = cfg.chromaticOffset;
    el('soV').textContent = Number(cfg.scanlineOpacity).toFixed(2);
    el('blV').textContent = Number(cfg.bloomIntensity).toFixed(2);
    document.documentElement.style.setProperty('--fg', cfg.colorMode === 0 ? '#00ff88' : cfg.phosphor);
  }

  function buildUi() {
    const sets = el('sets'); sets.textContent = '';
    Object.keys(CHARSETS).forEach((k) => chip(sets, k, false, () => { cfg.set = k; buildAtlas(); buildTiles(); }));
    const modes = el('modes'); modes.textContent = '';
    MODES.forEach((m, i) => chip(modes, m, false, () => { cfg.colorMode = i; }));
    const phos = el('phos'); phos.textContent = '';
    PHOSPHORS.forEach((c) => chip(phos, '●', false, () => { cfg.phosphor = c; }));
    const fx = el('fx'); fx.textContent = '';
    [['bloom', 'BLOOM'], ['grain', 'GRAIN'], ['chromatic', 'CHROMA'], ['scanlines', 'SCAN'], ['vignette', 'VIGN'], ['crt', 'CRT']]
      .forEach(([k, l]) => {
        const b = chip(fx, l, false, () => { cfg[k] = !cfg[k]; if (k === 'scanlines' || k === 'vignette') buildFxTables(); });
        b.dataset.k = k;
      });
    el('invBtn').onclick = () => { cfg.invert = !cfg.invert; syncUi(); };
    el('startBtn').onclick = () => reset(true);
    el('panelBtn').onclick = () => document.getElementById('panel').classList.toggle('hidden');
    const bind = (id, key, after) => {
      el(id).oninput = (e) => {
        cfg[key] = parseFloat(e.target.value);
        if (after) after();
        syncUi();
      };
    };
    bind('scale', 'scale', () => setScale(cfg.scale));
    bind('spacing', 'spacing', buildTiles);
    bind('bw', 'brightnessWeight'); bind('ci', 'colorIntensity');
    bind('ch', 'chromaticOffset');
    bind('so', 'scanlineOpacity', buildFxTables);
    bind('bl', 'bloomIntensity');
  }

  function hotkeys(k) {
    const setKeys = Object.keys(CHARSETS);
    if (/^[0-9]$/.test(k)) { const i = k === '0' ? 9 : +k - 1; if (setKeys[i]) { cfg.set = setKeys[i]; buildAtlas(); buildTiles(); } }
    else if (k === 'c') cfg.colorMode = (cfg.colorMode + 1) % 3;
    else if (k === 'g') cfg.grain = !cfg.grain;
    else if (k === 's') { cfg.scanlines = !cfg.scanlines; buildFxTables(); }
    else if (k === 'b') cfg.bloom = !cfg.bloom;
    else if (k === 'v') cfg.crt = !cfg.crt;
    else if (k === 'x') cfg.chromatic = !cfg.chromatic;
    else if (k === 'i') cfg.invert = !cfg.invert;
    else if (k === 'm') { const q = Object.keys(SAMPLES); setQuality(q[(q.indexOf(cfg.matchQuality) + 1) % q.length]); }
    else if (k === 'h') document.getElementById('panel').classList.toggle('hidden');
    else if (k === '[' || k === ']') {
      setScale(Math.max(1, Math.min(6, cfg.scale + (k === ']' ? 1 : -1))));
    }
    syncUi();
  }

  addEventListener('resize', resize);
  setQuality('fast'); buildUi(); reset(false); resize(); syncUi();
  requestAnimationFrame(frame);
})();
