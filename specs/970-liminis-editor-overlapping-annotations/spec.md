# Feature Specification: Overlapping annotation marks and inline-construct-safe live ranges

**Feature Branch**: `fabrik/issue-970`
**Created**: 2026-08-08
**Status**: Draft
**Input**: User description: "@liminis/editor: overlapping annotations place only one mark, and a mark over an inline link covers a truncated span"

## Background

Two defects in `@liminis/editor`'s annotation-mark layer, found while reviewing #964 (PR #967) — the first host to place annotation marks in anger. #964 cannot fix either without violating its own FR-033 (no changes to the package, no fork, no local patch — ADR-075), so they are filed against the package.

### 1. Only one of a pair of overlapping annotations is placed

`placeMarksForAnchors` (`packages/editor/src/app/editor/annotation-marks.ts`) sorts entries back-to-front and explains why:

> Placing a mark splits the TextNode it lands in, and `offsetSpans` still describes the *unsplit* parse — so a placement invalidates the table for everything after it in the document, but not for anything before it.

That reasoning is sound for **disjoint** ranges. For ranges that **overlap**, the later placement splits a TextNode the earlier entry still needs, so the earlier entry's span is stale and the per-anchor placement declines.

Measured against this paragraph:

```
The quick brown fox jumps over the lazy dog, and then it [rests](https://example.com).
```

| annotations passed | marks placed |
|---|---|
| `quick brown fox jumps over the lazy dog` alone | 1 |
| `fox jumps over the lazy dog, and then it` alone | 1 |
| both (partial overlap) | **1** |
| `quick brown fox jumps over the lazy dog` + `brown fox` (strict nesting) | **1** |

Strict nesting fails too, so this is not only a crossing-ranges problem.

**Why it matters:** overlapping annotations are ordinary — two people remarking on the same sentence, or one comment on a clause inside another on the paragraph. #964's spec lists it as an edge case requiring that both "persist and both be reachable". They do persist; only one becomes reachable, because the unplaced one renders no marker, and an annotation with no marker can only be reached through the annotation list.

`placeMarksForAnchors` already returns the ids it placed, so a host can *observe* the shortfall — it just has no way to act on it, and no way to place the rest.

### 2. A mark spanning an inline link covers a truncated source span

Capture an anchor over `it [rests](https://example.com)` and place it. `collectLiveAnchorSnapshots` returns a range covering `it [rests` — the mark wraps the link's *text*, so the reconstructed markdown span stops inside the link syntax rather than after the destination.

**Why it matters:** it feeds a bad write downstream. #964's FR-019 refresh compares each live span against the stored `anchor.targetText` and re-captures on a genuine difference. Here they differ for a reason that has nothing to do with the user editing anything, so the stored anchor gets rewritten from `it [rests](https://example.com)` to `it [rests` — an anchor that ends mid-syntax. A host cannot distinguish this from a real edit without re-implementing the mapper's knowledge of inline syntax.

Both behaviours are pinned by an assertion in `liminis-app/src/renderer/components/__tests__/comment-markdown-integrity.test.tsx` (introduced by #964/PR #967) that is written to fail loudly when this issue is fixed — deliberately, so the fix is noticed rather than silently changing app-level expectations.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Two annotations on overlapping text are both visible (Priority: P1)

A reader annotates a whole sentence. A second reader — or the same reader later — annotates a clause inside that sentence, or a span that starts inside it and runs past its end. Both annotations show a marker in the document and both can be opened by clicking their text.

**Why this priority**: this is the defect's user-visible face. Today the second annotation silently has no marker, so it is unreachable from the document and looks lost.

**Independent Test**: place two anchors whose ranges overlap into a fresh document and assert both ids report a live mark and at least one marker element.

**Acceptance Scenarios**:

1. **Given** the paragraph `The quick brown fox jumps over the lazy dog, and then it [rests](https://example.com).` and two anchors targeting `quick brown fox jumps over the lazy dog` and `fox jumps over the lazy dog, and then it`, **When** both are placed in one call, **Then** both ids are reported as placed and both have a live mark.
2. **Given** the same paragraph and two anchors targeting `quick brown fox jumps over the lazy dog` and the strictly nested `brown fox`, **When** both are placed in one call, **Then** both ids are reported as placed and both have a live mark.
3. **Given** two anchors covering the identical range, **When** both are placed, **Then** both ids are reported as placed and both have a live mark.
4. **Given** any of the above pairs, **When** the same pair is passed in the reverse order, **Then** the outcome is identical — placement does not depend on caller ordering.
5. **Given** overlapping annotations are placed, **When** the document is serialized back to markdown, **Then** the markdown is byte-identical to the input — marks stay invisible to content (ADR-003).

---

### User Story 2 - An annotation's live range never ends mid-syntax (Priority: P1)

A user annotates text that contains an inline link (or other inline construct) and then makes no edits at all. Later, when the host refreshes anchors, the annotation is left alone: its live range still reads back as exactly the markdown that was captured.

**Why this priority**: without it, an untouched document silently rewrites stored anchors into malformed markdown slices on every refresh, and the corruption compounds — a truncated anchor is what the *next* refresh compares against.

**Independent Test**: capture an anchor over a span containing an inline link, place it, then read the live range back and compare it to the captured text.

**Acceptance Scenarios**:

1. **Given** the paragraph above and an anchor captured over `it [rests](https://example.com)`, **When** the mark is placed and the live range collected, **Then** the range covers `it [rests](https://example.com)` in full — not `it [rests`.
2. **Given** any anchor captured over a span of an unedited document, **When** its live range is collected, **Then** the recovered markdown slice equals the captured `targetText` exactly, so a host comparing the two sees no difference.
3. **Given** a recovered live range, **When** its start and end offsets are inspected, **Then** neither splits a run of inline syntax — a boundary never lands part-way through `](`, a link destination or title, or a `**` / `*` / `` ` `` / `~~` delimiter. It always sits at a text-leaf edge. (For a mark covering a construct *whole*, that edge is outside the construct entirely; for one covering only part of a construct's text, it is the selected edge within that text — see FR-014.)

---

## Edge Cases

- **Crossing (non-nested) overlap** — ranges that partially overlap without either containing the other. Both must place.
- **Strict nesting** — one range wholly inside another, in either placement order. Both must place.
- **Identical ranges** — two annotations on exactly the same text. Both must place and both remain individually addressable.
- **Three or more mutually overlapping annotations** on one paragraph.
- **Overlap across block boundaries** — one annotation spanning a heading and the paragraph after it, another overlapping only part of the paragraph.
- **Removing one of two overlapping annotations** must leave the other's coverage intact over the shared region.
- **Re-running placement** for an id that already has a live mark stays a no-op (no duplicate marks).
- **Genuinely unlocatable anchors** — an anchor whose target text is no longer in the document must still decline quietly (no throw), and must not prevent its siblings in the same batch from placing.
- **Anchors that legitimately cannot be mapped** (e.g. a target lying wholly inside a fenced code block, which has no offset coverage) keep today's safe no-mark fallback.
- **Mark covering only part of an inline construct's text** — e.g. the user selects `res` inside `[rests](…)`. **Amended during implementation, in step with FR-014:** partial coverage keeps the boundary at the selected text leaf and does *not* widen to the whole construct, so the recovered range here is `res`, not `[rests](…)`. Widening it would re-place the anchor onto text the user never selected. Whole-construct recovery applies only where the mark covers the construct's entire rendered content.
- **Adjacent-but-disjoint ranges** that abut exactly at one offset must both place, as today.
- **Nested inline constructs** — e.g. a link whose text is bold, `[**rests**](url)` — the recovered range must still close outside the outermost construct.

## Requirements *(mandatory)*

### Functional Requirements

#### Overlapping placement

- **FR-001**: Placing a batch of anchors MUST place a mark for every anchor whose target is locatable in the document, regardless of whether the anchors' ranges are disjoint, partially overlapping, strictly nested, or identical.
- **FR-002**: The set of ids placed MUST be independent of the order in which entries are supplied.
- **FR-003**: An anchor that cannot be located, or cannot be safely mapped, MUST decline without throwing and MUST NOT prevent any other anchor in the same batch from being placed.
- **FR-004**: After placement, each placed id MUST individually report a live mark and MUST expose at least one marker element in the rendered document, including where its range is shared with another annotation.
- **FR-005**: The overlapping region of two annotations MUST be attributed to both — a click or hover on that region resolves to both ids, not just one.
- **FR-006**: Removing one annotation's marks MUST leave every other annotation's coverage intact, including over regions the two shared.
- **FR-007**: Placement MUST remain idempotent — re-placing an id that already has a live mark leaves the document unchanged.
- **FR-008**: Placing marks MUST NOT change the document's markdown content in any case covered above — a serialize after placement is byte-identical to the source (ADR-003).
- **FR-009**: A batch placement MUST remain a single batched editor update, not one update per anchor (preserving the existing performance guarantee for documents with dozens of annotations).
- **FR-010**: The return contract of the batch placement API MUST be preserved: the ids that now have a live mark, reported in caller order.

#### Inline-construct-safe live ranges

- **FR-011**: A live range recovered for a mark that covers an inline link's text MUST extend to the end of the whole link construct, including its destination and any title, and MUST begin at the start of that construct.
- **FR-012**: FR-011 MUST hold for every inline construct the editor round-trips where the mark lands on a text child while syntax extends beyond it — links, images, and wiki links at minimum, and emphasis/strong/inline-code where the same truncation is demonstrated. The fix MUST be construct-general rather than special-cased to links where the same failure exists.
- **FR-013**: For an unedited document, the markdown slice recovered from an annotation's live mark MUST equal the `targetText` captured for that annotation, so a host comparing the two sees no spurious difference.
- **FR-014**: A recovered range MUST NOT start or end inside inline syntax. **Amended during implementation — see ADR-077:** the original second clause required a mark covering only *part* of a construct's text to widen out to the construct's boundaries too. That is not implemented, and deliberately so: widening `big` inside `**big world**` to `**big world**` makes re-placing the anchor highlight `big world`, a different span than the user selected, which FR-017's existing `FORMATTING_CORPUS` pins against. Partial coverage therefore keeps its boundary where the mark is. The first clause holds either way, because a boundary always sits at a text-leaf edge and never strictly inside a delimiter run.
- **FR-015**: Ranges for marks that touch no inline syntax MUST be unchanged from today's behaviour.

#### Compatibility and downstream

- **FR-016**: No breaking change to the package's exported annotation API surface — existing hosts continue to compile and behave as before for the non-defective cases. New API MAY be added if the fix genuinely requires it, but the defects MUST NOT be pushed onto hosts to resolve.
- **FR-017**: Existing `@liminis/editor` annotation tests MUST continue to pass, including those covering placement ordering, offset drift, staleness, and sentinel collision.
- **FR-018**: If `liminis-app/src/renderer/components/__tests__/comment-markdown-integrity.test.tsx` is present on the base branch when this work is implemented, its assertions pinning the two defective behaviours MUST be updated to the fixed expectations in the same change, so the repository test suite is green. (That file arrives with #964/PR #967 and is not on `main` as of this spec.)
- **FR-019**: Regression coverage MUST be added inside `packages/editor` for both defects — overlapping/nested/identical placement, and inline-construct range recovery — so neither can silently return.

### Key Entities

- **Anchor**: the durable description of an annotation's target — its text, occurrence index and surrounding context — used to re-find the target in a re-parsed document.
- **Mark**: the live, non-serializing editor node carrying one or more annotation ids over a range of document text.
- **Live range**: the raw-markdown start/end offsets recovered from an annotation's live mark, compared by hosts against the stored anchor text to decide whether to re-capture.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For the reference paragraph, passing the partially overlapping pair places **2** marks (today: 1), and passing the strictly nested pair places **2** marks (today: 1).
- **SC-002**: For every ordering of a 3-annotation mutually overlapping set, all 3 marks are placed.
- **SC-003**: The live range recovered for an anchor over `it [rests](https://example.com)` equals that string exactly (today: `it [rests`).
- **SC-004**: Across a document containing links, images, wiki links, emphasis, strong and inline code, capturing an anchor over each and immediately re-reading its live range yields zero differences from the captured text — a host's refresh pass re-captures nothing on an unedited document.
- **SC-005**: A serialize of any document after placing overlapping marks is byte-identical to the source markdown.
- **SC-006**: The full repository pre-commit suite (typecheck, lint, build, test) passes.

## Assumptions

- **~~Partial coverage of an inline construct widens the range.~~ Superseded during implementation.** This assumption originally held that a mark covering only part of a construct's text (e.g. `res` inside `[rests](url)`) should widen to the whole construct, on the grounds that a slightly-too-large well-formed span beats a malformed one. Implementation showed the cost is higher than the benefit: widening changes what the annotation *means*, because re-placing the widened anchor highlights text the user never selected, and it breaks four `FORMATTING_CORPUS` cases plus the `brown** fox` assertion that FR-017 requires to keep passing. The implemented rule is **whole coverage only** — hoist out of a construct the mark covers entirely, leave a partial-coverage boundary where it is. Recorded in ADR-077 and pinned by `annotation-inline-construct-ranges.test.ts`. This was a judgment call, not a user instruction, and reversing it was likewise.
- Marks remain non-serializing: nothing in this work may make annotation state visible in exported markdown (ADR-003).
- Hosts continue to derive `markdownText` fresh from the same editor read that the range recovery runs against; this work does not relax that contract.
- The `fabrik:cruise` label on the issue means the spec proceeds on stated assumptions rather than pausing for clarification.
- Anchors that are genuinely orphaned (target no longer present) remain orphaned — this work does not change re-anchoring heuristics.

## Out of Scope

- Any change to how `liminis-app` presents overlapping annotations (marker stacking, hover disambiguation UI, annotation list ordering). Only the package-level guarantee that both marks exist and both are addressable is in scope; app-side presentation is #964's or a follow-up's decision.
- Broadening offset coverage to constructs that have none today (fenced code blocks) — those keep the existing safe no-mark fallback.
- Changing anchor capture semantics, occurrence-index matching, or the re-anchoring/orphan heuristics.
- Publishing or versioning `@liminis/editor` (still private per ADR-078).
- Overlapping-annotation support in the mobile or viewer surfaces.

## Source References

- `packages/editor/src/app/editor/annotation-marks.ts` — `placeMarksForAnchors`, `collectLiveAnchorSnapshots`, `locateLiveMarkdownRange`
- `packages/editor/src/app/mapper/lexicalToMdast.ts` — mark transparency during export
- `packages/editor/src/app/editor/__tests__/annotation-marks.test.ts`, `annotation-placement-offset-drift.test.ts`, `annotation-placement-staleness.test.tsx`, `annotation-sentinel-collision.test.ts`
- `liminis-app/src/renderer/components/__tests__/comment-markdown-integrity.test.tsx` (arrives with #964 / PR #967)
- Issue #964 (FR-019 refresh, FR-033 no-package-changes constraint), ADR-003, ADR-075, ADR-077, ADR-078
