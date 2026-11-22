/**
 * V9 Buffer Studio - Cloudflare Worker gateway
 *
 * Secrets required (Cloudflare dashboard → Worker → Settings → Variables and Secrets):
 *   BUFFER_API_KEY : personal Buffer key (secret)
 *   ACCESS_CODE    : a long random password for your private web dashboard (secret)
 *
 * Optional:
 *   ALLOWED_ORIGIN : https://thangmai02.github.io
 *   ALLOWED_CHANNEL_ID : Buffer Facebook channel ID to restrict posting
 */
const ORGS = "query GetOrganizations { account { organizations { id name } } }";
const CREATE = `mutation CreateV9Post($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id status externalLink dueAt } }
    ... on MutationError { message }
  }
}`;
const MAX_BODY = 85000;

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-V9-Access",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}
function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(origin)},
  });
}
function validURL(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "https:" && !!u.hostname && !u.username && !u.password && !u.hash;
  } catch { return false; }
}
function dataFor(action, payload, env) {
  if (action === "organizations") return {query: ORGS};
  if (action === "channels") {
    if (typeof payload.organizationId !== "string" || payload.organizationId.length > 256 || !payload.organizationId) {
      throw new Error("Organization ID không hợp lệ.");
    }
    return {query: "query GetChannels { channels(input: { organizationId: " + JSON.stringify(payload.organizationId) + " }) { id name service } }"};
  }
  if (action === "publish") {
    if (typeof payload.channelId !== "string" || !payload.channelId || payload.channelId.length > 256) throw new Error("Channel ID không hợp lệ.");
    if (env.ALLOWED_CHANNEL_ID && payload.channelId !== env.ALLOWED_CHANNEL_ID) throw new Error("Fanpage không được phép sử dụng.");
    if (typeof payload.text !== "string" || payload.text.length > 5000) throw new Error("Nội dung bài không hợp lệ.");
    if (!["shareNow","addToQueue","customScheduled"].includes(payload.mode)) throw new Error("Chế độ xuất bản không hợp lệ.");
    if (!Array.isArray(payload.assets) || payload.assets.length > 10) throw new Error("Số lượng tài sản media không hợp lệ.");
    if (!payload.text && !payload.assets.length) throw new Error("Bài viết phải có nội dung hoặc media.");
    const assets = payload.assets.map(item => {
      if (item && item.image && validURL(item.image.url)) return {image: {url: item.image.url}};
      if (item && item.video && validURL(item.video.url)) return {video: {url: item.video.url}};
      throw new Error("Media URL không hợp lệ.");
    });
    const input = {
      channelId: payload.channelId, text: payload.text,
      mode: payload.mode, schedulingType: "automatic", assets,
    };
    if (payload.mode === "customScheduled") {
      const date = new Date(payload.dueAt);
      if (!payload.dueAt || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error("Thời gian hẹn đăng không hợp lệ.");
      input.dueAt = date.toISOString();
    }
    if (payload.metadata?.facebook?.firstComment) {
      const comment = payload.metadata.facebook.firstComment;
      if (typeof comment !== "string" || comment.length > 5000) throw new Error("Bình luận đầu tiên không hợp lệ.");
      input.metadata = {facebook: {type: "post", firstComment: comment}};
    }
    return {query: CREATE, variables: {input}};
  }
  throw new Error("Thao tác không được phép.");
}
export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://thangmai02.github.io";
    const origin = request.headers.get("Origin") || "";
    if (origin !== allowedOrigin) return new Response("Origin not allowed", {status: 403});
    if (request.method === "OPTIONS") return new Response(null, {status: 204, headers: cors(allowedOrigin)});
    if (request.method !== "POST") return json({error: "Method not allowed"}, 405, allowedOrigin);
    if (!env.BUFFER_API_KEY || !env.ACCESS_CODE) return json({error: "Worker chưa cấu hình BUFFER_API_KEY / ACCESS_CODE."}, 503, allowedOrigin);
    const supplied = request.headers.get("X-V9-Access") || "";
    if (supplied !== env.ACCESS_CODE) return json({error: "Mã truy cập không đúng."}, 401, allowedOrigin);
    if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) return json({error: "Request quá lớn."}, 413, allowedOrigin);
    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return json({error: "Request quá lớn."}, 413, allowedOrigin);
      body = JSON.parse(raw);
    } catch {return json({error: "JSON không hợp lệ."}, 400, allowedOrigin);}
    let graphql;
    try {graphql = dataFor(body.action, body.payload || {}, env);}
    catch(e) {return json({error: e.message}, 400, allowedOrigin);}
    try {
      const result = await fetch("https://api.buffer.com", {
        method: "POST",
        headers: {"Authorization": "Bearer " + env.BUFFER_API_KEY, "Content-Type": "application/json"},
        body: JSON.stringify(graphql),
      });
      const text = await result.text();
      const responseHeaders = {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(allowedOrigin)};
      if (text.length > 200000) return json({error: "Phản hồi từ Buffer quá lớn."}, 502, allowedOrigin);
      return new Response(text, {status: result.status, headers: responseHeaders});
    } catch {return json({error: "Không thể kết nối Buffer."}, 502, allowedOrigin);}
  },
};
