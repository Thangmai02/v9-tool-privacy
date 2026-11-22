# V9 Page Studio

Tool quản lý nội dung nhiều Facebook Page bằng **Meta Graph API trực tiếp**, thay cho bản Buffer trước đây.

**Bản trải nghiệm:** <https://thangmai02.github.io/v9-tool-privacy/studio/>

> GitHub Pages là giao diện trải nghiệm với dữ liệu minh họa. Không có thao tác đăng Facebook thật trên bản đó. Backend, database và worker nằm trong mã nguồn này và cần triển khai trên máy chủ HTTPS để dùng tài khoản thật.

**Mã nguồn đã có đủ frontend và backend:** React/TypeScript, API Fastify, PostgreSQL và worker xử lý nền. Bản production phục vụ giao diện và API trên cùng một địa chỉ; lịch đăng được lưu trong database và tiếp tục xử lý khi đóng trình duyệt. Chọn cách triển khai bên dưới để có bản dùng thật.

## Bản v0.1 có gì?

- Dashboard tiếng Việt, Page, nội dung nháp, soạn bài đa Page, lịch đăng, hàng đợi và nhật ký.
- Facebook Login chính thức; mỗi tài khoản có workspace riêng; quyền sở hữu được kiểm tra ở backend.
- Bài chữ hoặc **một ảnh/một video qua URL HTTPS công khai**. Video được kiểm tra xử lý trước khi gửi bình luận.
- Bình luận tự động sau bài: kết quả bài và bình luận được lưu riêng để tránh đăng lại bài khi bình luận lỗi.
- Worker chạy nền: lịch vẫn tồn tại khi đóng trình duyệt; chạy song song giữa Page, giới hạn theo Page và workspace.
- Idempotency chống tạo trùng cùng yêu cầu; timeout thao tác ghi báo cần đối soát thay vì tự đăng lại.
- Token mã hóa AES-256-GCM, session HttpOnly, CSRF, kiểm tra OAuth state, callback thu hồi quyền và xóa dữ liệu.
- Triển khai bằng Render Blueprint hoặc Docker Compose; kiểm thử SQL, auth và Meta adapter.
- Trang đăng nhập/cài đặt hiển thị trạng thái máy chủ, database, worker và Facebook Login; callback OAuth lấy từ cấu hình backend.

Đây là nền tảng có thể nâng cấp thành dịch vụ thương mại, **chưa phải dịch vụ SaaS đã vận hành và được Meta duyệt**. Bản đầu chưa có inbox đọc/trả lời toàn bộ bình luận, upload file từ máy, nhiều ảnh, Reels/Stories, billing, mời nhân viên hoặc phân quyền nhóm. Không có thao tác Facebook thật nào được thực hiện khi xây mã nguồn này.

## Xem giao diện trên máy của bạn

Yêu cầu Node.js 24.

```bash
npm ci
npm run dev
```

Lệnh `dev` chạy **preview** có nhãn rõ ràng. Nội dung được lưu trong trình duyệt để thử thao tác; không dùng token thật. `npm run build:preview` tạo thư mục `studio/` đang được GitHub Pages phục vụ.

<a id="trien-khai-ban-day-du"></a>

## Triển khai bản đầy đủ

| Cách triển khai | Bạn cần chuẩn bị | Hướng dẫn |
|---|---|---|
| **Railway** | Tài khoản Railway, ngân sách cho app + PostgreSQL và thông tin Meta; API/worker chạy chung một service | [Triển khai trên Railway](docs/RAILWAY_DEPLOY.md) |
| **Render** | Tài khoản Render, ngân sách cho 3 tài nguyên trả phí và thông tin app Meta; không cần tên miền riêng | [Triển khai frontend + backend trên Render](docs/DEPLOY_RENDER.md) |
| **VPS + Docker Compose** | Máy chủ có Docker Compose, tên miền trỏ về máy chủ và thông tin app Meta | Các bước ngay bên dưới |

**[Mở Deploy to Render](https://render.com/deploy?repo=https://github.com/Thangmai02/v9-tool-privacy)** để tạo web/API, worker và PostgreSQL từ `render.yaml`. Kiểm tra tổng chi phí Render hiển thị trước khi bấm tạo. Khóa mã hóa, kết nối database và origin HTTPS được cấu hình qua Blueprint; bạn nhập thông tin Meta trong phần môi trường bảo mật của Render.

Repository không tự tạo hosting hoặc thanh toán dịch vụ. Sau khi triển khai, mở URL của web service để dùng frontend đã kết nối backend. Hoàn thành cấu hình và quyền Meta theo [META_SETUP](docs/META_SETUP.md) trước khi đăng thật.

### Triển khai không cần VPS bằng Railway (gợi ý cho người mới)

Railway chạy frontend, API và worker trong một service `v9-app`, cùng PostgreSQL ở service riêng. Lệnh khởi động `node dist/apps/server/src/railway.js` chạy migration rồi khởi động API/worker. Làm theo [hướng dẫn Railway](docs/RAILWAY_DEPLOY.md); [công cụ tạo khóa](setup/secret-generator.html) hỗ trợ chuẩn bị khóa mã hóa cần dùng.

Kiểm tra chi phí Railway trước khi tạo tài nguyên. Thông tin app, quyền đăng bài và điều kiện xét duyệt Meta vẫn cần cấu hình riêng. Bản triển khai này dùng chung tài nguyên cho API/worker; khi cần vận hành tách biệt, dùng phương án Render hoặc Docker Compose.

### Phương án VPS: Docker Compose

Cần Git, Docker với Compose plugin và tên miền. Không cần cài Node.js trên máy chủ theo cách này; script cấu hình dùng container Node.js 24.

#### 1. Lấy mã nguồn và tạo cấu hình

```bash
git clone https://github.com/Thangmai02/v9-tool-privacy.git
cd v9-tool-privacy
sh scripts/bootstrap.sh studio.example.com
```

Thay `studio.example.com` bằng tên miền của bạn. Script tạo `.env` với origin HTTPS, khóa mã hóa và mật khẩu database ngẫu nhiên, không in bí mật ra màn hình. Nếu đã có `.env`, script dừng để bảo toàn khóa hiện tại.

Mở `.env` **trên máy chủ** và điền:

| Biến | Giá trị |
|---|---|
| `APP_DOMAIN` | Tên miền, ví dụ `studio.tenmiencuaban.vn`. |
| `PUBLIC_BASE_URL` | `https://studio.tenmiencuaban.vn`, không có đường dẫn. |
| `META_APP_ID` | ID ứng dụng Meta. |
| `META_APP_SECRET` | Secret của app, chỉ lưu tại máy chủ. |
| `META_LOGIN_CONFIG_ID` | Configuration ID cấp User access token của Facebook Login for Business. |

Giữ nguyên khóa đã tạo; lưu bản sao an toàn của `.env`. Không commit tệp đó và không gửi token/secret vào chat. Compose tự dùng `DATABASE_URL` nội bộ giữa API và PostgreSQL.

#### 2. Cấu hình Meta

Làm theo [hướng dẫn Meta](docs/META_SETUP.md), đặc biệt:

- OAuth redirect: `https://TEN_MIEN/auth/facebook/callback`.
- Deauthorize callback: `https://TEN_MIEN/meta/deauthorize`.
- Data deletion callback: `https://TEN_MIEN/meta/data-deletion`.
- Configuration cấp **User access token**, các quyền Page đăng bài và bình luận. Không chọn System-user config cho v0.1.

#### 3. Khởi động

```bash
docker compose up -d --build
docker compose ps
```

Migration chạy trước API/worker. Caddy phục vụ HTTPS khi DNS chính xác và cổng 80/443 được mở. Mở `PUBLIC_BASE_URL`, xem phần **Trạng thái bản dùng thật** và xác nhận database, tiến trình đăng bài cùng Facebook Login đều sẵn sàng. Đăng nhập Facebook, chọn Page được cấp quyền và kiểm tra một bài thử. Không dùng URL GitHub Pages để đăng nhập thật.

Nếu đã có reverse proxy HTTPS riêng, dùng các service `db migrate api worker`, cấu hình proxy đến `127.0.0.1:3000` và bỏ service `https` khỏi triển khai đó. Không công khai database ra Internet.

## Kiểm tra và phát triển

```bash
npm run typecheck
npm test
npm run build
```

Test SQL mặc định dùng PGlite (PostgreSQL nhúng). Những test này kiểm tra schema, transaction và ranh giới workspace, không chứng minh khả năng khóa liên tiến trình. CI có PostgreSQL thật cho các kiểm thử hàng đợi khi `TEST_DATABASE_URL` được đặt. Test Meta dùng response mô phỏng; cần kiểm thử với Meta App/Page thật trong môi trường của bạn trước khi sử dụng thực tế.

CI còn build Docker image production, khởi động PostgreSQL thật, kiểm tra frontend/API và worker trên các container riêng, rồi chạy chế độ Railway chung một process. Smoke test kiểm tra migration, heartbeat, các trang chính sách, API cần đăng nhập, tắt worker có chờ và khởi động lại. Trên máy có Docker và Node.js 24, có thể chạy lại bằng `npm run test:container`; các tài nguyên kiểm thử sẽ được dọn sau khi chạy.

Phát triển kết nối thật với Vite: cấu hình PostgreSQL local và `.env` với `NODE_ENV=development`, `PUBLIC_BASE_URL=http://localhost:5173`, cùng các thông tin Meta hợp lệ. Chạy migration rồi mở ba tiến trình riêng:

```bash
npm run db:migrate
# Terminal 1: API
npm run dev:server
# Terminal 2: worker
node --watch --import tsx apps/server/src/worker.ts
# Terminal 3: frontend kết nối API
npm run dev:live
```

Mở `http://localhost:5173`; Vite proxy `/api` và `/auth` đến API local. Thêm chính xác `http://localhost:5173/auth/facebook/callback` vào cấu hình app Meta nếu cấu hình app của bạn cho phép phát triển localhost. Không trộn origin cổng API với origin Vite khi đăng nhập. `npm run dev` vẫn chỉ chạy preview.

Production dùng `npm run build`, `npm run db:migrate:production`, `npm start` và một tiến trình `npm run worker` riêng, với HTTPS cùng origin cho toàn bộ flow. Container trên Render tự chạy migration qua `scripts/start-service.sh`; Docker Compose dùng service migration trước API/worker.

## Vận hành

Mặc định mỗi worker có tối đa 4 tác vụ song song, tối đa 2 tác vụ/workspace, giãn tối thiểu 15 giây cho một Page. Các thông số này là giới hạn của sản phẩm; không thay thế quota Meta. Rate-limit khiến worker chờ. Tăng worker cần kiểm tra tải và tổng concurrency, không tự tăng quyền API.

```bash
docker compose logs --tail=100 api worker
docker compose stop worker
```

Không xóa database volume khi nâng cấp. Sao lưu PostgreSQL cùng khóa mã hóa trước khi cập nhật; thử khôi phục ở môi trường riêng. Chi tiết nâng cấp, backup và xử lý sự cố ở [RUNBOOK](docs/RUNBOOK.md).

`/health` kiểm tra kết nối database và schema; `/api/public-config` cung cấp trạng thái worker và callback công khai mà không lộ bí mật. Trạng thái HTTP 200 không bảo đảm worker hoặc quyền Meta đã sẵn sàng: xem các thành phần riêng trong giao diện trước khi đăng thật.

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
render.yaml        Blueprint frontend/API, worker và PostgreSQL
studio/            Bản build trải nghiệm cho GitHub Pages
```

Các URL `privacy-policy.html`, `terms.html`, `data-deletion.html` được giữ để cấu hình app. URL Buffer cũ chuyển đến studio; mã tích hợp Buffer đã được loại bỏ khỏi phiên bản hiện tại. Lịch sử Git vẫn lưu các phiên bản trước.

Liên hệ dự án: <maivanthang10a6@gmail.com>.
