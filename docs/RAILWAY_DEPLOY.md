# Triển khai V9 Page Studio Full-stack trên Railway (ít bước, tối ưu chi phí)

> Cập nhật: 22/11/2026. Tài liệu dành cho người **chỉ có GitHub**, chưa có VPS.
>
> **Quan trọng:** repo có đầy đủ frontend, backend, PostgreSQL schema và worker. GitHub Pages `/studio/` chỉ là demo. Muốn đăng Facebook thật, bạn phải có host cho backend, cơ sở dữ liệu và app Meta đủ quyền. Không dùng mật khẩu Facebook, cookie, token hay App Secret trong GitHub.

## Kiến trúc Railway giá thấp

Chỉ tạo **hai dịch vụ** trên Railway:

1. `v9-app` từ repository GitHub `Thangmai02/v9-tool-privacy`: **frontend + API + background worker** chung một container Node.js. Sử dụng entrypoint `node dist/apps/server/src/railway.js`; một replica, 2 worker slots trong giai đoạn thử.
2. `Postgres`: dịch vụ PostgreSQL có volume bền vững, **không** mở Public Networking.

Mã `apps/server/src/railway.ts` tự chạy migration dưới advisory lock khi khởi động. Worker được giám sát cùng app: nếu worker dừng bất thường, service cũng dừng thay vì im lặng không đăng bài theo lịch. Chế độ này để tối ưu chi phí cho ít người dùng; production tải cao nên tách riêng API và worker theo `compose.yaml`.

Không cần VPS hay tên miền riêng lúc bắt đầu: Railway cấp tên miền `*.up.railway.app` có HTTPS. Gói Hobby từ 5 USD/tháng (đã gồm 5 USD usage, vượt mức thì trả thêm). **Không bảo đảm tổng phí luôn chỉ 5 USD** vì app và database chạy 24/7. Free không phù hợp lịch đăng cần đúng giờ.

## Bước 1. Đăng nhập Railway

Mở <https://railway.com/new>, dùng GitHub để đăng nhập / kết nối. Cấp quyền truy cập repository `Thangmai02/v9-tool-privacy` nếu Railway yêu cầu.

Chọn gói Hobby khi muốn chạy liên tục. Khi thử ngắn có thể dùng tín dụng trial.

## Bước 2. Tạo Project gồm PostgreSQL và app

1. Trong Railway, tạo **New Project → Empty Project**.
2. Chọn **+ New → Database → PostgreSQL** và đợi Postgres sẵn sàng.
3. Chọn **+ New → GitHub Repo** (hoặc Empty Service → Settings → Connect Repo). Chọn `Thangmai02/v9-tool-privacy`, nhánh `main`. Đặt tên service là `v9-app`.
4. **Root Directory phải là `/` hoặc để trống** (repo root). Railway sẽ thấy `Dockerfile` ở root và build Node 24.
5. Vào service `v9-app` → **Settings → Deploy → Start Command**, nhập:

```text
node dist/apps/server/src/railway.js
```

Không dùng `npm run dev` (chỉ chạy preview), không dùng URL GitHub Pages để login Facebook thật.

6. Nếu có tùy chọn **Serverless/Sleep when idle**, **tắt**: worker cần chạy ngay cả khi không ai truy cập. Số replicas để **1**.

## Bước 3. Tạo URL HTTPS

Vào `v9-app → Settings → Networking → Public Networking → Generate Domain`. Railway cấp địa chỉ dạng:

```text
https://v9-app-production.up.railway.app
```

**Đây chỉ là ví dụ, không sao chép nguyên văn.** Sao chép chính xác địa chỉ Railway hiển thị trong dự án của bạn. Nếu chưa thể tạo domain trước lần deploy đầu, tạo domain sau khi service được cấu hình và deploy, rồi cập nhật lại `PUBLIC_BASE_URL`.

Chỉ service `v9-app` cần domain công khai. **Không bật Public Networking cho PostgreSQL.**

## Bước 4. Thiết lập Variables cho v9-app

Vào `v9-app → Variables`, tạo các biến sau (các giá trị trong ngoặc `<...>` cần thay bằng giá trị thật của bạn):

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway reference, **không** dán mật khẩu DB vào GitHub) |
| `PUBLIC_BASE_URL` | `https://<TEN_MIEN_RAILWAY_CUA_BAN>` (bỏ dấu / cuối và mọi đường dẫn) |
| `TOKEN_ENCRYPTION_KEY` | Một khóa Base64 đại diện đúng **32 byte ngẫu nhiên** |
| `WORKER_CONCURRENCY` | `2` |
| `PAGE_INTERVAL_SECONDS` | `15` |
| `SESSION_TTL_DAYS` | `7` |
| `META_GRAPH_VERSION` | `v27.0` (phiên bản đang có trong mã, cần xác minh tương thích khi nâng cấp) |
| `META_ENABLE_COMMENTS` | `false` khi ưu tiên đăng bài; chỉ đổi `true` khi đã được cấp quyền bình luận và dùng OAuth scope. Nếu có `META_LOGIN_CONFIG_ID`, chỉnh quyền trong Configuration trên Meta. |
| `META_APP_ID` | App ID thực tế từ Meta Dashboard |
| `META_APP_SECRET` | App Secret thực tế từ Meta Dashboard |
| `META_LOGIN_CONFIG_ID` | Facebook Login for Business Configuration ID cấp **User access token**; để trống chỉ nếu app của bạn hỗ trợ scope fallback |

**Cách tạo TOKEN_ENCRYPTION_KEY nếu bạn chỉ có trình duyệt:** mở <https://thangmai02.github.io/v9-tool-privacy/setup/secret-generator.html>, bấm **Tạo khóa mới** rồi sao chép. Mã chạy cục bộ bằng Web Crypto, không gửi khóa đi. Bạn cần sao lưu khóa này ở nơi an toàn; mất khóa đồng nghĩa không giải mã được token Facebook đã lưu.

**Lưu ý quan trọng về DATABASE_URL:** dùng reference variable đúng tên Railway service. Nếu service DB không tên `Postgres`, thay bằng tên chính xác hiển thị trong Project canvas.

Bạn có thể nhập Meta variables sau khi kiểm tra máy chủ hoạt động. Nhưng nút đăng nhập Facebook sẽ báo chưa cấu hình cho đến khi `META_APP_ID` và `META_APP_SECRET` hợp lệ.

Không đăng App Secret, token, `TOKEN_ENCRYPTION_KEY` hoặc `DATABASE_URL` lên GitHub hoặc gửi vào chat.

## Bước 5. Deploy

Bấm **Deploy / Redeploy** và xem Logs.

Entrypoint `railway.js` lần lượt:

1. kết nối PostgreSQL và chạy migration;
2. khởi động Fastify phục vụ cả giao diện và API;
3. chạy worker trong cùng tiến trình ứng dụng.

Trong **Deploy settings**, nếu có ô healthcheck, đặt `/health` và timeout đủ để khởi động. Mở:

```text
https://<TEN_MIEN_RAILWAY_CUA_BAN>/health
```

Kết quả có `ok: true` khi database và migration đã sẵn sàng. Ngoài phiên bản ứng dụng, endpoint còn trả trạng thái runtime:

```json
{
  "ok": true,
  "version": "0.1.0",
  "runtime": {
    "databaseReady": true,
    "schemaVersion": 2,
    "workerOnline": true,
    "workerInstances": 1,
    "workerLastSeenAt": "2026-11-22T00:00:00.000Z"
  }
}
```

Timestamp trên chỉ là ví dụ. Worker có thể còn khởi động khi `/health` đã trả 200; chờ `runtime.workerOnline: true` trước khi thử lịch đăng. Mở URL Railway gốc để xem trạng thái máy chủ, cơ sở dữ liệu, worker và cấu hình Facebook Login ngay trên giao diện. Giao diện này sẽ là **bản chạy thật**, không phải preview GitHub Pages.

Nếu app không chạy: kiểm tra `DATABASE_URL` đã resolve từ Railway reference, `TOKEN_ENCRYPTION_KEY` đúng 32 byte, `PUBLIC_BASE_URL` có HTTPS và `PORT=3000`. Railway có thể tự gán PORT, hãy dùng cùng một cổng với service Networking.

## Bước 6. Cấu hình Meta App chính thức

Vào Meta for Developers và lấy **App ID + App Secret** của ứng dụng mà bạn thực sự quản lý. Trong sản phẩm Facebook Login for Business của app (nếu loại app/use case hỗ trợ):

- Valid OAuth Redirect URI: `https://<TEN_MIEN_RAILWAY_CUA_BAN>/auth/facebook/callback`
- Deauthorize Callback: `https://<TEN_MIEN_RAILWAY_CUA_BAN>/meta/deauthorize`
- Data Deletion Callback: `https://<TEN_MIEN_RAILWAY_CUA_BAN>/meta/data-deletion`
- App Domains: tên miền Railway tương ứng, **không có `https://`**.
- Privacy Policy URL: <https://thangmai02.github.io/v9-tool-privacy/privacy-policy.html>
- Terms URL: <https://thangmai02.github.io/v9-tool-privacy/terms.html>
- Data deletion instructions: <https://thangmai02.github.io/v9-tool-privacy/data-deletion.html>

Các quyền Page áp dụng cho tính năng hiện có: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_read_user_content`, `pages_manage_engagement`, `public_profile`. Cấp **User access token** qua configuration phù hợp. Xem `docs/META_SETUP.md`.

Thử với tài khoản có vai trò trong app và Page trước. Để khách ngoài admin/developer/tester có thể đăng nhập và dùng Page, app của bạn **phải thỏa điều kiện App Review/Advanced Access/verification thực tế do Meta đặt ra**. Không thể bỏ qua bằng cách đổi nhà cung cấp hosting.

## Bước 7. Kiểm tra công khai

1. Mở URL Railway và bấm Đăng nhập bằng Facebook.
2. Đồng bộ Fanpage và chọn Page bạn được cấp quyền đăng nội dung.
3. Đăng một bài chữ thử trên một Page; kiểm tra status trong V9 và bài thật trong Facebook.
4. Thử bài ảnh/video theo URL HTTPS công khai; sau đó thử bình luận nếu token có quyền.
5. Mở bài bằng cửa sổ ẩn danh hoặc tài khoản khác để kiểm tra người ngoài xem được. **Công khai không có nghĩa bài được Facebook phân phối đến tất cả người dùng.**

## Bước 8. Giới hạn chi phí và vận hành

- Vào Railway **Workspace → Usage → Set Usage Limits**.
- Thử thiết lập **Email alert $10** và **Hard limit $20** trong giai đoạn thử (bạn có thể chọn mức khác). Nếu chạm hard limit, các dịch vụ bị dừng và bài hẹn giờ sẽ trễ.
- Giữ `WORKER_CONCURRENCY=2` khi chỉ có vài Fanpage. Không tăng số workers nhằm vượt giới hạn Meta.
- Không bật nhiều replicas cho `railway.js` trước khi đánh giá tải; trước khi thương mại hóa nên chuyển sang các dịch vụ API/worker riêng.
- Sao lưu PostgreSQL và khóa mã hóa, thử khôi phục theo `docs/RUNBOOK.md`.
- Khi sửa GitHub `main`, Railway có thể tự deploy thay đổi; kiểm tra log sau mỗi bản phát hành.

## Chẩn đoán nhanh

| Vấn đề | Cách kiểm tra |
|---|---|
| Backend không khởi động | `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, Logs của app |
| `/health` trả 503 | Postgres chưa sẵn sàng/biến reference sai |
| V9 báo chưa cấu hình Facebook Login | `META_APP_ID`, `META_APP_SECRET` |
| Meta báo redirect_uri mismatch | URI trong Meta phải **khớp chính xác** `PUBLIC_BASE_URL/auth/facebook/callback` |
| Có Page nhưng không đăng được | Quyền Page + nhiệm vụ `CREATE_CONTENT`, trạng thái App/Access Level/Token |
| Bài đăng chỉ người có vai trò app xem được | Kiểm tra Development/Live, quyền và status trên Meta |
| Lịch không chạy | Logs worker cùng service, trạng thái `uncertain`, hạn mức Railway |
| Cookie đăng nhập lỗi | `PUBLIC_BASE_URL` đúng origin HTTPS và không thay đổi liên tục |
| Chi phí tăng | Xem Usage theo từng service; giảm concurrency, tài nguyên và xử lý media |

## Khi lớn hơn

Cấu hình một-container để tiết kiệm tiền, **không phải giới hạn kiến trúc**. Khi nhiều khách hàng và Page hơn: dùng API service và worker service riêng (lệnh `node dist/apps/server/src/index.js` và `node dist/apps/server/src/worker.js`), tiếp tục dùng cùng Postgres. Cần tách queue, giám sát, backup tự động, billing, phân quyền tenant và kiểm toán an ninh trước khi kinh doanh thực tế.

Tài liệu đối chiếu:
- <https://docs.railway.com/deployments/start-command>
- <https://docs.railway.com/databases/postgresql>
- <https://docs.railway.com/networking/public-networking>
- <https://docs.railway.com/pricing/cost-control>
- <https://developers.facebook.com/>

