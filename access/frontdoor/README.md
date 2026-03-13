# CLAWeb Frontdoor (Reference Access Host)

This directory contains the **reference access host** for the CLAWeb channel.

It is not the channel runtime itself.
It is also not the only possible deployment shape.

## Role in the repository

CLAWeb is organized around three layers:

- **Channel runtime**: `src/`
- **Reference access layer**: `access/frontdoor/`
- **Reference clients**: `clients/browser/`

This directory is the current reference implementation of the **access layer**.

## What it provides

- `GET /` static hosting of `clients/browser/*`
- `POST /login` (canonical)
- `GET /history` (canonical)
- `WS /ws` (canonical)

It also supports compatibility aliases:
- `/claweb/login`
- `/claweb/history`
- `/claweb/ws`

## Why this exists

The CLAWeb OpenClaw channel plugin exposes the upstream WebSocket channel.
A client-facing deployment usually needs a small access host to:

- serve a client UI
- implement login + history
- proxy WS to the upstream OpenClaw channel
- persist raw history with a stable ordering tie-break (`_idx`)

## Config

### Required env

- `PORT` (default: `18081`)
- `BIND` (default: `127.0.0.1`)
- `CLAWEB_STATIC_ROOT` (default: `../../clients/browser`)
- `CLAWEB_LOGIN_CONFIG` (default: `./config/claweb-login.example.json`)
- `CLAWEB_HISTORY_DIR` (default: `./data/history`)

### Upstream (OpenClaw claweb channel)

- `CLAWEB_UPSTREAM_WS` (default: `ws://127.0.0.1:18999`)
- `CLAWEB_UPSTREAM_TOKEN` or `CLAWEB_UPSTREAM_TOKEN_FILE`

The upstream token is the `channels.claweb.authToken` configured in OpenClaw.

## Run

```bash
cd access/frontdoor
npm i
node server.js
```

## Smoke tests

### HTTP smoke

```bash
node scripts/smoke-http.js \
  --base https://claweb.example.com \
  --passphrase demo-passphrase \
  --userId demo-user --roomId demo-room --clientId demo-client \
  --insecure
```

### WebSocket smoke

```bash
node scripts/smoke-ws.js \
  --base https://claweb.example.com \
  --passphrase demo-passphrase \
  --clientId demo-client \
  --message "ping" \
  --insecure
```

This validates:
- `hello -> ready`
- assistant reply carries `replyTo`
- user and assistant ids do not collide

## Migration note

Older docs may refer to `examples/frontdoor/`.
That directory has now been promoted to `access/frontdoor/` to make the repository layering clearer.
