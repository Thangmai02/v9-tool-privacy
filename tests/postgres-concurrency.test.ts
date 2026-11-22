import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import type { Database } from '../apps/server/src/db.js';
import { claimJob, recoverStaleJobs, type ClaimedJob } from '../apps/server/src/queue.js';
import { schemaSql } from '../apps/server/src/schema.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const numericId = (): string => BigInt(`0x${randomUUID().replaceAll('-', '')}`).toString();

// This suite exercises PostgreSQL's real cross-session row/advisory locks.
// It never executes a Meta API operation and only writes to its own random schema.
test('real PostgreSQL queue concurrency and stale-write recovery', {
  skip: !testDatabaseUrl,
  timeout: 60_000
}, async t => {
  const schema = `v9_queue_test_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^v9_queue_test_[a-f0-9]{32}$/);
  const admin = new pg.Pool({ connectionString: testDatabaseUrl, max: 1, connectionTimeoutMillis: 10_000 });
  let pool: pg.Pool | undefined;
  let created = false;
  const held = new Set<ClaimedJob>();

  async function releaseClaim(claim: ClaimedJob): Promise<void> {
    try {
      // Simulate a finished job only to free the scheduler for the next assertion.
      await claim.client.query("UPDATE jobs SET status='succeeded',locked_until=NULL WHERE id=$1", [claim.job.id]);
    } finally {
      try {
        await claim.client.query("SELECT pg_advisory_unlock(hashtextextended('page:'||$1,0))", [claim.job.facebook_id]);
      } finally {
        held.delete(claim);
        claim.client.release();
      }
    }
  }
  async function releaseAll(): Promise<void> {
    const results = await Promise.allSettled([...held].map(releaseClaim));
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (errors.length) throw new AggregateError(errors.map(r => r.reason), 'Could not release test claims.');
  }
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const scopedUrl = new URL(testDatabaseUrl!);
    // Setting options on the URL also overrides any search_path in the supplied URL.
    scopedUrl.searchParams.set('options', `-c search_path=${schema},pg_catalog -c statement_timeout=10000 -c lock_timeout=5000`);
    pool = new pg.Pool({ connectionString: scopedUrl.toString(), max: 20, connectionTimeoutMillis: 10_000 });
    const db: Database = pool;
    await db.query(schemaSql);
    assert.equal((await db.query('SELECT current_schema() AS name')).rows[0]?.name, schema);

    async function reset(): Promise<void> {
      await releaseAll();
      await db.query('DELETE FROM app_users'); // cascades within the isolated schema
      await db.query('DELETE FROM page_lanes');
    }
    async function workspace(): Promise<string> {
      const userId = randomUUID(), workspaceId = randomUUID();
      await db.query('INSERT INTO app_users(id,facebook_id,name,token_enc) VALUES($1,$2,$3,$4)',
        [userId, numericId(), 'Concurrency test', 'not-used-by-claim']);
      await db.query('INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)', [workspaceId, userId, 'Isolated test workspace']);
      return workspaceId;
    }
    async function seedJobs(workspaceId: string, facebookIds: string[]): Promise<string[]> {
      const pageIds: string[] = [];
      for (const facebookId of facebookIds) {
        const id = randomUUID();
        await db.query(`INSERT INTO pages(id,workspace_id,facebook_id,name,token_enc,status,can_post,can_comment)
          VALUES($1,$2,$3,$4,$5,'connected',true,true)`,
        [id, workspaceId, facebookId, 'Concurrency test Page', 'not-used-by-claim']);
        pageIds.push(id);
      }
      const campaignId = randomUUID();
      await db.query(`INSERT INTO campaigns(id,workspace_id,title,text,page_ids,status,idempotency_key,body_hash)
        VALUES($1,$2,'Concurrency test','No Meta call is made',$3,'queued',$4,'fixture')`,
      [campaignId, workspaceId, pageIds, randomUUID()]);
      const ids: string[] = [];
      for (const pageId of pageIds) {
        const id = randomUUID();
        await db.query(`INSERT INTO jobs(id,workspace_id,campaign_id,page_id,kind,status,phase,scheduled_at)
          VALUES($1,$2,$3,$4,'publish','queued','publish',now()-interval '1 minute')`,
        [id, workspaceId, campaignId, pageId]);
        ids.push(id);
      }
      return ids;
    }
    async function take(): Promise<ClaimedJob | null> {
      const claim = await claimJob(db);
      if (claim) held.add(claim);
      return claim;
    }
    async function scenario(name: string, run: () => Promise<void>): Promise<void> {
      await t.test(name, async () => {
        await reset();
        try { await run(); } finally { await releaseAll(); }
      });
    }

    await scenario('eight simultaneous workers never claim a job twice and respect workspace caps', async () => {
      for (let i = 0; i < 3; i++) await seedJobs(await workspace(), Array.from({ length: 6 }, numericId));
      // Catch each outcome so all concurrent callers finish before cleanup, even if one fails.
      const outcomes = await Promise.all(Array.from({ length: 8 }, async () => {
        try { return { claim: await take(), error: null }; }
        catch (error) { return { claim: null, error }; }
      }));
      const errors = outcomes.filter(result => result.error !== null).map(result => result.error);
      assert.deepEqual(errors, [], 'Concurrent claims should not throw.');
      const claims = outcomes.flatMap(result => result.claim ? [result.claim] : []);
      assert.ok(claims.length >= 1, 'At least one worker should make progress.');
      // Some workers may return null when locks contend; successful claims must be unique.
      assert.equal(new Set(claims.map(claim => claim.job.id)).size, claims.length);
      const pids = await Promise.all(claims.map(async claim => (await claim.client.query('SELECT pg_backend_pid() AS pid')).rows[0]!.pid));
      assert.equal(new Set(pids).size, claims.length, 'Held claims use separate PostgreSQL sessions.');
      const running = (await db.query("SELECT workspace_id,count(*)::integer AS total FROM jobs WHERE status='running' GROUP BY workspace_id")).rows;
      assert.ok(running.every(row => row.total <= 2), 'No workspace may exceed two running jobs.');
      assert.equal(running.reduce((sum, row) => sum + row.total, 0), claims.length);
      assert.equal((await db.query('SELECT max(attempts) AS attempts FROM jobs')).rows[0]!.attempts, 1);
    });

    await scenario('a workspace admits two active jobs and resumes after one finishes', async () => {
      const workspaceId = await workspace();
      await seedJobs(workspaceId, Array.from({ length: 5 }, numericId));
      const first = await take(), second = await take();
      assert.ok(first && second);
      assert.notEqual(first.job.id, second.job.id);
      assert.equal(await take(), null, 'A third job must wait even when its Page is different.');
      await releaseClaim(first);
      const next = await take();
      assert.ok(next);
      assert.equal(next.job.workspace_id, workspaceId);
      assert.notEqual(next.job.id, first.job.id);
      assert.notEqual(next.job.id, second.job.id);
      assert.equal((await db.query("SELECT count(*)::integer AS total FROM jobs WHERE status='running'")).rows[0]!.total, 2);
    });

    await scenario('one Facebook Page is serialized globally across two workspaces', async () => {
      const sharedPage = numericId();
      await seedJobs(await workspace(), [sharedPage]);
      await seedJobs(await workspace(), [sharedPage]);

      // An independent session holding only the Page lock must block both queued jobs.
      const blocker = await db.connect();
      try {
        await blocker.query("SELECT pg_advisory_lock(hashtextextended('page:'||$1,0))", [sharedPage]);
        assert.equal(await take(), null, 'Page advisory locks must apply across sessions and workspaces.');
      } finally {
        try { await blocker.query("SELECT pg_advisory_unlock(hashtextextended('page:'||$1,0))", [sharedPage]); }
        finally { blocker.release(); }
      }

      const first = await take();
      assert.ok(first);
      assert.equal(first.job.facebook_id, sharedPage);
      assert.equal(await take(), null, 'Another workspace cannot publish to the same Page concurrently.');
      await releaseClaim(first);
      const second = await take();
      assert.ok(second);
      assert.equal(second.job.facebook_id, sharedPage);
      assert.notEqual(second.job.workspace_id, first.job.workspace_id);
    });

    await scenario('stale writes become uncertain while video polling keeps its uploaded ID', async () => {
      const [writeId, videoJobId, liveId] = await seedJobs(await workspace(), Array.from({ length: 3 }, numericId));
      const videoId = numericId();
      await db.query(`UPDATE jobs SET status='running',locked_until=now()-interval '1 minute',attempts=1 WHERE id=$1`, [writeId]);
      await db.query(`UPDATE jobs SET status='running',phase='video_wait',video_id=$2,facebook_post_id=$2,
        locked_until=now()-interval '1 minute',attempts=2 WHERE id=$1`, [videoJobId, videoId]);
      await db.query(`UPDATE jobs SET status='running',locked_until=now()+interval '2 minutes',attempts=1 WHERE id=$1`, [liveId]);
      await recoverStaleJobs(db);
      const rows = (await db.query('SELECT id,status,phase,video_id,facebook_post_id,locked_until,attempts FROM jobs')).rows;
      const write = rows.find(row => row.id === writeId)!;
      const video = rows.find(row => row.id === videoJobId)!;
      assert.equal(write.status, 'uncertain');
      assert.equal(write.locked_until, null);
      assert.equal(write.attempts, 1, 'Recovery must not replay the stale mutation.');
      assert.equal(video.status, 'retrying');
      assert.equal(video.phase, 'video_wait');
      assert.equal(video.video_id, videoId);
      assert.equal(video.facebook_post_id, videoId);
      assert.equal(video.attempts, 2);
      assert.equal(rows.find(row => row.id === liveId)!.status, 'running', 'A live lease is not recovered.');
      await recoverStaleJobs(db); // repeating recovery must leave the retained result intact
      const resumed = await take();
      assert.ok(resumed);
      assert.equal(resumed.job.id, videoJobId, 'Only the read-only polling step may resume automatically.');
      assert.equal(resumed.job.phase, 'video_wait');
      assert.equal(resumed.job.video_id, videoId);
      assert.equal((await db.query('SELECT status FROM jobs WHERE id=$1', [writeId])).rows[0]!.status, 'uncertain');
    });
  } finally {
    try { await releaseAll(); }
    finally {
      try { await pool?.end(); }
      finally {
        try { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
        finally { await admin.end(); }
      }
    }
  }
});
