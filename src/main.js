/* Wiring: fixed-timestep simulation, command queue in, ASCII pass out.
 * Input only ever produces commands, so the same queue runs either against the
 * local sim (?offline=1) or against the authoritative host (default). */

import { AsciiPass } from './ascii.js';
import { generateMap, TILE } from './world.js';
import { createState, placeAtSpawn, spawnWorld, stepSim, applyCommand, serialize, deserialize, TICK } from './sim.js';
import { drawScene, weatherAt } from './render.js';
import { CHARSETS } from './config.js';
import { ITEMS, DIALOGUES } from './data.js';
import { Net } from './net.js';

const SAVE_KEY = 'glyph-rpg-save';
const NAME_KEY = 'glyph-name';
const params = new URLSearchParams(location.search);
const seed = (Number(params.get('seed')) || 20261103) >>> 0;
const wantOnline = params.get('offline') !== '1';

const map = generateMap(seed);
const name = (localStorage.getItem(NAME_KEY) || params.get('name') || 'HERALD').toUpperCase().slice(0, 12);

let state;
let net = null;

function offlineState() {
  let s = null;
  const saved = localStorage.getItem(SAVE_KEY);
  if (saved) { try { s = deserialize(saved); } catch { s = null; } }
  if (!s || s.seed !== seed) {
    s = createState(seed, [name]);
    placeAtSpawn(s, map);
    spawnWorld(s, map);
  }
  s.npcList = map.npcs;
  return s;
}

if (wantOnline) {
  state = createState(seed, []);
  state.npcList = map.npcs;
  spawnWorld(state, map);
  state.log = [{ tick: 0, text: 'LOOKING FOR THE HOST…' }];
  net = new Net({ state, map, name, onLog: (t) => state.log.push({ tick: state.tick, text: t }) });
  setTimeout(() => {
    if (net && !net.connected) {
      net = null;
      state = offlineState();
      state.log.push({ tick: state.tick, text: 'HOST UNREACHABLE · MODO OFFLINE' });
    }
  }, 5000);
} else {
  state = offlineState();
}

const out = document.getElementById('out');
const pass = new AsciiPass(out);
pass.cfg.set = 'detailed';
const touch = matchMedia('(pointer: coarse)').matches;
pass.setScale(1);
const ZOOM = touch ? 2.8 : 3.4;
pass.buildAtlas(); pass.buildTiles(); pass.buildCellMap();

const ui = {
  inventoryOpen: false,
  dialogueLines: (st) => {
    const d = DIALOGUES[st.dialogue.who];
    if (!d) return [];
    const lines = [`> ${d[0].q}   ${d[0].a}`, `> ${d[1].q}   ${d[1].a}`];
    if (st.dialogue.who === 'elder') lines.push(st.quest.active ? '[q] report  ' + st.quest.kills + '/5' : '[q] accept quest');
    return lines;
  },
};
Object.defineProperty(ui, 'cellW', { get: () => pass.cellW });
Object.defineProperty(ui, 'cellH', { get: () => pass.cellH });

if (touch) document.getElementById('panel').classList.add('hidden');
document.getElementById('nameIn').value = name;

fit();
addEventListener('resize', fit);
addEventListener('orientationchange', () => setTimeout(fit, 250));
function fit() {
  const stage = document.getElementById('stage');
  pass.resize(stage.clientWidth, stage.clientHeight);
}

/* ------------------------------------------------------------------ input -- */

const keys = new Set();
const pending = [];
let attackRepeat = null;
let audio = null;
let audioLogIndex = 0;
let rainSource = null;
function audioContext() {
  if (!audio) audio = new AudioContext();
  if (audio.state === 'suspended') audio.resume();
  return audio;
}
function tone(freq, duration = 0.08, gain = 0.035, type = 'sine') {
  const ac = audioContext(), osc = ac.createOscillator(), amp = ac.createGain();
  osc.type = type; osc.frequency.value = freq;
  amp.gain.setValueAtTime(gain, ac.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  osc.connect(amp).connect(ac.destination); osc.start(); osc.stop(ac.currentTime + duration);
}
function updateAudio() {
  const logs = state.log || [];
  for (; audioLogIndex < logs.length; audioLogIndex++) {
    const text = logs[audioLogIndex].text || '';
    if (text.includes('HIT BY')) tone(110, 0.12, 0.05, 'square');
    else if (text.startsWith('LEVEL')) { tone(520, 0.12); setTimeout(() => tone(780, 0.16), 90); }
    else if (text.includes('HEAL')) tone(660, 0.12);
    else if (text.includes('FROST')) tone(240, 0.16, 0.04, 'triangle');
  }
  if (audioLogIndex > 80) audioLogIndex = Math.max(0, logs.length - 8);
  const rain = (state.weather || 0) > 0.05;
  if (rain && !rainSource) {
    const ac = audioContext(), buffer = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.08;
    rainSource = ac.createBufferSource(); rainSource.buffer = buffer; rainSource.loop = true;
    const gain = ac.createGain(); gain.gain.value = 0.025; rainSource.connect(gain).connect(ac.destination); rainSource.start();
  } else if (!rain && rainSource) { rainSource.stop(); rainSource = null; }
}
addEventListener('pointerdown', () => { try { audioContext(); } catch {} }, { once: true });
addEventListener('keydown', () => { try { audioContext(); } catch {} }, { once: true });
const localId = () => state.local;

function nearestTarget() {
  const p = state.players[localId()];
  if (!p) return null;
  let best = null, bd = 90 * 90;
  for (const e of Object.values(state.enemies)) {
    if (!e.alive) continue;
    const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d2 < bd) { bd = d2; best = e.id; }
  }
  for (const q of Object.values(state.players)) {
    if (q.id === p.id || q.dead) continue;
    const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d2 < bd) { bd = d2; best = q.id; }
  }
  return best;
}

function queue(cmd) { pending.push(cmd); }

function typing() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
}

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'enter' && !typing()) {
    e.preventDefault();
    openChat();
    return;
  }
  if (typing()) {
    if (k === 'escape') document.activeElement.blur();
    return;
  }
  if (k.startsWith('arrow') || k === ' ') e.preventDefault();
  keys.add(k);

  if (/^[0-9]$/.test(k)) {
    const slot = k === '0' ? 9 : Number(k) - 1;
    const p = state.players[localId()];
    if (ui.inventoryOpen && p && p.inv[slot] && ITEMS[p.inv[slot].id].kind === 'consumable') queue({ t: 'use', slot });
    else if (!ui.inventoryOpen && k === '2') queue({ t: 'cast', skill: 'heal' });
    else if (!ui.inventoryOpen && k === '3') queue({ t: 'cast', skill: 'frost' });
    else if (!ui.inventoryOpen) setCharset(slot);
    return;
  }

  switch (k) {
    case 'j': case 'z': queue({ t: 'attack', target: nearestTarget() }); break;
    case 'l': queue({ t: 'cast', skill: 'spark', target: nearestTarget() }); break;
    case 'e': queue({ t: 'interact' }); break;
    case 'u': { const p = state.players[localId()]; queue({ t: 'equip', slot: firstEquipSlot(p) }); break; }
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
    case 'q': questCmd(); break;
    default: break;
  }
  syncUi();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

/* A hidden tab stops getting animation frames, so the host would keep walking
 * the last direction forever. Stop the avatar when the tab goes away. */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  keys.clear();
  pending.length = 0;
  if (net) { net.sendCmd({ t: 'move', dx: 0, dy: 0 }); lastMove = { t: 'move', dx: 0, dy: 0 }; }
});
addEventListener('blur', () => keys.clear());

function questCmd() {
  const p = state.players[localId()];
  const elder = map.npcs.find((n) => n.role === 'quest');
  if (!p || !elder || Math.hypot(elder.x - p.x, elder.y - p.y) >= 60) return;
  queue(state.quest.active && !state.quest.turnedIn ? { t: 'questin' } : { t: 'quest' });
}

function firstEquipSlot(p) {
  if (!p) return -1;
  return p.inv.findIndex((s) => s && ITEMS[s.id] && ['weapon', 'armor'].includes(ITEMS[s.id].kind));
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
  if (net) { state.log.push({ tick: state.tick, text: 'O HOST GUARDA SEU PROGRESSO' }); return; }
  localStorage.setItem(SAVE_KEY, serialize(state));
  state.log.push({ tick: state.tick, text: 'SAVED' });
}

/* touch controls feed the same keys/command channels as the keyboard */
for (const el of document.querySelectorAll('#pad .kb')) {
  const key = el.dataset.k, act = el.dataset.t;
  const down = (e) => {
    e.preventDefault();
    el.classList.add('on');
    if (key) { keys.add(key); return; }
    if (act === 'attack') {
      queue({ t: 'attack', target: nearestTarget() });
      attackRepeat = setInterval(() => queue({ t: 'attack', target: nearestTarget() }), 180);
    }
    else if (act === 'cast') queue({ t: 'cast', skill: 'spark', target: nearestTarget() });
    else if (act === 'heal') queue({ t: 'cast', skill: 'heal' });
    else if (act === 'frost') queue({ t: 'cast', skill: 'frost' });
    else if (act === 'interact') queue({ t: 'interact' });
    else if (act === 'bag') { ui.inventoryOpen = !ui.inventoryOpen; syncUi(); }
  };
  const up = () => {
    el.classList.remove('on');
    if (key) keys.delete(key);
    if (act === 'attack' && attackRepeat) { clearInterval(attackRepeat); attackRepeat = null; }
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
}

/* tap the world to aim */
out.addEventListener('pointerdown', (e) => {
  const p = state.players[localId()];
  if (!p) return;
  const box = out.getBoundingClientRect();
  const sx = (e.clientX - box.left) * (pass.W / box.width);
  const sy = (e.clientY - box.top) * (pass.H / box.height);
  p.face = Math.atan2(sy / ZOOM + cam.y - p.y, sx / ZOOM + cam.x - p.x);
});

const chatForm = document.getElementById('chatbar');
const chatIn = document.getElementById('chatIn');
function openChat() {
  chatForm.style.display = 'flex';
  chatIn.focus();
}
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatIn.value.trim();
  chatIn.value = '';
  if (!text) return;
  if (net) net.chat(text);
  else {
    const p = state.players[localId()];
    (state.chatFeed ||= []).push({ name: p.name, text, t: state.time });
    p.say = { name: p.name, text, t: state.time };
  }
  chatForm.style.display = touch ? 'flex' : 'none';
  chatIn.blur();
});
document.getElementById('gear').onclick = () => document.getElementById('panel').classList.toggle('hidden');

/* -------------------------------------------------------------------- loop -- */

let acc = 0, last = performance.now(), fps = 60, fpsAcc = 0, fpsN = 0;
let lastMove = { t: 'move', dx: 0, dy: 0 };
const cam = { x: 0, y: 0 };

function frame(now) {
  let dt = (now - last) / 1000; last = now;
  dt = Math.min(0.1, Math.max(0.001, dt));
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

  let dx = 0, dy = 0;
  if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
  if (keys.has('arrowright') || keys.has('d')) dx += 1;
  if (keys.has('arrowup') || keys.has('w')) dy -= 1;
  if (keys.has('arrowdown') || keys.has('s')) dy += 1;

  const p = state.players[localId()];
  if (p) {
    if (net) {
      if (pending.length) { for (const c of pending) net.sendCmd(c); }
      const mv = { t: 'move', dx, dy };
      if (mv.dx !== lastMove.dx || mv.dy !== lastMove.dy) { net.sendCmd(mv); lastMove = mv; }
      pending.length = 0;
      net.apply(dt, dx, dy);
    } else {
      applyCommand(state, state.tick, localId(), { t: 'move', dx, dy }, map);
      acc += dt;
      let guard = 0;
      while (acc >= TICK && guard++ < 5) {
        for (const cmd of pending) applyCommand(state, state.tick, localId(), cmd, map);
        pending.length = 0;
        stepSim(state, map, TICK);
        acc -= TICK;
      }
    }
  } else {
    pending.length = 0;
  }

  state.weather = weatherAt(state.time);

  const zoom = ZOOM;
  const viewW = pass.W / zoom, viewH = pass.H / zoom;
  const focus = p || { x: map.spawn.x, y: map.spawn.y };
  const lead = Math.min(viewW, viewH) * 0.18;
  const tx = focus.x - viewW / 2 + dx * lead, ty = focus.y - viewH / 2 + dy * lead;
  cam.x += (clamp(tx, 0, Math.max(0, map.w * TILE - viewW)) - cam.x) * Math.min(1, dt * 8);
  cam.y += (clamp(ty, 0, Math.max(0, map.h * TILE - viewH)) - cam.y) * Math.min(1, dt * 8);

  drawScene(pass.sceneCtx, state, map, cam, pass.W, pass.H, ui, zoom);
  pass.render(state.time);
  updateAudio();
  syncHud();
  requestAnimationFrame(frame);
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ----------------------------------------------------------------------- ui -- */

function syncHud() {
  const el = document.getElementById('fps');
  if (!el) return;
  const who = net ? (net.connected ? `${state.online || 1} online` : 'conectando…') : 'offline';
  el.textContent = `${fps} fps · ${pass.cellsX}x${pass.cellsY} cells · ${pass.cellW.toFixed(1)}x${pass.cellH} px · ${who}`;
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
  document.getElementById('startBtn').onclick = () => { localStorage.removeItem(SAVE_KEY); location.href = location.pathname + '?offline=1&seed=' + Date.now(); };
  document.getElementById('saveBtn').onclick = save;
  document.getElementById('panelBtn').onclick = () => document.getElementById('panel').classList.toggle('hidden');
  document.getElementById('nameIn').onchange = (e) => {
    localStorage.setItem(NAME_KEY, e.target.value.toUpperCase().slice(0, 12));
    location.reload();
  };
  const bind = (id, key, after) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.oninput = (ev) => { pass.cfg[key] = Number(ev.target.value); if (after) after(); syncUi(); };
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

function syncStats() {
  const el = document.getElementById('stats');
  const p = state.players[localId()];
  if (!el || !p) return;
  el.textContent = '';
  for (const stat of ['str', 'dex', 'int']) {
    const row = document.createElement('span');
    row.textContent = `${stat.toUpperCase()} ${p.stats?.[stat] || 0} `;
    if ((p.statPoints || 0) > 0) {
      const b = document.createElement('button');
      b.textContent = '+';
      b.onclick = () => { queue({ t: 'stat', stat }); syncStats(); };
      row.appendChild(b);
    }
    el.appendChild(row);
  }
  const note = document.createElement('div');
  note.textContent = `POINTS ${p.statPoints || 0}`;
  el.appendChild(note);
}

function syncUi() {
  syncStats();
  const c = pass.cfg;
  [...document.getElementById('sets').children].forEach((b, i) => b.classList.toggle('on', Object.keys(CHARSETS)[i] === c.set));
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
window.__game = { get state() { return state; }, get net() { return net; }, get cam() { return cam; }, zoom: ZOOM, map, pass, ui };
requestAnimationFrame(frame);
