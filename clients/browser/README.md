# CLAWeb Browser Reference Client

This directory contains the **first browser reference client** for the CLAWeb channel.

It is a reference client, not the whole CLAWeb product boundary.

## Role in the repository

CLAWeb is organized around three layers:

- **Channel runtime**: `src/`
- **Reference access layer**: `access/frontdoor/`
- **Reference clients**: `clients/browser/`

This directory is the current browser implementation of the third layer.

## What lives here

- `index.html`
- `style.css`
- `app.js`

These files implement browser-side behavior such as:
- rendering
- reply UI
- reconnect behavior
- history hydration
- upload UX
- media presentation

## What does NOT live here

This directory should not become the source of truth for:
- channel protocol semantics
- persona/prompt logic
- memory injection
- private business workflows

For those boundaries, see:
- `docs/channel-contract.md`
- `docs/channel-architecture.md`
- `docs/project-scope.md`
