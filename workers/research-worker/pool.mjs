#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
const count = Number(process.env.WORKER_PROCESSES || 1);
if (!Number.isInteger(count) || count < 1 || count > 16) throw new Error('WORKER_PROCESSES must be an integer from 1 to 16');
const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url));
const children = new Map();
let stopping = false;
function launch(slot) {
  if (stopping) return;
  const identity = `${process.env.WORKER_MACHINE_ID || hostname()}-${slot}`;
  const child = spawn(process.execPath, [worker], { stdio: 'inherit', env: { ...process.env, WORKER_INSTANCE_ID: identity } });
  children.set(slot, child);
  child.on('exit', () => { children.delete(slot); if (!stopping) setTimeout(() => launch(slot), 5000); });
}
for (let slot = 0; slot < count; slot++) launch(slot);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) child.kill(signal);
  // Bound shutdown if a browser or network process cannot finish.
  const timer = setTimeout(() => { for (const child of children.values()) child.kill('SIGKILL'); }, 240_000);
  timer.unref();
});
