# CLAWeb Troubleshooting

This page is written for the most common question:

> “The page opens, but something in the flow still does not work.”

Work from top to bottom. In many cases, CLAWeb problems are just one of these:

- plugin not installed or not enabled
- OpenClaw config not loading
- wrong token or token-file path
- frontdoor not running
- login config mismatch
- browser can load `/` but cannot use `/login`, `/history`, or `/ws`

---

## 1. Start with the simplest possible checklist

Before deep debugging, confirm all of these:

```bash
node -v
npm -v
openclaw --version
openclaw plugins list
openclaw plugins info claweb
openclaw plugins doctor
openclaw gateway status
```

You are looking for:

- Node and npm are available
- OpenClaw is installed
- `claweb` exists as a plugin
- `claweb` is enabled
- the gateway is healthy
- plugin doctor does not show a manifest/schema error

If this basic layer is broken, fix it before debugging browser behavior.

---

## 2. Problem: `claweb` plugin does not appear in OpenClaw

### What it usually means

OpenClaw has not actually installed the repository as a plugin yet.

### Fix

Install it from your local checkout:

```bash
openclaw plugins install /path/to/claweb --link
openclaw plugins enable claweb
```

Then verify:

```bash
openclaw plugins list
openclaw plugins info claweb
```

### If it still fails

Run:

```bash
openclaw plugins doctor
```

Look for plugin manifest/schema problems involving `openclaw.plugin.json`.

---

## 3. Problem: OpenClaw restarts fail after adding `channels.claweb`

### What it usually means

Your OpenClaw config has a syntax or structure problem.

### Common causes

- missing comma
- wrong nesting level
- wrong absolute path in `authTokenFile`
- editing the wrong OpenClaw profile/config file

### Fix

Compare your config carefully against:

- [`../examples/openclaw.config.example.jsonc`](../examples/openclaw.config.example.jsonc)

Double-check these fields:

- `enabled`
- `listenHost`
- `listenPort`
- `authTokenFile`

### Beginner tip

If you edited multiple things at once, undo everything except the minimal `channels.claweb` block, then try again.

---

## 4. Problem: frontdoor starts, but prints a missing token warning

You may see something like:

> `missing CLAWEB_UPSTREAM_TOKEN (or *_TOKEN_FILE)`

### What it means

The frontdoor does not have the shared secret it needs for the upstream OpenClaw CLAWeb socket.

### Fix

Make sure one of these is set:

- `CLAWEB_UPSTREAM_TOKEN`
- `CLAWEB_UPSTREAM_TOKEN_FILE`

Example:

```bash
CLAWEB_UPSTREAM_TOKEN_FILE=$HOME/.config/claweb/claweb.token node server.js
```

Also make sure the file actually exists:

```bash
ls -l $HOME/.config/claweb/claweb.token
cat $HOME/.config/claweb/claweb.token
```

### Very common real cause

The token exists, but the frontdoor points at the wrong file path.

---

## 5. Problem: browser page does not open at all

### Symptoms

- `http://127.0.0.1:18081` does not load
- browser shows connection refused
- browser shows 404
- blank page

### What to check

#### A. Is the frontdoor process running?

The frontdoor terminal should still be alive after:

```bash
node server.js
```

If it crashed, read the error first.

#### B. Are `BIND` and `PORT` what you expect?

Example known-good local values:

```bash
BIND=127.0.0.1
PORT=18081
```

#### C. Is `CLAWEB_STATIC_ROOT` correct?

For the repository layout, this is the common local value:

```bash
CLAWEB_STATIC_ROOT=../../clients/browser
```

If static root is wrong, the server may run but fail to serve the browser assets.

### Quick fix recipe

From `access/frontdoor/`:

```bash
BIND=127.0.0.1 \
PORT=18081 \
CLAWEB_STATIC_ROOT=../../clients/browser \
CLAWEB_LOGIN_CONFIG=./config/claweb-login.local.json \
CLAWEB_HISTORY_DIR=./data/history \
CLAWEB_UPSTREAM_WS=ws://127.0.0.1:18999 \
CLAWEB_UPSTREAM_TOKEN_FILE=$HOME/.config/claweb/claweb.token \
node server.js
```

---

## 6. Problem: login fails

### Symptoms

- login returns `invalid_credentials`
- login returns `missing_passphrase`
- login returns `login_not_configured`

### What to check

#### A. Is the right login config file loaded?

Check your env var:

```bash
CLAWEB_LOGIN_CONFIG=./config/claweb-login.local.json
```

If you forgot to set it, frontdoor may still be using the example file.

#### B. Does the JSON structure match what the frontdoor expects?

Example:

```json
{
  "guest-a": {
    "displayName": "Guest A",
    "passphrases": ["change-me-now"],
    "userId": "user-guest-a",
    "roomId": "room-main",
    "clientId": "guest-a"
  }
}
```

#### C. Are you typing the passphrase exactly?

For first setup, use a simple temporary passphrase until the rest works.

### Quick validation trick

Open the login config file and confirm the exact passphrase you expect is present in the `passphrases` array.

---

## 7. Problem: login works, but chat never connects

### Symptoms

- browser loads
- login succeeds
- no realtime messages
- no assistant reply
- WebSocket fails or disconnects immediately

### Most common causes

#### A. Upstream CLAWeb channel is not actually listening

OpenClaw may be running, but the CLAWeb plugin/channel may not be active.

Check:

```bash
openclaw plugins list
openclaw plugins info claweb
openclaw gateway status
```

#### B. The frontdoor is pointing at the wrong upstream socket

Expected local value:

```bash
CLAWEB_UPSTREAM_WS=ws://127.0.0.1:18999
```

#### C. Token mismatch between OpenClaw and frontdoor

This is one of the most common issues.

Make sure:

- OpenClaw `authTokenFile` points to token file **X**
- frontdoor `CLAWEB_UPSTREAM_TOKEN_FILE` also points to token file **X**

Not “two different files with different secrets”. The same one.

---

## 8. Problem: login works, but history is always empty

### What it may mean

Either:

- there is genuinely no saved history yet
- the wrong `userId` / `roomId` / `clientId` is being used
- the frontdoor history directory is wrong
- history persistence has not happened yet

### What to check

#### A. Is the history directory set?

Example:

```bash
CLAWEB_HISTORY_DIR=./data/history
```

#### B. Does the directory contain data?

```bash
ls -R ./data/history
```

#### C. Are you using the same identity consistently?

If you change `userId`, `roomId`, or `clientId` between runs, you may be looking at a different logical conversation.

### Note

The frontdoor expects stable ordering by `(ts, _idx)`. If history behavior feels strange after refresh, also run the smoke tests.

---

## 9. Problem: `/login` works, but `/history` or `/ws` does not

### What it usually means

Your routes are only partially wired.

The browser client expects the canonical route set:

- `POST /login`
- `GET /history`
- `WS /ws`

Compatibility aliases may exist, but the cleanest setup is to support the canonical routes directly.

### Fix

If you are using the reference frontdoor, use it as-is first before introducing your own hosting layer or reverse proxy rules.

If you are building your own host, compare behavior against:

- [`./browser-client-integration.md`](./browser-client-integration.md)
- [`./channel-contract.md`](./channel-contract.md)

---

## 10. Problem: browser loads, but replies look duplicated or out of order

### What it usually means

The host/history layer is not preserving the ordering and id expectations that the browser client expects.

### Rules that matter

History should sort by:

1. `ts` ascending
2. `_idx` ascending

Realtime/history dedupe prefers:

- `messageId` first
- fallback `(role, ts, text)` only when needed

### Read these docs

- [`./browser-client-integration.md`](./browser-client-integration.md)
- [`./channel-contract.md`](./channel-contract.md)
- [`./state-model.md`](./state-model.md)

If you are still on the reference frontdoor and see this behavior, run the smoke tests next.

---

## 11. Use the smoke tests before changing code

## HTTP smoke test

```bash
cd /path/to/claweb/access/frontdoor
node scripts/smoke-http.js \
  --base http://127.0.0.1:18081 \
  --passphrase YOUR_PASSPHRASE \
  --userId user-guest-a \
  --roomId room-main \
  --clientId guest-a
```

## WebSocket smoke test

```bash
cd /path/to/claweb/access/frontdoor
node scripts/smoke-ws.js \
  --base http://127.0.0.1:18081 \
  --passphrase YOUR_PASSPHRASE \
  --clientId guest-a \
  --message "ping"
```

### Why these are helpful

They tell you whether the problem is:

- route wiring
- login config
- history sorting
- websocket handshake
- reply linkage

This is much faster than guessing from the browser UI alone.

---

## 12. If you are using HTTPS / reverse proxy later

When you move beyond local testing, new failure modes appear:

- `https://` page but `ws://` socket instead of `wss://`
- reverse proxy not forwarding WebSocket upgrades
- path prefix rewrites breaking `/login`, `/history`, or `/ws`
- browser mixed-content blocking

When first deploying publicly, keep changes small:

1. get local HTTP working first
2. then add reverse proxy
3. then add HTTPS
4. then add custom path/prefix logic only if truly needed

---

## 13. Safe fallback strategy when stuck

If you are deeply stuck, reset to the smallest known-good shape:

- one machine only
- `listenHost=127.0.0.1`
- `listenPort=18999`
- `BIND=127.0.0.1`
- `PORT=18081`
- one identity in `claweb-login.local.json`
- one token file shared by both OpenClaw and frontdoor
- reference frontdoor, no reverse proxy, no HTTPS yet

If that minimal shape works, add complexity back one layer at a time.

That is almost always faster than debugging five moving parts at once.
