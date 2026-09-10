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

> **Amended 2026-09-10 (#127) — Branch B now accepts a symmetric emphasis
> wrapper at line end, for resolver parity.** `verveguy/liminis#1114` widens
> the resolver's `ANCHOR_LINE_PATTERN` to accept `**^id**`/`__^id__`/
> `*^id*`/`_^id_` at line end, matching an id it previously rejected. Left
> unmirrored, this would reopen #124's defect in the opposite direction:
> `**^<ULID>**` already badges today, but only via Branch A (unconstrained
> by position, §"Decision" above and the first amendment's "kept exactly as
> shipped"); Branch B still demanded whitespace immediately before the
> caret, so a wrapped *non*-ULID id (e.g. `**^a1b2c3**`) would resolve under
> the widened resolver without ever badging — a new badge/resolver
> disagreement, in the same failure mode #124 fixed the first time.
>
> Branch B's left/right boundary checks were extended, not replaced: when
> the plain whitespace/start rule fails but the caret is the first character
> of its own text node, a backward peek into the surrounding raw text looks
> for one of `**`/`__`/`*`/`_` immediately before the node, itself preceded
> by whitespace or document start; when found, the id must then run to that
> same text node's own end and be followed immediately by the *exact same*
> marker string, before the usual trailing-whitespace/end-of-line check.
> Both position invariants (caret at the node's start, id at the node's end)
> are load-bearing: they are exactly the positions at which a *structural*
> wrapper marker — one CommonMark actually parsed as emphasis, as opposed to
> literal text left over from an unmatched delimiter run — can be adjacent
> to the caret/id at all. This is what lets the extension stay a same-style
> raw-text peek, the technique §2's post-parse pass and the first
> amendment's position rule both already use, rather than requiring parent-
> node type/marker/position to be threaded down through the tree walk.
>
> Three consequences of this widening are accepted deliberately, not left as
> undocumented surprises:
>
> 1. **`squared *^2*` becomes a badged-and-resolved false anchor.** This is
>    the same class of residual the first amendment already accepted for
>    `^100` at line end, for the same reason: any length floor that would
>    exclude `^2` also excludes legitimate short ids like `^a1b2c3`, which
>    #124 exists to badge. Wrapping the id in emphasis does not change that
>    tension, so the same residual is accepted here rather than re-litigated.
> 2. **An asymmetric wrapper is rejected, not partially matched.**
>    `item **^<ULID>_` (opening `**`, closing `_`) does not badge via Branch
>    B's wrapper rule with a corrupted id such as `<ULID>_` — the exact-
>    string closer check fails closed on any mismatch, including uneven
>    delimiter-run lengths (`**^id*`). (That specific ULID example still
>    badges — the clean, uncorrupted id — but via Branch A, which has always
>    ignored wrapper symmetry entirely and is untouched by this amendment.)
> 3. **Wrapper forms other than `**`/`__`/`*`/`_` remain unhandled, by
>    design.** Triple emphasis (`***…***`), strikethrough (`~~…~~`),
>    backtick-wrapped (`` `^id` ``), and paren-wrapped (`(^id)`) forms stay
>    unresolved and unbadged — not a general "any wrapper" rule, because
>    `liminis#1114`'s resolver pattern only accepts these four marker forms;
>    matching a wrapper the resolver doesn't would reopen the same
>    disagreement this amendment exists to close, just in the other
>    direction.
>
> The wrapped path's id charset (`[^\s\]#*_]`) additionally excludes `*` and
> `_`, matching the resolver's own corrected wrapped-branch charset. The
> *unwrapped* path's charset (§"#124 amendment" above) is deliberately left
> untouched — narrowing it to match would regress #124's own NanoID-with-
> underscore regression test (`^V1StGXR8_Z5jdHi6B-myT`, FR-004), which
> `liminis#1114`'s corrected pattern would otherwise also exclude. This is a
> known, narrow point of divergence from resolver charset parity, confined
> to ids that legitimately contain `*`/`_` *and* are wrapped in emphasis —
> flagged for whoever coordinates `liminis#1114`'s own Implement stage, not
> something this issue's code works around.
>
> Branch A and its try-first ordering are untouched by this amendment; the
> existing `checkbox-anchor-formatted.md` fixture (a bold-wrapped and an
> italic-wrapped ULID, each at end of line) already badged both anchors
> before this change, via Branch A, and continues to do so unchanged. See
> `specs/127-widen-branch-b-to/spec.md` for the full analysis, including why
> the regex FR-2 originally quoted from the issue body was itself found to
> have a corrupted-id bug and was not ported literally.

> **Amended 2026-09-10 (#127, correction) — `WRAPPED_ID_CHAR` wrongly
> excluded `_`; `WIDE_ID_CHAR` now matches the resolver's actual narrowed
> charset too.** The amendment above, written before `liminis#1114`'s
> Implement stage landed, assumed its corrected wrapped-branch charset
> excluded both `*` and `_`. Checked against `liminis-app/src/main/fs.ts` as
> actually implemented on `verveguy/liminis`'s `fabrik/issue-1114` branch,
> `ANCHOR_LINE_PATTERN` is:
> ```
> /(?:^|\s)(?:(\*\*|__|\*|_)\^(?<wrappedId>[^\s\]#*]+?)\1|\^(?<unwrappedId>[^\s\]#*]+))\s*$/
> ```
> Both the wrapped and unwrapped id groups are `[^\s\]#*]` — excluding `*`
> only. Two things followed from the earlier, incorrect assumption:
>
> 1. `WRAPPED_ID_CHAR` (`[^\s\]#*_]`) wrongly excluded `_` as well, so a
>    wrapped id containing an underscore — a bold-wrapped NanoID
>    (`**^V1StGXR8_Z5jdHi6B-myT**`) or an ordinary `snake_case` id — resolved
>    under the widened resolver but never badged: the exact disagreement this
>    issue exists to close, reintroduced in the wrapped case specifically.
> 2. `WIDE_ID_CHAR` (`[^\s\]#]`, the *unwrapped* path, inherited from #124)
>    still admitted `*`, while the resolver's implemented pattern narrowed
>    its unwrapped branch too — so an unwrapped id containing `*` (e.g.
>    `^ab*cd`) badged but never resolved. No known id format (ULID, NanoID,
>    base62, snowflake, UUID) contains `*`, so this was lower practical risk
>    than [1], but the same drift in the other direction.
>
> Fixed by narrowing `WIDE_ID_CHAR` to `[^\s\]#*]` (dropping `*`, keeping
> `_`) and correcting `WRAPPED_ID_CHAR` to the same `[^\s\]#*]` (dropping the
> wrongful `_` exclusion, keeping the `*` exclusion). The two constants are
> now identical in value; they stay separate, named constants because the
> resolver's wrapped and unwrapped charsets are independent knobs in
> `ANCHOR_LINE_PATTERN` that happen to currently agree, not because they are
> structurally required to.
>
> This is the second time these two independently-maintained rules have
> drifted while both issues were still open — the first was #124's original
> defect (the reason this ADR exists), the second is this correction. A
> shared, cross-repo fixture/case-list — noted as a candidate follow-up in
> `specs/127-widen-branch-b-to/spec.md`'s Out of Scope section and not
> pursued there — would turn the next such drift into a test failure in both
> repositories rather than something caught by manual cross-checking.

> **Amended 2026-09-10 (#126) — Branch A is deleted; the position rule now
> applies to every id form, ULID included, with no carve-out.** The first
> amendment above kept ULID's original, position-free rule "exactly as
> shipped, unconstrained by position, as a first branch tried before the new
> one," on the grounds that #122's own fixtures required a ULID to badge
> mid-line — immediately after a wiki-link or emphasis run with no preceding
> space, and followed by further prose on the same line. That inverted the
> defect #124 closes: a ULID badged in a position the resolver
> (`verveguy/liminis`'s `fs.ts`, `/(?:^|\s)\^([^\s\]#]+)\s*$/`) can never
> address, since the resolver only ever matches an anchor definition running
> to end of line. The badge was claiming resolvability the system could not
> deliver — the same "UI says X" / "system does Y" disagreement #124 fixes,
> just in the opposite direction.
>
> **Mid-line ULID *definitions* were never a supported shape.** Checking
> every ULID-bearing fixture that existed in `122-block-anchor/` against the
> resolver rule: of five, exactly one (`checkbox-anchor.md`, a checkbox item
> ending in `^<ULID>`) encoded an anchor the resolver could actually address
> — and it is the shape `liminis-framework`'s actions tooling emits. The
> other four asserted mid-line placement, immediately-adjacent-to-a-sibling
> placement, or both. Production's only mid-line ULID occurrences are
> wiki-link *references* (`[[file#^id]]` / `![[file#^id]]`), which are
> parsed position-independently by the existing wiki-link machinery and are
> untouched by this decision — nothing about referencing an anchor from
> mid-sentence changes. What #122's mid-line fixtures actually exercised was
> parser robustness (sibling-boundary text-node splitting, multiple anchors
> per paragraph), not a product requirement that anchor *definitions* be
> badge-able mid-line.
>
> **This supersedes both the original ADR's "length is the disambiguating
> signal" rationale (§"Decision" above) and the first amendment's carve-out
> that kept ULID's rule position-free.** `ULID_AT_CARET` and the try-A-then-B
> ordering in `findBlockAnchorMatches` are deleted outright — not
> reparameterized — leaving the position-gated rule (originally introduced
> for every *other* id form by the first amendment, and extended to accept a
> symmetric emphasis wrapper by the second) as the only path. This is safe
> as a pure deletion, not a rewrite: Crockford Base32 (ULID's charset) is
> already a strict subset of that rule's charset (`WIDE_ID_CHAR`/
> `WRAPPED_ID_CHAR`, `[^\s\]#*]`), so every ULID that already satisfied the
> position rule — plain or emphasis-wrapped, at line end — keeps badging
> unchanged. Only mid-line ULIDs, and ULIDs immediately adjacent to a
> preceding sibling with zero intervening whitespace, stop badging. That is
> the intended outcome, not a regression: those shapes could never be
> resolved, and the UI claiming otherwise was the defect.
>
> **Result: badge and resolver now agree for every id form, with no
> carve-out** — the outcome the first amendment (#124) set out to achieve
> and reached for every shape except ULID. `checkbox-anchor.md` (ULID at
> line end) and `checkbox-anchor-formatted.md` (an emphasis-wrapped ULID,
> #127's territory) are both unaffected and continue to badge unchanged.
>
> **A new residual, not previously named**: a caret with zero preceding
> whitespace, immediately following a wiki-link or emphasis/strong sibling
> with no intervening space, can never badge under the universal rule — at
> *any* position on the line, not just mid-line. `anchor-after-wikilink.md`
> and `anchor-in-emphasis-strong.md` originally asserted this exact
> zero-space shape; rewritten with one space inserted before the caret (see
> `fixtures/roundtrip/README.md`'s `122-block-anchor/` section), which keeps
> the sibling-boundary-splitting scenario under test while satisfying the
> position rule. The true zero-space shape is preserved as an explicit
> "does not badge" unit test in `parse.test.ts` rather than silently dropped,
> so this residual is recorded rather than rediscovered later.
>
> **The shared cross-repo case table** the previous amendment flagged as an
> unpursued candidate follow-up now exists:
> `src/markdown/__tests__/blockAnchorCases.ts` exports
> `BLOCK_ANCHOR_POSITION_CASES`, an id/position table asserted in full by a
> single `it.each` in `parse.test.ts`, pinned against the resolver's actual,
> merged `ANCHOR_LINE_PATTERN` (`liminis-app/src/main/fs.ts`, main @
> `19330368`). Scope is id/position combinations only; the wrapper/charset
> cases #127 added stay in their own `it.each` blocks. A future divergence
> between this repository's position rule and the resolver's now fails a
> test in this table rather than shipping as a live defect, the way both
> #124's and this issue's own gaps originally did.

## References

- Issue #122 (this decision)
- Issue #124 (2026-09-09 amendment above — widened detection beyond ULID)
- Issue #127 (2026-09-10 amendment above — widened Branch B to badge
  emphasis-wrapped ids, for parity with `verveguy/liminis#1114`)
- `docs/markdown-pipeline.md` ("Block anchor badges (#122, widened by #124
  and #127)" section — the detection regex, the wrapper extension, the
  post-parse text-split technique, and the round-trip contract)
- `docs/decisions/adr-119-block-transclusion.md` (the `#^blockId` reference-
  side pattern this issue's regex is deliberately narrower than, and the
  embed-marker sentinel technique this issue's post-parse approach is
  contrasted against)
- `src/markdown/vendor/mdast-util-wiki-link/from-markdown.ts` (`BLOCK_ID_PATTERN`,
  the reference-side pattern cited above)
- `src/app/mapper/__tests__/fixtures/roundtrip/122-block-anchor/` (the
  round-trip fixture corpus backing FR-002/SC-002/SC-004/SC-005, including
  `checkbox-anchor-formatted.md`'s wrapped-ULID case FR-3/SC-002 (#127)
  keeps passing)
