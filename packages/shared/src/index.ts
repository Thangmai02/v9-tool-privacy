import { z } from 'zod';

export const JOB_STATUSES = ['queued', 'running', 'retrying', 'succeeded', 'failed', 'uncertain', 'canceled'] as const;
export type JobStatus = typeof JOB_STATUSES[number];
export type PageStatus = 'connected' | 'expired' | 'disconnected';
export interface Page {
  id: string; facebookId: string; name: string; category: string;
  status: PageStatus; canPost: boolean; canComment: boolean; tasks: string[];
  lastSyncedAt: string; tokenExpiresAt: string | null;
}
export interface Media { kind: 'image' | 'video'; url: string; }
export interface Campaign {
  id: string; title: string; text: string; media: Media | null;
  firstComment: string; pageIds: string[]; scheduledAt: string | null;
  status: 'draft' | 'queued' | 'completed' | 'partial' | 'failed' | 'canceled';
  createdAt: string;
}
export interface Job {
  id: string; campaignId: string; pageId: string; pageName: string;
  type: 'publish' | 'comment'; status: JobStatus; scheduledAt: string;
  attempts: number; facebookPostId: string | null; facebookCommentId: string | null;
  retrySafe?: boolean;
  error: string | null; createdAt: string; updatedAt: string;
}
export interface Session {
  user: { id: string; name: string };
  workspace: { id: string; name: string };
  csrfToken: string;
}
export interface AuditEvent { id: string; action: string; detail: string; createdAt: string; }
export interface Settings {
  workerConcurrency: number; pageIntervalSeconds: number; maxPagesPerCampaign: number;
  graphVersion: string; facebookLoginConfigured: boolean; publicBaseUrl: string;
}

// Product limits, intentionally tighter than Meta's changing network limits.
export const LIMITS = { text: 5000, comment: 2000, pages: 25, title: 120 } as const;
export function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return url.protocol === 'https:' && !url.username && !url.password &&
      !url.port && host.includes('.') && !host.includes(':') &&
      !/^\d+(\.\d+){3}$/.test(host) && !host.endsWith('.local') &&
      !host.endsWith('.localhost') && !host.endsWith('.internal') &&
      !host.endsWith('.test') && !host.endsWith('.invalid') && host !== 'localhost';
  } catch { return false; }
}
export const mediaSchema = z.object({
  kind: z.enum(['image', 'video']),
  url: z.string().max(2048).refine(isPublicHttpsUrl, 'Media cần URL HTTPS công khai, không chứa thông tin đăng nhập.')
}).strict();
export const campaignInputSchema = z.object({
  title: z.string().trim().min(1, 'Hãy đặt tên nội dung.').max(LIMITS.title),
  text: z.string().trim().max(LIMITS.text),
  media: mediaSchema.nullable().default(null),
  firstComment: z.string().trim().max(LIMITS.comment).default(''),
  pageIds: z.array(z.string().uuid()).max(LIMITS.pages).refine(v => new Set(v).size === v.length, 'Page bị trùng.'),
  scheduledAt: z.string().datetime({ offset: true }).nullable().default(null),
  action: z.enum(['draft', 'queue'])
}).strict().superRefine((value, ctx) => {
  if (!value.text && !value.media) ctx.addIssue({ code: 'custom', path: ['text'], message: 'Cần nội dung hoặc ảnh/video.' });
  if (value.action === 'queue' && !value.pageIds.length) ctx.addIssue({ code: 'custom', path: ['pageIds'], message: 'Chọn ít nhất một Page.' });
});
export type CampaignInput = z.infer<typeof campaignInputSchema>;
export function validateSchedule(scheduledAt: string | null, now = Date.now()): void {
  if (scheduledAt && new Date(scheduledAt).getTime() <= now + 30_000) throw new Error('Lịch đăng phải sau thời điểm hiện tại ít nhất 30 giây.');
  if (scheduledAt && new Date(scheduledAt).getTime() > now + 366 * 86400_000) throw new Error('Chỉ lên lịch trong vòng 366 ngày.');
}
