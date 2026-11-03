/* Deterministic shop proof, run against the real sim module (no browser). */
import { generateMap } from '/data/workspace/ascii-block-game/src/world.js';
import { createState, spawnWorld, applyCommand, stepSim, TICK } from '/data/workspace/ascii-block-game/src/sim.js';
import { ITEMS, STOCK, sellOf } from '/data/workspace/ascii-block-game/src/data.js';

const map = generateMap(20261103);
const fails = [];
const check = (name, got, want) => {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  if (!ok) fails.push(name);
};

const trader = map.npcs.find((n) => n.role === 'trade');
if (!trader) { console.log('FAIL no trader npc in the map'); process.exit(1); }

function fresh() {
  const s = createState(20261103, ['ALICE']);
  s.npcList = map.npcs;
  spawnWorld(s, map);
  for (const e of Object.values(s.enemies)) e.alive = false;
  const p = Object.values(s.players)[0];
  p.x = trader.x + 20; p.y = trader.y;
  p.marks = 100; p.inv = [];
  return { s, p };
}

const cmd = (s, p, c) => applyCommand(s, s.tick, Object.keys(s.players).find((k) => s.players[k] === p), c, map);

// 1. The whole shelf is buyable and prices are the host's, not the caller's.
{
  const { s, p } = fresh();
  for (const id of STOCK) {
    p.marks = ITEMS[id].value;
    cmd(s, p, { t: 'trade', mode: 'buy', item: id });
  }
  check('every stock row bought', p.inv.length, STOCK.length);
  check('marks spent to zero', p.marks, 0);
}

// 2. A price sent by the client is ignored; only the named row matters.
{
  const { s, p } = fresh();
  cmd(s, p, { t: 'trade', mode: 'buy', item: 'blade', price: 1 });
  check('cannot buy GLYPH BLADE with 100 marks once', p.marks, 40);
  check('got the blade', p.inv.filter((i) => i.id === 'blade').length, 1);
}

// 3. Not enough marks, unknown id, and far away are all no-ops.
{
  const { s, p } = fresh();
  p.marks = 5;
  cmd(s, p, { t: 'trade', mode: 'buy', item: 'blade' });
  check('broke player buys nothing', p.marks, 5);
  cmd(s, p, { t: 'trade', mode: 'buy', item: 'herobrine' });
  check('unknown id rejected', p.inv.length, 0);
  p.marks = 1000;
  p.x = trader.x + 500;
  cmd(s, p, { t: 'trade', mode: 'buy', item: 'dagger' });
  check('out of reach rejected', p.marks, 1000);
}

// 4. Selling pays half, decrements, and drops the slot when the last one goes.
{
  const { s, p } = fresh();
  p.inv = [{ id: 'blade', qty: 2 }];
  cmd(s, p, { t: 'trade', mode: 'sell', slot: 0 });
  check('half back on first sale', p.marks, 100 + sellOf('blade'));
  check('one blade left', p.inv[0].qty, 1);
  cmd(s, p, { t: 'trade', mode: 'sell', slot: 0 });
  check('slot spliced', p.inv.length, 0);
  check('half back on last copy', p.marks, 100 + 2 * sellOf('blade'));
}

// 5. Selling the equipped item must not leave a phantom weapon.
{
  const { s, p } = fresh();
  p.inv = [{ id: 'dagger', qty: 1 }];
  p.equip.weapon = 'dagger';
  cmd(s, p, { t: 'trade', mode: 'sell', slot: 0 });
  check('equipped weapon unequipped', p.equip.weapon, null);
}

// 6. Hostile slot values cannot move marks or throw.
{
  const { s, p } = fresh();
  p.inv = [{ id: 'herb', qty: 3 }];
  for (const slot of [-1, 99, 'abc', {}, null, undefined, '0']) {
    cmd(s, p, { t: 'trade', mode: 'sell', slot });
  }
  check('hostile slots changed nothing', p.marks, 100);
  check('inventory intact', p.inv.length, 1);
  cmd(s, p, { t: 'trade', mode: 'sell' });
  cmd(s, p, { t: 'trade', mode: 'SELL', slot: 0 });
  check('case-sensitive mode rejected', p.marks, 100);
}

// 7. The sim keeps ticking through a shop-heavy frame.
{
  const { s, p } = fresh();
  for (let i = 0; i < 60; i++) cmd(s, p, { t: 'trade', mode: 'buy', item: 'herb' });
  const before = s.tick;
  for (let i = 0; i < 60; i++) stepSim(s, map, TICK);
  check('ticks advanced', s.tick, before + 60);
  check('bought until broke', p.marks < ITEMS.herb.value, true);
}

// 8. Dialogue is per player, cannot be named by the client, and dies when you walk off.
{
  const s = createState(20261103, ['ALICE', 'BOB']);
  s.npcList = map.npcs;
  spawnWorld(s, map);
  for (const e of Object.values(s.enemies)) e.alive = false;
  const [alice, bob] = Object.values(s.players);
  alice.x = trader.x + 20; alice.y = trader.y;
  bob.x = trader.x + 400; bob.y = trader.y;
  const ids = Object.keys(s.players);

  applyCommand(s, s.tick, ids[0], { t: 'interact' }, map);
  check('interact opens the trader panel', alice.dialogue && alice.dialogue.who, 'trader');
  check('the other player keeps no panel', bob.dialogue, null);
  check('nothing global was written', s.dialogue, undefined);

  /* This is what used to be possible: name any NPC and any caption, and the host
   * stored it for everyone. */
  applyCommand(s, s.tick, ids[1], { t: 'dialogue', payload: { who: 'trader', name: 'HACKED' } }, map);
  check('client can no longer set a dialogue', bob.dialogue, null);

  alice.x = trader.x + 300;
  for (let i = 0; i < 30; i++) stepSim(s, map, TICK);
  check('panel closes on walk-away', alice.dialogue, null);

  alice.marks = 500;
  applyCommand(s, s.tick, ids[0], { t: 'trade', mode: 'buy', item: 'blade' }, map);
  check('remote buy after closing refused', alice.marks, 500);
}

console.log(fails.length ? `FAILURES: ${fails.join(', ')}` : 'ALL SHOP CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
