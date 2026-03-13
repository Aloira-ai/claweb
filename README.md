# claweb

[English](./README.md) | [简体中文](./README.zh-CN.md)

OpenClaw Web Channel plugin plus a browser frontend example.

`claweb` keeps routing/session/reply flow inside OpenClaw while exposing a web-friendly channel surface.

## What Is Included

- WebSocket channel plugin runtime for OpenClaw.
- Public browser frontend example in `public/claweb/`.
- Example configs in `examples/` for OpenClaw and fixed identity mapping.
- An optional "frontdoor" example host in `examples/frontdoor/` (serves UI + implements /login /history /ws and proxies to upstream claweb channel).

## Current Scope (v0.2.0)

Current repository scope includes a validated browser-facing baseline for CLAWeb:

- `hello -> ready -> message` websocket flow.
- Browser-side message normalization and dedupe for realtime + history replay.
- User echo identification to avoid duplicate role confusion.
- History replay compatible with stable server-side sort (`ts`, `_idx`).
- Safe-subset rich text rendering in the browser frontend.
- Compact reply preview rendering plus history fallback.
- Session persistence and automatic reconnect after refresh / background interruption.
- Browser image upload with “keep original by default” handling and oversized-image compression fallback.
- OpenClaw-standard media handoff compatibility (`MEDIA:` / `mediaUrl`) at the frontend/frontdoor layer.

Still out of scope in this repo:

- Persona/prompt logic and memory injection.
- Telegram or other private adapters.
- A full production auth stack and ops hardening.
- Arbitrary raw HTML rendering or executable rich content.
- Turning CLAWeb itself into a video-generation or business-logic orchestration layer.

## Repository Layout

- `index.ts`: plugin entry and channel registration.
- `src/`: channel runtime implementation.
- `public/claweb/`: browser frontend example (`index.html`, `style.css`, `app.js`).
- `examples/openclaw.config.example.jsonc`: minimal OpenClaw plugin config.
- `examples/claweb-login.example.json`: fixed identity mapping example (non-secret placeholders).

## Quick Start

1. Install dependencies: `npm install`
2. Static check: `npm run typecheck`
3. Load plugin from your OpenClaw profile.
4. Configure `channels.claweb` using [`examples/openclaw.config.example.jsonc`](./examples/openclaw.config.example.jsonc).
5. Serve `public/claweb/` from your web server and wire these endpoints:
   - `POST /claweb/login`
   - `GET /claweb/history`
   - `WS /claweb/ws`

Frontend integration contract is documented in [`docs/frontend-integration.md`](./docs/frontend-integration.md).

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
