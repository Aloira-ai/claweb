#!/usr/bin/env node
/**
 * CLAWeb frontdoor smoke test (HTTP)
 *
 * Checks:
 * - POST /login returns ok + token
 * - GET /history returns ok + sorted by (ts asc, _idx asc)
 *
 * Usage:
 *   node scripts/smoke-http.js \
 *     --base https://claweb.example.com \
 *     --passphrase demo-passphrase \
 *     --userId demo-user --roomId demo-room --clientId demo-client \
 *     --insecure
 */

import https from "node:https";

function parseArgs(argv) {
  const args = {
    base: "https://claweb.example.com",
    passphrase: "",
    userId: "",
    roomId: "",
    clientId: "",
    limit: 10,
    insecure: false,
    timeoutMs: 10_000,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") args.base = argv[++i] || args.base;
    else if (a === "--passphrase") args.passphrase = argv[++i] || "";
    else if (a === "--userId") args.userId = argv[++i] || "";
    else if (a === "--roomId") args.roomId = argv[++i] || "";
    else if (a === "--clientId") args.clientId = argv[++i] || "";
    else if (a === "--limit") args.limit = Number(argv[++i] || args.limit);
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

function isSorted(messages) {
  for (let i = 1; i < messages.length; i++) {
    const a = messages[i - 1];
    const b = messages[i];
    const ta = Number(a.ts || 0);
    const tb = Number(b.ts || 0);
    const ia = Number(a._idx || 0);
    const ib = Number(b._idx || 0);
    if (ta > tb) return false;
    if (ta === tb && ia > ib) return false;
  }
  return true;
}

async function main() {
  const args = parseArgs(process.argv);
  assert(args.passphrase, "missing --passphrase");
  assert(args.userId && args.roomId && args.clientId, "missing --userId/--roomId/--clientId");

  const base = args.base.replace(/\/$/, "");

  console.log("[smoke-http] base:", base);

  const loginUrl = `${base}/login`;
  const loginBody = JSON.stringify({ passphrase: args.passphrase });

  const login = await fetchJson(loginUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(loginBody)),
    },
    body: loginBody,
    insecure: args.insecure,
    timeoutMs: args.timeoutMs,
  });

  assert(login.status === 200, `login status != 200: ${login.status}`);
  assert(login.json && login.json.ok === true, `login ok != true: ${JSON.stringify(login.json).slice(0, 200)}`);
  const token = login.json?.session?.token;
  assert(typeof token === "string" && token.length > 5, "missing token in login response");

  console.log("[smoke-http] login ok; token prefix:", token.slice(0, 8) + "...");

  const historyUrl = `${base}/history?userId=${encodeURIComponent(args.userId)}&roomId=${encodeURIComponent(
    args.roomId,
  )}&clientId=${encodeURIComponent(args.clientId)}&limit=${encodeURIComponent(String(args.limit))}`;

  const history = await fetchJson(historyUrl, {
    method: "GET",
    headers: {
      "x-claweb-token": token,
    },
    insecure: args.insecure,
    timeoutMs: args.timeoutMs,
  });

  assert(history.status === 200, `history status != 200: ${history.status}`);
  assert(history.json && history.json.ok === true, `history ok != true: ${JSON.stringify(history.json).slice(0, 200)}`);
  const messages = Array.isArray(history.json.messages) ? history.json.messages : [];

  console.log(`[smoke-http] history ok; messages=${messages.length}`);

  if (messages.length > 1) {
    assert(isSorted(messages), "history not sorted by (ts asc, _idx asc)");
    console.log("[smoke-http] ordering ok (ts + _idx)");
  } else {
    console.log("[smoke-http] ordering check skipped (need >=2 messages)");
  }

  console.log("[smoke-http] PASS");
}

main().catch((err) => {
  console.error("[smoke-http] FAIL:", err?.stack || String(err));
  process.exit(1);
});
