/**
 * Unit tests for `discoverFixtures`' sidecar handling (#943).
 *
 * The `.idempotence-exempt.txt` empty-file rejection is the mechanism that enforces
 * FR-004's "each exemption MUST state why" and SC-006 — without it, an exemption could
 * be added silently to get a fixture green. That guard is load-bearing, so it gets
 * direct coverage here rather than relying on the corpus (which only ever exercises the
 * non-empty path).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverFixtures } from './roundtrip-test-utils';

describe('discoverFixtures', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'roundtrip-fixtures-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeFixture(name: string, contents = 'Body.\n'): void {
    writeFileSync(join(dir, `${name}.md`), contents, 'utf-8');
  }

  describe('.idempotence-exempt.txt sidecars', () => {
    it('leaves idempotenceExempt null when no sidecar exists', () => {
      writeFixture('plain');

      const [fixture] = discoverFixtures(dir);

      expect(fixture.name).toBe('plain');
      expect(fixture.idempotenceExempt).toBeNull();
    });

    it('reads and trims a non-empty reason', () => {
      writeFixture('exempted');
      writeFileSync(join(dir, 'exempted.idempotence-exempt.txt'), '\n  A documented reason.\n\n', 'utf-8');

      const [fixture] = discoverFixtures(dir);

      expect(fixture.idempotenceExempt).toBe('A documented reason.');
    });

    it('throws when the sidecar is empty', () => {
      writeFixture('empty-reason');
      writeFileSync(join(dir, 'empty-reason.idempotence-exempt.txt'), '', 'utf-8');

      expect(() => discoverFixtures(dir)).toThrow(/must state a reason/);
    });

    it('throws when the sidecar is whitespace-only', () => {
      writeFixture('blank-reason');
      writeFileSync(join(dir, 'blank-reason.idempotence-exempt.txt'), '   \n\t\n', 'utf-8');

      expect(() => discoverFixtures(dir)).toThrow(/must state a reason/);
    });

    it('names the offending sidecar in the error, so the failure is actionable', () => {
      writeFixture('blank-reason');
      writeFileSync(join(dir, 'blank-reason.idempotence-exempt.txt'), '', 'utf-8');

      expect(() => discoverFixtures(dir)).toThrow(/blank-reason\.idempotence-exempt\.txt/);
    });

    it('applies per fixture, not per directory', () => {
      writeFixture('exempted');
      writeFixture('not-exempted');
      writeFileSync(join(dir, 'exempted.idempotence-exempt.txt'), 'Reason.\n', 'utf-8');

      const byName = Object.fromEntries(discoverFixtures(dir).map((f) => [f.name, f]));

      expect(byName.exempted.idempotenceExempt).toBe('Reason.');
      expect(byName['not-exempted'].idempotenceExempt).toBeNull();
    });

    it('resolves sidecars in subdirectories against the fixture, not the root', () => {
      mkdirSync(join(dir, 'group'));
      writeFileSync(join(dir, 'group', 'nested.md'), 'Body.\n', 'utf-8');
      writeFileSync(join(dir, 'group', 'nested.idempotence-exempt.txt'), 'Nested reason.\n', 'utf-8');

      const [fixture] = discoverFixtures(dir);

      expect(fixture.name).toBe('group/nested');
      expect(fixture.idempotenceExempt).toBe('Nested reason.');
    });

    it('does not pick the sidecar up as a fixture of its own', () => {
      writeFixture('exempted');
      writeFileSync(join(dir, 'exempted.idempotence-exempt.txt'), 'Reason.\n', 'utf-8');

      expect(discoverFixtures(dir).map((f) => f.name)).toEqual(['exempted']);
    });
  });

  describe('the real corpus', () => {
    const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'roundtrip');

    // Both fixtures/roundtrip/README.md and ADR-076 state that the exemption set is
    // exactly the five #902 hard-break fixtures, and that no `known-defects/` fixture is
    // exempt (asserting a defective output does not stop that output being a stable fixed
    // point). Those are load-bearing claims — they are the evidence that FR-004's "do not
    // batch-exempt to get green" was honoured — but nothing verified them, so a sixth
    // exemption could be added without either document noticing. These pin the membership
    // of the set rather than its size, so adding fixtures does not churn them; adding an
    // *exemption* deliberately fails, which is the point.
    it('exempts exactly the five documented #902 hard-break fixtures', () => {
      const exempt = discoverFixtures(CORPUS_DIR)
        .filter((f) => f.idempotenceExempt !== null)
        .map((f) => f.name)
        .sort();

      expect(exempt).toEqual([
        '902-list-item-double-hard-break',
        '902-list-item-double-hard-break/double-break-adjacent-to-boundary',
        '902-list-item-double-hard-break/nested-list-double-break',
        '902-list-item-double-hard-break/task-list-double-break',
        '902-list-item-double-hard-break/triple-hard-breaks',
      ]);
    });

    it('exempts no known-defects fixture', () => {
      const exemptKnownDefects = discoverFixtures(CORPUS_DIR).filter(
        (f) => f.name.startsWith('known-defects/') && f.idempotenceExempt !== null,
      );

      expect(exemptKnownDefects.map((f) => f.name)).toEqual([]);
    });

    it('gives every exemption a non-empty written reason', () => {
      const exempt = discoverFixtures(CORPUS_DIR).filter((f) => f.idempotenceExempt !== null);

      expect(exempt.length).toBeGreaterThan(0);
      for (const fixture of exempt) {
        expect(fixture.idempotenceExempt, `${fixture.name} has an empty reason`).toBeTruthy();
      }
    });
  });
});
