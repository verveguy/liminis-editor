/**
 * Hand-written type declarations for `lockfile-drift.mjs`, kept plain JS per
 * `scripts/lib/`'s existing convention rather than introducing a build step.
 * Consumed by `tests/lockfile-drift.test.ts`, which is type-checked as part of
 * `tests/**` under `tsconfig.json`.
 */

export interface QueryTarget {
  kind: 'query';
  /** The package to ask the registry about — the alias target, if aliased. */
  queryName: string;
  /** The range to satisfy — the alias's range, if aliased. */
  queryRange: string;
}

export interface SkipTarget {
  kind: 'skip';
  reason: string;
}

export function resolveQuery(name: string, range: unknown): QueryTarget | SkipTarget;

export function stripPeerSuffix(version: string): string;

export interface DriftEntry {
  name: string;
  queryName: string;
  range: string;
  pinned: string;
  newest: string;
  tracked: boolean;
}

export interface SkipEntry {
  name: string;
  reason: string;
}

export function analyzeDrift(options: {
  declared: Record<string, string>;
  locked: Record<string, { version: string }>;
  /** Published versions for a package, or throws. Must never return [] to mean "failed". */
  versionsFor: (name: string) => string[];
  isTracked: (name: string) => boolean;
}): { drift: DriftEntry[]; skipped: SkipEntry[] };
