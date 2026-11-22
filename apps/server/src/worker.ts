import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig, type Config } from './config.js';
import { makeDatabase, type Database } from './db.js';
import { MetaClient } from './meta.js';
import { recoverStaleJobs, runOneJob } from './queue.js';

export async function startWorker(db: Database, config: Config, signal: AbortSignal): Promise<void> {
  const meta = new MetaClient(config);
  await recoverStaleJobs(db);
  const recovery = setInterval(() => { void recoverStaleJobs(db).catch(() => console.error('Worker recovery check failed.')); }, 60_000);
  recovery.unref();
  const loops = Array.from({ length: config.WORKER_CONCURRENCY }, async () => {
    while (!signal.aborted) {
      try { const worked = await runOneJob(db, config, meta); if (!worked) await delay(1500, undefined, { signal }); }
      catch { if (!signal.aborted) { console.error('Worker iteration failed; mutation outcomes are retained for review.'); await delay(3000, undefined, { signal }).catch(() => {}); } }
    }
  });
  try { await Promise.all(loops); } finally { clearInterval(recovery); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig(); const db = makeDatabase(config.DATABASE_URL, config.WORKER_CONCURRENCY + 4);
  const controller = new AbortController();
  process.on('SIGTERM', () => controller.abort()); process.on('SIGINT', () => controller.abort());
  try { console.log(`V9 worker started with ${config.WORKER_CONCURRENCY} slots.`); await startWorker(db, config, controller.signal); }
  finally { await db.end?.(); }
}
