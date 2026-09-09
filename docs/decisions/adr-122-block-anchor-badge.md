# ADR-122: Block Anchors Render as a Badge via a New `blockAnchor` mdast Node, Detected by a Strict-ULID Post-Parse Text Split

**Date:** 2026-09-09
**Status:** Accepted
**Supersedes:** none
**Amends:** none
**Issue:** #122 (verveguy/liminis-editor)

## Context

Block anchors (`^ULID`) are already in real notes, most heavily trailing
action-item checkboxes (`- [ ] ... ^01M00VDX0S4JHMDNA7F776Y8R8`). Now that
0.5.0 (#119, ADR-119) makes `[[file#^id]]`/`![[file#^id]]` meaningful
reference targets, showing the raw 26-character id inline is both visual
noise and a missed affordance — the id is now worth copying, not just
reading past.

Research surfaced a real tension between two requirements the issue states
side by side. FR-005 requires detection to "match the anchor convention as
actually written in real notes," verified against the shipped
`mdast-util-wiki-link` parser rather than derived from the issue's own
example. That parser's reference-side pattern
(`BLOCK_ID_PATTERN = /#\^([^\s\]#]+)$/`, inside `[[file#^id]]`) accepts *any*
non-whitespace token as a block id — ULIDs, snowflake-style numeric ids,
short ids, slugs — safely, because the surrounding `[[...]]` brackets bound
the match. SC-004 simultaneously requires that a non-anchor caret in
ordinary prose (`x^2`, `2^10`, `a ^ b`) never gets badged. A badge sits at
the anchor's bare *definition* site, with no bracket delimiter to bound it,
so the reference side's permissiveness cannot transfer directly: a charset
wide enough to cover every id form the reference side accepts is also wide
enough to match an exponent.

## Decision

**Detect only the 26-character uppercase Crockford Base32 ULID shape**
(`/\^[0-9A-HJKMNP-TV-Z]{26}(?![0-9A-HJKMNP-TV-Z])/`), and represent a match
as a new mdast node type (`blockAnchor`) with a matching Lexical
`DecoratorNode` (`BlockAnchorNode`) — the same architectural shape this
codebase already uses for every other round-trip-sensitive inline construct
(`footnoteReference`/`FootnoteNode`, `wikiEmbed`/`TransclusionNode`).

### 1. Charset alone cannot satisfy both FR-005 and SC-004 — length is the disambiguating signal, not a whitespace or position rule

A narrow, ULID-shaped charset satisfies SC-004 by construction: `x^2` and
`2^10` are far too short to match a 26-character run, with no separate
word-boundary or preceding-whitespace rule needed. The trade against FR-005
is explicit and accepted, not silent: snowflake-style and short-id anchors
— forms the reference side already accepts — continue rendering as raw text
after this issue ships. This worktree has first-party evidence only for the
ULID shape (the issue's own real checkbox example, confirmed against the
shipped parser); widening to cover forms with no such evidence here would
trade a known, bounded gap for an unverified regex. Extending detection to
those forms is a deliberately deferred, isolated follow-up once that
convention has first-party evidence, not a design flaw in this decision.

A required-whitespace-before-`^` rule (one of the options Research raised)
was rejected: the issue's own edge cases require an anchor immediately after
other inline syntax with no preceding space (right after a wiki-link, at the
end of an emphasis run), which a boundary rule would exclude structurally.
A position rule ("anchors sit at the end of a block") was also rejected as
unnecessary once length alone resolves the conflict, and adding it would
only add complexity without changing which real documents get badged
correctly.

### 2. Detection is a post-parse text split, not a pre-parse sentinel substitution

`#119`'s embed marker (`![[...]]`) needs a pre-parse sentinel substitution
because it has to influence *tokenization itself* — letting the wiki-link
tokenizer see a `[[` it would otherwise miss. A bare `^ULID` unlocks no
syntax; nothing needs to change about how the surrounding text tokenizes.
Detection is therefore a **post-parse** walk over already-typed mdast `text`
nodes (`splitTextNodeBlockAnchors`/`splitBlockAnchors` in `parse.ts`),
splitting a matching run into a `blockAnchor` node — structurally the same
shape as `#17`'s `splitTextNodeEscapes`/`splitEscapedPunctuation`, whose
decode-replay and per-offset position-mapping machinery this pass reuses
directly rather than re-implementing, including its conservative bail-out:
if a text node's replayed decoding does not exactly reproduce `node.value`
(e.g. a character reference is present), the whole run is left unsplit.
This codebase's established risk tolerance for this problem shape is that a
missed badge is an acceptable cost; a corrupted split is not.

Being a post-parse pass over already-typed nodes, not a raw-string regex
over source text, the matcher structurally cannot see into `inlineCode`,
`code`, `inlineMath`, `wikiLink` or `wikiEmbed` node content — none of those
are `text` nodes once mdast has typed them. This satisfies the code-span/
fenced-code/math edge case and FR-006 (never weaken existing wiki-link/embed
detection) by construction, with no "protected ranges" pre-parse machinery
needed at all — the class of machinery `substituteEmbedMarker` requires only
because it has to influence tokenization.

The pass runs after `resolveWikiEmbeds`/`annotateEmphasisMarkers` (so it
never sees wiki-link or embed target text) and immediately before
`splitEscapedPunctuation`, which stays last so it can still process any
escaped punctuation left in this pass's "before"/"after" text siblings.

### 3. A new mdast node type + `DecoratorNode`, not Lexical-only text-entity matching

Research raised a Lexical-only alternative — `registerLexicalTextEntity`,
matching live `TextNode` content inside the mounted `<Editor>` with no
`parseMarkdown`/`stringifyMarkdown` change at all. Rejected: it would make a
headless `parseMarkdown`-only consumer (no editor mounted) see plain text
where a mounted editor sees a badge, violating this issue's own edge case
("Anchors in a headless/`parseMarkdown`-only context ... the pipeline must
behave identically") and diverging from the mdast-node precedent every
other round-trip-sensitive inline construct in this codebase already
follows (`footnoteReference`/`FootnoteNode`, `wikiEmbed`/`TransclusionNode`).
The mdast-node approach keeps `parseMarkdown`'s output identical with or
without an editor mounted, at the cost of touching more files (a new node
type end-to-end) than the Lexical-only alternative would have.

### 4. Format bitmask and strong/emphasis marker carry-through, mirroring `FootnoteNode` exactly

`BlockAnchorNode` mirrors `TextNode`'s format bitmask and `FootnoteNode`'s
`--md-strong-marker`/`--md-emphasis-marker` style-hook pattern, so an anchor
sitting inside `**bold**`/`_italic_` still round-trips its original
underscore-vs-asterisk marker. Real anchors are almost always plain
end-of-line text today, so this could have been deferred, but this codebase
has already shipped the "decorator silently drops formatting/marker inside
bold/italic" defect class twice (`#898`, `#908`) — the marginal cost of
including the mirroring now is small next to rediscovering that bug class
in a follow-up issue.

### 5. `convertListItemNode` keeps a block anchor inline — a deliberate, narrow exception to an existing gap

`lexicalToMdast.ts`'s `convertListItemNode` routes only text runs, line
breaks and links through its inline phrasing path; every other child type
(image, equation, footnote, inline HTML) falls to the generic block
dispatcher and does not survive a round trip inline — a documented,
pre-existing gap (see `hoistedTokenReachesOutput`'s docstring), accepted
because no document exercised it. This issue's primary real-world shape is
exactly `- [ ] ... ^ULID` — a block anchor as the last content of a
checkbox list item — so silently inheriting that gap for `BlockAnchorNode`
would break the pattern the spec calls out explicitly as the reported
problem. `convertListItemNode` therefore gets a narrow, additional
`$isBlockAnchorNode` branch keeping the anchor inline, and
`hoistedTokenReachesOutput` is updated to match (a hoisted annotation
boundary onto a block anchor inside a list item now genuinely reaches the
output). The gap for image/equation/footnote/HTML is deliberately left as
is — repairing it is unrelated to this issue and out of scope.

### 6. Affordance: native `title` tooltip + click-to-copy, no new interaction pattern

User Story 2 (the id must remain readable and copyable) is satisfied by
exposing the full id via the native `title` attribute on hover, and copying
it via `navigator.clipboard.writeText` on click with brief "Copied"
feedback — mirroring `CodeBlockPlugin.tsx`'s existing copy-button pattern
rather than introducing a new popover/menu affordance.

## Consequences

**Good:**

- A block anchor at any of the shapes this issue's edge cases name (bare
  end-of-line, immediately after a wiki-link, inside emphasis/strong, inside
  a checkbox action item) renders as a badge and round-trips
  byte-identically through `parseMarkdown -> stringifyMarkdown` (FR-002/
  SC-002), verified by the `122-block-anchor/` fixture corpus.
- SC-004's three false-positive cases (`x^2`, `2^10`, `a ^ b`) are excluded
  structurally, by length alone — no separate boundary-detection logic to
  maintain or get wrong.
- A caret inside inline code, a fenced code block, or inline math is never
  touched, by construction of the post-parse `text`-node-only pass — no
  "protected ranges" machinery needed, unlike the embed marker.
- Existing wiki-link and transclusion fixtures pass unmodified (SC-005): the
  new matcher runs after those constructs are already typed and cannot see
  into their node content.

**Bad / accepted:**

- **Non-ULID id forms — snowflake-style numeric ids, short ids, slugs —
  continue rendering as raw text.** These are accepted today by the
  wiki-link reference side inside `[[file#^id]]`, but this worktree has no
  first-party evidence of them being used as bare definition-site anchors,
  so widening detection to cover them is deliberately deferred rather than
  guessed at. A future issue extending this regex has this ADR's reasoning
  to build on rather than needing to re-derive the FR-005/SC-004 tension
  from scratch.
- **The pre-existing image/equation/footnote/inline-HTML-inside-a-list-item
  gap in `convertListItemNode` is unchanged** for every type except block
  anchors. Repairing it more generally is unrelated to this issue and left
  for whenever a real document actually needs one of those constructs
  inline in a list item.
- **A text node containing a character reference (e.g. `&amp;`) alongside a
  block anchor is left unsplit** (the same conservative bail-out `#17`
  already accepts for escaped punctuation) — a missed badge in that narrow
  combination, not a corrupted one.
- **A backslash-escaped caret (`\^`) immediately followed by a ULID-shaped
  run is never badged**, even though `decoded` (the value the matcher runs
  against) has already resolved `\^` to a plain `^` by the time the regex
  sees it. The matcher consults `replayDecodeEscapes`'s per-offset `escaped`
  flag and rejects any match whose `^` came from an escape, on the same
  reasoning as the character-reference bail-out above: badging it would
  defeat an author's deliberate escape and, since `stringify.ts`'s
  `blockAnchor` handler always emits a bare `^id`, silently drop the
  backslash on the next save. This only prevents the *new* harm (wrongly
  badging escaped-looking text); it does not fix the pre-existing, unrelated
  gap that `^` is outside `FORCE_ESCAPE_CHARS`, so a bare `\^` — anchor-
  shaped or not — already does not round-trip its backslash today. Repairing
  that is out of scope for this issue.

> **Amended 2026-09-09 (#124) — "length is the disambiguating signal" no
> longer holds; the resolver's position rule is.** #122 shipped detecting
> only the 26-character ULID shape, arguing (§1 above) that length alone
> resolved the FR-005/SC-004 tension, and that a wider charset would
> reintroduce false positives like `x^2`/`2^10`. That argument turned out to
> rest on a premise this ADR didn't state explicitly: math and code are
> excluded from detection *structurally*, by mdast node type (§2), not by
> charset — the text-splitter pass never reaches inside `inlineCode`, `code`
> or `inlineMath`. So the only false-positive risk length was actually
> protecting against was a bare caret in ordinary prose, outside any math or
> code construct — and that risk is a *position* problem (where the caret
> sits on the line), not a charset-width problem.
>
> #124 (Widen block-anchor badge detection beyond strict ULID) adopts the
> resolver's own position rule verbatim as a second detection branch:
> `/(?:^|\s)\^([^\s\]#]+)\s*$/` — the caret must start a token (line-start or
> preceded by whitespace) and the captured id must run to end of line. This
> branch now badges every id form the resolver and the wiki-link reference
> side already accept (ULID, raw-decimal snowflake, NanoID with `_`/`-`,
> mixed-case base62, UUID-shaped hyphenated ids, short alphanumeric ids),
> closing the gap §168's "Bad / accepted" section flagged as deliberately
> deferred.
>
> **The original ULID branch (§"Decision" above) is kept exactly as shipped,
> unconstrained by position, as a first branch tried before the new one.**
> Applying the position rule to ULID too was considered and rejected: #122's
> own fixtures and unit tests require a ULID to badge immediately after a
> wiki-link or emphasis run with no preceding space (§1's "required-
> whitespace-before-`^`... rejected" reasoning, still valid), and require a
> ULID followed by further prose on the same line to badge
> (`multiple-anchors.md`). A single, universally-applied position rule breaks
> both. Keeping ULID's original permissive rule frozen, and adding position-
> gating only for every other id shape, satisfies both requirements at once
> without reopening #122's already-settled charset reasoning for the case it
> was actually designed for.
>
> **A minimum-length threshold (e.g. ~8 characters) was considered and
> rejected**, as an alternative to the position rule, to exclude the one
> residual false positive the position rule alone doesn't resolve: a bare
> short number at line end preceded by whitespace, such as `^100`. Rejected
> because #124's own requirements include badging short alphanumeric ids
> (`^a1b2c3`, 6 characters) — any length floor high enough to exclude `^100`
> also excludes ids of that length, reintroducing the exact false-negative
> #124 exists to fix. The residual `^100`-at-line-end false positive is
> therefore accepted, not filtered: it requires an author to end a line on a
> lone number with a caret in front of it and nothing after, which is not how
> exponents are normally written (`2^10` continues the sentence; real math is
> wrapped in MathJax `$...$`, itself excluded structurally per §2).
>
> Math/code exclusion (§2) is unaffected by this amendment — both detection
> branches remain a post-parse pass over already-typed `text` nodes, so the
> structural exclusion holds for every id shape, not just ULID, with no new
> "protected ranges" machinery. See `specs/124-widen-block-anchor-badge/spec.md`
> for the full analysis, including the rejected `^=`-sigil alternative.

## References

- Issue #122 (this decision)
- Issue #124 (2026-09-09 amendment above — widened detection beyond ULID)
- `docs/markdown-pipeline.md` ("Block anchor badges (#122)" section — the
  detection regex, the post-parse text-split technique, and the round-trip
  contract)
- `docs/decisions/adr-119-block-transclusion.md` (the `#^blockId` reference-
  side pattern this issue's regex is deliberately narrower than, and the
  embed-marker sentinel technique this issue's post-parse approach is
  contrasted against)
- `src/markdown/vendor/mdast-util-wiki-link/from-markdown.ts` (`BLOCK_ID_PATTERN`,
  the reference-side pattern cited above)
- `src/app/mapper/__tests__/fixtures/roundtrip/122-block-anchor/` (the
  round-trip fixture corpus backing FR-002/SC-002/SC-004/SC-005)
