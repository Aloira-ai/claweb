# claweb

[English](./README.md) | [简体中文](./README.zh-CN.md)

OpenClaw client-facing channel plugin plus a browser reference client.

`claweb` keeps routing/session/reply flow inside OpenClaw while exposing a client-facing channel surface that can be consumed by web, app, desktop, or other clients. The browser UI in this repo is the first reference client, not the full boundary of the channel.

## What Is Included

- WebSocket channel plugin runtime for OpenClaw.
- Client-facing channel semantics for session, reply, history, and media handoff.
- Public browser reference client in `public/claweb/`.
- Example configs in `examples/` for OpenClaw and fixed identity mapping.
- An optional "frontdoor" reference host in `examples/frontdoor/` (serves a client UI + implements /login /history /ws and proxies to upstream claweb channel).

## Current Scope (v0.2.0)

Current repository scope includes a validated client-facing baseline for CLAWeb, with the browser UI as the first reference client:

- `hello -> ready -> message` websocket flow.
- Browser-side message normalization and dedupe for realtime + history replay.
- User echo identification to avoid duplicate role confusion.
- History replay compatible with stable server-side sort (`ts`, `_idx`).
- Protocol semantics for `hello -> ready -> message`, reply linking, history replay, and media handoff.
- Safe-subset rich text rendering in the browser reference client.
- Compact reply preview rendering plus history fallback.
- Session persistence and automatic reconnect after refresh / background interruption in the browser reference client.
- Image upload handling in the browser reference client with “keep original by default” and oversized-image compression fallback.
- OpenClaw-standard media handoff compatibility (`MEDIA:` / `mediaUrl`) at the client/frontdoor layer.

Still out of scope in this repo:

- Persona/prompt logic and memory injection.
- Telegram or other private adapters.
- A full production auth stack and ops hardening.
- Arbitrary raw HTML rendering or executable rich content.
- Turning CLAWeb itself into a video-generation or business-logic orchestration layer.

## Repository Layout

- `index.ts`: plugin entry and channel registration.
- `src/`: channel runtime implementation.
- `public/claweb/`: browser reference client (`index.html`, `style.css`, `app.js`).
- `examples/openclaw.config.example.jsonc`: minimal OpenClaw plugin config.
- `examples/claweb-login.example.json`: fixed identity mapping example (non-secret placeholders).
- `examples/frontdoor/`: reference access host for `/login`, `/history`, `/ws`.

## Quick Start

1. Install dependencies: `npm install`
2. Static check: `npm run typecheck`
3. Load plugin from your OpenClaw profile.
4. Configure `channels.claweb` using [`examples/openclaw.config.example.jsonc`](./examples/openclaw.config.example.jsonc).
5. Serve `public/claweb/` from your web server and wire these endpoints:
   - `POST /claweb/login`
   - `GET /claweb/history`
   - `WS /claweb/ws`

Channel architecture layers: [`docs/channel-architecture.md`](./docs/channel-architecture.md).

Channel contract (client-facing semantics): [`docs/channel-contract.md`](./docs/channel-contract.md).

Frontend integration contract for the browser reference client is documented in [`docs/frontend-integration.md`](./docs/frontend-integration.md).

Project scope and boundaries: [`docs/project-scope.md`](./docs/project-scope.md).

Pre/post change regression checklist (test site): [`docs/regression-checklist.md`](./docs/regression-checklist.md).

State model (raw/recent/runtime): [`docs/state-model.md`](./docs/state-model.md).

## Public Release Position

- This repository is public-source oriented and now tracked at the `0.2.x` milestone.
- GitHub release tagging is appropriate; npm package publishing is still not enabled.
- `package.json` keeps `"private": true` intentionally to prevent accidental npm publish.

## Security Notes

- Never commit real passphrases, tokens, or user mapping files.
- Keep only example placeholders in Git.
- Prefer local binding (`127.0.0.1`) until explicit network hardening is implemented.
- See [`SECURITY.md`](./SECURITY.md).

## License

Apache-2.0
