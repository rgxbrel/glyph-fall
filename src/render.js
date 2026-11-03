/* Scene painter. It only reads state; the ASCII pass then decides what the
 * player actually sees. Art is deliberately bright-on-dark: the pass maps
 * luminance to glyph density, so a dim scene renders as sparse dots. */

import { TILE, T } from './world.js';
import { ITEMS } from './data.js';

const TILE_COLOR = ['#122618', '#2e2411', '#8c94a8', '#12384f', '#1a4a26', '#8a743c'];
const TILE_EDGE = ['#2f6b41', '#6b5024', '#dfe6f5', '#4fb3e8', '#57c47a', '#e6cd80'];

export function drawScene(g, state, map, cam, W, H, ui) {
  g.fillStyle = '#05070c'; g.fillRect(0, 0, W, H);
  g.save();
  g.translate(-cam.x, -cam.y);

  const tx0 = Math.max(0, Math.floor(cam.x / TILE)), ty0 = Math.max(0, Math.floor(cam.y / TILE));
  const tx1 = Math.min(map.w - 1, Math.ceil((cam.x + W) / TILE)), ty1 = Math.min(map.h - 1, Math.ceil((cam.y + H) / TILE));

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = map.tiles[ty * map.w + tx];
      const x = tx * TILE, y = ty * TILE;
      g.fillStyle = TILE_COLOR[t];
      g.fillRect(x, y, TILE, TILE);
      g.fillStyle = TILE_EDGE[t];
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
    g.fillStyle = '#7fe9c0'; g.font = '700 13px ui-monospace, monospace'; g.textAlign = 'center';
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
    g.fillStyle = '#7fe9ff';
    g.beginPath(); g.arc(pr.x, pr.y, 6, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(127,233,255,0.4)';
    g.beginPath(); g.arc(pr.x - pr.vx * 0.02, pr.y - pr.vy * 0.02, 9, 0, 6.283); g.fill();
  }

  for (const p of Object.values(state.players)) drawActor(g, p, state);
  g.restore();

  drawHud(g, state, W, H, ui);
}

function wave(t, i) { return Math.sin(t * 2 + i) * 3; }

function enemyColor(k) { return k === 'slime' ? '#5fe8a0' : k === 'beetle' ? '#ffb347' : '#c58fff'; }

function drawActor(g, p, state) {
  if (p.dead) {
    g.fillStyle = '#4a5a66'; g.fillRect(p.x - 12, p.y - 6, 24, 12);
    return;
  }
  const blink = p.iframes > 0 && (Math.floor(state.time * 20) % 2 === 0);
  const body = blink ? '#2a3a44' : p.flash > 0 ? '#ffffff' : '#d8fff0';
  const bob = Math.hypot(p.vx, p.vy) > 1 ? Math.sin(p.anim) * 2 : 0;
  g.fillStyle = body;
  g.fillRect(p.x - 9, p.y - 20 + bob, 18, 26);
  g.fillStyle = '#0a1014';
  g.fillRect(p.x - 6 + Math.cos(p.face) * 3, p.y - 15 + bob + Math.sin(p.face) * 2, 3, 4);
  g.fillRect(p.x + 3 + Math.cos(p.face) * 3, p.y - 15 + bob + Math.sin(p.face) * 2, 3, 4);
  g.fillStyle = '#7fe9c0'; g.fillRect(p.x - 9, p.y + 6 + bob, 18, 4);

  if (p.swing > 0) {
    const a = p.face, k = p.swing / 0.18;
    g.strokeStyle = '#ffffff'; g.lineWidth = 4;
    g.beginPath();
    g.arc(p.x, p.y, 34 + (1 - k) * 12, a - 0.9, a + 0.9);
    g.stroke(); g.lineWidth = 1;
  }
  g.fillStyle = '#c9ffe8'; g.font = '700 12px ui-monospace, monospace'; g.textAlign = 'center';
  g.fillText(p.name, p.x, p.y - 28 + bob);
}

function drawHud(g, state, W, H, ui) {
  const p = state.players[state.local];
  if (!p) return;
  g.fillStyle = 'rgba(3,6,10,0.72)'; g.fillRect(0, 0, W, 34);
  g.textAlign = 'left';
  g.fillStyle = '#c9ffe8'; g.font = '700 15px ui-monospace, monospace';
  bar(g, 8, 6, 120, 9, p.hp / p.hpMax, '#ff5a6a');
  bar(g, 8, 19, 120, 9, p.mp / p.mpMax, '#5aa8ff');
  g.fillStyle = '#c9ffe8';
  g.fillText(`LV${p.level}  ${p.xp}/${p.xpNext}  ${p.marks}m`, 140, 20);
  const wep = p.equip.weapon ? ITEMS[p.equip.weapon].name : 'FISTS';
  g.fillStyle = '#8fe8b0';
  g.fillText(`${wep}  STR${p.stats.str} DEX${p.stats.dex} INT${p.stats.int}`, 320, 20);
  if (state.quest.active && !state.quest.turnedIn) {
    g.fillStyle = '#ffd23f'; g.fillText(`QUEST ${state.quest.kills}/5`, W - 130, 20);
  }

  const tail = state.log.slice(-3);
  g.font = '600 14px ui-monospace, monospace';
  tail.forEach((l, i) => {
    const age = (state.tick - l.tick) / 60;
    g.fillStyle = `rgba(200,255,232,${Math.max(0, 1 - age / 4)})`;
    g.fillText(l.text, 8, H - 40 + i * 16);
  });

  if (state.dialogue) {
    const lines = ui.dialogueLines(state);
    g.fillStyle = 'rgba(3,6,10,0.9)'; g.fillRect(0, H - 110, W, 110);
    g.fillStyle = '#ffd23f'; g.font = '700 16px ui-monospace, monospace';
    g.fillText(state.dialogue.name, 12, H - 88);
    g.fillStyle = '#c9ffe8'; g.font = '600 14px ui-monospace, monospace';
    lines.forEach((l, i) => g.fillText(l, 12, H - 66 + i * 17));
  }

  if (ui.inventoryOpen) {
    g.fillStyle = 'rgba(3,6,10,0.92)'; g.fillRect(W - 260, 44, 256, 210);
    g.fillStyle = '#7fe9c0'; g.font = '700 14px ui-monospace, monospace';
    g.fillText('INVENTORY  [1-6] use  [e] equip', W - 248, 62);
    g.fillStyle = '#c9ffe8'; g.font = '600 13px ui-monospace, monospace';
    p.inv.slice(0, 8).forEach((s, i) => {
      g.fillText(`${i + 1}  ${ITEMS[s.id].name} x${s.qty}`, W - 248, 84 + i * 19);
    });
    if (!p.inv.length) g.fillText('(empty)', W - 248, 84);
  }

  if (state.players[state.local].dead) {
    g.fillStyle = 'rgba(4,7,12,0.7)'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ff8a8a'; g.font = '900 44px ui-monospace, monospace'; g.textAlign = 'center';
    g.fillText('COMPILING...', W / 2, H / 2);
    g.textAlign = 'left';
  }
}

function bar(g, x, y, w, h, k, col) {
  g.fillStyle = '#20282e'; g.fillRect(x, y, w, h);
  g.fillStyle = col; g.fillRect(x, y, w * Math.max(0, Math.min(1, k)), h);
}
