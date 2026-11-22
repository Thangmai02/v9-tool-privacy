import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { campaignInputSchema } from '../packages/shared/src/index.js';
import { loadConfig, META_COMMENT_SCOPES, META_SCOPES } from '../apps/server/src/config.js';
import { MetaClient, MetaError } from '../apps/server/src/meta.js';
import { createCampaign, changeJob, saveIdentity } from '../apps/server/src/services.js';
import { recoverStaleJobs, runOneJob } from '../apps/server/src/queue.js';
import { testDatabase } from './helpers/database.js';

const config = loadConfig({ NODE_ENV: 'test', PUBLIC_BASE_URL: 'http://localhost:3000', DATABASE_URL: 'postgres://test', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
let db: Awaited<ReturnType<typeof testDatabase>>, workspaceId: string, pageId: string;
before(async () => { db = await testDatabase(); });
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.query('TRUNCATE app_users CASCADE'); await db.query('TRUNCATE page_lanes');
  const identity = await saveIdentity(db, { facebookId: '900', name: 'Publisher', token: 'fixture-user', permissions: [...META_SCOPES, ...META_COMMENT_SCOPES], expiresAt: null, dataExpiresAt: null,
    pages: [{ id: '9001', name: 'Publishing Page', access_token: 'fixture-page', tasks: ['CREATE_CONTENT', 'MODERATE'] }] }, config);
  workspaceId = identity.workspaceId;
  pageId = (await db.query('SELECT id FROM pages WHERE workspace_id=$1', [workspaceId])).rows[0].id;
});
const campaign = (overrides: Record<string, unknown> = {}) => createCampaign(db, workspaceId,
  campaignInputSchema.parse({ title: 'Approved content', text: 'Hello', firstComment: 'More details', pageIds: [pageId], action: 'queue', ...overrides }), randomUUID());
async function makeDue() { await db.query("UPDATE page_lanes SET next_allowed_at=now()-interval '1 second'"); await db.query("UPDATE jobs SET scheduled_at=now()-interval '1 second' WHERE status IN('queued','retrying')"); }

test('first comment failure and retry never republishes a successful post', async () => {
  let posts = 0, comments = 0;
  class Provider extends MetaClient {
    override async publish() { posts++; return { postId: '9001_111' }; }
    override async comment() { comments++; if (comments === 1) throw new MetaError('Permission rejected', 200, true); return '9001_111_1'; }
  }
  const provider = new Provider(config);
  await campaign(); assert.equal(await runOneJob(db, config, provider), true);
  const original = (await db.query("SELECT * FROM jobs WHERE kind='publish'")).rows[0];
  assert.equal(original.status, 'succeeded'); assert.equal(original.facebook_post_id, '9001_111');
  await makeDue(); await runOneJob(db, config, provider);
  const comment = (await db.query("SELECT * FROM jobs WHERE kind='comment'")).rows[0];
  assert.equal(comment.status, 'failed'); assert.equal(comment.retry_safe, true);
  await changeJob(db, workspaceId, comment.id, 'retry'); await makeDue(); await runOneJob(db, config, provider);
  assert.equal(posts, 1); assert.equal(comments, 2);
  assert.equal((await db.query('SELECT status FROM campaigns')).rows[0].status, 'completed');
});
test('unknown POST outcome stops automatic retry and records uncertain state', async () => {
  let posts = 0;
  class Provider extends MetaClient { override async publish(): Promise<{ postId?: string }> { posts++; throw new MetaError('Timeout', null, false, true); } }
  const provider = new Provider(config); await campaign();
  await runOneJob(db, config, provider); await makeDue();
  assert.equal(await runOneJob(db, config, provider), false);
  const job = (await db.query('SELECT * FROM jobs')).rows[0];
  assert.equal(job.status, 'uncertain'); assert.equal(job.retry_safe, false); assert.equal(posts, 1);
  assert.equal((await db.query("SELECT count(*)::int n FROM jobs WHERE kind='comment'")).rows[0].n, 0);
});
test('video acceptance, processing and readiness persist one upload with delayed comment', async () => {
  let uploads = 0, polls = 0;
  class Provider extends MetaClient {
    override async publish() { uploads++; return { videoId: '8888' }; }
    override async videoStatus(): Promise<'processing' | 'ready'> { polls++; return polls === 1 ? 'processing' : 'ready'; }
  }
  const provider = new Provider(config); await campaign({ media: { kind: 'video', url: 'https://cdn.example.com/movie.mp4' } });
  await runOneJob(db, config, provider);
  let job = (await db.query('SELECT * FROM jobs')).rows[0];
  assert.equal(job.phase, 'video_wait'); assert.equal(job.video_id, '8888'); assert.equal(job.status, 'retrying');
  assert.equal((await db.query("SELECT count(*)::int n FROM jobs WHERE kind='comment'")).rows[0].n, 0);
  await makeDue(); await runOneJob(db, config, provider);
  await makeDue(); await runOneJob(db, config, provider);
  job = (await db.query("SELECT * FROM jobs WHERE kind='publish'")).rows[0];
  assert.equal(job.status, 'succeeded'); assert.equal(uploads, 1); assert.equal(polls, 2);
  assert.equal((await db.query("SELECT count(*)::int n FROM jobs WHERE kind='comment'")).rows[0].n, 1);
});
test('stale running mutation is uncertain but a known video resumes read-only polling', async () => {
  await campaign({ firstComment: '' });
  await db.query("UPDATE jobs SET status='running',locked_until=now()-interval '1 minute'");
  await recoverStaleJobs(db);
  assert.equal((await db.query('SELECT status FROM jobs')).rows[0].status, 'uncertain');
  await db.query("UPDATE jobs SET status='running',phase='video_wait',video_id='777',locked_until=now()-interval '1 minute'");
  await recoverStaleJobs(db);
  const job = (await db.query('SELECT * FROM jobs')).rows[0];
  assert.equal(job.status, 'retrying'); assert.equal(job.video_id, '777'); assert.equal(job.phase, 'video_wait');
});
test('provider rate limit defers both job and shared Page lane', async () => {
  class Provider extends MetaClient { override async publish(): Promise<{ postId?: string }> { throw new MetaError('Rate limit', 80001, true, false, 180); } }
  await campaign(); await runOneJob(db, config, new Provider(config));
  const job = (await db.query('SELECT *,scheduled_at>now()+interval \'170 seconds\' AS waiting FROM jobs')).rows[0];
  assert.equal(job.status, 'retrying'); assert.equal(job.waiting, true);
  const lane = (await db.query("SELECT next_allowed_at>now()+interval '170 seconds' AS waiting FROM page_lanes")).rows[0];
  assert.equal(lane.waiting, true);
});
