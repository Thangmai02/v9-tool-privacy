/**
 * Railway low-cost mode: run HTTPS-terminated web/API and queue worker in one service.
 *
 * Use one replica for this mode. To scale to several independent processes later,
 * switch back to the dedicated API/worker commands in compose.yaml.
 * The database remains a separate persistent PostgreSQL service.
 */
import { loadConfig } from './config.js';
import { makeDatabase } from './db.js';
import { migrate } from './migrate.js';
import { buildApp } from './app.js';
import { startWorker } from './worker.js';

const config = loadConfig();
const db = makeDatabase(config.DATABASE_URL, Math.max(12, config.WORKER_CONCURRENCY + 8));
const controller = new AbortController();
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let workerTask: Promise<void> | undefined;
let stopping = false;

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  controller.abort();
  try {
    if (app) await app.close();
  } catch {
    process.exitCode = 1;
    console.error('V9 HTTP server could not shut down cleanly.');
  }
  try {
    if (workerTask) await workerTask;
  } catch {
    process.exitCode = 1;
    console.error('V9 background worker failed during shutdown.');
  }
  try {
    await db.end?.();
  } catch {
    process.exitCode = 1;
    console.error('V9 database pool could not shut down cleanly.');
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => { void shutdown(); });
}

try {
  // Startup migration is serialized by a PostgreSQL advisory lock. This lets
  // new Railway users deploy from GitHub without a separate migration service.
  await migrate(db);
  app = await buildApp({ config, db });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  console.log('V9 Page Studio listening on port ' + config.PORT + '.');
  workerTask = startWorker(db, config, controller.signal).then(
    () => {
      if (!stopping) {
        process.exitCode = 1;
        console.error('V9 worker stopped unexpectedly. Stopping service to prevent silent schedule failures.');
        void shutdown();
      }
    },
    () => {
      if (!stopping) {
        process.exitCode = 1;
        console.error('V9 worker failed unexpectedly. Stopping service to prevent silent schedule failures.');
        void shutdown();
      }
    }
  );
  console.log('V9 queue worker started (' + config.WORKER_CONCURRENCY + ' slots).');
} catch {
  process.exitCode = 1;
  console.error('V9 Page Studio startup failed. Check required environment variables and the PostgreSQL connection.');
  await shutdown();
}
