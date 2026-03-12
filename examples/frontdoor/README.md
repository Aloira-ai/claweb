# CLAWeb Frontdoor (Example)

This is a **reference host** for the CLAWeb browser UI.

It provides:
- `GET /` static hosting of `public/claweb/*`
- `POST /login` (canonical)
- `GET /history` (canonical)
- `WS /ws` (canonical)

It also supports compatibility aliases:
- `/claweb/login`, `/claweb/history`, `/claweb/ws`

## Why this exists

The CLAWeb OpenClaw channel plugin only exposes the upstream WebSocket channel (typically `127.0.0.1:18999`).
A browser-facing deployment needs a small **frontdoor** to:
- serve static assets
- implement login + history
- proxy WS to the upstream OpenClaw channel
- persist raw history with a stable ordering tie-break (`_idx`)

## Config

### Required env

- `PORT` (default: `18081`)
- `BIND` (default: `127.0.0.1`)
- `CLAWEB_STATIC_ROOT` (default: `../../public/claweb`)
- `CLAWEB_LOGIN_CONFIG` (default: `./config/claweb-login.example.json`)
- `CLAWEB_HISTORY_DIR` (default: `./data/history`)

### Upstream (OpenClaw claweb channel)

- `CLAWEB_UPSTREAM_WS` (default: `ws://127.0.0.1:18999`)
- `CLAWEB_UPSTREAM_TOKEN` or `CLAWEB_UPSTREAM_TOKEN_FILE`

The upstream token is the `channels.claweb.authToken` configured in OpenClaw.

## Run

```bash
cd examples/frontdoor
npm i
node server.js
```

## Upgrade / Migration

### Legacy history filename migration

Older deployments may store history as per-identity files like:
- `demo-user-b.jsonl`
- `demo-passphrase.jsonl`

The current frontdoor expects history files keyed by:

- `{userId}__{roomId}__{clientId}.jsonl`

## History record shape (raw JSONL)

Each line is a minimal message record, typically:

- `role`: `user` | `assistant` | `system`
- `text`: string
- `ts`: number (ms since epoch)
- `messageId`: string (unique per message)
- `_idx`: number (stable per-file insert index)
- `replyTo`: string (optional; for assistant messages, points to the user turnId/messageId being answered)

If you switch implementations and history appears "missing", run:

```bash
node scripts/migrate-history.js --dir /var/lib/claweb-example/history
```

It will:
- create a full backup directory next to `--dir` (`<dir>.migrated.<timestamp>`)
- generate new keyed jsonl files
- NOT delete legacy files

Then open:
- `http://127.0.0.1:18081/`

## Notes

- This example is intentionally minimal and text-first.
- It is designed to follow `docs/state-model.md` (raw/recent/runtime).
