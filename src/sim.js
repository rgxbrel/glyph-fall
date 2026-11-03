/* Simulation core. Nothing here touches the DOM or a canvas: state is plain
 * JSON, time advances in fixed steps, and every mutation goes through
 * applyCommand/stepSim. A server can host the same functions verbatim and
 * replay a client's commands by (tick, playerId). */

import { makeRng } from './world.js';
import { ITEMS, SKILLS, STOCK, sellOf } from './data.js';
import { nextPathStep } from './path.js';

export const TICK = 1 / 60;

const ENEMY_KINDS = [
  { kind: 'slime', hp: 22, dmg: 5, speed: 58, xp: 9, r: 13 },
  { kind: 'beetle', hp: 38, dmg: 8, speed: 74, xp: 16, r: 15 },
  { kind: 'wraith', hp: 60, dmg: 13, speed: 92, xp: 30, r: 16 },
];

// Deterministic PRNG carried inside the state, so a replay reproduces rolls.
export function rand(state) {
  let s = (state.rngState ^ (state.rngState << 13)) >>> 0;
  s = (s ^ (s >>> 17)) >>> 0;
  s = (s ^ (s << 5)) >>> 0;
  state.rngState = s >>> 0;
  return s / 4294967296;
}

export function createState(seed, names = ['HERALD']) {
  const rng = makeRng(seed);
  const state = {
    seed, tick: 0, time: 0, rngState: (seed * 2654435761) >>> 0 || 1,
    nextNetId: 1, local: '1',
    players: {}, enemies: {}, projectiles: {}, pickups: {},
    quest: { active: false, kills: 0, turnedIn: false },
    flags: {}, log: [],
  };
  for (const n of names) {
    const id = String(state.nextNetId++);
    state.players[id] = makePlayer(id, n);
  }
  return state;
}

/* The plaza around the spawn: the 5x5 cleared tiles, and the same size on screen
 * so the boundary ring is visible from the middle of it. Nothing can be hurt
 * inside and nothing hostile is allowed in, so a new player can read the screen
 * in peace. */
export const SAFE_RADIUS = 80;
export function inSafeZone(state, map, x, y) {
  return Math.hypot(x - map.spawn.x, y - map.spawn.y) < SAFE_RADIUS;
}

function makePlayer(id, name) {
  return {
    id, name, x: 0, y: 0, vx: 0, vy: 0, r: 12, face: 0, anim: 0,
    hp: 60, hpMax: 60, mp: 30, mpMax: 30,
    level: 1, xp: 0, xpNext: 20, marks: 0,
    stats: { str: 5, dex: 5, int: 5 }, statPoints: 0,
    inv: [{ id: 'herb', qty: 2 }], equip: { weapon: null, armor: null },
    /* Which NPC this player is talking to. Per player, never on the shared
     * state: one world object would show A's conversation on B's screen. */
    dialogue: null,
    cds: { attack: 0, cast: 0 }, iframes: 0, dead: false, respawn: 0, kills: 0,
  };
}

export function placeAtSpawn(state, map) {
  for (const p of Object.values(state.players)) spawnPoint(state, map, p);
}

/* Everyone would otherwise stack on the same pixel: melee cannot aim at an
 * overlapping body and the figures render on top of each other. */
export function spawnPoint(state, map, p) {
  const k = (p && p.id ? (p.id.charCodeAt(0) * 31 + Number(p.id.slice(1))) : 0) % 17;
  const a = k * 0.37;
  const r = 26 + (k % 4) * 14;
  const x = map.spawn.x + Math.cos(a) * r, y = map.spawn.y + Math.sin(a) * r;
  if (map.solidAt(x, y)) { p.x = map.spawn.x; p.y = map.spawn.y; return; }
  p.x = x; p.y = y;
}

export function spawnWorld(state, map) {
  const rng = makeRng(state.seed ^ 0x9e3779b9);
  for (const pr of map.props) {
    if (pr.kind === 'enemy') {
      // Keep procedural enemy props out of the protected plaza as well as AI movement.
      if (inSafeZone(state, map, pr.x, pr.y)) continue;
      const base = ENEMY_KINDS[Math.min(2, pr.tier)];
      const id = String(state.nextNetId++);
      state.enemies[id] = {
        id, kind: base.kind, tier: pr.tier, x: pr.x, y: pr.y, hx: pr.x, hy: pr.y,
        vx: 0, vy: 0, r: base.r, hp: base.hp, hpMax: base.hp, dmg: base.dmg,
        speed: base.speed, xp: base.xp, aggro: 0, cd: 0, wander: rng() * 6.283, alive: true,
      };
    } else if (pr.kind === 'herb' || pr.kind === 'chest') {
      const id = String(state.nextNetId++);
      state.pickups[id] = { id, kind: pr.kind, x: pr.x, y: pr.y, taken: false };
    }
  }
}

/* ------------------------------------------------------------------ input -- */

/* A client can send anything, and one NaN reaching a position is permanent: the
 * avatar leaves the world and never comes back. */
const unit = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0;
};

export function applyCommand(state, tick, playerId, cmd, map) {
  const p = state.players[playerId];
  if (!p || typeof cmd !== 'object' || cmd === null) return;
  if (p.dead && cmd.t !== 'move') return;
  switch (cmd.t) {
    case 'move': p.inx = unit(cmd.dx); p.iny = unit(cmd.dy); break;
    case 'attack': attack(state, map, p, cmd.target); break;
    case 'cast': cast(state, p, cmd.skill, cmd.target); break;
    case 'stat': spendStat(p, cmd.stat); break;
    case 'interact': interact(state, p); break;
    case 'use': useItem(state, p, cmd.slot); break;
    case 'equip': equipItem(state, p, cmd.slot); break;
    case 'quest': acceptQuest(state); break;
    case 'questin': turnInQuest(state, p); break;
    case 'trade': trade(state, p, cmd); break;
    case 'forge': forge(state, p, cmd.rune); break;
    default: break;
  }
}

function attack(state, map, p, targetId) {
  if (p.cds.attack > 0) return;
  p.cds.attack = 0.34;
  const wep = p.equip.weapon ? ITEMS[p.equip.weapon] : null;
  const runeBonus = p.runes?.weapon === 'fireRune' ? 4 : 0;
  const dmg = Math.round(4 + p.stats.str * 1.1 + (wep ? wep.dmg : 0) + runeBonus);
  const ax = Math.cos(p.face), ay = Math.sin(p.face);
  let hit = false;
  const aimed = (dx, dy, d) => d < 18 || (dx * ax + dy * ay) / d > 0.45;
  const victim = targetId && targetId !== p.id ? state.players[targetId] : null;
  if (victim && !victim.dead) {
    const dx = victim.x - p.x, dy = victim.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 52 + victim.r && aimed(dx, dy, d || 1)) {
      hurtPlayer(state, map, victim, dmg, p);
      hit = true;
    }
  }
  for (const e of Object.values(state.enemies)) {
    if (!e.alive) continue;
    const dx = e.x - p.x, dy = e.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 52 + e.r) continue;
    if (!aimed(dx, dy, d || 1)) continue;
    damageEnemy(state, e, dmg, p);
    hit = true;
  }
  p.swing = 0.18;
  if (hit) p.flash = 1;
}

function cast(state, p, skillId, targetId) {
  const sk = SKILLS[skillId];
  if (!sk || p.cds.cast > 0 || p.mp < sk.mp) return;
  p.cds.cast = sk.cd;
  p.mp -= sk.mp;
  if (sk.kind === 'heal') {
    const before = p.hp;
    p.hp = Math.min(p.hpMax, p.hp + sk.amount + p.stats.int);
    state.log.push({ tick: state.tick, text: p.name + ' HEAL +' + (p.hp - before) });
    return;
  }
  if (sk.kind === 'nova') {
    const dmg = Math.round(sk.amount + p.stats.int * 0.8);
    for (const e of Object.values(state.enemies)) {
      if (e.alive && Math.hypot(e.x - p.x, e.y - p.y) <= sk.radius) damageEnemy(state, e, dmg, p);
    }
    state.log.push({ tick: state.tick, text: p.name + ' FROST NOVA' });
    return;
  }
  const id = String(state.nextNetId++);
  const dmg = Math.round(6 + p.stats.int * 1.4);
  state.projectiles[id] = {
    id, owner: p.id, target: targetId || null, skill: skillId, x: p.x + Math.cos(p.face) * 14, y: p.y + Math.sin(p.face) * 14,
    vx: Math.cos(p.face) * sk.speed, vy: Math.sin(p.face) * sk.speed, life: sk.life, dmg,
  };
}
function damageEnemy(state, e, dmg, by) {
  e.hp -= dmg;
  e.hurt = 0.18;
  e.aggro = 4;
  if (e.hp <= 0 && e.alive) {
    e.alive = false;
    gainXp(state, by, e.xp);
    by.kills++; by.marks += 3 + e.tier * 4;
    if (state.quest.active && !state.quest.turnedIn) state.quest.kills++;
    const dropRoll = rand(state);
    if (dropRoll < 0.15) {
      const id = String(state.nextNetId++);
      state.pickups[id] = { id, kind: 'mana', x: e.x, y: e.y, taken: false };
    } else if (dropRoll < 0.5) {
      const id = String(state.nextNetId++);
      state.pickups[id] = { id, kind: 'herb', x: e.x, y: e.y, taken: false };
    }
  }
}

function spendStat(p, stat) {
  if (!p || p.statPoints <= 0 || !['str', 'dex', 'int'].includes(stat)) return;
  p.stats[stat] = Math.min(999, p.stats[stat] + 1);
  p.statPoints--;
}

function gainXp(state, p, amount) {
  p.xp += amount;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level++;
    p.xpNext = Math.round(20 * Math.pow(p.level, 1.5));
    p.statPoints += 3;
    p.stats.str += 1;
    p.stats.dex += 1;
    p.stats.int += 1;
    p.hpMax += 8; p.mpMax += 4;
    p.hp = p.hpMax; p.mp = p.mpMax;
    state.log.push({ tick: state.tick, text: `LEVEL ${p.level}` });
  }
}

function interact(state, p) {
  for (const npc of state.npcList || []) {
    if (Math.hypot(npc.x - p.x, npc.y - p.y) < 46) {
      p.dialogue = { who: npc.id, name: npc.name };
      return;
    }
  }
  for (const pk of Object.values(state.pickups)) {
    if (pk.taken) continue;
    if (Math.hypot(pk.x - p.x, pk.y - p.y) > 40) continue;
    if (pk.kind === 'herb' || pk.kind === 'mana') { addItem(state, p, pk.kind, 1); pk.taken = true; }
    else if (pk.kind === 'chest') {
      const loot = rand(state) < 0.5 ? 'dagger' : rand(state) < 0.5 ? 'coat' : 'blade';
      addItem(state, p, loot, 1);
      p.marks += 10;
      pk.taken = true;
      state.log.push({ tick: state.tick, text: `FOUND ${ITEMS[loot].name}` });
    }
    return;
  }
}

function forge(state, p, runeId) {
  const weapon = p.equip.weapon && ITEMS[p.equip.weapon];
  const rune = ITEMS[runeId];
  if (!weapon || !rune || rune.kind !== 'rune' || p.runes?.weapon || p.marks < rune.value) return;
  p.marks -= rune.value;
  p.runes = { ...(p.runes || {}), weapon: runeId };
  state.log.push({ tick: state.tick, text: `FORGED ${rune.name}` });
}

/* The trader is the authority on what leaves and enters an account: the client
 * only ever names a row, never a price or a quantity. */
function trade(state, p, cmd) {
  const trader = (state.npcList || []).find((npc) => npc.role === 'trade');
  if (!trader || Math.hypot(trader.x - p.x, trader.y - p.y) >= 60) return;

  if (cmd.mode === 'sell') {
    if (!Number.isInteger(cmd.slot)) return;
    const s = p.inv[cmd.slot];
    const item = s && ITEMS[s.id];
    if (!item || !Number.isFinite(s.qty) || s.qty < 1) return;
    const price = sellOf(s.id);
    if (--s.qty <= 0) p.inv.splice(cmd.slot, 1);
    /* Selling the last copy of what you are wearing must not leave a phantom stat. */
    if (!p.inv.some((q) => q.id === s.id)) {
      for (const key of ['weapon', 'armor']) if (p.equip[key] === s.id) p.equip[key] = null;
    }
    p.marks += price;
    state.log.push({ tick: state.tick, text: `SOLD ${item.name} +${price}` });
    return;
  }

  const id = cmd.item;
  if (!STOCK.includes(id)) return;
  const item = ITEMS[id];
  if (p.marks < item.value) return;
  p.marks -= item.value;
  addItem(state, p, id, 1);
  state.log.push({ tick: state.tick, text: `BOUGHT ${item.name} -${item.value}` });
}

function addItem(state, p, id, qty) {
  const slot = p.inv.find((s) => s.id === id);
  if (slot) slot.qty += qty; else p.inv.push({ id, qty });
  state.log.push({ tick: state.tick, text: `+${qty} ${ITEMS[id].name}` });
}

function useItem(state, p, slot) {
  const s = p.inv[slot];
  if (!s) return;
  const it = ITEMS[s.id];
  if (!it || it.kind !== 'consumable') return;
  if (it.heal) p.hp = Math.min(p.hpMax, p.hp + it.heal);
  if (it.mana) p.mp = Math.min(p.mpMax, p.mp + it.mana);
  s.qty--;
  if (s.qty <= 0) p.inv.splice(slot, 1);
}

function equipItem(state, p, slot) {
  const s = p.inv[slot];
  if (!s) return;
  const it = ITEMS[s.id];
  if (!it || (it.kind !== 'weapon' && it.kind !== 'armor')) return;
  const key = it.kind;
  const prev = p.equip[key];
  p.equip[key] = s.id;
  s.qty--;
  if (s.qty <= 0) p.inv.splice(slot, 1);
  if (prev) addItem(state, p, prev, 1);
}

/* -------------------------------------------------------------------- step -- */

export function stepSim(state, map, dt) {
  state.tick++;
  state.time += dt;

  for (const p of Object.values(state.players)) stepPlayer(state, map, p, dt);
  stepEnemies(state, map, dt);
  stepProjectiles(state, map, dt);

  for (const k of ['log']) if (state[k].length > 6) state[k].splice(0, state[k].length - 6);
}

function stepPlayer(state, map, p, dt) {
  /* Walk away from an NPC and its panel goes with you; the trade checks re-run
   * the same proximity, so a stale panel can never act at range. */
  if (p.dialogue) {
    const npc = (state.npcList || []).find((n) => n.id === p.dialogue.who);
    if (!npc || Math.hypot(npc.x - p.x, npc.y - p.y) > 70) p.dialogue = null;
  }
  p.cds.attack = Math.max(0, p.cds.attack - dt);
  p.cds.cast = Math.max(0, p.cds.cast - dt);
  p.iframes = Math.max(0, p.iframes - dt);
  p.swing = Math.max(0, (p.swing || 0) - dt);
  p.flash = Math.max(0, (p.flash || 0) - dt * 4);

  if (p.dead) {
    p.respawn -= dt;
    if (p.respawn <= 0) {
      p.dead = false; p.hp = p.hpMax; p.mp = p.mpMax;
      spawnPoint(state, map, p);
      state.log.push({ tick: state.tick, text: 'RESTORED' });
    }
    return;
  }

  const spd = 150 + p.stats.dex * 4;
  let dx = p.inx || 0, dy = p.iny || 0;
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  p.vx = dx * spd; p.vy = dy * spd;
  if (m > 0.05) { p.face = Math.atan2(dy, dx); p.anim += dt * 9; }

  moveCircle(state, map, p, p.vx * dt, p.vy * dt);

  p.mp = Math.min(p.mpMax, p.mp + dt * (1 + p.stats.int * 0.12));
  if (p.hp <= 0) { p.dead = true; p.respawn = 2.5; state.log.push({ tick: state.tick, text: 'YOU FELL' }); }
}

// Axis-separated sweep so sliding along walls stays stable at any dt.
function moveCircle(state, map, e, dx, dy) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 8));
  const sx = dx / steps, sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (!blocked(map, e.x + sx, e.y, e.r)) e.x += sx;
    else if (e.vx) e.vx = 0;
    if (!blocked(map, e.x, e.y + sy, e.r)) e.y += sy;
    else if (e.vy) e.vy = 0;
  }
}

function blocked(map, x, y, r) {
  return map.solidAt(x - r, y) || map.solidAt(x + r, y) ||
         map.solidAt(x, y - r) || map.solidAt(x, y + r);
}

function stepEnemies(state, map, dt) {
  const players = Object.values(state.players).filter((p) => !p.dead);
  for (const e of Object.values(state.enemies)) {
    if (!e.alive) continue;
    e.cd = Math.max(0, e.cd - dt);
    e.hurt = Math.max(0, (e.hurt || 0) - dt);
    e.aggro = Math.max(0, e.aggro - dt);

    let target = null, best = 240 * 240;
    for (const p of players) {
      if (inSafeZone(state, map, p.x, p.y)) continue;
      const d2 = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
      if (d2 < best) { best = d2; target = p; }
    }
    let vx = 0, vy = 0;
    if (target) e.aggro = Math.max(e.aggro, 2);
    // Hostile things never cross into the plaza, even when their target does.
    if (!target && inSafeZone(state, map, e.x, e.y)) {
      const a = Math.atan2(e.hy - e.y, e.hx - e.x);
      vx = Math.cos(a) * e.speed; vy = Math.sin(a) * e.speed;
      e.vx = vx; e.vy = vy;
      moveCircle(state, map, e, vx * dt, vy * dt);
      continue;
    }

    if (target) {
      const route = nextPathStep(map, e.x, e.y, target.x, target.y);
      const aimX = route ? route.x : target.x, aimY = route ? route.y : target.y;
      const a = Math.atan2(aimY - e.y, aimX - e.x);
      const d = Math.sqrt(best);
      if (d > e.r + target.r + 6) { vx = Math.cos(a) * e.speed; vy = Math.sin(a) * e.speed; }
      if (d < e.r + target.r + 16 && e.cd <= 0) {
        e.cd = 1.0;
        hurtPlayer(state, map, target, e.dmg);
      }
    } else {
      e.wander += dt * 0.6;
      const home = Math.hypot(e.hx - e.x, e.hy - e.y);
      if (home > 90) { const a = Math.atan2(e.hy - e.y, e.hx - e.x); vx = Math.cos(a) * e.speed * 0.5; vy = Math.sin(a) * e.speed * 0.5; }
      else { vx = Math.cos(e.wander) * e.speed * 0.25; vy = Math.sin(e.wander) * e.speed * 0.25; }
    }
    e.vx = vx; e.vy = vy;
    moveCircle(state, map, e, vx * dt, vy * dt);
  }
}

function hurtPlayer(state, map, p, raw, by) {
  if (p.iframes > 0) return;
  if (inSafeZone(state, map, p.x, p.y)) return;
  if (by && inSafeZone(state, map, by.x, by.y)) return;
  const armor = p.equip.armor ? ITEMS[p.equip.armor].def : 0;
  const dmg = Math.max(1, Math.round(raw - armor - p.stats.dex * 0.3));
  p.hp -= dmg;
  p.iframes = 0.5;
  p.flash = 1;
  if (by) state.log.push({ tick: state.tick, text: `${p.name} HIT BY ${by.name} -${dmg}` });
  if (p.hp <= 0) {
    p.dead = true; p.respawn = 2.5;
    state.log.push({ tick: state.tick, text: by ? `${p.name} FELL TO ${by.name}` : `${p.name} FELL` });
    if (by) { by.kills++; by.marks += 5 + p.level; }
  }
}

function stepProjectiles(state, map, dt) {
  for (const pr of Object.values(state.projectiles)) {
    pr.life -= dt;
    pr.x += pr.vx * dt; pr.y += pr.vy * dt;
    if (pr.life <= 0 || map.solidAt(pr.x, pr.y)) { delete state.projectiles[pr.id]; continue; }
    for (const e of Object.values(state.enemies)) {
      if (!e.alive) continue;
      if (Math.hypot(e.x - pr.x, e.y - pr.y) < e.r + 6) {
        damageEnemy(state, e, pr.dmg, state.players[pr.owner]);
        delete state.projectiles[pr.id];
        break;
      }
    }
    if (!state.projectiles[pr.id]) continue;
    const owner = state.players[pr.owner];
    for (const q of Object.values(state.players)) {
      if (q.id === pr.owner || q.dead) continue;
      if (Math.hypot(q.x - pr.x, q.y - pr.y) < q.r + 6) {
        hurtPlayer(state, map, q, pr.dmg, owner);
        delete state.projectiles[pr.id];
        break;
      }
    }
  }
}

/* ----------------------------------------------------------------- quests -- */

export function acceptQuest(state) {
  if (state.quest.turnedIn || state.quest.active) return;
  state.quest.active = true;
  state.quest.kills = 0;
  state.log.push({ tick: state.tick, text: 'QUEST: THIN FIVE' });
}

export function turnInQuest(state, p) {
  if (!state.quest.active || state.quest.kills < 5 || state.quest.turnedIn) return false;
  state.quest.turnedIn = true;
  gainXp(state, p, 45);
  addItem(state, p, 'ward', 1);
  p.marks += 50;
  state.log.push({ tick: state.tick, text: 'QUEST COMPLETE' });
  return true;
}

/* ------------------------------------------------------------------- save -- */

// npcList is a reference into the deterministic map, not replicated state.
export function serialize(state) {
  const { npcList, ...rest } = state;
  return JSON.stringify(rest);
}

export function deserialize(text) {
  const s = JSON.parse(text);
  s.enemies = s.enemies || {}; s.pickups = s.pickups || {};
  s.projectiles = {}; s.nextNetId = s.nextNetId || 1000;
  return s;
}
