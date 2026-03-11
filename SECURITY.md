# Security (claweb)

claweb is a **messaging channel plugin** that bridges a browser client to OpenClaw.

This document states the minimum security posture for an open-source release.

## Threat model

- Untrusted browser clients connecting to the WS endpoint.
- Credential leakage (OpenClaw gateway token, bot tokens).
- SSRF / internal network access if URL-based media downloads are supported.
- Path traversal / arbitrary file read if the client can reference local paths.
- Message replay / duplication.

## Non-negotiable rules

1) **Never expose OpenClaw gateway tokens to the browser.**
   - Browser authenticates to claweb using a separate token.

2) **Authenticate every WS connection.**
   - Require a token in `hello` or `Authorization` header.
   - Prefer `authTokenFile` (not hard-coded tokens in repo).

3) **Origin checks (recommended).**
   - Allowlist expected origins/domains.

4) **Rate limits (recommended).**
   - Per connection + per `userId`.

5) **No local-path media.**
   - The client must NOT be allowed to ask the server to read any local absolute path (for example `/etc/...`) or `file://...`.
   - If media is supported, accept either:
     - direct upload (multipart/binary) and store via `rt.channel.media.saveMediaBuffer`, or
     - http(s) URL downloads with strict SSRF protection.

6) **SSRF protection (if URL fetch is supported).**
   - Deny RFC1918/private ranges, localhost, link-local.
   - Allowlist hostnames/domains if possible.
   - Enforce max size + timeouts.

7) **Session-key isolation.**
   - Stable `sessionKey` per `userId`/`roomId` (no collisions across users).

## Safe defaults

- Listen on `127.0.0.1` by default.
- Require explicit config to bind to `0.0.0.0`.

## Logging

- Never log auth tokens.
- Mask sensitive fields in payload logs.

## Responsible disclosure

If you publish this repo, add a SECURITY contact policy (email/issue template) and a CVE/patch flow if needed.
