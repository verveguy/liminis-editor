/**
 * Fails when the lockfile pins a version older than the declared range already
 * admits — the gap between "what package.json permits" and "what installs".
 *
 * This exists because that gap bit this project three times in one week, and
 * each time it was invisible until someone unpacked what a fresh install really
 * resolved:
 *
 *   - `@liminis/editor@^0.1.0` kept resolving a 0.1.0 whose entry points did
 *     not exist in its own tarball, after 0.1.1 had fixed it.
 *   - `@liminis/diagrams@^0.1.0` stayed on 0.1.0 while 0.1.1 fixed drag on
 *     touch devices — a bug this package passed straight through to its hosts.
 *   - `@liminis/diagrams@^0.1.1` stayed on 0.1.1 through four releases,
 *     including one making server-rendered SVG byte-identical across platforms.
 *
 * A caret range reads like "we take the fixes". `--frozen-lockfile` —
 * correctly, for reproducibility — means CI takes whatever was resolved last,
 * so the range states an intent that nothing enforces.
 *
 * Only packages matching TRACKED fail. Third-party drift is reported and
 * tolerated: pinning behind a range is ordinary there, and enough of it exists
 * that failing on any drift would be noise. TRACKED names the packages this
 * project publishes, where a release exists precisely to be consumed.
 *
 * The comparison itself lives in scripts/lib/lockfile-drift.mjs so it can be
 * tested; this file is the wiring — read the manifest, read the lockfile, ask
 * the registry, print.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { analyzeDrift } from './lib/lockfile-drift.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Packages whose drift is a defect rather than a preference. */
const TRACKED = [/^@liminis\//];

function registryVersions(name) {
  let raw;
  try {
    raw = execFileSync('npm', ['view', name, 'versions', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
  } catch (err) {
    // Throw rather than return []: an unreachable registry must fail the check,
    // not quietly pass it.
    throw new Error(`could not reach the registry for ${name}: ${err.message.split('\n')[0]}`);
  }
  const parsed = JSON.parse(raw);
  // `npm view` can report a miss as an object with an `error` key AND exit 0,
  // so the exit code is not a usable signal — check the shape.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error) {
    throw new Error(`registry error for ${name}: ${parsed.error.summary ?? parsed.error.code}`);
  }
  return Array.isArray(parsed) ? parsed : [parsed];
}

function main() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const lock = parseYaml(readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf8'));
  const importer = lock.importers?.['.'];
  if (!importer) throw new Error("pnpm-lock.yaml has no '.' importer — is this a pnpm workspace root?");

  const { drift, skipped } = analyzeDrift({
    declared: { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) },
    locked: { ...(importer.dependencies ?? {}), ...(importer.devDependencies ?? {}) },
    versionsFor: registryVersions,
    isTracked: (name) => TRACKED.some((re) => re.test(name)),
  });

  const failing = drift.filter((d) => d.tracked);
  const informational = drift.filter((d) => !d.tracked);

  if (informational.length) {
    console.log(`\nBehind their range (not failing — third-party pins are often deliberate):`);
    for (const d of informational) console.log(`  ${d.name}  ${d.range}  pinned ${d.pinned}  ->  ${d.newest} available`);
  }

  if (failing.length) {
    console.error(`\nFAIL: ${failing.length} first-party dependenc${failing.length === 1 ? 'y is' : 'ies are'} behind a release we cut:`);
    for (const d of failing) console.error(`  ${d.name}  ${d.range}  pinned ${d.pinned}  ->  ${d.newest} available`);
    console.error(`\nRefreshing the lockfile alone leaves the same range free to drift back.`);
    console.error(`Raise the range too:`);
    for (const d of failing) console.error(`  pnpm add ${d.name}@^${d.newest}`);
    process.exit(1);
  }

  console.log(`\nOK: no first-party dependency is behind its range.`);
  if (skipped.length) {
    console.log(`Skipped: ${skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}`);
  }
}

main();
