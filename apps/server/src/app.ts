import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { campaignInputSchema, LIMITS } from '../../../packages/shared/src/index.js';
import { type Config, loginConfigured } from './config.js';
import { randomToken, safeEqual, sha256, verifySignedRequest } from './crypto.js';
import { type Database } from './db.js';
import { MetaClient, MetaError } from './meta.js';
import { getSystemStatus } from './runtime.js';
import { auditView, campaignView, changeJob, createCampaign, deleteUserData, disconnectPage, HttpError, jobView, pageView, publishDraft, saveIdentity, syncPages } from './services.js';

interface Auth { userId: string; workspaceId: string; name: string; workspaceName: string; facebookId: string; csrfToken: string; }
declare module 'fastify' { interface FastifyRequest { auth: Auth | null; } }
export interface AppOptions { config: Config; db: Database; meta?: MetaClient; serveStatic?: boolean; logger?: boolean; }
const idSchema = z.string().uuid();
function idParam(req: FastifyRequest): string {
  const value = idSchema.safeParse((req.params as { id?: string }).id);
  if (!value.success) throw new HttpError(400, 'Mã đối tượng không hợp lệ.');
  return value.data;
}
export async function buildApp({ config, db, meta = new MetaClient(config), serveStatic = true, logger = true }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 128 * 1024, trustProxy: false, disableRequestLogging: true,
    logger: logger ? { level: config.NODE_ENV === 'production' ? 'info' : 'warn',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie', 'body', 'token', 'access_token', 'client_secret'],
      serializers: { req: (req: any) => ({ method: req.method, route: String(req.url || '').split('?')[0] }) } } : false
  });
  app.decorateRequest('auth', null);
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'], mediaSrc: ["'self'", 'https:'], connectSrc: ["'self'"],
      frameAncestors: ["'none'"], formAction: ["'self'"], objectSrc: ["'none'"], upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null } },
    crossOriginEmbedderPolicy: false, referrerPolicy: { policy: 'no-referrer' },
    hsts: config.NODE_ENV === 'production' ? { maxAge: 31536000 } : false
  });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 32_768 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });
  const secure = config.PUBLIC_BASE_URL.startsWith('https:');
  const sessionCookie = secure ? '__Host-v9_session' : 'v9_session';
  const stateCookie = secure ? '__Host-v9_oauth' : 'v9_oauth';
  const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure, path: '/' };
  app.addHook('onRequest', async (req, reply) => {
    const route = req.routeOptions.url || req.url.split('?')[0]!;
    if (!route.startsWith('/api/') && route !== '/auth/logout') return;
    reply.header('Cache-Control', 'no-store');
    if (route === '/api/public-config' && ['GET','HEAD'].includes(req.method)) return;
    const token = req.cookies[sessionCookie];
    if (!token || token.length > 128) throw new HttpError(401, 'Hãy đăng nhập bằng Facebook để tiếp tục.');
    const row = (await db.query(`SELECT s.*,u.name,u.facebook_id,w.name AS workspace_name FROM sessions s
      JOIN app_users u ON u.id=s.user_id JOIN workspaces w ON w.id=s.workspace_id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND w.owner_id=u.id`, [sha256(token)])).rows[0];
    if (!row) throw new HttpError(401, 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
    req.auth = { userId: row.user_id, workspaceId: row.workspace_id, name: row.name,
      workspaceName: row.workspace_name, facebookId: row.facebook_id, csrfToken: row.csrf_token };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      const csrf = req.headers['x-csrf-token'];
      if (origin !== config.PUBLIC_BASE_URL || typeof csrf !== 'string' || !safeEqual(csrf, row.csrf_token)) throw new HttpError(403, 'Yêu cầu không hợp lệ. Tải lại trang và thử lại.');
    }
  });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute', hook: 'preHandler',
    keyGenerator: req => req.auth?.workspaceId || req.ip,
    errorResponseBuilder: () => ({ statusCode: 429, error: 'Quá nhiều yêu cầu. Hãy chờ một phút.', message: 'Quá nhiều yêu cầu. Hãy chờ một phút.' })
  });
  app.setErrorHandler((error, req, reply) => {
    const validation = error instanceof z.ZodError;
    const status = error instanceof HttpError ? error.statusCode : error instanceof MetaError ? (error.rateLimited ? 429 : 502) : validation ? 400 :
      typeof (error as any).statusCode === 'number' && (error as any).statusCode < 500 ? (error as any).statusCode : 500;
    const message = validation ? error.issues[0]?.message || 'Dữ liệu không hợp lệ.' :
      error instanceof HttpError || error instanceof MetaError ? error.message : status < 500 ? 'Yêu cầu không hợp lệ.' : 'Máy chủ chưa xử lý được yêu cầu. Hãy thử lại hoặc liên hệ quản trị viên.';
    if (status >= 500) req.log.error({ route: req.routeOptions.url, errorType: (error as Error).name, status }, 'Request failed');
    reply.status(status).send({ error: message, message });
  });
  app.get('/health', async (_req, reply) => {
    const runtime = await getSystemStatus(db);
    reply.header('Cache-Control', 'no-store');
    // API/schema readiness and worker readiness are separate: the web service
    // should remain reachable during worker startup, maintenance, or reconnects.
    return reply.status(runtime.databaseReady ? 200 : 503).send({ ok: runtime.databaseReady, version: '0.1.0', runtime });
  });
  app.get('/api/public-config', async () => ({
    facebookLoginConfigured: loginConfigured(config),
    oauthRedirectUri: `${config.PUBLIC_BASE_URL}/auth/facebook/callback`,
    runtime: await getSystemStatus(db)
  }));
  app.get('/auth/facebook', async (_req, reply) => {
    if (!loginConfigured(config)) throw new HttpError(503, 'Máy chủ chưa được cấu hình ứng dụng Meta. Quản trị viên cần điền META_APP_ID và META_APP_SECRET trong biến môi trường.');
    const state = randomToken(), browser = randomToken();
    await db.query('DELETE FROM oauth_states WHERE expires_at<now()');
    await db.query("INSERT INTO oauth_states(state_hash,browser_hash,expires_at) VALUES($1,$2,now()+interval '10 minutes')", [sha256(state), sha256(browser)]);
    reply.header('Cache-Control', 'no-store').setCookie(stateCookie, browser, { ...cookieOptions, maxAge: 600 });
    return reply.redirect(meta.authorizationUrl(state));
  });
  app.get('/auth/facebook/callback', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').clearCookie(stateCookie, cookieOptions);
    const query = req.query as Record<string, unknown>;
    const state = typeof query.state === 'string' && query.state.length <= 128 ? query.state : '';
    const browser = req.cookies[stateCookie] || '';
    if (!state || !browser || browser.length > 128) return reply.redirect('/?auth_error=invalid_state');
    const valid = (await db.query('DELETE FROM oauth_states WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING state_hash', [sha256(state), sha256(browser)])).rows[0];
    if (!valid) return reply.redirect('/?auth_error=invalid_state');
    if (query.error) return reply.redirect('/?auth_error=facebook_denied');
    if (typeof query.code !== 'string' || query.code.length > 4096) return reply.redirect('/?auth_error=login_failed');
    try {
      const identity = await meta.resolveLogin(query.code);
      const { userId, workspaceId } = await saveIdentity(db, identity, config);
      const token = randomToken(), csrf = randomToken();
      const previous = req.cookies[sessionCookie];
      if (previous) await db.query('DELETE FROM sessions WHERE token_hash=$1', [sha256(previous)]);
      await db.query('DELETE FROM sessions WHERE expires_at<now()');
      await db.query("INSERT INTO sessions(token_hash,user_id,workspace_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,now()+($5*interval '1 day'))", [sha256(token), userId, workspaceId, csrf, config.SESSION_TTL_DAYS]);
      reply.setCookie(sessionCookie, token, { ...cookieOptions, maxAge: config.SESSION_TTL_DAYS * 86400 });
      return reply.redirect('/');
    } catch (error) {
      req.log.warn({ errorType: (error as Error).name }, 'Facebook login failed');
      return reply.redirect('/?auth_error=login_failed');
    }
  });
  app.post('/auth/logout', async (req, reply) => {
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [sha256(req.cookies[sessionCookie]!)]);
    reply.clearCookie(sessionCookie, cookieOptions); return { ok: true };
  });
  app.get('/api/session', async req => ({ user: { id: req.auth!.userId, name: req.auth!.name },
    workspace: { id: req.auth!.workspaceId, name: req.auth!.workspaceName }, csrfToken: req.auth!.csrfToken }));
  app.get('/api/settings', async () => ({ workerConcurrency: config.WORKER_CONCURRENCY, pageIntervalSeconds: config.PAGE_INTERVAL_SECONDS,
    maxPagesPerCampaign: LIMITS.pages, graphVersion: config.META_GRAPH_VERSION, facebookLoginConfigured: loginConfigured(config),
    publicBaseUrl: config.PUBLIC_BASE_URL, runtime: await getSystemStatus(db) }));
  app.get('/api/pages', async req => ({ pages: (await db.query('SELECT * FROM pages WHERE workspace_id=$1 ORDER BY name', [req.auth!.workspaceId])).rows.map(pageView) }));
  app.post('/api/pages/sync', async req => { await syncPages(db, req.auth!.userId, req.auth!.workspaceId, meta, config); return { ok: true }; });
  app.delete('/api/pages/:id', async req => { await disconnectPage(db, req.auth!.workspaceId, idParam(req)); return { ok: true }; });
  app.get('/api/campaigns', async req => ({ campaigns: (await db.query('SELECT * FROM campaigns WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 200', [req.auth!.workspaceId])).rows.map(campaignView) }));
  app.post('/api/campaigns', async req => {
    const input = campaignInputSchema.parse(req.body);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string') throw new HttpError(400, 'Thiếu Idempotency-Key.');
    return { campaign: await createCampaign(db, req.auth!.workspaceId, input, key) };
  });
  app.post('/api/campaigns/:id/publish', async req => {
    const body = z.object({ scheduledAt: z.string().datetime({ offset: true }).nullable().optional() }).strict().parse(req.body ?? {});
    return { campaign: await publishDraft(db, req.auth!.workspaceId, idParam(req), body.scheduledAt) };
  });
  app.get('/api/jobs', async req => ({ jobs: (await db.query(`SELECT j.*,p.name AS page_name FROM jobs j JOIN pages p ON p.id=j.page_id
    WHERE j.workspace_id=$1 ORDER BY CASE WHEN j.status IN('queued','running','retrying') THEN 0 ELSE 1 END,j.created_at DESC LIMIT 500`, [req.auth!.workspaceId])).rows.map(jobView) }));
  app.post('/api/jobs/:id/cancel', async req => { await changeJob(db, req.auth!.workspaceId, idParam(req), 'cancel'); return { ok: true }; });
  app.post('/api/jobs/:id/retry', async req => { await changeJob(db, req.auth!.workspaceId, idParam(req), 'retry'); return { ok: true }; });
  app.get('/api/audit', async req => ({ events: (await db.query('SELECT * FROM audit_events WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100', [req.auth!.workspaceId])).rows.map(auditView) }));
  app.delete('/api/account', async (req, reply) => {
    const code = await deleteUserData(db, req.auth!.facebookId);
    reply.clearCookie(sessionCookie, cookieOptions);
    return { ok: true, confirmationCode: code, url: `${config.PUBLIC_BASE_URL}/deletion/status/${code}` };
  });
  const callback = async (req: FastifyRequest, deletion: boolean) => {
    if (!loginConfigured(config)) throw new HttpError(403, 'Chưa cấu hình Meta.');
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body.signed_request !== 'string') throw new HttpError(400, 'Thiếu signed_request.');
    let userId: string;
    try { userId = verifySignedRequest(body.signed_request, config.META_APP_SECRET).user_id; }
    catch { throw new HttpError(403, 'Chữ ký Meta không hợp lệ hoặc đã hết hạn.'); }
    const code = await deleteUserData(db, userId);
    return deletion ? { url: `${config.PUBLIC_BASE_URL}/deletion/status/${code}`, confirmation_code: code } : { success: true };
  };
  app.post('/meta/deauthorize', async req => callback(req, false));
  app.post('/meta/data-deletion', async req => callback(req, true));
  app.get('/deletion/status/:code', async (req, reply) => {
    const parsed = idSchema.safeParse((req.params as { code: string }).code);
    const receipt = parsed.success ? (await db.query('SELECT status FROM deletion_receipts WHERE code=$1', [parsed.data])).rows[0] : null;
    reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8');
    if (!receipt) return reply.status(404).send('<!doctype html><html lang="vi"><meta charset="utf-8"><title>Yêu cầu không tồn tại</title><main><h1>Không tìm thấy yêu cầu</h1><p>Kiểm tra lại đường dẫn xác nhận xóa dữ liệu.</p></main></html>');
    return '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Đã xóa dữ liệu · V9</title><main><h1>Đã xóa dữ liệu khỏi V9 Page Studio</h1><p>Kết nối, token, lịch đăng, nội dung đã lưu và nhật ký liên quan trong cơ sở dữ liệu đang hoạt động đã được xóa. Bài viết đã đăng trên Facebook vẫn thuộc Page; hãy quản lý chúng trực tiếp trên Facebook.</p></main></html>';
  });
  if (serveStatic) {
    for (const file of ['privacy-policy.html', 'terms.html', 'data-deletion.html', 'style.css', 'logo.svg']) {
      app.get(`/${file}`, async (_req, reply) => {
        const content = await readFile(path.resolve('public', file));
        return reply.type(file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'image/svg+xml').send(content);
      });
    }
    await app.register(fastifyStatic, { root: path.resolve('dist/web'), prefix: '/', index: ['index.html'], dotfiles: 'deny' });
  }
  return app;
}
