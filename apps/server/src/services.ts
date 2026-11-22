import { randomUUID } from 'node:crypto';
import type { AuditEvent, Campaign, CampaignInput, Job, Page } from '../../../packages/shared/src/index.js';
import { validateSchedule } from '../../../packages/shared/src/index.js';
import type { Config } from './config.js';
import { decryptToken, encryptToken, sha256 } from './crypto.js';
import { transaction, type Database, type Queryable } from './db.js';
import { MetaClient, MetaError, type MetaIdentity, type MetaPage } from './meta.js';

export class HttpError extends Error { constructor(public statusCode: number, message: string) { super(message); this.name = 'HttpError'; } }
export const iso = (v: Date | string | null): string | null => v ? new Date(v).toISOString() : null;
export function pageView(row: any): Page { return {
  id: row.id, facebookId: row.facebook_id, name: row.name, category: row.category,
  status: row.status, canPost: row.can_post, canComment: row.can_comment, tasks: row.tasks,
  lastSyncedAt: iso(row.last_synced_at)!, tokenExpiresAt: iso(row.token_expires_at)
}; }
export function campaignView(row: any): Campaign { return {
  id: row.id, title: row.title, text: row.text, media: row.media, firstComment: row.first_comment,
  pageIds: row.page_ids, scheduledAt: iso(row.scheduled_at), status: row.status, createdAt: iso(row.created_at)!
}; }
export function jobView(row: any): Job { return {
  id: row.id, campaignId: row.campaign_id, pageId: row.page_id, pageName: row.page_name,
  type: row.kind, status: row.status, scheduledAt: iso(row.scheduled_at)!, attempts: row.attempts,
  facebookPostId: row.facebook_post_id, facebookCommentId: row.facebook_comment_id,
  error: row.last_error, retrySafe: row.retry_safe, createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!
}; }
export function auditView(row: any): AuditEvent { return { id: row.id, action: row.action, detail: row.detail, createdAt: iso(row.created_at)! }; }
export async function audit(db: Queryable, workspaceId: string, action: string, detail: string): Promise<void> {
  await db.query('INSERT INTO audit_events(id,workspace_id,action,detail) VALUES($1,$2,$3,$4)', [randomUUID(), workspaceId, action, detail.slice(0, 500)]);
}
export function permissionsForPage(tasks: string[], grants: string[]): { canPost: boolean; canComment: boolean } {
  const canPost = tasks.includes('CREATE_CONTENT') && ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'].every(s => grants.includes(s));
  const canComment = tasks.includes('MODERATE') && ['pages_show_list', 'pages_read_engagement', 'pages_read_user_content', 'pages_manage_engagement'].every(s => grants.includes(s));
  return { canPost, canComment };
}
async function upsertPages(db: Queryable, workspaceId: string, pages: MetaPage[], permissions: string[], config: Config): Promise<void> {
  const facebookIds: string[] = [];
  for (const page of pages) {
    facebookIds.push(page.id);
    const caps = permissionsForPage(page.tasks, permissions);
    await db.query(`INSERT INTO pages(id,workspace_id,facebook_id,name,category,tasks,token_enc,status,can_post,can_comment)
      VALUES($1,$2,$3,$4,$5,$6,$7,'connected',$8,$9)
      ON CONFLICT(workspace_id,facebook_id) DO UPDATE SET name=excluded.name,category=excluded.category,tasks=excluded.tasks,
      token_enc=excluded.token_enc,status='connected',can_post=excluded.can_post,can_comment=excluded.can_comment,last_synced_at=now()`,
      [randomUUID(), workspaceId, page.id, page.name, page.category || '', JSON.stringify(page.tasks),
        encryptToken(page.access_token, config.TOKEN_ENCRYPTION_KEY, `page:${workspaceId}:${page.id}`), caps.canPost, caps.canComment]);
  }
  await db.query(`UPDATE pages SET status='disconnected',token_enc='',can_post=false,can_comment=false
    WHERE workspace_id=$1 AND NOT(facebook_id=ANY($2::text[]))`, [workspaceId, facebookIds]);
  await db.query(`UPDATE jobs SET status='canceled',last_error='Page không còn được cấp quyền.',updated_at=now()
    WHERE workspace_id=$1 AND status IN ('queued','retrying') AND page_id IN(SELECT id FROM pages WHERE workspace_id=$1 AND status='disconnected')`, [workspaceId]);
}
export async function saveIdentity(db: Database, identity: MetaIdentity, config: Config): Promise<{ userId: string; workspaceId: string }> {
  return transaction(db, async tx => {
    const user = (await tx.query(`INSERT INTO app_users(id,facebook_id,name,token_enc,permissions,token_expires_at,data_expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(facebook_id) DO UPDATE SET name=excluded.name,token_enc=excluded.token_enc,
      permissions=excluded.permissions,token_expires_at=excluded.token_expires_at,data_expires_at=excluded.data_expires_at RETURNING id`,
      [randomUUID(), identity.facebookId, identity.name, encryptToken(identity.token, config.TOKEN_ENCRYPTION_KEY, `user:${identity.facebookId}`),
        JSON.stringify(identity.permissions), identity.expiresAt, identity.dataExpiresAt])).rows[0]!;
    await tx.query('INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO NOTHING', [randomUUID(), user.id, `${identity.name} · Workspace`]);
    const workspace = (await tx.query('SELECT id FROM workspaces WHERE owner_id=$1', [user.id])).rows[0]!;
    await upsertPages(tx, workspace.id, identity.pages, identity.permissions, config);
    await audit(tx, workspace.id, 'facebook.connected', `Đã đồng bộ ${identity.pages.length} Page được cấp quyền.`);
    return { userId: user.id, workspaceId: workspace.id };
  });
}
export async function syncPages(db: Database, userId: string, workspaceId: string, meta: MetaClient, config: Config): Promise<void> {
  const row = (await db.query(`SELECT u.* FROM app_users u JOIN workspaces w ON w.owner_id=u.id WHERE u.id=$1 AND w.id=$2`, [userId, workspaceId])).rows[0];
  if (!row) throw new HttpError(401, 'Phiên đăng nhập đã hết hạn.');
  const token = decryptToken(row.token_enc, config.TOKEN_ENCRYPTION_KEY, `user:${row.facebook_id}`);
  try {
    const grants = await meta.permissions(token);
    const pages = grants.includes('pages_show_list') ? await meta.listPages(token) : [];
    await transaction(db, async tx => {
      await tx.query('UPDATE app_users SET permissions=$1 WHERE id=$2', [JSON.stringify(grants), userId]);
      await upsertPages(tx, workspaceId, pages, grants, config);
      await audit(tx, workspaceId, 'pages.synced', `Đã đồng bộ ${pages.length} Page.`);
    });
  } catch (error) {
    if (error instanceof MetaError && error.tokenInvalid) await db.query("UPDATE pages SET status='expired',can_post=false,can_comment=false WHERE workspace_id=$1", [workspaceId]);
    throw error;
  }
}
export async function requireOwnedPages(db: Queryable, workspaceId: string, ids: string[], needsComment = false, enforceCaps = true): Promise<any[]> {
  if (!ids.length) return [];
  const rows = (await db.query('SELECT * FROM pages WHERE workspace_id=$1 AND id=ANY($2::uuid[])', [workspaceId, ids])).rows;
  if (rows.length !== ids.length) throw new HttpError(403, 'Có Page không thuộc workspace này.');
  if (enforceCaps && rows.some(row => row.status !== 'connected' || !row.can_post || (needsComment && !row.can_comment))) throw new HttpError(409, 'Page thiếu quyền đăng bài/bình luận hoặc cần kết nối lại.');
  return rows;
}
async function queueJobs(db: Queryable, workspaceId: string, campaign: any): Promise<void> {
  const active = (await db.query("SELECT count(*)::integer AS total FROM jobs WHERE workspace_id=$1 AND status IN ('queued','running','retrying')", [workspaceId])).rows[0]!.total;
  if (active + campaign.page_ids.length > 1000) throw new HttpError(429, 'Workspace đã đạt giới hạn 1.000 tác vụ đang chờ.');
  for (const pageId of campaign.page_ids) await db.query(`INSERT INTO jobs(id,workspace_id,campaign_id,page_id,kind,status,phase,scheduled_at)
    VALUES($1,$2,$3,$4,'publish','queued','publish',COALESCE($5,now())) ON CONFLICT(campaign_id,page_id,kind) DO NOTHING`,
    [randomUUID(), workspaceId, campaign.id, pageId, campaign.scheduled_at]);
}
export async function createCampaign(db: Database, workspaceId: string, input: CampaignInput, key: string): Promise<Campaign> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) throw new HttpError(400, 'Thiếu Idempotency-Key hợp lệ.');
  const hash = sha256(JSON.stringify(input));
  return transaction(db, async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('workspace:'||$1,0))", [workspaceId]);
    const existing = (await tx.query('SELECT * FROM campaigns WHERE workspace_id=$1 AND idempotency_key=$2', [workspaceId, key])).rows[0];
    if (existing) {
      if (existing.body_hash !== hash) throw new HttpError(409, 'Idempotency-Key đã dùng cho nội dung khác.');
      return campaignView(existing);
    }
    if (input.action === 'queue') { try { validateSchedule(input.scheduledAt); } catch (e) { throw new HttpError(400, (e as Error).message); } }
    await requireOwnedPages(tx, workspaceId, input.pageIds, Boolean(input.firstComment), input.action === 'queue');
    const row = (await tx.query(`INSERT INTO campaigns(id,workspace_id,title,text,media,first_comment,page_ids,scheduled_at,status,idempotency_key,body_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [randomUUID(), workspaceId, input.title, input.text,
      input.media ? JSON.stringify(input.media) : null, input.firstComment, input.pageIds, input.scheduledAt, input.action === 'draft' ? 'draft' : 'queued', key, hash])).rows[0]!;
    if (input.action === 'queue') await queueJobs(tx, workspaceId, row);
    await audit(tx, workspaceId, input.action === 'queue' ? 'campaign.queued' : 'draft.created', `${input.title} · ${input.pageIds.length} Page`);
    return campaignView(row);
  });
}
export async function publishDraft(db: Database, workspaceId: string, id: string, scheduledAt?: string | null): Promise<Campaign> {
  return transaction(db, async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('workspace:'||$1,0))", [workspaceId]);
    const row = (await tx.query('SELECT * FROM campaigns WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [id, workspaceId])).rows[0];
    if (!row) throw new HttpError(404, 'Không tìm thấy bản nháp.');
    if (row.status !== 'draft') return campaignView(row); // repeat clicks must not create another set of jobs
    const target = scheduledAt === undefined ? iso(row.scheduled_at) : scheduledAt;
    if (!row.page_ids.length) throw new HttpError(400, 'Bản nháp chưa chọn Page. Mở nội dung và chọn Page.');
    try { validateSchedule(target); } catch (e) { throw new HttpError(400, (e as Error).message); }
    await requireOwnedPages(tx, workspaceId, row.page_ids, Boolean(row.first_comment));
    const updated = (await tx.query("UPDATE campaigns SET status='queued',scheduled_at=$3 WHERE id=$1 AND workspace_id=$2 RETURNING *", [id, workspaceId, target])).rows[0]!;
    await queueJobs(tx, workspaceId, updated);
    await audit(tx, workspaceId, 'draft.published', row.title);
    return campaignView(updated);
  });
}
export async function refreshCampaignStatus(db: Queryable, id: string): Promise<void> {
  await db.query(`UPDATE campaigns c SET status=CASE
    WHEN EXISTS(SELECT 1 FROM jobs j WHERE j.campaign_id=c.id AND j.status IN('queued','running','retrying')) THEN 'queued'
    WHEN NOT EXISTS(SELECT 1 FROM jobs j WHERE j.campaign_id=c.id AND j.status<>'succeeded') THEN 'completed'
    WHEN EXISTS(SELECT 1 FROM jobs j WHERE j.campaign_id=c.id AND j.status='succeeded') THEN 'partial'
    WHEN NOT EXISTS(SELECT 1 FROM jobs j WHERE j.campaign_id=c.id AND j.status<>'canceled') THEN 'canceled'
    ELSE 'failed' END WHERE id=$1 AND status<>'draft'`, [id]);
}
export async function changeJob(db: Database, workspaceId: string, id: string, action: 'cancel' | 'retry'): Promise<void> {
  await transaction(db, async tx => {
    const row = (await tx.query('SELECT * FROM jobs WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [id, workspaceId])).rows[0];
    if (!row) throw new HttpError(404, 'Không tìm thấy tác vụ.');
    if (action === 'cancel') {
      if (!['queued', 'retrying', 'failed', 'uncertain'].includes(row.status)) throw new HttpError(409, 'Chỉ hủy được tác vụ chưa chạy hoặc đã dừng.');
      await tx.query("UPDATE jobs SET status='canceled',updated_at=now() WHERE id=$1", [id]);
    } else {
      if (row.status !== 'failed' || !row.retry_safe) throw new HttpError(409, 'Không thể tự gửi lại tác vụ này. Cần kiểm tra kết quả trên Facebook.');
      await requireOwnedPages(tx, workspaceId, [row.page_id], row.kind === 'comment');
      await tx.query("UPDATE jobs SET status='queued',scheduled_at=now(),attempts=0,last_error=NULL,updated_at=now() WHERE id=$1", [id]);
    }
    await refreshCampaignStatus(tx, row.campaign_id);
    await audit(tx, workspaceId, `job.${action}`, `${row.kind} · ${id}`);
  });
}
export async function disconnectPage(db: Database, workspaceId: string, id: string): Promise<void> {
  await transaction(db, async tx => {
    const row = (await tx.query('SELECT * FROM pages WHERE id=$1 AND workspace_id=$2', [id, workspaceId])).rows[0];
    if (!row) throw new HttpError(404, 'Không tìm thấy Page.');
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('page:'||$1,0))", [row.facebook_id]);
    await tx.query("UPDATE pages SET token_enc='',status='disconnected',can_post=false,can_comment=false WHERE id=$1 AND workspace_id=$2", [id, workspaceId]);
    await tx.query("UPDATE jobs SET status='canceled',last_error='Đã ngắt kết nối Page.',updated_at=now() WHERE page_id=$1 AND workspace_id=$2 AND status IN('queued','retrying')", [id, workspaceId]);
    await audit(tx, workspaceId, 'page.disconnected', row.name);
  });
}
export async function deleteUserData(db: Database, facebookId: string): Promise<string> {
  const code = randomUUID();
  await transaction(db, async tx => {
    const pages = (await tx.query(`SELECT p.facebook_id FROM pages p JOIN workspaces w ON w.id=p.workspace_id JOIN app_users u ON u.id=w.owner_id
      WHERE u.facebook_id=$1 ORDER BY p.facebook_id`, [facebookId])).rows;
    for (const p of pages) await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('page:'||$1,0))", [p.facebook_id]);
    await tx.query('DELETE FROM app_users WHERE facebook_id=$1', [facebookId]);
    await tx.query('DELETE FROM page_lanes l WHERE NOT EXISTS(SELECT 1 FROM pages p WHERE p.facebook_id=l.facebook_id)');
    await tx.query("INSERT INTO deletion_receipts(code,status) VALUES($1,'completed')", [code]);
  });
  return code;
}
