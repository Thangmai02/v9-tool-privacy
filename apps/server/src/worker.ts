import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadConfig, type Config } from './config.js';
import { makeDatabase, type Database } from './db.js';
import { MetaClient } from './meta.js';
import { recoverStaleJobs, runOneJob } from './queue.js';
import { pruneWorkerHeartbeats, recordWorkerHeartbeat, removeWorkerHeartbeat, WORKER_HEARTBEAT_SECONDS } from './runtime.js';

async function maintenanceLoop(intervalMs: number, signal: AbortSignal, action: () => Promise<void>, failureMessage: string): Promise<void> {
  while (!signal.aborted) {
    try { await delay(intervalMs, undefined, { signal }); }
    catch { if (signal.aborted) return; throw new Error('Worker maintenance timer failed.'); }
    if (signal.aborted) return;
    // Await the operation before scheduling another tick: slow DB calls never overlap.
    try { await action(); }
    catch { console.error(failureMessage); }
  }
}

export async function startWorker(db: Database, config: Config, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  const meta = new MetaClient(config);
  await recoverStaleJobs(db);
  const workerId = randomUUID();
  await recordWorkerHeartbeat(db, workerId, config.WORKER_CONCURRENCY);
  const maintenance = new AbortController();
  const heartbeat = maintenanceLoop(WORKER_HEARTBEAT_SECONDS * 1000, maintenance.signal,
    () => recordWorkerHeartbeat(db, workerId, config.WORKER_CONCURRENCY), 'Worker heartbeat failed; readiness will expire automatically.');
  const recovery = maintenanceLoop(60_000, maintenance.signal, async () => {
    await recoverStaleJobs(db); await pruneWorkerHeartbeats(db);
  }, 'Worker recovery check failed.');
  try {
    try { await pruneWorkerHeartbeats(db); } catch { console.error('Worker heartbeat cleanup failed.'); }
    const loops = Array.from({ length: config.WORKER_CONCURRENCY }, async () => {
      while (!signal.aborted) {
        try { const worked = await runOneJob(db, config, meta); if (!worked) await delay(1500, undefined, { signal }); }
        catch { if (!signal.aborted) { console.error('Worker iteration failed; mutation outcomes are retained for review.'); await delay(3000, undefined, { signal }).catch(() => {}); } }
      }
    });
    await Promise.all(loops);
  } finally {
    // Keep heartbeat during in-flight work, then stop and await maintenance before
    // deleting its row or allowing the caller to close the database pool.
    maintenance.abort();
    await Promise.allSettled([heartbeat, recovery]);
    try { await removeWorkerHeartbeat(db, workerId); }
    catch { console.error('Worker shutdown heartbeat cleanup failed; readiness will expire automatically.'); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig(); const db = makeDatabase(config.DATABASE_URL, config.WORKER_CONCURRENCY + 4);
  const controller = new AbortController();
  process.on('SIGTERM', () => controller.abort()); process.on('SIGINT', () => controller.abort());
  try { console.log(`V9 worker started with ${config.WORKER_CONCURRENCY} slots.`); await startWorker(db, config, controller.signal); }
  finally { await db.end?.(); }
}
