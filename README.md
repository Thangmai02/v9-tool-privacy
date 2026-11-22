# V9 Page Studio

Tool quản lý nội dung nhiều Facebook Page bằng **Meta Graph API trực tiếp**, thay cho bản Buffer trước đây.

**Bản trải nghiệm:** <https://thangmai02.github.io/v9-tool-privacy/studio/>

> GitHub Pages là giao diện trải nghiệm với dữ liệu minh họa. Không có thao tác đăng Facebook thật trên bản đó. Backend, database và worker nằm trong mã nguồn này và cần triển khai trên máy chủ HTTPS để dùng tài khoản thật.

## Bản v0.1 có gì?

- Dashboard tiếng Việt, Page, nội dung nháp, soạn bài đa Page, lịch đăng, hàng đợi và nhật ký.
- Facebook Login chính thức; mỗi tài khoản có workspace riêng; quyền sở hữu được kiểm tra ở backend.
- Bài chữ hoặc **một ảnh/một video qua URL HTTPS công khai**. Video được kiểm tra xử lý trước khi gửi bình luận.
- Bình luận tự động sau bài: kết quả bài và bình luận được lưu riêng để tránh đăng lại bài khi bình luận lỗi.
- Worker chạy nền: lịch vẫn tồn tại khi đóng trình duyệt; chạy song song giữa Page, giới hạn theo Page và workspace.
- Idempotency chống tạo trùng cùng yêu cầu; timeout thao tác ghi báo cần đối soát thay vì tự đăng lại.
- Token mã hóa AES-256-GCM, session HttpOnly, CSRF, kiểm tra OAuth state, callback thu hồi quyền và xóa dữ liệu.
- Docker Compose gồm API, worker, PostgreSQL và Caddy HTTPS; kiểm thử SQL, auth và Meta adapter.

Đây là nền tảng có thể nâng cấp thành dịch vụ thương mại, **chưa phải dịch vụ SaaS đã vận hành và được Meta duyệt**. Bản đầu chưa có inbox đọc/trả lời toàn bộ bình luận, upload file từ máy, nhiều ảnh, Reels/Stories, billing, mời nhân viên hoặc phân quyền nhóm. Không có thao tác Facebook thật nào được thực hiện khi xây mã nguồn này.

## Xem giao diện trên máy của bạn

Yêu cầu Node.js 24.

```bash
npm ci
npm run dev
```

Lệnh `dev` chạy **preview** có nhãn rõ ràng. Nội dung được lưu trong trình duyệt để thử thao tác; không dùng token thật. `npm run build:preview` tạo thư mục `studio/` đang được GitHub Pages phục vụ.

## Triển khai không cần VPS bằng Railway (gợi ý cho người mới)

Nếu bạn **chỉ có GitHub**, có thể triển khai trên Railway bằng **2 dịch vụ**: `v9-app` (frontend + API + worker cùng container) và `Postgres`. Dùng start command:

```sh
node dist/apps/server/src/railway.js
```

Bản Railway chạy migration tự động lúc khởi động, không cần tự tạo service migrate. **Xem hướng dẫn từng bước:** [docs/RAILWAY_DEPLOY.md](docs/RAILWAY_DEPLOY.md). Có thêm trang [tạo khóa mã hóa trong trình duyệt](setup/secret-generator.html) (không gửi khóa đi), hữu ích nếu bạn chưa có Node.js trên máy.

Railway cần một tài khoản riêng và có thể phát sinh phí tài nguyên; mã nguồn được đưa lên GitHub **không tự tạo tài khoản, thanh toán hoặc cấp quyền Meta**. Để khách hàng ngoài vai trò app đăng nhập thật, Meta vẫn yêu cầu xét duyệt/cấp quyền tương ứng.

## Chạy thật bằng Docker Compose

Cần một máy chủ có Docker Compose, tên miền trỏ đến máy chủ, và quyền cấu hình app Meta. Backend không thể chạy chỉ bằng bật GitHub Pages.

### 1. Lấy mã nguồn và tạo cấu hình

```bash
git clone https://github.com/Thangmai02/v9-tool-privacy.git
cd v9-tool-privacy
node scripts/setup-env.mjs
```

Script tạo `.env` với khóa mã hóa và mật khẩu database ngẫu nhiên, không in bí mật ra màn hình. Nếu đã có `.env`, script dừng để bảo toàn khóa hiện tại.

Mở `.env` **trên máy chủ** và điền:

| Biến | Giá trị |
|---|---|
| `APP_DOMAIN` | Tên miền, ví dụ `studio.tenmiencuaban.vn`. |
| `PUBLIC_BASE_URL` | `https://studio.tenmiencuaban.vn`, không có đường dẫn. |
| `META_APP_ID` | ID ứng dụng Meta. |
| `META_APP_SECRET` | Secret của app, chỉ lưu tại máy chủ. |
| `META_LOGIN_CONFIG_ID` | Configuration ID cấp User access token của Facebook Login for Business. |

Giữ nguyên khóa đã tạo; lưu bản sao an toàn của `.env`. Không commit tệp đó và không gửi token/secret vào chat. Compose tự dùng `DATABASE_URL` nội bộ giữa API và PostgreSQL.

### 2. Cấu hình Meta

Làm theo [hướng dẫn Meta](docs/META_SETUP.md), đặc biệt:

- OAuth redirect: `https://TEN_MIEN/auth/facebook/callback`.
- Deauthorize callback: `https://TEN_MIEN/meta/deauthorize`.
- Data deletion callback: `https://TEN_MIEN/meta/data-deletion`.
- Configuration cấp **User access token**, các quyền Page đăng bài và bình luận. Không chọn System-user config cho v0.1.

### 3. Khởi động

```bash
docker compose up -d --build
docker compose ps
```

Migration chạy trước API/worker. Caddy phục vụ HTTPS khi DNS chính xác và cổng 80/443 được mở. Mở `PUBLIC_BASE_URL`, đăng nhập Facebook, chọn Page được cấp quyền và kiểm tra một bài thử. Không dùng URL GitHub Pages để đăng nhập thật.

Nếu đã có reverse proxy HTTPS riêng, dùng các service `db migrate api worker`, cấu hình proxy đến `127.0.0.1:3000` và bỏ service `https` khỏi triển khai đó. Không công khai database ra Internet.

## Kiểm tra và phát triển

```bash
npm run typecheck
npm test
npm run build
```

Test SQL mặc định dùng PGlite (PostgreSQL nhúng). Những test này kiểm tra schema, transaction và ranh giới workspace, không chứng minh khả năng khóa liên tiến trình. CI có PostgreSQL thật cho các kiểm thử hàng đợi khi `TEST_DATABASE_URL` được đặt. Test Meta dùng response mô phỏng; cần kiểm thử với Meta App/Page thật trong môi trường của bạn trước khi sử dụng thực tế.

Phát triển kết nối thật: cấu hình PostgreSQL và `.env` local, chạy `npm run db:migrate`, `npm run dev:server`, và `npm run dev:live` nếu cần Vite. Production dùng `npm run build`, `npm run db:migrate:production`, `npm start`, và một tiến trình `npm run worker` riêng. Dùng HTTPS cùng origin cho toàn bộ flow production.

## Vận hành

Mặc định mỗi worker có tối đa 4 tác vụ song song, tối đa 2 tác vụ/workspace, giãn tối thiểu 15 giây cho một Page. Các thông số này là giới hạn của sản phẩm; không thay thế quota Meta. Rate-limit khiến worker chờ. Tăng worker cần kiểm tra tải và tổng concurrency, không tự tăng quyền API.

```bash
docker compose logs --tail=100 api worker
docker compose stop worker
```

Không xóa database volume khi nâng cấp. Sao lưu PostgreSQL cùng khóa mã hóa trước khi cập nhật; thử khôi phục ở môi trường riêng. Chi tiết nâng cấp, backup và xử lý sự cố ở [RUNBOOK](docs/RUNBOOK.md).

## Mở cho người dùng ngoài app

Đăng nhập chính thức giúp khách hàng cấp quyền cho các Page họ quản lý. Họ không cần đưa mật khẩu hay cookie cho V9. **App Review/Advanced Access, business verification và yêu cầu Tech Provider của Meta vẫn áp dụng**. Chỉ viết mã hoặc bật website không mở các quyền cho mọi tài khoản.

Trước khi thương mại hóa cần hoàn tất tích hợp thật, các bước xét duyệt Meta, hạ tầng và backup, giới hạn theo gói, billing/đội nhóm nếu cần, kiểm thử tải và rà soát bảo mật. Xem [kiến trúc và phạm vi](docs/ARCHITECTURE.md).

## Cấu trúc

```text
apps/web/          Giao diện React/TypeScript
apps/server/       OAuth, API, Meta adapter, queue, migration
packages/shared/   Hợp đồng dữ liệu và validation
tests/             Kiểm thử nghiệp vụ, SQL và bảo mật
docs/              Meta setup, kiến trúc và vận hành
studio/            Bản build trải nghiệm cho GitHub Pages
```

Các URL `privacy-policy.html`, `terms.html`, `data-deletion.html` được giữ để cấu hình app. URL Buffer cũ chuyển đến studio; mã tích hợp Buffer đã được loại bỏ khỏi phiên bản hiện tại. Lịch sử Git vẫn lưu các phiên bản trước.

Liên hệ dự án: <maivanthang10a6@gmail.com>.
