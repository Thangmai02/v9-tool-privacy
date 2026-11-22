import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { decryptToken, encryptToken, randomToken, safeEqual, verifySignedRequest } from '../apps/server/src/crypto.js';
import { loadConfig } from '../apps/server/src/config.js';

test('AES-GCM tokens are randomized and bound to workspace/Page context', () => {
  const key = randomBytes(32).toString('base64');
  const first = encryptToken('page-access-token', key, 'page:workspace-a:123');
  const second = encryptToken('page-access-token', key, 'page:workspace-a:123');
  assert.notEqual(first, second);
  assert.equal(decryptToken(first, key, 'page:workspace-a:123'), 'page-access-token');
  assert.throws(() => decryptToken(first, key, 'page:workspace-b:123'));
  assert.throws(() => decryptToken(first, randomBytes(32).toString('base64'), 'page:workspace-a:123'));
  const segments = first.split('.'); segments[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decryptToken(segments.join('.'), key, 'page:workspace-a:123'));
});
test('signed_request verifies original encoded payload, algorithm, age, user and signature', () => {
  const secret = 'fixture-app-secret', now = 1_800_000_000;
  const sign = (payload: object) => {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${createHmac('sha256', secret).update(data).digest('base64url')}.${data}`;
  };
  const valid = sign({ algorithm: 'HMAC-SHA256', user_id: '123456', issued_at: now });
  assert.equal(verifySignedRequest(valid, secret, now).user_id, '123456');
  assert.throws(() => verifySignedRequest(valid, 'wrong-secret', now));
  assert.throws(() => verifySignedRequest(sign({ algorithm: 'none', user_id: '123', issued_at: now }), secret, now));
  assert.throws(() => verifySignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: '123', issued_at: now + 3600 }), secret, now));
  assert.throws(() => verifySignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: '123', issued_at: now - 8 * 86400 }), secret, now));
  assert.throws(() => verifySignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: '../123', issued_at: now }), secret, now));
  assert.throws(() => verifySignedRequest('x.y.z', secret, now));
});
test('opaque secrets compare safely and generate unpredictable material', () => {
  assert.equal(safeEqual('same', 'same'), true); assert.equal(safeEqual('short', 'longer'), false);
  assert.equal(Buffer.from(randomToken(), 'base64url').length, 32);
});
test('production refuses public HTTP, paths and invalid encryption keys', () => {
  const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://fixture', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') };
  assert.throws(() => loadConfig({ ...base, PUBLIC_BASE_URL: 'http://app.example.com' }));
  assert.throws(() => loadConfig({ ...base, PUBLIC_BASE_URL: 'https://app.example.com/subpath' }));
  assert.throws(() => loadConfig({ ...base, PUBLIC_BASE_URL: 'https://app.example.com', TOKEN_ENCRYPTION_KEY: 'bad' }));
  assert.equal(loadConfig({ ...base, PUBLIC_BASE_URL: 'https://app.example.com' }).PUBLIC_BASE_URL, 'https://app.example.com');
});
