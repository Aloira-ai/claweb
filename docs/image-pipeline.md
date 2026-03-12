# CLAWeb Image Pipeline (Phase 1 → Phase 2)

This doc records the **end-to-end image path** for CLAWeb, including the WS frame contract, history persistence fields, and the **Phase 2 requirement**: the model must receive a **readable attachment** (not just a URL).

## Scope / non-goals

- This doc covers **claweb** only.
- Phase 1 focuses on: browser UI ↔ frontdoor ↔ WS ↔ history persistence (send/view/replay).
- Phase 2 focuses on: claweb channel ↔ OpenClaw inbound context ↔ model seeing the image.

## Entities

- **Browser UI**: `/public/claweb/` (paste/pick image, preview, send).
- **Frontdoor**: `/examples/frontdoor/server.js`
  - Accepts `POST /upload` with a `dataUrl` payload.
  - Writes media to disk and returns a stable `mediaUrl` + `mediaType`.
  - Serves media via `GET /media/<file>`.
- **WS server**: `/src/server/ws-server.ts`
  - Receives browser frames, authenticates, emits inbound messages.
- **claweb channel plugin**: `/src/channel.ts`
  - Converts inbound WS messages into OpenClaw inbound ctx and dispatches the reply.

## Phase 1: Browser → Frontdoor → WS → UI rendering / history

### Upload contract (MVP)

Browser sends a JSON request:

```json
{ "dataUrl": "data:image/png;base64,..." }
```

To:

- `POST /upload`
- Header: `x-claweb-token: <token>` (from `/login`)

Frontdoor responds with:

```json
{ "ok": true, "mediaUrl": "https://.../media/<id>.png", "mediaType": "image/png" }
```

### WS message frame

Browser sends:

```json
{
  "type": "message",
  "id": "<client message id>",
  "text": "optional",
  "timestamp": 1234567890,
  "mediaUrl": "https://.../media/...",
  "mediaType": "image/png"
}
```

Important:

- `text` may be empty **if** `mediaUrl` is present.
- `mediaUrl/mediaType` are first-class fields (do not stuff URLs into text).

### History persistence

History must preserve (at minimum):

- `messageId`
- `ts`
- `replyTo`
- `mediaUrl`
- `mediaType`

So refresh / rejoin can replay and still render the image.

## Phase 2: WS → claweb channel → OpenClaw inbound ctx → Model can read the image

### Why URL-only is not enough

Some downstream components (model request builders, optional media-understanding, etc.) prefer **local file attachments** rather than only `MediaUrl(s)`.

Empirically, the failure mode looks like:

- Model side only shows an `(image)` placeholder
- Model cannot see any image content / text

### Inbound ctx mapping (required fields)

The claweb channel should populate both **URL** and **file path** forms:

- URL form (kept for traceability and compatibility):
  - `MediaUrl`
  - `MediaUrls: [mediaUrl]`
- Type:
  - `MediaType`
  - `MediaTypes: [mediaType || "application/octet-stream"]`
- File form (to make the attachment readable to the model pipeline):
  - `MediaPath`
  - `MediaPaths: [mediaPath]`

### Best-effort hydration: download mediaUrl → MediaPath

Implementation strategy:

1. If inbound has `mediaUrl` and it is `http(s)`, fetch it server-side.
2. Write it to a temp file.
3. Inject `MediaPath/MediaPaths` along with `MediaUrl/MediaUrls`.

Current implementation lives in:

- `/src/inbound/build-ctx.ts`

## Smoke / acceptance checklist

Use this list to avoid regressions:

1. **Model can read image**
   - Send an image containing obvious text.
   - Ask the model to repeat the text (OCR) + describe the screenshot.
2. **Large image stability**
   - Send a 3–10MB photo.
   - UI does not stretch, sending succeeds.
3. **History replay**
   - Refresh/reopen.
   - Previously sent images still render (not degraded to placeholder text).
4. **Burst send**
   - Send 3–5 images in a row.
   - Ordering, dedupe, and pending statuses stay deterministic.

## Notes

- If `tools.media.image` (media understanding) is enabled, OpenClaw may also pre-digest images, but that is **optional**.
- This doc is about ensuring the model receives the **original attachment** reliably.
