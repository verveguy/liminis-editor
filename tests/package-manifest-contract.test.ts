/**
 * The manifest promises things about this package. This suite is what makes
 * those promises true rather than merely written down.
 *
 * ## Why this file exists at all
 *
 * Both assertions below used to live in the consuming application's
 * `editor-package-wiring.test.ts`, in `verveguy/liminis`. That was tolerable
 * while the package was a directory of that monorepo and the consumer's CI ran
 * on every package change. It stopped being tolerable at extraction
 * (verveguy/liminis#995): the consumer's test does not travel with the package,
 * so a repository whose whole purpose is to stand on its own would have shipped
 * a `//peerDependencies` note asserting an enforcement that no longer existed
 * anywhere in it.
 *
 * A comment that claims to be checked, and is not, is worse than no comment —
 * it is read as a guarantee. So the guard moves here, next to the manifest it
 * constrains. The consumer keeps its own copy for its own reasons; this one is
 * the package's.
 *
 * See `docs/provenance.md` for how bare issue and spec identifiers in this
 * repository resolve.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolved from `import.meta.url`, never `process.cwd()`, so the suite survives
 * being run from any directory — including the temp directories the
 * `verify:package` pipeline works in.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = resolve(REPO_ROOT, 'src');

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  private?: boolean;
  publishConfig?: { access?: string };
  scripts?: Record<string, string>;
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf-8')) as Manifest;
}

/** Every `.ts`/`.tsx` file under `src/`, as absolute paths. */
function sourceFiles(): string[] {
  return readdirSync(SRC_ROOT, { recursive: true, encoding: 'utf-8' })
    .filter((entry) => /\.tsx?$/.test(entry))
    .map((entry) => resolve(SRC_ROOT, entry))
    .filter((path) => existsSync(path));
}

/** The names a file imports from `'react'` or `'react-dom'` (and their subpaths). */
function reactImports(filePath: string): string[] {
  const source = readFileSync(filePath, 'utf-8');
  const names: string[] = [];
  for (const block of source.matchAll(
    /import\s+(?:type\s+)?\{([^{}]*)\}\s*from\s*'react(?:-dom)?(?:\/[\w-]+)?'/g,
  )) {
    for (const specifier of block[1].split(',')) {
      const name = specifier.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe('the package manifest keeps its own promises', () => {
  // React and Lexical must be *peers*, never hard dependencies. A second copy of
  // React under this package is the classic "Invalid hook call"; a second copy of
  // Lexical is worse, because it fails as nodes silently not matching rather than
  // as an error anyone can read.
  it('declares react, react-dom and the whole lexical surface as peers', () => {
    const manifest = readManifest();
    const peers = manifest.peerDependencies ?? {};
    const deps = manifest.dependencies ?? {};

    for (const name of ['react', 'react-dom', 'lexical']) {
      expect(peers[name], `${name} must be a peerDependency`).toBeDefined();
      expect(deps[name], `${name} must not also be a hard dependency`).toBeUndefined();
    }

    // A floor, not an equality — adding a twelfth `@lexical/*` is fine. The
    // assertion that actually holds the line is the next one.
    const lexicalScoped = Object.keys(peers).filter((n) => n.startsWith('@lexical/'));
    expect(
      lexicalScoped.length,
      'every @lexical/* package must be peered, not just bare lexical',
    ).toBeGreaterThanOrEqual(11);

    const lexicalHardDeps = Object.keys(deps).filter((n) => n.startsWith('@lexical/'));
    expect(lexicalHardDeps, 'no @lexical/* may remain a hard dependency').toEqual([]);
  });

  // ADR-92's narrow-range policy (#92) is only true if the declared peer range
  // and the version CI actually installs (devDependencies) never drift apart —
  // that pairing is the entire point of choosing a single-caret bump over a
  // wide band. Nothing else enforces it: a bump to one list and not the other
  // would pass every other check here and silently reintroduce an untested
  // claim.
  it('keeps every lexical peer range paired with an identical devDependency range', () => {
    const manifest = readManifest();
    const peers = manifest.peerDependencies ?? {};
    const devDeps = manifest.devDependencies ?? {};

    const lexicalPeerNames = Object.keys(peers).filter(
      (n) => n === 'lexical' || n.startsWith('@lexical/'),
    );
    expect(
      lexicalPeerNames.length,
      'found no lexical peers to check; the guard would be vacuous',
    ).toBeGreaterThanOrEqual(12);

    for (const name of lexicalPeerNames) {
      expect(peers[name], `${name}'s peer range must be a single-caret 0.x bump`).toMatch(
        /^\^0\.\d+\.0$/,
      );
      expect(
        devDeps[name],
        `${name} must also be a devDependency, so CI tests the version the peer range names`,
      ).toBe(peers[name]);
    }
  });

  // The `react` peer floor is `^19.2.0`, and the manifest's `//peerDependencies`
  // note justifies it by asserting the package imports nothing newer than React
  // 19.0. CI only ever resolves the *latest* point release in the range, so a
  // future change could reach for `useEffectEvent` and CI would stay green while
  // a consumer honouring the declared floor got `undefined is not a function` at
  // runtime. The low half of every caret range is untested by construction,
  // which is precisely why the claim needs a guard rather than a comment.
  //
  // Deliberately a list of *post-19.0 named exports* rather than a version
  // check: what makes the floor safe is not which React is installed, it is
  // which APIs the source reaches for.
  const POST_19_0_REACT_APIS = [
    'useEffectEvent', // 19.2
    'Activity', // 19.2
    'unstable_Activity',
    'cacheSignal', // 19.2
    'ViewTransition', // 19.2
    'unstable_ViewTransition',
    'addTransitionType', // 19.2
    'unstable_addTransitionType',
    'captureOwnerStack', // 19.1
  ];

  it('imports no React API newer than the declared 19.2.0 peer floor', () => {
    const files = sourceFiles();

    // Anti-vacuity: if the walk returns nothing — a moved `src/`, a changed
    // extension convention — the offender list is trivially empty and this test
    // passes while checking nothing.
    expect(files.length, 'found no source files to scan; the guard would be vacuous').toBeGreaterThan(
      0,
    );

    const offenders: string[] = [];
    for (const file of files) {
      for (const name of reactImports(file)) {
        if (POST_19_0_REACT_APIS.includes(name)) {
          offenders.push(`${relative(REPO_ROOT, file)} imports ${name}`);
        }
      }
    }

    expect(
      offenders,
      'raise the react/react-dom peerDependency floor (and the //peerDependencies note) ' +
        'before importing a post-19.0 API, or a consumer on the declared floor breaks at runtime',
    ).toEqual([]);
  });

  // The publish guard, after the decision. This package was `private: true`
  // until verveguy/liminis-editor#39, and that flag was the thing standing
  // between a stray command and a permanent publish. Removing it removed the
  // guard, so these assertions cover what replaced it.
  //
  // `private: true` was never verifiable in any case: `npm publish --dry-run`
  // on npm 10.8.2 builds, packs all 219 files, reports it would publish, and
  // exits 0 without mentioning that the package is private. The replacement is
  // a script precisely so that it can be tested.
  it('is publishable, and publicly so', () => {
    const manifest = readManifest();
    expect(
      manifest.private,
      'private: true is gone deliberately (#39). Re-adding it would silently disable publishing',
    ).toBeUndefined();
    expect(
      manifest.publishConfig?.access,
      'scoped packages default to restricted — without this the first publish fails or goes private',
    ).toBe('public');
  });

  it('cannot publish without an explicit opt-in', () => {
    const manifest = readManifest();
    expect(
      manifest.scripts?.prepublishOnly,
      'prepublishOnly is what makes publishing deliberate now that private: true is gone',
    ).toMatch(/guard-publish/);
    expect(
      existsSync(resolve(REPO_ROOT, 'scripts/guard-publish.mjs')),
      'the script prepublishOnly points at must exist, or the guard is a no-op that looks like a guard',
    ).toBe(true);
  });
});
