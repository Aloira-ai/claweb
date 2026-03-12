# CLAWeb State Model (raw / recent / runtime)

This document defines the minimal state layers required to make the CLAWeb UX stable across:
- refresh
- reconnect
- process restart
- detached replies (client disconnects while the assistant turn is still running)

The model is **frontend-experience first**: we specify what the UI must be able to do, then derive backend constraints.

## Goals (P0)

- Deterministic history replay after refresh (no visible reordering).
- No duplicate rendering across realtime + replay (dedupe correctness).
- Correct roles (`user` vs `assistant`) without user-echo confusion.
- Reasonable performance for the common case.

## Layers

### 1) Raw History (append-only, source of truth)

**Purpose:** durable audit log and recovery baseline.

- Storage: JSONL (one message/frame per line) or an equivalent append-only log.
- Mutability: append-only (no in-place edits).
- Minimum fields per message:
  - `ts` (number, ms since epoch)
  - `_idx` (number, stable tie-break insert index; monotonic per file)
  - `role` (`"user" | "assistant" | "system"`)
  - `text` (string)
  - `messageId` (string; should be globally unique at least within `{userId, roomId, clientId}`)
- `replyTo` (string, optional; for assistant messages, points to the user turnId/messageId being answered)

**Ordering rule (must):**
- Sort ascending by `ts`, then ascending by `_idx`.

**Dedupe rule (must):**
- Primary key: `messageId`.
- Fallback (only if messageId missing): `(role, ts, text)`.

### 2) Recent Snapshot (overwriteable cache)

**Purpose:** fast UI restore without re-scanning large raw logs.

- Storage: single JSON file (or KV) per `{userId, roomId, clientId}`.
- Mutability: overwriteable (last-write-wins).
- Retention: **keep latest snapshot indefinitely**, but treat it as optional cache.
  - Optional safety TTL: if snapshot is older than 7 days, ignore and rebuild from raw.

**Recommended content:**
- `updatedAt` (ts)
- `cursor`:
  - `lastTs`
  - `lastIdx`
  - `lastMessageId`
- `recentMessages`: last N normalized messages (recommend N=60)
- `sessionHint` (optional): identity/displayName for UI convenience

**Fallback rule (must):**
- If snapshot missing/corrupt/stale → read from raw history.

### 3) Session Runtime (in-memory)

**Purpose:** correctness for realtime turns.

- Storage: in-memory per active WS connection/session.
- Mutability: ephemeral.

**Must track:**
- `dedupeSet` for recently seen `messageId` (bounded size, e.g. 500)
- `inFlightTurns` mapping (client message → assistant response stream)
- `pendingUserMessages` (optimistic UI) keyed by `messageId`

**Detached reply rule (must):**
- If client disconnects, the server continues the in-flight turn.
- When the assistant reply completes, it MUST still be appended to raw history.
- On next login/refresh, the reply must appear via snapshot or raw replay.

## Defaults (recommended)

- History fetch default limit: **60** (frontend default; allow `?limit=` override).
- Recent snapshot: **latest snapshot kept indefinitely** (cache), optional ignore-if-older-than 7d.
- `messageId` source: **frontend-generated**.

### Frontend `messageId` format (recommendation)

Use something stable and monotonic per client:

- `messageId = ${clientId}:${counter}:${ts}`

Where `counter` is stored in memory and (optionally) persisted in localStorage.

## API expectations

This model applies equally to canonical routes:
- `POST /login`
- `GET /history`
- `WS /ws`

and compat aliases:
- `POST /claweb/login`
- `GET /claweb/history`
- `WS /claweb/ws`

## Non-goals

- A full auth/security scheme (beyond fixed mapping + token header).
- Media or file uploads.
- Multi-device strong consistency (this model is "good enough" for a single clientId).
