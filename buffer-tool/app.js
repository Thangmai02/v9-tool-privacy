"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const nodes = {
    key: $("api-key"), worker: $("worker-url"), code: $("worker-code"),
    channel: $("channel"), text: $("post-text"), media: $("media-kind"),
    images: $("image-urls"), video: $("video-url"), commentToggle: $("enable-comment"),
    comment: $("first-comment"), mode: $("publish-mode"), at: $("schedule-at"),
    state: $("connection-state"), result: $("result")
  };
  let connection = null;
  const channels = new Map();
  const timeLimit = 25000;
  const ORGS = "query GetOrganizations { account { organizations { id name } } }";
  const CREATE = `mutation CreateV9Post($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id status externalLink dueAt } }
      ... on MutationError { message }
    }
  }`;

  function setBusy(active) {
    $("connect-btn").disabled = active;
    $("publish-btn").disabled = active;
    $("connect-btn").textContent = active ? "Đang xử lý..." : "Kết nối & tải Fanpage";
    $("publish-btn").textContent = active ? "Đang gửi..." : "Gửi bài lên Buffer ↗";
  }
  function feedback(message, type = "info") {
    nodes.result.textContent = message;
    nodes.result.className = "feedback " + type;
  }
  function messageFor(error) {
    const message = String(error?.message || error || "Lỗi không xác định");
    if (error instanceof TypeError && (/fetch|network|failed/i).test(message)) {
      return "Không kết nối được tới API. Có thể do CORS, mạng hoặc endpoint không hợp lệ. Nếu đang dùng 'Thử nhanh', hãy chuyển sang 'Backend an toàn' theo README.";
    }
    return message;
  }
  function validateHttps(value) {
    try {
      const url = new URL(value.trim());
      return url.protocol === "https:" && url.hostname && !url.username && !url.password && !url.hash;
    } catch { return false; }
  }
  function apiShape(action, payload = {}) {
    if (action === "organizations") return {query: ORGS};
    if (action === "channels") return {
      query: "query GetChannels { channels(input: { organizationId: " + JSON.stringify(payload.organizationId) + " }) { id name service } }"
    };
    if (action === "publish") return {query: CREATE, variables: {input: payload}};
    throw new Error("Thao tác không được hỗ trợ");
  }
  async function responseJson(response) {
    let result;
    try { result = await response.json(); } catch { throw new Error("Máy chủ trả về dữ liệu không hợp lệ (HTTP " + response.status + ")."); }
    if (!response.ok) throw new Error(result.error || result.message || ("HTTP " + response.status));
    if (Array.isArray(result.errors) && result.errors.length) {
      throw new Error(result.errors.map(e => e.message).join("; "));
    }
    return result.data || {};
  }
  async function apiCall(action, payload = {}) {
    if (!connection) throw new Error("Bạn cần kết nối trước.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeLimit);
    try {
      let url, headers, body;
      if (connection.method === "direct") {
        url = "https://api.buffer.com";
        headers = {"Authorization": "Bearer " + connection.key, "Content-Type": "application/json"};
        body = apiShape(action, payload);
      } else {
        url = connection.worker;
        headers = {"X-V9-Access": connection.code, "Content-Type": "application/json"};
        body = {action, payload};
      }
      const response = await fetch(url, {
        method: "POST", mode: "cors", credentials: "omit",
        headers, body: JSON.stringify(body), signal: controller.signal,
        cache: "no-store"
      });
      return await responseJson(response);
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Yêu cầu vượt quá thời gian chờ. Vui lòng thử lại.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  function method() {
    return document.querySelector('input[name="method"]:checked').value;
  }
  function clearPageSelect() {
    channels.clear();
    nodes.channel.innerHTML = "";
    const option = document.createElement("option");
    option.textContent = "Kết nối để chọn Fanpage";
    option.value = "";
    nodes.channel.append(option);
    nodes.channel.disabled = true;
    $("org-hint").textContent = "Kết nối Buffer rồi chọn Fanpage của bạn.";
  }
  function renderChannelSelect(items) {
    nodes.channel.innerHTML = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = items.length ? "— Chọn Fanpage —" : "Không có Fanpage Facebook nào";
    nodes.channel.append(first);
    items.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.name + (item.org ? " · " + item.org : "");
      channels.set(item.id, item);
      nodes.channel.append(opt);
    });
    nodes.channel.disabled = !items.length;
    if (items.length === 1) nodes.channel.value = items[0].id;
    $("org-hint").textContent = items.length ? "Đã tìm thấy " + items.length + " Fanpage Facebook. Chọn Trang trước khi gửi bài." : "Chưa thấy Facebook Page. Kết nối Trang tại publish.buffer.com rồi thử lại.";
    renderPreview();
  }
  async function connect() {
    const selected = method();
    if (selected === "direct") {
      if (!nodes.key.value.trim()) return feedback("Bạn chưa nhập Buffer API Key.", "error");
      connection = {method: "direct", key: nodes.key.value.trim()};
    } else {
      const worker = nodes.worker.value.trim().replace(/\/+$/, "");
      if (!validateHttps(worker)) return feedback("Vui lòng nhập URL HTTPS Cloudflare Worker hợp lệ.", "error");
      if (nodes.code.value.trim().length < 8) return feedback("Vui lòng nhập mã truy cập Worker (ít nhất 8 ký tự).", "error");
      connection = {method: "proxy", worker, code: nodes.code.value.trim()};
    }
    setBusy(true);
    clearPageSelect();
    feedback("Đang xác thực và tải danh sách Fanpage...", "info");
    try {
      const data = await apiCall("organizations");
      const orgs = data.account?.organizations || [];
      if (!orgs.length) throw new Error("Tài khoản Buffer chưa có Organization. Hãy kiểm tra quyền Owner và kênh đã kết nối.");
      const all = [];
      for (const org of orgs) {
        const result = await apiCall("channels", {organizationId: String(org.id)});
        for (const ch of result.channels || []) {
          if (String(ch.service).toLowerCase() === "facebook" && ch.id) {
            all.push({id: String(ch.id), name: String(ch.name || "Facebook Page"), org: String(org.name || "")});
          }
        }
      }
      renderChannelSelect(all);
      nodes.state.textContent = "Đã kết nối";
      nodes.state.className = "pill green";
      feedback(all.length ? "Kết nối thành công. Hãy chọn Fanpage và soạn bài." : "Kết nối Buffer thành công nhưng chưa tìm thấy Fanpage Facebook.", all.length ? "success" : "info");
    } catch (error) {
      connection = null;
      nodes.state.textContent = "Chưa kết nối";
      nodes.state.className = "pill neutral";
      feedback("Lỗi kết nối: " + messageFor(error), "error");
    } finally { setBusy(false); }
  }
  function disconnect() {
    connection = null;
    nodes.key.value = "";
    nodes.code.value = "";
    clearPageSelect();
    nodes.state.textContent = "Chưa kết nối";
    nodes.state.className = "pill neutral";
    feedback("Đã xóa API Key/mã truy cập khỏi phiên làm việc.", "success");
  }
  function assets() {
    if (nodes.media.value === "none") return [];
    if (nodes.media.value === "video") {
      const url = nodes.video.value.trim();
      if (!validateHttps(url)) throw new Error("Video phải có một URL HTTPS công khai hợp lệ.");
      return [{video: {url}}];
    }
    const lines = nodes.images.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) throw new Error("Bạn chưa nhập URL ảnh.");
    if (lines.length > 10) throw new Error("Vui lòng chọn tối đa 10 ảnh mỗi bài để tránh lỗi.");
    for (const url of lines) if (!validateHttps(url)) throw new Error("URL ảnh không hợp lệ: " + url);
    return lines.map(url => ({image: {url}}));
  }
  function buildPost() {
    const channelId = nodes.channel.value;
    if (!connection) throw new Error("Bạn chưa kết nối Buffer.");
    if (!channelId || !channels.has(channelId)) throw new Error("Vui lòng chọn Fanpage.");
    const text = nodes.text.value.trim();
    const attachments = assets();
    if (!text && !attachments.length) throw new Error("Bạn cần nhập nội dung hoặc đính kèm ảnh/video.");
    const input = {channelId, text, schedulingType: "automatic", mode: nodes.mode.value, assets: attachments};
    if (nodes.mode.value === "customScheduled") {
      if (!nodes.at.value) throw new Error("Hãy chọn thời gian hẹn đăng.");
      const date = new Date(nodes.at.value);
      if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) throw new Error("Thời gian hẹn phải ở trong tương lai.");
      input.dueAt = date.toISOString();
    }
    if (nodes.commentToggle.checked) {
      const firstComment = nodes.comment.value.trim();
      if (!firstComment) throw new Error("Bạn đã bật bình luận đầu tiên nhưng chưa nhập nội dung.");
      input.metadata = {facebook: {type: "post", firstComment}};
    }
    return input;
  }
  async function publish() {
    let input;
    try { input = buildPost(); } catch(e) { return feedback(messageFor(e), "error"); }
    const ch = channels.get(input.channelId);
    const label = input.mode === "shareNow" ? "ĐĂNG NGAY" : input.mode === "addToQueue" ? "THÊM VÀO HÀNG CHỜ" : "HẸN GIỜ";
    if (!window.confirm("Gửi yêu cầu " + label + " lên Fanpage “" + ch.name + "” qua Buffer?")) return;
    setBusy(true);
    feedback("Đang gửi yêu cầu tạo bài đến Buffer...", "info");
    try {
      const data = await apiCall("publish", input);
      const res = data.createPost;
      if (!res) throw new Error("API không trả về kết quả tạo bài.");
      if (res.__typename !== "PostActionSuccess" || !res.post?.id) {
        throw new Error(res.message || "Buffer từ chối tạo bài. Hãy kiểm tra gói dịch vụ hoặc kênh.");
      }
      const p = res.post;
      const detail = p.externalLink ? "\nLiên kết bài: " + p.externalLink : "\nMở Buffer để xem trạng thái xuất bản.";
      feedback("Buffer đã nhận bài thành công!\nPost ID: " + p.id + "\nTrạng thái: " + (p.status || "đang xử lý") + detail + "\nKiểm tra trên Fanpage bằng cửa sổ ẩn danh.", "success");
    } catch (error) { feedback("Không tạo được bài: " + messageFor(error), "error"); }
    finally { setBusy(false); }
  }
  function renderPreview() {
    $("preview-page").textContent = channels.get(nodes.channel.value)?.name || "Tên Fanpage";
    $("preview-text").textContent = nodes.text.value.trim() || "Nội dung bài đăng sẽ hiển thị ở đây khi bạn nhập.";
    $("char-count").textContent = nodes.text.value.length.toLocaleString("vi-VN") + " ký tự";
    const box = $("preview-media");
    box.replaceChildren();
    if (nodes.media.value === "image") {
      const url = nodes.images.value.split(/\r?\n/).map(x=>x.trim()).find(x=>validateHttps(x));
      if (url) {
        const img = new Image(); img.alt = "Ảnh minh họa"; img.referrerPolicy = "no-referrer"; img.src = url;
        img.addEventListener("error", () => {box.textContent = "Không tải được ảnh xem trước. Kiểm tra URL.";});
        box.append(img); return;
      }
    }
    if (nodes.media.value === "video") {
      const url = nodes.video.value.trim();
      if (validateHttps(url)) {
        const video = document.createElement("video"); video.controls = true; video.preload = "metadata"; video.src = url;
        box.append(video); return;
      }
    }
    const icon = document.createElement("span"); icon.textContent = "▧";
    const label = document.createElement("small"); label.textContent = "Ảnh / video của bạn";
    box.append(icon, label);
  }
  function uiMode() {
    const proxy = method() === "proxy";
    $("direct-fields").hidden = proxy;
    $("proxy-fields").hidden = !proxy;
    disconnect();
  }
  function uiMedia() {
    $("image-field").hidden = nodes.media.value !== "image";
    $("video-field").hidden = nodes.media.value !== "video";
    renderPreview();
  }
  document.querySelectorAll('input[name="method"]').forEach(input => input.addEventListener("change", uiMode));
  $("toggle-key").addEventListener("click", () => {
    nodes.key.type = nodes.key.type === "password" ? "text" : "password";
    $("toggle-key").textContent = nodes.key.type === "password" ? "Hiện" : "Ẩn";
  });
  $("connect-btn").addEventListener("click", connect);
  $("disconnect-btn").addEventListener("click", disconnect);
  nodes.channel.addEventListener("change", renderPreview);
  nodes.text.addEventListener("input", renderPreview);
  nodes.media.addEventListener("change", uiMedia);
  nodes.images.addEventListener("input", renderPreview);
  nodes.video.addEventListener("input", renderPreview);
  nodes.commentToggle.addEventListener("change", () => {
    nodes.comment.disabled = !nodes.commentToggle.checked;
    if (nodes.commentToggle.checked) nodes.comment.focus();
  });
  nodes.mode.addEventListener("change", () => {
    $("schedule-fields").hidden = nodes.mode.value !== "customScheduled";
  });
  $("publish-btn").addEventListener("click", publish);
  $("reset-btn").addEventListener("click", () => {
    nodes.text.value = ""; nodes.images.value = ""; nodes.video.value = ""; nodes.comment.value = ""; nodes.commentToggle.checked = false;
    nodes.comment.disabled = true; nodes.media.value = "none"; nodes.mode.value = "shareNow";
    $("schedule-fields").hidden = true; uiMedia(); feedback("Đã xóa nội dung bài (không xóa kết nối Buffer).");
  });
  uiMedia();
})();