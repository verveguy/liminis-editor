/**
 * The drift check exists to catch a defect that has occurred three times in
 * this project, so its own behaviour needs pinning — PR #118 originally claimed
 * these cases were "mutation-tested" on the strength of a by-hand session,
 * which protects nothing once the session ends (review finding, pruefer).
 *
 * The registry is injected, so every case here is deterministic and offline.
 */
import { describe, it, expect } from 'vitest';
import { analyzeDrift, resolveQuery, stripPeerSuffix } from '../scripts/lib/lockfile-drift.mjs';

/** A fake registry. Any package it does not know about throws, as the real one does. */
const registry = (table: Record<string, string[]>) => (name: string) => {
  if (!(name in table)) throw new Error(`could not reach the registry for ${name}`);
  return table[name];
};

const firstParty = (name: string) => name.startsWith('@liminis/');

describe('analyzeDrift', () => {
  it('flags a first-party package pinned behind its range — the 2026-08-26 case', () => {
    // Range ^0.1.1, lockfile 0.1.1, four releases published since.
    const { drift } = analyzeDrift({
      declared: { '@liminis/diagrams': '^0.1.1' },
      locked: { '@liminis/diagrams': { version: '0.1.1(react-dom@19.2.8(react@19.2.8))' } },
      versionsFor: registry({ '@liminis/diagrams': ['0.1.0', '0.1.1', '0.1.2', '0.1.3', '0.1.4', '0.1.5'] }),
      isTracked: firstParty,
    });
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ name: '@liminis/diagrams', pinned: '0.1.1', newest: '0.1.5', tracked: true });
  });

  it('does not flag a package already pinned at the newest the range admits', () => {
    const { drift } = analyzeDrift({
      declared: { '@liminis/diagrams': '^0.1.5' },
      locked: { '@liminis/diagrams': { version: '0.1.5(react@19.2.8)' } },
      versionsFor: registry({ '@liminis/diagrams': ['0.1.1', '0.1.5'] }),
      isTracked: firstParty,
    });
    expect(drift).toEqual([]);
  });

  it('does not treat a version outside the range as available — ^0.1.1 must not reach 0.2.0', () => {
    const { drift } = analyzeDrift({
      declared: { '@liminis/diagrams': '^0.1.1' },
      locked: { '@liminis/diagrams': { version: '0.1.5' } },
      versionsFor: registry({ '@liminis/diagrams': ['0.1.5', '0.2.0', '1.0.0'] }),
      isTracked: firstParty,
    });
    expect(drift).toEqual([]);
  });

  it('marks third-party drift as untracked so the caller can report without failing', () => {
    const { drift } = analyzeDrift({
      declared: { lucide: '^1.11.0', '@liminis/diagrams': '^0.1.1' },
      locked: { lucide: { version: '1.31.0' }, '@liminis/diagrams': { version: '0.1.1' } },
      versionsFor: registry({ lucide: ['1.31.0', '1.35.0'], '@liminis/diagrams': ['0.1.1', '0.1.5'] }),
      isTracked: firstParty,
    });
    expect(drift.find((d) => d.name === 'lucide')?.tracked).toBe(false);
    expect(drift.find((d) => d.name === '@liminis/diagrams')?.tracked).toBe(true);
  });

  it('propagates a registry failure rather than reporting no drift (FR: fail closed)', () => {
    // The case that matters most: a check that cannot distinguish "did not
    // look" from "looked and found nothing" eventually reports the wrong thing.
    expect(() =>
      analyzeDrift({
        declared: { '@liminis/diagrams': '^0.1.1' },
        locked: { '@liminis/diagrams': { version: '0.1.1' } },
        versionsFor: registry({}), // knows nothing; throws
        isTracked: firstParty,
      }),
    ).toThrow(/could not reach the registry/);
  });

  it('sorts by semver, not by the registry\'s publish order', () => {
    // 0.2.1 is published AFTER 0.2.2 — a patch backported to an older release
    // line — so it sorts last in the registry's array while being the lower
    // version. Both are inside ^0.2.0, so a "take the last match" implementation
    // answers 0.2.1 where the semver maximum is 0.2.2.
    //
    // The out-of-range entry matters: an earlier version of this test used
    // 0.1.9, which ^0.2.0 filters out before ordering can matter, so it passed
    // against a deliberately broken implementation and proved nothing.
    const { drift } = analyzeDrift({
      declared: { '@liminis/diagrams': '^0.2.0' },
      locked: { '@liminis/diagrams': { version: '0.2.0' } },
      versionsFor: registry({ '@liminis/diagrams': ['0.2.0', '0.2.2', '0.2.1'] }),
      isTracked: firstParty,
    });
    expect(drift[0]?.newest).toBe('0.2.2');
  });

  it('skips a declared package that is absent from the lockfile instead of assuming it is fine', () => {
    const { drift, skipped } = analyzeDrift({
      declared: { '@liminis/diagrams': '^0.1.1' },
      locked: {},
      versionsFor: registry({ '@liminis/diagrams': ['0.1.5'] }),
      isTracked: firstParty,
    });
    expect(drift).toEqual([]);
    expect(skipped).toEqual([{ name: '@liminis/diagrams', reason: 'not in lockfile' }]);
  });

  it('skips non-registry protocols, which cannot drift', () => {
    const { skipped } = analyzeDrift({
      declared: { '@liminis/shared-types': 'workspace:*', local: 'file:../x', forked: 'github:o/r' },
      locked: {},
      versionsFor: registry({}),
      isTracked: firstParty,
    });
    expect(skipped.map((s) => s.name).sort()).toEqual(['@liminis/shared-types', 'forked', 'local']);
  });
});

describe('resolveQuery — npm: aliases', () => {
  it('queries the alias target, not the local name', () => {
    // `"foo": "npm:bar@^1.0.0"` installs bar. Asking the registry about `foo`
    // would query a different package, whose versions mean nothing here.
    expect(resolveQuery('foo', 'npm:bar@^1.0.0')).toEqual({
      kind: 'query', queryName: 'bar', queryRange: '^1.0.0',
    });
  });

  it('handles a scoped alias target, whose name itself contains @', () => {
    expect(resolveQuery('outline', 'npm:@liminis/editor@^0.4.1')).toEqual({
      kind: 'query', queryName: '@liminis/editor', queryRange: '^0.4.1',
    });
  });

  it('skips an alias pointing at a non-registry target', () => {
    expect(resolveQuery('x', 'npm:y@workspace:*').kind).toBe('skip');
  });

  it('passes a plain range through unchanged', () => {
    expect(resolveQuery('lucide', '^1.11.0')).toEqual({
      kind: 'query', queryName: 'lucide', queryRange: '^1.11.0',
    });
  });
});

describe('stripPeerSuffix', () => {
  it("removes pnpm's peer context from a pinned version", () => {
    expect(stripPeerSuffix('0.1.5(react-dom@19.2.8(react@19.2.8))(react@19.2.8)')).toBe('0.1.5');
    expect(stripPeerSuffix('4.1.3')).toBe('4.1.3');
  });
});
