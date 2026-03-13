# CLAWeb Project Scope (Source of Truth)

## One-line rule

**All CLAWeb-related scope should converge into this `claweb` repository.**

## What this means

- `claweb` is the source of truth for:
  - Client-facing channel contract
  - Reference client integration contract
  - Public browser reference client (`public/claweb/*`)
  - Login/history/ws access contract (`/claweb/login`, `/claweb/history`, `/claweb/ws`)
  - Protocol semantics (`hello -> ready -> message`, reply, history, media)
  - Regression expectations

- CLAWeb should be developed, maintained, and validated within this repo only.
  - Avoid coupling with any private/legacy systems.
  - Any fixes required for CLAWeb must be implemented inside `claweb`, then deployed to the test site.

## Deployment / verification

- `claweb.example.com` is the current public verification surface for the browser reference client.
- All browser-reference-client changes must pass `docs/regression-checklist.md` on `claweb.example.com`.
- Future app / desktop / other clients should reuse the same channel semantics rather than redefining them per client.

## Non-goals

- Feature work that depends on private adapters, persona prompts, or unrelated business logic.
- Defining CLAWeb as browser-only or page-only.
- Turning any existing private app into a long-term host shell for CLAWeb.
