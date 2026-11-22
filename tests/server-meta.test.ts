import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../apps/server/src/config.js';
import { MetaClient, MetaError, usageDelay } from '../apps/server/src/meta.js';
import { permissionsForPage } from '../apps/server/src/services.js';
import { retryDelay } from '../apps/server/src/queue.js';

const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://fixture', PUBLIC_BASE_URL: 'http://localhost:3000', META_APP_ID: '123', META_APP_SECRET: 'fixture-secret', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') });
const json = (value: unknown, status = 200, headers: Record<string,string> = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
const fetchFixture = (fn: (url: URL, init?: RequestInit) => Response | Promise<Response>): typeof fetch => (async (input: RequestInfo | URL, init?: RequestInit) => fn(new URL(String(input)), init)) as typeof fetch;

test('Business Login config omits scope and uses pinned API version and exact callback', () => {
  const client = new MetaClient({ ...config, META_LOGIN_CONFIG_ID: '555' });
  const url = new URL(client.authorizationUrl('opaque-state'));
  assert.equal(url.searchParams.get('config_id'), '555'); assert.equal(url.searchParams.has('scope'), false);
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/auth/facebook/callback');
  assert.equal(url.pathname, '/v27.0/dialog/oauth');
});
test('single photo uses published post_id, server token header and caption', async () => {
  const client = new MetaClient(config, fetchFixture((url, init) => {
    assert.equal(url.pathname, '/v27.0/123/photos');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer page-token');
    const data = new URLSearchParams(String(init?.body));
    assert.equal(data.get('published'), 'true'); assert.equal(data.get('caption'), 'A photo');
    assert.equal(data.has('access_token'), false);
    return json({ id: 'photo-asset', post_id: '123_456' });
  }));
  assert.deepEqual(await client.publish('123', 'page-token', 'A photo', { kind: 'image', url: 'https://cdn.example.com/image.jpg' }), { postId: '123_456' });
});
test('mutation timeout and missing post id become uncertain without safe retry', async () => {
  for (const fetcher of [fetchFixture(() => { throw new Error('timeout including secret must not escape'); }), fetchFixture(() => json({ success: true }))]) {
    const client = new MetaClient(config, fetcher);
    await assert.rejects(client.publish('123', 'page-token', 'Hello', null), error => {
      assert.ok(error instanceof MetaError); assert.equal(error.uncertain, true); assert.equal(error.retrySafe, false);
      assert.equal(error.message.includes('secret'), false); return true;
    });
  }
});
test('explicit rate limit carries minute-based Meta cooldown, 5xx mutation does not retry', async () => {
  const headers = { 'x-business-use-case-usage': JSON.stringify({ '123': [{ estimated_time_to_regain_access: 3 }] }) };
  const limited = new MetaClient(config, fetchFixture(() => json({ error: { code: 80001 } }, 400, headers)));
  await assert.rejects(limited.comment('123_456', 'token', 'Hello'), error => {
    assert.ok(error instanceof MetaError); assert.equal(error.rateLimited, true); assert.equal(error.retrySafe, true);
    assert.equal(error.retryAfterSeconds, 180); return true;
  });
  const serverError = new MetaClient(config, fetchFixture(() => json({ error: { code: 2 } }, 503)));
  await assert.rejects(serverError.comment('123_456', 'token', 'Hello'), error => error instanceof MetaError && error.uncertain && !error.retrySafe);
  assert.equal(usageDelay(new Headers(headers)), 180);
  assert.ok(retryDelay(2, 180, 0) >= 180);
});
test('Page pagination follows an opaque cursor on fixed Meta host, never next URL', async () => {
  let calls = 0;
  const client = new MetaClient(config, fetchFixture(url => {
    calls++; assert.equal(url.hostname, 'graph.facebook.com'); assert.equal(url.pathname, '/v27.0/me/accounts');
    if (calls === 1) return json({ data: [{ id: '1', name: 'One', access_token: 'page1', tasks: ['CREATE_CONTENT'] }], paging: { next: 'https://evil.example/steal', cursors: { after: 'opaque' } } });
    assert.equal(url.searchParams.get('after'), 'opaque');
    return json({ data: [{ id: '2', name: 'Two', access_token: 'page2', tasks: ['MODERATE'] }] });
  }));
  assert.equal((await client.listPages('user-token')).length, 2); assert.equal(calls, 2);
});
test('Page capabilities require matching tasks and actual granted permissions', () => {
  const scopes = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_read_user_content', 'pages_manage_engagement'];
  assert.deepEqual(permissionsForPage(['CREATE_CONTENT', 'MODERATE'], scopes), { canPost: true, canComment: true });
  assert.equal(permissionsForPage(['CREATE_CONTENT', 'MODERATE'], scopes.filter(s => s !== 'pages_read_user_content')).canComment, false);
  assert.equal(permissionsForPage(['MODERATE'], scopes).canPost, false);
});
test('video upload is accepted separately from processing and publication', async () => {
  const urls: string[] = [];
  const client = new MetaClient(config, fetchFixture((url, init) => {
    urls.push(url.toString());
    if (init?.method === 'POST') { assert.equal(url.hostname, 'graph-video.facebook.com'); return json({ id: '987' }); }
    return json({ status: { video_status: 'processing' }, published: false });
  }));
  assert.deepEqual(await client.publish('123', 'token', 'Clip', { kind: 'video', url: 'https://cdn.example.com/video.mp4' }), { videoId: '987' });
  assert.equal(await client.videoStatus('987', 'token'), 'processing');
  assert.equal(urls.length, 2);
});
