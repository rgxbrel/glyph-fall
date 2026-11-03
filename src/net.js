/* Networked client for GLYPH FALL. The browser keeps a mirror of the server
 * world (same seed -> same ids), predicts only its own avatar and lerps
 * everything else. Offline play never touches this module. */

import { TILE } from './world.js';
import { TICK } from './sim.js';

const L = {
  players: ['x', 'y', 'face', 'hp', 'hpMax', 'mp', 'mpMax', 'level', 'name', 'dead', 'kills', 'marks'],
  enemies: ['x', 'y', 'hp', 'alive', 'kind'],
  pickups: ['x', 'y', 'taken', 'kind'],
  projectiles: ['x', 'y', 'owner', 'skill'],
};

const rows = (obj, keys) => {
  const out = {};
  for (const id of Object.keys(obj)) out[id] = rowToObj(obj[id], keys);
  return out;
};
const rowToObj = (row, keys) => {
  const o = {};
  keys.forEach((k, i) => { o[k] = row[i]; });
  return o;
};

export class Net {
  constructor({ state, map, name, url, onLog }) {
    this.state = state; this.map = map; this.name = name;
    this.onLog = onLog || (() => {});
    this.url = url;
    this.me = null;
    this.online = 1;
    this.chats = [];
    this.seenChat = new Set();
    this.connected = false;
    this.stopped = false;
    this.algo = 0;
    this.retry = 0;
    this.connect();
  }

  wsUrl() {
    if (this.url) return this.url;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  connect() {
    if (this.stopped) return;
    try { this.ws = new WebSocket(this.wsUrl()); } catch (e) { this.backoff(); return; }
    this.ws.onopen = () => { this.connected = true; this.retry = 0; this.send({ ty: 'join', name: this.name }); };
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.ty === 'hello') this.onHello(m);
      else if (m.ty === 'snap') this.onSnap(m);
    };
    this.ws.onclose = () => { this.connected = false; if (!this.stopped) this.backoff(); };
    this.ws.onerror = () => { try { this.ws.close(); } catch { /* already down */ } };
  }

  backoff() {
    if (this.stopped) return;
    this.retry = Math.min(20, (this.retry || 0) + 1);
    setTimeout(() => this.connect(), 500 * Math.min(8, this.retry));
  }

  dispose() {
    this.stopped = true;
    this.connected = false;
    try { this.ws?.close(); } catch { /* already closed */ }
  }

  send(m) { if (!this.stopped && this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  sendCmd(cmd) { this.send({ ty: 'cmd', cmd }); }
  chat(text) { if (text.trim()) this.send({ ty: 'chat', text: text.slice(0, 120) }); }

  onHello(m) {
    this.st = m; this.meId = m.id;
    const p = {
      id: m.id, name: m.id ? 'YOU' : 'YOU', x: this.map.spawn.x, y: this.map.spawn.y,
      vx: 0, vy: 0, r: 12, face: 0, anim: 0, inx: 0, iny: 0,
      hp: 60, hpMax: 60, mp: 30, mpMax: 30, level: 1, xp: 0, xpNext: 20, statPoints: 0, marks: 0,
      stats: { str: 5, dex: 5, int: 5 }, inv: [{ id: 'herb', qty: 2 }],
      equip: { weapon: null, armor: null }, cds: { attack: 0, cast: 0 },
      iframes: 0, dead: false, respawn: 0, kills: 0, local: true,
    };
    this.state.players = {};
    this.state.players[m.id] = p;
    this.state.local = m.id;
    this.state.meName = m.name;
    p.name = m.name || this.name;
    this.me = p;
    this.onLog('CONNECTED');
    if (this.me) { /* name arrives on the first snapshot */ }
  }

  onSnap(m) {
    const st = this.state;
    st.tick = m.tick; st.time = m.time; st.online = m.online;
    st.quest = m.quest;
    this.online = m.online;

    /* --- remote players: keep our own, replace the rest --- */
    const peers = rows(m.players, L.players);
    for (const id of Object.keys(st.players)) {
      if (id === st.local) continue;
      if (!peers[id]) delete st.players[id];
    }
    for (const id of Object.keys(peers)) {
      if (id === st.local) continue;
      const src = peers[id];
      const p = st.players[id] || (st.players[id] = { id, x: src.x, y: src.y, r: 12, anim: 0, stats: {}, inv: [], equip: {}, cds: {} });
      p.name = src.name; p.face = src.face; p.hp = src.hp; p.hpMax = src.hpMax;
      p.level = src.level; p.dead = src.dead; p.kills = src.kills; p.marks = src.marks;
      p.tx = src.x; p.ty = src.y;
      if (p.px === undefined) { p.px = src.x; p.py = src.y; }
      p.nt = 0;
    }

    /* --- my own avatar: trust server stats, keep predicted position --- */
    const mine = st.players[st.local];
    if (mine && m.me) {
      for (const k of ['hp', 'hpMax', 'mp', 'mpMax', 'level', 'xp', 'xpNext', 'statPoints', 'marks', 'kills', 'dead', 'face']) mine[k] = m.me[k];
      mine.stats = m.me.stats; mine.inv = m.me.inv; mine.equip = m.me.equip; mine.runes = m.me.runes || null;
      mine.dialogue = m.me.dialogue || null;
      const err = Math.hypot(mine.x - m.me.x, mine.y - m.me.y);
      if (err > 34 || mine.dead) { mine.x = m.me.x; mine.y = m.me.y; }
      else if (err > 2) { mine.x += (m.me.x - mine.x) * 0.22; mine.y += (m.me.y - mine.y) * 0.22; }
      mine.mp = m.me.mp;
    }

    /* --- world entities --- */
    const upd = (dict, src, keys, alive) => {
      for (const id of Object.keys(dict)) {
        if (id === st.local) continue;
        if (!src[id]) { if (!alive(id, dict[id])) delete dict[id]; }
      }
      for (const id of Object.keys(src)) {
        const s = rowToObj(src[id], keys);
        const e = dict[id];
        if (!e) continue; // ids come from the same seeded spawn, so unknown ids are ignored
        if (e.px === undefined) { e.px = e.x; e.py = e.y; }
        e.tx = s.x; e.ty = s.y; e.nt = 0;
        for (const k of keys) if (k !== 'x' && k !== 'y') e[k] = s[k];
      }
    };
    upd(st.enemies, m.enemies, L.enemies, () => true);
    upd(st.pickups, m.pickups, L.pickups, () => true);
    upd(st.projectiles, m.projectiles, L.projectiles, () => false);
    for (const id of Object.keys(m.projectiles)) {
      if (st.projectiles[id]) continue;
      const s = rowToObj(m.projectiles[id], L.projectiles);
      const owner = st.players[s.owner] || st.players[st.local];
      const ang = owner ? owner.face : 0;
      st.projectiles[id] = {
        id, owner: s.owner, skill: s.skill, x: s.x, y: s.y, px: s.x, py: s.y, tx: s.x, ty: s.y, nt: 0,
        vx: Math.cos(ang) * 260, vy: Math.sin(ang) * 260, life: 1, dmg: 0,
      };
    }

    for (const l of m.log || []) {
      const key = l.tick + '|' + l.text;
      if (this.seenLog?.has(key)) continue;
      (this.seenLog ||= new Set()).add(key);
      if (this.seenLog.size > 400) this.seenLog.clear();
      if (!st.log.some((x) => x.tick === l.tick && x.text === l.text)) st.log.push(l);
    }
    if (!st.chatFeed) st.chatFeed = [];
    const seen = this.seenChat;
    for (const c of m.chat || []) {
      if (seen.has(c.seq)) continue;
      seen.add(c.seq);
      const entry = { name: c.name, text: c.text, t: st.time };
      st.chatFeed.push(entry);
      const speaker = Object.values(st.players).find((q) => q.name === c.name);
      if (speaker) speaker.say = entry;
      if (st.chatFeed.length > 40) st.chatFeed.shift();
    }
  }

  /* Advance interpolation and local prediction. dt in seconds. */
  apply(dt, dx, dy) {
    const st = this.state;
    const k = Math.min(1, dt * 12);
    const smooth = (o) => {
      if (o.tx === undefined) return;
      o.x += (o.tx - o.x) * k;
      o.y += (o.ty - o.y) * k;
    };
    for (const id of Object.keys(st.players)) if (id !== st.local) smooth(st.players[id]);
    for (const e of Object.values(st.enemies)) smooth(e);
    for (const e of Object.values(st.projectiles)) smooth(e);

    const mine = st.players[st.local];
    if (mine && !mine.dead) {
      mine.inx = dx; mine.iny = dy;
      if (dx || dy) {
        const sp = 150 + (mine.stats ? mine.stats.dex : 5) * 4;
        const n = Math.hypot(dx, dy) || 1;
        this.predict(mine, (dx / n) * sp * dt, (dy / n) * sp * dt);
        mine.face = Math.atan2(dy, dx);
        mine.anim += dt * 9;
      }
      mine.cds.attack = Math.max(0, (mine.cds.attack || 0) - dt);
      mine.cds.cast = Math.max(0, (mine.cds.cast || 0) - dt);
      mine.swing = Math.max(0, (mine.swing || 0) - dt);
    }
    st.time += dt;
  }

  predict(p, mx, my) {
    const map = this.map, r = p.r;
    const blocked = (x, y) => map.solidAt(x - r, y) || map.solidAt(x + r, y) ||
      map.solidAt(x, y - r) || map.solidAt(x, y + r);
    if (!blocked(p.x + mx, p.y)) p.x += mx;
    if (!blocked(p.x, p.y + my)) p.y += my;
    p.x = Math.max(r, Math.min(map.w * TILE - r, p.x));
    p.y = Math.max(r, Math.min(map.h * TILE - r, p.y));
  }
}
