import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import { decryptToken } from './crypto.js';
import type { Database, DbClient, Queryable } from './db.js';
import { MetaClient, MetaError } from './meta.js';
import { audit, refreshCampaignStatus } from './services.js';

export interface ClaimedJob { client: DbClient; job: any; }
export function retryDelay(attempt: number, providerSeconds: number, random = Math.random()): number {
  return Math.max(providerSeconds, Math.min(3600, 30 * 2 ** Math.min(attempt, 7))) + Math.floor(random * 15);
}
export async function recoverStaleJobs(db: Queryable): Promise<void> {
  // A mutation may have succeeded at Meta before the process died. Never replay it blindly.
  const rows = (await db.query(`UPDATE jobs SET status=CASE WHEN phase='video_wait' AND video_id IS NOT NULL THEN 'retrying' ELSE 'uncertain' END,
    last_error=CASE WHEN phase='video_wait' AND video_id IS NOT NULL THEN 'Tiếp tục kiểm tra video sau khi worker khởi động lại.' ELSE 'Worker dừng trước khi xác nhận kết quả. Kiểm tra trên Facebook.' END,
    scheduled_at=now(),locked_until=NULL,updated_at=now() WHERE status='running' AND locked_until<now() RETURNING campaign_id`)).rows;
  for (const row of rows) await refreshCampaignStatus(db, row.campaign_id);
}
export async function claimJob(db: Database): Promise<ClaimedJob | null> {
  const candidates = (await db.query(`SELECT j.id FROM jobs j JOIN pages p ON p.id=j.page_id
    LEFT JOIN page_lanes l ON l.facebook_id=p.facebook_id
    WHERE j.status IN('queued','retrying') AND j.scheduled_at<=now() AND (l.next_allowed_at IS NULL OR l.next_allowed_at<=now())
    AND NOT EXISTS(SELECT 1 FROM jobs running JOIN pages rp ON rp.id=running.page_id WHERE running.status='running' AND rp.facebook_id=p.facebook_id)
    AND (SELECT count(*) FROM jobs busy WHERE busy.workspace_id=j.workspace_id AND busy.status='running')<2
    ORDER BY j.scheduled_at,j.created_at LIMIT 30`)).rows;
  for (const candidate of candidates) {
    const client = await db.connect(); let pageLock: string | null = null;
    try {
      await client.query('BEGIN');
      const job = (await client.query(`SELECT j.*,p.facebook_id,p.name AS page_name,p.token_enc,p.status AS page_status,p.can_post,p.can_comment,
        c.text,c.media,c.first_comment,u.data_expires_at FROM jobs j JOIN pages p ON p.id=j.page_id
        JOIN campaigns c ON c.id=j.campaign_id JOIN workspaces w ON w.id=j.workspace_id JOIN app_users u ON u.id=w.owner_id
        WHERE j.id=$1 AND j.status IN('queued','retrying') AND j.scheduled_at<=now() FOR UPDATE OF j SKIP LOCKED`, [candidate.id])).rows[0];
      if (!job) { await client.query('ROLLBACK'); client.release(); continue; }
      const workspaceLock = (await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('claim-workspace:'||$1,0)) AS acquired", [job.workspace_id])).rows[0]!.acquired;
      if (!workspaceLock) { await client.query('ROLLBACK'); client.release(); continue; }
      const busy = (await client.query("SELECT count(*)::integer AS total FROM jobs WHERE workspace_id=$1 AND status='running'", [job.workspace_id])).rows[0]!.total;
      if (busy >= 2) { await client.query('ROLLBACK'); client.release(); continue; }
      const acquired = (await client.query("SELECT pg_try_advisory_lock(hashtextextended('page:'||$1,0)) AS acquired", [job.facebook_id])).rows[0]!.acquired;
      if (!acquired) { await client.query('ROLLBACK'); client.release(); continue; }
      pageLock = job.facebook_id;
      const lane = (await client.query('SELECT next_allowed_at>now() AS waiting FROM page_lanes WHERE facebook_id=$1', [job.facebook_id])).rows[0];
      if (lane?.waiting) {
        await client.query('ROLLBACK');
        await client.query("SELECT pg_advisory_unlock(hashtextextended('page:'||$1,0))", [job.facebook_id]);
        client.release(); continue;
      }
      const updated = (await client.query("UPDATE jobs SET status='running',attempts=attempts+1,locked_until=now()+interval '120 seconds',updated_at=now() WHERE id=$1 RETURNING attempts", [job.id])).rows[0]!;
      job.attempts = updated.attempts;
      await client.query('COMMIT');
      return { client, job };
    } catch (e) {
      let broken = false;
      try { await client.query('ROLLBACK'); if (pageLock) await client.query("SELECT pg_advisory_unlock(hashtextextended('page:'||$1,0))", [pageLock]); }
      catch { broken = true; }
      finally { client.release(broken); }
      throw e;
    }
  }
  return null;
}
async function succeedPublish(db: Queryable, job: any, postId: string): Promise<void> {
  // Persist post id and comment job together; comment failure cannot replay the post.
  await db.query('BEGIN');
  try {
    await db.query("UPDATE jobs SET status='succeeded',facebook_post_id=$2,last_error=NULL,locked_until=NULL,updated_at=now() WHERE id=$1", [job.id, postId]);
    if (job.first_comment) await db.query(`INSERT INTO jobs(id,workspace_id,campaign_id,page_id,kind,status,phase,facebook_post_id)
      VALUES($1,$2,$3,$4,'comment','queued','comment',$5) ON CONFLICT(campaign_id,page_id,kind) DO NOTHING`,
      [randomUUID(), job.workspace_id, job.campaign_id, job.page_id, postId]);
    await audit(db, job.workspace_id, 'post.published', `${job.page_name} · ${postId}`);
    await refreshCampaignStatus(db, job.campaign_id);
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK'); throw e; }
}
export async function executeClaim(claim: ClaimedJob, config: Config, meta: MetaClient): Promise<void> {
  const { client, job } = claim;
  let mutationStarted = false; let cooldown = config.PAGE_INTERVAL_SECONDS;
  const heartbeat = setInterval(() => { void client.query("UPDATE jobs SET locked_until=now()+interval '120 seconds' WHERE id=$1 AND status='running'", [job.id]).catch(() => {}); }, 25_000);
  heartbeat.unref();
  try {
    if (job.page_status !== 'connected' || !job.token_enc || !job.can_post || (job.kind === 'comment' && !job.can_comment) ||
      (job.data_expires_at && new Date(job.data_expires_at).getTime() <= Date.now())) {
      await client.query("UPDATE jobs SET status='failed',retry_safe=true,last_error='Kết nối Page hoặc quyền Facebook đã hết hiệu lực. Hãy kết nối lại.',locked_until=NULL,updated_at=now() WHERE id=$1", [job.id]);
      await refreshCampaignStatus(client, job.campaign_id); return;
    }
    const token = decryptToken(job.token_enc, config.TOKEN_ENCRYPTION_KEY, `page:${job.workspace_id}:${job.facebook_id}`);
    if (job.phase === 'video_wait' && job.video_id) {
      const status = await meta.videoStatus(job.video_id, token);
      if (status === 'ready') { await succeedPublish(client, job, job.video_id); }
      else if (status === 'failed' || job.video_checks >= 119) {
        await client.query("UPDATE jobs SET status='uncertain',retry_safe=false,last_error=$2,locked_until=NULL,updated_at=now() WHERE id=$1", [job.id,
          status === 'failed' ? 'Meta báo xử lý video lỗi. Kiểm tra video trên Facebook trước khi tạo lại.' : 'Chưa xác nhận video công khai sau nhiều lần kiểm tra. Kiểm tra trên Facebook.']);
        await refreshCampaignStatus(client, job.campaign_id);
      } else {
        await client.query("UPDATE jobs SET status='retrying',scheduled_at=now()+interval '30 seconds',video_checks=video_checks+1,last_error='Meta đang xử lý video.',locked_until=NULL,updated_at=now() WHERE id=$1", [job.id]);
      }
    } else if (job.kind === 'comment') {
      mutationStarted = true;
      const commentId = await meta.comment(job.facebook_post_id, token, job.first_comment);
      await client.query("UPDATE jobs SET status='succeeded',facebook_comment_id=$2,last_error=NULL,locked_until=NULL,updated_at=now() WHERE id=$1", [job.id, commentId]);
      await audit(client, job.workspace_id, 'comment.created', `${job.page_name} · ${commentId}`);
      await refreshCampaignStatus(client, job.campaign_id);
    } else {
      mutationStarted = true;
      const result = await meta.publish(job.facebook_id, token, job.text, job.media);
      if (result.videoId) {
        await client.query("UPDATE jobs SET phase='video_wait',video_id=$2,facebook_post_id=$2,status='retrying',scheduled_at=now()+interval '30 seconds',last_error='Meta đã nhận video và đang xử lý.',locked_until=NULL,updated_at=now() WHERE id=$1", [job.id, result.videoId]);
      } else if (result.postId) await succeedPublish(client, job, result.postId);
      else throw new MetaError('Meta chưa xác nhận mã bài viết.', null, false, true);
    }
  } catch (error) {
    const known = error instanceof MetaError;
    const uncertain = known ? error.uncertain : mutationStarted;
    const safe = known ? error.retrySafe : !mutationStarted;
    const autoRetry = known && ((error.rateLimited && job.attempts < 6) || (job.phase === 'video_wait' && error.retrySafe && job.attempts < 120));
    cooldown = known && error.rateLimited ? retryDelay(job.attempts, error.retryAfterSeconds) : cooldown;
    const status = uncertain ? 'uncertain' : autoRetry ? 'retrying' : 'failed';
    const message = known ? error.message : uncertain ? 'Chưa lưu được xác nhận sau khi gửi Meta. Kiểm tra trên Facebook trước khi tạo lại.' : 'Lỗi cấu hình hoặc lưu trữ. Quản trị viên cần kiểm tra.';
    await client.query(`UPDATE jobs SET status=$2,retry_safe=$3,last_error=$4,scheduled_at=CASE WHEN $2='retrying' THEN now()+($5 * interval '1 second') ELSE scheduled_at END,
      locked_until=NULL,updated_at=now() WHERE id=$1`, [job.id, status, safe && !uncertain, message, cooldown]);
    if (known && error.tokenInvalid) await client.query("UPDATE pages SET status='expired',can_post=false,can_comment=false WHERE id=$1", [job.page_id]);
    await refreshCampaignStatus(client, job.campaign_id);
  } finally {
    clearInterval(heartbeat);
    let broken = false;
    try {
      await client.query(`INSERT INTO page_lanes(facebook_id,next_allowed_at) VALUES($1,now()+($2*interval '1 second'))
        ON CONFLICT(facebook_id) DO UPDATE SET next_allowed_at=GREATEST(page_lanes.next_allowed_at,excluded.next_allowed_at)`, [job.facebook_id, cooldown]);
    } catch (error) { broken = true; throw error;
    } finally {
      try { await client.query("SELECT pg_advisory_unlock(hashtextextended('page:'||$1,0))", [job.facebook_id]); }
      catch (error) { broken = true; throw error; }
      finally { client.release(broken); }
    }
  }
}
export async function runOneJob(db: Database, config: Config, meta: MetaClient): Promise<boolean> {
  const job = await claimJob(db); if (!job) return false; await executeClaim(job, config, meta); return true;
}
