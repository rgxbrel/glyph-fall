/* Keeps server.mjs up: restarts it on any exit and records why. World state is
 * rebuilt from the seed, so a restart costs a walk back, not a character. */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

/* Two supervisors on one port crash-loop each other, so only one may own it. */
const LOCK = '/tmp/glyphfall-host.lock';
try {
  const prev = Number(readFileSync(LOCK, 'utf8'));
  if (prev && prev !== process.pid) {
    process.kill(prev, 0);
    console.error(`[supervisor] host already running as ${prev}, standing down`);
    process.exit(0);
  }
} catch { /* no lock, or its owner is gone: take over */ }
writeFileSync(LOCK, String(process.pid));
process.on('exit', () => { try { unlinkSync(LOCK); } catch { /* already gone */ } });

let child = null;
let restarts = 0;
let lastStart = 0;

function start() {
  lastStart = Date.now();
  child = spawn(process.execPath, ['server.mjs'], { stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    console.error(`[supervisor] host exited code=${code} signal=${signal}`);
    const quick = Date.now() - lastStart < 5000;
    if (quick) restarts++;
    else restarts = 0;
    if (restarts > 8) {
      console.error('[supervisor] 8 crashes in a row, giving up');
      process.exit(1);
    }
    const wait = Math.min(15000, 500 * 2 ** restarts);
    console.error(`[supervisor] restart in ${wait} ms`);
    setTimeout(start, wait);
  });
}

process.on('SIGTERM', () => { if (child) child.kill('SIGTERM'); });
process.on('SIGINT', () => { if (child) child.kill('SIGINT'); });
start();
