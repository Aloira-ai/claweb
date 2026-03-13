# CLAWeb Channel Contract

This document describes the **client-facing contract** for the CLAWeb channel.

It is intentionally broader than the browser reference client.
Future browser / app / desktop clients should reuse these semantics instead of redefining them per client.

## 1) Core Principle

CLAWeb is a client-facing OpenClaw channel.

That means clients should be able to rely on a stable contract for:
- session bootstrap
- realtime frames
- reply linkage
- history replay
- media handoff
- reconnect / refresh recovery expectations

## 2) Access Surface

The current reference access layer exposes:

- `POST /login`
- `GET /history`
- `WS /ws`

Compatibility aliases may also exist:
- `POST /claweb/login`
- `GET /claweb/history`
- `WS /claweb/ws`

These routes are part of the **reference access contract**, not proof that CLAWeb is browser-only.

## 3) Realtime Frame Flow

Recommended frame lifecycle:

1. client connects WebSocket
2. client sends `hello`
3. server replies `ready`
4. client/server exchange `message` frames
5. server may emit `error` frames when a turn or session fails

### Canonical frame types

- `hello`
- `ready`
- `message`
- `error`

## 4) Message Semantics

A `message` frame should represent a renderable chat message or message-part event that can be normalized into one.

Recommended fields:
- `type`
- `id`
- `messageId`
- `role`
- `text`
- `ts`
- `replyTo`
- `parentId`
- `mediaUrl`
- `mediaUrls`
- `mediaType`

### Role rule

Preferred explicit values:
- `user`
- `assistant`
- `system`

Clients should not rely on hidden persona assumptions to infer role.

## 5) Id Semantics

To avoid collisions, treat **turn ids** and **assistant message ids** as different concepts.

### Recommended model

Client → Server:
- `frame.id` = client turn id

Server → Client (assistant reply):
- `frame.id` / `frame.messageId` = assistant message id
- `frame.replyTo` = user turn id being answered

### Why this matters

This enables:
- dedupe correctness
- detached reply recovery
- future multi-part assistant replies
- cleaner cross-client rendering

## 6) Reply Semantics

Assistant replies should point back to the triggering user turn via:
- `replyTo` (preferred)
- or `parentId` when required by upstream compatibility

If quote preview UX is desired, hosts should preserve a compact `replyPreview` summary during persistence / replay.

## 7) History Semantics

History responses should be replay-safe.

### Ordering rule

Sort by:
1. `ts` ascending
2. stable tie-breaker such as `_idx` ascending

### Dedupe rule

Clients should dedupe primarily by:
- `messageId`

Fallback only when needed:
- `(role, ts, text)`

## 8) Media Handoff Semantics

CLAWeb should reuse OpenClaw-standard media outputs.

Supported handoff styles:
- inline `MEDIA:<path-or-url>`
- structured `mediaUrl`
- structured `mediaUrls`

Preferred renderable types:
- `image/*`
- `video/*`

CLAWeb should **not** introduce client-specific media prefixes such as:
- `IMAGE:`
- `VIDEO:`
- `ASSET:`

## 9) Session / Reconnect Expectations

Clients may disconnect, refresh, background, or reconnect.
The contract should support these expectations:

- refresh should not corrupt history order
- reconnect should not create duplicate user/assistant messages
- detached assistant replies should still land in persisted history
- clients may restore recent UI state from history or snapshot cache

The browser reference client currently validates these expectations, but they should remain channel-level semantics for future clients too.

## 10) Responsibility Split

### Channel / host side
Responsible for:
- identity/session bootstrap
- persistence
- history ordering
- upstream OpenClaw integration
- durable reply/media semantics

### Client side
Responsible for:
- rendering
- optimistic pending UI
- reconnect UX
- quote / reply UI
- media presentation

## 11) Non-goals

The CLAWeb channel contract does not define:
- persona or prompt content
- memory injection strategy
- private adapter behavior
- business-specific generation workflows
- one-client-only UX assumptions as protocol rules

## 12) Design Test

A good design question for future changes:

> Would this still make sense if the next CLAWeb client were a mobile app or a desktop client instead of the browser reference client?

If not, the change is probably too client-specific to belong in the channel contract.
