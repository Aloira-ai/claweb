import type { WebSocket } from "ws";

type WsEnvelope = {
  type: "message";
  id: string;
  role: "assistant";
  text: string;
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

export function createWsDeliver(ws: WebSocket, messageId: string) {
  return async (payload: unknown) => {
    const text = extractText(payload);
    if (!text) {
      return;
    }

    const envelope: WsEnvelope = {
      type: "message",
      id: messageId,
      role: "assistant",
      text,
    };
    ws.send(JSON.stringify(envelope));
  };
}
