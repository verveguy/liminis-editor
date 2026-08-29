/**
 * Fails when the lockfile pins a version older than the declared range already
 * admits — the gap between "what package.json permits" and "what actually
 * installs".
 *
 * This exists because that gap has bitten this project three times in one week,
 * and each time it was invisible until someone unpacked what a fresh install
 * really resolved:
 *
 *   - `@liminis/editor@^0.1.0` kept resolving a 0.1.0 whose entry points did
 *     not exist in its own tarball, after 0.1.1 had fixed it.
 *   - `@liminis/diagrams@^0.1.0` stayed on 0.1.0 while 0.1.1 fixed drag on
 *     touch devices — a bug this package passed straight through to its hosts.
 *   - `@liminis/diagrams@^0.1.1` stayed on 0.1.1 through four releases,
 *     including one making server-rendered SVG byte-identical across platforms.
 *
 * A caret range reads like "we take the fixes". `--frozen-lockfile` — correctly,
 * for reproducibility — means CI takes whatever was resolved last, so the range
 * is a statement of intent that nothing enforces. Every one of those three was
 * a fix we had deliberately cut a release for and then did not consume.
 *
 * Third-party drift is not treated the same way. Pinning a third-party
 * dependency behind its range is ordinary and often deliberate, so those are
 * reported and do not fail. Only packages matching TRACKED fail the check:
 * those are the ones this project publishes, where a release exists precisely
 * to be consumed and lagging behind it is a defect rather than a choice.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import semver from 'semver';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Packages whose drift is a defect, not a preference. */
const TRACKED = [/^@liminis\//];

/** Ranges that do not resolve against a registry and cannot drift. */
const NON_REGISTRY = /^(workspace:|file:|link:|catalog:|npm:.*@(workspace|file|link):|git\+|github:|https?:)/;

const strikeThroughPeers = (v) => v.replace(/\(.*$/, '');

function registryVersions(name) {
  // `npm view <pkg> versions --json` returns a JSON array. It can also return
  // an object with an `error` key AND exit 0, so the exit code is not a usable
  // signal — check the shape.
  let raw;
  try {
    raw = execFileSync('npm', ['view', name, 'versions', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
  } catch (err) {
    // A network or registry failure must fail the check, not pass it. A check
    // that cannot tell "did not look" from "looked and found nothing" will
    // eventually report the wrong thing.
    throw new Error(`could not reach the registry for ${name}: ${err.message.split('\n')[0]}`);
  }
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error) {
    throw new Error(`registry error for ${name}: ${parsed.error.summary ?? parsed.error.code}`);
  }
  // Registry order is publish order, not semver order — a late patch to an
  // older line sorts last. Sort properly rather than taking the final element.
  return semver.sort(Array.isArray(parsed) ? parsed : [parsed]);
}

function main() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const lock = parseYaml(readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf8'));
  const importer = lock.importers?.['.'];
  if (!importer) throw new Error("pnpm-lock.yaml has no '.' importer — is this a pnpm workspace root?");

  const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const locked = { ...(importer.dependencies ?? {}), ...(importer.devDependencies ?? {}) };

  const drift = [];
  const skipped = [];

  for (const [name, range] of Object.entries(declared)) {
    if (NON_REGISTRY.test(range)) { skipped.push(`${name} (${range})`); continue; }
    const entry = locked[name];
    if (!entry) { skipped.push(`${name} (not in lockfile)`); continue; }

    const pinned = strikeThroughPeers(String(entry.version));
    const newest = semver.maxSatisfying(registryVersions(name), range, { includePrerelease: false });
    if (!newest) { skipped.push(`${name} (${range} matches nothing on the registry)`); continue; }

    if (semver.lt(pinned, newest)) {
      drift.push({ name, range, pinned, newest, tracked: TRACKED.some((re) => re.test(name)) });
    }
  }

  const failing = drift.filter((d) => d.tracked);
  const informational = drift.filter((d) => !d.tracked);

  if (informational.length) {
    console.log(`\nBehind their range (not failing — third-party pins are often deliberate):`);
    for (const d of informational) console.log(`  ${d.name}  ${d.range}  pinned ${d.pinned}  ->  ${d.newest} available`);
  }

  if (failing.length) {
    console.error(`\nFAIL: ${failing.length} first-party dependenc${failing.length === 1 ? 'y is' : 'ies are'} behind a release we cut:`);
    for (const d of failing) console.error(`  ${d.name}  ${d.range}  pinned ${d.pinned}  ->  ${d.newest} available`);
    console.error(`\nRefreshing the lockfile is not enough on its own: raise the range too, so a`);
    console.error(`stale lockfile cannot silently drift back. For each package above:`);
    for (const d of failing) console.error(`  pnpm add ${d.name}@^${d.newest}`);
    process.exit(1);
  }

  console.log(`\nOK: no first-party dependency is behind its range.`);
  if (skipped.length) console.log(`Skipped (not registry-resolvable): ${skipped.join(', ')}`);
}

main();
