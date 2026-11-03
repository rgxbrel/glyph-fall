/* Scene painter. It only reads state; the ASCII pass then decides what the
 * player actually sees. Art is deliberately bright-on-dark: the pass maps
 * luminance to glyph density, so a dim scene renders as sparse dots. */

import { TILE, T } from './world.js';
import { ITEMS } from './data.js';
import { SAFE_RADIUS } from './sim.js';

const TILE_COLOR = ['#122618', '#2e2411', '#8c94a8', '#12384f', '#1a4a26', '#8a743c'];
const TILE_EDGE = ['#2f6b41', '#6b5024', '#dfe6f5', '#4fb3e8', '#57c47a', '#e6cd80'];

/* The reference look is a night scene: the ground is almost black and only the
 * edges and actors carry light, so the pass renders them as bright dashes. */
const NIGHT = 0.2;
function shade(hex, k, cool = 0) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) * k, g = ((n >> 8) & 255) * k, b = (n & 255) * k;
  const m = (v, t) => Math.round(v * (1 - cool) + t * cool);
  return `rgb(${m(r, 22)},${m(g, 34)},${m(b, 56)})`;
}
const GROUND = TILE_COLOR.map((c) => shade(c, NIGHT, 0.3));
const DETAIL = [0.12, 0.1, 0.08, 0.09, 0.12, 0.1].map((k, i) => shade(TILE_EDGE[i], k));

export function drawScene(g, state, map, cam, W, H, ui, zoom = 1) {
  const cells = W / ((ui && ui.cellW) || 10);
  const cellHpx = (ui && ui.cellH) || 8;
  const rowH = Math.max(2, cellHpx / zoom);
  /* Snapping an actor's rows to the text grid keeps every bar inside one cell;
   * un-snapped bars straddle two rows and the pass dims them into invisibility. */
  const snapY = (v) => cam.y + Math.round(((v - cam.y) * zoom) / cellHpx) * (cellHpx / zoom);
  const S = Math.max(0.5, Math.min(1, cells / 130));
  const px = (v) => Math.max(5, Math.round(v * S / zoom));
  const vw = W / zoom, vh = H / zoom;
  g.fillStyle = '#05070c'; g.fillRect(0, 0, W, H);
  g.save();
  g.scale(zoom, zoom);
  g.translate(-cam.x, -cam.y);

  const tx0 = Math.max(0, Math.floor(cam.x / TILE)), ty0 = Math.max(0, Math.floor(cam.y / TILE));
  const tx1 = Math.min(map.w - 1, Math.ceil((cam.x + vw) / TILE)), ty1 = Math.min(map.h - 1, Math.ceil((cam.y + vh) / TILE));

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = map.tiles[ty * map.w + tx];
      const x = tx * TILE, y = ty * TILE;
      g.fillStyle = GROUND[t];
      g.fillRect(x, y, TILE, TILE);
      g.fillStyle = DETAIL[t];
      if (t === T.TREE) {
        g.fillRect(x + 12, y + 6, 8, 20); g.fillRect(x + 4, y + 4, 24, 8);
      } else if (t === T.ROCK) {
        g.fillRect(x + 3, y + 3, 26, 10); g.fillRect(x + 8, y + 14, 18, 14);
      } else if (t === T.WATER) {
        g.fillRect(x + 2, y + 10 + wave(state.time, tx), 12, 3);
        g.fillRect(x + 18, y + 20 + wave(state.time, tx + 3), 10, 3);
      } else if (t === T.GRASS) {
        g.fillRect(x + 6, y + 20, 3, 8); g.fillRect(x + 20, y + 8, 3, 7);
      } else if (t === T.DIRT) {
        g.fillRect(x + 10, y + 14, 8, 3);
      } else if (t === T.SAND) {
        g.fillRect(x + 5, y + 22, 5, 3); g.fillRect(x + 22, y + 9, 5, 3);
      }
    }
  }

  /* The safe plaza as a ring of daggers on the ground: it is drawn after the
   * tiles, which paint over anything beneath them, and as glyphs so the ASCII
   * pass reproduces it instead of flattening a coloured line. */
  g.save();
  g.fillStyle = 'rgba(126,233,192,0.75)';
  g.font = `700 ${px(14)}px ui-monospace, monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const ringN = 56;
  for (let i = 0; i < ringN; i++) {
    const a = (i / ringN) * 6.283185;
    g.fillText('†', map.spawn.x + Math.cos(a) * SAFE_RADIUS,
      snapY(map.spawn.y + Math.sin(a) * SAFE_RADIUS));
  }
  g.restore();

  for (const pk of Object.values(state.pickups)) {
    if (pk.taken) continue;
    const bob = Math.sin(state.time * 3 + pk.x) * 3;
    if (pk.kind === 'chest') {
      g.fillStyle = '#ffd23f'; g.fillRect(pk.x - 12, pk.y - 9, 24, 18);
      g.fillStyle = '#5a3c00'; g.fillRect(pk.x - 12, pk.y - 2, 24, 4);
    } else {
      g.fillStyle = '#8dff5a'; g.fillRect(pk.x - 4, pk.y - 8 + bob, 8, 14);
      g.fillStyle = '#e8ffd0'; g.fillRect(pk.x - 7, pk.y - 2 + bob, 14, 4);
    }
  }

  for (const npc of (map.npcs || [])) {
    g.fillStyle = '#ffe9a8';
    g.fillRect(npc.x - 10, npc.y - 26, 20, 30);
    g.fillStyle = '#3a2a00'; g.fillRect(npc.x - 6, npc.y - 20, 4, 4); g.fillRect(npc.x + 2, npc.y - 20, 4, 4);
    g.fillStyle = '#7fe9c0'; g.font = `700 ${px(13)}px ui-monospace, monospace`; g.textAlign = 'center';
    g.fillText(npc.name, npc.x, npc.y - 34);
    if (npc.role === 'quest' && state.quest.active && !state.quest.turnedIn) {
      g.fillStyle = '#ffd23f'; g.fillText(`${state.quest.kills}/5`, npc.x, npc.y - 48);
    } else if (npc.role === 'quest' && !state.quest.active && !state.quest.turnedIn) {
      g.fillStyle = '#8dff5a'; g.fillText('!', npc.x, npc.y - 48);
    }
  }

  for (const e of Object.values(state.enemies)) {
    if (!e.alive) continue;
    const hurt = e.hurt > 0;
    g.fillStyle = hurt ? '#ffffff' : enemyColor(e.kind);
    const wob = Math.sin(state.time * 6 + e.x * 0.1) * 2;
    if (e.kind === 'slime') {
      g.beginPath(); g.ellipse(e.x, e.y + wob, e.r, e.r * 0.75, 0, 0, 6.283); g.fill();
      g.fillStyle = '#0a0a0a'; g.fillRect(e.x - 6, e.y - 4 + wob, 3, 3); g.fillRect(e.x + 3, e.y - 4 + wob, 3, 3);
    } else if (e.kind === 'beetle') {
      g.fillRect(e.x - e.r, e.y - e.r * 0.7 + wob, e.r * 2, e.r * 1.4);
      g.fillStyle = '#1a1a1a'; g.fillRect(e.x - e.r - 5, e.y - 3, 5, 6); g.fillRect(e.x + e.r, e.y - 3, 5, 6);
    } else {
      g.beginPath(); g.arc(e.x, e.y + wob, e.r, 0, 6.283); g.fill();
      g.fillStyle = '#000'; g.fillRect(e.x - 7, e.y - 5 + wob, 4, 6); g.fillRect(e.x + 3, e.y - 5 + wob, 4, 6);
    }
    if (e.hp < e.hpMax) {
      g.fillStyle = '#2a0000'; g.fillRect(e.x - 14, e.y - e.r - 12, 28, 4);
      g.fillStyle = '#ff5a5a'; g.fillRect(e.x - 14, e.y - e.r - 12, 28 * (e.hp / e.hpMax), 4);
    }
  }

  for (const pr of Object.values(state.projectiles)) {
    g.fillStyle = pr.skill === 'frost' ? '#b9a7ff' : '#7fe9ff';
    g.beginPath(); g.arc(pr.x, pr.y, 6, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(127,233,255,0.4)';
    g.beginPath(); g.arc(pr.x - pr.vx * 0.02, pr.y - pr.vy * 0.02, 9, 0, 6.283); g.fill();
  }

  for (const p of Object.values(state.players)) drawActor(g, p, state, px, rowH, snapY);
  g.restore();

  drawAmbient(g, state, W, H);
  drawWeather(g, state, W, H);
  drawDayNight(g, state, W, H);
  drawHud(g, state, map, W, H, ui, px);
}

/* Sparse drifting sparks: they are the only bright noise on an almost black
 * ground, which is what gives the reference its scattered specks. */
let sparks = null;
function drawAmbient(g, state, W, H) {
  if (!sparks) {
    sparks = [];
    for (let i = 0; i < 110; i++) sparks.push({ x: Math.random(), y: Math.random(), p: Math.random() * 6.283, c: Math.random() });
  }
  const t = state.time;
  for (const s of sparks) {
    const tw = 0.5 + 0.5 * Math.sin(t * 1.6 + s.p);
    if (tw < 0.35) continue;
    const x = ((s.x * W + t * 6) % W + W) % W;
    const y = ((s.y * H + Math.sin(t * 0.4 + s.p) * 8) % H + H) % H;
    g.fillStyle = s.c > 0.72 ? `rgba(150,235,255,${0.5 * tw})` : `rgba(90,190,205,${0.32 * tw})`;
    g.fillRect(x, y, 2, 2);
  }
}

/* Shared weather: host and client both derive it from world time, so everyone
 * stands in the same rain. */
export function weatherAt(t) {
  const c = 160, p = t % c, k = Math.floor(t / c) % 4;
  if (k === 0) return clamp01(p / 25);
  if (k === 1) return 1;
  if (k === 2) return 1 - clamp01(p / 25);
  return 0;
}

function weatherModeAt(t) {
  const phase = Math.floor(t / 160) % 8;
  return phase === 3 || phase === 7 ? 'fog' : phase === 4 || phase === 5 ? 'storm' : 'rain';
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

let drops = null;
function drawWeather(g, state, W, H) {
  const k = state.weather || 0;
  const mode = weatherModeAt(state.time);
  const phase = (state.time % 160) / 160;
  const active = k > 0.02 || mode !== 'rain';
  if (!active) return;
  if (!drops) {
    drops = [];
    for (let i = 0; i < 260; i++) drops.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8, l: 0.5 + Math.random() });
  }
  const t = state.time, rain = mode === 'storm' ? Math.max(k, 0.72) : k;
  const n = Math.round(260 * rain);
  g.save();
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const d = drops[i];
    const x = ((d.x * W + t * 130 * d.s) % (W + 60)) - 30;
    const y = ((d.y * H + t * 620 * d.s) % (H + 40)) - 20;
    const len = 5 + d.l * 8 * rain;
    g.strokeStyle = `rgba(190,224,255,${0.1 + d.l * 0.16})`;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - len * 0.28, y + len); g.stroke();
    if (y > H - 34) { g.strokeStyle = 'rgba(180,215,255,0.12)'; g.strokeRect(x - 3, H - 16, 6, 2); g.strokeStyle = `rgba(190,224,255,${0.1 + d.l * 0.16})`; }
  }
  if (mode === 'fog') {
    g.fillStyle = `rgba(150,170,185,${0.12 + 0.08 * Math.sin(phase * 6.283)})`;
    g.fillRect(0, 0, W, H);
  } else {
    g.fillStyle = `rgba(8,16,28,${0.22 * rain})`;
    g.fillRect(0, 0, W, H);
  }
  if (mode === 'storm' && Math.sin(state.time * 2.7) > 0.985) {
    g.fillStyle = 'rgba(190,220,255,0.2)';
    g.fillRect(0, 0, W, H);
  }
  g.restore();
}

function drawDayNight(g, state, W, H) {
  const cycle = (state.time % 360) / 360;
  const light = 0.5 + 0.5 * Math.sin(cycle * Math.PI * 2 - Math.PI / 2);
  const night = 1 - light;
  if (night < 0.08) return;
  g.fillStyle = `rgba(8,18,42,${0.04 + night * 0.12})`;
  g.fillRect(0, 0, W, H);
  if (light > 0.7) {
    g.fillStyle = `rgba(110,150,90,${(light - 0.7) * 0.06})`;
    g.fillRect(0, 0, W, H);
  }
}

function wave(t, i) { return Math.sin(t * 2 + i) * 3; }

function enemyColor(k) { return k === 'slime' ? '#5fe8a0' : k === 'beetle' ? '#ffb347' : '#c58fff'; }

function drawActor(g, p, state, px, rowH, snapY) {
  if (p.dead) {
    g.fillStyle = '#4a5a66'; g.fillRect(p.x - 12, p.y - 6, 24, 12);
    return;
  }
  const blink = p.iframes > 0 && (Math.floor(state.time * 20) % 2 === 0);
  const body = blink ? '#2a3a44' : p.flash > 0 ? '#ffffff' : '#e6edf4';
  const bob = Math.hypot(p.vx, p.vy) > 1 ? Math.sin(p.anim) * 2 : 0;
  /* One bar per text row, 60% of it filled: the pass reads each row as a solid
   * dash instead of a dim half-lit cell. */
  const th = Math.max(1.5, rowH * 0.78);
  const top = snapY(p.y - rowH * 4.5 + bob);
  g.fillStyle = body;
  g.fillRect(p.x - 5, top, 10, th);
  for (let i = 1; i < 6; i++) g.fillRect(p.x - 9, top + i * rowH, 18, th);
  g.fillRect(p.x - 7, top + 6 * rowH, 5, th);
  g.fillRect(p.x + 2, top + 6 * rowH, 5, th);
  g.fillStyle = '#0a1014';
  const ey = top + 2 * rowH;
  g.fillRect(p.x - 6 + Math.cos(p.face) * 3, ey, 3, th);
  g.fillRect(p.x + 3 + Math.cos(p.face) * 3, ey, 3, th);
  g.fillStyle = p.local ? '#7fe9c0' : '#a8c4ff';
  g.fillRect(p.x - 9, top + 7 * rowH, 18, th);

  if (p.swing > 0) {
    const a = p.face, k = p.swing / 0.18;
    g.strokeStyle = '#ffffff'; g.lineWidth = 4;
    g.beginPath();
    g.arc(p.x, p.y, 34 + (1 - k) * 12, a - 0.9, a + 0.9);
    g.stroke(); g.lineWidth = 1;
  }
  g.fillStyle = p.local ? '#e8fff2' : '#cfe0ff'; g.font = `700 ${px(12)}px ui-monospace, monospace`; g.textAlign = 'center';
  g.fillText(p.name, p.x, top - Math.max(4, rowH * 0.8));
  if (p.say && state.time - p.say.t < 5) {
    const w = Math.min(px(190), px(12) + p.say.text.length * px(6.4));
    g.fillStyle = 'rgba(4,8,12,0.85)';
    g.fillRect(p.x - w / 2, top - rowH * 2.6, w, px(15));
    g.fillStyle = '#ffffff'; g.font = `600 ${px(11)}px ui-monospace, monospace`;
    g.fillText(p.say.text, p.x, top - rowH * 1.2);
  }
}

function drawHud(g, state, map, W, H, ui, px) {
  const p = state.players[state.local];
  if (!p) return;
  const barW = Math.min(px(120), W * 0.26);
  g.fillStyle = 'rgba(3,6,10,0.72)'; g.fillRect(0, 0, W, px(34));
  g.textAlign = 'left';
  g.fillStyle = '#c9ffe8'; g.font = `700 ${px(15)}px ui-monospace, monospace`;
  bar(g, 8, 6, barW, px(9), p.hp / p.hpMax, '#ff5a6a');
  bar(g, 8, px(19), barW, px(9), p.mp / p.mpMax, '#5aa8ff');
  g.fillStyle = '#c9ffe8';
  g.fillText(`LV${p.level} ${p.xp}/${p.xpNext}`, barW + 14, px(20));
  const wep = p.equip.weapon ? ITEMS[p.equip.weapon].name : 'FISTS';
  g.fillStyle = '#8fe8b0';
  const safe = Math.hypot(p.x - map.spawn.x, p.y - map.spawn.y) < SAFE_RADIUS;
  g.fillText(`${state.online ? state.online + ' ONLINE ' : 'OFFLINE '}${wep} ${p.marks}m${safe ? ' · SAFE' : ''}`, barW + px(112), px(20));
  if (state.quest.active && !state.quest.turnedIn) {
    g.fillStyle = '#ffd23f'; g.textAlign = 'right';
    g.fillText(`QUEST ${state.quest.kills}/5`, W - 8, px(20));
    g.textAlign = 'left';
  }

  const feed = (state.chatFeed || []).filter((c) => state.time - c.t < 14).slice(-4);
  const tail = state.log.slice(-3);
  const base = H - px(40) - feed.length * px(16);
  g.font = `600 ${px(14)}px ui-monospace, monospace`;
  tail.forEach((l, i) => {
    const age = (state.tick - l.tick) / 60;
    g.fillStyle = `rgba(200,255,232,${Math.max(0, 1 - age / 4)})`;
    g.fillText(l.text, 8, base + i * px(16));
  });
  g.font = `600 ${px(13)}px ui-monospace, monospace`;
  feed.forEach((c, i) => {
    g.fillStyle = 'rgba(190,225,255,0.92)';
    g.fillText(`${c.name}: ${c.text}`, 8, base + tail.length * px(16) + i * px(16));
  });

  if (state.dialogue) {
    const lines = ui.dialogueLines(state);
    const h = px(46) + lines.length * px(17);
    g.fillStyle = 'rgba(3,6,10,0.9)'; g.fillRect(0, H - h, W, h);
    g.fillStyle = '#ffd23f'; g.font = `700 ${px(16)}px ui-monospace, monospace`;
    g.fillText(state.dialogue.name, 12, H - h + px(22));
    g.fillStyle = '#c9ffe8'; g.font = `600 ${px(14)}px ui-monospace, monospace`;
    lines.forEach((l, i) => g.fillText(l, 12, H - h + px(40) + i * px(17)));
  }

  if (ui.inventoryOpen) {
    const w = Math.min(W - 16, px(256)), h = px(210);
    g.fillStyle = 'rgba(3,6,10,0.92)'; g.fillRect(W - w - 8, px(44), w, h);
    g.fillStyle = '#7fe9c0'; g.font = `700 ${px(14)}px ui-monospace, monospace`;
    g.fillText('INVENTORY  1-6 use · e equip', W - w, px(62));
    g.fillStyle = '#c9ffe8'; g.font = `600 ${px(13)}px ui-monospace, monospace`;
    p.inv.slice(0, 8).forEach((s, i) => {
      g.fillText(`${i + 1}  ${ITEMS[s.id].name} x${s.qty}`, W - w, px(84) + i * px(19));
    });
    if (!p.inv.length) g.fillText('(empty)', W - w, px(84));
  }

  if (p.dead) {
    g.fillStyle = 'rgba(4,7,12,0.7)'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ff8a8a'; g.font = `900 ${px(40)}px ui-monospace, monospace`; g.textAlign = 'center';
    g.fillText('COMPILING...', W / 2, H / 2);
    g.textAlign = 'left';
  }
}

function bar(g, x, y, w, h, k, col) {
  g.fillStyle = '#20282e'; g.fillRect(x, y, w, h);
  g.fillStyle = col; g.fillRect(x, y, w * Math.max(0, Math.min(1, k)), h);
}
