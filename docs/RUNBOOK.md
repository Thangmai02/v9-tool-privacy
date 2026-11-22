# Vận hành V9 Page Studio

## Trước khi dùng Page thật

Mở tên miền backend, kiểm tra `/health`, đăng nhập và đồng bộ Page. Kiểm tra tác vụ chữ, ảnh, video và bình luận trên một Page bạn quản lý. Kiểm tra kết quả thật trên Facebook, không chỉ trạng thái giao diện. Bản dựng không bao gồm app credentials và chưa được kiểm thử bằng một Page thật.

Nếu `facebookLoginConfigured=false`, nhập App ID, App Secret và Configuration ID cấp User token vào môi trường máy chủ rồi khởi động lại API/worker. Nếu đăng nhập Facebook báo redirect URI không khớp, dùng chính xác `PUBLIC_BASE_URL/auth/facebook/callback` ở cả Meta và backend. Origin công khai phải dùng HTTPS. Giao diện production và API phải dùng cùng origin.

## Kiểm tra trạng thái hệ thống

Phần **Trạng thái bản dùng thật** trên trang đăng nhập và Cài đặt lấy kết quả từ backend, không suy đoán từ việc có giao diện. Bấm kiểm tra lại sau khi thay đổi cấu hình hoặc khởi động worker. Có thể đọc trực tiếp `/health` và `/api/public-config` tại origin của tool.

| Giá trị / hiện tượng | Ý nghĩa và cách xử lý |
|---|---|
| `/health` trả 503, `databaseReady=false` | Database chưa kết nối được, schema chưa đạt phiên bản yêu cầu hoặc thiếu bảng. Kiểm tra trạng thái PostgreSQL, `DATABASE_URL` và logs migration trước khi khởi động lại API. |
| `schemaVersion` nhỏ hơn 2 hoặc `null` | Chưa có schema phù hợp. Compose: chạy `docker compose run --rm migrate` với đúng phiên bản mã và database; Render: xem logs migration của service khi deploy. `null` cũng có thể do database không phản hồi. |
| `/health` trả 200, `workerOnline=false` | API và database đã sẵn sàng nhưng chưa ghi nhận worker hoạt động. Không coi HTTP 200 là xác nhận xuất bản được. Kiểm tra service worker, logs và cấu hình database của nó; sau đó kiểm tra lại giao diện. |
| `workerInstances` từ 1 trở lên | Có worker gửi heartbeat gần đây. Đây là kiểm tra tiến trình, không xác nhận quyền Meta, tải hệ thống hoặc tác vụ cụ thể sẽ thành công. |
| `workerLastSeenAt` đã cũ | Worker có thể dừng, mất kết nối DB hoặc bị kết thúc đột ngột. Đối chiếu logs và trạng thái service; không tự tạo lại các bài đang xử lý. |
| `facebookLoginConfigured=false` | Thiếu một trong ba biến Meta cần thiết. Điền giá trị trên server, deploy lại rồi kiểm tra callback. |
| Có nhãn bản trải nghiệm | Bạn đang mở GitHub Pages hoặc build preview. Mở URL HTTPS của backend đã triển khai để dùng dữ liệu thật. |

Worker gửi heartbeat mỗi 15 giây. Một worker được tính online khi heartbeat trong 60 giây gần nhất; khi process bị kill, trạng thái có thể chậm tối đa khoảng một phút. Khi dừng bình thường, worker chờ công việc đang xử lý, dừng heartbeat rồi xóa bản ghi của mình. Bản ghi quá một ngày được dọn định kỳ. Nếu đang rolling deploy, tạm thời có thể thấy nhiều instance.

Healthcheck không trả lỗi chỉ vì worker vừa khởi động: việc này cho phép API phục vụ trang trạng thái trong khi worker chưa sẵn sàng. Healthcheck cũng không gọi Meta hay tạo nội dung. Kiểm tra một bài thực tế có chủ đích để xác nhận toàn bộ flow.

Trên Compose:

```bash
docker compose ps
docker compose logs --tail=100 migrate api worker
```

Trên Render, xem riêng `v9-page-studio`, `v9-page-worker` và `v9-page-db`. Không khởi động thêm worker chỉ để làm trạng thái xanh khi chưa biết worker cũ còn chạy hay không.

## Backup và cập nhật

Tạo thư mục backup riêng không phục vụ qua web. Ví dụ trên máy chủ:

```bash
mkdir -p backups
chmod 700 backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/v9-before-upgrade.dump
chmod 600 backups/v9-before-upgrade.dump
```

Lưu bản sao khóa `TOKEN_ENCRYPTION_KEY` trong nơi quản lý bí mật được bảo vệ. Chỉ file database mà không có khóa không đủ để đọc token. Mã hóa bản backup khi chuyển ra khỏi máy chủ. Đặt thời hạn giữ và thử restore ở môi trường riêng trước khi nhận khách hàng; cập nhật chính sách công khai cho thời hạn đó.

Trước nâng cấp, dừng nhận tác vụ mới hoặc bảo trì, dừng worker có chờ tác vụ đang chạy hoàn tất, sao lưu, lấy phiên bản đã kiểm thử, build và chạy migration rồi khởi động lại:

```bash
docker compose stop worker
git pull --ff-only
docker compose build
docker compose run --rm migrate
docker compose up -d api worker https
```

Không chạy `docker compose down -v` trừ khi cố ý xóa database. Không tự thay image PostgreSQL sang major mới trên volume cũ; thực hiện quy trình nâng cấp PostgreSQL và kiểm thử backup/restore riêng. Không thay khóa mã hóa trực tiếp khi còn token đã mã hóa bằng khóa cũ; cần migration hoặc yêu cầu người dùng kết nối lại theo kế hoạch.

### Lưu ý khi vận hành trên Render

Thực hiện backup PostgreSQL bằng quy trình backup/export trong tài khoản Render và thử khôi phục trước khi nâng cấp; không áp dụng lệnh `docker compose` ở trên vào Render. Giữ riêng bản sao khóa mã hóa. Blueprint ban đầu dùng 1 GB lưu trữ, cần theo dõi dung lượng và nâng cấp chủ động khi cần.

Tự động deploy theo commit đã tắt. Sau khi CI và backup hoàn tất, deploy cùng phiên bản cho cả web/API và worker. Mỗi service chạy migration có khóa trước khi khởi động. Nếu phiên bản mới thay schema không tương thích với worker cũ, dừng nhận tác vụ và dừng worker trước khi migration.

Các biến của worker tham chiếu web service được làm mới khi **Blueprint sync**. Khi sửa Meta credentials, `PUBLIC_BASE_URL` hoặc thông số worker ở web service, sync Blueprint rồi deploy lại cả web và worker; kiểm tra môi trường cả hai khớp nhau. Không tạo lại `TOKEN_ENCRYPTION_KEY` khi nâng cấp.

Database dùng mạng nội bộ và `connectionString` trực tiếp với `connectionPool: none`. Giữ cấu hình này: transaction pooler không bảo toàn phiên cần thiết cho khóa theo Page. Nếu cần export database ra ngoài Render, chỉ mở quyền mạng theo quy trình backup của bạn, giới hạn nguồn truy cập rồi đóng lại. Xem [hướng dẫn Render](DEPLOY_RENDER.md).

## Trạng thái tác vụ

| Hiện tượng | Cách xử lý |
|---|---|
| Chờ quá giờ | Kiểm tra worker đang chạy, đồng hồ máy chủ, DB và token; xem logs đã được lọc bí mật. |
| Bị rate limit | Chờ thời gian hồi phục; giảm nhịp, không tăng luồng để cố vượt quota. |
| Cần kết nối lại | Đăng nhập lại Facebook, cấp quyền Page rồi đồng bộ; tác vụ lỗi an toàn có thể thử lại sau khi sửa quyền. |
| `uncertain` | Mở Page thật kiểm tra đã có bài/bình luận chưa. Không bấm tạo lại trước khi đối soát. |
| Video đang xử lý | Chờ trạng thái Meta. Đã có video ID không có nghĩa video đã công khai. Hủy theo dõi trong V9 không xóa video khỏi Facebook. |
| Bình luận lỗi, bài thành công | Xử lý tác vụ bình luận; không tạo lại bài. |

Các thay đổi trên Meta như thu hồi quyền, mất vai trò quản lý hoặc token không hợp lệ có thể buộc người dùng đăng nhập lại. Không có cơ chế bảo đảm refresh vĩnh viễn.

## Tăng công suất

Theo dõi tuổi tác vụ lâu nhất, số queued/retrying/uncertain, tỷ lệ lỗi, thời gian xử lý media và số kết nối PostgreSQL. Mỗi process giữ kết nối khi xử lý lane Page. Hạn chế DB pool tổng và quota Meta trước khi tăng `WORKER_CONCURRENCY` hoặc số replica.

Một workspace hiện tối đa 25 Page/nội dung và giới hạn tổng tác vụ chờ. V0.1 chưa có hệ thống phân bổ tài nguyên theo gói trả phí, dashboard hạ tầng, phân quyền đội nhóm hoặc SLA. Không quảng cáo khả năng chạy vô hạn hoặc exactly-once trên API Facebook.

## Sự cố và xóa dữ liệu

Khi phát hiện token bị lộ, thu hồi quyền/token trên Meta và kiểm tra nhật ký. Không đưa token vào issue GitHub. Việc xóa tài khoản hoặc callback xóa dữ liệu phải xóa dữ liệu thật trong database; kiểm tra bằng tài khoản test và trang trạng thái mã xác nhận.

Backup có thể vẫn chứa dữ liệu đã bị xóa. Người vận hành cần chính sách retention và quy trình áp dụng lại yêu cầu xóa sau khôi phục. Không công bố dịch vụ thương mại trước khi các quy trình này phù hợp hệ thống thực tế.

## Chưa được xác minh trong môi trường tạo mã

- Đăng nhập và xuất bản thật với app/permissions của chủ dự án.
- Chứng chỉ/tên miền/VM production của chủ dự án.
- Tải lớn, failover nhiều máy và thời gian phục hồi production.
- Meta App Review, business verification hoặc Tech Provider.

Các kiểm thử mô phỏng và SQL hữu ích để tìm lỗi phần mềm nhưng không thay thế những bước trên.
