import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import type { PluginRuntime } from "openclaw/plugin-sdk";

type BuildInboundCtxInput = {
  runtime: PluginRuntime;
  channel: string;
  accountId: string;
  sessionKey: string;
  userId: string;
  roomId?: string;
  text: string;
  mediaUrl?: string;
  mediaType?: string;
  messageId: string;
  timestamp: number;
};

function guessExtFromMime(mime: string | undefined): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("png")) return ".png";
  if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
  if (m.includes("webp")) return ".webp";
  if (m.includes("gif")) return ".gif";
  return "";
}

async function tryDownloadMediaToFile(params: {
  url: string;
  mediaType?: string;
  maxBytes: number;
}): Promise<{ filePath: string; mediaType?: string } | null> {
  // Only download http(s) urls.
  if (!/^https?:\/\//i.test(params.url)) return null;

  const res = await fetch(params.url);
  if (!res.ok) return null;

  const contentType = res.headers.get("content-type")?.trim() || undefined;
  const ab = await res.arrayBuffer();
  if (ab.byteLength > params.maxBytes) return null;

  const inferredType = params.mediaType?.trim() || contentType;
  const ext = guessExtFromMime(inferredType) || extname(new URL(params.url).pathname) || "";

  const dir = join(tmpdir(), "openclaw-claweb-media");
  await mkdir(dir, { recursive: true });

  const filePath = join(dir, `${Date.now()}-${randomUUID()}${ext}`);
  await writeFile(filePath, new Uint8Array(ab));

  return { filePath, mediaType: inferredType };
}

export async function buildInboundCtx(input: BuildInboundCtxInput) {
  const chatType = input.roomId ? "group" : "direct";
  const peerLabel = input.roomId ? `room:${input.roomId}` : `user:${input.userId}`;

  const mediaUrl = input.mediaUrl?.trim() || undefined;
  const mediaType = input.mediaType?.trim() || undefined;

  // Many downstream components prefer file paths (MediaPath/MediaPaths) over URLs.
  // Best-effort: download mediaUrl to a temp file and attach it as MediaPath(s).
  let mediaPath: string | undefined;
  let mediaType2: string | undefined = mediaType;

  if (mediaUrl) {
    try {
      const downloaded = await tryDownloadMediaToFile({
        url: mediaUrl,
        mediaType,
        maxBytes: 40 * 1024 * 1024,
      });
      if (downloaded) {
        mediaPath = downloaded.filePath;
        mediaType2 = downloaded.mediaType;
      }
    } catch {
      // ignore download failures; keep URL-only attachment
    }
  }

  return input.runtime.channel.reply.finalizeInboundContext({
    Body: input.text,
    RawBody: input.text,
    CommandBody: input.text,

    MediaPath: mediaPath,
    MediaPaths: mediaPath ? [mediaPath] : undefined,

    MediaUrl: mediaUrl,
    MediaUrls: mediaUrl ? [mediaUrl] : undefined,

    MediaType: mediaType2,
    MediaTypes: mediaUrl ? [mediaType2 || "application/octet-stream"] : undefined,

    From: `claweb:${input.userId}`,
    To: input.roomId ? `claweb:room:${input.roomId}` : `claweb:${input.userId}`,
    SessionKey: input.sessionKey,
    AccountId: input.accountId,
    ChatType: chatType,
    ConversationLabel: peerLabel,
    SenderId: input.userId,
    SenderName: input.userId,
    Provider: input.channel,
    Surface: input.channel,
    MessageSid: input.messageId,
    Timestamp: input.timestamp,
    OriginatingChannel: input.channel,
    OriginatingTo: input.roomId ? `claweb:room:${input.roomId}` : `claweb:${input.userId}`,
  });
}
