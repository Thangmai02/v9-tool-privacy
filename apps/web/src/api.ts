import type { AuditEvent, Campaign, CampaignInput, Job, Page, Session, Settings } from '../../../packages/shared/src/index.js';

export const PREVIEW = import.meta.env.MODE === 'preview';
export interface Snapshot { pages: Page[]; campaigns: Campaign[]; jobs: Job[]; events: AuditEvent[]; settings: Settings; }
const STORAGE_KEY = 'v9.page-studio.preview.v1';
const id = () => crypto.randomUUID();
const iso = (offset = 0) => new Date(Date.now() + offset).toISOString();
const demoPageIds = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
const demoNames = ['V9 Creative Studio', 'Nhà của Mây', 'The Daily Coffee'];

export const demoSession: Session = {
  user: { id: 'preview', name: 'Bạn' },
  workspace: { id: 'preview', name: 'Không gian V9' },
  csrfToken: 'preview-only',
};

function seed(): Snapshot {
  const pages: Page[] = demoPageIds.map((pageId, i) => ({
    id: pageId, facebookId: '', name: demoNames[i], category: ['Studio sáng tạo', 'Phong cách sống', 'Quán cà phê'][i],
    status: 'connected', canPost: true, canComment: true, tasks: ['CREATE_CONTENT', 'MODERATE'],
    tokenExpiresAt: null, lastSyncedAt: iso(-3600_000),
  }));
  const seeds = [
    { title: 'Một tuần mới, một ý tưởng mới', text: 'Mỗi ngày là một cơ hội để bắt đầu một điều thú vị. Tuần này, bạn đang ấp ủ ý tưởng gì? 🌿', pageIds: [demoPageIds[0], demoPageIds[1]], firstComment: 'Chia sẻ ý tưởng của bạn ở đây nhé.', scheduledAt: iso(7200_000), status: 'queued' as const },
    { title: 'Chậm lại cùng một tách cà phê', text: 'Dành cho những buổi sáng thật chậm. Một tách cà phê, một cuốn sách và một chút thời gian cho riêng mình. ☕', pageIds: [demoPageIds[2]], firstComment: '', scheduledAt: iso(86400_000), status: 'queued' as const },
    { title: 'Chuyện nhỏ hôm nay', text: 'Những khoảnh khắc nhỏ làm nên một ngày đẹp. Cảm ơn bạn đã ở đây cùng chúng mình.', pageIds: [demoPageIds[1]], firstComment: 'Hẹn bạn ở câu chuyện tiếp theo.', scheduledAt: null, status: 'completed' as const },
    { title: 'Bộ sưu tập ý tưởng tháng này', text: 'Một vài điều chúng mình đang chuẩn bị. Mỗi ý tưởng đều bắt đầu từ sự tò mò.', pageIds: [demoPageIds[0]], firstComment: '', scheduledAt: null, status: 'draft' as const },
  ];
  const campaigns: Campaign[] = seeds.map((s, i) => ({ ...s, id: id(), media: null, createdAt: iso(-(i + 1) * 3600_000) }));
  const jobs: Job[] = [];
  for (const campaign of campaigns.filter(c => c.status !== 'draft')) {
    for (const pageId of campaign.pageIds) {
      const succeeded = campaign.status === 'completed';
      jobs.push({ id: id(), campaignId: campaign.id, pageId, pageName: pages.find(p => p.id === pageId)!.name, type: 'publish', status: succeeded ? 'succeeded' : 'queued', scheduledAt: campaign.scheduledAt || iso(-3600_000), attempts: succeeded ? 1 : 0, facebookPostId: null, facebookCommentId: null, error: null, createdAt: campaign.createdAt, updatedAt: campaign.createdAt });
      if (succeeded && campaign.firstComment) jobs.push({ ...jobs[jobs.length - 1], id: id(), type: 'comment', status: 'succeeded' });
    }
  }
  return {
    pages, campaigns, jobs,
    events: [
      { id: id(), action: 'campaign.created', detail: 'Đã thêm nội dung mẫu vào lịch đăng.', createdAt: iso(-1800_000) },
      { id: id(), action: 'preview.ready', detail: 'Không gian trải nghiệm đã sẵn sàng. Mọi dữ liệu bên dưới đều là minh họa.', createdAt: iso(-3600_000) },
    ],
    settings: { workerConcurrency: 4, pageIntervalSeconds: 15, maxPagesPerCampaign: 25, graphVersion: 'v27.0', facebookLoginConfigured: false, publicBaseUrl: '' },
  };
}

function readDemo(): Snapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Snapshot;
      if (Array.isArray(parsed.pages) && Array.isArray(parsed.campaigns) && Array.isArray(parsed.jobs) && Array.isArray(parsed.events) && parsed.settings) return parsed;
    }
  } catch { /* Browsers may disable local storage. In-memory mode still works. */ }
  return seed();
}
let demo = PREVIEW ? readDemo() : null;
function saveDemo(): void { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(demo)); } catch { /* Best-effort preview persistence. */ } }
function event(action: string, detail: string): void { demo!.events.unshift({ id: id(), action, detail, createdAt: iso() }); demo!.events = demo!.events.slice(0, 100); }

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
let csrfToken = '';
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('Content-Type', 'application/json');
  if (init?.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) headers.set('X-CSRF-Token', csrfToken);
  let response: Response;
  try { response = await fetch(path, { ...init, headers, credentials: 'same-origin' }); }
  catch { throw new Error(init?.method && init.method !== 'GET' ? 'Không nhận được kết quả từ máy chủ. Thao tác có thể đã được nhận; kiểm tra hàng đợi trước khi gửi lại.' : 'Không kết nối được máy chủ. Kiểm tra mạng và thử tải lại.'); }
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() as Record<string, unknown> : null;
  if (!response.ok) throw new ApiError(response.status, typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : `Không thể thực hiện yêu cầu (${response.status}).`);
  return body as T;
}
export async function getSession(): Promise<Session> {
  const session = PREVIEW ? demoSession : await request<Session>('/api/session');
  csrfToken = session.csrfToken;
  return session;
}
export async function getSnapshot(): Promise<Snapshot> {
  if (PREVIEW) return structuredClone(demo!);
  const [pages, campaigns, jobs, events, settings] = await Promise.all([
    request<{ pages: Page[] }>('/api/pages'), request<{ campaigns: Campaign[] }>('/api/campaigns'),
    request<{ jobs: Job[] }>('/api/jobs'), request<{ events: AuditEvent[] }>('/api/audit'), request<Settings>('/api/settings'),
  ]);
  return { pages: pages.pages, campaigns: campaigns.campaigns, jobs: jobs.jobs, events: events.events, settings };
}
function queueCampaign(campaign: Campaign): void {
  for (const pageId of campaign.pageIds) {
    const page = demo!.pages.find(p => p.id === pageId)!;
    demo!.jobs.unshift({ id: id(), campaignId: campaign.id, pageId, pageName: page.name, type: 'publish', status: 'queued', scheduledAt: campaign.scheduledAt || iso(), attempts: 0, facebookPostId: null, facebookCommentId: null, error: null, createdAt: iso(), updatedAt: iso() });
  }
  campaign.status = 'queued';
}
export async function createCampaign(input: CampaignInput, requestKey: string): Promise<void> {
  if (!PREVIEW) { await request('/api/campaigns', { method: 'POST', body: JSON.stringify(input), headers: { 'Idempotency-Key': requestKey } }); return; }
  const { action, ...data } = input;
  const campaign: Campaign = { ...data, id: id(), status: action === 'draft' ? 'draft' : 'queued', createdAt: iso() };
  demo!.campaigns.unshift(campaign);
  if (action === 'queue') queueCampaign(campaign);
  event('preview.campaign.created', `${action === 'draft' ? 'Đã lưu nháp' : 'Đã thêm lịch minh họa'}: ${campaign.title}`);
  saveDemo();
}
export async function publishDraft(campaign: Campaign, requestKey: string): Promise<void> {
  if (!PREVIEW) { await request(`/api/campaigns/${campaign.id}/publish`, { method: 'POST', body: JSON.stringify({ scheduledAt: campaign.scheduledAt }), headers: { 'Idempotency-Key': requestKey } }); return; }
  const stored = demo!.campaigns.find(c => c.id === campaign.id);
  if (!stored || stored.status !== 'draft') throw new Error('Bản nháp này đã được đưa vào hàng đợi.');
  queueCampaign(stored);
  event('preview.campaign.queued', `Đã thêm lịch minh họa: ${stored.title}`); saveDemo();
}
export async function jobAction(job: Job, action: 'cancel' | 'retry'): Promise<void> {
  if (!PREVIEW) { await request(`/api/jobs/${job.id}/${action}`, { method: 'POST', body: '{}' }); return; }
  const stored = demo!.jobs.find(j => j.id === job.id);
  if (!stored) return;
  stored.status = action === 'cancel' ? 'canceled' : 'queued'; stored.updatedAt = iso(); stored.error = null;
  event(`preview.job.${action}`, `${action === 'cancel' ? 'Đã hủy' : 'Đã xếp lại'} tác vụ minh họa của ${job.pageName}.`); saveDemo();
}
export async function simulateJobs(): Promise<void> {
  if (!PREVIEW) return;
  let count = 0;
  for (const job of [...demo!.jobs]) {
    if (!['queued', 'retrying'].includes(job.status) || new Date(job.scheduledAt).getTime() > Date.now()) continue;
    job.status = 'succeeded'; job.attempts += 1; job.updatedAt = iso(); count++;
    const campaign = demo!.campaigns.find(c => c.id === job.campaignId);
    if (job.type === 'publish' && campaign?.firstComment) demo!.jobs.unshift({ ...job, id: id(), type: 'comment', createdAt: iso(), updatedAt: iso() });
  }
  for (const campaign of demo!.campaigns) {
    const jobs = demo!.jobs.filter(j => j.campaignId === campaign.id);
    if (jobs.length && jobs.every(j => j.status === 'succeeded')) campaign.status = 'completed';
  }
  event('preview.simulated', `${count} tác vụ đến hạn đã được mô phỏng. Không có nội dung nào gửi lên Facebook.`); saveDemo();
}
export async function syncPages(): Promise<void> {
  if (!PREVIEW) { await request('/api/pages/sync', { method: 'POST', body: '{}' }); return; }
  for (const page of demo!.pages) page.lastSyncedAt = iso();
  event('preview.pages.synced', 'Đã làm mới danh sách Page minh họa.'); saveDemo();
}
export async function disconnectPage(page: Page): Promise<void> {
  if (!PREVIEW) { await request(`/api/pages/${page.id}`, { method: 'DELETE' }); return; }
  const stored = demo!.pages.find(p => p.id === page.id);
  if (stored) { stored.status = 'disconnected'; stored.canPost = false; stored.canComment = false; }
  for (const job of demo!.jobs) if (job.pageId === page.id && ['queued', 'retrying'].includes(job.status)) job.status = 'canceled';
  event('preview.page.disconnected', `Đã ngắt kết nối minh họa với ${page.name}.`); saveDemo();
}
export async function resetDemo(): Promise<void> { if (PREVIEW) { demo = seed(); saveDemo(); } }
export async function logout(): Promise<void> { if (!PREVIEW) await request('/auth/logout', { method: 'POST', body: '{}' }); }
export async function deleteAccount(): Promise<void> { if (!PREVIEW) await request('/api/account', { method: 'DELETE' }); }
