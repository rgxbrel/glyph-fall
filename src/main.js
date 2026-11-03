/* Wiring: fixed-timestep simulation, command queue in, ASCII pass out.
 * Input becomes commands, so a networked client can feed the same queue. */

import { AsciiPass } from './ascii.js';
import { generateMap, TILE } from './world.js';
import { createState, placeAtSpawn, spawnWorld, stepSim, applyCommand, acceptQuest, turnInQuest, serialize, deserialize, TICK } from './sim.js';
import { drawScene } from './render.js';
import { CHARSETS } from './config.js';
import { ITEMS, DIALOGUES } from './data.js';

const SAVE_KEY = 'glyph-rpg-save';
const seed = (Number(new URLSearchParams(location.search).get('seed')) || 20261103) >>> 0;

const map = generateMap(seed);
let state;
const saved = localStorage.getItem(SAVE_KEY);
if (saved) {
  try { state = deserialize(saved); } catch { state = null; }
}
if (!state || state.seed !== seed) {
  state = createState(seed, ['HERALD']);
  placeAtSpawn(state, map);
  spawnWorld(state, map);
  state.npcList = map.npcs;
}
state.npcList = map.npcs;

const out = document.getElementById('out');
const pass = new AsciiPass(out);
const ui = { inventoryOpen: false, dialogueLines: (st) => {
  const d = DIALOGUES[st.dialogue.who];
  if (!d) return [];
  const lines = [];
  lines.push(`> ${d[0].q}   ${d[0].a}`);
  lines.push(`> ${d[1].q}   ${d[1].a}`);
  if (st.dialogue.who === 'elder') lines.push(st.quest.active ? '[q] report  ' + st.quest.kills + '/5' : '[q] accept quest');
  return lines;
} };

pass.setScale(2);
fit();
addEventListener('resize', fit);
function fit() {
  const stage = document.getElementById('stage');
  pass.resize(stage.clientWidth, stage.clientHeight);
}

/* ------------------------------------------------------------------ input -- */

const keys = new Set();
const pending = [];
const localId = () => state.local;

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k.startsWith('arrow') || k === ' ') e.preventDefault();
  keys.add(k);

  // Digits pick a charset, unless the inventory is open, when they use a slot.
  if (/^[0-9]$/.test(k)) {
    const slot = k === '0' ? 9 : Number(k) - 1;
    const p = state.players[localId()];
    if (ui.inventoryOpen && p.inv[slot] && ITEMS[p.inv[slot].id].kind === 'consumable') pending.push({ t: 'use', slot });
    else if (!ui.inventoryOpen) setCharset(slot);
    return;
  }

  switch (k) {
    case 'j': case 'z': pending.push({ t: 'attack' }); break;
    case 'l': pending.push({ t: 'cast', skill: 'spark' }); break;
    case 'e': pending.push({ t: 'interact' }); break;
    case 'u': pending.push({ t: 'equip', slot: firstEquipSlot(state.players[localId()]) }); break;
    case 'i': ui.inventoryOpen = !ui.inventoryOpen; break;
    case 'p': save(); break;
    case 'c': pass.cfg.colorMode = (pass.cfg.colorMode + 1) % 3; break;
    case 'b': pass.cfg.bloom = !pass.cfg.bloom; break;
    case 'g': pass.cfg.grain = !pass.cfg.grain; break;
    case 'n': pass.cfg.scanlines = !pass.cfg.scanlines; pass.buildFxTables(); break;
    case 'v': pass.cfg.vignette = !pass.cfg.vignette; pass.buildFxTables(); break;
    case 'r': pass.cfg.crt = !pass.cfg.crt; break;
    case 'm': {
      const q = ['fast', 'balanced', 'quality'];
      pass.setQuality(q[(q.indexOf(pass.cfg.matchQuality) + 1) % 3]);
      pass.buildTiles();
      break;
    }
    case 't': {
      const ks = Object.keys(CHARSETS);
      pass.cfg.set = ks[(ks.indexOf(pass.cfg.set) + 1) % ks.length];
      pass.setQuality(pass.cfg.matchQuality); pass.buildTiles(); pass.buildCellMap();
      break;
    }
    case '[': case ']': pass.setScale(Math.max(1, Math.min(6, pass.cfg.scale + (k === ']' ? 1 : -1)))); break;
    case 'h': document.getElementById('panel').classList.toggle('hidden'); break;
    case 'q': {
      const p = state.players[localId()];
      const elder = map.npcs.find((n) => n.role === 'quest');
      if (elder && Math.hypot(elder.x - p.x, elder.y - p.y) < 46) {
        if (!state.quest.active) acceptQuest(state);
        else turnInQuest(state, p);
      }
      break;
    }
    default: break;
  }
  syncUi();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function firstEquipSlot(p) {
  return p.inv.findIndex((s) => ['weapon', 'armor'].includes(ITEMS[s.id].kind));
}

function setCharset(i) {
  const k = Object.keys(CHARSETS)[i];
  if (!k) return;
  pass.cfg.set = k;
  pass.setQuality(pass.cfg.matchQuality);
  pass.buildTiles();
  pass.buildCellMap();
  syncUi();
}

function save() {
  localStorage.setItem(SAVE_KEY, serialize(state));
  flash('SAVED');
}
function flash(text) { state.log.push({ tick: state.tick, text }); }

/* -------------------------------------------------------------------- loop -- */

let acc = 0, last = performance.now(), fps = 60, fpsAcc = 0, fpsN = 0;
const cam = { x: 0, y: 0 };

function frame(now) {
  let dt = (now - last) / 1000; last = now;
  dt = Math.min(0.1, Math.max(0.001, dt));
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

  const p = state.players[localId()];
  let dx = 0, dy = 0;
  if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
  if (keys.has('arrowright') || keys.has('d')) dx += 1;
  if (keys.has('arrowup') || keys.has('w')) dy -= 1;
  if (keys.has('arrowdown') || keys.has('s')) dy += 1;
  applyCommand(state, state.tick, localId(), { t: 'move', dx, dy });

  acc += dt;
  let guard = 0;
  while (acc >= TICK && guard++ < 5) {
    for (const cmd of pending) applyCommand(state, state.tick, localId(), cmd);
    pending.length = 0;
    stepSim(state, map, TICK);
    acc -= TICK;
  }

  const lead = Math.min(pass.W, pass.H) * 0.18;
  const tx = p.x - pass.W / 2 + dx * lead, ty = p.y - pass.H / 2 + dy * lead;
  cam.x += (clamp(tx, 0, map.w * TILE - pass.W) - cam.x) * Math.min(1, dt * 8);
  cam.y += (clamp(ty, 0, map.h * TILE - pass.H) - cam.y) * Math.min(1, dt * 8);

  drawScene(pass.sceneCtx, state, map, cam, pass.W, pass.H, ui);
  pass.render(state.time);
  syncHud();
  requestAnimationFrame(frame);
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ----------------------------------------------------------------------- ui -- */

function syncHud() {
  const el = document.getElementById('fps');
  if (el) el.textContent = `${fps} fps · ${pass.cellsX}x${pass.cellsY} cells · ${pass.cellW.toFixed(1)}x${pass.cellH} px`;
}

function buildUi() {
  const sets = document.getElementById('sets');
  sets.textContent = '';
  Object.keys(CHARSETS).forEach((k) => {
    const b = document.createElement('button');
    b.textContent = k;
    b.onclick = () => { pass.cfg.set = k; pass.setQuality(pass.cfg.matchQuality); pass.buildTiles(); pass.buildCellMap(); syncUi(); };
    sets.appendChild(b);
  });
  const modes = document.getElementById('modes');
  modes.textContent = '';
  ['original', 'phosphor', 'mono'].forEach((m) => {
    const b = document.createElement('button');
    b.textContent = m;
    b.onclick = () => { pass.cfg.colorMode = ['original', 'phosphor', 'mono'].indexOf(m); syncUi(); };
    modes.appendChild(b);
  });
  const phos = document.getElementById('phos');
  phos.textContent = '';
  ['#00ff88', '#00ff00', '#ffbf00', '#00ffff', '#ff4fa3'].forEach((c) => {
    const b = document.createElement('button');
    b.textContent = '●';
    b.onclick = () => { pass.cfg.phosphor = c; pass.cfg.colorMode = 1; syncUi(); };
    phos.appendChild(b);
  });
  const fx = document.getElementById('fx');
  fx.textContent = '';
  [['bloom', 'BLOOM'], ['grain', 'GRAIN'], ['chromatic', 'CHROMA'], ['scanlines', 'SCAN'], ['vignette', 'VIGN'], ['crt', 'CRT']]
    .forEach(([k, l]) => {
      const b = document.createElement('button');
      b.textContent = l; b.dataset.k = k;
      b.onclick = () => { pass.cfg[k] = !pass.cfg[k]; if (['scanlines', 'vignette'].includes(k)) pass.buildFxTables(); syncUi(); };
      fx.appendChild(b);
    });
  document.getElementById('invBtn').onclick = () => { pass.cfg.invert = !pass.cfg.invert; syncUi(); };
  document.getElementById('startBtn').onclick = () => { localStorage.removeItem(SAVE_KEY); location.reload(); };
  document.getElementById('saveBtn').onclick = save;
  document.getElementById('panelBtn').onclick = () => document.getElementById('panel').classList.toggle('hidden');
  const bind = (id, key, after) => {
    const e = document.getElementById(id);
    if (!e) return;
    e.oninput = (ev) => { pass.cfg[key] = Number(ev.target.value); if (after) after(); syncUi(); };
  };
  bind('scale', 'scale', () => pass.setScale(pass.cfg.scale));
  bind('spacing', 'spacing', () => pass.buildTiles());
  bind('bw', 'brightnessWeight');
  bind('ci', 'colorIntensity');
  bind('ch', 'chromaticOffset');
  bind('so', 'scanlineOpacity', () => pass.buildFxTables());
  bind('bl', 'bloomIntensity');
  bind('br', 'brightness');
  bind('co', 'contrast');
  bind('gm', 'gamma');
}

function syncUi() {
  const c = pass.cfg;
  const setKids = [...document.getElementById('sets').children];
  setKids.forEach((b, i) => b.classList.toggle('on', Object.keys(CHARSETS)[i] === c.set));
  const modeNames = ['original', 'phosphor', 'mono'];
  [...document.getElementById('modes').children].forEach((b, i) => b.classList.toggle('on', i === c.colorMode));
  [...document.getElementById('phos').children].forEach((b, i) =>
    b.classList.toggle('on', ['#00ff88', '#00ff00', '#ffbf00', '#00ffff', '#ff4fa3'][i] === c.phosphor));
  [...document.getElementById('fx').children].forEach((b) => b.classList.toggle('on', !!c[b.dataset.k]));
  document.getElementById('invBtn').classList.toggle('on', c.invert);
  const val = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  val('scaleV', `${c.scale} · ${pass.cellW.toFixed(1)}x${pass.cellH} · ${c.matchQuality}`);
  val('spacingV', c.spacing.toFixed(2));
  val('bwV', c.brightnessWeight.toFixed(2));
  val('ciV', c.colorIntensity.toFixed(2));
  val('chV', c.chromaticOffset);
  val('soV', c.scanlineOpacity.toFixed(2));
  val('blV', c.bloomIntensity.toFixed(2));
  val('brV', c.brightness);
  val('coV', c.contrast);
  val('gmV', c.gamma.toFixed(2));
  document.documentElement.style.setProperty('--fg', c.colorMode === 0 ? '#00ff88' : c.phosphor);
}

buildUi();
syncUi();
window.__game = { state, map, pass };
requestAnimationFrame(frame);
