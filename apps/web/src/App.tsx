import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity, AlertCircle, CalendarDays, Check, CheckCheck, ChevronDown, CircleCheck,
  Clock3, ExternalLink, FileText, Globe2, Image as ImageIcon, Inbox,
  Layers3, LayoutDashboard, Link2, LoaderCircle, LogOut, Menu, MessageSquare,
  MoreHorizontal, PenLine, Play, Plus, RefreshCw, RotateCcw, Search, Send,
  Settings2, ShieldCheck, Trash2, Users, Video, X,
} from 'lucide-react';
import {
  campaignInputSchema, isPublicHttpsUrl, LIMITS, validateSchedule,
  type Campaign, type CampaignInput, type Job, type JobStatus, type Page, type Session, type SystemStatus,
} from '../../../packages/shared/src/index.js';
import {
  ApiError, PREVIEW, createCampaign, deleteAccount, disconnectPage, getSession, getSnapshot,
  jobAction, logout, publishDraft, request, resetDemo, simulateJobs, syncPages, type Snapshot,
} from './api.js';

type View = 'overview' | 'compose' | 'queue' | 'drafts' | 'pages' | 'settings';
type Notice = { type: 'success' | 'error'; message: string };
type Confirm = { title: string; description: ReactNode; label: string; danger?: boolean; action: () => Promise<void> };
type PublicConfig = { facebookLoginConfigured: boolean; oauthRedirectUri: string; runtime: SystemStatus };
const deploymentGuide = 'https://github.com/Thangmai02/v9-tool-privacy#trien-khai-ban-day-du';
const timeZone = 'Asia/Ho_Chi_Minh';
const formatDate = (value: string, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('vi-VN', { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', ...options }).format(new Date(value));
const formatClock = (value: string) => formatDate(value, { day: undefined, month: undefined });
const toDateInput = (value: string) => new Date(new Date(value).getTime() + 7 * 3600_000).toISOString().slice(0, 16);
const fromDateInput = (value: string) => new Date(`${value}:00+07:00`).toISOString();
const policyPath = (file: string) => `${PREVIEW ? '../' : '/'}${file}`;
const statusLabels: Record<JobStatus, string> = { queued: 'Chờ đăng', running: 'Đang xử lý', retrying: 'Chờ thử lại', succeeded: 'Hoàn tất', failed: 'Lỗi', uncertain: 'Cần đối soát', canceled: 'Đã hủy' };
const nav = [
  { id: 'overview' as const, label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'compose' as const, label: 'Soạn nội dung', icon: PenLine },
  { id: 'queue' as const, label: 'Lịch & hàng đợi', icon: CalendarDays },
  { id: 'drafts' as const, label: 'Bản nháp', icon: FileText },
  { id: 'pages' as const, label: 'Fanpage', icon: Layers3 },
  { id: 'settings' as const, label: 'Cài đặt', icon: Settings2 },
];
function Facebook() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M13.7 21v-8.2h2.8l.4-3.2h-3.2V7.5c0-.9.3-1.5 1.6-1.5H17V3.2c-.3 0-1.3-.2-2.5-.2-2.5 0-4.2 1.5-4.2 4.3v2.4H7.5v3.2h2.8V21z" /></svg>; }
const initials = (name: string) => name.split(' ').filter(Boolean).map(x => x[0]).slice(0, 2).join('').toUpperCase();
function PageAvatar({ page, small = false, index = 0 }: { page: Pick<Page, 'name'>; small?: boolean; index?: number }) {
  return <span className={`page-avatar avatar-${index % 4} ${small ? 'small' : ''}`} aria-hidden="true">{initials(page.name)}</span>;
}
function Status({ status }: { status: JobStatus }) { return <span className={`status status-${status}`}><span />{statusLabels[status]}</span>; }
function Empty({ icon = <Inbox />, title, text, action }: { icon?: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{text}</p>{action}</div>;
}
function Modal({ confirm, busy, close, run }: { confirm: Confirm; busy: boolean; close: () => void; run: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) close(); }}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabIndex={-1} ref={dialog}
      onKeyDown={e => {
        if (e.key === 'Escape' && !busy) close();
        if (e.key === 'Tab') {
          const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]');
          if (!elements?.length) return;
          const first = elements[0], last = elements[elements.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }}>
      <div className={`modal-symbol ${confirm.danger ? 'danger' : ''}`}>{confirm.danger ? <AlertCircle /> : <Send />}</div>
      <button className="icon-button modal-close" aria-label="Đóng hộp thoại" onClick={close} disabled={busy}><X /></button>
      <h2 id="dialog-title">{confirm.title}</h2><div className="modal-description">{confirm.description}</div>
      <div className="modal-actions"><button className="button secondary" onClick={close} disabled={busy}>Quay lại</button><button className={`button ${confirm.danger ? 'danger-button' : 'primary'}`} disabled={busy} onClick={run}>{busy && <LoaderCircle className="spin" />}{confirm.label}</button></div>
    </div>
  </div>;
}

export default function App() {
  const initialView = window.location.hash.slice(1);
  const [view, setView] = useState<View>(nav.some(n => n.id === initialView) ? initialView as View : 'overview');
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginRequired, setLoginRequired] = useState(false);
  const [publicConfig, setPublicConfig] = useState<PublicConfig | null>(null);
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);
  const [checkingServer, setCheckingServer] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const [template, setTemplate] = useState<Campaign | null>(null);
  const [jobFilter, setJobFilter] = useState<'all' | JobStatus>('all');
  const [jobType, setJobType] = useState<'all' | 'publish' | 'comment'>('all');
  const [query, setQuery] = useState('');
  const submissionKeys = useRef(new Map<string, string>());

  const navigate = (next: View) => { setView(next); window.location.hash = next; setMenuOpen(false); setNotice(null); };
  const newContent = () => { setTemplate(null); setComposerKey(k => k + 1); navigate('compose'); };
  const refresh = useCallback(async () => { setSnapshot(await getSnapshot()); }, []);
  const loadPublicConfig = useCallback(async () => {
    try {
      const config = await request<PublicConfig>('/api/public-config');
      setPublicConfig(config); setServerAvailable(true);
    } catch (error) {
      setPublicConfig(null); setServerAvailable(false); throw error;
    }
  }, []);
  const checkServer = async () => {
    setCheckingServer(true);
    try { await loadPublicConfig(); } catch { /* The status panel displays an unavailable server. */ }
    finally { setCheckingServer(false); }
  };
  const init = useCallback(async () => {
    setLoading(true); setNotice(null); setLoginRequired(false);
    try {
      if (!PREVIEW) await loadPublicConfig();
      setSession(await getSession()); setLoginRequired(false); await refresh();
    }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setLoginRequired(true);
        const params = new URLSearchParams(window.location.search);
        const authError = params.get('auth_error');
        if (authError) {
          const messages: Record<string, string> = { facebook_denied: 'Bạn chưa cấp quyền Facebook. Có thể kết nối lại khi sẵn sàng.', login_failed: 'Chưa hoàn tất đăng nhập Facebook. Kiểm tra cấu hình ứng dụng hoặc thử kết nối lại.', invalid_state: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng bắt đầu đăng nhập lại.' };
          setNotice({ type: 'error', message: messages[authError] || 'Không thể hoàn tất đăng nhập Facebook.' });
          params.delete('auth_error');
          window.history.replaceState(null, '', window.location.pathname + (params.size ? '?' + params.toString() : '') + window.location.hash);
        }
      }
      else setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Không thể kết nối máy chủ.' });
    } finally { setLoading(false); }
  }, [refresh, loadPublicConfig]);
  useEffect(() => { void init(); }, [init]);
  useEffect(() => {
    if (PREVIEW) return;
    const timer = window.setInterval(() => { void loadPublicConfig().catch(() => {}); }, 20_000);
    return () => window.clearInterval(timer);
  }, [loadPublicConfig]);
  useEffect(() => {
    const handler = () => { const hash = window.location.hash.slice(1); if (nav.some(n => n.id === hash)) setView(hash as View); };
    window.addEventListener('hashchange', handler); return () => window.removeEventListener('hashchange', handler);
  }, []);
  useEffect(() => {
    if (PREVIEW || !session) return;
    const timer = window.setInterval(() => { void refresh().catch(() => {}); }, 20_000);
    return () => window.clearInterval(timer);
  }, [session, refresh]);

  const act = async (fn: () => Promise<void>, message: string) => {
    setBusy(true); setNotice(null);
    try { await fn(); await refresh(); setNotice({ type: 'success', message }); }
    catch (error) { setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Có lỗi xảy ra. Vui lòng thử lại.' }); }
    finally { setBusy(false); }
  };
  const runConfirm = async () => {
    if (!confirm || busy) return;
    setBusy(true); setNotice(null);
    try { await confirm.action(); await refresh(); setConfirm(null); }
    catch (error) { setConfirm(null); setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Không thể hoàn thành thao tác.' }); }
    finally { setBusy(false); }
  };
  const connect = () => {
    if (PREVIEW) { navigate('settings'); setNotice({ type: 'success', message: 'Đăng nhập Facebook hoạt động ở bản máy chủ đã cấu hình. Bạn có thể nhập địa chỉ máy chủ bên dưới để mở tool thật.' }); }
    else window.location.assign('/auth/facebook');
  };
  const askPublish = (input: CampaignInput, after: () => void) => {
    const fingerprint = JSON.stringify(input);
    const requestKey = submissionKeys.current.get(fingerprint) || crypto.randomUUID();
    submissionKeys.current.set(fingerprint, requestKey);
    setConfirm({ title: PREVIEW ? 'Thêm vào lịch minh họa?' : 'Xác nhận nội dung đăng', label: PREVIEW ? 'Thêm lịch minh họa' : 'Xác nhận đưa vào hàng đợi', description: <>
      <p><strong>{input.title}</strong></p><p>Nội dung sẽ được gửi đến <strong>{input.pageIds.length} Page</strong>{input.scheduledAt ? ` vào ${formatDate(input.scheduledAt)} (giờ Việt Nam)` : ' ngay khi worker xử lý'}.</p>
      <div className="confirm-pages">{snapshot?.pages.filter(p => input.pageIds.includes(p.id)).map(p => <span key={p.id}>{p.name}</span>)}</div>
      {input.firstComment && <p>Mỗi bài có một tác vụ bình luận riêng sau khi xuất bản.</p>}
      {PREVIEW && <p className="inline-notice">Chỉ mô phỏng trong trình duyệt. Không gửi lên Facebook.</p>}
    </>, action: async () => { await createCampaign(input, requestKey); submissionKeys.current.delete(fingerprint); after(); navigate('queue'); setNotice({ type: 'success', message: PREVIEW ? 'Đã tạo lịch minh họa. Không có bài nào gửi lên Facebook.' : 'Đã thêm vào hàng đợi. Theo dõi kết quả riêng cho từng Page bên dưới.' }); } });
  };
  const askDraftPublish = (campaign: Campaign) => {
    try {
      if (!campaign.pageIds.length) throw new Error('Bản nháp chưa chọn Page. Dùng “Tạo bản sao” để hoàn thiện nội dung trước.');
      validateSchedule(campaign.scheduledAt);
      const pages = snapshot?.pages.filter(p => campaign.pageIds.includes(p.id)) || [];
      if (pages.length !== campaign.pageIds.length || pages.some(p => !p.canPost || p.status !== 'connected' || (campaign.firstComment && !p.canComment))) throw new Error('Một số Page không có đủ quyền. Kiểm tra lại kết nối trước khi xuất bản.');
      const fingerprint = `draft:${campaign.id}:${campaign.scheduledAt || ''}`;
      const requestKey = submissionKeys.current.get(fingerprint) || crypto.randomUUID();
      submissionKeys.current.set(fingerprint, requestKey);
      setConfirm({ title: PREVIEW ? 'Lên lịch bản nháp minh họa?' : 'Đưa bản nháp vào hàng đợi?', label: 'Xác nhận lên lịch', description: <><p><strong>{campaign.title}</strong></p><p>Đăng đến {campaign.pageIds.length} Page{campaign.scheduledAt ? ` lúc ${formatDate(campaign.scheduledAt)}` : ' khi worker sẵn sàng'}.{PREVIEW ? ' Đây là thao tác mô phỏng.' : ''}</p></>, action: async () => { await publishDraft(campaign, requestKey); submissionKeys.current.delete(fingerprint); navigate('queue'); setNotice({ type: 'success', message: 'Bản nháp đã được chuyển vào hàng đợi.' }); } });
    } catch (error) { setNotice({ type: 'error', message: (error as Error).message }); }
  };
  const askJobAction = (job: Job, action: 'cancel' | 'retry') => setConfirm({
    title: action === 'cancel' ? 'Hủy tác vụ này?' : 'Thử lại tác vụ đã lỗi?', label: action === 'cancel' ? 'Hủy tác vụ' : 'Thử lại', danger: action === 'cancel',
    description: <><p>{job.type === 'publish' ? 'Bài viết' : 'Bình luận'} của <strong>{job.pageName}</strong>.</p><p>{action === 'cancel' ? 'Tác vụ đang chờ sẽ dừng. Nội dung Facebook đã nhận hoặc đã xuất bản không bị xóa; hãy kiểm tra kết quả nếu tác vụ đã bắt đầu.' : 'Chỉ tác vụ đang lỗi sẽ được đưa vào hàng đợi. Hệ thống không đăng lại bài chỉ vì bình luận bị lỗi.'}</p></>,
    action: async () => { await jobAction(job, action); setNotice({ type: 'success', message: action === 'cancel' ? 'Đã hủy tác vụ.' : 'Đã yêu cầu thử lại tác vụ.' }); },
  });

  const pages = snapshot?.pages || [], campaigns = snapshot?.campaigns || [], jobs = snapshot?.jobs || [];
  const connected = pages.filter(p => p.status === 'connected');
  const pending = jobs.filter(j => ['queued', 'running', 'retrying'].includes(j.status));
  const succeeded = jobs.filter(j => j.type === 'publish' && j.status === 'succeeded');
  const attention = jobs.filter(j => ['failed', 'uncertain'].includes(j.status));
  const drafts = campaigns.filter(c => c.status === 'draft');
  const upcoming = [...pending].sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt)).slice(0, 4);
  const filteredJobs = jobs.filter(j => (jobFilter === 'all' || j.status === jobFilter) && (jobType === 'all' || j.type === jobType) && `${j.pageName} ${campaigns.find(c => c.id === j.campaignId)?.title || ''}`.toLowerCase().includes(query.toLowerCase()));
  const runtime = publicConfig?.runtime ?? snapshot?.settings.runtime;

  return <div className={`app ${menuOpen ? 'mobile-menu-open' : ''}`}>
    <a className="skip-link" href="#main-content">Bỏ qua đến nội dung</a>
    {menuOpen && <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} />}
    <aside className="sidebar" aria-label="Điều hướng chính">
      <a className="brand" href="#overview" onClick={() => navigate('overview')}><span className="brand-mark">V9</span><span>Page Studio<small>YOUR PUBLISHING SPACE</small></span></a>
      <div className="workspace-card"><span className="workspace-icon"><Layers3 /></span><div><strong>{session?.workspace.name || 'Không gian của bạn'}</strong><span>{PREVIEW ? 'Bản trải nghiệm' : 'Meta API trực tiếp'}</span></div></div>
      <p className="nav-label">KHÔNG GIAN LÀM VIỆC</p>
      <nav>{nav.map(item => <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon /><span>{item.label}</span>{item.id === 'drafts' && drafts.length > 0 && <span className="nav-count">{drafts.length}</span>}{item.id === 'queue' && attention.length > 0 && <span className="nav-alert">{attention.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="connected-note"><ShieldCheck /><div><strong>Kết nối chính thức</strong><span>Đăng qua Meta Graph API</span></div></div><a className="sidebar-help" href="https://github.com/Thangmai02/v9-tool-privacy#readme" target="_blank" rel="noreferrer"><FileText />Hướng dẫn sử dụng<ExternalLink /></a><div className="profile"><span className="user-avatar">{initials(session?.user.name || 'V9')}</span><div><strong>{session?.user.name || 'Chào bạn'}</strong><span>{PREVIEW ? 'Không gian minh họa' : 'Chủ không gian'}</span></div>{!PREVIEW && session && <button className="icon-button" aria-label="Đăng xuất" onClick={() => void act(async () => { await logout(); setSession(null); setLoginRequired(true); }, 'Đã đăng xuất.')}><LogOut /></button>}</div></div>
    </aside>
    <div className="main-wrap">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu-toggle" aria-label="Mở menu" onClick={() => setMenuOpen(!menuOpen)}><Menu /></button><span>Không gian làm việc</span><span className="breadcrumb-separator">/</span><strong>{nav.find(n => n.id === view)?.label}</strong></div><div className="topbar-actions"><span className="timezone-chip"><Globe2 />Giờ Việt Nam <span>UTC+7</span></span><span className={`environment-chip ${PREVIEW ? 'preview' : ''}`}>{PREVIEW ? 'Bản trải nghiệm' : 'Meta API'}</span></div></header>
      {PREVIEW && <div className="preview-banner"><span><span className="preview-dot" />Bản trải nghiệm <span className="banner-divider">·</span> Dữ liệu minh họa <span className="banner-divider">·</span> Không đăng lên Facebook</span><button onClick={() => navigate('settings')}>Kết nối bản máy chủ<ExternalLink /></button></div>}
      <main id="main-content" tabIndex={-1}>
        {notice && <div className={`notice ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.type === 'error' ? <AlertCircle /> : <CircleCheck />}<span>{notice.message}</span><button className="icon-button" aria-label="Đóng thông báo" onClick={() => setNotice(null)}><X /></button></div>}
        {loading ? <div className="loading-state"><LoaderCircle className="spin" /><h2>Đang mở không gian của bạn…</h2><p>Đang tải Page, nội dung và lịch đăng.</p></div> : loginRequired ? <Login onConnect={connect} config={publicConfig} available={serverAvailable} checking={checkingServer} onCheck={() => void checkServer()} /> : !snapshot ? <>
          <Empty icon={<AlertCircle />} title="Chưa kết nối được máy chủ" text="Kiểm tra máy chủ API đã khởi động, sau đó tải lại. Dữ liệu thật không được thay thế bằng dữ liệu minh họa." action={<button className="button primary" onClick={() => void init()}><RefreshCw />Thử kết nối lại</button>} />
          {!PREVIEW && <RuntimePanel configured={publicConfig?.facebookLoginConfigured ?? null} runtime={publicConfig?.runtime} callbackUrl={publicConfig?.oauthRedirectUri} available={serverAvailable} checking={checkingServer} onCheck={() => void checkServer()} />}
        </> : <>
          {!PREVIEW && (view === 'compose' || view === 'queue') && (serverAvailable === false || runtime?.databaseReady === false || runtime?.workerOnline === false) && <div className="runtime-warning" role="status">
            <AlertCircle /><div><strong>{serverAvailable === false ? 'Chưa kiểm tra được kết nối máy chủ' : runtime?.databaseReady === false ? 'Cơ sở dữ liệu chưa sẵn sàng' : 'Tiến trình đăng bài chưa hoạt động'}</strong><p>{serverAvailable === false ? 'Trạng thái đang hiển thị có thể chưa được cập nhật. Kiểm tra kết nối trước khi gửi nội dung.' : runtime?.databaseReady === false ? 'Máy chủ chưa xác nhận được khả năng lưu nội dung. Kiểm tra cài đặt và làm mới hàng đợi trước khi gửi lại một tác vụ.' : 'Bạn vẫn có thể lưu nháp và xếp lịch. Tác vụ đã lưu sẽ chờ đến khi tiến trình đăng bài hoạt động trở lại.'}</p></div><button className="text-button" onClick={() => navigate('settings')}>Kiểm tra cài đặt<ExternalLink /></button>
          </div>}
          {view === 'overview' && <>
            <div className="page-heading"><div><p className="eyebrow">TRUNG TÂM XUẤT BẢN</p><h1>Một nơi. Mọi Fanpage.</h1><p>Quản lý nội dung, lịch đăng và những cuộc trò chuyện tiếp theo.</p></div><button className="button primary" onClick={newContent}><Plus />Tạo bài mới</button></div>
            <div className="stats-grid"><Stat label="Page đã kết nối" value={connected.length} icon={<Layers3 />} note={`${pages.length} Page trong không gian`} onClick={() => navigate('pages')} /><Stat label="Tác vụ đang chờ" value={pending.length} icon={<CalendarDays />} note="Bài đăng & bình luận" onClick={() => { setJobFilter('all'); navigate('queue'); }} /><Stat label={PREVIEW ? 'Bài hoàn tất · mẫu' : 'Bài đã xuất bản'} value={succeeded.length} icon={<CheckCheck />} note={PREVIEW ? 'Kết quả được mô phỏng' : 'Kết quả do worker ghi nhận'} onClick={() => { setJobFilter('succeeded'); navigate('queue'); }} /><Stat label="Cần chú ý" value={attention.length} icon={<AlertCircle />} note={attention.length ? 'Kiểm tra lỗi hoặc đối soát' : 'Không có tác vụ cần xử lý'} onClick={() => { setJobFilter('all'); navigate('queue'); }} /></div>
            <div className="overview-grid"><div className="overview-main"><section className="hero-card"><div className="hero-copy"><span className="hero-eyebrow"><span />MỘT QUY TRÌNH, NHIỀU PAGE</span><h2>Lên lịch gọn gàng.<br />Sáng tạo thảnh thơi.</h2><p>Chuẩn bị một lần. Chọn những Page phù hợp.<br className="desktop-only" /> Bài viết và bình luận được xử lý theo từng tác vụ.</p><button className="button hero-button" onClick={newContent}><PenLine />Bắt đầu soạn nội dung</button></div><div className="hero-visual" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="visual-page visual-one"><Facebook /><span>Page 01</span><Check /></span><span className="visual-page visual-two"><Facebook /><span>Page 02</span><Check /></span><span className="visual-page visual-three"><MessageSquare /><span>Bình luận</span><Check /></span><div className="visual-core"><span>V9</span><small>STUDIO</small></div><span className="visual-star star-one">✦</span><span className="visual-star star-two">✦</span></div></section>
              <section className="card"><div className="section-heading"><div><h2>Sắp đến lịch</h2><p>Những nội dung tiếp theo trong hàng đợi.</p></div><button className="text-button" onClick={() => { setJobFilter('all'); navigate('queue'); }}>Xem tất cả</button></div>{upcoming.length ? <div className="upcoming-list">{upcoming.map(job => <div className="upcoming-row" key={job.id}><div className="date-tile"><strong>{formatClock(job.scheduledAt)}</strong><span>{formatDate(job.scheduledAt, { hour: undefined, minute: undefined })}</span></div><div className="upcoming-content"><h3>{campaigns.find(c => c.id === job.campaignId)?.title || 'Nội dung'}</h3><span><Facebook />{job.pageName}<span className="middle-dot">·</span>{job.type === 'comment' ? 'Bình luận' : 'Bài đăng'}</span></div><Status status={job.status} /></div>)}</div> : <Empty title="Lịch đăng đang trống" text="Tạo bài đầu tiên và chọn thời điểm xuất bản phù hợp." action={<button className="button secondary" onClick={newContent}><Plus />Tạo nội dung</button>} />}</section>
            </div><div className="overview-aside"><section className="card pages-summary"><div className="section-heading"><h2>Fanpage của bạn</h2><button className="icon-button" aria-label="Quản lý Fanpage" onClick={() => navigate('pages')}><MoreHorizontal /></button></div>{pages.slice(0, 4).map((page, i) => <button className="page-mini" key={page.id} onClick={() => navigate('pages')}><PageAvatar page={page} index={i} /><span><strong>{page.name}</strong><small>{page.category || 'Facebook Page'}</small></span><span className={`connection-dot ${page.status}`} aria-label={page.status === 'connected' ? 'Đã kết nối' : 'Chưa kết nối'} /></button>)}{!pages.length && <p className="section-empty">Kết nối Page để bắt đầu đăng nội dung.</p>}<button className="button secondary full-width" onClick={connect}><Plus />Kết nối Fanpage</button></section><section className="card activity-card"><div className="section-heading"><h2>Hoạt động gần đây</h2><Activity /></div><div className="activity-list">{snapshot.events.slice(0, 4).map((entry, i) => <div className="activity-item" key={entry.id}><span className={`activity-icon ${i === 0 ? 'active' : ''}`}><Check /></span><div><p>{entry.detail}</p><time>{formatDate(entry.createdAt)}</time></div></div>)}{!snapshot.events.length && <p className="section-empty">Hoạt động sẽ xuất hiện tại đây.</p>}</div></section><div className="workflow-note"><ShieldCheck /><p><strong>Mỗi Page, một luồng an toàn.</strong>Hệ thống xử lý song song giữa các Page và tuần tự trong từng Page.</p></div></div></div>
          </>}
          {view === 'compose' && <Composer key={composerKey} pages={pages} template={template} busy={busy} onPublish={askPublish} onDraft={async (input, after) => { await act(async () => { const fingerprint = JSON.stringify(input); const requestKey = submissionKeys.current.get(fingerprint) || crypto.randomUUID(); submissionKeys.current.set(fingerprint, requestKey); await createCampaign(input, requestKey); submissionKeys.current.delete(fingerprint); after(); navigate('drafts'); }, PREVIEW ? 'Đã lưu bản nháp minh họa trong trình duyệt.' : 'Đã lưu bản nháp.'); }} onConnect={connect} />}
          {view === 'queue' && <>
            <div className="page-heading"><div><p className="eyebrow">ĐÚNG PAGE, ĐÚNG THỜI ĐIỂM</p><h1>Lịch & hàng đợi</h1><p>Theo dõi riêng từng bài đăng và bình luận, từ chờ xử lý đến hoàn tất.</p></div><div className="heading-actions">{PREVIEW && <button className="button secondary" disabled={busy} onClick={() => void act(simulateJobs, 'Đã mô phỏng các tác vụ đến hạn. Không đăng lên Facebook.')}><Play />Chạy mô phỏng</button>}<button className="button primary" onClick={newContent}><Plus />Tạo bài mới</button></div></div>
            <div className="queue-summary"><span><span className="queue-dot waiting" /><strong>{pending.length}</strong> đang chờ</span><span><span className="queue-dot complete" /><strong>{jobs.filter(j => j.status === 'succeeded').length}</strong> hoàn tất{PREVIEW ? ' minh họa' : ''}</span><span><span className="queue-dot warning" /><strong>{attention.length}</strong> cần chú ý</span><span className="queue-timezone"><Clock3 />Tất cả thời gian: UTC+7</span></div>
            <section className="card queue-card"><div className="queue-toolbar"><div className="tab-group" aria-label="Loại tác vụ">{(['all', 'publish', 'comment'] as const).map(type => <button key={type} className={jobType === type ? 'selected' : ''} onClick={() => setJobType(type)}>{type === 'all' ? 'Tất cả' : type === 'publish' ? 'Bài đăng' : 'Bình luận'}</button>)}</div><div className="queue-controls"><label className="search-field"><Search /><input aria-label="Tìm nội dung hoặc Page" placeholder="Tìm nội dung, Page…" value={query} onChange={e => setQuery(e.target.value)} /></label><label className="select-wrap"><select aria-label="Lọc trạng thái" value={jobFilter} onChange={e => setJobFilter(e.target.value as typeof jobFilter)}><option value="all">Mọi trạng thái</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><ChevronDown /></label><button className="icon-button bordered" aria-label="Làm mới hàng đợi" disabled={busy} onClick={() => void act(refresh, 'Đã làm mới hàng đợi.')}><RefreshCw /></button></div></div>
              {filteredJobs.length ? <div className="table-scroll"><table className="jobs-table"><thead><tr><th>Nội dung</th><th>Fanpage</th><th>Thời gian</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{filteredJobs.map(job => <tr key={job.id}><td><div className="job-content"><span className={`job-type-icon ${job.type}`}>{job.type === 'publish' ? <FileText /> : <MessageSquare />}</span><div><strong>{campaigns.find(c => c.id === job.campaignId)?.title || 'Nội dung'}</strong><span>{job.type === 'publish' ? 'Bài đăng' : 'Bình luận sau đăng'}{job.attempts > 0 ? ` · ${job.attempts} lần xử lý` : ''}</span>{job.error && <p className="job-error">{job.error}</p>}{job.status === 'uncertain' && <p className="job-warning">Kiểm tra trên Facebook trước khi tạo tác vụ mới.</p>}</div></div></td><td><span className="table-page"><Facebook />{job.pageName}</span></td><td><time>{formatDate(job.scheduledAt)}</time></td><td><Status status={job.status} /></td><td><div className="table-actions">{['queued', 'retrying'].includes(job.status) && <button className="icon-button" aria-label={`Hủy tác vụ của ${job.pageName}`} title="Hủy tác vụ" disabled={busy} onClick={() => askJobAction(job, 'cancel')}><X /></button>}{job.status === 'failed' && job.retrySafe === true && <button className="icon-button" aria-label={`Thử lại tác vụ của ${job.pageName}`} title="Thử lại tác vụ" disabled={busy} onClick={() => askJobAction(job, 'retry')}><RotateCcw /></button>}{job.facebookPostId && <a className="icon-button" href={`https://www.facebook.com/${encodeURIComponent(job.facebookPostId)}`} target="_blank" rel="noreferrer" title="Xem trên Facebook" aria-label="Xem bài trên Facebook"><ExternalLink /></a>}{!['queued', 'retrying'].includes(job.status) && !(job.status === 'failed' && job.retrySafe === true) && !job.facebookPostId && <span className="muted">—</span>}</div></td></tr>)}</tbody></table></div> : <Empty title="Chưa có tác vụ phù hợp" text={query || jobFilter !== 'all' || jobType !== 'all' ? 'Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.' : 'Tạo nội dung và đưa vào hàng đợi để theo dõi tại đây.'} action={<button className="button secondary" onClick={newContent}><Plus />Tạo nội dung</button>} />}
              <div className="table-footer"><span>{filteredJobs.length} tác vụ{PREVIEW ? ' minh họa' : ''}</span><span><ShieldCheck />Bình luận lỗi không làm đăng lại bài</span></div>
            </section><div className="inline-info"><AlertCircle /><p>Nếu Facebook không trả kết quả rõ ràng, tác vụ chuyển sang <strong>Cần đối soát</strong>. Hệ thống dừng thử lại tự động để giảm nguy cơ đăng trùng.</p></div>
          </>}
          {view === 'drafts' && <><div className="page-heading"><div><p className="eyebrow">Ý TƯỞNG ĐANG THÀNH HÌNH</p><h1>Bản nháp</h1><p>Lên lịch bản nháp đã sẵn sàng, hoặc tạo bản sao để chỉnh sửa; bản gốc vẫn được giữ.</p></div><button className="button primary" onClick={newContent}><Plus />Tạo bản nháp</button></div>{drafts.length ? <div className="draft-grid">{drafts.map(campaign => <article className="card draft-card" key={campaign.id}><div className="draft-card-head"><span className="label-chip"><FileText />Bản nháp</span><span>{formatDate(campaign.createdAt, { hour: undefined, minute: undefined })}</span></div><h2>{campaign.title}</h2><p>{campaign.text || (campaign.media?.kind === 'image' ? 'Bài đăng hình ảnh' : 'Bài đăng video')}</p><div className="draft-meta"><span><Layers3 />{campaign.pageIds.length} Page</span>{campaign.firstComment && <span><MessageSquare />Có bình luận</span>}{campaign.media && <span>{campaign.media.kind === 'image' ? <ImageIcon /> : <Video />}{campaign.media.kind === 'image' ? 'Ảnh' : 'Video'}</span>}</div><div className="draft-actions"><button className="button secondary" onClick={() => { setTemplate(campaign); setComposerKey(k => k + 1); navigate('compose'); }}><PenLine />Tạo bản sao</button><button className="button primary" disabled={busy} onClick={() => askDraftPublish(campaign)}><CalendarDays />Lên lịch</button></div></article>)}</div> : <section className="card"><Empty icon={<FileText />} title="Để dành một ý tưởng hay" text="Bản nháp sẽ xuất hiện ở đây khi bạn chọn Lưu nháp trong màn hình soạn nội dung." action={<button className="button primary" onClick={newContent}><Plus />Soạn nội dung</button>} /></section>}</>}
          {view === 'pages' && <><div className="page-heading"><div><p className="eyebrow">TẤT CẢ PAGE TRONG TẦM TAY</p><h1>Fanpage</h1><p>Kết nối các Page bạn được phép quản lý bằng tài khoản Facebook.</p></div><div className="heading-actions"><button className="button secondary" disabled={busy} onClick={() => void act(syncPages, PREVIEW ? 'Đã làm mới Page minh họa.' : 'Đã đồng bộ Page và quyền hiện tại.')}><RefreshCw />Đồng bộ</button><button className="button primary" onClick={connect}><Plus />Kết nối Fanpage</button></div></div><div className="page-list-grid">{pages.map((page, i) => <article className="card page-card" key={page.id}><div className="page-card-head"><PageAvatar page={page} index={i} /><span className={`status ${page.status === 'connected' ? 'status-succeeded' : 'status-failed'}`}><span />{page.status === 'connected' ? 'Đã kết nối' : page.status === 'expired' ? 'Cần kết nối lại' : 'Đã ngắt'}</span></div><h2>{page.name}</h2><p>{page.category || 'Facebook Page'}</p><div className="page-permissions"><span className={page.canPost ? 'granted' : ''}>{page.canPost ? <CircleCheck /> : <AlertCircle />}Đăng bài, ảnh & video</span><span className={page.canComment ? 'granted' : ''}>{page.canComment ? <CircleCheck /> : <AlertCircle />}Thêm bình luận</span></div><dl><div><dt>Page ID</dt><dd>{PREVIEW ? 'Page minh họa' : page.facebookId}</dd></div><div><dt>Đồng bộ gần nhất</dt><dd>{formatDate(page.lastSyncedAt)}</dd></div></dl><div className="page-card-actions">{page.status === 'connected' ? <button className="text-button danger-text" disabled={busy} onClick={() => setConfirm({ title: `Ngắt kết nối ${page.name}?`, description: <p>Các tác vụ đang chờ của Page này sẽ dừng. Bạn có thể kết nối lại bằng Facebook sau.</p>, label: 'Ngắt kết nối', danger: true, action: async () => { await disconnectPage(page); setNotice({ type: 'success', message: 'Đã ngắt kết nối Page.' }); } })}><Link2 />Ngắt kết nối</button> : <button className="text-button" onClick={connect}><RefreshCw />Kết nối lại</button>}{page.facebookId && <a className="text-button" href={`https://www.facebook.com/${encodeURIComponent(page.facebookId)}`} target="_blank" rel="noreferrer">Mở Page<ExternalLink /></a>}</div></article>)}<button className="add-page-card" onClick={connect}><span><Plus /></span><strong>Thêm một Fanpage</strong><p>Chọn từ các Page bạn có quyền quản lý.</p></button></div><div className="inline-info"><ShieldCheck /><p>V9 dùng trang đăng nhập chính thức của Facebook. Mật khẩu Facebook không được nhập hoặc lưu trong tool. Kết nối có thể cần cấp lại khi quyền hoặc token thay đổi.</p></div></>}
          {view === 'settings' && <Settings snapshot={snapshot} busy={busy} act={act} setConfirm={setConfirm} onConnect={connect} config={publicConfig} available={serverAvailable} checking={checkingServer} onCheck={() => void checkServer()} />}
        </>}
        <footer className="app-footer"><span>V9 Page Studio <span>·</span> Không gian xuất bản của bạn</span><div><a href={policyPath('privacy-policy.html')} target="_blank" rel="noreferrer">Quyền riêng tư</a><a href={policyPath('terms.html')} target="_blank" rel="noreferrer">Điều khoản</a><a href={policyPath('data-deletion.html')} target="_blank" rel="noreferrer">Xóa dữ liệu</a></div></footer>
      </main>
    </div>
    {confirm && <Modal confirm={confirm} busy={busy} close={() => { if (!busy) setConfirm(null); }} run={() => void runConfirm()} />}
  </div>;
}

function Stat({ label, value, note, icon, onClick }: { label: string; value: number; note: string; icon: ReactNode; onClick: () => void }) {
  return <button className="stat-card" onClick={onClick}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value.toString().padStart(2, '0')}</strong><span className="stat-note">{note}</span></button>;
}

function RuntimePanel({ configured, runtime, callbackUrl, available, checking, onCheck }: {
  configured: boolean | null; runtime?: SystemStatus; callbackUrl?: string;
  available: boolean | null; checking: boolean; onCheck: () => void;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle');
  useEffect(() => { setCopyState('idle'); }, [callbackUrl]);
  const copyCallback = async () => {
    if (!callbackUrl) return;
    try { await navigator.clipboard.writeText(callbackUrl); setCopyState('copied'); }
    catch { setCopyState('manual'); }
  };
  const checks = [
    { label: 'Máy chủ xử lý', ready: available, detail: available === true ? 'Đã kết nối' : available === false ? 'Chưa nhận được trạng thái' : 'Chưa kiểm tra' },
    { label: 'Cơ sở dữ liệu', ready: available === true ? runtime?.databaseReady : null, detail: available !== true || !runtime ? 'Chưa kiểm tra' : runtime.databaseReady ? 'Sẵn sàng lưu dữ liệu' : 'Chưa sẵn sàng' },
    { label: 'Tiến trình đăng bài', ready: available === true ? runtime?.workerOnline : null, detail: available !== true || !runtime ? 'Chưa kiểm tra' : runtime.workerOnline ? `Đang hoạt động · ${runtime.workerInstances} tiến trình` : 'Chưa hoạt động' },
    { label: 'Đăng nhập Facebook', ready: available === true ? configured : null, detail: available !== true || configured === null ? 'Chưa kiểm tra' : configured ? 'Đã khai báo ứng dụng' : 'Cần cấu hình ứng dụng Meta' },
  ];
  return <section className="card settings-card runtime-card" aria-label="Trạng thái bản dùng thật">
    <div className="runtime-heading"><div className="settings-title"><span className="feature-icon"><Activity /></span><div><h2>Trạng thái bản dùng thật</h2><p>Kiểm tra kết nối trước khi bắt đầu xuất bản.</p></div></div><button className="icon-button bordered" type="button" aria-label="Kiểm tra lại trạng thái máy chủ" title="Kiểm tra lại trạng thái" disabled={checking} onClick={onCheck}><RefreshCw className={checking ? 'spin' : ''} /></button></div>
    <dl className="runtime-checks">{checks.map(check => <div key={check.label}><dt>{check.label}</dt><dd className={check.ready === true ? 'runtime-ready' : check.ready === false ? 'runtime-pending' : 'runtime-unknown'}>{check.ready === true ? <CircleCheck /> : check.ready === false ? <AlertCircle /> : <Clock3 />}{check.detail}</dd></div>)}</dl>
    {available === true && runtime && !runtime.workerOnline && <p className="runtime-explanation">Lịch đã lưu sẽ tiếp tục chờ. Người vận hành cần khởi động tiến trình đăng bài để xử lý hàng đợi.{runtime.workerLastSeenAt ? ` Hoạt động gần nhất: ${formatDate(runtime.workerLastSeenAt)} (giờ Việt Nam).` : ''}</p>}
    {available === true && configured === false && <p className="runtime-explanation">Người vận hành cần thêm thông tin ứng dụng Meta trong cài đặt máy chủ để bật nút đăng nhập Facebook.</p>}
    {callbackUrl && <div className="oauth-callback"><label className="field-label" htmlFor="oauth-callback-url">URL chuyển về sau đăng nhập (OAuth)</label><div className="callback-input"><input id="oauth-callback-url" className="text-input" readOnly value={callbackUrl} onFocus={event => event.currentTarget.select()} /><button className="button secondary" type="button" onClick={() => void copyCallback()}>{copyState === 'copied' ? <Check /> : <Link2 />}{copyState === 'copied' ? 'Đã sao chép' : 'Sao chép'}</button></div><p className="field-hint">Dán nguyên địa chỉ này vào mục Valid OAuth Redirect URIs của ứng dụng Meta.</p><span className="copy-feedback" role="status">{copyState === 'manual' ? 'Trình duyệt chưa cho phép sao chép. Chọn ô địa chỉ rồi sao chép thủ công.' : copyState === 'copied' ? 'Đã sao chép URL chuyển về sau đăng nhập.' : ''}</span></div>}
    <a className="text-button runtime-guide-link" href={deploymentGuide} target="_blank" rel="noreferrer">Hướng dẫn triển khai bản đầy đủ<ExternalLink /></a>
  </section>;
}

function Login({ onConnect, config, available, checking, onCheck }: {
  onConnect: () => void; config: PublicConfig | null; available: boolean | null; checking: boolean; onCheck: () => void;
}) {
  return <section className="login-card"><span className="login-logo">V9</span><span className="eyebrow">CHÀO MỪNG ĐẾN PAGE STUDIO</span><h1>Không gian dành cho<br />những Page của bạn.</h1><p>Đăng nhập bằng Facebook, chọn Page bạn quản lý và bắt đầu chuẩn bị nội dung.</p><button className="button facebook-button" onClick={onConnect} disabled={!config?.facebookLoginConfigured || config.runtime?.databaseReady === false}><Facebook />Tiếp tục với Facebook</button>
    <RuntimePanel configured={config?.facebookLoginConfigured ?? null} runtime={config?.runtime} callbackUrl={config?.oauthRedirectUri} available={available} checking={checking} onCheck={onCheck} />
    <div className="login-benefits"><span><Layers3 />Nhiều Fanpage</span><span><CalendarDays />Lịch đăng tập trung</span><span><MessageSquare />Bình luận sau đăng</span></div><p className="login-footnote"><ShieldCheck />Bạn cấp quyền trên Facebook. Tool không yêu cầu mật khẩu hoặc cookie tài khoản.</p></section>;
}

function Composer({ pages, template, busy, onPublish, onDraft, onConnect }: {
  pages: Page[]; template: Campaign | null; busy: boolean;
  onPublish: (input: CampaignInput, after: () => void) => void;
  onDraft: (input: CampaignInput, after: () => void) => Promise<void>;
  onConnect: () => void;
}) {
  const [title, setTitle] = useState(template ? `${template.title} (bản sao)`.slice(0, LIMITS.title) : '');
  const [text, setText] = useState(template?.text || '');
  const [mediaKind, setMediaKind] = useState<'none' | 'image' | 'video'>(template?.media?.kind || 'none');
  const [mediaUrl, setMediaUrl] = useState(template?.media?.url || '');
  const [firstComment, setFirstComment] = useState(template?.firstComment || '');
  const [commentOn, setCommentOn] = useState(!!template?.firstComment);
  const [selected, setSelected] = useState<string[]>(template?.pageIds.filter(id => pages.some(p => p.id === id && p.canPost && p.status === 'connected')) || []);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'schedule'>('now');
  const [scheduleAt, setScheduleAt] = useState(toDateInput(new Date(Date.now() + 3600_000).toISOString()));
  const [error, setError] = useState('');
  const [previewMedia, setPreviewMedia] = useState(false);
  const [imageError, setImageError] = useState(false);
  const previewPage = pages.find(p => selected.includes(p.id));
  const selectedPages = pages.filter(p => selected.includes(p.id));
  const eligible = pages.filter(p => p.status === 'connected' && p.canPost);
  const reset = () => { setTitle(''); setText(''); setMediaKind('none'); setMediaUrl(''); setFirstComment(''); setCommentOn(false); setSelected([]); setError(''); };
  const submit = (action: 'draft' | 'queue') => {
    setError('');
    try {
      const input = campaignInputSchema.parse({ title, text, media: mediaKind !== 'none' ? { kind: mediaKind, url: mediaUrl.trim() } : null, firstComment: commentOn ? firstComment : '', pageIds: selected, scheduledAt: scheduleMode === 'schedule' ? fromDateInput(scheduleAt) : null, action });
      if (action === 'queue') {
        validateSchedule(input.scheduledAt);
        if (selectedPages.some(p => p.status !== 'connected' || !p.canPost)) throw new Error('Một số Page chưa có quyền đăng bài.');
        if (input.firstComment && selectedPages.some(p => !p.canComment)) throw new Error('Một số Page chưa có quyền bình luận. Hãy kết nối lại hoặc tắt bình luận.');
        onPublish(input, reset);
      } else void onDraft(input, reset);
    } catch (err) {
      const parsed = err as { issues?: { message: string }[]; message?: string };
      setError(parsed.issues?.[0]?.message || parsed.message || 'Vui lòng kiểm tra nội dung và lịch đăng.');
    }
  };
  return <><div className="page-heading"><div><p className="eyebrow">TỪ Ý TƯỞNG ĐẾN BÀI ĐĂNG</p><h1>Soạn nội dung</h1><p>Một bài viết, nhiều Page. Thêm bình luận và chọn thời điểm của bạn.</p></div><span className="label-chip"><ShieldCheck />Meta API chính thức</span></div>
    <div className="composer-grid"><div className="composer-fields"><section className="card form-card"><div className="section-heading"><div><h2>Đăng đến đâu?</h2><p>Chọn tối đa {LIMITS.pages} Page cho mỗi nội dung.</p></div><span className="selected-count">{selected.length} đã chọn</span></div>{pages.length ? <><div className="page-picker">{pages.map((page, i) => { const disabled = !page.canPost || page.status !== 'connected'; return <label key={page.id} className={`page-option ${selected.includes(page.id) ? 'chosen' : ''} ${disabled ? 'disabled' : ''}`}><input type="checkbox" checked={selected.includes(page.id)} disabled={disabled || (selected.length >= LIMITS.pages && !selected.includes(page.id))} onChange={e => setSelected(e.target.checked ? [...selected, page.id] : selected.filter(id => id !== page.id))} /><PageAvatar page={page} small index={i} /><span><strong>{page.name}</strong><small>{disabled ? 'Cần kết nối lại' : page.canComment ? 'Đăng bài & bình luận' : 'Có quyền đăng bài'}</small></span><span className="custom-checkbox">{selected.includes(page.id) && <Check />}</span></label>; })}</div><button className="text-button select-all" onClick={() => setSelected(selected.length === Math.min(eligible.length, LIMITS.pages) ? [] : eligible.slice(0, LIMITS.pages).map(p => p.id))}>{selected.length === Math.min(eligible.length, LIMITS.pages) && selected.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả Page đủ quyền'}</button></> : <Empty icon={<Layers3 />} title="Kết nối Page đầu tiên" text="Bạn cần ít nhất một Page để xuất bản. Bạn vẫn có thể lưu bản nháp." action={<button className="button secondary" onClick={onConnect}><Plus />Kết nối Page</button>} />}</section>
      <section className="card form-card"><div className="section-heading"><h2>Nội dung bài viết</h2><span className="form-step">Bài đăng</span></div><label className="field-label" htmlFor="post-title">Tên nội dung <span>Chỉ hiển thị trong tool</span></label><input id="post-title" className="text-input" placeholder="Ví dụ: Câu chuyện đầu tuần" maxLength={LIMITS.title} value={title} onChange={e => setTitle(e.target.value)} /><label className="field-label" htmlFor="post-text">Nội dung</label><div className="textarea-wrap"><textarea id="post-text" placeholder="Bạn muốn kể câu chuyện gì hôm nay?" value={text} onChange={e => setText(e.target.value)} maxLength={LIMITS.text} rows={7} /><div className="textarea-footer"><span>Hỗ trợ văn bản & emoji</span><span>{text.length.toLocaleString('vi-VN')} / {LIMITS.text.toLocaleString('vi-VN')}</span></div></div><div className="media-controls"><span className="field-label">Đính kèm</span><div className="media-options" aria-label="Loại nội dung">{([{ kind: 'none' as const, label: 'Văn bản', icon: FileText }, { kind: 'image' as const, label: 'Ảnh', icon: ImageIcon }, { kind: 'video' as const, label: 'Video', icon: Video }]).map(item => <button type="button" key={item.kind} className={mediaKind === item.kind ? 'active' : ''} onClick={() => { setMediaKind(item.kind); setPreviewMedia(false); setImageError(false); }}><item.icon />{item.label}</button>)}</div></div>{mediaKind !== 'none' && <div className="media-url-panel"><label className="field-label" htmlFor="media-url">URL {mediaKind === 'image' ? 'ảnh' : 'video'} công khai</label><div className="url-field"><Link2 /><input type="url" id="media-url" value={mediaUrl} placeholder={mediaKind === 'image' ? 'https://media.example.com/anh.jpg' : 'https://media.example.com/video.mp4'} onChange={e => { setMediaUrl(e.target.value); setPreviewMedia(false); setImageError(false); }} /></div><p className="field-hint">Dùng đường dẫn HTTPS trực tiếp đến tệp. Meta cần truy cập được URL khi tác vụ chạy. Bản này hỗ trợ một ảnh hoặc một video mỗi bài.</p>{isPublicHttpsUrl(mediaUrl) && <button className="text-button" onClick={() => { setPreviewMedia(true); setImageError(false); }}>Tải xem trước từ URL</button>}</div>}</section>
      <section className="card form-card"><div className="comment-heading"><div className="comment-title"><span className="feature-icon"><MessageSquare /></span><div><h2>Bình luận sau khi đăng</h2><p>Thêm thông tin, đường dẫn hoặc lời mời trò chuyện.</p></div></div><label className="switch"><input type="checkbox" checked={commentOn} onChange={e => setCommentOn(e.target.checked)} aria-label="Bật bình luận sau khi đăng" /><span /></label></div>{commentOn && <div className="comment-fields"><label className="field-label" htmlFor="first-comment">Nội dung bình luận</label><textarea className="text-input" id="first-comment" rows={3} maxLength={LIMITS.comment} value={firstComment} onChange={e => setFirstComment(e.target.value)} placeholder="Thông tin thêm cho bài viết của bạn…" /><div className="field-hint split"><span>Gửi dưới danh nghĩa Page sau khi bài được tạo.</span><span>{firstComment.length} / {LIMITS.comment}</span></div><p className="field-hint">Facebook quyết định thứ tự hiển thị bình luận; tool không đảm bảo luôn ở vị trí đầu tiên.</p></div>}</section>
      <section className="card form-card"><div className="section-heading"><h2>Thời điểm xuất bản</h2><span className="muted small-text">Giờ Việt Nam · UTC+7</span></div><div className="schedule-options"><label className={scheduleMode === 'now' ? 'active' : ''}><input type="radio" name="schedule" checked={scheduleMode === 'now'} onChange={() => setScheduleMode('now')} /><Send /><span><strong>Đăng ngay</strong><small>Đưa vào hàng đợi xử lý</small></span></label><label className={scheduleMode === 'schedule' ? 'active' : ''}><input type="radio" name="schedule" checked={scheduleMode === 'schedule'} onChange={() => setScheduleMode('schedule')} /><CalendarDays /><span><strong>Lên lịch</strong><small>Chọn ngày & giờ xuất bản</small></span></label></div>{scheduleMode === 'schedule' && <div className="schedule-field"><label className="field-label" htmlFor="schedule-at">Ngày và giờ (UTC+7)</label><input id="schedule-at" className="text-input" type="datetime-local" min={toDateInput(new Date(Date.now() + 60_000).toISOString())} value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} /></div>}</section>
      {error && <div className="notice error" role="alert"><AlertCircle /><span>{error}</span></div>}<div className="composer-actions"><span>{selected.length} Page <span>·</span> {commentOn && firstComment ? 'Có bình luận sau đăng' : 'Sẵn sàng khi bạn muốn'}</span><div><button className="button secondary" disabled={busy} onClick={() => submit('draft')}><FileText />Lưu nháp</button><button className="button primary" disabled={busy} onClick={() => submit('queue')}>{busy ? <LoaderCircle className="spin" /> : scheduleMode === 'schedule' ? <CalendarDays /> : <Send />}{PREVIEW ? 'Tạo lịch minh họa' : scheduleMode === 'schedule' ? 'Lên lịch đăng' : 'Đưa vào hàng đợi'}</button></div></div>
    </div><aside className="preview-column"><div className="preview-heading"><h2>Xem trước bài viết</h2><span>Facebook</span></div><div className="facebook-preview"><header><PageAvatar page={{ name: previewPage?.name || 'Fanpage của bạn' }} small /><div><strong>{previewPage?.name || 'Fanpage của bạn'}</strong><span>Vừa xong <span>·</span> <Globe2 /></span></div><MoreHorizontal /></header><div className={`preview-text ${!text ? 'placeholder' : ''}`}>{text || 'Nội dung bạn viết sẽ xuất hiện ở đây. Một câu chuyện hay bắt đầu bằng một ý tưởng nhỏ.'}</div>{mediaKind !== 'none' && <div className={`preview-media ${previewMedia && !imageError ? 'loaded' : ''}`}>{previewMedia && isPublicHttpsUrl(mediaUrl) && !imageError ? mediaKind === 'image' ? <img src={mediaUrl} alt="Ảnh đính kèm xem trước" referrerPolicy="no-referrer" onError={() => setImageError(true)} /> : <video src={mediaUrl} controls preload="metadata" onError={() => setImageError(true)} /> : <>{mediaKind === 'image' ? <ImageIcon /> : <Video />}<strong>{imageError ? 'Không tải được media' : mediaKind === 'image' ? 'Ảnh của bạn' : 'Video của bạn'}</strong><span>{imageError ? 'Kiểm tra URL hoặc quyền truy cập tệp.' : 'Thêm URL và chọn tải xem trước.'}</span></>}</div>}<div className="preview-social"><span>♡ Thích</span><span><MessageSquare />Bình luận</span><span><Send />Chia sẻ</span></div>{commentOn && firstComment && <div className="preview-comment"><PageAvatar page={{ name: previewPage?.name || 'Fanpage' }} small /><div><strong>{previewPage?.name || 'Fanpage của bạn'}</strong><p>{firstComment}</p></div></div>}</div><p className="preview-disclaimer">Bản xem trước mang tính minh họa. Bố cục thực tế do Facebook hiển thị.</p><div className="composer-checklist"><h3>Trước khi xuất bản</h3><span className={selected.length ? 'checked' : ''}><CircleCheck />Đã chọn {selected.length} Fanpage</span><span className={text.trim() || mediaUrl ? 'checked' : ''}><CircleCheck />Nội dung & media</span><span className={commentOn ? 'checked' : ''}><CircleCheck />Bình luận sau đăng {commentOn ? 'đã bật' : '(tùy chọn)'}</span><span className="checked"><CircleCheck />{scheduleMode === 'schedule' ? 'Chờ thời điểm đã chọn' : 'Xử lý khi worker sẵn sàng'}</span></div></aside></div>
  </>;
}

function Settings({ snapshot, busy, act, setConfirm, onConnect, config, available, checking, onCheck }: {
  snapshot: Snapshot; busy: boolean; act: (fn: () => Promise<void>, message: string) => Promise<void>;
  setConfirm: (value: Confirm) => void; onConnect: () => void; config: PublicConfig | null;
  available: boolean | null; checking: boolean; onCheck: () => void;
}) {
  const [backendUrl, setBackendUrl] = useState(() => { try { return localStorage.getItem('v9.backend.url') || ''; } catch { return ''; } });
  const [urlError, setUrlError] = useState('');
  const facebookConfigured = !PREVIEW && available === true && (config?.facebookLoginConfigured ?? snapshot.settings.facebookLoginConfigured);
  const openBackend = () => {
    setUrlError('');
    try {
      const url = new URL(backendUrl);
      if (!isPublicHttpsUrl(url.href) || url.search || url.hash) throw new Error('Nhập địa chỉ HTTPS công khai của máy chủ V9, không kèm token hoặc tham số.');
      try { localStorage.setItem('v9.backend.url', url.href); } catch { /* Navigation works without persistence. */ }
      window.location.assign(url.href);
    } catch (err) { setUrlError(err instanceof Error ? err.message : 'URL không hợp lệ.'); }
  };
  return <><div className="page-heading"><div><p className="eyebrow">THIẾT LẬP KHÔNG GIAN</p><h1>Cài đặt</h1><p>Kết nối Facebook, kiểm tra cấu hình và quản lý dữ liệu của bạn.</p></div></div><div className="settings-grid"><div>
      {!PREVIEW && <RuntimePanel configured={config?.facebookLoginConfigured ?? snapshot.settings.facebookLoginConfigured} runtime={config?.runtime ?? snapshot.settings.runtime} callbackUrl={config?.oauthRedirectUri} available={available} checking={checking} onCheck={onCheck} />}
      <section className="card settings-card"><div className="settings-title"><span className="feature-icon"><Facebook /></span><div><h2>Kết nối Facebook</h2><p>Đăng nhập qua Meta, cấp quyền cho các Page bạn quản lý.</p></div></div><div className={`settings-state ${facebookConfigured ? 'ready' : ''}`}><span className="connection-dot" /><strong>{facebookConfigured ? 'Đã cấu hình Facebook Login' : PREVIEW ? 'Bản trải nghiệm chưa có máy chủ kết nối' : available !== true ? 'Chưa kiểm tra được kết nối máy chủ' : 'Cần cấu hình Facebook Login trên máy chủ'}</strong></div><p>Khách hàng chỉ cần đăng nhập và chọn Page sau khi ứng dụng được Meta cấp các quyền cần thiết. App Review, Advanced Access và xác minh theo yêu cầu của Meta là các bước riêng.</p><button className="button secondary" disabled={!PREVIEW && !facebookConfigured} onClick={onConnect}><Facebook />{PREVIEW ? 'Thông tin kết nối máy chủ' : 'Kết nối / cấp lại quyền'}</button></section>
      {PREVIEW && <section className="card settings-card"><div className="settings-title"><span className="feature-icon"><Globe2 /></span><div><h2>Dùng bản đầy đủ</h2><p>Giao diện, máy chủ lưu dữ liệu và tiến trình đăng bài chạy cùng một địa chỉ tool.</p></div></div><div className="preview-runtime-note"><AlertCircle /><p>Bạn đang ở bản trải nghiệm trên GitHub Pages. Bản này dùng dữ liệu minh họa trong trình duyệt và chưa kết nối máy chủ đăng bài.</p></div><label className="field-label" htmlFor="backend-url">Địa chỉ tool đã triển khai</label><div className="backend-input"><input id="backend-url" className="text-input" type="url" placeholder="https://studio.tenmiencuaban.vn" value={backendUrl} onChange={e => setBackendUrl(e.target.value)} /><button className="button primary" onClick={openBackend}><ExternalLink />Mở tool</button></div><p className="field-hint">Chỉ nhập URL máy chủ do bạn tin cậy. Không nhập App Secret, access token hoặc mật khẩu tại đây.</p>{urlError && <p className="field-error" role="alert">{urlError}</p>}<a className="text-button" href={deploymentGuide} target="_blank" rel="noreferrer">Hướng dẫn triển khai bản đầy đủ<ExternalLink /></a></section>}
      <section className="card settings-card"><div className="settings-title"><span className="feature-icon"><Activity /></span><div><h2>Cấu hình xử lý</h2><p>Thông số chỉ đọc; người vận hành thay đổi ở môi trường máy chủ.</p></div></div><dl className="settings-list"><div><dt>Số luồng worker</dt><dd>{snapshot.settings.workerConcurrency}</dd></div><div><dt>Khoảng cách tối thiểu trên một Page</dt><dd>{snapshot.settings.pageIntervalSeconds} giây</dd></div><div><dt>Số Page tối đa mỗi nội dung</dt><dd>{snapshot.settings.maxPagesPerCampaign}</dd></div><div><dt>Meta Graph API</dt><dd>{snapshot.settings.graphVersion}</dd></div><div><dt>Múi giờ giao diện</dt><dd>Asia/Ho_Chi_Minh · UTC+7</dd></div><div><dt>Lưu thời điểm trên máy chủ</dt><dd>UTC</dd></div></dl><p className="field-hint">Giới hạn thực tế còn phụ thuộc Meta và quyền của từng Page. Worker giảm tốc hoặc dừng khi gặp giới hạn và lỗi quyền.</p></section>
      <section className="card settings-card"><div className="settings-title"><span className="feature-icon"><ShieldCheck /></span><div><h2>Dữ liệu & quyền truy cập</h2><p>Kiểm soát dữ liệu trong không gian của bạn.</p></div></div>{PREVIEW ? <><p>Dữ liệu minh họa và bản nháp trải nghiệm được lưu trong trình duyệt này. Khôi phục sẽ xóa thay đổi của bạn trong bản trải nghiệm.</p><button className="button secondary" disabled={busy} onClick={() => setConfirm({ title: 'Khôi phục dữ liệu minh họa?', description: <p>Các bản nháp và lịch minh họa bạn đã tạo sẽ được thay bằng bộ dữ liệu mẫu ban đầu. Không ảnh hưởng Facebook.</p>, label: 'Khôi phục', danger: true, action: async () => { await resetDemo(); } })}><RotateCcw />Khôi phục bản trải nghiệm</button></> : <><p>Xóa tài khoản sẽ thu hồi phiên đăng nhập, dừng tác vụ và xóa dữ liệu V9 liên quan. Những bài đã đăng trên Facebook cần được quản lý trực tiếp trên Facebook.</p><button className="button danger-outline" disabled={busy} onClick={() => setConfirm({ title: 'Xóa tài khoản và dữ liệu V9?', description: <p>Thao tác xóa dữ liệu V9 không thể hoàn tác. Các tác vụ đang chờ sẽ dừng; bài đã xuất bản trên Facebook không bị xóa.</p>, label: 'Xóa dữ liệu của tôi', danger: true, action: async () => { await deleteAccount(); window.location.reload(); } })}><Trash2 />Xóa tài khoản & dữ liệu</button></>}</section></div><aside><section className="card settings-guide"><h2>Từ kết nối đến xuất bản</h2><div><span><Globe2 /></span><h3>Máy chủ HTTPS</h3><p>API, cơ sở dữ liệu và worker chạy cùng cấu hình triển khai của bạn.</p></div><div><span><Facebook /></span><h3>Ứng dụng Meta</h3><p>Cấu hình App ID, App Secret và URL callback bằng biến môi trường máy chủ.</p></div><div><span><Users /></span><h3>Quyền cho khách hàng</h3><p>Hoàn thành App Review và các bước xác minh Meta yêu cầu trước khi mở cho người ngoài app.</p></div><div><span><CircleCheck /></span><h3>Kiểm thử trên Page của bạn</h3><p>Kiểm tra bài chữ, ảnh, video, bình luận và kết nối lại trước khi đưa vào vận hành.</p></div><a className="button secondary full-width" href="https://github.com/Thangmai02/v9-tool-privacy" target="_blank" rel="noreferrer"><FileText />Mở mã nguồn & hướng dẫn</a></section></aside></div></>;
}
