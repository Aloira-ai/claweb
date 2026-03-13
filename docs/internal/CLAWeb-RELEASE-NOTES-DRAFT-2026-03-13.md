# CLAWeb Release Notes Draft — 2026-03-13

## Title
CLAWeb Frontdoor UX & Rich Text Update

## Summary
This update tightens the browser-facing frontdoor experience and brings the current test-line improvements back into the repository baseline.

## Highlights

### Rich text safe subset
The browser frontend now supports a safe markdown-like subset for:
- paragraphs and line breaks
- emoji and common symbols
- bold / italic / inline code
- fenced code blocks
- lists
- blockquotes
- safe links

Raw HTML and other high-risk rendering features remain intentionally unsupported.

### Better reply previews
Reply previews are now compact instead of expanding full quoted content:
- composer reply banner uses a short summary
- in-message quote preview is compressed into a single-line snippet
- history replay can recover reply summaries more reliably via `replyPreview`

### Better history behavior
History replay is now less likely to degrade into `Reply to: (message not in view)` when the original quoted message is not currently visible.

### Rollout reliability
Frontend static asset versioning was bumped during rollout to avoid stale browser cache serving outdated JS/CSS.

## Fixes
- Fixed markdown false positives around escaped literals like `\\*`, `\\**`, and ``\\```.
- Fixed oversized reply preview UI taking too much space.
- Fixed reply preview loss in history replay through frontdoor persistence and fallback logic.
- Fixed frontend rollout confusion caused by stale static asset caching.

## Notes
- Current UI styling is already usable for ongoing testing, but visual polish is still considered a long-term refinement area.
- Media delivery and rich text behavior were verified on the running test-line before being synced back into the repo baseline.

## Suggested short release text
CLAWeb now has a richer frontdoor message experience: safe-subset rich text, compact reply previews, more reliable history reply fallback, and a cleaner baseline for continued iteration.
