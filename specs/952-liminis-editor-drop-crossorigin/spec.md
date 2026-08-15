# Feature Specification: Drop `crossOrigin="anonymous"` from remote image rendering

**Feature Branch**: `fabrik/issue-952`
**Created**: 2026-08-06
**Status**: Draft
**Input**: User description: "`packages/editor`'s `ImageComponent` sets `crossOrigin={isAbsoluteUrl(displaySrc) && !displaySrc.startsWith('data:') ? 'anonymous' : undefined}` on the rendered `<img>`. For any host that does not return `Access-Control-Allow-Origin`, a CORS-enabled fetch fails and the browser renders nothing — the image does not merely lose canvas-readability, it fails to display at all. This affects CI badges (shields.io and friends) and a large fraction of ordinary image hosts. Zusammen removed this attribute in its fork (verveguy/zusammen#78) for exactly this reason, and it is one of four upstream gaps blocking Zusammen's adoption of the package (verveguy/zusammen#102). Ask: Remove the crossOrigin attribute from remote image rendering. If some feature genuinely requires a CORS-enabled fetch (canvas read-back for copy-image, for instance), scope the tainted-canvas handling to that operation and let it fail gracefully there, rather than making every remote image's display conditional on the host's CORS policy."

## Background

`ImageComponent` (`packages/editor/src/app/editor/nodes/ImageComponent.tsx`) renders every image in a document — local assets, relative paths, and remote URLs — through a single `<img>` element. For any `src` that resolves to an absolute, non-`data:` URL, the component currently sets `crossOrigin="anonymous"` unconditionally:

```tsx
crossOrigin={isAbsoluteUrl(displaySrc) && !displaySrc.startsWith('data:') ? 'anonymous' : undefined}
```

Setting `crossOrigin="anonymous"` forces the browser to fetch the image as a CORS request. If the remote host doesn't respond with an `Access-Control-Allow-Origin` header permitting the request, the browser aborts the load entirely and renders nothing — not a degraded image, no image at all. Many ordinary image hosts (including CI badge services like shields.io) don't send permissive CORS headers, so any document embedding those images shows broken image placeholders.

The `crossOrigin` attribute only matters for one thing in this codebase: it lets a `<canvas>` that later draws the image stay "untainted," which is a prerequisite for reading pixel data back out (e.g., via `canvas.toBlob()`). That capability is used by exactly one feature — the image context menu's "Copy image to clipboard" action (`handleCopyImage` in `ImageComponent.tsx`), which draws the rendered `<img>` onto an offscreen canvas and calls `canvas.toBlob()` to produce a PNG for `navigator.clipboard.write()`. Today, that action silently fails (only a `console.error`, no user-visible feedback) if the canvas ends up tainted.

Applying the CORS requirement to *every* remote image's display, just to support a canvas read-back needed by one optional action, is backwards: it breaks the common case (viewing an image) to protect an uncommon one (copying an image to the clipboard). This issue flips that: images should display regardless of host CORS support, and any canvas-based operation that needs an untainted canvas should handle that constraint locally, without blocking display.

This is one of four small upstream gaps blocking `verveguy/zusammen`'s adoption of `@liminis/editor` as a package dependency (tracked in verveguy/zusammen#102); Zusammen already carries a local fork removing this same attribute (verveguy/zusammen#78).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Remote images without CORS headers display normally (Priority: P1)

A user embeds a remote image (e.g., a shields.io CI badge, or a link to an image on an ordinary website) in a document. The host does not send `Access-Control-Allow-Origin`.

**Why this priority**: This is the core bug. Images that should simply display are currently invisible, which is a visible, everyday breakage affecting a large fraction of remote image hosts.

**Independent Test**: Render `ImageComponent` with a `src` pointing at a URL from a non-CORS-enabled host (or a mocked `<img>` load) and confirm the image element renders without a `crossOrigin` attribute and without depending on a CORS-permitting response.

**Acceptance Scenarios**:

1. **Given** a document containing a remote image `src` whose host does not return `Access-Control-Allow-Origin`, **When** the document is rendered, **Then** the image displays normally (no broken-image placeholder, no failed load).
2. **Given** a document containing a remote image `src` whose host *does* return permissive CORS headers, **When** the document is rendered, **Then** the image displays normally (no regression for CORS-friendly hosts).

---

### User Story 2 - Local and data-URL images are unaffected (Priority: P1)

A user embeds a local/relative asset or a `data:` URL image.

**Why this priority**: The fix must not regress the (already-working) local-asset and inline-data-URL rendering paths, since those never depended on `crossOrigin` in the first place.

**Independent Test**: Render `ImageComponent` with a relative asset path and separately with a `data:` URL and confirm both display exactly as before this change (byte-for-byte same rendering behavior).

**Acceptance Scenarios**:

1. **Given** a relative/local image path resolved via the asset context, **When** the document is rendered, **Then** the image displays exactly as it did before this change.
2. **Given** a `data:` URL image, **When** the document is rendered, **Then** the image displays exactly as it did before this change.

---

### User Story 3 - Copy-image-to-clipboard fails visibly instead of silently, for images it can no longer read back (Priority: P2)

A user right-clicks a remote (cross-origin) image and chooses "Copy image to clipboard." Because the display `<img>` no longer requests CORS mode, the browser will treat the canvas the copy action draws onto as tainted for any image whose origin differs from the app's, regardless of whether the host actually supports CORS — so this action can no longer succeed for such images via the current canvas-draw approach.

**Why this priority**: This is a real behavior change introduced by the fix, not the primary bug, but the issue explicitly requires it not regress into a silent no-op. It's lower priority than the display fix itself but must not be dropped.

**Independent Test**: Trigger "Copy image to clipboard" on a cross-origin remote image in a test environment and confirm the user receives a visible failure indication (not just a console log), or confirm the copy still succeeds if the implementation chooses to scope a separate CORS-enabled fetch to this action specifically.

**Acceptance Scenarios**:

1. **Given** a remote (cross-origin) image, **When** the user chooses "Copy image to clipboard" and the canvas read-back fails (tainted canvas), **Then** the failure is surfaced to the user through the UI (e.g., a toast/notification), not just logged to the console.
2. **Given** a local asset or `data:`-URL image, **When** the user chooses "Copy image to clipboard," **Then** the action continues to succeed exactly as before (these sources never taint the canvas).
3. **Given** the implementation instead chooses to scope a CORS-enabled fetch to just the copy operation (e.g., fetching the image data separately for canvas use), **When** the user copies a remote image from a CORS-friendly host, **Then** the copy succeeds; **When** the host doesn't support CORS, **Then** the failure is surfaced to the user through the UI.

---

### Edge Cases

- Images whose `src` changes from a local/relative path to a remote URL (or vice versa) at runtime must not retain a stale `crossOrigin` attribute or stale load state.
- `blob:` and `vscode-webview-resource:` URLs are treated as "absolute" by the existing `isAbsoluteUrl()` check; confirm they are unaffected by this change (they don't currently receive `crossOrigin` either, since only non-`data:` absolute URLs did before — actually they *did* receive `crossOrigin="anonymous"` before this fix, since `isAbsoluteUrl()` returns true for them and they don't start with `data:`). Verify neither display nor copy-image behavior regresses for these schemes after the fix.
- The diagram "Copy image to clipboard" action for C4/Mermaid diagrams (`copyDiagramToClipboard` in `diagram-context-menu.ts`) renders an SVG to canvas via a data URL and does not depend on the `<img>` `crossOrigin` attribute at all — it is unaffected by this change and out of scope.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `ImageComponent` MUST NOT set a `crossOrigin` attribute on the rendered `<img>` element for the purpose of enabling display of remote images.
- **FR-002**: A remote (absolute, non-`data:` URL) image MUST display successfully regardless of whether its host sends `Access-Control-Allow-Origin`.
- **FR-003**: Local/relative asset images and `data:` URL images MUST render identically to their current (pre-fix) behavior.
- **FR-004**: The "Copy image to clipboard" action MUST NOT silently no-op when it cannot read back a remote image's pixel data. On failure, it MUST surface a user-visible error indication (not solely a `console.error`).
- **FR-005**: The "Copy image to clipboard" action MUST continue to work for local assets and `data:` URL images without regression.
- **FR-006**: The chosen behavior for remote-image copy (still works via a separately-scoped CORS-enabled fetch, or fails with a surfaced error) MUST be covered by an automated test or explicitly documented in code comments/PR description.

### Key Entities

- **`ImageComponent`**: React component rendering a single image node (`packages/editor/src/app/editor/nodes/ImageComponent.tsx`); owns the `<img>` element, its `crossOrigin` attribute, and the "Copy image to clipboard" context-menu action.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A remote image on a host that sends no `Access-Control-Allow-Origin` (e.g., a shields.io badge) renders visibly in the editor, where it previously failed to render.
- **SC-002**: Local, relative, and `data:` URL images render with no observable behavior change compared to before this fix.
- **SC-003**: Attempting to copy a remote image to the clipboard never fails silently — it either completes successfully or produces a user-visible error — verified by an automated test.

## Assumptions

- "Renders" means the browser successfully paints the image (no broken-image icon, no failed network/load event) — this is testable via the `<img>` element's load/error events in a test environment, without requiring a live network fetch against a real non-CORS host.
- The scope of "remote image rendering" is the `<img crossOrigin>` attribute specifically; no other CORS-related behavior in the editor package (e.g., diagram SVG-to-canvas copy, asset resolution for local files) is affected in scope per the Edge Cases above.
- How the "Copy image to clipboard" failure is surfaced (toast, inline banner, etc.) is left to the Plan/Implement stages to match existing UI patterns in this codebase; this spec only requires that it be user-visible and not a silent no-op.
- Whether to preserve copy-to-clipboard functionality for CORS-friendly remote hosts (by scoping a separate CORS-enabled fetch to just that action) versus always failing gracefully for all remote images is an implementation choice left to Research/Plan, per the original issue's own phrasing ("it either still works or fails with a surfaced error").

## Out of Scope

- The diagram "Copy image to clipboard" action for C4/Mermaid diagrams (`copyDiagramToClipboard` in `packages/editor/src/app/editor/nodes/diagram-context-menu.ts`) — it does not use the `<img>` `crossOrigin` attribute and is unaffected.
- Any change to how local/relative assets are resolved (`resolveAssetPath`, `resolveLocalAsset` in `AssetContext`).
- Broader CORS or Content-Security-Policy configuration outside this component.

## Source References

- `packages/editor/src/app/editor/nodes/ImageComponent.tsx` — `crossOrigin` attribute (line ~278) and `handleCopyImage` canvas read-back (lines ~79-117).
- `packages/editor/src/app/editor/nodes/diagram-context-menu.ts` — unrelated SVG-to-canvas copy path, referenced for scope clarification only.
- verveguy/zusammen#78 — upstream fork removing this attribute.
- verveguy/zusammen#102 — parent issue tracking this as one of four upstream gaps.
