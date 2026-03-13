#!/usr/bin/env node
/**
 * CLAWeb frontdoor smoke test (WebSocket)
 *
 * Checks:
 * - WS hello -> ready
 * - send one user turnId, receive assistant message:
 *   - assistant id/messageId != turnId
 *   - assistant replyTo == turnId
 *
 * Usage:
 *   node scripts/smoke-ws.js \
 *     --base https://claweb.example.com \
 *     --passphrase demo-passphrase \
 *     --clientId demo-client \
 *     --message "ping" \
 *     --insecure
 */

import https from "node:https";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";

function parseArgs(argv) {
  const args = {
    base: "https://claweb.example.com",
    passphrase: "",
    clientId: "",
    userId: "",
    roomId: "",
    message: "ping",
    insecure: false,
    timeoutMs: 60_000,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") args.base = argv[++i] || args.base;
    else if (a === "--passphrase") args.passphrase = argv[++i] || "";
    else if (a === "--clientId") args.clientId = argv[++i] || "";
    else if (a === "--userId") args.userId = argv[++i] || "";
    else if (a === "--roomId") args.roomId = argv[++i] || "";
    else if (a === "--message") args.message = argv[++i] || args.message;
    else if (a === "--timeoutMs") args.timeoutMs = Number(argv[++i] || args.timeoutMs);
    else if (a === "--insecure") args.insecure = true;
  }
  return args;
}

function fetchJson(url, { method = "GET", headers = {}, body, insecure = false, timeoutMs = 10_000 } = {}) {
  const agent = new https.Agent({ rejectUnauthorized: !insecure });

  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers,
        agent,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            return reject(new Error(`non-json response: status=${res.statusCode} body=${text.slice(0, 200)}`));
          }
          resolve({ status: res.statusCode || 0, json });
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));

    if (body) req.write(body);
    req.end();
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function login(base, passphrase, { insecure, timeoutMs }) {
  const loginUrl = `${base}/login`;
  const body = JSON.stringify({ passphrase });
  const res = await fetchJson(loginUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    },
    body,
    insecure,
    timeoutMs,
  });

  assert(res.status === 200, `login status != 200: ${res.status}`);
  assert(res.json?.ok === true, `login ok != true: ${JSON.stringify(res.json).slice(0, 200)}`);
  const token = res.json?.session?.token;
  const wsUrl = res.json?.session?.wsUrl;
  assert(typeof token === "string" && token.length > 5, "missing token");
  assert(typeof wsUrl === "string" && wsUrl.startsWith("/"), "missing wsUrl");
  return { token, wsUrl };
}

function toWsUrl(base, wsPath) {
  const u = new URL(base);
  const proto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${u.host}${wsPath}`;
}

async function main() {
  const args = parseArgs(process.argv);
  assert(args.passphrase, "missing --passphrase");
  assert(args.clientId, "missing --clientId");

  const base = args.base.replace(/\/$/, "");
  console.log("[smoke-ws] base:", base);

  const { token, wsUrl } = await login(base, args.passphrase, {
    insecure: args.insecure,
    timeoutMs: args.timeoutMs,
  });

  const fullWsUrl = toWsUrl(base, wsUrl);
  console.log("[smoke-ws] ws:", fullWsUrl);

  const turnId = `${args.clientId}:${Date.now()}:${Math.floor(Math.random() * 1000)}`;

  const ws = new WebSocket(fullWsUrl, {
    rejectUnauthorized: !args.insecure,
  });

  const deadline = Date.now() + args.timeoutMs;

  const wait = () =>
    new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error("timeout"));
        }
      }, 250);
      resolve(timer);
    });

  let gotReady = false;
  let gotAssistant = false;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timeout")), args.timeoutMs);
    const readyTimeout = setTimeout(() => reject(new Error("timeout_waiting_ready")), Math.min(15_000, args.timeoutMs));

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "hello",
          token,
          clientId: args.clientId,
          userId: args.userId || undefined,
          roomId: args.roomId || undefined,
        }),
      );
    });

    ws.on("message", (buf) => {
      let frame;
      try {
        frame = JSON.parse(String(buf));
      } catch {
        return;
      }

      if (frame.type === "ready") {
        gotReady = true;
        clearTimeout(readyTimeout);
        ws.send(
          JSON.stringify({
            type: "message",
            id: turnId,
            text: args.message,
            timestamp: Date.now(),
          }),
        );
        return;
      }

      if (frame.type === "message") {
        // expect assistant reply
        const asstId = String(frame.id || frame.messageId || "").trim();
        const replyTo = String(frame.replyTo || frame.parentId || "").trim();

        assert(gotReady, "received message before ready");
        assert(asstId, "missing assistant id/messageId");
        assert(asstId !== turnId, `id collision: assistant id == turnId (${turnId})`);
        assert(replyTo === turnId, `replyTo mismatch: expected=${turnId} got=${replyTo || "<empty>"}`);

        gotAssistant = true;
        clearTimeout(timeout);
        clearTimeout(readyTimeout);
        try {
          ws.close();
        } catch {}
        resolve();
      }

      if (frame.type === "error") {
        clearTimeout(timeout);
        clearTimeout(readyTimeout);
        reject(new Error(`server error frame: ${JSON.stringify(frame)}`));
      }
    });

    ws.on("error", (e) => {
      clearTimeout(timeout);
      clearTimeout(readyTimeout);
      reject(e);
    });

    ws.on("close", () => {
      if (!gotAssistant) {
        clearTimeout(timeout);
        clearTimeout(readyTimeout);
        reject(new Error("ws closed before assistant reply"));
      }
    });
  });

  console.log("[smoke-ws] PASS");
}

main().catch((err) => {
  console.error("[smoke-ws] FAIL:", err?.stack || String(err));
  process.exit(1);
});
