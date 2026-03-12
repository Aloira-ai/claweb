import { readFile } from "node:fs/promises";
import path from "node:path";
import type { WebSocket } from "ws";

type WsEnvelope = {
  type: "message";
  id: string;
  role: "assistant";
  text: string;
  mediaUrl?: string;
  mediaType?: string;
  mediaDataUrl?: string;
};

type MediaCandidate = {
  ref: string;
  mediaType?: string;
};

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

function guessMediaType(ref: string): string | undefined {
  const raw = String(ref || "").trim();
  if (!raw) return undefined;

  const dataMatch = raw.match(/^data:([^;,]+)[;,]/i);
  if (dataMatch?.[1]) return dataMatch[1].trim().toLowerCase();

  const cleaned = raw.replace(/[?#].*$/, "").toLowerCase();
  if (cleaned.endsWith(".png")) return "image/png";
  if (cleaned.endsWith(".jpg") || cleaned.endsWith(".jpeg")) return "image/jpeg";
  if (cleaned.endsWith(".webp")) return "image/webp";
  if (cleaned.endsWith(".gif")) return "image/gif";
  if (cleaned.endsWith(".svg")) return "image/svg+xml";
  return undefined;
}

function isImageMediaType(mediaType: string | undefined): boolean {
  return Boolean(mediaType && mediaType.startsWith("image/"));
}

function pushCandidate(out: MediaCandidate[], seen: Set<string>, ref: unknown, mediaType?: unknown) {
  if (typeof ref !== "string") return;
  const value = ref.trim();
  if (!value || seen.has(value)) return;
  const type = normalizeMediaType(mediaType) || guessMediaType(value);
  if (!isImageMediaType(type)) return;
  seen.add(value);
  out.push({ ref: value, mediaType: type });
}

function collectMediaCandidates(payload: unknown): MediaCandidate[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const out: MediaCandidate[] = [];
  const seen = new Set<string>();

  pushCandidate(out, seen, p.mediaUrl, p.mediaType);
  pushCandidate(out, seen, p.mediaPath, p.mediaType);
  pushCandidate(out, seen, p.imageUrl, p.mediaType || "image/*");
  pushCandidate(out, seen, p.imagePath, p.mediaType || "image/*");

  if (Array.isArray(p.mediaUrls)) {
    for (const ref of p.mediaUrls) pushCandidate(out, seen, ref, p.mediaType);
  }
  if (Array.isArray(p.mediaPaths)) {
    for (const ref of p.mediaPaths) pushCandidate(out, seen, ref, p.mediaType);
  }
  if (Array.isArray(p.images)) {
    for (const item of p.images) {
      if (typeof item === "string") {
        pushCandidate(out, seen, item, "image/*");
      } else if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        pushCandidate(out, seen, rec.url ?? rec.mediaUrl ?? rec.path ?? rec.mediaPath, rec.mediaType ?? rec.type);
      }
    }
  }

  const blocks = Array.isArray(p.blocks) ? p.blocks : [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const rec = block as Record<string, unknown>;
    pushCandidate(out, seen, rec.mediaUrl ?? rec.url ?? rec.imageUrl, rec.mediaType ?? rec.type);
    pushCandidate(out, seen, rec.mediaPath ?? rec.path ?? rec.imagePath, rec.mediaType ?? rec.type);
    if (Array.isArray(rec.mediaUrls)) {
      for (const ref of rec.mediaUrls) pushCandidate(out, seen, ref, rec.mediaType ?? rec.type);
    }
    if (Array.isArray(rec.mediaPaths)) {
      for (const ref of rec.mediaPaths) pushCandidate(out, seen, ref, rec.mediaType ?? rec.type);
    }
  }

  return out;
}

async function filePathToDataUrl(filePath: string, mediaType: string): Promise<string> {
  const buf = await readFile(filePath);
  return `data:${mediaType};base64,${buf.toString("base64")}`;
}

async function resolveMedia(payload: unknown): Promise<{
  mediaUrl?: string;
  mediaType?: string;
  mediaDataUrl?: string;
}> {
  const candidate = collectMediaCandidates(payload)[0];
  if (!candidate) return {};

  const mediaType = candidate.mediaType || guessMediaType(candidate.ref);
  if (!isImageMediaType(mediaType)) return {};

  if (/^data:image\//i.test(candidate.ref)) {
    return { mediaDataUrl: candidate.ref, mediaType };
  }

  if (/^https?:\/\//i.test(candidate.ref)) {
    return { mediaUrl: candidate.ref, mediaType };
  }

  const filePath = candidate.ref.startsWith("file://")
    ? new URL(candidate.ref).pathname
    : path.resolve(candidate.ref);
  const mediaDataUrl = await filePathToDataUrl(filePath, mediaType || "image/png");
  return { mediaDataUrl, mediaType: mediaType || "image/png" };
}

export function createWsDeliver(ws: WebSocket, messageId: string) {
  return async (payload: unknown) => {
    const text = extractText(payload);
    const media = await resolveMedia(payload);
    if (!text && !media.mediaUrl && !media.mediaDataUrl) {
      return;
    }

    const envelope: WsEnvelope = {
      type: "message",
      id: messageId,
      role: "assistant",
      text,
      mediaUrl: media.mediaUrl,
      mediaType: media.mediaType,
      mediaDataUrl: media.mediaDataUrl,
    };
    ws.send(JSON.stringify(envelope));
  };
}
