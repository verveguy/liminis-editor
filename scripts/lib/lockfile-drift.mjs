/**
 * The comparison behind `scripts/check-lockfile-drift.mjs`, separated from it so
 * it can be tested. Everything here is pure: the registry is injected as
 * `versionsFor`, so a test can supply a fake one — including one that throws,
 * which is the case that matters most.
 */
import semver from 'semver';

/** Ranges that do not resolve against a registry and therefore cannot drift. */
const NON_REGISTRY = /^(workspace:|file:|link:|catalog:|git\+|github:|https?:)/;

/**
 * Resolve what to actually ask the registry about.
 *
 * `"foo": "npm:bar@^1.0.0"` installs `bar` under the local name `foo`. Asking
 * the registry about `foo` would query the wrong package — at best a 404, at
 * worst a real but unrelated package whose versions are meaningless here. No
 * alias exists in this repo today; this is here so that adding one does not
 * silently produce a wrong answer.
 */
export function resolveQuery(name, range) {
  if (typeof range !== 'string') return { kind: 'skip', reason: 'range is not a string' };

  if (range.startsWith('npm:')) {
    const spec = range.slice(4);
    // The name may itself be scoped (`npm:@scope/pkg@^1.0.0`), so split on the
    // last `@` rather than the first.
    const at = spec.lastIndexOf('@');
    if (at <= 0) return { kind: 'skip', reason: `unparseable alias '${range}'` };
    const aliasName = spec.slice(0, at);
    const aliasRange = spec.slice(at + 1);
    if (NON_REGISTRY.test(aliasRange)) return { kind: 'skip', reason: `alias target '${aliasRange}' is not registry-resolvable` };
    return { kind: 'query', queryName: aliasName, queryRange: aliasRange };
  }

  if (NON_REGISTRY.test(range)) return { kind: 'skip', reason: range };
  return { kind: 'query', queryName: name, queryRange: range };
}

/** pnpm records peer context in the pinned version: `0.1.5(react@19.2.8)`. */
export const stripPeerSuffix = (version) => String(version).replace(/\(.*$/, '');

/**
 * Compare each declared range against the newest version the registry admits.
 *
 * `versionsFor(name)` must return the package's published versions, or throw.
 * It is never allowed to signal failure by returning empty: a check that cannot
 * distinguish "did not look" from "looked and found nothing" eventually reports
 * the wrong thing, so a throw propagates and the caller fails.
 */
export function analyzeDrift({ declared, locked, versionsFor, isTracked }) {
  const drift = [];
  const skipped = [];

  for (const [name, range] of Object.entries(declared)) {
    const q = resolveQuery(name, range);
    if (q.kind === 'skip') { skipped.push({ name, reason: q.reason }); continue; }

    const entry = locked[name];
    if (!entry) { skipped.push({ name, reason: 'not in lockfile' }); continue; }

    const pinned = stripPeerSuffix(entry.version);
    if (!semver.valid(pinned)) { skipped.push({ name, reason: `unparseable pinned version '${pinned}'` }); continue; }

    const available = versionsFor(q.queryName);
    const newest = semver.maxSatisfying(semver.sort(available), q.queryRange, { includePrerelease: false });
    if (!newest) { skipped.push({ name, reason: `${q.queryRange} matches nothing published` }); continue; }

    if (semver.lt(pinned, newest)) {
      drift.push({ name, queryName: q.queryName, range: q.queryRange, pinned, newest, tracked: isTracked(name) });
    }
  }

  return { drift, skipped };
}
