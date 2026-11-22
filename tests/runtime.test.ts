import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, beforeEach, test } from 'node:test';
import { buildApp } from '../apps/server/src/app.js';
import { loadConfig } from '../apps/server/src/config.js';
import type { Database } from '../apps/server/src/db.js';
import { getSystemStatus, pruneWorkerHeartbeats, recordWorkerHeartbeat, removeWorkerHeartbeat } from '../apps/server/src/runtime.js';
import { startWorker } from '../apps/server/src/worker.js';
import { testDatabase } from './helpers/database.js';

let db: Awaited<ReturnType<typeof testDatabase>>;
const config = loadConfig({ NODE_ENV: 'test', PUBLIC_BASE_URL: 'https://studio.example.com', DATABASE_URL: 'postgres://test',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 13).toString('base64'), META_APP_ID: '123456', META_APP_SECRET: 'test-only-private-secret' });
before(async () => { db = await testDatabase(); });
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.query('TRUNCATE worker_heartbeats');
  await db.query('INSERT INTO schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING');
});

test('migrated database is ready while absent workers are correctly offline', async () => {
  assert.deepEqual(await getSystemStatus(db), { databaseReady: true, schemaVersion: 2, workerOnline: false,
    workerInstances: 0, workerLastSeenAt: null });
});

test('readiness checks migration version and core tables, not only database connectivity', async () => {
  await db.query('DELETE FROM schema_migrations WHERE version=2');
  const outdated = await getSystemStatus(db);
  assert.equal(outdated.databaseReady, false);
  assert.equal(outdated.schemaVersion, 1);
  await db.query('INSERT INTO schema_migrations(version) VALUES(2)');
  await db.query('ALTER TABLE jobs RENAME TO runtime_test_missing_jobs');
  try { assert.equal((await getSystemStatus(db)).databaseReady, false); }
  finally { await db.query('ALTER TABLE runtime_test_missing_jobs RENAME TO jobs'); }
});

test('a missing schema or database error produces safe metadata without exposing SQL errors', async () => {
  await db.query('ALTER TABLE schema_migrations RENAME TO runtime_test_missing_migrations');
  try {
    const missing = await getSystemStatus(db);
    assert.equal(missing.databaseReady, false);
    assert.equal(missing.schemaVersion, null);
  } finally { await db.query('ALTER TABLE runtime_test_missing_migrations RENAME TO schema_migrations'); }
  const unavailable = await getSystemStatus({ async query() { throw new Error('postgres://private:secret@private.example/database'); } });
  assert.equal(unavailable.databaseReady, false);
  assert.equal(unavailable.workerOnline, false);
  assert.equal(JSON.stringify(unavailable).includes('secret'), false);
});

test('only recent worker instances count online and refreshing keeps their original start time', async () => {
  const first = randomUUID(), second = randomUUID();
  await recordWorkerHeartbeat(db, first, 4);
  const started = (await db.query('SELECT started_at FROM worker_heartbeats WHERE worker_id=$1', [first])).rows[0].started_at;
  await db.query("UPDATE worker_heartbeats SET last_seen=now()-interval '90 seconds' WHERE worker_id=$1", [first]);
  const stale = await getSystemStatus(db);
  assert.equal(stale.databaseReady, true);
  assert.equal(stale.workerOnline, false);
  assert.ok(stale.workerLastSeenAt);
  await recordWorkerHeartbeat(db, first, 2);
  await recordWorkerHeartbeat(db, second, 4);
  const active = await getSystemStatus(db);
  assert.equal(active.workerOnline, true);
  assert.equal(active.workerInstances, 2);
  assert.deepEqual((await db.query('SELECT started_at FROM worker_heartbeats WHERE worker_id=$1', [first])).rows[0].started_at, started);
  assert.equal(JSON.stringify(active).includes(first), false, 'Public runtime metadata does not expose worker IDs.');
  await removeWorkerHeartbeat(db, first);
  assert.equal((await getSystemStatus(db)).workerInstances, 1);
});

test('heartbeat cleanup prunes only rows older than one day', async () => {
  const old = randomUUID(), stale = randomUUID(), active = randomUUID();
  for (const id of [old, stale, active]) await recordWorkerHeartbeat(db, id, 4);
  await db.query("UPDATE worker_heartbeats SET last_seen=now()-interval '2 days' WHERE worker_id=$1", [old]);
  await db.query("UPDATE worker_heartbeats SET last_seen=now()-interval '90 seconds' WHERE worker_id=$1", [stale]);
  await pruneWorkerHeartbeats(db);
  const remaining = (await db.query('SELECT worker_id FROM worker_heartbeats')).rows.map(row => row.worker_id);
  assert.equal(remaining.includes(old), false);
  assert.equal(remaining.includes(stale), true);
  assert.equal(remaining.includes(active), true);
});

test('health and public setup metadata distinguish worker startup from database failure', async () => {
  const app = await buildApp({ config, db, serveStatic: false, logger: false });
  try {
    const health = await app.inject('/health');
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().ok, true);
    assert.equal(health.json().runtime.workerOnline, false);
    const response = await app.inject('/api/public-config');
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(Object.keys(response.json()).sort(), ['facebookLoginConfigured', 'oauthRedirectUri', 'runtime']);
    assert.equal(response.json().oauthRedirectUri, 'https://studio.example.com/auth/facebook/callback');
    assert.equal(response.json().facebookLoginConfigured, true);
    for (const secret of [config.META_APP_SECRET, config.TOKEN_ENCRYPTION_KEY, config.DATABASE_URL]) assert.equal(response.body.includes(secret), false);
    await db.query('DELETE FROM schema_migrations WHERE version=2');
    const unready = await app.inject('/health');
    assert.equal(unready.statusCode, 503);
    assert.equal(unready.json().ok, false);
  } finally { await app.close(); }
});

test('worker registers itself and removes its heartbeat after graceful shutdown', { timeout: 10_000 }, async () => {
  const controller = new AbortController();
  let signalReady!: () => void;
  const ready = new Promise<void>(resolve => { signalReady = resolve; });
  const observedDb: Database = {
    async query(sql, values) {
      const result = await db.query(sql, values);
      if (sql.includes('INSERT INTO worker_heartbeats')) signalReady();
      return result;
    },
    connect: () => db.connect()
  };
  const running = startWorker(observedDb, config, controller.signal);
  try {
    await Promise.race([ready, running.then(() => { throw new Error('Worker stopped before registering readiness.'); })]);
    assert.equal((await getSystemStatus(db)).workerInstances, 1);
  } finally { controller.abort(); await running; }
  assert.equal((await getSystemStatus(db)).workerInstances, 0);
});
