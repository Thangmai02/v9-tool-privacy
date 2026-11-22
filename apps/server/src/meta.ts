import type { Config } from './config.js';
import { META_COMMENT_SCOPES, META_SCOPES } from './config.js';
import { makeAppSecretProof } from './crypto.js';
import type { Media } from '../../../packages/shared/src/index.js';

export interface MetaPage { id: string; name: string; category?: string; access_token: string; tasks: string[]; }
export interface MetaIdentity {
  facebookId: string; name: string; token: string; permissions: string[];
  expiresAt: Date | null; dataExpiresAt: Date | null; pages: MetaPage[];
}
export class MetaError extends Error {
  constructor(message: string, public readonly code: number | null, public readonly retrySafe: boolean,
    public readonly uncertain = false, public readonly retryAfterSeconds = 60) { super(message); this.name = 'MetaError'; }
  get tokenInvalid(): boolean { return this.code === 190 || this.code === 102; }
  get rateLimited(): boolean { return this.code !== null && rateCodes.has(this.code); }
}
const rateCodes = new Set([4, 17, 32, 613, 80001]);
export function usageDelay(headers: Headers): number {
  let seconds = Number(headers.get('retry-after')) || 0;
  try {
    const usage = JSON.parse(headers.get('x-business-use-case-usage') || '{}');
    for (const entries of Object.values(usage)) if (Array.isArray(entries)) {
      for (const entry of entries) seconds = Math.max(seconds, Number(entry.estimated_time_to_regain_access || 0) * 60);
    }
  } catch { /* Provider header is optional; conservative default below. */ }
  return Math.min(24 * 3600, Math.max(60, seconds));
}
export class MetaClient {
  constructor(private readonly config: Config, private readonly fetcher: typeof fetch = fetch) {}
  authorizationUrl(state: string): string {
    const u = new URL(`https://www.facebook.com/${this.config.META_GRAPH_VERSION}/dialog/oauth`);
    const params: Record<string, string> = {
      client_id: this.config.META_APP_ID, redirect_uri: `${this.config.PUBLIC_BASE_URL}/auth/facebook/callback`,
      response_type: 'code', state
    };
    if (this.config.META_LOGIN_CONFIG_ID) params.config_id = this.config.META_LOGIN_CONFIG_ID;
    else params.scope = [...META_SCOPES, ...(this.config.META_ENABLE_COMMENTS ? META_COMMENT_SCOPES : [])].join(',');
    u.search = new URLSearchParams(params).toString();
    return u.toString();
  }
  private async request<T>(path: string, token: string, params: Record<string, string> = {}, method: 'GET' | 'POST' = 'GET', video = false): Promise<T> {
    if (!/^[A-Za-z0-9_/-]+$/.test(path) || path.includes('..')) throw new Error('Invalid Meta API path.');
    const u = new URL(`https://${video ? 'graph-video' : 'graph'}.facebook.com/${this.config.META_GRAPH_VERSION}/${path}`);
    const body = new URLSearchParams(params);
    const headers = new Headers({ Accept: 'application/json' });
    if (token) { headers.set('Authorization', `Bearer ${token}`); body.set('appsecret_proof', makeAppSecretProof(token, this.config.META_APP_SECRET)); }
    if (method === 'GET') u.search = body.toString();
    else headers.set('Content-Type', 'application/x-www-form-urlencoded');
    let response: Response;
    try {
      response = await this.fetcher(u, { method, headers, body: method === 'POST' ? body : undefined,
        signal: AbortSignal.timeout(video ? 60_000 : 30_000), redirect: 'error' });
    } catch { throw new MetaError(method === 'POST' ? 'Không rõ Meta đã xử lý yêu cầu. Hãy kiểm tra trên Facebook trước khi tạo lại.' : 'Không kết nối được Meta. Thử lại sau.', null, method === 'GET', method === 'POST'); }
    let data: any;
    try {
      const raw = await response.text();
      if (raw.length > 2_000_000) throw new Error('Oversized response');
      data = JSON.parse(raw);
    } catch { throw new MetaError('Meta trả về kết quả không xác định. Cần kiểm tra trước khi gửi lại.', null, method === 'GET', method === 'POST'); }
    if (data.error || !response.ok) {
      const code = Number(data.error?.code) || null;
      const rate = code !== null && rateCodes.has(code);
      const uncertain = method === 'POST' && !rate && (response.status >= 500 || code === 1 || code === 2 || !data.error);
      const message = rate ? 'Đã chạm giới hạn Meta. Tác vụ sẽ chờ rồi thử lại.' :
        code === 190 || code === 102 ? 'Kết nối Facebook hết hiệu lực. Hãy kết nối lại Page.' :
        uncertain ? 'Meta chưa xác nhận kết quả. Cần kiểm tra trên Facebook.' : `Meta từ chối yêu cầu${code ? ` (mã ${code})` : ''}. Kiểm tra quyền, nội dung và kết nối Page.`;
      throw new MetaError(message, code, !uncertain && (Boolean(data.error) || method === 'GET'), uncertain, usageDelay(response.headers));
    }
    return data as T;
  }
  async resolveLogin(code: string): Promise<MetaIdentity> {
    const oauth = await this.request<{ access_token: string }>('oauth/access_token', '', {
      client_id: this.config.META_APP_ID, client_secret: this.config.META_APP_SECRET,
      redirect_uri: `${this.config.PUBLIC_BASE_URL}/auth/facebook/callback`, code
    });
    if (!oauth.access_token) throw new MetaError('Facebook không cấp access token.', null, false);
    const long = await this.request<{ access_token: string }>('oauth/access_token', '', {
      client_id: this.config.META_APP_ID, client_secret: this.config.META_APP_SECRET,
      grant_type: 'fb_exchange_token', fb_exchange_token: oauth.access_token
    });
    if (!long.access_token) throw new MetaError('Không đổi được token dài hạn.', null, false);
    const token = long.access_token;
    const debug = await this.request<{ data: { is_valid: boolean; app_id: string; user_id: string; expires_at?: number; data_access_expires_at?: number } }>(
      'debug_token', `${this.config.META_APP_ID}|${this.config.META_APP_SECRET}`, { input_token: token });
    const info = debug.data;
    if (!info?.is_valid || String(info.app_id) !== this.config.META_APP_ID || !/^\d+$/.test(info.user_id || '')) throw new MetaError('Token không thuộc ứng dụng hoặc không hợp lệ.', null, false);
    const me = await this.request<{ id: string; name: string }>('me', token, { fields: 'id,name' });
    if (me.id !== info.user_id) throw new MetaError('Danh tính Facebook không khớp token.', null, false);
    const permissions = await this.permissions(token);
    const pages = permissions.includes('pages_show_list') ? await this.listPages(token) : [];
    return { facebookId: me.id, name: me.name, token, permissions, pages,
      expiresAt: info.expires_at ? new Date(info.expires_at * 1000) : null,
      dataExpiresAt: info.data_access_expires_at ? new Date(info.data_access_expires_at * 1000) : null };
  }
  async permissions(token: string): Promise<string[]> {
    const data = await this.request<{ data: { permission: string; status: string }[] }>('me/permissions', token);
    return (data.data || []).filter(v => v.status === 'granted').map(v => v.permission);
  }
  async listPages(token: string): Promise<MetaPage[]> {
    const pages: MetaPage[] = []; let after = ''; const cursors = new Set<string>();
    for (let n = 0; n < 100; n++) {
      const data = await this.request<{ data: MetaPage[]; paging?: { next?: string; cursors?: { after?: string } } }>('me/accounts', token,
        { fields: 'id,name,category,access_token,tasks', limit: '100', ...(after ? { after } : {}) });
      for (const page of data.data || []) if (/^\d+$/.test(page.id) && page.access_token && Array.isArray(page.tasks)) pages.push(page);
      const cursor = data.paging?.next ? data.paging?.cursors?.after : undefined;
      if (!cursor) return pages;
      if (cursors.has(cursor)) throw new MetaError('Meta trả về phân trang bị lặp.', null, true);
      cursors.add(cursor); after = cursor;
    }
    throw new MetaError('Danh sách Page quá lớn. Liên hệ quản trị viên để nâng giới hạn.', null, false);
  }
  async publish(pageId: string, token: string, text: string, media: Media | null): Promise<{ postId?: string; videoId?: string }> {
    if (!/^\d+$/.test(pageId)) throw new Error('Invalid Facebook Page ID.');
    if (media?.kind === 'video') {
      const result = await this.request<{ id?: string }>(`${pageId}/videos`, token, { file_url: media.url, description: text, published: 'true' }, 'POST', true);
      if (!result.id) throw new MetaError('Meta chưa xác nhận mã video. Cần kiểm tra trên Facebook.', null, false, true);
      return { videoId: result.id };
    }
    if (media?.kind === 'image') {
      const result = await this.request<{ id?: string; post_id?: string }>(`${pageId}/photos`, token, { url: media.url, caption: text, published: 'true' }, 'POST');
      if (!result.post_id) throw new MetaError('Ảnh có thể đã được tạo nhưng chưa xác nhận được bài viết. Cần kiểm tra trên Facebook.', null, false, true);
      return { postId: result.post_id };
    }
    const result = await this.request<{ id?: string }>(`${pageId}/feed`, token, { message: text, published: 'true' }, 'POST');
    if (!result.id) throw new MetaError('Meta chưa xác nhận mã bài viết. Cần kiểm tra trên Facebook.', null, false, true);
    return { postId: result.id };
  }
  async comment(postId: string, token: string, message: string): Promise<string> {
    if (!/^[\d_]+$/.test(postId)) throw new Error('Invalid post ID.');
    const result = await this.request<{ id?: string }>(`${postId}/comments`, token, { message }, 'POST');
    if (!result.id) throw new MetaError('Meta chưa xác nhận bình luận. Cần kiểm tra trên Facebook.', null, false, true);
    return result.id;
  }
  async videoStatus(videoId: string, token: string): Promise<'ready' | 'processing' | 'failed'> {
    const data = await this.request<{ published?: boolean; status?: { video_status?: string; processing_phase?: { status?: string }; publishing_phase?: { status?: string } } }>(
      videoId, token, { fields: 'status,published' });
    if (data.status?.video_status === 'error' || data.status?.processing_phase?.status === 'error' || data.status?.publishing_phase?.status === 'error') return 'failed';
    return data.published === true && data.status?.video_status === 'ready' ? 'ready' : 'processing';
  }
}
