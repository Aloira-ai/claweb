# Changelog

All notable changes to this project will be documented in this file.

## 2026-03-13

### Added
- Safe-subset rich text rendering in the browser frontend for:
  - paragraphs and line breaks
  - emoji and common symbols
  - bold / italic / inline code
  - fenced code blocks
  - lists
  - blockquotes
  - safe links
- Compact reply preview support in the composer banner and message quote area.
- `replyPreview` propagation / persistence / history fallback in the frontdoor example.
- Internal stage baseline document: `docs/internal/CLAWeb-STAGE-SUMMARY.md`.
- Chinese repository readme: `README.zh-CN.md`.

### Changed
- Message body rendering now uses a frontend rich-text path instead of plain `textContent` only.
- Reply previews are now compressed into short summaries instead of expanding full quoted text.
- History replay can restore reply summaries more reliably even when the original quoted message is not currently in view.
- Frontend cache-busting version tags were updated during the rollout to ensure new assets load correctly.
- Code block / quote / list / link styling was polished for better test-site readability.

### Fixed
- Fixed markdown false positives for escaped literals such as `\\*`, `\\**`, and ``\\```.
- Fixed frequent `Reply to: (message not in view)` degradation by introducing reply preview fallback logic.
- Fixed overlong reply preview UI occupying too much composer/message space.
- Fixed rollout confusion caused by stale frontend static asset caching.

### Notes
- Current rich text intentionally remains a safe subset and does **not** support raw HTML, arbitrary inline styles, complex tables, or executable content.
- Media delivery and rich text validation were both verified on the running test-line before being synced back into the repository baseline.
