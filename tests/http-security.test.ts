import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { before, after, beforeEach, test } from 'node:test';
import { buildApp } from '../apps/server/src/app.js';
import { loadConfig, META_SCOPES } from '../apps/server/src/config.js';
import { sha256 } from '../apps/server/src/crypto.js';
import { MetaClient, type MetaIdentity } from '../apps/server/src/meta.js';
import { saveIdentity } from '../apps/server/src/services.js';
import { testDatabase } from './helpers/database.js';

const base = 'https://studio.example.com';
const config = loadConfig({ NODE_ENV: 'test', PUBLIC_BASE_URL: base, DATABASE_URL: 'postgres://test', META_APP_ID: '123', META_APP_SECRET: 'test-only-secret', META_LOGIN_CONFIG_ID: '987', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64') });
const identity: MetaIdentity = { facebookId: '101', name: 'Người dùng thử', token: 'test-only-user-token', permissions: META_SCOPES, expiresAt: null, dataExpiresAt: null,
  pages: [{ id: '10101', name: 'Page của A', access_token: 'test-only-page-token', tasks: ['CREATE_CONTENT', 'MODERATE'] }] };
let loginCalls = 0;
class FakeMeta extends MetaClient {
  override async resolveLogin(): Promise<MetaIdentity> { loginCalls++; return identity; }
}
let db: Awaited<ReturnType<typeof testDatabase>>, app: Awaited<ReturnType<typeof buildApp>>;
let pageId: string;
const session = 'test-only-session-token', csrf = 'test-only-csrf-token';
const headers = { cookie: `__Host-v9_session=${session}`, origin: base, 'x-csrf-token': csrf };
before(async () => { db = await testDatabase(); app = await buildApp({ config, db, meta: new FakeMeta(config), serveStatic: false, logger: false }); await app.ready(); });
after(async () => { await app?.close(); await db?.close(); });
beforeEach(async () => {
  loginCalls = 0;
  await db.query('TRUNCATE app_users CASCADE');
  await db.query('TRUNCATE oauth_states');
  const saved = await saveIdentity(db, identity, config);
  await db.query("INSERT INTO sessions(token_hash,user_id,workspace_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')", [sha256(session), saved.userId, saved.workspaceId, csrf]);
  pageId = (await db.query('SELECT id FROM pages WHERE workspace_id=$1', [saved.workspaceId])).rows[0].id;
});

test('API requires a real session and projects no token or ciphertext', async () => {
  assert.equal((await app.inject('/api/pages')).statusCode, 401);
  const response = await app.inject({ url: '/api/pages', headers });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  for (const secret of ['test-only-page-token', 'test-only-user-token', 'token_enc']) assert.equal(response.body.includes(secret), false);
  assert.equal(response.json().pages[0].id, pageId);
});
test('all state-changing browser APIs reject missing or wrong CSRF and Origin', async () => {
  for (const badHeaders of [
    { cookie: headers.cookie },
    { ...headers, origin: 'https://evil.example.com' },
    { ...headers, 'x-csrf-token': 'wrong' },
  ]) assert.equal((await app.inject({ method: 'POST', url: '/api/campaigns', headers: badHeaders, payload: {} })).statusCode, 403);
  const good = await app.inject({ method: 'POST', url: '/api/campaigns', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { title: 'Nội dung', text: 'Bài thử', pageIds: [pageId], action: 'draft' } });
  assert.equal(good.statusCode, 200, good.body);
});
test('encoded and noncanonical API paths never bypass authentication', async () => {
  for (const url of ['/%61pi/pages', '/api%2Fpages', '//api/pages', '/api//pages', '/API/pages', '/api/pages/']) {
    const response = await app.inject(url);
    assert.notEqual(response.statusCode, 200, `unauthenticated ${url} unexpectedly returned data`);
    assert.equal(response.body.includes('Page của A'), false);
  }
});
test('OAuth state is random, browser-bound and consumed exactly once', async () => {
  const start = await app.inject('/auth/facebook');
  assert.equal(start.statusCode, 302);
  const target = new URL(String(start.headers.location));
  assert.equal(target.origin, 'https://www.facebook.com');
  assert.equal(target.searchParams.get('config_id'), '987');
  assert.equal(target.searchParams.has('scope'), false);
  const state = target.searchParams.get('state')!;
  const cookieValue = start.cookies.find(c => c.name === '__Host-v9_oauth')!;
  assert.ok(cookieValue.httpOnly && cookieValue.secure);
  const url = `/auth/facebook/callback?state=${encodeURIComponent(state)}&code=test-code`;
  const noBinding = await app.inject(url);
  assert.match(String(noBinding.headers.location), /invalid_state/);
  assert.equal(loginCalls, 0);
  const callback = await app.inject({ url, headers: { cookie: `__Host-v9_oauth=${cookieValue.value}` } });
  assert.equal(callback.headers.location, '/');
  assert.equal(loginCalls, 1);
  const newSession = callback.cookies.find(c => c.name === '__Host-v9_session')!;
  assert.ok(newSession.httpOnly && newSession.secure);
  assert.equal(newSession.sameSite?.toLowerCase(), 'lax');
  const replay = await app.inject({ url, headers: { cookie: `__Host-v9_oauth=${cookieValue.value}` } });
  assert.match(String(replay.headers.location), /invalid_state/);
  assert.equal(loginCalls, 1);
});
test('signed Meta deletion rejects tampering and actually removes account records', async () => {
  const bad = await app.inject({ method: 'POST', url: '/meta/data-deletion', payload: { signed_request: 'invalid.payload' } });
  assert.equal(bad.statusCode, 403);
  assert.equal((await db.query('SELECT count(*)::int n FROM app_users')).rows[0].n, 1);
  const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: identity.facebookId, issued_at: Math.floor(Date.now() / 1000) })).toString('base64url');
  const signature = createHmac('sha256', config.META_APP_SECRET).update(payload).digest('base64url');
  const response = await app.inject({ method: 'POST', url: '/meta/data-deletion', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ signed_request: `${signature}.${payload}` }).toString() });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal((await db.query('SELECT count(*)::int n FROM app_users')).rows[0].n, 0);
  assert.equal((await db.query('SELECT count(*)::int n FROM sessions')).rows[0].n, 0);
  const status = await app.inject(new URL(response.json().url).pathname);
  assert.equal(status.statusCode, 200);
  assert.match(status.body, /Đã xóa dữ liệu/);
  assert.equal((await app.inject('/deletion/status/not-a-valid-code')).statusCode, 404);
});
