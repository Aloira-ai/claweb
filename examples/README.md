# CLAWeb Examples

This directory contains **example configuration and sample data only**.

It should stay lightweight.
Code with a long-term architectural identity should live elsewhere in the repository:

- Channel runtime → `src/`
- Reference access layer → `access/frontdoor/`
- Reference clients → `clients/`

## Current contents

- `openclaw.config.example.jsonc`
  - Minimal OpenClaw plugin configuration example.
- `claweb-login.example.json`
  - Fixed identity mapping example with placeholder values only.

## Rule of thumb

If a file is meant to be copied, adapted, or used as sample input, `examples/` is a good home.
If a file is part of the repository's actual reference architecture, it should not live here.
