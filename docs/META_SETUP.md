# Kết nối V9 Page Studio với Meta

Tài liệu này dành cho **V9 Page Studio v0.1**: đăng nội dung lên các Facebook Page mà người dùng có quyền quản lý, lên lịch qua máy chủ và tự gửi một bình luận sau bài đăng.

## Trước khi bắt đầu

Bạn cần hai phần riêng biệt:

1. **Máy chủ ứng dụng có HTTPS**, chạy API, giao diện thật, PostgreSQL và worker. Làm theo README để triển khai. Máy chủ phải tiếp tục hoạt động khi bạn đóng trình duyệt.
2. **Ứng dụng Meta của bạn**, được cấu hình OAuth và các quyền phù hợp.

Địa chỉ GitHub Pages `/studio/` là **bản xem trước với dữ liệu mô phỏng**. Nó giúp thử giao diện và thao tác soạn bài; không chạy worker hoặc lưu token để đăng bài thật. Đăng nhập thật phải mở trên địa chỉ máy chủ đã triển khai.

Trong các bước dưới đây, `https://studio.example.com` là ví dụ. Thay bằng miền HTTPS thực tế của bạn. Các URL callback phải khớp chính xác với cấu hình máy chủ.

## 1. Chuẩn bị ứng dụng Meta

Mở [Meta App Dashboard](https://developers.facebook.com/apps/) và chọn ứng dụng dành cho V9 Page Studio. Chọn use case quản lý Page và cấu hình sản phẩm đăng nhập mà Meta cung cấp cho loại app đó.

Với sản phẩm dự định phục vụ khách hàng, dùng **Facebook Login for Business** nếu loại app/use case của bạn hỗ trợ. Trong **Facebook Login for Business → Configurations**:

1. Tạo một configuration dành cho V9 Page Studio.
2. Chọn **User access token**. Bản v0.1 lấy danh sách Page qua người đăng nhập; chưa triển khai flow Business Integration System User.
3. Chọn tài sản Facebook Pages và các quyền trong bảng bên dưới.
4. Sao chép **Configuration ID** vào biến môi trường cấu hình đăng nhập của máy chủ.

Không chọn System-user access token cho bản này. Flow đó có yêu cầu business portfolio và cách quản lý token khác; cần bổ sung module riêng trước khi sử dụng.

Nếu app hiện tại của bạn dùng Facebook Login kiểu scope, mã nguồn có thể dùng cấu hình scope khi không đặt Configuration ID. Đây là đường tương thích cho app đủ điều kiện; không có nghĩa mọi loại app mới đều hỗ trợ Facebook Login cũ. Hãy làm theo sản phẩm và quyền thực tế xuất hiện trong App Dashboard.

## 2. Chỉ xin các quyền có chức năng sử dụng

| Quyền | V9 Page Studio sử dụng để làm gì |
|---|---|
| `public_profile` | Xác định tài khoản Facebook đăng nhập. |
| `pages_show_list` | Hiện danh sách Page người dùng được quyền quản lý. |
| `pages_read_engagement` | Đọc thông tin và nội dung Page cần cho chức năng đăng bài. |
| `pages_manage_posts` | Đăng bài chữ, ảnh hoặc video dưới danh nghĩa Page. |
| `pages_read_user_content` | Quyền phụ thuộc của chức năng quản lý bình luận theo permissions reference hiện tại. |
| `pages_manage_engagement` | Gửi bình luận dưới bài đăng dưới danh nghĩa Page. |

Người cấp quyền phải có nhiệm vụ phù hợp trên Page: `CREATE_CONTENT` để đăng nội dung và `MODERATE` để bình luận. Việc có Page trong danh sách không tự động chứng minh được phép thực hiện mọi hành động.

**Để mở cho nhiều người dùng:** luồng đăng nhập OAuth kiểu `scope` mặc định chỉ yêu cầu `public_profile`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`. Hai quyền bình luận (`pages_read_user_content`, `pages_manage_engagement`) là tùy chọn; chỉ đặt `META_ENABLE_COMMENTS=true` trên máy chủ khi đã được Meta phê duyệt và muốn dùng chức năng bình luận. Nếu dùng `META_LOGIN_CONFIG_ID`, Meta Facebook Login for Business Configuration quyết định tập quyền: cần bỏ các quyền chưa được phê duyệt trong Configuration, vì `META_ENABLE_COMMENTS` không chỉnh được quyền của Configuration. Người dùng thiếu quyền bình luận vẫn có thể quản lý và đăng bài, nhưng không thể sử dụng tính năng gửi bình luận đầu tiên. Không mô tả chức năng đọc bình luận người dùng là đã triển khai ở v0.1.**

**Không xin `pages_manage_metadata` ở v0.1:** bản này chưa đăng ký webhook Page hoặc cung cấp hộp thư bình luận tập trung. Chỉ thêm quyền đó khi thực sự triển khai tính năng tương ứng.

**Không xin `business_management` chỉ để đăng bài:** flow này không cần quản lý Business Manager. Chỉ thêm khi một module cụ thể cần quyền đó và có thể trình diễn chức năng cho Meta.

## 3. Cấu hình URL của app

Trong cấu hình đăng nhập và cài đặt ứng dụng Meta, sử dụng các URL sau với miền máy chủ thật:

| Mục trong Meta | Giá trị mẫu |
|---|---|
| Website URL | `https://studio.example.com/` |
| Valid OAuth Redirect URIs | `https://studio.example.com/auth/facebook/callback` |
| Deauthorize Callback URL | `https://studio.example.com/meta/deauthorize` |
| Data Deletion Request URL | `https://studio.example.com/meta/data-deletion` |

Thêm miền thực tế vào App Domains nếu dashboard yêu cầu. App Domains chỉ chứa tên miền, không kèm đường dẫn callback.

Các trang công khai hiện có của dự án:

- Chính sách quyền riêng tư: <https://thangmai02.github.io/v9-tool-privacy/privacy-policy.html>
- Điều khoản sử dụng: <https://thangmai02.github.io/v9-tool-privacy/terms.html>
- Hướng dẫn xóa dữ liệu: <https://thangmai02.github.io/v9-tool-privacy/data-deletion.html>

Kiểm tra thông tin người vận hành, email hỗ trợ, dữ liệu thu thập và cách lưu trữ trong các trang này khớp với hệ thống thực tế trước khi gửi xét duyệt hoặc nhận khách hàng. Trang hướng dẫn tĩnh không thay thế endpoint Data Deletion Request của backend.

## 4. Đặt bí mật trên máy chủ

Dùng file `.env.example` và hướng dẫn triển khai trong README để đặt App ID, App Secret, Configuration ID, địa chỉ HTTPS công khai, kết nối PostgreSQL và khóa mã hóa token.

| Biến | Cách điền |
|---|---|
| `PUBLIC_BASE_URL` | Origin HTTPS thật, ví dụ `https://studio.example.com`, không thêm đường dẫn `/studio`. |
| `META_APP_ID` | App ID từ Meta App Dashboard. |
| `META_APP_SECRET` | App Secret, đặt bằng secret/environment của backend. |
| `META_LOGIN_CONFIG_ID` | Configuration ID cấp **User access token** trong Facebook Login for Business. Chỉ để trống khi app của bạn dùng flow scope tương thích. |
| `META_GRAPH_VERSION` | `v27.0` cho bản đang kiểm thử. |
| `META_ENABLE_COMMENTS` | `false` mặc định; đặt `true` chỉ với luồng scope khi các quyền bình luận đã được phê duyệt. Với Business Login, quyền do Configuration ID quyết định. |
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL của môi trường triển khai. |
| `TOKEN_ENCRYPTION_KEY` | Khóa ngẫu nhiên 32 byte, mã hóa base64. |
| `NODE_ENV` | `production` trên máy chủ production. |
| `PORT` | Mặc định `3000`; proxy HTTPS chuyển request vào cổng này. |

Mặc định worker xử lý tối đa 4 việc cùng lúc (`WORKER_CONCURRENCY`) và giãn ít nhất 15 giây trên mỗi Page (`PAGE_INTERVAL_SECONDS`). Đây là thông số vận hành ban đầu, không phải hạn mức do Meta cấp. Session ứng dụng mặc định 7 ngày (`SESSION_TTL_DAYS`), tách biệt hạn sử dụng token Facebook.

- App Secret và khóa mã hóa chỉ nằm trong secret/environment của backend.
- Không đưa App Secret, Page access token, mật khẩu Facebook hoặc cookie vào GitHub, bundle frontend hoặc nội dung chat.
- Dùng khóa ngẫu nhiên đủ độ dài theo yêu cầu của `.env.example`; không dùng giá trị mẫu cho production.
- Giữ an toàn khóa mã hóa và bản sao lưu. Thay khóa mà không chuyển đổi dữ liệu đã mã hóa sẽ làm token cũ không đọc được.

`META_GRAPH_VERSION` nên được ghim theo phiên bản đã kiểm thử. Tài liệu Meta được kiểm tra ngày **22/11/2026** hiển thị **v27.0**; nâng phiên bản cần kiểm thử lại, không tự đổi mỗi khi Meta phát hành bản mới.

## 5. Thử kết nối với tài khoản của bạn

1. Thêm tài khoản kiểm thử vào vai trò phù hợp của app, nếu app/quyền hiện vẫn giới hạn cho người có vai trò.
2. Mở **địa chỉ backend HTTPS thật**, bấm đăng nhập Facebook. Trình duyệt chuyển sang miền Facebook để đăng nhập và cấp quyền.
3. Chọn đúng các Page muốn cấp quyền. Đăng nhập không có nghĩa app được phép truy cập tất cả Page trong tài khoản.
4. Sau khi quay lại V9 Page Studio, kiểm tra tên Page và khả năng đăng bài/bình luận. Nếu thiếu quyền, kiểm tra quyền thực tế đã cấp và task trên Page.
5. Tạo nội dung rõ ràng dành cho kiểm thử, chọn một Page bạn quản lý rồi đăng thử. Có thể thêm một bình luận thử để kiểm tra đủ chuỗi thao tác.
6. Mở liên kết bài thật và kiểm tra riêng việc đăng bài, xử lý media, bình luận và khả năng xem từ tài khoản khác có điều kiện truy cập phù hợp.

Không nhập mật khẩu Facebook, mã 2FA hoặc cookie vào V9 Page Studio. Cụm từ “đăng nhập via” trong quy trình này chỉ có nghĩa là đăng nhập tài khoản Facebook qua cửa sổ OAuth chính thức và cho phép truy cập Page.

## 6. Ảnh, video và lịch đăng

- v0.1 nhận **một ảnh hoặc một video qua URL HTTPS công khai** cho mỗi nội dung. Chưa có kho media hoặc chức năng tải file từ máy lên bộ lưu trữ.
- Link phải trỏ tới file thật mà Meta tải được, không phải trang chia sẻ cần đăng nhập. Link có hạn sử dụng phải còn hiệu lực đến lúc worker thực hiện bài đã lên lịch.
- Worker xử lý lịch lưu trong hệ thống; không phụ thuộc việc trang web còn mở. Nếu worker/máy chủ ngừng, công việc có thể bị trễ.
- Tên nội dung trong V9 là nhãn quản lý nội bộ. Phần nội dung bài và media mới là dữ liệu dùng khi đăng lên Facebook.
- “Bình luận đầu tiên” nghĩa là tự gửi bình luận sau khi bài được tạo. Không bảo đảm bình luận đó luôn đứng đầu về thời gian hoặc thứ tự hiển thị của Facebook.
- Không đặt giới hạn đối tượng trong request đăng bài không có nghĩa mọi người đều được phân phối bài. Trạng thái Page, giới hạn tuổi/quốc gia, quyền riêng tư liên quan và hệ thống phân phối Facebook vẫn có thể ảnh hưởng khả năng xem hoặc tiếp cận.

## 7. Mở cho khách hàng ngoài app

Viết xong mã nguồn hoặc đưa website lên mạng **không tự cấp Advanced Access**. Muốn khách hàng ngoài vai trò app đăng nhập và dùng các quyền Page, bạn cần hoàn thành yêu cầu Meta áp dụng cho app của mình:

1. Xác minh doanh nghiệp gắn với app khi xin Advanced Access.
2. Hoàn thành câu hỏi xử lý dữ liệu và App Review cho các quyền sử dụng.
3. Kiểm tra yêu cầu Access Verification/Tech Provider khi cung cấp dịch vụ truy cập tài sản của doanh nghiệp khác.
4. Ghi lại luồng thật: đăng nhập → chọn Page → đăng bài → bình luận → xem kết quả trên Facebook. Chỉ mô tả chức năng đã chạy được trong bản nộp.
5. Hoàn thành bước công bố/Live nếu loại app có bước này. Một số business app quản lý bằng access level thay vì nút chuyển chế độ giống app khác.

Nếu chưa có thông tin doanh nghiệp cần xác minh, bạn vẫn có thể phát triển và kiểm thử trong phạm vi Meta cho phép. Phần mềm không thay thế được giấy tờ xác minh. Không điền thông tin doanh nghiệp hư cấu hoặc dùng giấy tờ không thuộc quyền sử dụng của bạn.

Trước khi thu phí, cần kiểm thử end-to-end bằng app thật, thử tải và khôi phục dữ liệu, cấu hình backup, giám sát và quy trình hỗ trợ. Bản v0.1 là nền tảng phát triển; chưa có thanh toán, gói dịch vụ, mời thành viên hay phân quyền nhóm.

## 8. Các trạng thái cần hiểu

| Trạng thái | Ý nghĩa và cách xử lý |
|---|---|
| Chờ / lên lịch | Công việc đã lưu; worker sẽ nhận khi đến giờ và đủ điều kiện chạy. |
| Đang xử lý | Worker đang thực hiện một bước. Video có thể cần thời gian xử lý tại Meta. |
| Đang thử lại | Một lỗi được xác định có thể thử lại an toàn; hệ thống chờ theo chính sách retry. |
| Hoàn tất | Bước tương ứng đã có kết quả được ghi nhận. Kiểm tra cả bước đăng bài lẫn bình luận. |
| Thất bại | Cần xem lý do: thiếu quyền, link media lỗi, token không hợp lệ hoặc lỗi khác. |
| Cần đối soát / `uncertain` | Mất phản hồi khi gọi thao tác ghi; có thể Meta đã nhận. Kiểm tra Page thật trước khi tạo lại nội dung, để tránh đăng trùng. |
| Đã hủy | Công việc chờ đã bị hủy; thao tác đã hoàn thành trên Facebook không tự bị xóa. |

Token không hợp lệ hoặc quyền bị rút cần đăng nhập/kết nối lại. Token dài hạn không phải cam kết truy cập vĩnh viễn. Khi gặp giới hạn API, tăng số luồng không giải quyết được vấn đề; phải giảm nhịp hoặc chờ.

Khi Meta gửi yêu cầu xóa dữ liệu hợp lệ, backend trả mã xác nhận và đường dẫn dạng `https://studio.example.com/deletion/status/<ma-xac-nhan>`. Dùng đường dẫn này để xem trạng thái; không thay bằng một trang tĩnh luôn báo đã xóa.

## Tài liệu chính thức

- [Facebook Login for Business](https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business)
- [Manual login flow](https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow)
- [Permissions reference](https://developers.facebook.com/documentation/development/permissions)
- [Long-lived access tokens](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived)
- [Page feed](https://developers.facebook.com/docs/graph-api/reference/page/feed/)
- [Page photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/)
- [Page videos](https://developers.facebook.com/docs/graph-api/reference/page/videos)
- [Comments](https://developers.facebook.com/docs/graph-api/reference/object/comments)
- [Rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)
- [Data deletion callback](https://developers.facebook.com/documentation/development/create-an-app/app-dashboard/data-deletion-callback)
- [App Review](https://developers.facebook.com/docs/resp-plat-initiatives/app-review/introduction)
- [Tech Providers](https://developers.facebook.com/docs/development/release/tech-providers/)
