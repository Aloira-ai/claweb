# CLAWeb Regression Checklist (claweb.example.com)

This checklist is intended to be run on the public, browser-facing test site before/after any change to:
- `public/claweb/*` frontend code
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

### 3) Dedupe / echo correctness
- [ ] A user message is rendered exactly once (no duplicate user-echo)
- [ ] Assistant message is rendered exactly once (no duplicate replay)

### 4) History replay ordering
- [ ] Send 3 quick messages: `1`, `2`, `3`
- [ ] Refresh the page
- [ ] History order remains `1 → 2 → 3` (stable ordering by `ts` + tie-break)

### 5) WebSocket stability
- [ ] Refresh while connected → reconnects cleanly
- [ ] No stuck “connecting…” state

## P1 (Strongly Recommended)

### 6) Detached reply persistence
- [ ] Send a message that takes time
- [ ] Immediately refresh/close the tab
- [ ] Reopen after 10–30s
- [ ] Assistant reply is persisted and appears in history

## Notes
- If any P0 item fails: stop feature work, fix regression first.
- Keep changes scoped inside this repo (`claweb`). Do not “fix” issues by modifying unrelated private systems.
