import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:3000';
const get = path => fetch(new URL(path, origin), { signal: AbortSignal.timeout(5000), redirect: 'manual' });
const response = await get('/');
assert.equal(response.status, 200, 'The production frontend must be served by the API process.');
assert.match(response.headers.get('content-type') || '', /text\/html/);
assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
const html = await response.text();
assert.match(html, /id="root"/);
const asset = html.match(/<script[^>]+src="([^"]+\.js)"/u)?.[1];
assert.ok(asset, 'Compiled frontend JavaScript must be present.');
const js = await get(asset);
assert.equal(js.status, 200);
const script = await js.text();
assert.ok(script.includes('/api/public-config'), 'This must be the live API frontend, not the Pages preview build.');

for (const path of ['/privacy-policy.html', '/terms.html', '/data-deletion.html']) {
  const policy = await get(path);
  assert.equal(policy.status, 200, path);
  assert.match(policy.headers.get('content-type') || '', /text\/html/);
}
const health = await get('/health');
assert.equal(health.status, 200);
assert.equal((await health.json()).runtime.databaseReady, true);
const config = await get('/api/public-config');
assert.equal(config.status, 200);
assert.equal(config.headers.get('cache-control'), 'no-store');
const publicText = await config.text();
for (const secret of ['TOKEN_ENCRYPTION_KEY', 'DATABASE_URL', 'META_APP_SECRET', process.env.TOKEN_ENCRYPTION_KEY, process.env.DATABASE_URL]) {
  if (secret) assert.equal(publicText.includes(secret), false, 'Public runtime response must not expose secrets.');
}
assert.equal((await get('/api/pages')).status, 401);
assert.equal((await get('/api/jobs')).status, 401);
assert.equal((await get('/auth/facebook')).status, 503, 'Unconfigured Facebook login must fail explicitly.');
for (const path of ['/.env', '/apps/server/src/app.ts', '/package.json', '/does-not-exist']) {
  assert.ok([403, 404].includes((await get(path)).status), `Internal or missing file must not be served: ${path}`);
}
