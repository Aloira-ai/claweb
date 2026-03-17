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
  (ENV.CLAWEB_STATIC_ROOT || "../../clients/browser").trim(),
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

const FILE_MAX_MB = Math.max(1, Number(ENV.CLAWEB_FILE_MAX_MB || 25) || 25);
const FILE_MAX_BYTES = FILE_MAX_MB * 1024 * 1024;

const UPSTREAM_WS = (ENV.CLAWEB_UPSTREAM_WS || "ws://127.0.0.1:18999").trim();
const UPSTREAM_TOKEN = (
  ENV.CLAWEB_UPSTREAM_TOKEN ||
  (ENV.CLAWEB_UPSTREAM_TOKEN_FILE
    ? fs.readFileSync(ENV.CLAWEB_UPSTREAM_TOKEN_FILE, "utf8")
    : "")
).trim();
const UI_TITLE = String(ENV.CLAWEB_UI_TITLE || "").trim();
const UI_CHARACTER_NAME = String(ENV.CLAWEB_UI_CHARACTER_NAME || ENV.CLAWEB_ASSISTANT_NAME || "").trim();
const UI_AVATAR = String(ENV.CLAWEB_UI_AVATAR || "").trim();
const UI_AVATAR_MODE = String(ENV.CLAWEB_UI_AVATAR_MODE || "").trim();

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

function extLower(name) {
  const ext = path.extname(String(name || "")).toLowerCase();
  return ext.startsWith(".") ? ext : ext ? `.${ext}` : "";
}

function guessMimeFromExt(ext) {
  const e = String(ext || "").toLowerCase();
  // office-ish
  if (e === ".pdf") return "application/pdf";
  if (e === ".doc") return "application/msword";
  if (e === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (e === ".xls") return "application/vnd.ms-excel";
  if (e === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (e === ".ppt") return "application/vnd.ms-powerpoint";
  if (e === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (e === ".csv") return "text/csv";
  if (e === ".txt") return "text/plain";
  // common
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  if (e === ".gif") return "image/gif";
  if (e === ".svg") return "image/svg+xml";
  if (e === ".bmp") return "image/bmp";
  if (e === ".avif") return "image/avif";
  if (e === ".mp4") return "video/mp4";
  if (e === ".webm") return "video/webm";
  if (e === ".mov") return "video/quicktime";
  if (e === ".m4v") return "video/x-m4v";
  if (e === ".ogv") return "video/ogg";
  return "application/octet-stream";
}

function guessExtFromMime(mime) {
  const m = String(mime || "").trim().toLowerCase();
  if (m === "application/pdf") return ".pdf";
  if (m === "application/msword") return ".doc";
  if (m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return ".docx";
  if (m === "application/vnd.ms-excel") return ".xls";
  if (m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return ".xlsx";
  if (m === "application/vnd.ms-powerpoint") return ".ppt";
  if (m === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return ".pptx";
  if (m === "text/csv") return ".csv";
  if (m === "text/plain") return ".txt";
  if (m === "image/png") return ".png";
  if (m === "image/jpeg") return ".jpg";
  if (m === "image/webp") return ".webp";
  if (m === "image/gif") return ".gif";
  if (m === "image/svg+xml") return ".svg";
  if (m === "image/bmp") return ".bmp";
  if (m === "image/avif") return ".avif";
  if (m === "video/mp4") return ".mp4";
  if (m === "video/webm") return ".webm";
  if (m === "video/quicktime") return ".mov";
  if (m === "video/x-m4v") return ".m4v";
  if (m === "video/ogg") return ".ogv";
  return "";
}

function isAllowedOfficeUpload(name) {
  const e = extLower(name);
  return [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv", ".txt"].includes(e);
}

async function readBodyBuffer(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new Error("payload_too_large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function parseMultipart(contentType) {
  const m = String(contentType || "").match(/boundary=(?:(?:\"([^\"]+)\")|([^;]+))/i);
  const boundary = (m?.[1] || m?.[2] || "").trim();
  if (!boundary) return null;
  return { boundary };
}

function parsePartHeaders(raw) {
  const headers = {};
  String(raw || "")
    .split(/\r\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) => {
      const idx = line.indexOf(":");
      if (idx <= 0) return;
      const k = line.slice(0, idx).trim().toLowerCase();
      const v = line.slice(idx + 1).trim();
      headers[k] = v;
    });
  return headers;
}

function parseContentDisposition(v) {
  const out = {};
  const raw = String(v || "");
  raw
    .split(";")
    .slice(1)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const [k, ...rest] = pair.split("=");
      const key = String(k || "").trim().toLowerCase();
      let val = rest.join("=").trim();
      if (val.startsWith("\"") && val.endsWith("\"")) val = val.slice(1, -1);
      if (key) out[key] = val;
    });
  return out;
}

async function readMultipartFile(req, { fieldName = "file", maxBytes }) {
  const ct = String(req.headers["content-type"] || "");
  const mp = parseMultipart(ct);
  if (!mp) throw new Error("invalid_multipart");

  const body = await readBodyBuffer(req, maxBytes);
  const boundary = Buffer.from(`--${mp.boundary}`);

  let pos = 0;
  // first boundary
  const first = body.indexOf(boundary, pos);
  if (first < 0) throw new Error("invalid_multipart");
  pos = first;

  while (pos >= 0) {
    const start = body.indexOf(boundary, pos);
    if (start < 0) break;
    let partStart = start + boundary.length;

    // final boundary
    if (body.slice(partStart, partStart + 2).toString() === "--") break;

    // skip CRLF
    if (body.slice(partStart, partStart + 2).toString() === "\r\n") partStart += 2;

    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (headerEnd < 0) break;
    const headersRaw = body.slice(partStart, headerEnd).toString("utf8");
    const headers = parsePartHeaders(headersRaw);

    const cd = parseContentDisposition(headers["content-disposition"] || "");
    const name = cd.name || "";
    const filename = cd.filename || "";

    const dataStart = headerEnd + 4;
    const nextBoundary = body.indexOf(boundary, dataStart);
    if (nextBoundary < 0) break;
    // data ends with CRLF before boundary
    let dataEnd = nextBoundary;
    if (body.slice(dataEnd - 2, dataEnd).toString() === "\r\n") dataEnd -= 2;
    const data = body.slice(dataStart, dataEnd);

    if (name === fieldName) {
      return {
        filename: filename || "upload.bin",
        contentType: String(headers["content-type"] || "").trim().toLowerCase() || null,
        data,
      };
    }

    pos = nextBoundary;
  }

  throw new Error("missing_file");
}

function saveDataUrlFile(dataUrl, originalName = "attachment.bin") {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) throw new Error("invalid_media_data");
  const mime = String(match[1] || "application/octet-stream").toLowerCase();
  const preferredExt = extLower(originalName);
  const ext = preferredExt || guessExtFromMime(mime) || ".bin";
  const safeBase = safeFileSegment(path.basename(originalName, path.extname(originalName))) || "attachment";
  const fileName = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}-${safeBase}${ext}`;
  const filePath = path.join(MEDIA_DIR, fileName);
  fs.writeFileSync(filePath, Buffer.from(match[2], "base64"));
  return { filePath, mime, relUrl: `/media/${fileName}`, fileName };
}

function saveDataUrlImage(dataUrl, originalName = "image.png") {
  const saved = saveDataUrlFile(dataUrl, originalName);
  if (!/^image\//i.test(saved.mime)) throw new Error("invalid_image_data");
  return saved;
}

function buildAbsoluteMediaUrl(host, relUrl) {
  const safeHost = String(host || "").trim();
  return safeHost ? `https://${safeHost}${relUrl}` : relUrl;
}

function guessMediaTypeFromRef(ref) {
  const raw = String(ref || "").trim();
  if (!raw) return "";
  const dataMatch = raw.match(/^data:([^;,]+)[;,]/i);
  if (dataMatch?.[1]) return String(dataMatch[1]).trim().toLowerCase();
  const sourcePath = raw.startsWith("file://") ? new URL(raw).pathname : raw;
  return guessMimeFromExt(extLower(sourcePath)) || "";
}

function guessRenderableMediaType(ref) {
  const mediaType = guessMediaTypeFromRef(ref);
  return /^(image|video)\//i.test(mediaType) ? mediaType : "";
}

function isRenderableMediaType(mediaType) {
  return /^(image|video)\//i.test(String(mediaType || "").trim());
}

function guessFilenameFromRef(ref) {
  const raw = String(ref || "").trim();
  if (!raw || raw.startsWith("data:")) return "";
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      return path.basename(url.pathname || "") || "";
    }
    if (raw.startsWith("file://")) {
      return path.basename(new URL(raw).pathname || "") || "";
    }
  } catch {
    return "";
  }
  return path.basename(raw) || "";
}

function extractMediaRefsFromText(text) {
  const refs = [];
  const seen = new Set();
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s*MEDIA\s*:\s*(.+?)\s*$/i);
    const ref = String(match?.[1] || "").trim();
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

async function probeMediaType(ref) {
  const raw = String(ref || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";

  const tryFetch = async (method) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(raw, {
        method,
        redirect: "follow",
        signal: controller.signal,
        headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
      });
      return String(response.headers.get("content-type") || "").trim().toLowerCase();
    } catch {
      return "";
    } finally {
      clearTimeout(timer);
    }
  };

  return (await tryFetch("HEAD")) || (await tryFetch("GET"));
}

async function saveLocalFileToMedia(ref, preferredName = "") {
  const raw = String(ref || "").trim();
  if (!raw || /^https?:\/\//i.test(raw) || /^data:/i.test(raw)) return null;
  const sourcePath = raw.startsWith("file://") ? new URL(raw).pathname : path.resolve(raw);
  const sourceStat = await fsp.stat(sourcePath);
  if (!sourceStat.isFile()) throw new Error("missing_file");
  const originalName = preferredName || path.basename(sourcePath) || "attachment.bin";
  const ext = extLower(originalName) || extLower(sourcePath);
  const mime = guessMimeFromExt(ext);
  const safeBase = safeFileSegment(path.basename(originalName, path.extname(originalName))) || "attachment";
  const finalName = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}-${safeBase}${ext || guessExtFromMime(mime) || ".bin"}`;
  const filePath = path.join(MEDIA_DIR, finalName);
  await fsp.copyFile(sourcePath, filePath);
  return { filePath, mime, relUrl: `/media/${finalName}`, fileName: originalName };
}

async function resolveAssistantMediaRef(ref, host, preferredName = "", hintedType = "") {
  const raw = String(ref || "").trim();
  if (!raw) return { mediaUrl: "", mediaType: "", mediaFilename: "" };

  if (/^data:/i.test(raw)) {
    const saved = saveDataUrlFile(raw, preferredName || guessFilenameFromRef(raw) || "attachment.bin");
    return {
      mediaUrl: buildAbsoluteMediaUrl(host, saved.relUrl),
      mediaType: saved.mime,
      mediaFilename: preferredName || saved.fileName || "",
    };
  }

  if (/^https?:\/\//i.test(raw)) {
    return {
      mediaUrl: raw,
      mediaType: hintedType || guessMediaTypeFromRef(raw) || (await probeMediaType(raw)) || "",
      mediaFilename: preferredName || guessFilenameFromRef(raw) || "",
    };
  }

  const saved = await saveLocalFileToMedia(raw, preferredName);
  return saved
    ? {
        mediaUrl: buildAbsoluteMediaUrl(host, saved.relUrl),
        mediaType: hintedType || saved.mime || "",
        mediaFilename: preferredName || saved.fileName || "",
      }
    : { mediaUrl: "", mediaType: "", mediaFilename: "" };
}

function historyKey({ userId, roomId, clientId }) {
  return [safeFileSegment(userId), safeFileSegment(roomId || "direct"), safeFileSegment(clientId)].join("__");
}

function inferAssistantTimestamp(pending) {
  const directTs = Number(pending?.frame?.timestamp || pending?.frame?.ts || 0);
  if (directTs > 0) return directTs;

  const turnId = String(pending?.turnId || pending?.frame?.id || "").trim();
  if (turnId) {
    const parts = turnId.split(":");
    const tail = Number(parts[parts.length - 1] || 0);
    if (tail > 0) return tail;
  }

  const replyTo = String(pending?.replyTo || pending?.frame?.replyTo || pending?.frame?.parentId || "").trim();
  if (replyTo) {
    const parts = replyTo.split(":");
    const tail = Number(parts[parts.length - 1] || 0);
    if (tail > 0) return tail;
  }

  return Date.now();
}

function compactReplyPreview(text, maxLen = 72) {
  const compact = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" / ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "";
  return compact.length > maxLen ? `${compact.slice(0, maxLen - 1)}…` : compact;
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
    replyPreview: record.replyPreview || null,
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
    replyPreview: message.replyPreview ? compactReplyPreview(message.replyPreview) : null,
    mediaUrl: message.mediaUrl || null,
    mediaType: message.mediaType || null,
    mediaFilename: message.mediaFilename || null,
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

    const previewByMessageId = new Map();
    for (const m of sorted) {
      const mid = String(m?.messageId || "").trim();
      if (!mid) continue;
      const preview = compactReplyPreview(m?.text || m?.replyPreview || "");
      if (preview) previewByMessageId.set(mid, preview);
    }
    for (const m of sorted) {
      if (!m || typeof m !== "object") continue;
      if (m.replyPreview) {
        m.replyPreview = compactReplyPreview(m.replyPreview);
        continue;
      }
      const rid = String(m.replyTo || "").trim();
      if (rid && previewByMessageId.has(rid)) {
        m.replyPreview = previewByMessageId.get(rid);
      }
    }

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

  const previewByMessageId = new Map();
  for (const m of messages) {
    const mid = String(m?.messageId || "").trim();
    if (!mid) continue;
    const preview = compactReplyPreview(m?.text || m?.replyPreview || "");
    if (preview) previewByMessageId.set(mid, preview);
  }
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    if (m.replyPreview) {
      m.replyPreview = compactReplyPreview(m.replyPreview);
      continue;
    }
    const rid = String(m.replyTo || "").trim();
    if (rid && previewByMessageId.has(rid)) {
      m.replyPreview = previewByMessageId.get(rid);
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

function buildUiConfig() {
  return {
    title: UI_TITLE || undefined,
    characterName: UI_CHARACTER_NAME || undefined,
    avatar: UI_AVATAR || undefined,
    avatarMode: UI_AVATAR_MODE || undefined,
  };
}

function injectUiConfig(html) {
  const marker = /window\.CLAWEB_UI\s*=\s*\{[\s\S]*?\};/;
  const uiConfigJson = JSON.stringify(buildUiConfig(), null, 2);
  if (marker.test(html)) {
    return html.replace(marker, `window.CLAWEB_UI = Object.assign({}, window.CLAWEB_UI || {}, ${uiConfigJson});`);
  }
  return html;
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
    const body = path.extname(resolved).toLowerCase() === ".html"
      ? Buffer.from(injectUiConfig(String(data)), "utf8")
      : data;
    res.writeHead(200, {
      "content-type": contentTypeFor(resolved),
      "content-length": String(body.length),
      "cache-control": "public, max-age=0",
    });
    res.end(body);
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
      return json(res, 200, { ok: true, mediaUrl: absUrl, mediaType: saved.mime, relUrl: saved.relUrl, mediaFilename: filename || null });
    } catch {
      return json(res, 400, { ok: false, error: "upload_failed" });
    }
  }

  if (req.method === "POST" && url.pathname === "/upload-file") {
    const session = requireSession(req);
    if (!session) return json(res, 401, { ok: false, error: "unauthorized" });

    try {
      const part = await readMultipartFile(req, { fieldName: "file", maxBytes: FILE_MAX_BYTES + 512 * 1024 });
      const original = String(part.filename || "upload.bin");
      if (!isAllowedOfficeUpload(original)) return json(res, 400, { ok: false, error: "unsupported_file_type" });

      if (part.data.length > FILE_MAX_BYTES) return json(res, 413, { ok: false, error: "file_too_large" });

      const safeBase = safeFileSegment(path.basename(original, path.extname(original))) || "file";
      const ext = extLower(original) || ".bin";
      const fileName = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}-${safeBase}${ext}`;
      const filePath = path.join(MEDIA_DIR, fileName);
      await fsp.writeFile(filePath, part.data);

      const mime = part.contentType && part.contentType !== "application/octet-stream" ? part.contentType : guessMimeFromExt(ext);
      const relUrl = `/media/${fileName}`;
      const absUrl = buildAbsoluteMediaUrl(req.headers.host, relUrl);
      return json(res, 200, {
        ok: true,
        mediaUrl: absUrl,
        relUrl,
        mediaType: mime,
        mediaFilename: original,
        size: part.data.length,
        maxMb: FILE_MAX_MB,
      });
    } catch (e) {
      const msg = String(e?.message || e || "upload_failed");
      if (msg.includes("payload_too_large")) return json(res, 413, { ok: false, error: "payload_too_large" });
      if (msg.includes("missing_file")) return json(res, 400, { ok: false, error: "missing_file" });
      if (msg.includes("invalid_multipart")) return json(res, 400, { ok: false, error: "invalid_multipart" });
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
      const mime = guessMimeFromExt(ext);
      const renderable = /^(image|video)\//i.test(mime);
      const safeDownloadName = safeFileSegment(file) || "download";

      res.writeHead(200, {
        "content-type": mime,
        "content-length": String(buf.length),
        "cache-control": renderable ? "public, max-age=31536000, immutable" : "private, max-age=0",
        "content-disposition": renderable ? "inline" : `attachment; filename=\"${safeDownloadName}\"`,
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

const ASSISTANT_FRAME_COALESCE_MS = 900;
const ASSISTANT_MEDIA_ONLY_COALESCE_MS = 900;

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (clientWs, req) => {
  const remote = req?.socket?.remoteAddress || "unknown";
  const state = {
    authed: false,
    session: null,
    upstream: null,
    clientConnected: true,
    inFlight: new Set(),
    pendingAssistant: new Map(),
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

  async function flushPendingAssistant(key) {
    const pending = state.pendingAssistant.get(key);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    state.pendingAssistant.delete(key);

    const turnId = pending.turnId;
    const asstMessageId = `asst_${randomUUID()}`;
    const text = String(pending.text || "").trim();
    const incomingMediaUrl = String(pending.mediaUrl || "").trim();
    const incomingMediaUrls = Array.isArray(pending.mediaUrls)
      ? pending.mediaUrls.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const incomingMediaType = String(pending.mediaType || "").trim();
    const incomingMediaFilename = String(pending.mediaFilename || pending.filename || pending.name || "").trim();
    const incomingMediaDataUrl = String(pending.mediaDataUrl || "").trim();
    const textHasMediaToken = /MEDIA\s*:/i.test(text);
    const textMediaRefs = extractMediaRefsFromText(text);
    let mediaUrl = incomingMediaUrl || incomingMediaUrls[0] || "";
    let mediaType = incomingMediaType || guessMediaTypeFromRef(mediaUrl) || "";
    let mediaFilename = incomingMediaFilename || guessFilenameFromRef(mediaUrl) || "";

    log("info", "assistant_frame", {
      userId: state.session.userId,
      roomId: state.session.roomId,
      clientId: state.session.clientId,
      turnId,
      mergedFrames: pending.frames,
      flushMode: !text && (incomingMediaUrl || incomingMediaUrls.length > 0 || incomingMediaDataUrl) ? "media-only" : "merged",
      hasText: Boolean(text),
      textPreview: text ? text.slice(0, 180) : null,
      textHasMediaToken,
      textMediaRefCount: textMediaRefs.length,
      hasMediaUrl: Boolean(incomingMediaUrl),
      mediaUrlsCount: incomingMediaUrls.length,
      hasMediaDataUrl: Boolean(incomingMediaDataUrl),
      mediaType: incomingMediaType || null,
      keys: Array.from(pending.keys),
    });

    if (mediaUrl && !/^https?:\/\//i.test(mediaUrl)) {
      try {
        const resolved = await resolveAssistantMediaRef(mediaUrl, req.headers.host, mediaFilename, mediaType);
        mediaUrl = resolved.mediaUrl || mediaUrl;
        mediaType = resolved.mediaType || mediaType;
        mediaFilename = resolved.mediaFilename || mediaFilename;
      } catch (error) {
        log("warn", "assistant_media_resolve_failed", {
          userId: state.session.userId,
          roomId: state.session.roomId,
          clientId: state.session.clientId,
          error: String(error?.message || error),
        });
      }
    }

    if (!mediaUrl && textMediaRefs.length > 0) {
      try {
        const resolved = await resolveAssistantMediaRef(textMediaRefs[0], req.headers.host, mediaFilename, mediaType);
        mediaUrl = resolved.mediaUrl || "";
        mediaType = resolved.mediaType || mediaType;
        mediaFilename = resolved.mediaFilename || mediaFilename;
      } catch (error) {
        log("warn", "assistant_text_media_resolve_failed", {
          userId: state.session.userId,
          roomId: state.session.roomId,
          clientId: state.session.clientId,
          error: String(error?.message || error),
        });
      }
    }

    if (!mediaType && mediaUrl) {
      mediaType = guessMediaTypeFromRef(mediaUrl) || (await probeMediaType(mediaUrl));
    }
    if (!mediaFilename && mediaUrl) {
      mediaFilename = guessFilenameFromRef(mediaUrl) || mediaFilename;
    }

    if (!mediaUrl && incomingMediaDataUrl) {
      try {
        const resolved = await resolveAssistantMediaRef(incomingMediaDataUrl, req.headers.host, mediaFilename || "assistant-attachment.bin", mediaType);
        mediaUrl = resolved.mediaUrl || "";
        mediaType = resolved.mediaType || mediaType;
        mediaFilename = resolved.mediaFilename || mediaFilename;
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
          ts: inferAssistantTimestamp(pending),
          messageId: asstMessageId,
          replyTo: turnId,
          replyPreview: pending.replyPreview || undefined,
          mediaUrl: mediaUrl || undefined,
          mediaType: mediaType || undefined,
          mediaFilename: mediaFilename || undefined,
        },
      });
    }

    sendClient({
      ...pending.frame,
      mediaDataUrl: undefined,
      id: asstMessageId,
      messageId: asstMessageId,
      text,
      mediaUrl: mediaUrl || undefined,
      mediaType: mediaType || undefined,
      mediaFilename: mediaFilename || undefined,
      replyTo: pending.replyTo ?? turnId ?? undefined,
      replyPreview: pending.replyPreview || undefined,
    });
    scheduleCloseIfIdle();
  }

  function queueAssistantFrame(frame) {
    const turnId = String(frame.id || "").trim() || null;
    const key = turnId || `frame_${randomUUID()}`;
    const current = state.pendingAssistant.get(key) || {
      turnId,
      frame: { ...frame },
      text: "",
      mediaUrl: "",
      mediaUrls: [],
      mediaType: "",
      mediaFilename: "",
      mediaDataUrl: "",
      replyTo: frame.replyTo ?? frame.parentId ?? turnId ?? undefined,
      replyPreview: frame.replyPreview ? compactReplyPreview(String(frame.replyPreview)) : "",
      keys: new Set(),
      frames: 0,
      timer: null,
    };

    const nextText = String(frame.text || "").trim();
    if (nextText) {
      if (!current.text) current.text = nextText;
      else if (current.text !== nextText && !current.text.includes(nextText)) current.text = `${current.text}\n\n${nextText}`;
    }

    const nextMediaUrl = String(frame.mediaUrl || "").trim();
    if (nextMediaUrl && !current.mediaUrl) current.mediaUrl = nextMediaUrl;

    const nextMediaUrls = Array.isArray(frame.mediaUrls)
      ? frame.mediaUrls.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    for (const item of nextMediaUrls) {
      if (!current.mediaUrls.includes(item)) current.mediaUrls.push(item);
    }

    const nextMediaType = String(frame.mediaType || "").trim();
    if (nextMediaType && !current.mediaType) current.mediaType = nextMediaType;

    const nextMediaFilename = String(frame.mediaFilename || frame.filename || frame.name || "").trim();
    if (nextMediaFilename && !current.mediaFilename) current.mediaFilename = nextMediaFilename;

    const nextMediaDataUrl = String(frame.mediaDataUrl || "").trim();
    if (nextMediaDataUrl && !current.mediaDataUrl) current.mediaDataUrl = nextMediaDataUrl;

    current.replyTo = current.replyTo ?? frame.replyTo ?? frame.parentId ?? turnId ?? undefined;
    current.replyPreview = current.replyPreview || (frame.replyPreview ? compactReplyPreview(String(frame.replyPreview)) : "");
    current.frame = { ...current.frame, ...frame, mediaUrls: current.mediaUrls };
    current.frames += 1;
    for (const item of Object.keys(frame || {})) current.keys.add(item);

    if (current.timer) clearTimeout(current.timer);
    const hasAnyMedia = Boolean(current.mediaUrl || current.mediaDataUrl || current.mediaUrls.length > 0);
    const flushDelayMs = hasAnyMedia && !current.text
      ? ASSISTANT_MEDIA_ONLY_COALESCE_MS
      : ASSISTANT_FRAME_COALESCE_MS;
    current.timer = setTimeout(() => {
      flushPendingAssistant(key).catch((error) => {
        log("error", "assistant_frame_flush_failed", {
          userId: state.session?.userId,
          roomId: state.session?.roomId,
          clientId: state.session?.clientId,
          error: String(error?.message || error),
        });
      });
    }, flushDelayMs);

    state.pendingAssistant.set(key, current);
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
        queueAssistantFrame(frame);
        return;
      }
    });

    upstream.on("close", (code, reason) => {
      metrics.ws.upstreamClose += 1;
      for (const key of Array.from(state.pendingAssistant.keys())) {
        flushPendingAssistant(key).catch(() => {});
      }
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
    const replyPreview = frame.replyPreview ? compactReplyPreview(String(frame.replyPreview)) : "";
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
        replyPreview: replyPreview || undefined,
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
            replyPreview: replyPreview || undefined,
            mediaUrl: mediaUrl || undefined,
            mediaType: mediaType || undefined,
            timestamp: ts,
          }),
        );
      } else {
        sendClient({ type: "error", id, message: "upstream_not_ready" });
      }
    } catch (e) {
      state.inFlight.delete(id);
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
