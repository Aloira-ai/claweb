# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-03-13

### Added
- Safe-subset rich text rendering in the browser frontend for paragraphs, line breaks, bold, italic, inline code, fenced code blocks, lists, blockquotes, and safe links.
- Compact reply preview support in the composer banner and message quote area.
- `replyPreview` propagation / persistence / history fallback in the frontdoor example.
- Browser-side image upload flow with “keep original by default” handling for normal images and compression fallback for oversized files.
- Session persistence plus automatic reconnect/recovery when the page returns from background or transient disconnects.
- Chinese repository readme: `README.zh-CN.md`.
- Internal baseline / release-prep docs for the current frontdoor line.

### Changed
- Message body rendering now uses a frontend rich-text path instead of plain `textContent` only.
- Reply previews are compressed into compact summaries instead of expanding full quoted text.
- Public repo defaults and examples were sanitized to remove first-party branding, real test domains, and private deployment-specific identifiers.
- Example smoke scripts and docs now use generic placeholder domains/identities.

### Fixed
- Fixed markdown false positives for escaped literals such as `\\*`, `\\**`, and ``\\``.
- Fixed frequent `Reply to: (message not in view)` degradation by introducing reply preview fallback logic.
- Fixed overlong reply preview UI occupying too much composer/message space.
- Fixed low-quality image upload defaults that hurt downstream image-edit tasks by preferring original uploads for normal images.
- Fixed the “switch away from page → disconnect → must log in again” behavior by restoring session state and reconnecting automatically.
- Fixed rollout confusion caused by stale frontend static asset caching.

### Notes
- Current rich text intentionally remains a safe subset and does **not** support raw HTML, arbitrary inline styles, complex tables, or executable content.
- The repository is still marked `private: true` in `package.json` because this is currently a GitHub-source distribution, not an npm package release.
- No GitHub release has been cut yet; `0.2.0` is the recommended next release tag/version milestone.
