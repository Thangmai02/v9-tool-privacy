import assert from 'node:assert/strict';
import test from 'node:test';
import { campaignInputSchema, isPublicHttpsUrl, validateSchedule } from '../packages/shared/src/index.js';

const valid = { title: 'Lịch tuần', text: 'Nội dung', action: 'queue', pageIds: ['357dbfdc-5605-4d12-a39d-3ab85a51346a'] };
test('campaign accepts one image/video and bounded content', () => {
  assert.equal(campaignInputSchema.parse(valid).firstComment, '');
  assert.equal(campaignInputSchema.parse({ ...valid, media: { kind: 'video', url: 'https://media.example.com/video.mp4' } }).media?.kind, 'video');
  assert.equal(campaignInputSchema.safeParse({ ...valid, text: 'x'.repeat(5001) }).success, false);
});
test('cannot enqueue an empty, duplicate or unauthorized-shaped Page selection', () => {
  assert.equal(campaignInputSchema.safeParse({ ...valid, pageIds: [] }).success, false);
  assert.equal(campaignInputSchema.safeParse({ ...valid, pageIds: [...valid.pageIds, ...valid.pageIds] }).success, false);
  assert.equal(campaignInputSchema.safeParse({ ...valid, pageIds: ['12345'] }).success, false);
  assert.equal(campaignInputSchema.safeParse({ ...valid, workspaceId: 'attacker' }).success, false);
});
test('draft permits no selected Page but still needs publishable content', () => {
  assert.equal(campaignInputSchema.safeParse({ ...valid, action: 'draft', pageIds: [] }).success, true);
  assert.equal(campaignInputSchema.safeParse({ ...valid, action: 'draft', text: '', media: null }).success, false);
});
test('media rejects local networks, credentials, ports and non-HTTPS schemes', () => {
  for (const url of ['http://example.com/a', 'javascript:alert(1)', 'https://localhost/a', 'https://a.local/a', 'https://127.0.0.1/a', 'https://10.0.0.1/a', 'https://[::1]/a', 'https://user:pass@example.com/a', 'https://example.com:444/a', 'https://metadata.internal/a']) assert.equal(isPublicHttpsUrl(url), false, url);
  assert.equal(isPublicHttpsUrl('https://cdn.example.com/photo.jpg?key=opaque'), true);
});
test('schedule prevents past times and excessive range', () => {
  const now = Date.UTC(2026, 10, 22);
  assert.doesNotThrow(() => validateSchedule(null, now));
  assert.doesNotThrow(() => validateSchedule(new Date(now + 60_000).toISOString(), now));
  assert.throws(() => validateSchedule(new Date(now - 1).toISOString(), now));
  assert.throws(() => validateSchedule(new Date(now + 367 * 86400_000).toISOString(), now));
});
