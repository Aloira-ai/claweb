# Frontend Integration Contract

`public/claweb/` is a browser example UI. It requires a host service that exposes three routes.

This project prefers **root-path hosting** (open `/` to get the UI) with **short-path endpoints** (`/login`, `/history`, `/ws`).

## Required Routes

### Canonical (recommended)

These are the preferred, short-path endpoints. They work well when you serve the CLAWeb UI at the site root (`/`).

1. `POST /login`
2. `GET /history`
3. `WS /ws`

### Compatibility (optional)

For hosts that prefer a path prefix (or for migration), you may expose the legacy-prefixed endpoints as aliases:

1. `POST /claweb/login`
2. `GET /claweb/history`
3. `WS /claweb/ws`

## `POST /login` (canonical)

This section describes the canonical `/login` route. If you expose `/claweb/login` as a compatibility alias, it should behave identically.

## `POST /claweb/login` (compat)

Request:

```json
{ "passphrase": "..." }
```

Success response:

```json
{
  "ok": true,
  "session": {
    "identity": "guest-a",
    "displayName": "Guest A",
    "wsUrl": "/ws",
    "token": "...",
    "userId": "user-guest-a",
    "roomId": "room-main",
    "clientId": "guest-a-fixed"
  }
}
```

If you expose the compat route set, `wsUrl` MAY also be returned as `"/claweb/ws"`.

Error response:

```json
{ "ok": false, "error": "invalid_credentials" }
```

Recommended error codes: `missing_passphrase`, `invalid_credentials`, `ambiguous_passphrase`, `too_many_attempts`, `login_not_configured`.

## `GET /history` (canonical)

This section describes the canonical `/history` route. If you expose `/claweb/history` as a compatibility alias, it should behave identically.

## `GET /claweb/history` (compat)

Query params:

- `userId`
- `roomId`
- `clientId`
- `limit` (optional, frontend default is `60`)

Headers:

- `x-claweb-token: <token>` (same header for both canonical + compat routes)

Response:

```json
{
  "ok": true,
  "messages": [
    { "role": "user", "text": "hello", "messageId": "msg-1", "ts": 1710000000000 }
  ]
}
```

## History Ordering Rule

To match the frontend dedupe behavior, sort server history before returning:

1. Primary key: `ts` ascending.
2. Secondary key: `_idx` ascending (or any stable insert index).

This keeps replay deterministic and avoids visible reordering after refresh.

## Responsibility Split (client vs host)

CLAWeb UI is a **native chat entry client**. It should not own memory strategy.

- Client (CLAWeb UI): rendering, optimistic UI, connection/reconnect, message ids, quoting.
- Host/OpenClaw: session identity, context assembly, memory strategy, persistence, history ordering.

## Message Consistency Rule

When pushing `frame.type = "message"`:

- Prefer explicit `role` (`user` / `assistant` / `system`).
- If role is omitted, frontend uses a safe fallback and pending-link heuristic.
- Frontend dedupes by `messageId` first, then by `(role, ts, text)` fallback.

### Id semantics: turnId vs messageId (recommended)

To avoid id collisions (and to support future multi-part replies), treat ids as:

- Client → Server: `frame.id` = **turnId** (client-generated, stable for dedupe)
- Server → Client (assistant message):
  - `frame.id` / `frame.messageId` = **assistant messageId** (server-generated, unique per assistant message)
  - `frame.replyTo` = **turnId** of the user message being answered

Note: Some upstream implementations may still reuse `turnId` as `frame.id`. The recommended frontdoor implementation normalizes this by minting a new assistant message id and attaching `replyTo`.

This captures the validated Phase 1 behavior:

- normalize incoming messages,
- avoid duplicate rendering,
- avoid user-echo role confusion across realtime/history recovery.
