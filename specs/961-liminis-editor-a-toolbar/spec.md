# Feature Specification: `toolbar`-surfaced annotation kinds have no affordance and cannot be created

**Feature Branch**: `fabrik/issue-961`
**Created**: 2026-08-08
**Status**: Draft
**Input**: User description: "`@liminis/editor`'s annotation mechanism supports `createAffordance: { surface: 'toolbar', label: 'Comment' }`, and both `README.md` and `docs/annotations.md` use exactly that config as *the* example of turning user-initiated annotation creation on. Nothing renders it."

## Background

`@liminis/editor`'s annotation mechanism is documented as kind-agnostic: a host configures a named kind (`comment`, `correction`, or anything else) with a `createAffordance` telling the package where to offer user-initiated creation — `toolbar` or `contextMenu`. Both `README.md` and `docs/annotations.md` use a `toolbar`-surfaced `comment` kind as *the* canonical example of turning creation on.

In practice, that example does not work:

- `Toolbar` (`packages/editor/src/app/editor/Toolbar.tsx`) renders five fixed buttons — Bold, Italic, Strikethrough, Code, Link — with no reference to annotations at all.
- The string `'toolbar'` appears nowhere in the package's runtime code, only in the `AnnotationCreateAffordance` type. `createAffordance` is read in exactly one runtime place, `AnnotationPlugin`'s command handler, purely as a permission gate (`if (!config.createAffordance) … return false`).
- The only dispatcher of `OPEN_ANNOTATION_COMPOSER_COMMAND` is `SelectionContextMenuPlugin`, and it is hardcoded to `{ kind: 'correction' }`, gated on `annotationKinds?.correction?.createAffordance?.surface === 'contextMenu'` in `Editor.tsx`.

The net effect: a `contextMenu`-surfaced kind literally named `correction` can be created. No `toolbar`-surfaced kind of any name can be, and no `contextMenu`-surfaced kind under any other name can be either. `onCreateAnnotation` — documented as "Fires when a user creates an annotation via a kind's create affordance" — is unreachable for both of those cases.

There is also no host-side workaround. `OPEN_ANNOTATION_COMPOSER_COMMAND` is exported from the root entry point specifically "so a toolbar or context menu can trigger creation," but dispatching a Lexical command requires the editor instance, and neither `App` nor `Editor` exposes a plugin slot or ref a consumer could use to dispatch it externally. A consumer can configure the affordance and has no route to reach it.

**Impact**: This blocks `verveguy/zusammen`'s adoption of the package (`verveguy/zusammen#102`). Commenting on a passage — a reviewer selects text and comments on it — is Zusammen's core capability. Post-adoption, that capability is gone: document-level comments and already-anchored marks still work, but no new anchored comment can be started. The fork this adoption is meant to delete had this button in its own toolbar (`aria-label="Comment"`, dispatching its own `OPEN_COMMENT_COMPOSER_COMMAND`), so this is a regression relative to what Zusammen already has today, not a new capability being requested.

This is the fifth upstream gap found while adopting the package into `verveguy/zusammen`, after liminis#951/#952/#953/#954. It was found at that repo's Review stage — its whole test suite was green while this was broken, because its e2e coverage exercised only the document-level comment path, never the selection composer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an annotation via a toolbar-surfaced kind (Priority: P1)

A host configures a single annotation kind with `createAffordance: { surface: 'toolbar', label: 'Comment' }` and no `correction` kind. A user (editing or read-only) selects a range of text. The editor's selection toolbar offers a "Comment" affordance alongside (or instead of, if no formatting toolbar would otherwise show) the existing formatting controls. Invoking it captures the anchor for the current selection and fires `onCreateAnnotation` with the minted id, the captured anchor, and the on-screen selection rect — the same contract `AnnotationPlugin` already provides for the `contextMenu` path.

**Why this priority**: This is the entire subject of the issue and the specific capability blocking Zusammen's adoption. Without it, the package's documented flagship example does not work for any consumer.

**Independent Test**: Render `Editor` with `annotationKinds` containing only a `toolbar`-surfaced kind (no `correction` kind), make a text selection, invoke the rendered affordance, and assert `onCreateAnnotation` fires with the expected shape.

**Acceptance Scenarios**:

1. **Given** a single kind configured as `{ markerStyle: 'highlight', createAffordance: { surface: 'toolbar', label: 'Comment' }, retainMarkOnCreate: true }` and no `correction` kind, **When** the user selects a range of text, **Then** a "Comment" affordance is offered.
2. **Given** that affordance is showing, **When** the user invokes it, **Then** `onCreateAnnotation` fires exactly once with the minted id, the captured anchor, and the selection rect.
3. **Given** the same configuration, **When** the editor is in read-only mode (`editable={false}`), **Then** the affordance still appears and still fires `onCreateAnnotation` on invocation — annotating is decoupled from editing, matching `AnnotationPlugin`'s existing behavior on the `contextMenu` path.

---

### User Story 2 - Create an annotation via a contextMenu-surfaced kind under any name (Priority: P2)

A host configures a kind named something other than `correction` with `createAffordance: { surface: 'contextMenu', label: '…' }`. Right-clicking a text selection offers that kind's entry in the context menu (not a hardcoded "Correction…" entry tied to the literal name `correction`), and invoking it fires `onCreateAnnotation` for that kind.

**Why this priority**: Same root cause as Story 1 — `SelectionContextMenuPlugin` hardcodes `kind: 'correction'` and `Editor.tsx` gates on the `correction` key by name, so today only a kind literally named `correction` is reachable on this surface. This is lower priority than Story 1 because a `contextMenu`-surfaced `correction` kind already works today; this story generalizes an existing working path rather than opening a fully blocked one.

**Independent Test**: Render `Editor` with `annotationKinds` containing a `contextMenu`-surfaced kind named e.g. `note` (no `correction` kind), right-click a text selection, invoke the menu entry, and assert `onCreateAnnotation` fires with `kind: 'note'`.

**Acceptance Scenarios**:

1. **Given** a kind named `note` (not `correction`) configured with `createAffordance: { surface: 'contextMenu', label: 'Note…' }`, **When** the user right-clicks a text selection, **Then** the context menu offers a "Note…" entry.
2. **Given** that entry is showing, **When** the user invokes it, **Then** `onCreateAnnotation` fires with `kind: 'note'` and the captured anchor.
3. **Given** `liminis-app`'s existing `correction` kind (`contextMenu` surface, unchanged config), **When** the user right-clicks a text selection, **Then** the "Correction…" entry still appears and still works exactly as it does today — generalizing away from the hardcoded name must not regress the one path that already works.

---

### User Story 3 - No configured kind means no affordance and no dispatch (Priority: P3)

A host renders `Editor` without `annotationKinds` (or with an empty object). No toolbar annotation affordance and no context-menu annotation entry render anywhere, and `OPEN_ANNOTATION_COMPOSER_COMMAND` is never dispatched — behavior is unchanged from today.

**Why this priority**: This is a regression guard, not new capability — it protects the existing "annotations are entirely opt-in" contract (`FR-004` in the package's own docs) while the toolbar and context-menu paths are generalized.

**Independent Test**: Render `Editor` with no `annotationKinds`, select text, right-click, and assert neither affordance renders and the command is never dispatched.

**Acceptance Scenarios**:

1. **Given** no `annotationKinds` prop (or an empty object), **When** the user selects text, **Then** no annotation affordance appears in the toolbar.
2. **Given** the same configuration, **When** the user right-clicks a text selection, **Then** the context menu shows no annotation entry.

---

### Edge Cases

- `createAffordance.label` is optional on the type (`AnnotationCreateAffordance.label?: string`). When omitted, the affordance's visible text and accessible label fall back to the kind name, consistent with how `AnnotationPresentation.label`'s doc comment already describes marker labels falling back to the kind name (see Assumptions).
- More than one configured kind has `createAffordance.surface === 'toolbar'`: each such kind gets its own toolbar affordance.
- More than one configured kind has `createAffordance.surface === 'contextMenu'`: each such kind gets its own context-menu entry, each dispatching with its own kind name.
- A selection collapses or changes while a toolbar affordance is visible: existing toolbar dismiss/hide behavior applies unchanged (no new state to reconcile).
- The editor is read-only (`editable={false}`): both affordances remain available, per `AnnotationPlugin`'s existing, deliberate decision not to gate annotation creation on `editable`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The editor's selection toolbar MUST render an affordance for every configured annotation kind whose `createAffordance.surface` is `'toolbar'`, shown when a non-collapsed text selection is active.
- **FR-002**: Invoking a toolbar-surfaced kind's affordance MUST dispatch `OPEN_ANNOTATION_COMPOSER_COMMAND` with that kind's name, using the current text selection.
- **FR-003**: A toolbar or context-menu affordance's visible text and accessible label (`aria-label`) MUST use the kind's `createAffordance.label` when provided, and fall back to the kind name when `label` is omitted.
- **FR-004**: `SelectionContextMenuPlugin` MUST dispatch `OPEN_ANNOTATION_COMPOSER_COMMAND` with the actual kind name of whichever configured kind has `createAffordance.surface === 'contextMenu'`, rather than the hardcoded literal `'correction'`.
- **FR-005**: The gate that decides whether the context-menu annotation entry is offered at all MUST scan all configured `annotationKinds` for one whose `createAffordance.surface === 'contextMenu'`, rather than checking only the value at the `correction` key by name.
- **FR-006**: Both the toolbar and context-menu annotation affordances MUST be available when the editor is read-only (`editable={false}`), matching `AnnotationPlugin`'s existing decoupling of annotation creation from `editable`.
- **FR-007**: When no annotation kind is configured (`annotationKinds` absent or empty), neither affordance MUST render, and `OPEN_ANNOTATION_COMPOSER_COMMAND` MUST never be dispatched — unchanged from current behavior.
- **FR-008**: Invoking either affordance MUST result in `onCreateAnnotation` firing with the minted id, the captured anchor (or `null` if the selection didn't resolve to real content), and the on-screen selection rect — the same event shape `AnnotationPlugin` already produces.
- **FR-009**: If more than one configured kind has `createAffordance.surface === 'toolbar'`, the toolbar MUST offer one affordance per such kind.
- **FR-010**: If more than one configured kind has `createAffordance.surface === 'contextMenu'`, the context menu MUST offer one entry per such kind.
- **FR-011**: The existing `correction`-kind context-menu behavior used by `liminis-app` today (unchanged configuration) MUST continue to work identically after `SelectionContextMenuPlugin` and `Editor.tsx`'s gate are generalized to be kind-agnostic.

### Key Entities

- **Annotation kind configuration (`AnnotationKindConfig`)**: Existing entity, unchanged shape. `createAffordance: { surface: 'toolbar' | 'contextMenu', label?: string } | null` is the field this issue makes functional; no new fields are introduced.
- **`AnnotationCreateEvent`**: Existing entity (`kind`, `id`, `anchor`, `rect`), unchanged shape — this issue makes it reachable via new dispatch paths, not new fields.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With a single kind configured as `{ markerStyle: 'highlight', createAffordance: { surface: 'toolbar', label: 'Comment' }, retainMarkOnCreate: true }` and no `correction` kind, selecting text offers that affordance, and invoking it fires `onCreateAnnotation` exactly once with the minted id, the captured anchor, and the selection rect.
- **SC-002**: The same flow in SC-001 succeeds identically when `editable={false}`.
- **SC-003**: A kind named something other than `correction`, configured with `createAffordance.surface: 'contextMenu'`, is reachable via the context menu and fires `onCreateAnnotation` with that kind's own name.
- **SC-004**: With no `annotationKinds` configured, no toolbar annotation affordance and no context-menu annotation entry render, and `OPEN_ANNOTATION_COMPOSER_COMMAND` is never dispatched.
- **SC-005**: `liminis-app`'s existing `correction` kind (`contextMenu` surface) continues to work unchanged after the generalization.
- **SC-006**: An automated test exercises the toolbar path end-to-end — configuration → selection → affordance invocation → `onCreateAnnotation` — independent of the context-menu path.

## Assumptions

- When `createAffordance.label` is omitted, both the toolbar affordance and the context-menu entry fall back to displaying the kind name, matching the fallback convention already documented for `AnnotationPresentation.label` ("falls back to the kind name").
- The exact visual placement of the new toolbar affordance(s) relative to the existing Bold/Italic/Strikethrough/Code/Link buttons is not prescribed by this spec; it is an implementation decision for the Research/Plan stages.
- The new toolbar affordance(s) follow the existing visual conventions of `Toolbar.tsx` (its `toolbar-button` styling and structure) rather than introducing a new design pattern.
- No changes to `AnnotationPlugin`'s capture mechanism, anchor model, id-minting, or the `onCreateAnnotation` event contract are required — this issue is only about adding/generalizing the dispatch entry points that reach the mechanism that already exists.
- The host-side workaround gap described in the issue (no plugin slot or ref to dispatch `OPEN_ANNOTATION_COMPOSER_COMMAND` externally) is resolved by making the toolbar affordance dispatch the command internally; no new exported ref or imperative API is assumed to be necessary, but Research may determine otherwise if a host still needs external dispatch for a case this spec doesn't cover.
- "Toolbar" in this spec refers to the existing floating selection toolbar (`Toolbar.tsx`), which shows only when a non-collapsed text selection is active — not a persistent, always-visible top-level toolbar. The issue's own reproduction ("no `.toolbar` element is in the DOM" after a selection) confirms this is the selection-triggered toolbar already in the package.

## Out of Scope

- Any new `createAffordance.surface` values beyond the two that already exist (`toolbar`, `contextMenu`).
- Visual redesign of the floating selection toolbar.
- A picker UI for the case where a user might want to choose among multiple toolbar-surfaced kinds for the same selection — each configured kind simply gets its own affordance (FR-009).
- Annotation persistence, composer UI, or storage — unchanged, host-owned per the package's existing architecture (`ADR-075`/`FR-005`: the package never persists anything).
- Any behavioral change to `CorrectionPanelPlugin`, `useCorrectionStore`, or other correction-specific UI beyond generalizing the dispatch/gate to be kind-agnostic (FR-004, FR-005, FR-011).
- A host-side plugin-slot or ref API for dispatching `OPEN_ANNOTATION_COMPOSER_COMMAND` from outside the package (see Assumptions — believed unnecessary once the toolbar affordance exists, but not itself the fix being specified here).

## Source References

- `packages/editor/src/app/editor/Toolbar.tsx` — the floating selection toolbar; renders no annotation affordance today.
- `packages/editor/src/app/editor/AnnotationPlugin.tsx` — owns the `OPEN_ANNOTATION_COMPOSER_COMMAND` handler, anchor capture, and `onCreateAnnotation` dispatch; already surface-agnostic internally.
- `packages/editor/src/app/editor/SelectionContextMenuPlugin.tsx` — the only current dispatcher of the command, hardcoded to `kind: 'correction'`.
- `packages/editor/src/app/editor/Editor.tsx` — wires `correctionKindEnabled` by checking `annotationKinds?.correction?.createAffordance?.surface === 'contextMenu'` specifically.
- `packages/editor/src/annotations/types.ts` — `AnnotationCreateAffordance`, `AnnotationKindConfig`, `AnnotationCreateEvent` type definitions.
- `packages/editor/README.md` and `packages/editor/docs/annotations.md` — both document the `toolbar`-surfaced example that this issue makes functional.
- `packages/editor/src/app/editor/__tests__/selection-context-menu-selection.test.tsx`, `packages/editor/src/app/editor/__tests__/annotation-plugins.test.tsx` — existing test coverage patterns for the context-menu path, to be mirrored for the new toolbar path (SC-006).
- Related upstream gaps from the same adoption effort: liminis#951, #952, #953, #954.
- Downstream consumer: `verveguy/zusammen#102`.
