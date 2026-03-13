# CLAWeb Channel Architecture

CLAWeb should be understood as an **OpenClaw client-facing channel**, not as a browser-only chat page.

The browser UI included in this repository is the **first reference client**, but the channel itself should be reusable across:

- browser web
- mobile / app shells
- desktop clients
- embedded webviews
- future first-party or third-party clients

## Layer Model

### 1) Channel Runtime (core)

This is the actual CLAWeb channel layer inside OpenClaw.

Responsibilities:
- channel registration
- frame flow (`hello -> ready -> message`)
- session semantics
- reply semantics
- history semantics
- media handoff semantics
- compatibility with OpenClaw-standard outputs (`MEDIA:`, `mediaUrl`, `mediaUrls`)

Current repo locations:
- `index.ts`
- `src/`

This layer is the **channel itself**.
It must stay client-agnostic as much as possible.

## 2) Reference Access Layer

This layer exposes the channel to client applications.

Responsibilities:
- `/login`
- `/history`
- `/ws`
- host-side session bootstrap
- history persistence / replay
- upstream proxying to OpenClaw claweb channel

Current repo locations:
- `access/frontdoor/`
- `docs/browser-client-integration.md`
- `docs/state-model.md`

This layer is not the channel core, but it is the **reference way to access the channel from clients**.

## 3) Reference Clients

This layer contains client implementations that consume the channel.

Current first reference client:
- browser client in `clients/browser/`

Responsibilities may include:
- rendering
- optimistic UI
- reconnect behavior
- upload UX
- reply UI
- media presentation

Important:
- a reference client is **not** the definition of the channel
- browser is **not** the only valid CLAWeb client shape
- future app / desktop clients should reuse the same channel semantics

## Repository Mental Model

When working in this repo, think in this order:

1. **channel semantics first**
2. **access contract second**
3. **reference client behavior third**

That means:
- do not define CLAWeb only by the browser UI
- do not let one client redefine protocol semantics
- do not push persona/prompt/business logic into the channel repo

## Non-goals for CLAWeb

CLAWeb should not become:
- a browser-only project
- a private companion shell
- a persona/prompt repository
- a video-generation orchestration layer
- a client-specific protocol fork

## Practical Rule

A good test for future changes:

> If the browser client disappeared tomorrow, would the underlying CLAWeb channel contract still make sense for app / desktop / other clients?

If the answer is no, the design is probably too browser-specific.
