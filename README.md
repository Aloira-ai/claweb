# claweb

OpenClaw Web Channel plugin (WebSocket).

`claweb` lets a web client act as a normal OpenClaw channel endpoint, so session routing, memory, tools, and reply flow stay inside OpenClaw instead of being reimplemented in browser-side glue code.

## Project Goal

Build a reusable, profile-agnostic OpenClaw channel plugin that can be published as an open-source repository.

This repository is not tied to a specific local machine, profile name, or deployment topology.

## Architecture Principle

- Web client is only a transport client.
- OpenClaw remains the source of truth for routing/session/reply pipeline.
- Channel server normalizes inbound frames and forwards through OpenClaw runtime.
- Assistant responses are delivered back to the same WebSocket connection.

## MVP-0 Scope (Current)

Implemented text-only closed loop:

- WebSocket handshake with token auth (`hello -> ready`)
- Text message ingress (`message`)
- Inbound context normalization
- Dispatch through OpenClaw channel runtime
- Assistant text pushback to client

Current status: **MVP-0 validated** (functional text loop), intended as a baseline for future hardening.

## Non-Goals (MVP-0)

- Media upload/download
- Reconnect/resume/session recovery
- Advanced auth/origin/rate-limit hardening
- Production ops hardening and SLO guarantees

## Project Layout

- `index.ts`: plugin entry and channel registration
- `src/channel.ts`: channel config resolution and account startup
- `src/server/ws-server.ts`: WS protocol parsing and connection lifecycle
- `src/inbound/build-ctx.ts`: OpenClaw inbound context builder
- `src/outbound/deliver.ts`: OpenClaw outbound payload -> WS frame mapping
- `examples/openclaw.config.example.jsonc`: profile-agnostic minimal config sample

## Quick Start

1. Install dependencies:
   - `npm install`
2. Run static check:
   - `npm run typecheck`
3. Make this plugin discoverable by your target OpenClaw profile (according to your profile's plugin loading method).
4. Add `channels.claweb` config (see minimal example below).
5. Start OpenClaw with that profile and connect a WebSocket client to the configured host/port.

## Minimal Config

See [`examples/openclaw.config.example.jsonc`](./examples/openclaw.config.example.jsonc).

Key points:

- Keep `listenHost` as `127.0.0.1` by default.
- Use `authTokenFile` or runtime secret injection, not committed plain tokens.
- `default` account works for single-account setup; `accounts.<id>` supports multi-account expansion later.

## Verify Steps (MVP-0)

After OpenClaw starts with claweb enabled:

1. Connect to `ws://<listenHost>:<listenPort>`.
2. Send:
   - `{ "type": "hello", "token": "<your-claweb-token>", "userId": "demo-user", "roomId": "demo-room" }`
3. Expect:
   - `{ "type": "ready", "serverVersion": "..." }`
4. Send:
   - `{ "type": "message", "id": "msg-1", "text": "hello" }`
5. Expect:
   - assistant `message` frame with same `id` and generated text reply (or an `error` frame if dispatch fails).

## WS Frames (MVP-0)

Client -> Server:

```json
{ "type": "hello", "token": "...", "clientId": "optional-client-id", "userId": "demo-user", "roomId": "demo-room" }
{ "type": "message", "id": "msg-1", "text": "hello" }
```

Server -> Client:

```json
{ "type": "ready", "serverVersion": "..." }
{ "type": "message", "id": "msg-1", "role": "assistant", "text": "..." }
{ "type": "error", "id": "msg-1", "message": "..." }
```

## Security Baseline

- Browser auth token must be separate from any OpenClaw gateway token.
- Never commit real tokens in repository files.
- Default local bind (`127.0.0.1`) is recommended until explicit hardening is added.
- See [`SECURITY.md`](./SECURITY.md) for release baseline.

## License

Apache-2.0
