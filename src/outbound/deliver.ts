import { copyFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";

const LOCAL_MEDIA_DIR = process.env.CLAWEB_MEDIA_DIR
  ? path.resolve(process.env.CLAWEB_MEDIA_DIR)
  : path.resolve(process.cwd(), "data/media");
const LOCAL_MEDIA_BASE_URL = process.env.CLAWEB_MEDIA_BASE_URL?.trim().replace(/\/$/, "") || "";

type WsEnvelope = {
  type: "message";
  id: string;
  role: "assistant";
  text: string;
  mediaUrl?: string;
  mediaType?: string;
  mediaDataUrl?: string;
  mediaFilename?: string;
};

type AggregateState = {
  text: string;
  mediaUrl?: string;
  mediaType?: string;
  mediaDataUrl?: string;
  mediaFilename?: string;
  sent?: boolean;
};

type DeliverInfo = {
  kind?: string;
};

const aggregateByMessageId = new Map<string, AggregateState>();

type MediaCandidate = {
  ref: string;
  mediaType?: string;
  mediaFilename?: string;
};

function extractMediaRefsFromText(text: string): MediaCandidate[] {
  const raw = String(text || "");
  if (!raw.trim()) return [];
  const out: MediaCandidate[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*MEDIA\s*:\s*(.+?)\s*$/i);
    if (!match?.[1]) continue;
    const ref = match[1].trim();
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    out.push({ ref, mediaType: guessMediaType(ref), mediaFilename: guessFilename(ref) });
  }
  return out;
}

function extractText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const p = payload as Record<string, unknown>;

  const direct = [p.text, p.body]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join("\n")
    .trim();
  if (direct) {
    return direct;
  }

  const blocks = Array.isArray(p.blocks) ? p.blocks : [];
  const blockText = blocks
    .map((b) => {
      if (!b || typeof b !== "object") {
        return "";
      }
      const record = b as Record<string, unknown>;
      if (typeof record.text === "string") {
        return record.text;
      }
      if (typeof record.content === "string") {
        return record.content;
      }
      return "";
    })
    .filter((t) => t.trim().length > 0)
    .join("\n")
    .trim();

  return blockText;
}

function normalizeMediaType(value: unknown): string | undefined {
  const mediaType = typeof value === "string" ? value.trim().toLowerCase() : "";
  return mediaType || undefined;
}

function guessMimeFromExt(ext: string): string | undefined {
  const e = String(ext || "").toLowerCase();
  if (e === ".pdf") return "application/pdf";
  if (e === ".doc") return "application/msword";
  if (e === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (e === ".xls") return "application/vnd.ms-excel";
  if (e === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (e === ".ppt") return "application/vnd.ms-powerpoint";
  if (e === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (e === ".csv") return "text/csv";
  if (e === ".txt") return "text/plain";
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
  return undefined;
}

function guessMediaType(ref: string): string | undefined {
  const raw = String(ref || "").trim();
  if (!raw) return undefined;

  const dataMatch = raw.match(/^data:([^;,]+)[;,]/i);
  if (dataMatch?.[1]) return dataMatch[1].trim().toLowerCase();

  const candidate = raw.startsWith("file://")
    ? new URL(raw).pathname
    : raw.replace(/[?#].*$/, "");
  return guessMimeFromExt(path.extname(candidate).toLowerCase()) || undefined;
}

function isRenderableMediaType(mediaType: string | undefined): boolean {
  return Boolean(mediaType && /^(image|video)\//.test(mediaType));
}

function guessFilename(ref: string): string | undefined {
  const raw = String(ref || "").trim();
  if (!raw) return undefined;
  if (raw.startsWith("data:")) return undefined;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const name = path.basename(url.pathname || "");
      return name || undefined;
    } catch {
      return undefined;
    }
  }
  const sourcePath = raw.startsWith("file://") ? new URL(raw).pathname : raw;
  const name = path.basename(sourcePath);
  return name || undefined;
}

function sanitizeFilename(name: string | undefined, fallback = "attachment"): string {
  const base = String(name || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 180);
  return base || fallback;
}

function mimeToExt(mediaType: string | undefined): string {
  const type = normalizeMediaType(mediaType) || "";
  const map: Record<string, string> = {
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "text/csv": ".csv",
    "text/plain": ".txt",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/bmp": ".bmp",
    "image/avif": ".avif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "video/x-m4v": ".m4v",
    "video/ogg": ".ogv",
  };
  return map[type] || "";
}

function ensureFilename(name: string | undefined, mediaType: string | undefined): string | undefined {
  const safe = sanitizeFilename(name, "attachment");
  if (path.extname(safe)) return safe;
  const ext = mimeToExt(mediaType);
  return ext ? `${safe}${ext}` : safe;
}

function pushCandidate(out: MediaCandidate[], seen: Set<string>, ref: unknown, mediaType?: unknown, mediaFilename?: unknown) {
  if (typeof ref !== "string") return;
  const value = ref.trim();
  if (!value || seen.has(value)) return;
  seen.add(value);
  out.push({
    ref: value,
    mediaType: normalizeMediaType(mediaType) || guessMediaType(value),
    mediaFilename: typeof mediaFilename === "string" && mediaFilename.trim() ? mediaFilename.trim() : guessFilename(value),
  });
}

function collectMediaCandidates(payload: unknown): MediaCandidate[] {
  const textCandidates = extractMediaRefsFromText(extractText(payload));
  if (!payload || typeof payload !== "object") return textCandidates;
  const p = payload as Record<string, unknown>;
  const out: MediaCandidate[] = [...textCandidates];
  const seen = new Set<string>(textCandidates.map((item) => item.ref));

  pushCandidate(out, seen, p.mediaUrl, p.mediaType, p.mediaFilename ?? p.filename ?? p.name);
  pushCandidate(out, seen, p.mediaPath, p.mediaType, p.mediaFilename ?? p.filename ?? p.name);
  pushCandidate(out, seen, p.path, p.mediaType, p.mediaFilename ?? p.filename ?? p.name);
  pushCandidate(out, seen, p.filePath, p.mediaType, p.mediaFilename ?? p.filename ?? p.name);
  pushCandidate(out, seen, p.imageUrl, p.mediaType || "image/*", p.mediaFilename ?? p.filename ?? p.name);
  pushCandidate(out, seen, p.imagePath, p.mediaType || "image/*", p.mediaFilename ?? p.filename ?? p.name);

  if (Array.isArray(p.mediaUrls)) {
    for (const ref of p.mediaUrls) pushCandidate(out, seen, ref, p.mediaType, p.mediaFilename ?? p.filename ?? p.name);
  }
  if (Array.isArray(p.mediaPaths)) {
    for (const ref of p.mediaPaths) pushCandidate(out, seen, ref, p.mediaType, p.mediaFilename ?? p.filename ?? p.name);
  }
  if (Array.isArray(p.images)) {
    for (const item of p.images) {
      if (typeof item === "string") {
        pushCandidate(out, seen, item, "image/*");
      } else if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        pushCandidate(out, seen, rec.url ?? rec.mediaUrl ?? rec.path ?? rec.mediaPath, rec.mediaType ?? rec.type, rec.mediaFilename ?? rec.filename ?? rec.name);
      }
    }
  }

  const blocks = Array.isArray(p.blocks) ? p.blocks : [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const rec = block as Record<string, unknown>;
    pushCandidate(out, seen, rec.mediaUrl ?? rec.url ?? rec.imageUrl, rec.mediaType ?? rec.type, rec.mediaFilename ?? rec.filename ?? rec.name);
    pushCandidate(out, seen, rec.mediaPath ?? rec.path ?? rec.imagePath ?? rec.filePath, rec.mediaType ?? rec.type, rec.mediaFilename ?? rec.filename ?? rec.name);
    if (Array.isArray(rec.mediaUrls)) {
      for (const ref of rec.mediaUrls) pushCandidate(out, seen, ref, rec.mediaType ?? rec.type, rec.mediaFilename ?? rec.filename ?? rec.name);
    }
    if (Array.isArray(rec.mediaPaths)) {
      for (const ref of rec.mediaPaths) pushCandidate(out, seen, ref, rec.mediaType ?? rec.type, rec.mediaFilename ?? rec.filename ?? rec.name);
    }
  }

  return out;
}

async function filePathToDataUrl(filePath: string, mediaType: string): Promise<string> {
  const buf = await readFile(filePath);
  return `data:${mediaType};base64,${buf.toString("base64")}`;
}

async function probeRemoteMediaType(ref: string): Promise<string | undefined> {
  const tryFetch = async (method: "HEAD" | "GET") => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(ref, {
        method,
        redirect: "follow",
        signal: controller.signal,
        headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
      });
      const mediaType = normalizeMediaType(response.headers.get("content-type"));
      return mediaType || undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  };

  return (await tryFetch("HEAD")) || (await tryFetch("GET"));
}

async function copyLocalFileToServedUrl(filePath: string, filename: string): Promise<string | undefined> {
  if (!LOCAL_MEDIA_BASE_URL) return undefined;
  const source = path.resolve(filePath);
  const fileStat = await stat(source);
  if (!fileStat.isFile()) return undefined;
  const safeName = `${Date.now()}-${randomUUID().slice(0, 8)}-${sanitizeFilename(filename, "attachment")}`;
  const target = path.join(LOCAL_MEDIA_DIR, safeName);
  await copyFile(source, target);
  return `${LOCAL_MEDIA_BASE_URL}/media/${encodeURIComponent(safeName)}`;
}

async function resolveMedia(payload: unknown): Promise<{
  mediaUrl?: string;
  mediaType?: string;
  mediaDataUrl?: string;
  mediaFilename?: string;
}> {
  const candidate = collectMediaCandidates(payload)[0];
  if (!candidate) return {};

  const mediaType = candidate.mediaType
    || guessMediaType(candidate.ref)
    || (/^https?:\/\//i.test(candidate.ref) ? await probeRemoteMediaType(candidate.ref) : undefined)
    || "application/octet-stream";
  const mediaFilename = ensureFilename(candidate.mediaFilename || guessFilename(candidate.ref), mediaType);

  if (/^data:/i.test(candidate.ref)) {
    return { mediaDataUrl: candidate.ref, mediaType, mediaFilename };
  }

  if (/^https?:\/\//i.test(candidate.ref)) {
    return { mediaUrl: candidate.ref, mediaType, mediaFilename };
  }

  const filePath = candidate.ref.startsWith("file://")
    ? new URL(candidate.ref).pathname
    : path.resolve(candidate.ref);

  if (!isRenderableMediaType(mediaType)) {
    const servedUrl = await copyLocalFileToServedUrl(filePath, mediaFilename || path.basename(filePath));
    if (servedUrl) {
      return { mediaUrl: servedUrl, mediaType, mediaFilename };
    }
  }

  const mediaDataUrl = await filePathToDataUrl(filePath, mediaType);
  return { mediaDataUrl, mediaType, mediaFilename };
}

export function createWsDeliver(ws: WebSocket, messageId: string) {
  return async (payload: unknown, info?: DeliverInfo) => {
    const text = extractText(payload);
    const candidates = collectMediaCandidates(payload);
    const media = await resolveMedia(payload);
    try {
      const payloadKeys = payload && typeof payload === "object" ? Object.keys(payload as Record<string, unknown>).slice(0, 24) : [];
      const payloadObj = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
      const rawMediaUrl = payloadObj ? String(payloadObj.mediaUrl || payloadObj.path || payloadObj.filePath || "").trim() : "";
      const rawMediaUrls = payloadObj && Array.isArray(payloadObj.mediaUrls)
        ? payloadObj.mediaUrls.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const rawMediaDataUrl = payloadObj ? String(payloadObj.mediaDataUrl || "").trim() : "";
      const textPreview = text ? text.slice(0, 240).replace(/\s+/g, " ") : "";
      console.log(
        `[claweb][deliver] messageId=${messageId} kind=${info?.kind || "unknown"} text=${text ? "yes" : "no"} textPreview=${JSON.stringify(textPreview)} candidates=${candidates.length} rawMediaUrl=${rawMediaUrl ? "yes" : "no"} rawMediaUrls=${rawMediaUrls.length} rawMediaDataUrl=${rawMediaDataUrl ? "yes" : "no"} mediaUrl=${media.mediaUrl ? "yes" : "no"} mediaDataUrl=${media.mediaDataUrl ? "yes" : "no"} mediaType=${media.mediaType || "none"} mediaFilename=${media.mediaFilename || "none"} keys=${payloadKeys.join(",")}`,
      );
    } catch {
      // ignore logging failure
    }
    if (!text && !media.mediaUrl && !media.mediaDataUrl) {
      return;
    }

    const state = aggregateByMessageId.get(messageId) ?? { text: "" };
    if (text) {
      state.text = state.text ? `${state.text}\n${text}`.trim() : text;
    }
    if (!state.mediaDataUrl && media.mediaDataUrl) {
      state.mediaDataUrl = media.mediaDataUrl;
      state.mediaType = media.mediaType;
      state.mediaFilename = media.mediaFilename;
      state.mediaUrl = undefined;
    } else if (!state.mediaDataUrl && !state.mediaUrl && media.mediaUrl) {
      state.mediaUrl = media.mediaUrl;
      state.mediaType = media.mediaType;
      state.mediaFilename = media.mediaFilename;
    } else {
      if (!state.mediaType && media.mediaType) state.mediaType = media.mediaType;
      if (!state.mediaFilename && media.mediaFilename) state.mediaFilename = media.mediaFilename;
    }
    aggregateByMessageId.set(messageId, state);

    if (info?.kind !== "final" || state.sent) {
      return;
    }

    state.sent = true;
    const envelope: WsEnvelope = {
      type: "message",
      id: messageId,
      role: "assistant",
      text: state.text,
      mediaUrl: state.mediaUrl,
      mediaType: state.mediaType,
      mediaDataUrl: state.mediaDataUrl,
      mediaFilename: state.mediaFilename,
    };
    try {
      ws.send(JSON.stringify(envelope));
    } finally {
      aggregateByMessageId.delete(messageId);
    }
  };
}
