import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const root = process.cwd();
const source = await readFile(join(root, 'scripts/setup-env.mjs'), 'utf8');
const template = await readFile(join(root, '.env.example'), 'utf8');
async function fixture(run: (directory: string) => Promise<void>) {
  await mkdir(join(root, '.qa'), { recursive: true });
  const directory = await mkdtemp(join(root, '.qa/env-test-'));
  await mkdir(join(directory, 'scripts'));
  await writeFile(join(directory, 'scripts/setup-env.mjs'), source);
  await writeFile(join(directory, '.env.example'), template);
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
function setup(directory: string, domain: string) {
  return spawnSync(process.execPath, ['scripts/setup-env.mjs', domain], { cwd: directory, encoding: 'utf8' });
}

test('setup generates private credentials and consistent origins without logging secrets', async () => fixture(async directory => {
  const result = setup(directory, 'Studio.Example.VN');
  assert.equal(result.status, 0, result.stderr);
  const contents = await readFile(join(directory, '.env'), 'utf8');
  assert.match(contents, /^APP_DOMAIN=studio\.example\.vn$/m);
  assert.match(contents, /^PUBLIC_BASE_URL=https:\/\/studio\.example\.vn$/m);
  const password = contents.match(/^POSTGRES_PASSWORD=(.+)$/m)![1]!;
  const key = contents.match(/^TOKEN_ENCRYPTION_KEY=(.+)$/m)![1]!;
  assert.match(password, /^[a-f0-9]{64}$/);
  assert.equal(Buffer.from(key, 'base64').length, 32);
  assert.ok(contents.includes(`postgresql://v9:${password}@localhost:5432/v9`));
  assert.equal(result.stdout.includes(password) || result.stdout.includes(key), false);
  assert.equal(result.stderr.includes(password) || result.stderr.includes(key), false);
  assert.equal((await stat(join(directory, '.env'))).mode & 0o777, 0o600);
}));

test('rerunning setup preserves an existing encryption key and environment exactly', async () => fixture(async directory => {
  assert.equal(setup(directory, 'studio.example.vn').status, 0);
  const before = await readFile(join(directory, '.env'), 'utf8');
  const again = setup(directory, 'other.example.vn');
  assert.equal(again.status, 1);
  assert.match(again.stderr, /Đã có .env/);
  assert.equal(await readFile(join(directory, '.env'), 'utf8'), before);
}));

test('setup rejects URLs, IP addresses and line injection before writing any environment', async () => fixture(async directory => {
  for (const input of ['https://example.vn', '127.0.0.1', 'localhost', 'a.example.vn\nMETA_APP_SECRET=injected', 'example.vn:443', 'a..example.vn']) {
    assert.equal(setup(directory, input).status, 1, `Unexpectedly accepted ${JSON.stringify(input)}`);
    await assert.rejects(readFile(join(directory, '.env')), { code: 'ENOENT' });
  }
}));
