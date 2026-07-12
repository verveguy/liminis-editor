/**
 * Regression gate for #897 (block content inside list items) that also exercises
 * @lexical/list's registerList() — the ListNode/ListItemNode transforms the production
 * editor installs via <ListPlugin /> (Editor.tsx), which fixture-roundtrip.test.ts's
 * plain harness never runs. Runs the same fixtures through a plugin-enabled editor to
 * confirm the fix survives them too, not just the pure conversion functions in isolation.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discoverFixtures, roundTrip, formatUnifiedDiff, type FixtureEntry } from './roundtrip-test-utils';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, 'fixtures', 'roundtrip');

const fixtures = discoverFixtures(FIXTURES_DIR).filter(
  (fixture) => fixture.name.startsWith('known-defects/897-') || fixture.name.startsWith('897-list-item-block-content/'),
);

function leafName(fixture: FixtureEntry): string {
  const slash = fixture.name.lastIndexOf('/');
  return slash === -1 ? fixture.name : fixture.name.slice(slash + 1);
}

describe('List item block content (#897) with registerList() active', () => {
  it('discovers the #897 fixture set', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    it(leafName(fixture), async () => {
      const { output } = await roundTrip(fixture.input, { registerListPlugin: true });
      const expected = fixture.expected ?? fixture.input;
      if (output !== expected) {
        throw new Error(formatUnifiedDiff(expected, output, fixture.name));
      }
    });
  }
});
