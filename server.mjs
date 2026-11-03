/* Authoritative host for GLYPH FALL. It runs the same DOM-free sim the client
 * uses (src/sim.js), one world for everyone, and broadcasts snapshots. The
 * browser client only predicts its own avatar and interpolates everything else. */

import { createServer } from 'node:http';
import { readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { generateMap } from './src/world.js';
import { createState, spawnWorld, placeAtSpawn, spawnPoint, applyCommand, stepSim, TICK } from './src/sim.js';
import { ITEMS } from './src/data.js';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 8780);
const SEED = (Number(process.env.SEED) || 20261103) >>> 0;
const SNAP_HZ = 15;

const map = generateMap(SEED);
const state = createState(SEED, []);
state.serverName = 'GLYPH FALL';
state.npcList = map.npcs;
spawnWorld(state, map);

const clients = new Map(); // ws -> { pid, name, alive, lastMove }
let pendingCmds = [];

/* Progress belongs to the host, not the browser: a client-side save is gone the
 * moment the phone changes. Keyed by name, because ids are per session. */
const SAVE_FILE = join(ROOT, 'saves.json');
const saves = (() => {
  try {
    const raw = JSON.parse(readFileSync(SAVE_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
})();

function saveOf(p) {
  return {
    level: p.level, xp: p.xp, xpNext: p.xpNext, marks: p.marks, kills: p.kills,
    hp: p.hp, hpMax: p.hpMax, mp: p.mp, mpMax: p.mpMax,
    stats: p.stats, inv: p.inv, equip: p.equip, x: p.x, y: p.y,
    savedAt: Date.now(),
  };
}

let saveDirty = false;
function markSaved(p) {
  if (!p) return;
  saves[p.name] = saveOf(p);
  saveDirty = true;
}

async function flushSaves() {
  if (!saveDirty) return;
  saveDirty = false;
  // Unique tmp name: two flushes in flight would otherwise race on one rename.
  const tmp = `${SAVE_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(saves));
    await rename(tmp, SAVE_FILE);
  } catch (e) {
    saveDirty = true;
    console.error('save flush failed:', e.message);
    try { await rm(tmp, { force: true }); } catch { /* already gone */ }
  }
}
/* A crash must not cost more than half a minute of progress, so the living are
 * written too, not only the ones who log off. */
setInterval(() => {
  for (const c of clients.values()) markSaved(state.players[c.pid]);
  flushSaves();
}, 30000);
process.on('SIGTERM', () => { flushSaves().finally(() => process.exit(0)); });

function cleanSave(prev) {
  if (!prev || typeof prev !== 'object') return null;
  const clean = { ...prev };
  if (prev.stats && typeof prev.stats === 'object') {
    clean.stats = {};
    for (const k of ['str', 'dex', 'int']) {
      const n = Number(prev.stats[k]);
      clean.stats[k] = Number.isFinite(n) ? Math.max(1, Math.min(999, Math.floor(n))) : 5;
    }
  }
  if (Array.isArray(prev.inv)) {
    clean.inv = prev.inv
      .filter((slot) => slot && typeof slot === 'object' && ITEMS[slot.id])
      .slice(0, 24)
      .map((slot) => ({ id: slot.id, qty: Math.max(1, Math.min(99, Math.floor(Number(slot.qty) || 1))) }));
  }
  if (prev.equip && typeof prev.equip === 'object') {
    clean.equip = {
      weapon: ITEMS[prev.equip.weapon]?.kind === 'weapon' ? prev.equip.weapon : null,
      armor: ITEMS[prev.equip.armor]?.kind === 'armor' ? prev.equip.armor : null,
    };
  }
  return clean;
}

function joinPlayer(ws, name) {
  if (clients.has(ws)) return null;
  const requested = typeof name === 'string' ? name : 'WANDERER';
  const normalized = requested.toUpperCase().slice(0, 12) || 'WANDERER';
  if ([...clients.values()].some((c) => c.name === normalized)) {
    ws.send(JSON.stringify({ ty: 'error', error: 'name in use' }));
    ws.close(1008, 'name in use');
    return null;
  }
  const id = String(state.nextNetId++);
  state.players[id] = {
    id, name: normalized,
    x: map.spawn.x, y: map.spawn.y, vx: 0, vy: 0, r: 12, face: 0, anim: 0,
    hp: 60, hpMax: 60, mp: 30, mpMax: 30,
    level: 1, xp: 0, xpNext: 20, marks: 0,
    stats: { str: 5, dex: 5, int: 5 },
    inv: [{ id: 'herb', qty: 2 }], equip: { weapon: null, armor: null },
    cds: { attack: 0, cast: 0 }, iframes: 0, dead: false, respawn: 0, kills: 0,
    inx: 0, iny: 0,
  };
  clients.set(ws, { pid: id, name: state.players[id].name });
  const p = state.players[id];
  const prev = cleanSave(saves[p.name]);
  if (prev && Number.isFinite(prev.level)) {
    for (const k of ['level', 'xp', 'xpNext', 'marks', 'kills', 'hpMax', 'mpMax']) {
      if (Number.isFinite(prev[k])) p[k] = prev[k];
    }
    p.hp = Number.isFinite(prev.hp) ? Math.min(prev.hp, p.hpMax) : p.hpMax;
    p.mp = Number.isFinite(prev.mp) ? Math.min(prev.mp, p.mpMax) : p.mpMax;
    if (prev.stats) p.stats = { str: 5, dex: 5, int: 5, ...prev.stats };
    if (Array.isArray(prev.inv)) p.inv = prev.inv.slice(0, 24);
    if (prev.equip) p.equip = { weapon: null, armor: null, ...prev.equip };
    const x = Number(prev.x), y = Number(prev.y);
    if (Number.isFinite(x) && Number.isFinite(y) && !map.solidAt(x, y)) { p.x = x; p.y = y; }
    else spawnPoint(state, map, p);
    state.log.push({ tick: state.tick, text: `${p.name} RETURNED LV${p.level}` });
  } else {
    spawnPoint(state, map, p);
    state.log.push({ tick: state.tick, text: `${p.name} ARRIVED` });
  }
  return id;
}

function leavePlayer(ws) {
  const c = clients.get(ws);
  if (!c) return;
  const p = state.players[c.pid];
  if (p) {
    markSaved(p);
    flushSaves();
    state.log.push({ tick: state.tick, text: `${p.name} DEPARTED` });
  }
  delete state.players[c.pid];
  clients.delete(ws);
}

/* ------------------------------------------------------------------ http -- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
};

const httpSrv = createServer(async (req, res) => {
  if (req.url.startsWith('/health')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true, tick: state.tick, time: +state.time.toFixed(1),
      players: Object.values(state.players).map((p) => [p.name, Math.round(p.x), Math.round(p.y), p.inx, p.iny, p.hp]),
      chats: chats,
    }));
  }
  const rawPath = req.url.split('?')[0];
  if (rawPath === '/saves.json' || rawPath === '/.work/TURN.md' || rawPath.startsWith('/.')) { res.writeHead(404).end('not found'); return; }
  const rel = normalize(decodeURIComponent(req.url.split('?')[0]) || '/').replace(/^[/\\]+/, '');
  const requested = rel === '' ? 'index.html' : rel;
  if (requested.startsWith('.') || requested.includes('/.') ||
      requested === 'saves.json' || requested.startsWith('.work/')) {
    res.writeHead(404).end('not found'); return;
  }
  const file = join(ROOT, requested);
  if (!file.startsWith(ROOT + '/') && file !== ROOT) { res.writeHead(403).end(); return; }
  try {
    const info = await stat(file);
    if (info.isDirectory()) throw new Error('dir');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

/* ------------------------------------------------------------------ socket -- */

const wss = new WebSocketServer({ server: httpSrv, path: '/ws' });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (buf) => {
    let m;
    try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.ty === 'join') {
      const pid = joinPlayer(ws, m.name);
      if (!pid) return;
      ws.send(JSON.stringify({
        ty: 'hello', id: pid, seed: SEED, tick: state.tick,
        name: state.players[pid].name, online: clients.size,
        chat: chats.slice(-20),
      }));
      return;
    }
    const c = clients.get(ws);
    if (!c) return;
    if (m.ty === 'cmd') {
      if (!m.cmd || typeof m.cmd !== 'object' || Array.isArray(m.cmd)) return;
      if (m.cmd.t === 'dialogue' &&
          (!m.cmd.payload || typeof m.cmd.payload !== 'object' ||
           Array.isArray(m.cmd.payload) || typeof m.cmd.payload.who !== 'string' ||
           m.cmd.payload.who.length > 24 || typeof m.cmd.payload.name !== 'string' ||
           m.cmd.payload.name.length > 48)) return;
      pendingCmds.push([c.pid, m.cmd]);
    }
    else if (m.ty === 'chat') {
      const text = String(m.text || '').slice(0, 120);
      if (text.trim()) pushChat(c.name, text);
    } else if (m.ty === 'leave') leavePlayer(ws);
  });
  ws.on('close', () => leavePlayer(ws));
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 20000);

/* ----------------------------------------------------------------- ticking -- */

let chatSeq = 0;
const chats = [];
function pushChat(name, text) {
  chats.push({ seq: ++chatSeq, name, text, tick: state.tick });
  if (chats.length > 200) chats.shift();
}

function worldSnapshot() {
  const ent = (o, keys) => {
    const out = {};
    for (const id of Object.keys(o)) {
      const e = o[id]; const row = [];
      for (const k of keys) row.push(e[k]);
      out[id] = row;
    }
    return out;
  };
  return {
    tick: state.tick, time: state.time,
    players: ent(state.players, ['x', 'y', 'face', 'hp', 'hpMax', 'mp', 'mpMax', 'level', 'name', 'dead', 'kills', 'marks']),
    enemies: ent(state.enemies, ['x', 'y', 'hp', 'alive', 'kind']),
    pickups: ent(state.pickups, ['x', 'y', 'taken', 'kind']),
    projectiles: ent(state.projectiles, ['x', 'y', 'owner', 'skill']),
    quest: state.quest,
    me: clientsEnts(),
    log: state.log.slice(-8),
    online: clients.size,
  };
}

// Each socket needs its own full player object (inventory, stats) in the snapshot.
function clientsEnts() {
  const rows = [];
  for (const [ws, c] of clients) {
    const p = state.players[c.pid];
    if (!p || ws.readyState !== 1) continue;
    rows.push([c.pid, {
      id: p.id, name: p.name, x: p.x, y: p.y, respawn: p.respawn,
      hp: p.hp, hpMax: p.hpMax, mp: p.mp, mpMax: p.mpMax,
      level: p.level, xp: p.xp, xpNext: p.xpNext, marks: p.marks, kills: p.kills,
      stats: p.stats, inv: p.inv, equip: p.equip, dead: p.dead, face: p.face,
    }]);
  }
  return rows;
}

/* A bad command or a NaN in the sim must not take the world down: the tick is
 * the only thing that can throw on user input, so it is caught and reported. */
let acc = 0;
setInterval(() => {
  acc += 1 / 6;
  while (acc >= TICK) {
    acc -= TICK;
    const commands = pendingCmds;
    pendingCmds = [];
    for (const [pid, cmd] of commands) {
      try {
        applyCommand(state, state.tick, pid, cmd, map);
      } catch (e) {
        console.error(`command ${state.tick}/${pid} failed: ${e.stack || e}`);
      }
    }
    try {
      stepSim(state, map, TICK);
    } catch (e) {
      console.error(`tick ${state.tick} failed: ${e.stack || e}`);
    }
  }
}, 1000 / 6);

setInterval(() => {
  if (!wss.clients.size) return;
  try {
    const snap = worldSnapshot();
    const bySocket = new Map();
    for (const [ws, c] of clients) bySocket.set(ws, snap.me.find(([id]) => id === c.pid)?.[1] || null);
    const { me, ...shared } = snap;
    const text = JSON.stringify(shared);
    for (const ws of wss.clients) {
      if (ws.readyState !== 1) continue;
      const c = clients.get(ws);
      ws.send(JSON.stringify({ ty: 'snap', ...JSON.parse(text), me: bySocket.get(ws) || null, chat: chats.slice(-30) }));
    }
  } catch (e) {
    console.error('snapshot failed:', e.message);
  }
}, 1000 / SNAP_HZ);

process.on('uncaughtException', (e) => console.error('uncaught:', e.stack || e));
process.on('unhandledRejection', (e) => console.error('rejection:', e && e.stack ? e.stack : e));

httpSrv.listen(PORT, '0.0.0.0', () => {
  console.log(`GLYPH FALL host on :${PORT} (seed ${SEED}, ${SNAP_HZ} Hz snapshots)`);
});
