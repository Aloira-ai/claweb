# CLAWeb Regression Checklist (claweb.example.com)

This checklist is intended to be run on the public, browser-facing test site before/after any change to:
- `clients/browser/*` frontend code
- `/claweb/login`, `/claweb/history`, `/claweb/ws` compatibility layer (proxy/frontdoor)
- nginx/Cloudflare routing that affects CLAWeb

## P0 (Must Pass)

### 0) Basic availability
- [ ] Open `https://claweb.example.com/` → page loads (no extra path needed)
- [ ] Confirm unrelated sites/apps are not affected (optional)

### 1) Login flow
- [ ] Enter passphrase, login succeeds
- [ ] No 401/429/500 in browser console

### 2) Send + receive
- [ ] Send `ping` (or any short message)
- [ ] Assistant reply arrives
- [ ] User/assistant roles are not swapped

### 3) Protocol linking (turnId / messageId / replyTo)
- [ ] After sending a message, verify the assistant message is **linked** to the user turn:
  - Open DevTools → Console
  - Confirm incoming assistant frames include `replyTo` (or `parentId`) pointing to the user turn id
  - Confirm assistant `id/messageId` is **not equal** to the user turn id (no id collision)

### 4) Dedupe / echo correctness
- [ ] A user message is rendered exactly once (no duplicate user-echo)
- [ ] Assistant message is rendered exactly once (no duplicate replay)

### 5) History replay ordering (ts + _idx)
- [ ] Send 3 quick messages: `1`, `2`, `3`
- [ ] Refresh the page
- [ ] History order remains `1 → 2 → 3` (stable ordering by `ts` + `_idx` tie-break)

### 6) Recent snapshot behavior (cache, must not break correctness)
- [ ] Send one message, then refresh
- [ ] History loads quickly and still shows correct order/dedupe
- [ ] If snapshot is missing/corrupt: system should fall back to raw history (no "empty history" surprise)

### 7) WebSocket stability
- [ ] Refresh while connected → reconnects cleanly
- [ ] Switch the tab/app to background for a while, then return → session restores without re-login
- [ ] No stuck “connecting…” state

### 8) Rich text / reply preview
- [ ] Send a message containing bold / italic / inline code / fenced code / list / quote → renders correctly
- [ ] Send a reply to an earlier message → reply preview stays compact
- [ ] Refresh the page → reply preview remains available in history

### 9) Image upload quality
- [ ] Upload a normal image (< 4MB) → browser keeps original instead of visibly aggressive compression
- [ ] Upload an oversized image → system still falls back gracefully instead of failing the send

### 10) Media handoff compatibility
- [ ] If assistant returns OpenClaw-standard media (`MEDIA:` or structured `mediaUrl`) → frontend renders image/video instead of raw duplicated text

## P1 (Strongly Recommended)

### 11) Detached reply persistence
- [ ] Send a message that takes time
- [ ] Immediately refresh/close the tab
- [ ] Reopen after 10–30s
- [ ] Assistant reply is persisted and appears in history

### 12) Error surface (auth & upstream)
- [ ] (Optional) Temporarily break auth (wrong passphrase) → UI shows auth error, does not hang
- [ ] (Optional) If upstream WS is down → UI shows a clear error, pending is marked failed

## Notes
- If any P0 item fails: stop feature work, fix regression first.
- Keep changes scoped inside this repo (`claweb`). Do not “fix” issues by modifying unrelated private systems.
