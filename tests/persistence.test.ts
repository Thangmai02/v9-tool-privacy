import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, beforeEach, test } from 'node:test';
import { campaignInputSchema } from '../packages/shared/src/index.js';
import { loadConfig, META_SCOPES } from '../apps/server/src/config.js';
import { createCampaign, publishDraft, requireOwnedPages, saveIdentity, changeJob, deleteUserData, pageView, HttpError } from '../apps/server/src/services.js';
import { testDatabase } from './helpers/database.js';

let db: Awaited<ReturnType<typeof testDatabase>>;
let a: { userId: string; workspaceId: string }, b: typeof a;
let pageA: string, pageB: string;
const config = loadConfig({ NODE_ENV: 'test', PUBLIC_BASE_URL: 'http://localhost:3000', DATABASE_URL: 'postgres://test', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') });
before(async () => { db = await testDatabase(); });
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.query('TRUNCATE app_users CASCADE');
  a = await saveIdentity(db, { facebookId: '100', name: 'A', token: 'test-user-a', permissions: META_SCOPES, expiresAt: null, dataExpiresAt: null,
    pages: [{ id: '1001', name: 'Page A', access_token: 'test-page-a', tasks: ['CREATE_CONTENT', 'MODERATE'] }] }, config);
  b = await saveIdentity(db, { facebookId: '200', name: 'B', token: 'test-user-b', permissions: META_SCOPES, expiresAt: null, dataExpiresAt: null,
    pages: [{ id: '2001', name: 'Page B', access_token: 'test-page-b', tasks: ['CREATE_CONTENT', 'MODERATE'] }] }, config);
  pageA = (await db.query('SELECT id FROM pages WHERE workspace_id=$1', [a.workspaceId])).rows[0].id;
  pageB = (await db.query('SELECT id FROM pages WHERE workspace_id=$1', [b.workspaceId])).rows[0].id;
});
const input = (pageId: string, overrides: Record<string, unknown> = {}) => campaignInputSchema.parse({ title: 'Nội dung đã duyệt', text: 'Xin chào', pageIds: [pageId], action: 'queue', ...overrides });
const isHttp = (status: number) => (error: unknown) => error instanceof HttpError && error.statusCode === status;

test('workspace authorization rejects another user Page even with valid Page UUID', async () => {
  await assert.rejects(requireOwnedPages(db, b.workspaceId, [pageA]), isHttp(403));
  await assert.rejects(createCampaign(db, b.workspaceId, input(pageA), randomUUID()), isHttp(403));
  assert.equal((await db.query('SELECT count(*)::int n FROM jobs')).rows[0].n, 0);
});
test('idempotency repeats same campaign and refuses same key with changed body', async () => {
  const key = randomUUID(), payload = input(pageA);
  const first = await createCampaign(db, a.workspaceId, payload, key);
  const second = await createCampaign(db, a.workspaceId, payload, key);
  assert.equal(first.id, second.id);
  assert.equal((await db.query('SELECT count(*)::int n FROM jobs')).rows[0].n, 1);
  await assert.rejects(createCampaign(db, a.workspaceId, input(pageA, { text: 'Khác' }), key), isHttp(409));
  const independent = await createCampaign(db, b.workspaceId, input(pageB), key);
  assert.notEqual(independent.id, first.id);
});
test('draft queues once and cannot be published by another workspace', async () => {
  const draft = await createCampaign(db, a.workspaceId, input(pageA, { action: 'draft' }), randomUUID());
  assert.equal((await db.query('SELECT count(*)::int n FROM jobs')).rows[0].n, 0);
  await assert.rejects(publishDraft(db, b.workspaceId, draft.id), isHttp(404));
  await publishDraft(db, a.workspaceId, draft.id, null);
  await publishDraft(db, a.workspaceId, draft.id, null);
  assert.equal((await db.query('SELECT count(*)::int n FROM jobs')).rows[0].n, 1);
});
test('comment permission required on every selected Page, validated before queue write', async () => {
  await db.query('UPDATE pages SET can_comment=false WHERE id=$1', [pageA]);
  await assert.rejects(createCampaign(db, a.workspaceId, input(pageA, { firstComment: 'Thông tin thêm' }), randomUUID()), isHttp(409));
  assert.equal((await db.query('SELECT count(*)::int n FROM campaigns')).rows[0].n, 0);
});
test('composite database constraints reject cross-workspace jobs', async () => {
  const campaign = await createCampaign(db, a.workspaceId, input(pageA), randomUUID());
  await assert.rejects(db.query(`INSERT INTO jobs(id,workspace_id,campaign_id,page_id,kind,status) VALUES($1,$2,$3,$4,'comment','queued')`, [randomUUID(), a.workspaceId, campaign.id, pageB]), /foreign key/i);
});
test('a campaign has at most one publish and one first-comment job per Page', async () => {
  const campaign = await createCampaign(db, a.workspaceId, input(pageA), randomUUID());
  await db.query(`INSERT INTO jobs(id,workspace_id,campaign_id,page_id,kind,status,facebook_post_id) VALUES($1,$2,$3,$4,'comment','queued','1001_555')`, [randomUUID(), a.workspaceId, campaign.id, pageA]);
  await assert.rejects(db.query(`INSERT INTO jobs(id,workspace_id,campaign_id,page_id,kind,status) VALUES($1,$2,$3,$4,'comment','queued')`, [randomUUID(), a.workspaceId, campaign.id, pageA]), /unique/i);
});
test('uncertain write cannot be retried and other workspace cannot cancel it', async () => {
  await createCampaign(db, a.workspaceId, input(pageA), randomUUID());
  const job = (await db.query('SELECT id FROM jobs')).rows[0].id;
  await db.query("UPDATE jobs SET status='uncertain',retry_safe=false WHERE id=$1", [job]);
  await assert.rejects(changeJob(db, a.workspaceId, job, 'retry'), isHttp(409));
  await assert.rejects(changeJob(db, b.workspaceId, job, 'cancel'), isHttp(404));
  assert.equal((await db.query('SELECT status FROM jobs WHERE id=$1', [job])).rows[0].status, 'uncertain');
});
test('tokens are encrypted and public Page projection never serializes them', async () => {
  const page = (await db.query('SELECT * FROM pages WHERE id=$1', [pageA])).rows[0];
  assert.notEqual(page.token_enc, 'test-page-a');
  assert.equal(JSON.stringify(pageView(page)).includes('token_enc'), false);
  assert.equal(JSON.stringify(pageView(page)).includes('test-page-a'), false);
});
test('deletion removes only the requested user, workspace, jobs and sessions', async () => {
  await createCampaign(db, a.workspaceId, input(pageA), randomUUID());
  await createCampaign(db, b.workspaceId, input(pageB), randomUUID());
  await db.query("INSERT INTO sessions(token_hash,user_id,workspace_id,csrf_token,expires_at) VALUES('test-session',$1,$2,'test-csrf',now()+interval '1 day')", [a.userId, a.workspaceId]);
  const receipt = await deleteUserData(db, '100');
  assert.match(receipt, /^[a-f0-9-]{36}$/);
  assert.equal((await db.query('SELECT count(*)::int n FROM jobs WHERE workspace_id=$1', [a.workspaceId])).rows[0].n, 0);
  assert.equal((await db.query('SELECT count(*)::int n FROM sessions WHERE user_id=$1', [a.userId])).rows[0].n, 0);
  assert.equal((await db.query('SELECT count(*)::int n FROM jobs WHERE workspace_id=$1', [b.workspaceId])).rows[0].n, 1);
  assert.equal((await db.query('SELECT status FROM deletion_receipts WHERE code=$1', [receipt])).rows[0].status, 'completed');
});
