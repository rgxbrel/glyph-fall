/* Deterministic world from a seed alone. A future server sends the seed and
 * every client rebuilds an identical map, so tiles are never part of the
 * replicated state. */

export const TILE = 32;
export const T = { GRASS: 0, DIRT: 1, ROCK: 2, WATER: 3, TREE: 4, SAND: 5 };
export const SOLID = [false, false, true, true, true, false];

// xorshift32; the same generator the simulation uses for content placement.
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function valueNoise(w, h, rng, freq) {
  const gw = Math.ceil(w / freq) + 2, gh = Math.ceil(h / freq) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = y / freq, iy = Math.floor(fy), ty = smooth(fy - iy);
    for (let x = 0; x < w; x++) {
      const fx = x / freq, ix = Math.floor(fx), tx = smooth(fx - ix);
      const a = g[iy * gw + ix], b = g[iy * gw + ix + 1];
      const c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
      out[y * w + x] = lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
    }
  }
  return out;
}
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

export function generateMap(seed) {
  const w = 110, h = 110;
  const rng = makeRng(seed);
  const elev = valueNoise(w, h, rng, 14);
  const moist = valueNoise(w, h, rng, 9);
  const detail = valueNoise(w, h, rng, 3);
  const tiles = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const e = elev[i] + detail[i] * 0.12;
      const m = moist[i];
      let t = T.GRASS;
      if (e < 0.28) t = T.WATER;
      else if (e < 0.34) t = T.SAND;
      else if (e > 0.74) t = T.ROCK;
      else if (m > 0.66 && e < 0.66) t = T.TREE;
      else if (m < 0.36) t = T.DIRT;
      tiles[i] = t;
    }
  }

  // A ring of rock keeps the world closed without edge special-casing.
  for (let x = 0; x < w; x++) { tiles[x] = T.ROCK; tiles[(h - 1) * w + x] = T.ROCK; }
  for (let y = 0; y < h; y++) { tiles[y * w] = T.ROCK; tiles[y * w + w - 1] = T.ROCK; }

  // Clear a plaza around the spawn so the player never starts inside a tree.
  const spawnTile = findOpenTile(tiles, w, h, Math.floor(w / 2), Math.floor(h / 2));
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const i = (spawnTile.y + dy) * w + spawnTile.x + dx;
      if (tiles[i] === T.TREE || tiles[i] === T.ROCK || tiles[i] === T.WATER) tiles[i] = T.DIRT;
    }

  const props = [];
  const tries = 900;
  for (let k = 0; k < tries; k++) {
    const x = 2 + Math.floor(rng() * (w - 4)), y = 2 + Math.floor(rng() * (h - 4));
    const t = tiles[y * w + x];
    if (t === T.GRASS || t === T.DIRT) {
      const r = rng();
      if (r < 0.10) props.push({ kind: 'enemy', x: x * TILE + 16, y: y * TILE + 16, tier: tierAt(elev[y * w + x]) });
      else if (r < 0.13) props.push({ kind: 'herb', x: x * TILE + 16, y: y * TILE + 16 });
      else if (r < 0.142) props.push({ kind: 'chest', x: x * TILE + 16, y: y * TILE + 16 });
    }
  }

  const npcs = [
    { id: 'elder', name: 'ANCYRA', x: (spawnTile.x - 3) * TILE, y: (spawnTile.y - 1) * TILE, role: 'quest' },
    { id: 'trader', name: 'BODHI', x: (spawnTile.x + 3) * TILE, y: (spawnTile.y - 1) * TILE, role: 'trade' },
  ];

  return {
    seed, w, h, tiles, elev, props, npcs,
    spawn: { x: spawnTile.x * TILE + 16, y: spawnTile.y * TILE + 16 },
    solidAt: (px, py) => {
      const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return true;
      return SOLID[tiles[ty * w + tx]];
    },
  };
}

function findOpenTile(tiles, w, h, cx, cy) {
  for (let r = 0; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
        const t = tiles[y * w + x];
        if (t === T.GRASS || t === T.DIRT) return { x, y };
      }
    }
  }
  return { x: cx, y: cy };
}

function tierAt(e) { return e > 0.6 ? 2 : e > 0.45 ? 1 : 0; }
