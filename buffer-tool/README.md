# V9 Buffer Studio

Website quản lý đăng bài Facebook Page bằng **Buffer GraphQL API**. Có thể mở trên GitHub Pages tại:

**https://thangmai02.github.io/v9-tool-privacy/buffer-tool/**

## Chức năng

- Kết nối tài khoản Buffer và liệt kê các kênh Facebook Page.
- Soạn bài chữ, kèm URL ảnh (một hoặc nhiều) hoặc URL video công khai.
- Đăng ngay, thêm vào hàng chờ hoặc hẹn giờ.
- Gửi bình luận đầu tiên **chỉ với gói Buffer có tính năng First Comment**, thường là Essentials trở lên.
- Xem trước nội dung và nhận lỗi/ID bài từ Buffer.

**Không hỗ trợ tải trực tiếp ảnh/video từ máy**: Buffer yêu cầu URL media truy cập công khai và không hết hạn trước thời điểm xuất bản.

## Khởi chạy

Website tĩnh chạy trực tiếp trên GitHub Pages, không cần build. Vào Settings → Pages → main → /(root) nếu chưa bật.

### Chế độ Thử nhanh (không cần backend)

1. Kết nối Facebook Page của bạn tại https://publish.buffer.com
2. Vào Settings → API của Buffer, tạo API Key (gói Free được cấp một key).
3. Mở web, chọn **Thử nhanh**, dán key, bấm **Kết nối & tải Fanpage**.
4. Chọn Page, nhập bài, bấm **Gửi bài**.

**Quan trọng**: API Key chỉ được giữ trong RAM của tab trình duyệt, không lưu ở GitHub hay localStorage. Đây là công cụ sử dụng riêng; Buffer khuyến nghị không gửi API Key trực tiếp từ trình duyệt khi sử dụng thực tế. Có thể gặp lỗi CORS tùy chính sách Buffer; trong trường hợp đó cần dùng backend bên dưới. Không dùng chế độ này trên máy không đáng tin cậy.

### Chế độ Backend an toàn (khuyên dùng nếu dùng lâu dài)

GitHub Pages **không có máy chủ**, nên không thể cất API Key an toàn trong HTML/JS. Để dùng lâu dài, triển khai file `worker/worker.js` lên **Cloudflare Workers** (có gói Free).

1. Tạo tài khoản Cloudflare và mở **Workers & Pages** → **Create Worker**.
2. Tạo Worker mới, chọn **Edit code** rồi thay mã bằng nội dung file `worker/worker.js` và Deploy. Hoặc triển khai từ thư mục `worker` bằng Wrangler.
3. Trong **Settings → Variables and Secrets**, thêm hai mục với loại **Secret**:
   - `BUFFER_API_KEY`: API Key của bạn từ Buffer.
   - `ACCESS_CODE`: mật khẩu mạnh do bạn tự tạo, nên dài ít nhất 20 ký tự.
4. Biến `ALLOWED_ORIGIN` là `https://thangmai02.github.io` (đã mặc định); đổi nếu đổi miền website.
5. Sao chép địa chỉ Worker dạng `https://v9-buffer-api.<ten-tai-khoan>.workers.dev`.
6. Trên web V9 Buffer Studio, chọn **Backend an toàn**, nhập URL Worker và `ACCESS_CODE`, bấm Kết nối.

Chỉ nhập secret vào Cloudflare Dashboard. **Không đưa API Key hoặc ACCESS_CODE lên GitHub hoặc chat**. Khuyến nghị đặt thêm `ALLOWED_CHANNEL_ID` trong Worker Settings để khóa đăng bài vào đúng một Fanpage nếu bạn đã biết channel ID. Worker chặn các thao tác ngoài tìm tổ chức, liệt kê kênh và đăng bài.

### Triển khai bằng Wrangler (tùy chọn)

```sh
cd buffer-tool/worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put BUFFER_API_KEY
npx wrangler secret put ACCESS_CODE
```

### Lỗi thường gặp

- **Không tìm thấy Fanpage**: hãy kết nối Facebook Page trong Buffer trước; tài khoản Facebook cần quyền quản lý Trang.
- **401 Unauthorized**: API Key sai/hết hiệu lực hoặc ACCESS_CODE sai.
- **CORS / Failed to fetch**: dùng chế độ Backend an toàn, kiểm tra URL Worker và ALLOWED_ORIGIN.
- **Lỗi First Comment**: gói Buffer Free không hỗ trợ tính năng này; tắt chọn bình luận hoặc nâng cấp nếu cần.
- **Ảnh không lên**: URL không trỏ tới file trực tiếp hoặc yêu cầu đăng nhập.
- **Bài không công khai**: kiểm tra trạng thái đăng bài trên Buffer, trạng thái Page, quyền truy cập và giới hạn đối tượng trên Meta.

## Bảo mật và giới hạn

- Source của GitHub Pages là công khai; tuyệt đối không commit secrets, token hoặc khóa Meta.
- Website không có tài khoản đăng nhập. Người truy cập khác có thể mở giao diện; họ không thể sử dụng tài khoản Buffer của bạn nếu không có thông tin xác thực.
- Việc Buffer nhận post ID không bảo đảm bài đã xuất bản. Kiểm tra `status`/Buffer và mở bài bằng trình duyệt ẩn danh.
- Website **không đọc hoặc tự trả lời bình luận khách hàng** qua API.
- Meta chỉ cho phép đăng nội dung hợp lệ; tránh tự động hóa đăng spam.
- Để liên kết với workflow n8n đang có, có thể dùng cùng Buffer API Key trong credential của n8n. Đừng gửi key cho website khác.

## Tài liệu

- https://developers.buffer.com/guides/your-first-post.html
- https://developers.buffer.com/guides/hosting-media.html
- https://developers.buffer.com/guides/authentication.html
- https://buffer.com/pricing
