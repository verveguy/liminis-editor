/**
 * Liminis #973 (FR-007): real in-repo documents whose `**bold**` abuts an
 * inline-code span must round-trip to a fixed point.
 *
 * The synthetic `973-*` fixtures are minimal by construction. This suite is the
 * counterweight: it runs the same pipeline over the project's own ADRs, which
 * mix bold and inline code freely inside tables, definition lists, nested lists
 * and raw HTML. Those are the documents the issue reported as being corrupted
 * by a no-op save, so they are the documents the fix has to hold for.
 *
 * **Second pass == first pass only.** This deliberately does *not* assert that
 * the first pass equals the source bytes. The ADRs contain constructs that hit
 * unrelated, already-accepted normalizations (the `known-defects/` corpus
 * records them); asserting byte-identity with the source would fail for reasons
 * that have nothing to do with this issue. Idempotence is the property #973 is
 * about, and the property ADR-076 guarantees.
 *
 * **Anti-vacuity.** Reading live repository files means the coverage can
 * silently evaporate — someone edits the ADRs, the pattern disappears, and the
 * assertions keep passing while testing nothing. So the suite proves its own
 * coverage before trusting it: the discovered set must be non-empty and at or
 * above a floor, and every document is re-checked for the pattern immediately
 * before its fixed point is asserted. Precedent: the corpus-wide anti-vacuity
 * counters in `annotated-serialize-corpus.test.ts`.
 *
 * This is a deliberate, test-only read outside the package boundary (ADR-075):
 * `@liminis/editor` ships without these documents, and the point of the
 * requirement is that they are *real*, not copies. The path is resolved from
 * `import.meta.url` rather than `process.cwd()` so it survives being run from
 * any directory.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roundTrip, formatUnifiedDiff } from './roundtrip-test-utils';

const here = dirname(fileURLToPath(import.meta.url));
// packages/editor/src/app/mapper/__tests__ -> repo root
const REPO_ROOT = join(here, '..', '..', '..', '..', '..', '..');
const ADR_DIR = join(REPO_ROOT, 'docs', 'project_notes', 'decisions');

/**
 * `**bold**` with an inline-code span *inside* it — the shape #973 breaks.
 *
 * Standalone adjacency (a separate `**bold**` merely sitting next to a separate
 * `` `code` `` span) is not the defect and has no regression value here, so it
 * deliberately does not match: the `[^*\n]*` arms keep the match inside a single
 * bold run on a single line.
 */
const INTERIOR_MIXED = /\*\*[^*\n]*`[^`\n]+`[^*\n]*\*\*/;

/**
 * Documents excluded from the fixed-point assertion, each with a diagnosed
 * reason — mirroring the `.idempotence-exempt.txt` convention that ADR-076
 * requires be "individually documented, never batched".
 *
 * This is not a dumping ground. An entry belongs here only when the instability
 * is traced to a *specific* defect unrelated to #973. If this map grows past a
 * handful, or an entry cannot be diagnosed, that is evidence the fix is wrong
 * rather than evidence the document is unusual.
 */
const EXCLUSIONS: Record<string, string> = {
  'adr-021.md':
    'Pre-existing escape-stability defect, unrelated to #973 and not fixed by it — verified by ' +
    'running this document through the mapper at c02b9779 (the commit before the #973 fix), ' +
    'where it drifts identically. The document contains runs like ' +
    '`**The SDK does NOT read **`mcp-oauth.json`` whose closing `**` is preceded by a space, so ' +
    'CommonMark\'s right-flanking rule refuses it as a closer and the asterisks are literal text. ' +
    'The first pass emits them bare and the second pass escapes them to `\\*\\*`, so the document ' +
    'is not a fixed point. That is a stringifier escaping concern, explicitly out of scope here ' +
    '(see the `## The 973-* fixture set` section of the fixture README); tracked separately.',
};

/** The floor the discovered set must clear, well under the 32 documents that match today. */
const MINIMUM_DOCUMENTS = 10;

function discoverAdrs(): string[] {
  if (!existsSync(ADR_DIR)) return [];
  return readdirSync(ADR_DIR)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => INTERIOR_MIXED.test(readFileSync(join(ADR_DIR, name), 'utf8')))
    .sort();
}

const documents = discoverAdrs();

describe('#973: real ADRs with bold abutting inline code round-trip to a fixed point', () => {
  it('finds the ADR directory (guards against a moved or renamed path)', () => {
    expect(existsSync(ADR_DIR), `ADR directory not found at ${ADR_DIR}`).toBe(true);
  });

  it('discovers documents exhibiting the pattern (guards against a silently empty suite)', () => {
    expect(documents.length).toBeGreaterThan(0);
    expect(
      documents.length,
      `only ${documents.length} ADRs still contain the interior bold-around-code pattern ` +
        `(expected at least ${MINIMUM_DOCUMENTS}). If the ADRs genuinely changed, lower the ` +
        `floor deliberately — do not let this suite quietly stop covering the defect.`,
    ).toBeGreaterThanOrEqual(MINIMUM_DOCUMENTS);
  });

  it('documents every exclusion with a reason', () => {
    for (const [name, reason] of Object.entries(EXCLUSIONS)) {
      expect(reason.trim(), `exclusion for ${name} needs a diagnosed reason`).not.toBe('');
    }
  });

  for (const name of documents) {
    const exclusion = EXCLUSIONS[name];
    const test = exclusion ? it.skip : it;

    test(`${name} is a fixed point`, async () => {
      const source = readFileSync(join(ADR_DIR, name), 'utf8');

      // Re-assert coverage per document, immediately before relying on it, so a
      // future edit that removes the pattern turns this red rather than leaving
      // a passing assertion that proves nothing.
      expect(INTERIOR_MIXED.test(source), `${name} no longer exhibits the pattern`).toBe(true);

      const { output: first } = await roundTrip(source);
      const { output: second } = await roundTrip(first);

      if (second !== first) {
        throw new Error(formatUnifiedDiff(first, second, `${name} (second pass)`));
      }
    });
  }
});
