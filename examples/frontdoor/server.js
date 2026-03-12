// Minimal CLAWeb frontdoor example (canonical routes: /login /history /ws)
// - serves static UI
// - login via fixed passphrase mapping
// - persists raw history (JSONL) with stable _idx tie-break
// - maintains a recent snapshot cache for fast refresh restore
// - proxies WS frames to OpenClaw claweb upstream (typically ws://127.0.0.1:18999)

import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV = process.env;

const BIND = (ENV.BIND || "127.0.0.1").trim();
const PORT = Number(ENV.PORT || 18081);

const STATIC_ROOT = path.resolve(
  __dirname,
  (ENV.CLAWEB_STATIC_ROOT || "../../public/claweb").trim(),
);

const LOGIN_CONFIG_PATH = path.resolve(
  __dirname,
  (ENV.CLAWEB_LOGIN_CONFIG || "./config/claweb-login.example.json").trim(),
);

const HISTORY_DIR = path.resolve(
  __dirname,
  (ENV.CLAWEB_HISTORY_DIR || "./data/history").trim(),
);

const MEDIA_DIR = path.resolve(
  __dirname,
  (ENV.CLAWEB_MEDIA_DIR || "./data/media").trim(),
);

const RECENT_LIMIT = Math.max(1, Math.min(1000, Number(ENV.CLAWEB_RECENT_LIMIT || 60) || 60));
const RECENT_TTL_DAYS = Math.max(1, Number(ENV.CLAWEB_RECENT_TTL_DAYS || 7) || 7);
const RECENT_TTL_MS = RECENT_TTL_DAYS * 24 * 60 * 60 * 1000;

const UPSTREAM_WS = (ENV.CLAWEB_UPSTREAM_WS || "ws://127.0.0.1:18999").trim();
const UPSTREAM_TOKEN = (
  ENV.CLAWEB_UPSTREAM_TOKEN ||
  (ENV.CLAWEB_UPSTREAM_TOKEN_FILE
    ? fs.readFileSync(ENV.CLAWEB_UPSTREAM_TOKEN_FILE, "utf8")
    : "")
).trim();

if (!UPSTREAM_TOKEN) {
  console.warn(
    "[frontdoor] WARNING: missing CLAWEB_UPSTREAM_TOKEN (or *_TOKEN_FILE). WS proxy will auth-fail until configured.",
  );
}

await fsp.mkdir(HISTORY_DIR, { recursive: true });
await fsp.mkdir(MEDIA_DIR, { recursive: true });

// --- minimal observability ---
const LOG_LEVEL = (ENV.CLAWEB_LOG_LEVEL || "info").trim().toLowerCase();
const LOG_JSON = String(ENV.CLAWEB_LOG_JSON || "").trim() === "1";

const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = levels[LOG_LEVEL] ?? 20;

function log(level, message, fields = {}) {
  const lv = levels[level] ?? 20;
  if (lv < minLevel) return;
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  };
  if (LOG_JSON) {
    console.log(JSON.stringify(payload));
  } else {
    const extra = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : "";
    console.log(`[frontdoor] ${level.toUpperCase()} ${message}${extra}`);
  }
}

const metrics = {
  history: { snapshotHit: 0, snapshotMiss: 0, rawFallback: 0, warmSnapshot: 0 },
  ws: { upstreamOpen: 0, upstreamClose: 0, upstreamError: 0, upstreamReady: 0, upstreamMessage: 0 },
};

function json(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
  });
  res.end(body);
}

function text(res, status, body, headers = {}) {
  const buf = Buffer.from(String(body));
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": String(buf.length),
    ...headers,
  });
  res.end(buf);
}

function notFound(res) {
  text(res, 404, "not_found");
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeFileSegment(s) {
  return String(s || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 128);
}

function saveDataUrlImage(dataUrl, originalName = "image.png") {
  const match = String(dataUrl || "").match(/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i);
  if (!match) throw new Error("invalid_image_data");
  const mime = match[1].toLowerCase();
  const ext = mime.includes("png")
    ? ".png"
    : mime.includes("webp")
      ? ".webp"
      : mime.includes("gif")
        ? ".gif"
        : ".jpg";
  const safeBase = safeFileSegment(path.basename(originalName, path.extname(originalName))) || "image";
  const fileName = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}-${safeBase}${ext}`;
  const filePath = path.join(MEDIA_DIR, fileName);
  fs.writeFileSync(filePath, Buffer.from(match[3], "base64"));
  return { filePath, mime, relUrl: `/media/${fileName}` };
}

function buildAbsoluteMediaUrl(host, relUrl) {
  const safeHost = String(host || "").trim();
  return safeHost ? `https://${safeHost}${relUrl}` : relUrl;
}

function historyKey({ userId, roomId, clientId }) {
  return [safeFileSegment(userId), safeFileSegment(roomId || "direct"), safeFileSegment(clientId)].join("__");
}

function rawHistoryPath(key) {
  return path.join(HISTORY_DIR, `${key}.jsonl`);
}

function recentSnapshotPath(key) {
  return path.join(HISTORY_DIR, `${key}.recent.json`);
}

// --- login mapping ---

let loginConfigCache = null;
let loginConfigMtime = 0;

async function loadLoginConfig() {
  const stat = await fsp.stat(LOGIN_CONFIG_PATH);
  if (loginConfigCache && stat.mtimeMs === loginConfigMtime) return loginConfigCache;
  const raw = await fsp.readFile(LOGIN_CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw);
  loginConfigCache = parsed;
  loginConfigMtime = stat.mtimeMs;
  return parsed;
}

function findSessionByPassphrase(cfg, passphrase) {
  const matches = [];
  for (const [identity, entry] of Object.entries(cfg || {})) {
    if (!entry || typeof entry !== "object") continue;
    const passphrases = Array.isArray(entry.passphrases) ? entry.passphrases : [];
    if (passphrases.map(String).map((s) => s.trim()).includes(passphrase)) {
      matches.push([identity, entry]);
    }
  }
  return matches;
}

// token -> session
const sessionsByToken = new Map();

function buildSession({ identity, entry }) {
  const token = `tok_${randomUUID()}`;
  const session = {
    identity,
    displayName: String(entry.displayName || identity),
    token,
    userId: String(entry.userId || `user-${identity}`),
    roomId: String(entry.roomId || ""),
    clientId: String(entry.clientId || identity),
    wsUrl: "/ws",
  };
  sessionsByToken.set(token, session);
  return session;
}

function requireSession(req) {
  const token = String(req.headers["x-claweb-token"] || "").trim();
  if (!token) return null;
  return sessionsByToken.get(token) || null;
}

// --- recent snapshot (cache) ---

async function readRecentSnapshot(key) {
  const filePath = recentSnapshotPath(key);
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    const snap = JSON.parse(raw);
    if (!snap || typeof snap !== "object") return null;

    const updatedAt = Number(snap.updatedAt || 0);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
    if (Date.now() - updatedAt > RECENT_TTL_MS) return null;

    const recentMessages = Array.isArray(snap.recentMessages) ? snap.recentMessages : [];
    return {
      updatedAt,
      cursor: snap.cursor || null,
      recentMessages,
    };
  } catch {
    return null;
  }
}

async function writeRecentSnapshot(key, snapshot) {
  const filePath = recentSnapshotPath(key);
  const tmpPath = `${filePath}.tmp.${randomUUID()}`;
  const body = JSON.stringify(snapshot);
  await fsp.writeFile(tmpPath, body, "utf8");
  await fsp.rename(tmpPath, filePath);
}

async function updateRecentSnapshot({ userId, roomId, clientId, record }) {
  const key = historyKey({ userId, roomId, clientId });

  const existing = (await readRecentSnapshot(key)) || {
    updatedAt: 0,
    cursor: null,
    recentMessages: [],
  };

  const recent = Array.isArray(existing.recentMessages) ? existing.recentMessages.slice() : [];
  recent.push({
    role: record.role,
    text: record.text,
    ts: record.ts,
    messageId: record.messageId,
    replyTo: record.replyTo || null,
    mediaUrl: record.mediaUrl || null,
    mediaType: record.mediaType || null,
    _idx: record._idx,
  });

  // keep last N
  const kept = recent.slice(-RECENT_LIMIT);

  const last = kept[kept.length - 1] || null;
  const snapshot = {
    updatedAt: Date.now(),
    cursor: last
      ? { lastTs: last.ts, lastIdx: last._idx, lastMessageId: last.messageId || null }
      : null,
    recentMessages: kept,
  };

  await writeRecentSnapshot(key, snapshot);
}

// --- raw history ---

const idxByFile = new Map();

async function initIdxForFile(filePath) {
  if (idxByFile.has(filePath)) return;
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    idxByFile.set(filePath, lines.length);
  } catch {
    idxByFile.set(filePath, 0);
  }
}

async function appendRawMessage({ userId, roomId, clientId, message }) {
  const key = historyKey({ userId, roomId, clientId });
  const filePath = rawHistoryPath(key);
  await initIdxForFile(filePath);

  const nextIdx = (idxByFile.get(filePath) || 0) + 1;
  idxByFile.set(filePath, nextIdx);

  const record = {
    role: message.role,
    text: message.text,
    ts: message.ts,
    messageId: message.messageId,
    replyTo: message.replyTo || null,
    mediaUrl: message.mediaUrl || null,
    mediaType: message.mediaType || null,
    _idx: nextIdx,
  };

  await fsp.appendFile(filePath, JSON.stringify(record) + "\n", "utf8");

  // best-effort snapshot update (cache)
  try {
    await updateRecentSnapshot({ userId, roomId, clientId, record });
  } catch {
    // ignore cache failures
  }
}

async function loadRawHistory({ userId, roomId, clientId, limit }) {
  const key = historyKey({ userId, roomId, clientId });

  // Try snapshot first
  const snap = await readRecentSnapshot(key);
  if (snap && Array.isArray(snap.recentMessages) && snap.recentMessages.length > 0) {
    metrics.history.snapshotHit += 1;
    const n = Math.max(0, Math.min(1000, Number(limit || 60) || 60));
    const sorted = snap.recentMessages
      .slice()
      .sort((a, b) => {
        const ta = Number(a.ts || 0);
        const tb = Number(b.ts || 0);
        if (ta !== tb) return ta - tb;
        return Number(a._idx || 0) - Number(b._idx || 0);
      });
    return n ? sorted.slice(-n) : sorted;
  }

  metrics.history.snapshotMiss += 1;

  const filePath = rawHistoryPath(key);

  let raw;
  try {
    raw = await fsp.readFile(filePath, "utf8");
  } catch {
    metrics.history.rawFallback += 1;
    return [];
  }

  const lines = raw.split("\n").filter(Boolean);
  const messages = [];
  for (const line of lines) {
    try {
      const m = JSON.parse(line);
      if (!m || typeof m !== "object") continue;
      messages.push(m);
    } catch {
      // ignore
    }
  }

  messages.sort((a, b) => {
    const ta = Number(a.ts || 0);
    const tb = Number(b.ts || 0);
    if (ta !== tb) return ta - tb;
    return Number(a._idx || 0) - Number(b._idx || 0);
  });

  const n = Math.max(0, Math.min(1000, Number(limit || 60) || 60));
  const out = n ? messages.slice(-n) : messages;

  // Warm snapshot best-effort
  if (out.length > 0) {
    try {
      const last = out[out.length - 1];
      metrics.history.warmSnapshot += 1;
      await writeRecentSnapshot(key, {
        updatedAt: Date.now(),
        cursor: {
          lastTs: Number(last.ts || 0),
          lastIdx: Number(last._idx || 0),
          lastMessageId: last.messageId || null,
        },
        recentMessages: out.slice(-RECENT_LIMIT),
      });
    } catch {
      // ignore
    }
  }

  return out;
}

// --- static serving ---

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === "/") {
    res.writeHead(302, { Location: "/index.html" });
    res.end();
    return;
  }

  // prevent path traversal
  pathname = pathname.replace(/\0/g, "");
  const filePath = path.join(STATIC_ROOT, pathname);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(STATIC_ROOT)) {
    notFound(res);
    return;
  }

  try {
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) {
      notFound(res);
      return;
    }
    const data = await fsp.readFile(resolved);
    res.writeHead(200, {
      "content-type": contentTypeFor(resolved),
      "content-length": String(data.length),
      "cache-control": "public, max-age=0",
    });
    res.end(data);
  } catch {
    notFound(res);
  }
}

// --- HTTP server ---

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // canonical routes
  if (req.method === "POST" && url.pathname === "/login") {
    const body = await readJsonBody(req);
    const passphrase = String(body?.passphrase || "").trim();
    if (!passphrase) return json(res, 400, { ok: false, error: "missing_passphrase" });

    let cfg;
    try {
      cfg = await loadLoginConfig();
    } catch {
      return json(res, 500, { ok: false, error: "login_not_configured" });
    }

    const matches = findSessionByPassphrase(cfg, passphrase);
    if (matches.length === 0) return json(res, 401, { ok: false, error: "invalid_credentials" });
    if (matches.length > 1) return json(res, 500, { ok: false, error: "ambiguous_passphrase" });

    const [identity, entry] = matches[0];
    const session = buildSession({ identity, entry });
    log("info", "login_ok", {
      identity: session.identity,
      userId: session.userId,
      roomId: session.roomId,
      clientId: session.clientId,
    });
    return json(res, 200, { ok: true, session });
  }

  if (req.method === "GET" && url.pathname === "/history") {
    const session = requireSession(req);
    if (!session) return json(res, 401, { ok: false, error: "unauthorized" });

    const userId = String(url.searchParams.get("userId") || session.userId || "");
    const roomId = String(url.searchParams.get("roomId") || session.roomId || "");
    const clientId = String(url.searchParams.get("clientId") || session.clientId || "");
    const limit = Number(url.searchParams.get("limit") || 60);

    const messages = await loadRawHistory({ userId, roomId, clientId, limit });
    log("debug", "history_ok", {
      userId,
      roomId,
      clientId,
      limit,
      returned: messages.length,
      snapshotHit: metrics.history.snapshotHit,
      snapshotMiss: metrics.history.snapshotMiss,
    });
    return json(res, 200, { ok: true, messages });
  }

  if (req.method === "GET" && url.pathname === "/threads") {
    const session = requireSession(req);
    if (!session) return json(res, 401, { ok: false, error: "unauthorized" });

    let cfg;
    try {
      cfg = await loadLoginConfig();
    } catch {
      return json(res, 500, { ok: false, error: "login_not_configured" });
    }

    const threads = Object.entries(cfg || {}).map(([identity, entry]) => ({
      identity,
      displayName: String(entry?.displayName || identity),
      userId: String(entry?.userId || ""),
      roomId: String(entry?.roomId || ""),
      clientId: String(entry?.clientId || ""),
    }));

    return json(res, 200, { ok: true, threads });
  }

  if (req.method === "GET" && url.pathname === "/config") {
    // Public, non-sensitive UI config.
    return json(res, 200, {
      ok: true,
      assistantName: String(ENV.CLAWEB_ASSISTANT_NAME || "").trim() || null,
    });
  }

  if (req.method === "POST" && url.pathname === "/upload") {
    const session = requireSession(req);
    if (!session) return json(res, 401, { ok: false, error: "unauthorized" });

    const payload = await readJsonBody(req);
    const dataUrl = payload?.dataUrl;
    const filename = payload?.filename;
    if (!dataUrl) return json(res, 400, { ok: false, error: "missing_data" });

    try {
      const saved = saveDataUrlImage(dataUrl, filename || "image.png");
      const absUrl = buildAbsoluteMediaUrl(req.headers.host, saved.relUrl);
      return json(res, 200, { ok: true, mediaUrl: absUrl, mediaType: saved.mime, relUrl: saved.relUrl });
    } catch {
      return json(res, 400, { ok: false, error: "upload_failed" });
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/media/")) {
    const file = safeFileSegment(url.pathname.slice("/media/".length));
    if (!file) return notFound(res);
    const filePath = path.join(MEDIA_DIR, file);
    try {
      const buf = await fsp.readFile(filePath);
      const ext = path.extname(file).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      res.writeHead(200, {
        "content-type": mime,
        "content-length": String(buf.length),
        "cache-control": "public, max-age=31536000, immutable",
      });
      res.end(buf);
    } catch {
      return notFound(res);
    }
    return;
  }

  // compat aliases
  if (url.pathname.startsWith("/claweb/")) {
    // strip prefix and re-dispatch
    const nextPath = url.pathname.replace(/^\/claweb\b/, "");
    req.url = nextPath + (url.search || "");
    return server.emit("request", req, res);
  }

  // static
  return serveStatic(req, res);
});

// --- WS server (browser-facing) ---

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (clientWs, req) => {
  const remote = req?.socket?.remoteAddress || "unknown";
  const state = {
    authed: false,
    session: null,
    upstream: null,
    clientConnected: true,
    inFlight: new Set(),
    closeTimer: null,
  };

  function sendClient(frame) {
    if (!state.clientConnected) return;
    try {
      clientWs.send(JSON.stringify(frame));
    } catch {
      // ignore
    }
  }

  function scheduleCloseIfIdle() {
    if (state.closeTimer) clearTimeout(state.closeTimer);
    if (state.clientConnected) return;
    state.closeTimer = setTimeout(() => {
      if (state.inFlight.size === 0 && state.upstream) {
        try {
          state.upstream.close();
        } catch {}
        state.upstream = null;
      }
    }, 60_000);
  }

  function ensureUpstream() {
    if (state.upstream && state.upstream.readyState === WebSocket.OPEN) return;

    const upstream = new WebSocket(UPSTREAM_WS);
    state.upstream = upstream;

    upstream.on("open", () => {
      metrics.ws.upstreamOpen += 1;
      log("info", "upstream_open", {
        userId: state.session.userId,
        roomId: state.session.roomId,
        clientId: state.session.clientId,
        upstream: UPSTREAM_WS,
      });
      const hello = {
        type: "hello",
        token: UPSTREAM_TOKEN,
        clientId: state.session.clientId,
        userId: state.session.userId,
        roomId: state.session.roomId || undefined,
      };
      upstream.send(JSON.stringify(hello));
    });

    upstream.on("message", async (chunk) => {
      let frame;
      try {
        frame = JSON.parse(String(chunk));
      } catch {
        return;
      }

      if (frame.type === "ready") {
        metrics.ws.upstreamReady += 1;
        log("debug", "upstream_ready", {
          userId: state.session.userId,
          roomId: state.session.roomId,
          clientId: state.session.clientId,
        });
        sendClient(frame);
        return;
      }

      if (frame.type === "error") {
        sendClient(frame);
        return;
      }

      if (frame.type === "message") {
        metrics.ws.upstreamMessage += 1;

        // Upstream CLAWeb currently tends to reuse the user turn id as `frame.id`.
        // To avoid id collisions (turnId vs messageId), we mint a new assistant message id
        // and attach `replyTo` back to the original turn id.
        const turnId = String(frame.id || "").trim() || null;
        const asstMessageId = `asst_${randomUUID()}`;
        const text = String(frame.text || "").trim();
        const incomingMediaUrl = String(frame.mediaUrl || "").trim();
        const incomingMediaType = String(frame.mediaType || "").trim();
        const incomingMediaDataUrl = String(frame.mediaDataUrl || "").trim();
        let mediaUrl = incomingMediaUrl || "";
        let mediaType = incomingMediaType || "";

        log("info", "assistant_frame", {
          userId: state.session.userId,
          roomId: state.session.roomId,
          clientId: state.session.clientId,
          hasText: Boolean(text),
          hasMediaUrl: Boolean(incomingMediaUrl),
          hasMediaDataUrl: Boolean(incomingMediaDataUrl),
          mediaType: incomingMediaType || null,
        });

        if (!mediaUrl && incomingMediaDataUrl) {
          try {
            const saved = saveDataUrlImage(incomingMediaDataUrl, "assistant-image.png");
            mediaUrl = buildAbsoluteMediaUrl(req.headers.host, saved.relUrl);
            mediaType = saved.mime;
          } catch (error) {
            log("warn", "assistant_media_save_failed", {
              userId: state.session.userId,
              roomId: state.session.roomId,
              clientId: state.session.clientId,
              error: String(error?.message || error),
            });
          }
        }

        if (turnId && state.inFlight.has(turnId)) {
          state.inFlight.delete(turnId);
        }

        if (text || mediaUrl) {
          await appendRawMessage({
            userId: state.session.userId,
            roomId: state.session.roomId,
            clientId: state.session.clientId,
            message: {
              role: "assistant",
              text,
              ts: Date.now(),
              messageId: asstMessageId,
              replyTo: turnId,
              mediaUrl: mediaUrl || undefined,
              mediaType: mediaType || undefined,
            },
          });
        }

        // Forward to browser with new id + replyTo
        sendClient({
          ...frame,
          mediaDataUrl: undefined,
          id: asstMessageId,
          messageId: asstMessageId,
          text,
          mediaUrl: mediaUrl || undefined,
          mediaType: mediaType || undefined,
          replyTo: frame.replyTo ?? frame.parentId ?? turnId ?? undefined,
        });
        scheduleCloseIfIdle();
        return;
      }
    });

    upstream.on("close", (code, reason) => {
      metrics.ws.upstreamClose += 1;
      log("warn", "upstream_close", {
        userId: state.session.userId,
        roomId: state.session.roomId,
        clientId: state.session.clientId,
        code,
        reason: reason ? String(reason) : "",
      });
      sendClient({ type: "error", message: "upstream_closed" });
      scheduleCloseIfIdle();
    });

    upstream.on("error", (err) => {
      metrics.ws.upstreamError += 1;
      log("error", "upstream_error", {
        userId: state.session.userId,
        roomId: state.session.roomId,
        clientId: state.session.clientId,
        error: String(err?.message || err),
      });
      sendClient({ type: "error", message: "upstream_error" });
      scheduleCloseIfIdle();
    });
  }

  clientWs.on("message", async (chunk) => {
    let frame;
    try {
      frame = JSON.parse(String(chunk));
    } catch {
      sendClient({ type: "error", message: "invalid_json" });
      return;
    }

    if (!state.authed) {
      if (!frame || frame.type !== "hello") {
        sendClient({ type: "error", message: "first frame must be hello" });
        clientWs.close(1008, "hello required");
        return;
      }

      const token = String(frame.token || "").trim();
      const session = sessionsByToken.get(token) || null;
      if (!session) {
        log("warn", "ws_auth_failed", { remote });
        sendClient({ type: "error", message: "auth failed" });
        clientWs.close(1008, "unauthorized");
        return;
      }

      state.authed = true;
      state.session = session;
      log("info", "ws_client_hello", {
        remote,
        identity: session.identity,
        userId: session.userId,
        roomId: session.roomId,
        clientId: session.clientId,
      });
      ensureUpstream();
      return;
    }

    if (!frame || frame.type !== "message") {
      sendClient({ type: "error", message: "unsupported frame" });
      return;
    }

    const id = String(frame.id || "").trim();
    const textMsg = String(frame.text || "").trim();
    const replyTo = frame.replyTo ? String(frame.replyTo).trim() : "";
    const mediaUrl = frame.mediaUrl ? String(frame.mediaUrl).trim() : "";
    const mediaType = frame.mediaType ? String(frame.mediaType).trim() : "";
    const ts = Number(frame.timestamp) || Date.now();

    if (!id) return sendClient({ type: "error", message: "missing id" });
    if (!textMsg && !mediaUrl) return sendClient({ type: "error", id, message: "text is empty" });

    await appendRawMessage({
      userId: state.session.userId,
      roomId: state.session.roomId,
      clientId: state.session.clientId,
      message: {
        role: "user",
        text: textMsg,
        ts,
        messageId: id,
        replyTo: replyTo || undefined,
        mediaUrl: mediaUrl || undefined,
        mediaType: mediaType || undefined,
      },
    });

    state.inFlight.add(id);

    try {
      ensureUpstream();
      if (state.upstream && state.upstream.readyState === WebSocket.OPEN) {
        state.upstream.send(
          JSON.stringify({
            type: "message",
            id,
            text: textMsg || "(image)",
            replyTo: replyTo || undefined,
            mediaUrl: mediaUrl || undefined,
            mediaType: mediaType || undefined,
            timestamp: ts,
          }),
        );
      } else {
        sendClient({ type: "error", id, message: "upstream_not_ready" });
      }
    } catch (e) {
      sendClient({ type: "error", id, message: `proxy_failed: ${String(e)}` });
    }
  });

  clientWs.on("close", () => {
    state.clientConnected = false;
    scheduleCloseIfIdle();
  });
});

server.listen(PORT, BIND, () => {
  log("info", "listening", {
    bind: BIND,
    port: PORT,
    staticRoot: STATIC_ROOT,
    loginConfig: LOGIN_CONFIG_PATH,
    historyDir: HISTORY_DIR,
    upstreamWs: UPSTREAM_WS,
    recent: { limit: RECENT_LIMIT, ttlDays: RECENT_TTL_DAYS },
  });
});
