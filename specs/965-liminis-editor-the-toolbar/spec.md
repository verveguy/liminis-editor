# Feature Specification: `@liminis/editor`'s toolbar create affordance is unreachable in a read-only editor

**Feature Branch**: `fabrik/issue-965`
**Created**: 2026-08-08
**Status**: Draft
**Input**: User description: "The `toolbar`-surfaced annotation create affordance (added in liminis#961) only renders when the editor is editable. `Toolbar.tsx` derives visibility exclusively from Lexical's `$getSelection()`/`SELECTION_CHANGE_COMMAND`, and Lexical does not report a range selection on a non-editable root, so the bar never appears there for any kind, on any surface — even though `AnnotationPlugin`'s anchor-capture path already works fine in read-only mode."

## Background

liminis#961 made the `toolbar`-surfaced annotation create affordance functional and generalized both the toolbar and context-menu dispatch paths over the configured kinds. That work was verified working — but only in the editable case.

`AnnotationPlugin` documents itself as *"Not gated on `editable`: annotating is decoupled from editing"*, and its anchor-capture mechanism does mutate the Lexical tree regardless of the `editable` flag. The plugin itself is ready for read-only use. What blocks it is purely the affordance's visibility: `Toolbar` (`packages/editor/src/app/editor/Toolbar.tsx`) computes `isVisible` exclusively from Lexical's own selection APIs —

```js
const selection = $getSelection();
if (!$isRangeSelection(selection)) { /* hide */ return }
if (selection.isCollapsed()) { /* hide */ return }
```

— driven by `SELECTION_CHANGE_COMMAND`. On a non-editable root, Lexical does not report a range selection at all, so `isVisible` never becomes true. `window.getSelection()` (the native browser selection) does return the selected text in both editable and non-editable cases — the selection is real either way, but `Toolbar` never looks at it.

Measured against the packed `12fe829` tarball, driving the real Electron app and reading the live DOM after a genuine double-click word selection:

| editor state | `.toolbar` in DOM | buttons |
|---|---|---|
| `contenteditable="false"` | **absent** | — |
| `contenteditable="true"` | present | `Bold, Italic, Strikethrough, Code, Link, Comment` |

This blocks a review-oriented consumer's primary use case. `verveguy/zusammen` (adopting this package as `verveguy/zusammen#102`) comments on read-only documents as its main mode — reviewing a document you are not editing is the product — so the affordance is unreachable in the case that matters most. `zusammen`'s pre-adoption `Toolbar.tsx` (deleted by its own #102, since this package was meant to replace it) already solved this: it drove visibility/position off the native selection specifically because "a double-click word-select (and native selection in read-only mode) doesn't reliably dispatch `SELECTION_CHANGE_COMMAND`," and it gated the rendered controls with `if (!editable && !commentingEnabled) return null` — hiding the (inert) formatting controls in read-only mode while still offering the create affordance.

That fork's comment also names a second, related defect that is **not** specific to read-only mode: a double-click word-selection does not reliably dispatch `SELECTION_CHANGE_COMMAND` even when the editor *is* editable, so a Lexical-command-only visibility path "shows the bar on drag but silently misses double-click." Fixing visibility by reading the native selection (with a `selectionchange` listener alongside the existing Lexical command) addresses both problems with the same change, and is the approach this issue asks for.

This is the sixth upstream gap found while adopting the package into `verveguy/zusammen`, after liminis#951/#952/#953/#954/#961, found immediately after pinning past #961 because the acceptance test written for that issue deliberately exercises the read-only path and still fails. Per that adoption issue's FR-013, the fix belongs here rather than being re-forked downstream.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an annotation from a read-only editor via the toolbar (Priority: P1)

A host renders the editor with `editable={false}` and a single annotation kind configured as `{ createAffordance: { surface: 'toolbar', label: 'Comment' } }`. A reviewer selects a range of text — either by click-and-drag or by double-clicking a word. The floating toolbar appears, offering only the "Comment" affordance (no formatting controls, since they would be inert on a read-only root). Invoking it fires `onCreateAnnotation` with a captured anchor, exactly as it already does on the editable path.

**Why this priority**: This is the entire subject of the issue and the specific capability blocking `zusammen`'s adoption. Reviewing (not editing) a document is that consumer's primary mode, so without this the affordance shipped in #961 is unreachable where it matters most.

**Independent Test**: Render the editor with `editable={false}` and a `toolbar`-surfaced kind, select text by drag, assert the toolbar renders with only the annotation affordance; separately select by double-click and assert the same. Invoke the affordance in each case and assert `onCreateAnnotation` fires with a captured anchor.

**Acceptance Scenarios**:

1. **Given** one kind configured as `{ createAffordance: { surface: 'toolbar', label: 'Comment' } }` and `editable={false}`, **When** the user selects text by click-and-drag, **Then** the toolbar appears and offers only the "Comment" affordance.
2. **Given** the same configuration, **When** the user selects text by double-click, **Then** the toolbar appears and offers only the "Comment" affordance (same outcome as drag-selection).
3. **Given** the toolbar is showing in either case, **When** the user invokes the "Comment" affordance, **Then** `onCreateAnnotation` fires with a captured anchor for the selected range.

---

### User Story 2 - No affordance configured means nothing renders in read-only mode (Priority: P2)

A host renders the editor with `editable={false}` and no annotation kind configured with `createAffordance.surface === 'toolbar'` (either no `annotationKinds` at all, or kinds that only use `contextMenu`). Selecting text produces no toolbar — there is nothing it could offer, since the formatting controls are inert on a read-only root and no create affordance applies to this surface.

**Why this priority**: Regression guard. Without it, driving visibility off the native selection could make an empty, useless bar (or one showing dead formatting buttons) appear on every read-only selection, which would be worse than today's "nothing renders" behavior.

**Independent Test**: Render the editor with `editable={false}` and no `toolbar`-surfaced kind, select text, and assert no `.toolbar` element appears in the DOM.

**Acceptance Scenarios**:

1. **Given** `editable={false}` and no configured kind has `createAffordance.surface === 'toolbar'`, **When** the user selects text, **Then** no toolbar renders.

---

### User Story 3 - Editable behavior is unchanged, including the double-click gap fix (Priority: P3)

A host renders the editor with `editable={true}` (today's default). Formatting controls and any `toolbar`-surfaced annotation affordances behave exactly as they do today, with one improvement: because visibility is now also driven by the native selection, a double-click word-selection reliably shows the toolbar, matching drag-selection — closing the gap the fork's comment identifies as present even in editable mode today.

**Why this priority**: Regression guard for the existing, working editable path, plus a latent same-root-cause bug fix that this issue's approach naturally resolves. Lower priority than Stories 1–2 because the editable path already mostly works; only the double-click corner case is new.

**Independent Test**: Render the editor with `editable={true}` and a mix of formatting and a `toolbar`-surfaced kind. Select by drag and assert the toolbar shows formatting controls plus the affordance, as today. Separately select by double-click and assert the toolbar also shows (this specific assertion is what distinguishes this from current behavior).

**Acceptance Scenarios**:

1. **Given** `editable={true}` (unchanged from today), **When** the user selects text by drag, **Then** the toolbar shows formatting controls plus any configured `toolbar`-surfaced affordances, as it does today.
2. **Given** the same configuration, **When** the user selects text by double-click, **Then** the toolbar also shows with the same contents as the drag case.

---

### Edge Cases

- **Selection outside the editor**: a native `selectionchange` event fires for selections made anywhere on the page, not just inside this editor instance. The toolbar MUST NOT appear for a selection that isn't inside this editor's root element.
- **Collapsed native selection**: a click (no drag) collapses the selection; the toolbar MUST NOT appear, matching today's behavior for collapsed Lexical selections.
- **Multiple `toolbar`-surfaced kinds, read-only**: if more than one configured kind has `createAffordance.surface === 'toolbar'`, the read-only toolbar offers one affordance button per such kind (same fan-out already established by #961 for the editable case).
- **Selection changes while the toolbar is visible**: existing dismiss-on-outside-click and hide-on-collapse behavior continues to apply, now driven by the same native-selection signal.
- **`editable` toggles at runtime**: if a host flips `editable` while a selection is active, the toolbar's contents (formatting controls present or absent) must reflect the current `editable` value the next time it's shown.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Toolbar visibility and position MUST be computed from the current native browser selection (`window.getSelection()`/`selectionchange`), not exclusively from Lexical's `$getSelection()`/`SELECTION_CHANGE_COMMAND`, so that a non-editable root and a double-click word-selection both make the toolbar appear.
- **FR-002**: The toolbar's visibility update MUST continue to respond to Lexical's `SELECTION_CHANGE_COMMAND` (existing signal) in addition to native `selectionchange` events (new signal) — both trigger the same visibility/position computation.
- **FR-003**: The toolbar MUST NOT appear for a native selection that falls outside the editor's own root DOM element.
- **FR-004**: When `editable={false}`, the toolbar MUST NOT render the formatting controls (Bold, Italic, Strikethrough, Code, Link) — they would be inert on a read-only root.
- **FR-005**: When `editable={false}`, the toolbar MUST render one affordance button for each configured annotation kind whose `createAffordance.surface === 'toolbar'`, using the same label-resolution rule already established by #961 (kind's `createAffordance.label`, falling back to the kind name).
- **FR-006**: When `editable={false}` and no configured kind has `createAffordance.surface === 'toolbar'`, the toolbar MUST NOT render at all for any selection — there is nothing it could offer.
- **FR-007**: Invoking a toolbar affordance in a read-only editor MUST dispatch `OPEN_ANNOTATION_COMPOSER_COMMAND` with that kind's name, identically to the existing editable-path dispatch, and MUST result in `onCreateAnnotation` firing with a captured anchor — unchanged from `AnnotationPlugin`'s existing, `editable`-independent capture behavior.
- **FR-008**: When `editable={true}`, toolbar contents and behavior MUST be unchanged from current behavior (formatting controls plus any configured `toolbar`-surfaced affordances) — except that visibility now also reacts to native `selectionchange`, so a double-click selection additionally makes the toolbar appear (previously true only for drag-selections, per FR-001/FR-002).
- **FR-009**: A non-collapsed selection MUST be required for the toolbar to appear, whether detected via the native selection or via Lexical's selection — a collapsed selection (a plain click) MUST NOT show the toolbar, in both editable and read-only modes.

### Key Entities

- **Toolbar visibility/position state**: Existing internal state in `Toolbar.tsx`; this issue changes its input source (native selection, in addition to Lexical's) but not its shape or downstream consumers.
- **`ToolbarAnnotationAffordance`** (`{ kind: string; label: string }`): Existing entity from #961, unchanged shape — this issue changes when it's rendered (now also in read-only mode), not what it contains.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With one kind configured as `{ createAffordance: { surface: 'toolbar', label: 'Comment' } }` and `editable={false}`, selecting text by drag shows the toolbar with only the "Comment" affordance, and invoking it fires `onCreateAnnotation` with a captured anchor.
- **SC-002**: The same flow in SC-001 succeeds identically when the selection is made by double-click instead of drag.
- **SC-003**: With `editable={false}` and no `toolbar`-surfaced kind configured, no toolbar renders for any selection.
- **SC-004**: With `editable={true}`, formatting controls plus configured affordances render on drag-selection exactly as they do today (no regression).
- **SC-005**: With `editable={true}`, a double-click selection also shows the toolbar (closing the gap present today, where only drag reliably did).
- **SC-006**: An automated test exercises the read-only path specifically (`editable={false}`, selection, affordance invocation, `onCreateAnnotation`) — distinct from the existing editable-only test, since an editable-only test cannot witness this bug.

## Assumptions

- The formatting-control active states (bold/italic/strikethrough/code/link highlighting) continue to be sourced from Lexical's selection when the controls are shown (i.e., when `editable={true}`); this issue does not change how those specific flags are computed, only how the bar's overall visibility and position are triggered.
- The "native selection" signal is scoped to selections whose anchor falls within the editor's own root DOM element (see Edge Cases); a `selectionchange` fired for a selection elsewhere on the host page must not show this editor's toolbar.
- No changes to `AnnotationPlugin`'s anchor-capture mechanism, id-minting, or the `onCreateAnnotation` event contract are required — this issue is only about making the already-`editable`-independent capture path reachable through the toolbar's visibility gate.
- Visual placement/styling of the read-only toolbar (button order, dividers) follows the existing conventions already established in `Toolbar.tsx` for the editable case; no new visual design is introduced.
- `contextMenu`-surfaced affordances (`SelectionContextMenuPlugin`) are unaffected — the issue's reproduction and ask are both scoped to the `toolbar` surface only.

## Out of Scope

- Any change to the `contextMenu` surface or `SelectionContextMenuPlugin` — not implicated by this issue's reproduction.
- Any change to `AnnotationPlugin`'s anchor-capture mechanism, anchor model, or `onCreateAnnotation` event shape.
- New `createAffordance.surface` values beyond the two that already exist (`toolbar`, `contextMenu`).
- Visual redesign of the floating selection toolbar beyond conditionally omitting the formatting controls.
- Any change to how formatting-control active-state flags (bold/italic/etc.) are computed while editable.

## Source References

- `packages/editor/src/app/editor/Toolbar.tsx` — computes `isVisible` exclusively from Lexical's `$getSelection()`/`SELECTION_CHANGE_COMMAND`; the file this issue's fix targets.
- `packages/editor/src/app/editor/AnnotationPlugin.tsx` — anchor-capture path, already documented as not gated on `editable`.
- `packages/editor/src/app/editor/Editor.tsx` — wires `<Toolbar annotationAffordances={toolbarAnnotationAffordances} />` (line ~841) but does not currently pass `editable` through to it; also owns `EditablePlugin`, which calls `editor.setEditable(editable)`.
- `packages/editor/src/app/editor/annotationCommands.ts` — `OPEN_ANNOTATION_COMPOSER_COMMAND`, read against the live selection at dispatch time.
- `packages/editor/src/app/editor/__tests__/toolbar-annotation-create.test.tsx` — existing end-to-end toolbar-affordance test (editable-only today); pattern to extend for the read-only path (SC-006).
- Prior art: `verveguy/zusammen`'s pre-adoption `Toolbar.tsx` (deleted by `verveguy/zusammen#102`), which already drove visibility off the native selection for the same reason.
- Predecessor issue: liminis#961 (added the toolbar affordance in the editable-only case).
- Related upstream gaps from the same adoption effort: liminis#951/#952/#953/#954.
- Downstream consumer: `verveguy/zusammen#102`, whose #961-derived acceptance test exercises the read-only path and surfaced this gap.
