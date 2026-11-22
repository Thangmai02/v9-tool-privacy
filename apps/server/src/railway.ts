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
let startupTask: Promise<void>;
let shutdownTask: Promise<void> | undefined;
let stopping = false;

function shutdown(): Promise<void> {
  if (shutdownTask) return shutdownTask;
  stopping = true;
  controller.abort();
  shutdownTask = (async () => {
    // Startup may still be migrating or constructing the HTTP server. Let that
    // step settle before closing its resources; otherwise it could open a new
    // listener after cleanup has already closed the database pool.
    try { await startupTask; } catch { /* Startup reports its own safe error. */ }
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
  })();
  return shutdownTask;
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => { void shutdown(); });
}

async function startup(): Promise<void> {
  if (stopping) return;
  // Startup migration is serialized by a PostgreSQL advisory lock. This lets
  // new Railway users deploy from GitHub without a separate migration service.
  await migrate(db);
  if (stopping) return;
  app = await buildApp({ config, db });
  if (stopping) return;
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  if (stopping) return;
  console.log('V9 Page Studio listening on port ' + config.PORT + '.');
  workerTask = startWorker(db, config, controller.signal);
  // Observe rejection immediately while retaining the original promise so
  // shutdown can await the worker's in-flight work and heartbeat cleanup.
  void workerTask.then(
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
}

// Deferring startup by one microtask assigns startupTask before any startup
// work can trigger shutdown. Cleanup always waits on this same promise.
startupTask = Promise.resolve().then(startup);
try {
  await startupTask;
} catch {
  process.exitCode = 1;
  console.error('V9 Page Studio startup failed. Check required environment variables and the PostgreSQL connection.');
  await shutdown();
}

