import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";

type ClawebHelloFrame = {
  type: "hello";
  token: string;
  clientId?: string;
  userId?: string;
  roomId?: string;
};

type ClawebMessageFrame = {
  type: "message";
  id?: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: string;
  timestamp?: number;
};

type ReadyFrame = {
  type: "ready";
  serverVersion: string;
};

type ErrorFrame = {
  type: "error";
  id?: string;
  message: string;
};

type SessionState = {
  authed: boolean;
  clientId: string;
  userId: string;
  roomId?: string;
};

type StartWsServerInput = {
  host: string;
  port: number;
  authToken: string;
  serverVersion: string;
  onMessage: (params: {
    ws: WebSocket;
    clientId: string;
    userId: string;
    roomId?: string;
    messageId: string;
    text: string;
    mediaUrl?: string;
    mediaType?: string;
    timestamp: number;
  }) => Promise<void>;
};

type WsServerHandle = {
  close: () => Promise<void>;
};

function send(ws: WebSocket, frame: ReadyFrame | ErrorFrame): void {
  ws.send(JSON.stringify(frame));
}

function parseFrame(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isHelloFrame(frame: unknown): frame is ClawebHelloFrame {
  if (!frame || typeof frame !== "object") {
    return false;
  }
  const record = frame as Record<string, unknown>;
  return record.type === "hello" && typeof record.token === "string";
}

function isMessageFrame(frame: unknown): frame is ClawebMessageFrame {
  if (!frame || typeof frame !== "object") {
    return false;
  }
  const record = frame as Record<string, unknown>;
  if (record.type !== "message") return false;
  const hasText = typeof record.text === "string";
  const hasMedia = typeof record.mediaUrl === "string";
  return hasText || hasMedia;
}

export async function startWsServer(input: StartWsServerInput): Promise<WsServerHandle> {
  const httpServer: Server = createServer();
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    const state: SessionState = {
      authed: false,
      clientId: randomUUID(),
      userId: "anonymous",
      roomId: undefined,
    };

    ws.on("message", async (chunk) => {
      const parsed = parseFrame(chunk.toString());

      if (!state.authed) {
        if (!isHelloFrame(parsed)) {
          send(ws, { type: "error", message: "first frame must be hello" });
          ws.close(1008, "hello required");
          return;
        }

        if (parsed.token.trim() !== input.authToken.trim()) {
          send(ws, { type: "error", message: "auth failed" });
          ws.close(1008, "unauthorized");
          return;
        }

        state.authed = true;
        state.clientId = parsed.clientId?.trim() || randomUUID();
        state.userId = parsed.userId?.trim() || "web-user";
        state.roomId = parsed.roomId?.trim() || undefined;

        send(ws, { type: "ready", serverVersion: input.serverVersion });
        return;
      }

      if (!isMessageFrame(parsed)) {
        send(ws, { type: "error", message: "unsupported frame" });
        return;
      }

      const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
      const mediaUrl = typeof parsed.mediaUrl === "string" ? parsed.mediaUrl.trim() : "";
      const mediaType = typeof parsed.mediaType === "string" ? parsed.mediaType.trim() : "";

      if (!text && !mediaUrl) {
        send(ws, { type: "error", id: parsed.id, message: "text is empty" });
        return;
      }

      const messageId = parsed.id?.trim() || randomUUID();
      const timestamp =
        typeof parsed.timestamp === "number" && Number.isFinite(parsed.timestamp)
          ? parsed.timestamp
          : Date.now();

      try {
        await input.onMessage({
          ws,
          clientId: state.clientId,
          userId: state.userId,
          roomId: state.roomId,
          messageId,
          text,
          mediaUrl: mediaUrl || undefined,
          mediaType: mediaType || undefined,
          timestamp,
        });
      } catch (error) {
        send(ws, {
          type: "error",
          id: messageId,
          message: `dispatch failed: ${String(error)}`,
        });
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(input.port, input.host, () => resolve());
  });

  return {
    close: async () => {
      for (const client of wss.clients) {
        try {
          client.close();
        } catch {
          // ignore
        }
      }
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    },
  };
}
