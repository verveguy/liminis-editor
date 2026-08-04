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
import { join } from 'node:path';
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

      expect(byName['exempted'].idempotenceExempt).toBe('Reason.');
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
});
