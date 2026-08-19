# Feature Specification: Forward the Full Consumer-Facing Editor Surface Through `<App>`, With a Guard Against Future Gaps

**Feature Branch**: `fabrik/issue-80`
**Created**: 2026-08-19
**Status**: Specified
**Input**: User description: "Most consumers embed the package via `<App>`, not `<Editor>` directly (Zusammen mounts `App`). `App` forwards a curated subset of `EditorProps` to its inner `<Editor>`. Issue #69 added `documentOutlineHandle` to `<Editor>` but not to `App`, so `<App>` consumers cannot wire the document outline at all — the capability is exported but unreachable for them. This is a class of bug, not one prop: any consumer-facing `<Editor>` capability that `App` doesn't forward is silently invisible to `<App>` consumers, and gets discovered one prop at a time. Fix the class: forward the whole consumer-facing surface, and add a guard so it can't recur."

## Background

Most consumers of `@liminis/editor` embed the package via `<App>`, not `<Editor>` directly — Zusammen, the primary downstream consumer, mounts `App`. `App` wraps `<Editor>` and forwards a curated subset of `EditorProps` as `AppProps`.

Issue #69 added `documentOutlineHandle` to `EditorProps`, giving `<Editor>` consumers a way to wire up a document outline. It did not add the same prop to `AppProps`, so `<App>` consumers have no way to reach that capability — it is exported from the package but structurally unreachable through the component most consumers actually use.

This is not a one-off oversight. `App`'s forwarding list is maintained by hand, so any future consumer-facing prop added to `EditorProps` will be silently invisible to `<App>` consumers unless someone remembers to also add it to `AppProps` — a class of bug that gets discovered one prop at a time, as it just was for the outline. This issue fixes the class: it audits and closes the current gap, and adds a guard so a new gap fails CI instead of shipping silently.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reach the document outline through `<App>` (Priority: P1)

As an `<App>` consumer, I want to pass `documentOutlineHandle` to `<App>` and have it reach the inner `<Editor>`, so I can render a working outline without forking down to `<Editor>` directly.

**Why this priority**: This is the concrete, currently-broken capability that motivated the issue, and it unblocks a downstream consumer (Zusammen) that is waiting on it.

**Independent Test**: Mount `<App documentOutlineHandle={handle}>` alongside a sibling `<DocumentOutline handle={handle}>`, load a document with headings, and confirm the outline populates and scrolling to an entry works — with no direct use of `<Editor>`.

**Acceptance Scenarios**:

1. **Given** an `<App>` with `documentOutlineHandle` supplied, **When** it mounts, **Then** the outline plugin runs and a sibling `<DocumentOutline handle={…}>` shows the document's headings.
2. **Given** the outline is showing, **When** an entry is clicked, **Then** the editor scrolls to the corresponding heading.

---

### User Story 2 - Reach every consumer-facing editor capability through `<App>` (Priority: P2)

As a maintainer, I want every consumer-facing member of `EditorProps` to be reachable through `AppProps` (or explicitly documented as App-internal), so `<App>` consumers are never missing a capability that `<Editor>` consumers have without anyone deciding that on purpose.

**Why this priority**: Fixes the class of bug, not just the one prop from User Story 1. Depends on User Story 1's forwarding pattern but extends it to the full prop surface.

**Independent Test**: Diff the members of `EditorProps` against `AppProps`. For every member present in `EditorProps` but absent from `AppProps`, confirm it is either (a) forwarded in this change, or (b) present in the explicit list of intentionally-internalized props with a stated reason.

**Acceptance Scenarios**:

1. **Given** the full list of `EditorProps` members, **When** each is classified, **Then** every consumer-facing one is forwarded by `AppProps` and every App-internal one is recorded as such with a reason.
2. **Given** an `EditorProps` member sourced from IPC or App's own internal state (e.g. current content/cursor bookkeeping), **When** it is classified as App-internal, **Then** it is not forwarded, and the reason it can't be a plain pass-through is recorded.

---

### User Story 3 - No future silent forwarding gaps (Priority: P3)

As a maintainer, I want CI to fail when a new consumer-facing `EditorProps` member is added without being forwarded on `AppProps` (or explicitly marked internal), so this class of bug can't recur silently.

**Why this priority**: Lower priority than closing the current gap, but it's the difference between a one-time fix and actually fixing the class of bug described in the Background.

**Independent Test**: Add a new member to `EditorProps` without adding it to `AppProps` or the internal-props allowlist; run the test suite; confirm it fails with a message identifying the unclassified member. Add it to either side; confirm the suite passes again.

**Acceptance Scenarios**:

1. **Given** `EditorProps` gains a new member, **When** CI runs and that member is neither forwarded on `AppProps` nor listed as intentionally-internal, **Then** the build fails.
2. **Given** the new member is forwarded on `AppProps` or added to the intentionally-internal list, **When** CI runs, **Then** the build passes.

---

### Edge Cases

- A member exists on both `EditorProps` and `AppProps` under the same name but with different semantics or a narrower type — the guard only needs to confirm presence/classification, not type or behavioral equivalence; behavioral mismatches are a code-review concern, not this guard's job.
- `App` has two operating modes — IPC-driven (the default, used by the Electron host) and inline (`content`/`onChange` props, no IPC) — some `EditorProps` members are only meaningfully sourced in one mode (e.g. `assetBaseUri`, `documentDirUri` are IPC-derived with an inline-mode fallback already in place). Classification as "App-internal" must hold across both modes, not just the default one.
- A prop added to `EditorProps` that is a narrowing or renaming of an existing `AppProps` member (not a straight pass-through) still counts as unclassified until it is either forwarded or added to the internal-props list with a reason — the guard must not be satisfiable by incidental name overlap alone.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `App` MUST forward `documentOutlineHandle` to its inner `<Editor>`.
- **FR-002**: Every member of `EditorProps` MUST be audited; `App` MUST forward each consumer-facing one, or record why it is intentionally internalized (e.g. sourced from IPC / App state).
- **FR-003**: A guard (contract test or type-level assertion) MUST fail when `EditorProps` gains a member that is neither forwarded on `AppProps` nor listed as intentionally-internal.
- **FR-004**: Additive and backward-compatible — new forwarded props are optional; existing `App` consumers are unaffected.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An `<App>` consumer renders a working document outline by passing the handle to `<App>`, with no drop to `<Editor>`.
- **SC-002**: Every consumer-facing `EditorProps` member is forwarded by `App` or documented as internal.
- **SC-003**: Adding an unforwarded consumer-facing `<Editor>` prop fails CI.

## Assumptions

- Some `EditorProps` are legitimately App-internal (App has an IPC mode and an inline `content`/`onChange` mode) — the audit classifies rather than blindly forwarding all. Candidates likely to classify as internal, pending audit confirmation: `contentVersion`, `cursorToRestoreRef`, `onCursorChange`, `assetBaseUri`, `documentDirUri`, `imagePathResolution` — all are currently sourced from `App`'s own IPC/internal state rather than passed through from a caller.
- The record of why a prop is intentionally internalized can live alongside the guard itself (e.g. as an explicit allowlist with inline reasons) rather than in separate documentation — it just needs to be discoverable by a maintainer reading the guard, and doesn't require a standalone doc page.
- This repo already has an established contract-test convention (`tests/*-contract.test.ts`, e.g. `theming-contract.test.ts`, `package-manifest-contract.test.ts`) that the new guard is expected to follow, though the exact mechanism (contract test vs. type-level assertion) is a Plan-stage decision.

## Out of Scope

- Changes to `<Editor>`'s own prop surface — this issue is about forwarding what already exists on `EditorProps`, not adding new editor capabilities.
- Wiring `documentOutlineHandle` (or any other newly-forwarded prop) into a specific downstream consumer, e.g. Zusammen's own outline UI — tracked separately downstream and unblocked by this issue, not delivered by it.
- Reconciling behavioral differences between App's IPC mode and inline mode beyond what's needed to classify a prop as internal vs. forwardable.

## Source References

- `src/app/editor/Editor.tsx` — `EditorProps` definition, including `documentOutlineHandle` (added in #69).
- `src/app/App.tsx` — `AppProps` definition and the existing forwarding pattern (annotation family, `wikiLinkPromotion`, `sweepRef`, `onSelectionContextMenu`, `onSubstitutionDetected`) that this issue extends.
- `tests/theming-contract.test.ts`, `tests/package-manifest-contract.test.ts` — existing contract-test style the new guard is expected to follow.
- `specs/69-extract-the-table-of/spec.md` — origin of `documentOutlineHandle` and the `DocumentOutline` widget it connects to.
