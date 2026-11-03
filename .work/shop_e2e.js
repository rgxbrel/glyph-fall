/* End-to-end shop over the public URL: walk to the trader, open the panel with E,
 * move the cursor, buy with B, sell with B on a SELL row, then tap a row on a
 * mobile viewport. Reports host marks and bag size at each step. */
const puppeteer = require('/tmp/pup/node_modules/puppeteer-core');
const URL = (process.env.GAME_URL || 'https://8780-agqx7v5fts6bl556lqplpfm4ba.instabox.tech/');

const open = async (name, w, h, mobile, dir) => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--user-data-dir=' + dir],
  });
  const p = await browser.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
  await p.setViewport({ width: w, height: h, isMobile: !!mobile, hasTouch: !!mobile, deviceScaleFactor: mobile ? 2 : 1 });
  await p.goto(URL + '?name=' + name, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 5000));
  return { p, errs, browser };
};

const read = (p) => p.evaluate(() => {
  const g = window.__game, me = g.state.players[g.state.local] || {};
  return {
    dialogue: me.dialogue || null, marks: me.marks, inv: (me.inv || []).map((i) => i.id + 'x' + i.qty),
    d: Math.round(Math.hypot(me.x - g.map.npcs[1].x, me.y - g.map.npcs[1].y)),
    sel: g.ui.shopSel, lines: g.ui.dialogueLines(g.state).length,
    canTap: !!g.ui.dialogueBox && g.ui.shopLineStart,
  };
});

/* Walks with real key input until the avatar is inside the trader's panel range. */
const walkToTrader = async (p) => {
  for (let i = 0; i < 120; i++) {
    const s = await read(p);
    if (s.d < 18) return s;
    const g = await p.evaluate(() => {
      const st = window.__game, me = st.state.players[st.state.local];
      const t = st.map.npcs[1];
      return { dx: Math.sign(t.x - me.x), dy: Math.sign(t.y - me.y) };
    });
    const key = g.dx > 0 ? 'd' : g.dx < 0 ? 'a' : g.dy > 0 ? 's' : 'w';
    await p.keyboard.down(key);
    await new Promise((r) => setTimeout(r, 260));
    await p.keyboard.up(key);
  }
  return read(p);
};

(async () => {
  try { require('child_process').execSync(
    'ps -eo pid,args | grep "[u]ser-data-dir=/tmp/cmp/s" | awk \'{print $1}\' | xargs -r kill',
    { stdio: 'ignore' }); } catch {}

  const out = {};
  const { p, errs, browser } = await open(process.env.SHOP_NAME || 'SHOPR', 1200, 760, false, '/tmp/cmp/sA');
  out.start = await read(p);
  out.walked = await walkToTrader(p);
  await p.keyboard.press('e');
  await new Promise((r) => setTimeout(r, 700));
  out.panel = await read(p);

  /* No invented wealth: the bag starts with two HERB, selling pays 2 each, and the
   * shelf sells HERB at 4 — so two SELL rows then the HERB BUY row prove both
   * directions with nothing handed out. */
  const goto = async (target) => {
    for (let i = 0; i < 30; i++) {
      const s = await read(p);
      if (s.sel === target) return s;
      await p.keyboard.press('.');
      await new Promise((r) => setTimeout(r, 100));
    }
    return read(p);
  };
  out.at_sell1 = await goto(8);
  await p.keyboard.press('b');
  await new Promise((r) => setTimeout(r, 800));
  out.after_sell1 = await read(p);

  out.at_sell2 = await goto(8);
  await p.keyboard.press('b');
  await new Promise((r) => setTimeout(r, 800));
  out.after_sell2 = await read(p);

  out.at_buy = await goto(4);
  await p.keyboard.press('b');
  await new Promise((r) => setTimeout(r, 800));
  out.after_buy = await read(p);

  // A second client must not see this one's panel.
  const other = await open('GHOST', 1200, 760, false, '/tmp/cmp/sB');
  out.peer_dialogue = (await read(other.p)).dialogue;

  await browser.close(); await other.browser.close();

  const mob = await open(process.env.MOB_NAME || 'MOBTA', 420, 780, true, '/tmp/cmp/sC');
  out.mob_walked = await walkToTrader(mob.p);
  await mob.p.keyboard.press('e');
  await new Promise((r) => setTimeout(r, 700));
  const before = await read(mob.p);
  await walkToTrader(mob.p);
  await mob.p.keyboard.press('e');
  await new Promise((r) => setTimeout(r, 700));
  const tap = await mob.p.evaluate(() => {
    const g = window.__game, db = g.ui.dialogueBox;
    const cv = document.getElementById('out'), box = cv.getBoundingClientRect();
    const rowY = db.top + (g.ui.shopLineStart + 8) * db.rowH - db.rowH * 0.25;
    const y = Math.max(box.top + 2, Math.min(box.top + box.height - 4, box.top + box.height * (rowY / g.pass.H)));
    return {
      x: box.left + box.width * 0.5, y,
      line: g.ui.shopLineStart + 8, rowY, passH: g.pass.H,
      box: { top: Math.round(box.top), h: Math.round(box.height), w: Math.round(box.width) },
    };
  });
  await mob.p.mouse.click(tap.x, tap.y);
  await new Promise((r) => setTimeout(r, 700));
  out.mob_before = before;
  out.mob_tap = tap;
  out.mob_after_tap = await read(mob.p);
  out.mob_errs = mob.errs;
  await mob.browser.close();

  out.errs = errs.concat(mob.errs);
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
