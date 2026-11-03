/* Faithful CPU port of Grainrad's ASCII pipeline (3 WGSL passes:
 * characterMatch compute -> ascii fragment -> postprocess fragment).
 * Algorithm, constants and defaults were recovered by REA from the shipped
 * bundle; see /data/workspace/rea/grainrad/. */

import { CHARSETS, BASE_FONT, SAMPLES_PER_AXIS } from './config.js';

export class AsciiPass {
  constructor(canvas) {
    this.out = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.sceneC = document.createElement('canvas');
    this.sceneX = this.sceneC.getContext('2d', { willReadFrequently: true });
    this.bloomC = document.createElement('canvas');
    this.bloomX = this.bloomC.getContext('2d', { willReadFrequently: true });

    this.cfg = {
      set: 'standard', scale: 2, spacing: 0, matchQuality: 'fast',
      brightnessWeight: 1, brightnessMapping: 1,
      colorMode: 0, colorIntensity: 1, phosphor: '#00ff00', invert: false,
      brightness: 0, contrast: 0, saturation: 0, hue: 0, gamma: 1,
      bloom: false, bloomIntensity: 1.5,
      grain: true, grainIntensity: 4, grainSize: 2, grainSpeed: 50,
      chromatic: false, chromaticOffset: 2,
      scanlines: false, scanlineOpacity: 0.1, scanlineSpacing: 4,
      vignette: false, vignetteIntensity: 0.5, vignetteRadius: 0.5,
      crt: false, crtAmount: 0.1,
      bg: 0xff000000,
    };
    this.time = 0;
    this.frameTag = 0;
    this._pc = [0, 0, 0];
    this.setQuality('fast');
  }

  get sceneCtx() { return this.sceneX; }
  get sceneW() { return this.W; }
  get sceneH() { return this.H; }

  setQuality(q) {
    this.cfg.matchQuality = q;
    this.sigSide = SAMPLES_PER_AXIS[q];
    this.SIG_N = this.sigSide * this.sigSide;
    this.sigCache = new Float32Array(this.SIG_N);
    this.buildAtlas();
  }

  setScale(s) {
    this.cfg.scale = s;
    this.cellW = s * BASE_FONT * 0.6;
    this.cellH = s * BASE_FONT;
    this.buildAtlas();
    this.buildTiles();
    this.resize();
  }

  // Atlas layout is fixed in the app: 16 columns, glyph cell ceil(l*0.6) x l,
  // bold monospace, baseline top, no padding.
  buildAtlas() {
    const cfg = this.cfg;
    this.chars = CHARSETS[cfg.set];
    this.N = this.chars.length;
    const l = Math.max(32, Math.ceil(32 * Math.max(1, Math.ceil(cfg.scale / 4) / 4)));
    this.acw = Math.ceil(l * 0.6); this.ach = l;
    const cols = 16, rows = Math.ceil(this.N / cols);
    this.aW = cols * this.acw; this.aH = rows * this.ach;
    const a = document.createElement('canvas');
    a.width = this.aW; a.height = this.aH;
    const ax = a.getContext('2d', { willReadFrequently: true });
    ax.fillStyle = '#000'; ax.fillRect(0, 0, this.aW, this.aH);
    ax.fillStyle = '#fff';
    ax.font = `bold ${l}px "JetBrains Mono", "SF Mono", "Fira Code", "DejaVu Sans Mono", monospace`;
    ax.textBaseline = 'top'; ax.textRendering = 'geometricPrecision';
    for (let i = 0; i < this.N; i++)
      ax.fillText(this.chars[i], (i % cols) * this.acw, Math.floor(i / cols) * this.ach);
    this.atlas = ax.getImageData(0, 0, this.aW, this.aH).data;

    // Per-character signature: coverage at each sample position of the glyph
    // cell, which is what the compute shader compares against the source.
    const ss = this.sigSide;
    this.sigs = new Float32Array(this.N * this.SIG_N);
    for (let ci = 0; ci < this.N; ci++) {
      const ox = (ci % cols) * this.acw, oy = Math.floor(ci / cols) * this.ach;
      for (let sy = 0; sy < ss; sy++) {
        const by = Math.floor(sy * this.ach / ss), ey = Math.min(this.ach, Math.floor((sy + 1) * this.ach / ss));
        for (let sx = 0; sx < ss; sx++) {
          const bx = Math.floor(sx * this.acw / ss), ex = Math.min(this.acw, Math.floor((sx + 1) * this.acw / ss));
          let sum = 0, cnt = 0;
          for (let y = by; y < ey; y++)
            for (let x = bx; x < ex; x++) { sum += this.atlas[(oy + y) * this.aW + (ox + x)]; cnt++; }
          this.sigs[ci * this.SIG_N + sy * ss + sx] = cnt ? sum / (cnt * 255) : 0;
        }
      }
    }
  }

  // Every glyph pre-rasterised at cell resolution as a coverage mask; the
  // composite multiplies it by the cell colour, like mix(bg, color, intensity).
  buildTiles() {
    if (!this.atlas) return;
    const cfg = this.cfg;
    this.tileW = Math.ceil(this.cellW); this.tileH = Math.ceil(this.cellH);
    const cols = 16, tw = this.tileW, th = this.tileH;
    this.tiles = new Uint8Array(this.N * tw * th);
    const gap = cfg.spacing * 0.5, half = gap * 0.5, area = 1 - gap, inv = 1 / area;
    for (let ci = 0; ci < this.N; ci++) {
      const aox = (ci % cols) * this.acw, aoy = Math.floor(ci / cols) * this.ach;
      for (let py = 0; py < th; py++) {
        const v = (py + 0.5) / th;
        const inGapY = v < half || v > 1 - half;
        const ry = inGapY ? 0 : Math.min(1, Math.max(0, (v - half) * inv));
        const ayp = Math.min(this.ach - 1, Math.floor(ry * this.ach));
        for (let px = 0; px < tw; px++) {
          const u = (px + 0.5) / tw;
          let mask = 0;
          if (!inGapY && !(u < half || u > 1 - half)) {
            const rx = Math.min(1, Math.max(0, (u - half) * inv));
            const axp = Math.min(this.acw - 1, Math.floor(rx * this.acw));
            mask = this.atlas[(aoy + ayp) * this.aW + (aox + axp)];
          }
          this.tiles[ci * tw * th + py * tw + px] = mask;
        }
      }
    }
  }

  // The host may supply the available box; otherwise the canvas keeps its size.
  measure() {
    const stage = document.getElementById('stage');
    if (!stage) return { w: this.out.width || 900, h: this.out.height || 640 };
    return { w: stage.clientWidth || this.out.width || 900, h: stage.clientHeight || this.out.height || 640 };
  }

  resize(availW, availH) {
    const m = this.measure();
    if (!availW) availW = m.w;
    if (!availH) availH = m.h;
    this.cellW = this.cfg.scale * BASE_FONT * 0.6;
    this.cellH = this.cfg.scale * BASE_FONT;
    this.cellsX = Math.max(24, Math.floor((availW * 0.98) / this.cellW));
    this.cellsY = Math.max(16, Math.floor((availH * 0.98) / this.cellH));
    this.W = Math.floor(this.cellsX * this.cellW);
    this.H = this.cellsY * this.cellH;
    this.out.width = this.W; this.out.height = this.H;
    this.sceneC.width = this.W; this.sceneC.height = this.H;
    this.bloomC.width = this.W; this.bloomC.height = this.H;
    this.outImg = this.ctx.createImageData(this.W, this.H);
    this.out32 = new Uint32Array(this.outImg.data.buffer);
    const n = this.cellsX * this.cellsY;
    this.cellChar = new Uint16Array(n);
    this.cellR = new Uint8Array(n); this.cellG = new Uint8Array(n); this.cellB = new Uint8Array(n);
    this.cellDone = new Int32Array(n).fill(-1);
    this.buildTiles();
    this.buildFxTables();
    this.buildCellMap();
    const fit = Math.min(availW / this.W, availH / this.H, 1);
    this.out.style.width = `${Math.floor(this.W * fit)}px`;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // Cell index and glyph texel offset per output pixel: the shader divides by a
  // fractional cellSize (9.6 x 16 at scale 2), so this is done once per resize.
  buildCellMap() {
    const { W, H, cellW, cellH, cellsX, cellsY, tileW, tileH } = this;
    this.pxCell = new Int32Array(W * H);
    this.pxTx = new Uint8Array(W * H);
    this.pxTy = new Uint8Array(W * H);
    let o = 0;
    for (let y = 0; y < H; y++) {
      const cy = Math.min(cellsY - 1, (y / cellH) | 0);
      const ty = Math.min(tileH - 1, y - cy * cellH);
      for (let x = 0; x < W; x++, o++) {
        const cx = Math.min(cellsX - 1, (x / cellW) | 0);
        this.pxCell[o] = cy * cellsX + cx;
        // Map fractional shader coordinates onto the integer glyph tile.
        // Raw truncation at 9.6px cell boundaries creates a repeated texture.
        this.pxTx[o] = Math.min(tileW - 1, Math.floor((x - cx * cellW) * tileW / cellW));
        this.pxTy[o] = Math.min(tileH - 1, Math.floor(ty * tileH / cellH));
      }
    }
  }

  buildFxTables() {
    const cfg = this.cfg, W = this.W, H = this.H;
    this.vigX = new Float32Array(W);
    this.vigY = new Float32Array(H);
    this.scanTable = new Float32Array(H);
    const sp = Math.max(1, cfg.scanlineSpacing);
    for (let x = 0; x < W; x++) this.vigX[x] = cfg.vignette ? Math.abs((x + 0.5) / W * 2 - 1) : 0;
    for (let y = 0; y < H; y++) {
      this.vigY[y] = cfg.vignette ? Math.abs((y + 0.5) / H * 2 - 1) : 0;
      const on = cfg.scanlines && cfg.scanlineOpacity > 0 && (y % (sp * 2)) < sp;
      this.scanTable[y] = on ? 1 - cfg.scanlineOpacity : 1;
    }
  }

  // The compute shader's source-brightness chain, in operation order.
  sourceBrightness(r, g, b) {
    const cfg = this.cfg;
    let v = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    v = Math.pow(v, 1 / cfg.gamma);
    v += cfg.brightness * 0.005;
    v = (v - 0.5) * ((cfg.contrast + 100) * 0.01) + 0.5;
    v = Math.pow(Math.min(1, Math.max(0, v)), cfg.brightnessMapping);
    if (cfg.invert) v = 1 - v;
    return Math.min(1, Math.max(0, v));
  }

  processColor(r, g, b, o) {
    const cfg = this.cfg;
    let rr = r / 255, gg = g / 255, bb = b / 255;
    if (cfg.gamma !== 1) {
      const ig = 1 / cfg.gamma;
      rr = Math.pow(rr, ig); gg = Math.pow(gg, ig); bb = Math.pow(bb, ig);
    }
    if (cfg.brightness) { const k = cfg.brightness * 0.005; rr += k; gg += k; bb += k; }
    if (cfg.contrast) {
      const k = (cfg.contrast + 100) * 0.01;
      rr = (rr - 0.5) * k + 0.5; gg = (gg - 0.5) * k + 0.5; bb = (bb - 0.5) * k + 0.5;
    }
    if (cfg.saturation) {
      const s = 1 + cfg.saturation * 0.01;
      const l = rr * 0.299 + gg * 0.587 + bb * 0.114;
      rr = l + (rr - l) * s; gg = l + (gg - l) * s; bb = l + (bb - l) * s;
    }
    o[0] = Math.min(255, Math.max(0, rr)) * 255;
    o[1] = Math.min(255, Math.max(0, gg)) * 255;
    o[2] = Math.min(255, Math.max(0, bb)) * 255;
    return o;
  }

  // characterMatch: >=0.99 brightness weight is the shader's fast path, a pure
  // index ramp by truncation; otherwise nearest glyph by weighted index + MSE.
  pickChar(samples, b) {
    const cfg = this.cfg, N = this.N;
    if (cfg.brightnessWeight >= 0.99) return Math.min(N - 1, (Math.min(b, 0.9999) * N) | 0);
    const expected = b * (N - 1);
    const w = cfg.brightnessWeight, sw = 1 - w;
    let best = 0, bestScore = Infinity;
    for (let ci = 0; ci < N; ci++) {
      const indexDist = Math.abs(ci - expected) / N;
      let spatial = 0;
      const base = ci * this.SIG_N;
      for (let k = 0; k < this.SIG_N; k++) {
        const diff = samples[k] - this.sigs[base + k];
        spatial += diff * diff;
      }
      const score = indexDist * w + (spatial / this.SIG_N) * sw;
      if (score < bestScore) { bestScore = score; best = ci; }
    }
    return best;
  }

  resolveCell(cx, cy) {
    const cfg = this.cfg, i = cy * this.cellsX + cx, sd = this.sceneImg.data;
    if (this.cellDone[i] === this.frameTag) return i;
    this.cellDone[i] = this.frameTag;
    // Grainrad's match compute pass averages a sample grid over every cell,
    // rather than using a single centre texel. Keep the same samples for both
    // the fast brightness ramp and the spatial glyph matcher.
    const ss = this.sigSide, stx = this.cellW / ss, sty = this.cellH / ss;
    let mapped = 0;
    for (let sy = 0; sy < ss; sy++) {
      const py = Math.min(this.H - 1, Math.floor(cy * this.cellH + sy * sty + sty * 0.5));
      const row = py * this.W;
      for (let sx = 0; sx < ss; sx++) {
        const px = Math.min(this.W - 1, Math.floor(cx * this.cellW + sx * stx + stx * 0.5));
        const i4 = (row + px) * 4;
        const sample = this.sourceBrightness(sd[i4], sd[i4 + 1], sd[i4 + 2]);
        this.sigCache[sy * ss + sx] = sample;
        mapped += sample;
      }
    }
    mapped /= this.SIG_N;
    this.cellChar[i] = this.pickChar(this.sigCache, mapped);
    const midX = Math.min(this.W - 1, Math.floor((cx + 0.5) * this.cellW));
    const midY = Math.min(this.H - 1, Math.floor((cy + 0.5) * this.cellH));
    const m4 = (midY * this.W + midX) * 4;
    const r = sd[m4], g = sd[m4 + 1], b = sd[m4 + 2];
    let cr, cg, cb;
    if (cfg.colorMode === 1) {
      const ph = hex2rgb(cfg.phosphor);
      cr = ph[0] * mapped; cg = ph[1] * mapped; cb = ph[2] * mapped;
    } else if (cfg.colorMode === 2) {
      cr = cg = cb = mapped * 255;
    } else {
      const pp = this.processColor(r, g, b, this._pc);
      cr = pp[0]; cg = pp[1]; cb = pp[2];
    }
    this.cellR[i] = Math.min(255, cr * cfg.colorIntensity) | 0;
    this.cellG[i] = Math.min(255, cg * cfg.colorIntensity) | 0;
    this.cellB[i] = Math.min(255, cb * cfg.colorIntensity) | 0;
    return i;
  }

  render(time) {
    const cfg = this.cfg;
    this.time = time;
    this.sceneImg = this.sceneX.getImageData(0, 0, this.W, this.H);
    this.frameTag++;
    for (let cy = 0; cy < this.cellsY; cy++)
      for (let cx = 0; cx < this.cellsX; cx++) this.resolveCell(cx, cy);

    const tw = this.tileW, th = this.tileH, tsize = tw * th;
    const tileMask = this.tiles, cellChar = this.cellChar;
    const cellR = this.cellR, cellG = this.cellG, cellB = this.cellB;
    const pxCell = this.pxCell, pxTx = this.pxTx, pxTy = this.pxTy;
    const out32 = this.out32, W = this.W, H = this.H;
    const invW = 1 / W, invH = 1 / H, invCW = 1 / this.cellW, invCH = 1 / this.cellH;
    const crtOn = cfg.crt, crtAmt = cfg.crtAmount * 55;
    const chroma = cfg.chromatic ? Math.round(cfg.chromaticOffset) : 0;
    const grainOn = cfg.grain, gs = Math.max(1, cfg.grainSize), gSeed = (time * cfg.grainSpeed) | 0;
    const gAmp = cfg.grainIntensity * 2.55;
    const vOn = cfg.vignette, vr = cfg.vignetteRadius, vInt = cfg.vignetteIntensity;
    const vDenom = Math.max(0.001, 1 - vr);
    const bg = cfg.bg;
    const scanTable = this.scanTable, vigX = this.vigX, vigY = this.vigY;

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
          const cx = Math.min(this.cellsX - 1, (sxp * invCW) | 0);
          const cy = Math.min(this.cellsY - 1, (syp * invCH) | 0);
          ci = this.resolveCell(cx, cy);
          tx = Math.min(tw - 1, (sxp - cx * this.cellW) | 0);
          ty = Math.min(th - 1, (syp - cy * this.cellH) | 0);
        } else {
          ci = pxCell[o]; tx = pxTx[o]; ty = pxTy[o];
        }
        const mask = tileMask[cellChar[ci] * tsize + ty * tw + tx] * 0.00392156862745098;
        let R = cellR[ci] * mask, G = cellG[ci] * mask, B = cellB[ci] * mask;
        if (chroma) {
          const cx0 = (x * invCW) | 0, cy = (y * invCH) | 0;
          const xa = x - chroma, xb = x + chroma;
          if (xa >= 0) { const ca = (xa * invCW) | 0; if (ca !== cx0) R = cellR[this.resolveCell(Math.min(this.cellsX - 1, ca), cy)] * mask; }
          if (xb < W) { const cb2 = (xb * invCW) | 0; if (cb2 !== cx0) B = cellB[this.resolveCell(Math.min(this.cellsX - 1, cb2), cy)] * mask; }
        }
        let k = rowK;
        if (vOn) {
          const d = Math.sqrt(vigX[x] * vigX[x] + vy2);
          k *= 1 - Math.max(0, Math.min(1, (d - vr) / vDenom)) * vInt;
        }
        R *= k; G *= k; B *= k;
        if (grainOn) {
          const nx = (x / gs | 0) + 1, ny = (y / gs | 0) + 1;
          let h = Math.imul(nx, 374761393) ^ Math.imul(ny, 668265263) ^ Math.imul(gSeed + 1, 1442695041);
          h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
          const n = (h / 4294967296 - 0.5) * gAmp;
          R += n; G += n; B += n;
        }
        out32[o] = (255 << 24) |
          ((B > 255 ? 255 : B < 0 ? 0 : B | 0) << 16) |
          ((G > 255 ? 255 : G < 0 ? 0 : G | 0) << 8) |
          (R > 255 ? 255 : R < 0 ? 0 : R | 0);
      }
    }
    this.ctx.putImageData(this.outImg, 0, 0);
    if (cfg.bloom && cfg.bloomIntensity > 0) this.bloomPass();
  }

  // bloomThreshold + bloomBlur(H) + bloomBlur(V) are separate passes in the
  // GPU pipeline; here the threshold is explicit and the blur uses canvas filters.
  bloomPass() {
    const d = this.outImg.data, W = this.W, H = this.H;
    if (!this.brightImg || this.brightImg.width !== W) this.brightImg = this.bloomX.createImageData(W, H);
    const bd = this.brightImg.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
      const k = l > 0.6 ? (l - 0.6) / 0.4 : 0;
      bd[i] = d[i] * k; bd[i + 1] = d[i + 1] * k; bd[i + 2] = d[i + 2] * k; bd[i + 3] = 255;
    }
    this.bloomX.putImageData(this.brightImg, 0, 0);
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'lighter';
    this.ctx.globalAlpha = Math.min(1, this.cfg.bloomIntensity);
    this.ctx.filter = 'blur(4px)';
    this.ctx.drawImage(this.bloomC, 0, 0);
    this.ctx.filter = 'blur(10px)';
    this.ctx.globalAlpha = Math.min(1, this.cfg.bloomIntensity * 0.7);
    this.ctx.drawImage(this.bloomC, 0, 0);
    this.ctx.restore();
  }
}

export const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
