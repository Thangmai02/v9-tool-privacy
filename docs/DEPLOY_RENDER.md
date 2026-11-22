# Triển khai frontend và backend lên Render

Đường này dành cho người muốn chạy V9 đầy đủ từ GitHub mà không tự quản lý VPS. Bản triển khai có giao diện React, API, PostgreSQL và worker đăng bài. Website dùng địa chỉ HTTPS Render cấp nên **không cần mua tên miền riêng để bắt đầu**.

**Đây là triển khai trả phí gồm ba tài nguyên.** Mã nguồn và Blueprint đã chuẩn bị sẵn; chưa có tài khoản hosting, dịch vụ trả phí hay kết nối Meta thật nào được tạo thay bạn. Hãy xem tổng chi phí Render hiển thị trước khi bấm tạo.

## 1. Chuẩn bị

- Tài khoản Render và quyền truy cập repository `Thangmai02/v9-tool-privacy`.
- Thông tin app Meta của bạn: App ID, App Secret và Configuration ID của Facebook Login for Business, cấu hình cấp **User access token**. Xem [META_SETUP](META_SETUP.md).
- Một Page bạn quản lý để kiểm tra đăng bài và bình luận sau khi triển khai.

Không đưa App Secret, access token hoặc mật khẩu Facebook vào GitHub. Khách sử dụng đăng nhập qua trang Facebook chính thức; V9 không yêu cầu cung cấp mật khẩu hay cookie tài khoản.

## 2. Tạo bản triển khai từ repository

Mở **[Deploy to Render](https://render.com/deploy?repo=https://github.com/Thangmai02/v9-tool-privacy)**, đăng nhập Render rồi tạo Blueprint từ nhánh `main`, file `render.yaml` ở thư mục gốc.

Blueprint khai báo:

| Tài nguyên | Chức năng | Cấu hình ban đầu |
|---|---|---|
| `v9-page-studio` | Giao diện web và API trên cùng địa chỉ | Docker; `0.5c-512mb`; Singapore |
| `v9-page-worker` | Xử lý lịch, xuất bản và bình luận khi bạn đóng trình duyệt | Docker background worker; `0.5c-512mb`; Singapore |
| `v9-page-db` | Lưu tài khoản, Page, nội dung và hàng đợi | PostgreSQL 18; `0.1c-256mb`; ổ 1 GB; Singapore |

Cả ba đều dùng gói trả phí. Kiểm tra báo giá thực tế của toàn bộ tài nguyên, lưu trữ và chi phí phát sinh mà Render hiển thị; chỉ tiếp tục nếu phù hợp ngân sách của bạn. Cấu hình này là điểm bắt đầu cho thử nghiệm vận hành, chưa phải cấu hình bảo đảm tải lớn.

Ở màn hình khai báo biến môi trường, điền ba giá trị của **app thật** vào web service:

| Biến | Điền gì |
|---|---|
| `META_APP_ID` | App ID gồm chữ số trong Meta App Dashboard. |
| `META_APP_SECRET` | App Secret, chỉ nhập trong phần môi trường bảo mật của Render. |
| `META_LOGIN_CONFIG_ID` | Configuration ID của Facebook Login for Business. |

Blueprint tự nối database, tạo khóa `TOKEN_ENCRYPTION_KEY` và dùng cùng khóa cho API/worker. Không tạo khóa khác cho worker. `PUBLIC_BASE_URL` tự lấy từ URL công khai của web service.

Sau khi xem lại tài nguyên và chi phí, tạo Blueprint và chờ cả ba tài nguyên hoàn tất khởi tạo. Hai tiến trình chạy migration có khóa trước khi khởi động, để không sửa schema đồng thời.

## 3. Gắn địa chỉ HTTPS vào Meta

Mở URL công khai trong trang `v9-page-studio`, dạng `https://TEN_RENDER_CAP.onrender.com`. **Sao chép URL thực tế Render cấp**, không tự đoán từ tên service: tên có thể có hậu tố.

Trang đăng nhập V9 có phần **Trạng thái bản dùng thật** và hiển thị callback cần dùng. Điền các địa chỉ tương ứng vào Meta:

| Mục trong Meta | Giá trị với origin của bạn |
|---|---|
| App Domains | `TEN_RENDER_CAP.onrender.com`, không có `https://` hay đường dẫn |
| Website / Site URL | `https://TEN_RENDER_CAP.onrender.com/` |
| Valid OAuth Redirect URIs | `https://TEN_RENDER_CAP.onrender.com/auth/facebook/callback` |
| Deauthorize callback | `https://TEN_RENDER_CAP.onrender.com/meta/deauthorize` |
| Data deletion callback | `https://TEN_RENDER_CAP.onrender.com/meta/data-deletion` |
| Privacy policy URL | `https://TEN_RENDER_CAP.onrender.com/privacy-policy.html` |
| Terms of service URL | `https://TEN_RENDER_CAP.onrender.com/terms.html` |

Các trường khả dụng phụ thuộc use case trong App Dashboard; [META_SETUP](META_SETUP.md) giải thích quyền và loại token. Rà soát nội dung chính sách để đúng với dịch vụ bạn vận hành trước khi gửi xét duyệt.

Frontend và API đều nằm tại origin này. Đăng nhập và sử dụng tool ở đây; URL GitHub Pages vẫn là bản trải nghiệm riêng.

## 4. Kiểm tra trước khi đăng bài

Mở website và bấm kiểm tra lại trong **Trạng thái bản dùng thật**. Cần có:

- Máy chủ phản hồi.
- Cơ sở dữ liệu sẵn sàng.
- Tiến trình đăng bài đang hoạt động, ít nhất một worker.
- Facebook Login đã cấu hình.

Trong thời gian worker vừa khởi động, trang có thể báo chưa hoạt động; kiểm tra lại sau khi worker sẵn sàng. Sau đó đăng nhập Facebook, cấp quyền cho Page, đồng bộ Page và thử một bài chữ kèm bình luận. Kiểm tra bài thật trên Facebook trước khi thử ảnh/video và lịch nhiều Page.

Có thể kiểm tra trực tiếp `https://TEN_RENDER_CAP.onrender.com/health` và `/api/public-config`. `/health` trả 200 khi database và schema sẵn sàng; phải đọc thêm `runtime.workerOnline` để biết tiến trình đăng bài có chạy. Các endpoint này không trả token hoặc App Secret. Xem [RUNBOOK](RUNBOOK.md) nếu một thành phần chưa sẵn sàng.

Hạ tầng chạy được không đồng nghĩa Meta đã cấp quyền cho khách hàng ngoài app. App Review, Advanced Access và các bước xác minh Meta yêu cầu vẫn cần hoàn tất trước khi mở dịch vụ cho họ.

## 5. Cập nhật và quản lý cấu hình

Blueprint tắt tự deploy theo commit. Sau khi CI của phiên bản mới thành công và đã sao lưu, chủ động deploy cùng một commit cho cả `v9-page-studio` và `v9-page-worker`. Migration chạy khi mỗi service khởi động. Với thay đổi schema ảnh hưởng worker đang chạy, đưa hệ thống vào bảo trì, dừng worker trước và làm theo kế hoạch migration của phiên bản đó.

Biến môi trường của worker tham chiếu web service **được cập nhật khi Blueprint sync**, không cập nhật ngay mỗi lần bạn sửa giá trị nguồn. Sau khi đổi thông tin Meta hoặc origin, sync Blueprint và deploy lại cả hai service; kiểm tra chúng dùng cùng giá trị. `sync: false` chỉ yêu cầu nhập bí mật khi tạo Blueprint lần đầu; lần sau sửa trực tiếp trong Environment của web service.

Sao lưu database và giữ khóa `TOKEN_ENCRYPTION_KEY` trong nơi quản lý bí mật riêng. Không tạo lại hoặc thay khóa khi database còn token mã hóa bằng khóa cũ. Không chuyển `DATABASE_URL` sang URL của transaction pooler: hàng đợi cần session PostgreSQL ổn định để giữ khóa theo Page. Blueprint dùng kết nối nội bộ trực tiếp và chặn truy cập database từ Internet.

Nếu thêm tên miền riêng sau này, cấu hình tên miền và HTTPS trong Render, đổi nguồn `PUBLIC_BASE_URL` trong Blueprint thành origin HTTPS mới, sync/deploy cả hai service rồi cập nhật các URL Meta. Không chỉ đổi URL ở phía giao diện. Kiểm tra lại đăng nhập trước khi cho người dùng tiếp tục.

## Tài liệu chính thức

- [Render Blueprint YAML Reference](https://render.com/docs/blueprint-spec): schema, gói compute, biến môi trường và kết nối giữa các service.
- [Deploy to Render](https://render.com/docs/deploy-to-render): khởi tạo Blueprint từ repository.

Blueprint chưa được tạo trên tài khoản Render của chủ dự án trong quá trình xây mã nguồn. Cần kiểm tra deployment thật, backup/restore và flow Facebook trên app/Page của bạn trước khi vận hành thương mại.
