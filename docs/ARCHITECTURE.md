# Kiến trúc V9 Page Studio v0.1

## Mục tiêu và phạm vi

V9 Page Studio dùng Meta Graph API trực tiếp để quản lý các Page đã được người dùng cấp quyền. Một nội dung có thể tạo công việc cho nhiều Page, gồm đăng bài và bình luận tiếp theo. Hệ thống tách giao diện, API, lớp tích hợp Meta và worker để có thể mở rộng mà không đưa token vào trình duyệt.

Đây là **nền tảng v0.1 có thể tiếp tục phát triển thành sản phẩm thương mại**. Không xem việc có source code, demo hoặc các bài kiểm thử tự động là bằng chứng hệ thống đã được Meta duyệt, đã chạy ở quy mô lớn hoặc đã hoàn thành mọi yêu cầu vận hành thương mại.

## Các thành phần

| Thành phần | Vai trò |
|---|---|
| React 19 + TypeScript | Giao diện quản lý Page, soạn nội dung, lịch và tình trạng công việc. |
| Vite | Phát triển và đóng gói frontend; tạo bản xem trước riêng cho GitHub Pages. |
| Node.js 24 + Fastify 5 | OAuth Facebook, session, kiểm tra dữ liệu, API nghiệp vụ và phục vụ frontend production. |
| PostgreSQL | Dữ liệu người dùng, workspace, Page, nội dung, jobs, trạng thái và nhật ký. Đồng thời là hàng đợi bền vững của v0.1. |
| Worker riêng | Nhận jobs đến hạn, gọi Meta, lưu kết quả và xử lý thử lại có kiểm soát. |
| Shared contracts | Kiểu dữ liệu và validation dùng chung giữa frontend/backend. |

Version cụ thể được ghim trong package manifest và lockfile. Lựa chọn công nghệ nhằm dễ kiểm thử và bảo trì; không có một stack duy nhất bảo đảm “cao nhất” cho mọi tải vận hành.

### Hai cách chạy giao diện

**Production:** Fastify phục vụ bản build trong `dist/web` trên cùng origin với API. Browser dùng session cookie; OAuth callback quay về cùng máy chủ. Backend có kết nối database và worker chạy riêng.

**GitHub Pages `/studio/`:** bản preview tĩnh với dữ liệu mô phỏng, có nhãn chế độ xem trước. Không có quyền đăng Facebook, không kết nối tài khoản thật, không giữ secret. Dữ liệu hoặc thao tác mô phỏng không phải bằng chứng một bài đã đăng trên Page.

GitHub lưu source và bản preview; GitHub Pages không thay thế máy chủ Node/PostgreSQL. Các policy URL tại root vẫn dùng được cho thông tin công khai của app.

## Luồng người dùng

1. Người dùng chọn đăng nhập Facebook trên máy chủ thật.
2. Server tạo trạng thái OAuth một lần, chuyển sang Facebook; nhận code tại callback và kiểm tra trạng thái.
3. Server đổi code lấy token, đọc danh tính/quyền/danh sách Page được cho phép và tạo session.
4. Frontend hiển thị Page và khả năng thao tác. Người dùng chọn Page, nội dung, media, lịch và bình luận.
5. API kiểm tra workspace, quyền Page và payload rồi lưu nội dung/jobs trong PostgreSQL.
6. Worker nhận jobs đến hạn, gọi Graph API, lưu ID ngoài hệ thống và cập nhật trạng thái.
7. Giao diện đọc trạng thái từ backend. Mỗi bước thất bại hoặc chưa rõ kết quả phải hiện đúng trạng thái, không suy diễn thành công từ việc request đã được gửi.

Người dùng xác thực trên Facebook. Hệ thống không yêu cầu nhập mật khẩu, cookie, mã 2FA hay chuỗi phiên Facebook để giả lập một trình duyệt.

## Ranh giới dữ liệu

V0.1 tạo **workspace cá nhân tách biệt cho từng người đăng nhập**. Mọi truy vấn nghiệp vụ phải kiểm tra quyền sở hữu bằng session/workspace ở server; không lấy `workspaceId` do browser tự khai làm căn cứ cấp quyền. Việc người dùng sửa Page ID trong request không được phép truy cập Page của workspace khác.

Mô hình này đặt nền cho nhiều khách hàng độc lập. Nó chưa phải hệ thống mời đồng đội, phân vai owner/admin/editor, phân công Page hay duyệt nội dung nhiều cấp. Khi bổ sung thành viên, cần thiết kế authorization và migration riêng, không chỉ thêm một cột `role` rồi cho rằng mọi đường API đã được bảo vệ.

Page access token lưu phía server ở dạng mã hóa. Browser chỉ nhận metadata cần hiển thị. Session, OAuth state và CSRF là các cơ chế riêng; token Facebook không được dùng trực tiếp như session của ứng dụng.

Lớp server sử dụng AES-GCM với dữ liệu xác thực bổ sung (AAD) để gắn ciphertext token với ngữ cảnh của nó. Các route ghi do browser gọi phải kiểm tra cả Origin và CSRF token. Các callback Meta được xác thực bằng cơ chế riêng phù hợp với OAuth hoặc `signed_request`; không được bỏ bảo vệ chỉ để làm callback chạy được.

## Hàng đợi PostgreSQL và nhiều luồng

Hàng đợi sống trong PostgreSQL giúp v0.1 vận hành với ít thành phần hơn một hệ thống có thêm Redis. Có thể tách hàng đợi thành dịch vụ riêng khi tải và số liệu vận hành cho thấy cần thiết.

- Worker nhận jobs bằng khóa hàng và `FOR UPDATE SKIP LOCKED` để các worker không cùng nhận một hàng đang bị khóa.
- Advisory lock theo Page giúp các hành động ghi trên cùng Page không chồng lên nhau giữa nhiều worker. Khóa cần giữ trên đúng kết nối PostgreSQL trong thời gian thực hiện bước tương ứng.
- Giới hạn concurrency kiểm soát số việc thực hiện song song; nhịp tối thiểu theo Page giảm dồn request.
- Các Page độc lập có thể chạy song song trong giới hạn cấu hình. Nhiều worker không làm tăng hạn mức API Meta.
- Job lưu trong database nên đóng browser không mất lịch. Khi worker ngừng hoặc dịch vụ bên ngoài chậm, công việc có thể được thực hiện trễ.

Mặc định `WORKER_CONCURRENCY=4` (giới hạn cấu hình 1–16) và `PAGE_INTERVAL_SECONDS=15` (15–3.600 giây). Ngoài giới hạn mỗi process, hàng đợi giới hạn **2 công việc đang chạy cho mỗi workspace** thông qua PostgreSQL. Khi nhân bản worker, phải tính tổng concurrency của toàn bộ triển khai; giới hạn mỗi process không tự trở thành một quota toàn cụm. V0.1 chưa cung cấp bộ điều phối công bằng hoặc quota khác nhau theo gói khách hàng.

Giới hạn sản phẩm của v0.1 là tối đa 25 Page cho một nội dung, 5.000 ký tự nội dung và 2.000 ký tự bình luận. Đây là **giới hạn của sản phẩm**, không phải tuyên bố hạn mức cố định của Facebook.

Lịch đăng được lưu dưới thời điểm tuyệt đối có timezone. Giao diện cần thể hiện múi giờ rõ ràng khi nhập và đọc lịch; không xử lý giờ máy người dùng như UTC mà không chuyển đổi. Bản hiện tại cho phép lịch sau ít nhất 30 giây và trong vòng 366 ngày; URL media và quyền truy cập vẫn phải còn hợp lệ khi đến lịch.

## Đăng bài và bình luận là hai bước

Một nội dung có thể tạo nhiều jobs trên các Page khác nhau. Bước đăng bài lưu ID bài Facebook. Chỉ khi có kết quả bài đăng phù hợp, bước bình luận mới được thực hiện.

Ví dụ: bài đăng thành công nhưng bình luận bị thiếu quyền. Giao diện phải thể hiện bài đã đăng và bình luận lỗi. Thử lại bình luận không được tạo một bài đăng mới.

Một ảnh dùng endpoint Page Photos; lưu đúng `post_id` trả về khi có. Video dùng Page Videos và cần theo dõi xử lý; nhận ID upload không đủ để kết luận video đã hiển thị thành công. Chưa hỗ trợ upload nhiều ảnh, Reel, Story hoặc tải media từ máy người dùng lên kho riêng.

Tên nội dung là nhãn nội bộ để tìm kiếm và quản lý. Nó không phải nội dung tự động chèn vào caption Facebook. Bình luận tự động không được cam kết luôn đứng đầu theo thời gian hoặc xếp hạng.

## Retry và kết quả chưa chắc chắn

Hai loại lỗi cần xử lý khác nhau:

**Lỗi đã xác định:** Meta trả lỗi quyền/token/validation hoặc rate limit rõ ràng. Lỗi quyền cần người dùng sửa quyền/kết nối; lỗi tạm thời đủ điều kiện có thể lên lịch thử lại với backoff và giới hạn số lần.

**Lỗi thao tác ghi chưa rõ kết quả:** kết nối bị ngắt, timeout hoặc worker dừng ở thời điểm không thể chắc Meta đã tạo bài/bình luận hay chưa. Đánh dấu `uncertain` để đối soát, không tự gửi lại như một request mới.

Idempotency trong ứng dụng ngăn việc bấm lặp hoặc gửi lại cùng yêu cầu tạo campaign. Nó không tạo ra bảo đảm exactly-once cho một hệ thống bên ngoài không có idempotency key tương ứng. Cần lưu external IDs và tiến độ sớm; nếu tiến độ chưa được lưu do sự cố, vẫn tồn tại cửa sổ chưa chắc chắn.

| Job status | Cách diễn giải trên giao diện |
|---|---|
| `queued` | Chờ đến giờ hoặc chờ worker. |
| `running` | Đang thực hiện. |
| `retrying` | Chờ thử lại một lỗi được phân loại an toàn để retry. |
| `succeeded` | Bước đã có kết quả được ghi nhận. |
| `failed` | Thất bại; hiển thị lý do và cách xử lý có thể thực hiện. |
| `uncertain` | Cần đối soát trên Facebook trước khi tạo lại. |
| `canceled` | Đã hủy công việc chưa thực hiện; không đồng nghĩa xóa bài đã đăng. |

## Giới hạn và lỗi Meta

Meta áp dụng rate limits theo loại token và use case. Page token có thể chịu BUC rate limits. Lớp tích hợp nên đọc `X-Business-Use-Case-Usage` và tôn trọng thời gian hồi phục; `estimated_time_to_regain_access` được tài liệu Meta mô tả theo **phút**.

Mã `80001` biểu thị giới hạn Page/system-user token; các mã `4`, `17`, `32`, `613` cũng liên quan throttling trong những ngữ cảnh khác. Không retry vô hạn và không tự tăng luồng khi bị giới hạn. Lỗi token cần hiển thị yêu cầu kết nối lại; không hứa một token dài hạn sẽ hoạt động mãi mãi.

## Thu hồi quyền và xóa dữ liệu

- `/meta/deauthorize` nhận yêu cầu thu hồi từ Meta và phải xác minh `signed_request` trước khi thay đổi dữ liệu.
- `/meta/data-deletion` xác minh yêu cầu, xử lý dữ liệu Facebook liên quan và trả mã xác nhận cùng URL trạng thái dễ hiểu.
- Dữ liệu đã xóa hoặc quyền đã rút không được tiếp tục dùng cho jobs sau đó. Jobs đang chờ cần được dừng/cancel theo phạm vi bị ảnh hưởng.
- Endpoint callback này không phải webhook inbox. V0.1 chưa đăng ký sự kiện `feed`, chưa có hộp thư tập trung đọc/trả lời mọi bình luận và không cần `pages_manage_metadata` chỉ để nhận deauthorization/data-deletion callback.

Cơ chế xóa dữ liệu ứng dụng không tự xóa bài đã đăng trên Facebook. Chính sách backup, thời hạn lưu và phục hồi phải được người vận hành xác định cho môi trường production.

## Hướng mở rộng

Các bước có thể bổ sung theo nhu cầu thực tế:

1. Team membership, RBAC, duyệt bài và giới hạn theo gói dịch vụ.
2. Thanh toán, hóa đơn, quota và quy trình gia hạn/hủy gói.
3. Kho media có upload ký số, kiểm tra định dạng/kích thước và quản lý vòng đời file.
4. Inbox bình luận qua Page webhook, xác minh chữ ký trên raw body và chống xử lý lặp sự kiện; xin quyền bổ sung tương ứng.
5. Reels, Stories, nhiều ảnh, lịch lặp và tích hợp n8n qua API được bảo vệ.
6. Hàng đợi chuyên dụng hoặc phân vùng dữ liệu khi các chỉ số độ trễ, DB locks và lưu lượng yêu cầu.
7. Hỗ trợ Business Integration System User cho khách hàng phù hợp sau khi hoàn thiện luồng tài sản, quyền và vòng đời token riêng.

Không bật các tính năng tương lai trong giao diện như thể đã hoạt động. Mỗi module mới cần hợp đồng API, authorization, migration, test và tài liệu quyền tương ứng.

## Điều kiện trước khi thương mại hóa

Cần môi trường HTTPS thật, secret management, sao lưu có kiểm tra khôi phục, quan sát độ trễ/lỗi/hàng đợi, xoay khóa và quy trình hỗ trợ người dùng. Cần kiểm thử tích hợp Meta thật với app/quyền đã được phê duyệt, kiểm thử tải phù hợp số khách dự kiến và rà soát bảo mật trước khi nhận khách hàng.

Tính năng ứng dụng không thay thế Advanced Access, App Review, business verification hoặc Access Verification mà Meta yêu cầu. Bản này không đưa ra bảo đảm tuân thủ pháp lý hay bảo đảm Meta duyệt app.

## Nguồn kỹ thuật

- [PostgreSQL SELECT / SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html)
- [PostgreSQL explicit and advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html)
- [Facebook Login for Business](https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business)
- [Secure Graph API requests](https://developers.facebook.com/docs/graph-api/guides/secure-requests/)
- [Permissions](https://developers.facebook.com/documentation/development/permissions)
- [Meta rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)
- [Page feed](https://developers.facebook.com/docs/graph-api/reference/page/feed/)
- [Page photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/)
- [Page videos](https://developers.facebook.com/docs/graph-api/reference/page/videos)
- [Comments](https://developers.facebook.com/docs/graph-api/reference/object/comments)
- [Data deletion callback](https://developers.facebook.com/documentation/development/create-an-app/app-dashboard/data-deletion-callback)
