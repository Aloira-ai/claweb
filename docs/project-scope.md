# CLAWeb Project Scope (Source of Truth)

## One-line rule

**All CLAWeb-related scope should converge into this `claweb` repository.**

## What this means

- `claweb` is the source of truth for:
  - Frontend integration contract
  - Public demo frontend (`public/claweb/*`)
  - Login/history/ws endpoint contract (`/claweb/login`, `/claweb/history`, `/claweb/ws`)
  - Protocol semantics (`hello -> ready -> message`)
  - Regression expectations

- CLAWeb should be developed, maintained, and validated within this repo only.
  - Avoid coupling with any private/legacy systems.
  - Any fixes required for CLAWeb must be implemented inside `claweb`, then deployed to the test site.

## Deployment / verification

- `claweb.example.com` is the public verification surface for CLAWeb.
- All changes must pass `docs/regression-checklist.md` on `claweb.example.com`.

## Non-goals

- Feature work that depends on private adapters, persona prompts, or unrelated business logic.
- Turning any existing private app into a long-term host shell for CLAWeb.
