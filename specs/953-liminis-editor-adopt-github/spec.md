# Feature Specification: `@liminis/editor`: adopt GitHub-style slug matching, scroll-container discovery and retry in `AnchorScrollPlugin`

**Feature Branch**: `fabrik/issue-953`
**Created**: 2026-08-06
**Status**: Draft
**Input**: User description: "`packages/editor`'s `AnchorScrollPlugin` resolves an in-document `#fragment` to a heading by normalizing em-dashes and underscores to spaces. That does not match GitHub's heading-slug algorithm, so a fragment like `#rebase-and-migration-from-envenc` — the form GitHub generates and therefore the form that appears in real documents and in links copied from the GitHub UI — fails to resolve and nothing scrolls. Zusammen's fork carries a materially more capable version (124 lines vs. 83; verveguy/zusammen#36, commits `c030c68`/`3ddd278`) that has been shipping. It is one of four upstream gaps blocking Zusammen's adoption of the package (verveguy/zusammen#102). Bring the plugin up to the fork's behaviour: GitHub-style slug normalization, scroll-container discovery by ancestor walk, retry while async content renders, and near-top positioning."

## Background

`AnchorScrollPlugin` (`packages/editor/src/app/editor/AnchorScrollPlugin.tsx`) turns a `#fragment` anchor — arriving via the host's injected `onScrollToAnchor` service — into a scroll to the matching heading in the open document. Today it normalizes both the fragment and each heading's text by lowercasing and converting em-dashes, en-dashes, hyphens, and underscores to spaces, then compares the collapsed strings.

That scheme does not match GitHub's heading-slug algorithm (lowercase, strip punctuation, spaces → hyphens, collapse repeated hyphens). A fragment in GitHub slug form — `#rebase-and-migration-from-envenc` — is exactly the form GitHub generates for its own heading anchors, and therefore the form that shows up in real documents and in links copied from the GitHub UI. Under the current scheme it fails to resolve, silently: no error, no scroll, nothing tells the user why.

Zusammen forked `@liminis/editor` and, in `verveguy/zusammen#36` (commits `c030c68`/`3ddd278`), rewrote this plugin (83 → 124 lines) to fix this along with three related gaps: it assumed a fixed scroll-container selector rather than discovering the one that actually contains the editor; it made no allowance for headings that render asynchronously (equations, diagrams, syntax-highlighted code) after the first resolution attempt; and it scrolled to whatever position Lexical's/the browser's default scroll behavior produced rather than positioning the heading near the top of the viewport. That fork has been shipping in Zusammen.

This is one of four small upstream gaps (tracked under `verveguy/zusammen#102`) blocking Zusammen's adoption of `@liminis/editor` as a private git dependency instead of a diverging fork. The fork's version is being deleted by that repo's #102 once this port lands, so it must be ported now rather than re-derived later. The fork's file is available locally for reference at `~/dev/zusammen/app/src/editor/app/editor/AnchorScrollPlugin.tsx` (verified: 125 lines including trailing newline).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A GitHub-copied link resolves (Priority: P1)

A user copies a heading link from a GitHub-rendered Markdown file (e.g. `#rebase-and-migration-from-envenc`) and pastes it as, or follows it as, an in-document anchor in Liminis. The document scrolls to the matching heading.

**Why this priority**: This is the reported defect and the primary motivation for the issue — it is the form of fragment GitHub actually produces, so it is the form real users actually hit.

**Independent Test**: Feed the plugin a GitHub-slug-form anchor against a document containing a heading whose slugified text matches; assert the heading is found and scrolled to.

**Acceptance Scenarios**:

1. **Given** a document with a heading whose text, when reduced by GitHub's slug rules, equals `rebase-and-migration-from-envenc`, **When** the plugin receives the anchor `rebase-and-migration-from-envenc`, **Then** it resolves and scrolls to that heading.
2. **Given** a heading containing punctuation GitHub's algorithm strips (e.g. a heading like `Rebase and migration from` followed by an inline-code span rendering `.env.enc`), **When** the plugin receives the corresponding GitHub-form anchor, **Then** it resolves to that heading.
3. **Given** the existing fragment forms that resolve today (case-insensitive text match, dash/underscore-tolerant match as covered by `host-plugins.test.tsx`), **When** the plugin receives those same anchors against the same headings, **Then** they continue to resolve — no regression for `liminis-app`.

---

### User Story 2 - A fragment below asynchronously-rendered content resolves (Priority: P1)

A user follows an anchor link targeting a heading that appears after content that renders asynchronously (a math equation, a diagram, syntax-highlighted code). On the first resolution attempt the heading may not exist in the DOM yet, but the anchor still resolves once that content finishes rendering.

**Why this priority**: Without this, resolution is a race the plugin usually loses on any document containing lazy-rendered content below the target heading — today's single-attempt lookup only works by luck.

**Independent Test**: Mount the plugin against a document where the target heading is inserted into the DOM on a delay (simulating async render completion); assert the anchor still resolves once the heading appears, without requiring the first attempt to succeed.

**Acceptance Scenarios**:

1. **Given** a heading that is not yet present in the rendered DOM when the anchor is received, **When** that heading appears within the plugin's retry budget, **Then** the anchor resolves and the document scrolls to it.
2. **Given** an anchor with no matching heading anywhere in the document, even after the retry budget is exhausted, **When** the plugin gives up, **Then** it produces no error, no console warning/error, and no scroll — it fails quietly.

---

### User Story 3 - The resolved heading lands near the top of the view (Priority: P2)

When an anchor resolves, the target heading ends up near the top of the visible scroll area rather than centered, at the bottom, or barely visible — so the user can read the section that follows it without an extra manual scroll.

**Why this priority**: Correct resolution without correct positioning still leaves the user re-scrolling by hand; this is what makes the resolved scroll actually useful.

**Independent Test**: Resolve an anchor and assert the heading's position relative to its scroll container places it within a small margin of the container's top edge, not centered or below the fold.

**Acceptance Scenarios**:

1. **Given** a heading is found and its container scrolled, **When** the scroll completes, **Then** the heading sits near the top of the container's visible area (a small margin down, not flush against the very edge).

---

### User Story 4 - The correct scrollable ancestor is scrolled, in either host (Priority: P2)

The plugin scrolls whichever scrollable ancestor of the editor actually contains it, discovered at runtime, rather than a selector hardcoded to one host's markup. It must work both for Liminis's chrome and for Zusammen's (`#editor-scroll-container`), and continue to work if a host's container markup changes.

**Why this priority**: `@liminis/editor` is consumed by more than one host (`liminis-app`, and Zusammen once it adopts the package per its #102). A selector hardcoded to one host's container id is exactly the kind of divergence this port exists to eliminate.

**Independent Test**: Mount the plugin in a DOM where the scrollable ancestor uses neither of the known container ids, and assert the plugin still finds and scrolls it (by walking ancestors and checking which one actually scrolls).

**Acceptance Scenarios**:

1. **Given** the editor's scrollable ancestor carries the id `editor-scroll-container` or `editor-panel-scroll-container`, **When** an anchor resolves, **Then** that ancestor is the one scrolled (no regression for either known host shape).
2. **Given** the editor's scrollable ancestor carries neither known id but is otherwise a genuine scrollable ancestor (`overflow-y: auto`/`scroll` and `scrollHeight > clientHeight`), **When** an anchor resolves, **Then** that ancestor is discovered and scrolled.

---

### Edge Cases

- An anchor that normalizes to an empty string (e.g. a heading or fragment made entirely of punctuation) must not spuriously match another heading that also normalizes to empty.
- No scrollable ancestor exists at all (e.g. the editor and all its ancestors fit their content without overflow): the plugin must not throw; falling back to bringing the heading into view by some other means, or no-op, are both acceptable outcomes — it must not error.
- Multiple headings whose text normalizes to the same slug: matching the first one encountered (document order) is acceptable; this is unchanged from today's behavior and not a regression to fix here.
- The host offers no `onScrollToAnchor` service at all: the plugin must remain a no-op, as it is today (covered by the existing "no service" test).
- An anchor fragment that contains a literal underscore is compared using GitHub's slug rules, under which underscores are not converted to hyphens (unlike today's em-dash/underscore→space rule). A heading whose normal-form slug happens to contain a space in the corresponding position will therefore not match an anchor with a literal underscore there. Confirm during Research/Plan that no real `liminis-app` content or generated anchor currently depends on the old underscore→space equivalence; if it does, that is a genuine tension between "adopt GitHub's algorithm" and "no regression" that needs a call before implementation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The plugin MUST normalize both the incoming anchor fragment and each candidate heading's rendered text using GitHub's heading-slug rules: lowercase; strip characters that are not letters, digits, whitespace, or hyphens (GitHub also treats underscores as literal, not stripped or converted); collapse runs of whitespace/hyphens into a single hyphen; trim leading and trailing hyphens. This replaces the current em-dash/en-dash/hyphen/underscore→space normalization; it does not layer on top of it.
- **FR-002**: A match is a heading whose normalized text equals the normalized anchor exactly (post FR-001). An anchor or heading that normalizes to an empty string MUST NOT be treated as a match against anything.
- **FR-003**: Scroll-container resolution MUST NOT assume a single fixed selector. Given a matched heading, the plugin MUST discover the nearest ancestor that is actually scrollable (computed `overflow-y` of `auto` or `scroll`, and `scrollHeight > clientHeight`) by walking up from the heading, so it works for whichever container shape the host provides. Recognizing known container ids (`#editor-scroll-container`, `#editor-panel-scroll-container`) as a fast path is acceptable, but resolution MUST NOT be limited to those ids — an unrecognized-but-genuinely-scrollable ancestor must still be found.
- **FR-004**: When a matched heading is not found on the first resolution attempt, the plugin MUST retry for a bounded number of attempts (informed by the fork's ~30-attempt animation-frame budget; the exact count/interval is a Plan/Research decision) to accommodate headings that appear only after asynchronous content finishes rendering, then stop.
- **FR-005**: When the retry budget is exhausted without a match, the plugin MUST give up without throwing, without logging an error, and without scrolling anything.
- **FR-006**: When a heading resolves (first attempt or after retry), the plugin MUST scroll its discovered container so the heading is positioned near the top of the visible scroll area (a small margin below the top edge), not centered, bottom-aligned, or wherever the platform's default scroll-into-view behavior would place it.
- **FR-007**: Fragment forms that resolve under today's normalization and are covered by the existing test suite (`packages/editor/src/app/editor/__tests__/host-plugins.test.tsx`) MUST continue to resolve under the new normalization.
- **FR-008**: The port MUST integrate through the package's existing injected host-service pattern (`useEditorHost()` / the `onScrollToAnchor` service, per ADR-075) — it MUST NOT reintroduce a direct `window.api` reach-in inside `@liminis/editor`. (The fork's `AnchorScrollPlugin` calls `window.api.editor.onScrollToAnchor` directly and also adds a separate `scrollToAnchor` prop/nonce path for in-app cross-file navigation; neither of those is compatible with, or required by, `@liminis/editor`'s current architecture — see Assumptions and Out of Scope.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A fragment in GitHub slug form (e.g. `rebase-and-migration-from-envenc`) resolves to, and scrolls to, a heading whose rendered text reduces to the same slug under GitHub's rules.
- **SC-002**: Every fragment-matching scenario covered by the existing `host-plugins.test.tsx` `AnchorScrollPlugin` suite still passes after the change.
- **SC-003**: A fragment targeting a heading that is inserted into the DOM after a simulated render delay resolves once that heading is present, without requiring the very first lookup to succeed.
- **SC-004**: An anchor with no matching heading anywhere in the document — including after the retry budget is exhausted — produces zero console errors/warnings and zero calls to scroll.
- **SC-005**: A test where the editor's scrollable ancestor uses an id other than `editor-scroll-container`/`editor-panel-scroll-container` still results in that ancestor being scrolled — proving discovery is not limited to the two known ids.
- **SC-006**: After a successful resolution, the matched heading's position relative to its container places it within a small, fixed margin of the container's visible top edge (not centered, not below the fold).

## Assumptions

- The fork's implementation at `~/dev/zusammen/app/src/editor/app/editor/AnchorScrollPlugin.tsx` (verified locally) is authoritative for algorithm details (slug normalization character class, ancestor-walk predicate, retry budget/mechanism, top-margin value) per the issue's explicit instruction to port rather than re-derive. Exact numeric constants (retry count, margin in pixels) may be carried over as-is or adjusted by Plan/Research; this spec does not fix them.
- The fork also introduces a `scrollToAnchor?: { anchor: string; nonce: number }` prop for host-driven in-app cross-file navigation, and calls `window.api.editor.onScrollToAnchor` directly rather than through an injected service. Both are specific to Zusammen's current (pre-#102) architecture, not `@liminis/editor`'s. This port targets the `onScrollToAnchor` host-service subscription path only, applying GitHub-slug matching, ancestor-walk discovery, retry, and near-top positioning within that existing trigger mechanism (see FR-008 and Out of Scope).
- "No regression for `liminis-app`" (issue acceptance) is scoped to the fragment forms and matching behavior exercised by real `liminis-app` content and by the existing test suite — not to every hypothetical string equivalence the old space-based normalization happened to produce. The underscore-handling difference noted under Edge Cases is called out precisely because it is a plausible, not merely hypothetical, gap; Research should confirm it doesn't affect real anchors before this is considered settled.
- A host-supplied container id/selector, in place of (or alongside) ancestor-walk discovery, is an acceptable implementation shape for FR-003 per the issue text — the requirement is that the mechanism isn't hardcoded to a single Liminis-specific id, not that ancestor-walking specifically must be the technique used.

## Out of Scope

- Zusammen's `scrollToAnchor` prop / nonce-based signal for in-app cross-file navigation (jumping to an anchor in a *different* document than the one currently open). `@liminis/editor` has no such cross-file navigation concept today; only the existing `onScrollToAnchor` single-document subscription path is in scope.
- Any change to how anchor fragments are produced or how wiki-links/anchor links are authored (e.g. `liminis-app`'s main-process IPC handling in `editor-handlers.ts`). Only the resolution/scroll behavior inside `@liminis/editor` changes.
- The other three upstream gaps tracked under `verveguy/zusammen#102`.

## Source References

- `packages/editor/src/app/editor/AnchorScrollPlugin.tsx` — current implementation to be replaced
- `packages/editor/src/app/editor/__tests__/host-plugins.test.tsx` — existing coverage that must keep passing
- `packages/editor/src/host/{context.tsx,types.ts,defaults.ts}` — the injected host-service pattern (ADR-075) this must integrate through
- `~/dev/zusammen/app/src/editor/app/editor/AnchorScrollPlugin.tsx` — reference implementation (verified locally, 125 lines)
- `verveguy/zusammen#36` (commits `c030c68`/`3ddd278`) — origin of the fork's version
- `verveguy/zusammen#102` — parent issue tracking the four upstream adoption gaps
- `docs/project_notes/decisions/adr-075.md` — the host-service extraction this must not regress
