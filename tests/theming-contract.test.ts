/**
 * The editor's CSS custom-property theming contract (verveguy/liminis-editor#50)
 * was, until this suite, entirely undiscoverable: 60-odd `var(--x)` references
 * scattered across `src/`, none of them listed anywhere a host could read
 * without grepping 2,477 lines of `styles.css`.
 *
 * This suite is the drift guard the issue asks for, and asserts two things:
 *
 * 1. The token table generated into `README.md` names exactly the set of
 *    tokens `src/` actually consumes — no more, no less. Add a `var(--x)`
 *    without regenerating the README and this fails.
 * 2. Every consumed token resolves with no host configuration at all — it has
 *    a `:root`/`.dark` default in `styles.css`, or an inline fallback at every
 *    call site. This is exactly the rule issue #52 broke (a token with
 *    neither, which silently drops its declaration rather than erroring).
 *
 * Both failure modes are demonstrated by mutation below, not merely asserted
 * to work — a fixture directory under `os.tmpdir()` is given a deliberate
 * violation, and the guard is checked to actually flag it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  buildInventory,
  consumedTokens,
  defaultedTokens,
  resolvesWithoutHost,
  parseDocumentedTokens,
} from '../scripts/lib/theming-tokens.mjs';
import { renderThemingBlock, withThemingBlock } from '../scripts/generate-theming-docs.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = resolve(REPO_ROOT, 'src');
const STYLES_CSS_PATH = resolve(REPO_ROOT, 'src', 'styles.css');
const README_PATH = resolve(REPO_ROOT, 'README.md');

function readme(): string {
  return readFileSync(README_PATH, 'utf-8');
}

function documentedTokens(): Set<string> {
  return parseDocumentedTokens(readme());
}

describe('theming contract: consumed set equals documented set', () => {
  it('finds consumed tokens and documented tokens to check them against', () => {
    // Anti-vacuity: if either side is empty, the equality assertion below
    // would pass trivially without checking anything.
    const inventory = buildInventory(SRC_ROOT, STYLES_CSS_PATH);
    expect(
      inventory.length,
      'found no var(--...) consumption sites under src/; the guard would be vacuous',
    ).toBeGreaterThan(0);
    expect(
      documentedTokens().size,
      'found no documented tokens in README.md; the guard would be vacuous',
    ).toBeGreaterThan(0);
  });

  it('documents every token src/ consumes, and consumes every token it documents', () => {
    const consumed = new Set(buildInventory(SRC_ROOT, STYLES_CSS_PATH).map((row) => row.name));
    const documented = documentedTokens();

    const undocumented = [...consumed].filter((name) => !documented.has(name));
    const unconsumed = [...documented].filter((name) => !consumed.has(name));

    expect(undocumented, 'consumed by src/ but missing from the README token table').toEqual([]);
    expect(unconsumed, 'documented in the README token table but not consumed anywhere in src/').toEqual(
      [],
    );
  });
});

describe('theming contract: every consumed token resolves with no host configuration', () => {
  it('has a default or an inline fallback at every call site, for every consumed token', () => {
    const consumed = consumedTokens(SRC_ROOT);
    const defaulted = defaultedTokens(STYLES_CSS_PATH);

    const unresolvable = [...consumed.keys()].filter(
      (name) => !resolvesWithoutHost(name, consumed, defaulted),
    );

    expect(
      unresolvable,
      'consumed with neither a :root/.dark default nor a fallback at every call site — ' +
        'this token silently drops its declaration when no host supplies it (see #52)',
    ).toEqual([]);
  });
});

describe('theming contract: README table is not stale', () => {
  it('regenerating the token table from current source produces the committed content', () => {
    const regenerated = withThemingBlock(readme(), renderThemingBlock());
    expect(
      regenerated,
      'README.md\'s theming token table is stale — run `node scripts/generate-theming-docs.mjs`',
    ).toEqual(readme());
  });
});

describe('theming contract: mutation tests (the guard actually fires)', () => {
  const fixtureDirs: string[] = [];

  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeFixtureRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'theming-contract-fixture-'));
    fixtureDirs.push(dir);
    return dir;
  }

  it('flags a token consumed in src/ but absent from the README table', () => {
    const fixtureRoot = makeFixtureRoot();
    const stylesPath = join(fixtureRoot, 'styles.css');
    writeFileSync(stylesPath, ':root {\n  --known-token: red;\n}\n');
    mkdirSync(join(fixtureRoot, 'app'));
    writeFileSync(
      join(fixtureRoot, 'app', 'Widget.tsx'),
      "export const Widget = () => <div style={{ color: 'var(--known-token)' }} />;\n" +
        "// deliberately undocumented: a real change would add var(--undocumented-token) here\n" +
        "export const Rogue = () => <div style={{ color: 'var(--undocumented-token)' }} />;\n",
    );

    const consumed = new Set(buildInventory(fixtureRoot, stylesPath).map((row) => row.name));
    const documented = new Set(['--known-token']); // the fixture's "README" only lists this one

    const undocumented = [...consumed].filter((name) => !documented.has(name));

    expect(undocumented).toEqual(['--undocumented-token']);
  });

  it('flags a token with neither a default nor a fallback at every call site', () => {
    const fixtureRoot = makeFixtureRoot();
    const stylesPath = join(fixtureRoot, 'styles.css');
    writeFileSync(
      stylesPath,
      ':root {\n  --defaulted-token: blue;\n}\n' +
        '.thing {\n' +
        '  color: var(--defaulted-token);\n' + // has a default: resolves
        '  border-color: var(--fallback-token, #ccc);\n' + // has a fallback: resolves
        '  background: var(--broken-token);\n' + // neither: must be flagged
        '}\n',
    );

    const consumed = consumedTokens(fixtureRoot);
    const defaulted = defaultedTokens(stylesPath);

    const unresolvable = [...consumed.keys()].filter(
      (name) => !resolvesWithoutHost(name, consumed, defaulted),
    );

    expect(unresolvable).toEqual(['--broken-token']);
  });
});
