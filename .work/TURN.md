# Autonomous turn — GLYPH FALL MMO

Nobody is at the keyboard for this: work the backlog top to bottom, one item per
turn, never stop to ask. The owner asked for 10 hours of continuous work on the
game and will read this file when back.

## Live state

- Public URL (works while the sandbox runs): `https://8780-agqx7v5fts6bl556lqplpfm4ba.instabox.tech`
- Host: `node server.mjs` on `:8780`, seed 20261103, 60 Hz sim / 15 Hz snapshots.
- Start/restart (never `pkill -f`, it matches your own shell command and kills it):
  `ss -ltnp | grep :8780` for the pid, `kill <pid>`, then
  `cd /data/workspace/ascii-block-game && setsid nohup node server.mjs > /tmp/cmp/host.log 2>&1 < /dev/null &`
  The host must be restarted after any change to `server.mjs` or `src/sim.js`.
  Client files are served with `cache-control: no-cache`, so no restart for those.
- Push: `eval "$(cofre.py GITHUB_TOKEN_WRITE --export)" && git -c credential.helper='!f(){ echo username=x-access-token; echo password=$GITHUB_TOKEN_WRITE; };f' push origin HEAD`
  Set `user.name`/`user.email` per-repo; there is no global git identity here.

## How to verify a change (do this every turn, before committing)

- Two clients over the public URL, desktop + mobile viewport:
  `cd /tmp/cmp && GAME_URL=https://8780-agqx7v5fts6bl556lqplpfm4ba.instabox.tech/ timeout 220 node mmo2.js`
  Assert: 60 fps on both, `2 online`, no `errs`, positions agree.
- Clean look capture (panel hidden): `GAME_URL=... node /tmp/cmp/look.js` → `look_desk.png`, `look_mob.png`.
- PvP: `GAME_URL=... timeout 250 node /tmp/cmp/pvp.js` → expect `HIT BY` in the log and HP dropping.
- Reference to compare against: `/tmp/cmp/ar_rain.png` (the @ascii.realms reel frame).
  The look is right when: near-black ground, faint dash texture, figures as bright
  stacked dashes, rain as thin faint diagonal dashes, sparks cyan.
- Never trust a code path as proof. Only report what a run printed.

## Backlog — one item per turn, commit each with the evidence you got

1. DONE: Host survives a crash: wrap the tick in try/catch, add a supervisor that
   restarts `server.mjs` on exit, and log the last snapshot error to host.log.
2. DONE: Server-side persistence: save players by name (level, xp, marks, stats, inv,
   equip, position) to disk every 30 s and on leave, reload on join. The current
   client-side save is worthless in an MMO.
3. Safe zone: no damage inside the spawn radius; show it as a ring of `†` glyphs.
4. Vendor NPC + shop: gold from kills, a stock list, buy/sell through the `e`
   command, panel list on desktop and a tap-to-buy row on mobile.
5. Quest chain: 3 steps (kill N, collect M, talk to X) with per-step objectives in
   the HUD; the current single quest is a placeholder.
6. Enemy AI that fights back properly: aggro radius, pursuit, ranged attackers that
   keep distance, despawn/respawn waves per region.
7. A boss: 3 phases, telegraphed AoE, a name bar at the top of the screen, drops.
8. Skills: spark exists; add heal and frost nova, each with mp cost + cooldown and
   a keybind (`l` cycles, `2`/`3` direct) and mobile buttons.
9. Level-up: stat points on level, auto-spend with a visible choice in the panel.
10. Weather variety: rain exists; add fog (reduced draw distance) and storm
    (lightning flash + louder sparks), all derived from world time like rain.
11. Day/night tint cycle over a few minutes, subtle, so the scene is not static.
12. Audio: WebAudio blips for hit, level, chat, rain loop. No asset files.
13. Mobile: minimap in the top-right, auto-attack nearest when ATK is held,
    landscape layout, bigger touch targets.
14. Chat channels: `say` within a radius (already partly there) and `#global`,
    plus a name colour by level.
15. Perf: dirty-cell redraw so a static screen costs almost nothing; measure with
    the fps line before and after.
16. Zone variety: a second region with different tiles and enemies, a gate between.
17. Ranking: `/rank` shows top kills; a small leaderboard strip in the HUD.
18. Onboarding: a first-run overlay on mobile with the controls, gone after a move.

## Rules for this turn

- Keep the reference look. Any content added must be drawn with the same
  bar-stack/dash vocabulary, and must be checked in a screenshot.
- No new dependencies without a reason the repo cannot already solve.
- Commit after each item with what you measured. If an item regresses fps or
  breaks the two-client test, revert it and note why in the log below.
- Append one line per finished item to `## Log` with the evidence.

## Log

- weather: deterministic cycle now includes fog and storm phases; desktop and mobile captures remained at 60 fps.

- safe-zone: live two-client test kept both players at 60/60 hp inside the plaza, then resumed damage outside at 264px from spawn.
- renderer: replaced correlated grain hash; desktop/mobile captures stayed at 60 fps and the diagonal noise artifact disappeared.
- skills: heal restored 29 hp for 10 MP; frost nova dealt 22 damage to a nearby wraith for 14 MP; MMO regression had no client errors.

- persist: `saves.json` on the host, keyed by name; written on leave, every 30 s
  while online, and on SIGTERM. Verified with `/tmp/cmp/persist.js`: used a herb
  (qty 2→1), reconnected under a new id (56→57) and got qty 1 back with
  `PERSIST RETURNED LV1`. Fields are validated on load, so a hand-edited save
  cannot put an avatar inside a wall or at NaN.
- regression caught by the test, not by me: my import shuffle dropped `stat` from
  `node:fs/promises`, so the whole site served "not found" while `/health` stayed
  green. Fixed. A green health endpoint is not proof the game loads.
- fuzz: `use`/`equip` of an unknown item id threw inside the tick; both guarded.
- host: `host.mjs` supervises `server.mjs` (backoff restart, gives up after 8 fast
  crashes) and holds `/tmp/glyphfall-host.lock`, so only one supervisor owns :8780.
  Verified: killing the host → health returns in ~3 s; a second supervisor stands
  down with "host already running as <pid>".
- fuzz: `/tmp/cmp/crash.js` sends hostile cmds, a 5000-char chat, binary and junk
  frames. The host kept ticking (419 ticks across the run) and the socket stayed
  open. It exposed two real bugs, now fixed: `move` with a non-numeric dx left the
  avatar at NaN forever (`unit()` rejects non-finite), and `equip` of an unknown
  item id threw inside the tick (guarded). 0 tick failures after the fix.
- resync: host snapshot now carries `me.x/y`; the local avatar follows the
  authority again (client 2285,1921 vs host 2322,1940 while moving).
- pvp: verified over the public URL — `PREY HIT BY HUNTER -9`, 60→15 hp.
- spawn: players no longer stack on one pixel (`spawnPoint` ring by id), which is
  what made melee unable to aim.
- look: `NIGHT 0.2`, cool ground mix, faint rain, figure rows snapped to the text
  grid so every row lights (mobile figure went from 3 dim cells to a full stack).

- audio: procedural hit, level-up, heal, frost and rain cues added in 8dd069f; desktop/mobile captures remained at 60 fps, /health and /rank stayed healthy.

- mobile-combat: holding ATTACK now retargets and queues strikes every 180ms; mmo2 regression stayed at 60 fps with 0 client errors (fccf148).
