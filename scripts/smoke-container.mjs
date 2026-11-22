import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Real production image + independent API/worker processes + real PostgreSQL.
// Every credential here is generated solely for disposable local/CI resources.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const prefix = `v9-smoke-${randomUUID().slice(0, 8)}`;
const names = { image: `${prefix}:test`, network: `${prefix}-net`, db: `${prefix}-db`, api: `${prefix}-api`, worker: `${prefix}-worker`, railway: `${prefix}-railway` };
const password = randomBytes(24).toString('hex');
const encryptionKey = randomBytes(32).toString('base64');
let migrationBlocker;

function docker(args, { allowFailure = false, input, inherit = false } = {}) {
  const result = spawnSync('docker', args, {
    cwd: root, encoding: 'utf8', input,
    stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'], timeout: 10 * 60_000
  });
  if (!allowFailure && result.status !== 0) {
    // Do not print command arguments: they may include disposable credentials.
    throw new Error(`Docker ${args[0]} failed. ${result.stderr || result.error?.message || ''}`);
  }
  return result;
}

async function waitFor(label, check, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (check()) return;
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function startService(role) {
  const args = ['run', '--detach', '--init', '--name', names[role], '--network', names.network,
    '--env', 'NODE_ENV=production', '--env', 'PORT=3000',
    '--env', 'PUBLIC_BASE_URL=https://v9-smoke.invalid',
    '--env', `DATABASE_URL=postgresql://v9test:${password}@${names.db}:5432/v9test`,
    '--env', `TOKEN_ENCRYPTION_KEY=${encryptionKey}`,
    '--env', 'WORKER_CONCURRENCY=2', names.image];
  if (role === 'worker') args.push('sh', 'scripts/start-service.sh', 'worker');
  if (role === 'railway') args.push('node', 'dist/apps/server/src/railway.js');
  return docker(args);
}

const statusScript = "fetch('http://127.0.0.1:3000/api/public-config',{signal:AbortSignal.timeout(2000)}).then(async r=>{if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()))}).catch(()=>process.exit(1))";
function status(container = names.api) {
  const result = docker(['exec', container, 'node', '-e', statusScript], { allowFailure: true });
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

function sql(statement) {
  return docker(['exec', names.db, 'psql', '-U', 'v9test', '-d', 'v9test', '-At', '-c', statement]).stdout.trim();
}

try {
  docker(['version'], { inherit: true });
  docker(['build', '--tag', names.image, '.'], { inherit: true });
  docker(['network', 'create', names.network]);
  docker(['run', '--detach', '--name', names.db, '--network', names.network,
    '--env', 'POSTGRES_USER=v9test', '--env', 'POSTGRES_DB=v9test',
    '--env', `POSTGRES_PASSWORD=${password}`, 'postgres:18-alpine']);
  await waitFor('PostgreSQL', () => docker(['exec', names.db, 'pg_isready', '-U', 'v9test', '-d', 'v9test'], { allowFailure: true }).status === 0);

  startService('api');
  startService('worker');
  await waitFor('schema migration and worker heartbeat', () => {
    const current = status();
    return current?.runtime?.databaseReady && current.runtime.workerOnline;
  });
  const ready = status();
  assert.equal(ready.facebookLoginConfigured, false);
  assert.equal(ready.oauthRedirectUri, 'https://v9-smoke.invalid/auth/facebook/callback');
  assert.equal(ready.runtime.schemaVersion, 2);
  assert.equal(ready.runtime.workerInstances, 1);

  const checks = readFileSync(join(root, 'scripts/verify-container-http.mjs'), 'utf8');
  docker(['exec', '--interactive', names.api, 'node', '--input-type=module'], { input: checks, inherit: false });
  console.log('PASS: production frontend, API, schema, worker and HTTP security checks.');

  docker(['stop', '--time', '30', names.worker]);
  await waitFor('worker shutdown cleanup', () => {
    const current = status();
    return current?.runtime?.databaseReady && current.runtime.workerInstances === 0;
  }, 10);
  assert.equal(status().runtime.workerOnline, false);

  // The API uses the image's default CMD; a restart must keep the schema.
  docker(['restart', '--time', '15', names.api]);
  await waitFor('API restart', () => status()?.runtime?.databaseReady === true, 30);
  assert.equal(status().runtime.schemaVersion, 2);
  console.log('PASS: graceful worker shutdown and persistent database after API restart.');

  startService('railway');
  await waitFor('combined Railway API and worker', () => {
    const current = status(names.railway);
    return current?.runtime?.databaseReady && current.runtime.workerInstances === 1;
  });
  docker(['exec', '--interactive', names.railway, 'node', '--input-type=module'], { input: checks });
  docker(['stop', '--time', '30', names.railway]);
  await waitFor('combined service shutdown cleanup', () => status()?.runtime?.workerInstances === 0, 10);
  console.log('PASS: Railway combined frontend/API/worker mode and graceful shutdown.');

  // Reproduce SIGTERM while startup is waiting for the migration advisory lock.
  // A canceled startup must never open a listener after its DB pool is closed.
  docker(['rm', names.railway]);
  migrationBlocker = spawn('docker', ['exec', '--env', 'PGAPPNAME=v9-smoke-migration-lock', names.db,
    'psql', '-U', 'v9test', '-d', 'v9test', '-c',
    "SELECT pg_advisory_lock(hashtextextended('v9:migrations',0)); SELECT pg_sleep(10);"],
  { cwd: root, stdio: 'ignore' });
  await waitFor('migration blocker', () => sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='v9-smoke-migration-lock' AND wait_event='PgSleep'") === '1', 10);
  startService('railway');
  await waitFor('startup migration waiting on the advisory lock', () => Number(sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%v9:migrations%'")) > 0, 10);
  docker(['kill', '--signal', 'TERM', names.railway]);
  await waitFor('canceled startup to exit cleanly', () => docker(['inspect', '--format', '{{.State.Running}}', names.railway]).stdout.trim() === 'false', 20);
  assert.equal(docker(['inspect', '--format', '{{.State.ExitCode}}', names.railway]).stdout.trim(), '0');
  const canceledLogs = docker(['logs', names.railway]).stdout;
  assert.equal(canceledLogs.includes('listening on port'), false);
  assert.equal(status().runtime.workerInstances, 0);
  console.log('PASS: SIGTERM during migration never starts HTTP or a background worker.');
} finally {
  migrationBlocker?.kill();
  for (const container of [names.railway, names.worker, names.api, names.db]) docker(['rm', '--force', '--volumes', container], { allowFailure: true });
  docker(['network', 'rm', names.network], { allowFailure: true });
  docker(['image', 'rm', '--force', names.image], { allowFailure: true });
}
