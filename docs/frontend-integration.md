# Frontend Integration Contract

`public/claweb/` is a browser example UI. It requires a host service that exposes three routes.

## Required Routes

1. `POST /claweb/login`
2. `GET /claweb/history`
3. `WS /claweb/ws`

## `POST /claweb/login`

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
    "wsUrl": "/claweb/ws",
    "token": "...",
    "userId": "user-guest-a",
    "roomId": "room-main",
    "clientId": "guest-a-fixed"
  }
}
```

Error response:

```json
{ "ok": false, "error": "invalid_credentials" }
```

Recommended error codes: `missing_passphrase`, `invalid_credentials`, `ambiguous_passphrase`, `too_many_attempts`, `login_not_configured`.

## `GET /claweb/history`

Query params:

- `userId`
- `roomId`
- `clientId`
- `limit` (optional, frontend default is `60`)

Headers:

- `x-claweb-token: <token>`

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

## Message Consistency Rule

When pushing `frame.type = "message"`:

- Prefer explicit `role` (`user` / `assistant` / `system`).
- If role is omitted, frontend uses a safe fallback and pending-link heuristic.
- Frontend dedupes by `messageId` first, then by `(role, ts, text)` fallback.

This captures the validated Phase 1 behavior:

- normalize incoming messages,
- avoid duplicate rendering,
- avoid user-echo role confusion across realtime/history recovery.
