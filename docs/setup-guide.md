# CLAWeb Setup Guide

This guide is written for readers who are comfortable copying commands but do **not** already know CLAWeb or OpenClaw internals.

Goal: by the end, you will have a **local CLAWeb demo** running on one machine:

- OpenClaw provides the upstream `claweb` channel on `127.0.0.1:18999`
- the reference frontdoor serves the browser UI on `http://127.0.0.1:18081`
- you can open the page in a browser, log in, load history, and chat

If you want the architecture first, read [`./channel-architecture.md`](./channel-architecture.md). If you want to get something working first, stay here.

---

## 1. What CLAWeb is, in plain language

CLAWeb has **three layers** in this repository:

1. **Channel runtime** (`src/`, `index.ts`)
   - This is the actual OpenClaw plugin/channel.
   - It speaks the upstream CLAWeb WebSocket protocol.

2. **Reference access host** (`access/frontdoor/`)
   - This is a small Node server.
   - It serves the browser UI.
   - It exposes `/login`, `/history`, and `/ws`.
   - It connects those routes to the upstream OpenClaw CLAWeb channel.

3. **Browser reference client** (`clients/browser/`)
   - This is the chat UI you open in your browser.

If you are new, the easiest mental model is:

> OpenClaw is the brain.  
> CLAWeb is the web-shaped doorway.  
> `access/frontdoor` is the small bridge between the browser and OpenClaw.

---

## 2. What you need before you start

### Required

- **OpenClaw** already installed
- **Node.js** installed (Node 20+ recommended; Node 22 is known-good in this workspace)
- **npm** available
- a working OpenClaw profile/config that you can edit

### Repository requirements

This repository currently expects:

- `openclaw` dependency: `^2026.3.7`
- browser/frontdoor local setup with Node

See [`../package.json`](../package.json) and [`../access/frontdoor/package.json`](../access/frontdoor/package.json).

### Before you continue, verify these commands work

```bash
node -v
npm -v
openclaw --version
```

If one of them fails, stop and fix that first.

---

## 3. The fastest working path

If you want the short version first, this is the full flow:

1. Install the CLAWeb plugin into OpenClaw.
2. Configure `channels.claweb` in your OpenClaw config.
3. Create a CLAWeb token file.
4. Start/restart OpenClaw so the channel listens on `127.0.0.1:18999`.
5. Configure and start `access/frontdoor`.
6. Open `http://127.0.0.1:18081` in your browser.
7. Log in with a passphrase from the frontdoor login config.

The rest of this guide expands every one of those steps.

---

## 4. Step-by-step setup

## Step 1 — Get the repository and install dependencies

From the repository root:

```bash
cd /path/to/claweb
npm install
npm run typecheck
```

### What this does

- `npm install` installs the root dependencies for the CLAWeb plugin
- `npm run typecheck` confirms the TypeScript code is at least statically valid

### Success looks like

- `npm install` finishes without an error
- `npm run typecheck` exits cleanly

If `typecheck` fails, do not continue yet.

---

## Step 2 — Install the plugin into OpenClaw

OpenClaw plugins are managed with `openclaw plugins ...`.

For a local checkout, the simplest option is:

```bash
openclaw plugins install /path/to/claweb --link
```

Then enable it:

```bash
openclaw plugins enable claweb
```

### Why `--link` is nice during development

`--link` lets OpenClaw load the plugin from your local working copy instead of copying files into a separate install directory.

That means when you edit the repository, you are editing the copy OpenClaw will load.

### Verify plugin state

```bash
openclaw plugins list
openclaw plugins info claweb
openclaw plugins doctor
```

### Success looks like

- `claweb` appears in `plugins list`
- it is enabled
- `plugins doctor` does not report a manifest/schema load problem for this plugin

If this step fails, do not move on until OpenClaw can see the plugin.

---

## Step 3 — Create a token file for the upstream CLAWeb channel

The OpenClaw CLAWeb channel and the frontdoor need to agree on a shared token.

Create a file somewhere safe on the same machine. Example:

```bash
mkdir -p ~/.config/claweb
openssl rand -hex 32 > ~/.config/claweb/claweb.token
chmod 600 ~/.config/claweb/claweb.token
```

If `openssl` is unavailable, any long random secret is fine. Just keep it out of Git.

### Why this matters

The frontdoor uses this token when it opens the upstream WebSocket to OpenClaw. If the token does not match, login may succeed locally but realtime chat will fail later.

### Success looks like

This command should print a long random string:

```bash
cat ~/.config/claweb/claweb.token
```

Do **not** commit this file.

---

## Step 4 — Add `channels.claweb` to your OpenClaw config

Start from the example in [`../examples/openclaw.config.example.jsonc`](../examples/openclaw.config.example.jsonc).

Add this block under your OpenClaw config:

```jsonc
{
  "channels": {
    "claweb": {
      "accounts": {
        "default": {
          "enabled": true,
          "listenHost": "127.0.0.1",
          "listenPort": 18999,
          "authTokenFile": "/home/YOUR_USER/.config/claweb/claweb.token"
        }
      }
    }
  }
}
```

Replace the token path with your real absolute path.

### Field-by-field explanation

- `enabled`: turns the CLAWeb channel on
- `listenHost`: where OpenClaw exposes the upstream CLAWeb socket
- `listenPort`: the upstream port the frontdoor will connect to
- `authTokenFile`: where OpenClaw reads the shared secret from

### Very important beginner note

Keep `listenHost` as `127.0.0.1` unless you intentionally want network exposure.

For a first setup, **local-only is the safest and easiest**.

---

## Step 5 — Restart OpenClaw and confirm the upstream channel is live

After saving your config, restart OpenClaw/gateway using your normal workflow.

Then verify the service is healthy.

Useful commands:

```bash
openclaw gateway status
openclaw plugins list
```

If you have a status or logs workflow in your environment, use that too.

### Success looks like

- OpenClaw starts without config errors
- the `claweb` plugin is still enabled
- the upstream CLAWeb listener is expected to be on `127.0.0.1:18999`

### Common failure mode here

If your config has a JSON/JSONC mistake, OpenClaw may fail before CLAWeb even loads.

If that happens, fix the config first.

---

## Step 6 — Prepare the frontdoor login file

The frontdoor needs a small identity mapping file. Start from:

- [`../access/frontdoor/config/claweb-login.example.json`](../access/frontdoor/config/claweb-login.example.json)

Example minimal config:

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

Save it somewhere outside Git if you want local real values. Example:

```bash
mkdir -p ./access/frontdoor/config
cp ./access/frontdoor/config/claweb-login.example.json ./access/frontdoor/config/claweb-login.local.json
```

Then edit `claweb-login.local.json`.

### What the fields mean

- `displayName`: what the browser client shows after login
- `passphrases`: one or more login passwords/passphrases for that identity
- `userId`: stable user identity used in history and message routing
- `roomId`: chat room id; for a simple single-room test, `room-main` is fine
- `clientId`: stable client identity used by the browser client

### Beginner advice

For your first successful run:

- create **one** identity only
- use a simple `roomId` like `room-main`
- use one clear passphrase you can type without mistakes

---

## Step 7 — Start the reference frontdoor

Open a second terminal:

```bash
cd /path/to/claweb/access/frontdoor
npm install
```

Then start the server with explicit environment variables:

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

### What this does

- serves the browser UI at `/`
- exposes `POST /login`
- exposes `GET /history`
- exposes `WS /ws`
- connects to the upstream OpenClaw CLAWeb channel using your token

### Success looks like

- the process stays running
- you do **not** see a warning about a missing upstream token
- there is no immediate crash on startup

If you see this warning:

> `missing CLAWEB_UPSTREAM_TOKEN (or *_TOKEN_FILE)`

stop and fix the token path before testing the browser.

---

## Step 8 — Open the browser UI

Open this URL in your browser:

```text
http://127.0.0.1:18081
```

If everything is wired correctly, you should see the CLAWeb login page.

### Success looks like

- the page loads
- it is not a blank page
- it is not a 404

If the page does not load, the frontdoor is not serving static files correctly yet.

---

## Step 9 — Log in

Use the passphrase you configured in `claweb-login.local.json`.

### Success looks like

After login, the browser should receive a session payload that includes fields like:

- `displayName`
- `token`
- `userId`
- `roomId`
- `clientId`
- `wsUrl`

The browser should then connect to `ws://127.0.0.1:18081/ws` (or `wss://.../ws` if you later deploy behind HTTPS).

---

## Step 10 — Send a test message

Type a simple message such as:

```text
hello
```

### Success looks like

You should see the normal CLAWeb flow:

1. browser connects WebSocket
2. browser sends `hello`
3. server returns `ready`
4. your user message appears
5. assistant reply comes back

If you can log in but no reply ever arrives, the most common causes are:

- wrong upstream token
- OpenClaw CLAWeb channel not listening on `127.0.0.1:18999`
- frontdoor cannot reach upstream WS
- the plugin is not enabled

---

## 5. Useful built-in smoke tests

The frontdoor includes two small smoke-test scripts.

## HTTP smoke test

```bash
cd /path/to/claweb/access/frontdoor
node scripts/smoke-http.js \
  --base https://claweb.example.com \
  --passphrase YOUR_PASSPHRASE \
  --userId user-guest-a \
  --roomId room-main \
  --clientId guest-a \
  --insecure
```

Use `http://127.0.0.1:18081` or your real HTTPS host as `--base`.

This checks:

- `POST /login`
- `GET /history`
- history ordering by `(ts, _idx)`

## WebSocket smoke test

```bash
cd /path/to/claweb/access/frontdoor
node scripts/smoke-ws.js \
  --base https://claweb.example.com \
  --passphrase YOUR_PASSPHRASE \
  --clientId guest-a \
  --message "ping" \
  --insecure
```

This checks:

- `hello -> ready`
- one user turn can receive one assistant reply
- assistant `replyTo` links back to the original user turn id

For local HTTP, use your local base URL and skip TLS-related assumptions as needed.

---

## 6. Canonical routes you should expect

The current preferred route set is:

- `GET /`
- `POST /login`
- `GET /history`
- `WS /ws`

Compatibility aliases may also exist:

- `POST /claweb/login`
- `GET /claweb/history`
- `WS /claweb/ws`

The browser reference client prefers the short canonical routes.

See also:

- [`./browser-client-integration.md`](./browser-client-integration.md)
- [`./channel-contract.md`](./channel-contract.md)

---

## 7. Files and folders you will touch most often

### In the repository root

- `index.ts` — plugin entry
- `src/` — CLAWeb channel runtime
- `examples/openclaw.config.example.jsonc` — OpenClaw config example

### In the frontdoor

- `access/frontdoor/server.js` — reference access host
- `access/frontdoor/config/claweb-login.example.json` — login mapping example
- `access/frontdoor/data/history/` — raw history persistence
- `access/frontdoor/scripts/smoke-http.js` — login/history smoke test
- `access/frontdoor/scripts/smoke-ws.js` — realtime smoke test

### In the browser client

- `clients/browser/` — static browser reference client assets

---

## 8. First-time setup checklist

Use this as a simple checklist:

- [ ] `npm install` completed in repository root
- [ ] `npm run typecheck` passed
- [ ] `openclaw plugins install /path/to/claweb --link` completed
- [ ] `openclaw plugins enable claweb` completed
- [ ] CLAWeb token file created
- [ ] `channels.claweb` added to OpenClaw config
- [ ] OpenClaw restarted cleanly
- [ ] `claweb-login.local.json` created
- [ ] frontdoor started with the correct env vars
- [ ] `http://127.0.0.1:18081` opens in browser
- [ ] login works
- [ ] test message receives a reply

---

## 9. When you are ready for the next step

After your local setup works, the usual next jobs are:

- run the frontdoor behind a reverse proxy
- switch from `http://127.0.0.1:18081` to a real domain
- terminate TLS with HTTPS/WSS
- harden auth and operational controls
- separate example/demo identity config from production identity config

For errors and common mistakes, continue with [`./troubleshooting.md`](./troubleshooting.md).
