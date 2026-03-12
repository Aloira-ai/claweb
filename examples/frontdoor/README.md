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

Then open:
- `http://127.0.0.1:18081/`

## Notes

- This example is intentionally minimal and text-first.
- It is designed to follow `docs/state-model.md` (raw/recent/runtime).
