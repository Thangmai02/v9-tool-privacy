# Mở V9 Page Studio cho người dùng bên ngoài (Windows, MacBook, điện thoại)

Tài liệu này chỉ mô tả chức năng hiện có trong mã nguồn. Việc app Meta đã ở Live không tự động có nghĩa là quyền Page đã được duyệt cho mọi tài khoản.

## A. Địa chỉ đúng để chia sẻ

- **Bản giới thiệu:** https://thangmai02.github.io/v9-tool-privacy/studio/ (demo dữ liệu giả lập, không đăng thật).
- **Bản thật:** `PUBLIC_BASE_URL` của máy chủ V9 (ví dụ `https://your-v9.up.railway.app/`). Chỉ chia sẻ sau khi kiểm tra `/health`, `/api/public-config` và một bài đăng thực tế.
- MacBook dùng Safari, Chrome hoặc Firefox; Windows dùng Edge/Chrome/Firefox; điện thoại dùng trình duyệt. Không cần cài ứng dụng máy tính. Chưa có app macOS/iOS/Android riêng.

## B. Kích hoạt máy chủ

1. Làm theo [RAILWAY_DEPLOY.md](RAILWAY_DEPLOY.md) để chạy frontend, API, worker và PostgreSQL.
2. Đặt `PUBLIC_BASE_URL` trùng tuyệt đối origin HTTPS do Railway cấp, không thêm đường dẫn `/studio/`.
3. Đặt `META_APP_ID`, `META_APP_SECRET`, `TOKEN_ENCRYPTION_KEY` (32 byte ngẫu nhiên), `DATABASE_URL`. Không đưa các bí mật vào GitHub hoặc chat.
4. Để `META_ENABLE_COMMENTS=false` khi chỉ cần cho người dùng chọn Page và đăng bài. Chỉ bật bình luận khi được cấp quyền liên quan. Nếu dùng `META_LOGIN_CONFIG_ID`, chọn **User access token** và danh sách quyền thật trong Facebook Login for Business Configuration; biến `META_ENABLE_COMMENTS` không thể ghi đè Configuration của Meta.
5. Mở `https://<domain>/health`: xác nhận `ok: true`, `databaseReady: true`, `workerOnline: true`.

## C. Kết nối Meta

Cấu hình trên chính app Meta của chủ dự án:

| Trường | Giá trị |
| --- | --- |
| Website | `https://<domain>/` |
| Valid OAuth Redirect URI | `https://<domain>/auth/facebook/callback` |
| Deauthorize Callback URL | `https://<domain>/meta/deauthorize` |
| Data Deletion Request URL | `https://<domain>/meta/data-deletion` |
| App Domains | `<domain>` (không có HTTPS hay đường dẫn) |
| Privacy Policy | `https://thangmai02.github.io/v9-tool-privacy/privacy-policy.html` |
| Terms | `https://thangmai02.github.io/v9-tool-privacy/terms.html` |
| Data Deletion Instructions | `https://thangmai02.github.io/v9-tool-privacy/data-deletion.html` |

Quyền mục tiêu cho đăng bài: `public_profile`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`. Meta có thể yêu cầu App Review, Advanced Access, xác minh/đánh giá bổ sung tùy use case và cấu hình app. **Chưa được Meta cấp quyền tương ứng thì người ngoài app sẽ không thể sử dụng chức năng đó**, dù app ở Live. Không dùng thông tin doanh nghiệp giả.

## D. Kiểm tra mở cho người ngoài

1. Chủ app thử Facebook Login trên **URL máy chủ thật** và xác nhận thấy đúng Page mình quản lý.
2. Tạo một bài chữ kiểm thử, xác minh Facebook trả về ID bài và trang hiển thị công khai cho người xem phù hợp.
3. Thử trên **tài khoản Facebook không có vai trò app** (không phải admin/developer/tester) sau khi Meta cấp quyền Advanced Access; tài khoản đó tự đăng nhập và chỉ chọn các Page mình có quyền.
4. Thử thao tác trên MacBook/Safari hoặc iPhone/Safari và Windows/Chrome. Xác nhận điều hướng OAuth, cookie phiên, xem/sửa lịch và đăng xuất; không cần cấp mật khẩu Facebook cho chủ V9.
5. Kiểm tra dữ liệu người dùng A không lộ khi đăng nhập tài khoản B; mỗi tài khoản có workspace riêng theo backend hiện tại.
6. Chia sẻ **URL máy chủ thật**, không dùng URL GitHub Pages demo, và cập nhật trang giới thiệu khi đã có domain.

## E. Những gì phiên bản v0.1 chưa làm

- Chưa có ứng dụng cài đặt riêng cho macOS, Windows, iPhone hoặc Android.
- Chưa có hộp thư bình luận hay đọc/trả lời mọi bình luận người dùng; chỉ có gửi bình luận đầu tiên nếu được cấp quyền.
- Chưa có tải file trực tiếp từ máy; ảnh/video dùng URL HTTPS công khai.
- Chưa có thanh toán, phân quyền đội nhóm, quản trị tài khoản khách hàng tập trung.
- Chưa có bằng chứng triển khai backend hoặc App Review thật chỉ từ việc mã nguồn có mặt trên GitHub.

Cần hỗ trợ cấu hình: xem [META_SETUP.md](META_SETUP.md) và [RUNBOOK.md](RUNBOOK.md).
