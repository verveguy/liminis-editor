/**
 * Shared id/position case table for block-anchor badge detection (#126,
 * FR-005). `parse.test.ts` asserts every row via a single `it.each`, so a
 * future change to this repository's position rule that silently diverges
 * from the resolver's fails a test instead of shipping as a live defect —
 * as happened twice already: #124's original ULID-vs-everything-else gap,
 * and this issue's own Branch-A ULID-position gap.
 *
 * Pinned against the resolver's actual, merged `ANCHOR_LINE_PATTERN`
 * (`verveguy/liminis`, `liminis-app/src/main/fs.ts`, main @ 19330368):
 * `/(?:^|\s)\^([^\s\]#]+)\s*$/`. Scope is id/position combinations only —
 * wrapper/charset cases (#127) are that issue's territory and stay in their
 * own `it.each` blocks under `describe('block anchor badges -
 * emphasis-wrapped (#127)')`. If either suite's cases change, check the
 * other — see `liminis-app/src/main/__tests__/fs-transclusion.test.ts`.
 */
export interface BlockAnchorPositionCase {
  markdown: string
  shouldBadge: boolean
  note: string
}

export const BLOCK_ANCHOR_POSITION_CASES: BlockAnchorPositionCase[] = [
  // Accepted: id at end of line, preceded by whitespace — the real-authoring
  // shape, regardless of id form (ULID included, #126: no carve-out).
  { markdown: 'Draft the boundary doc ^01M00VDX0S4JHMDNA7F776Y8R8', shouldBadge: true, note: 'ULID at line end' },
  { markdown: 'Ship the thing ^01KKE2V4H0B2DRJ6CEER5S4E6F', shouldBadge: true, note: 'ULID at line end' },
  { markdown: 'Ship the thing ^1867432905318744064', shouldBadge: true, note: 'raw-decimal snowflake at line end' },
  { markdown: 'A block. ^V1StGXR8_Z5jdHi6B-myT', shouldBadge: true, note: 'NanoID-shaped id at line end' },
  { markdown: 'A block. ^2Xq9vBc1aZk', shouldBadge: true, note: 'mixed-case base62 id at line end' },

  // Rejected: caret does not start a token, or the id does not run to end of
  // line — the resolver can never address these, regardless of id form.
  { markdown: 'x^2', shouldBadge: false, note: 'caret mid-word, not a token start' },
  { markdown: '2^10', shouldBadge: false, note: 'caret mid-word, not a token start' },
  { markdown: 'a ^ b', shouldBadge: false, note: 'empty capture, more prose after' },
  { markdown: 'mc^2', shouldBadge: false, note: 'caret mid-word, not a token start' },
  { markdown: '10^100', shouldBadge: false, note: 'caret mid-word, not a token start' },
  { markdown: 'The value is 2^10', shouldBadge: false, note: 'caret mid-word, not a token start' },
  { markdown: 'The value is 2^10 today', shouldBadge: false, note: 'caret mid-word, more prose after' },
  { markdown: 'A googol is 10^100', shouldBadge: false, note: 'caret mid-word, not a token start' },
  { markdown: 'Einstein wrote mc^2', shouldBadge: false, note: 'caret mid-word, not a token start' },
  { markdown: 'Compare a ^ b here', shouldBadge: false, note: 'empty capture, more prose after' },

  // #126: mid-line ULID definitions are not a real authored shape — they
  // could never be resolved, so they must not badge either. This is the
  // defect this issue closes (the inverse of #124's).
  {
    markdown: 'The decision was recorded here ^01M00VDX0S4JHMDNA7F776Y8R8 and continues.',
    shouldBadge: false,
    note: '#126: ULID mid-line, more prose after — the core fix',
  },
  // #126: a caret with zero preceding whitespace, immediately after a
  // wiki-link, can never satisfy the left-boundary rule no matter where it
  // sits on the line — a space before the caret is required, not just
  // end-of-line placement.
  {
    markdown: 'See [[notes]]^01M00VDX0S4JHMDNA7F776Y8R8',
    shouldBadge: false,
    note: '#126: ULID immediately after a wiki-link, zero preceding space',
  },
  {
    markdown: 'See [[notes]] ^01M00VDX0S4JHMDNA7F776Y8R8',
    shouldBadge: true,
    note: '#126: ULID after a wiki-link, one preceding space, at line end',
  },
]
