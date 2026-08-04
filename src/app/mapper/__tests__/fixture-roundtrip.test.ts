/**
 * Fixture-driven round-trip test corpus (#896).
 *
 * Discovers every `*.md` fixture under `fixtures/roundtrip/` and runs it through
 * the real production pipeline: parseMarkdown -> importMarkdownToLexical ->
 * exportLexicalToMdast -> stringifyMarkdown. No fixture list is hardcoded here —
 * add a `.md` file to the fixtures directory and it is picked up automatically.
 *
 * See fixtures/roundtrip/README.md for the fixture/sidecar conventions.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discoverFixtures, roundTrip, formatUnifiedDiff, type FixtureEntry } from './roundtrip-test-utils';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, 'fixtures', 'roundtrip');

const fixtures = discoverFixtures(FIXTURES_DIR);

function groupName(fixture: FixtureEntry): string {
  const slash = fixture.name.lastIndexOf('/');
  return slash === -1 ? '(root)' : fixture.name.slice(0, slash);
}

function leafName(fixture: FixtureEntry): string {
  const slash = fixture.name.lastIndexOf('/');
  return slash === -1 ? fixture.name : fixture.name.slice(slash + 1);
}

describe('Markdown round-trip fixture corpus', () => {
  it('discovers at least one fixture', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  const groups = new Map<string, FixtureEntry[]>();
  for (const fixture of fixtures) {
    const group = groupName(fixture);
    const list = groups.get(group) ?? [];
    list.push(fixture);
    groups.set(group, list);
  }

  for (const [group, entries] of groups) {
    describe(group, () => {
      for (const fixture of entries) {
        it(leafName(fixture), async () => {
          if (fixture.expectedError !== null) {
            await expect(roundTrip(fixture.input)).rejects.toThrow(fixture.expectedError);
            return;
          }

          const { output } = await roundTrip(fixture.input);
          const expected = fixture.expected ?? fixture.input;
          if (output !== expected) {
            throw new Error(formatUnifiedDiff(expected, output, fixture.name));
          }

          // Idempotence (#943 FR-003): round-tripping the already-canonical output a
          // second time with no edits must be a no-op fixed point, even for fixtures
          // whose first pass legitimately changed bytes (.expected.md sidecars).
          // Skipped for fixtures carrying a documented `.idempotence-exempt.txt`
          // sidecar (see fixtures/roundtrip/README.md) — a pre-existing, out-of-scope
          // normalization, not new non-idempotency introduced by this fix.
          if (fixture.idempotenceExempt !== null) {
            return;
          }
          const { output: secondOutput } = await roundTrip(output);
          if (secondOutput !== output) {
            throw new Error(formatUnifiedDiff(output, secondOutput, `${fixture.name} (second pass)`));
          }
        });
      }
    });
  }
});
