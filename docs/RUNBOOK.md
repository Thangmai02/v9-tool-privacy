# Vận hành V9 Page Studio

## Trước khi dùng Page thật

Mở tên miền backend, kiểm tra `/health`, đăng nhập và đồng bộ Page. Kiểm tra tác vụ chữ, ảnh, video và bình luận trên một Page bạn quản lý. Kiểm tra kết quả thật trên Facebook, không chỉ trạng thái giao diện. Bản dựng không bao gồm app credentials và chưa được kiểm thử bằng một Page thật.

Nếu `facebookLoginConfigured=false`, nhập App ID và App Secret vào môi trường máy chủ rồi khởi động lại API/worker. Nếu đăng nhập Facebook báo redirect URI không khớp, dùng chính xác `PUBLIC_BASE_URL/auth/facebook/callback` ở cả Meta và backend. Origin công khai phải dùng HTTPS.

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
