/**
 * The editor's CSS custom-property theming contract (verveguy/liminis-editor#50)
 * was, until this suite, entirely undiscoverable: 60-odd `var(--x)` references
 * scattered across `src/`, none of them listed anywhere a host could read
 * without grepping 2,477 lines of `styles.css`.
 *
 * This suite is the drift guard the issue asks for, and asserts five things:
 *
 * 1. The token table generated into `README.md` names exactly the set of
 *    tokens `src/` actually consumes — no more, no less. Add a `var(--x)`
 *    without regenerating the README and this fails.
 * 2. Every consumed token resolves with no host configuration at all — it has
 *    a `:root`/`.dark` default in `styles.css`, or an inline fallback at every
 *    call site. This is exactly the rule issue #52 broke (a token with
 *    neither, which silently drops its declaration rather than erroring).
 * 3. Every consumed token has a curated, non-empty description of what it
 *    controls (FR-003) — a token added without one fails CI rather than
 *    shipping a blank "Controls" cell.
 * 4. Every legacy name in `LEGACY_SHIM_TARGET` is declared in `styles.css` as
 *    a one-line shim forwarding to its `--liminis-editor-*` target (FR-002,
 *    #98), and nothing under `src/` reads a `--vscode-*`, `--slashmd-*` or
 *    `--checkbox-*` custom property anywhere (FR-003) — #98 inverted the
 *    token direction, so the invariant this suite now protects is the
 *    opposite of #51's: a host still *setting* a legacy name must keep
 *    working via the shim's cascade precedence, not via a consumption-site
 *    fallback (removed; see `resolvesToPreviousName`'s retirement note in
 *    `scripts/lib/theming-tokens.mjs`).
 * 5. Every token in the checked-in defined-token baseline (#79) is still
 *    declared with a value somewhere in `styles.css`. Unlike 1-4, this
 *    guards the *defined* set, not the consumed/documented set — a host
 *    like Zusammen can read a `--vscode-*` definition directly even though
 *    nothing under `src/` ever consumes it via `var()`, so this is the only
 *    guard in the suite that would catch #51's rename if it had also
 *    touched definition sites (it didn't; see the baseline's own history).
 *
 * All five failure modes are demonstrated by mutation below, not merely
 * asserted to work — a fixture directory under `os.tmpdir()` is given a
 * deliberate violation, and the guard is checked to actually flag it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  buildInventory,
  consumedTokens,
  defaultedTokens,
  resolvesWithoutHost,
  parseDocumentedTokens,
  diffDefinedTokenBaseline,
  describe as describeToken,
  stripCssComments,
  LEGACY_SHIM_TARGET,
  resolvesToShimTarget,
} from '../scripts/lib/theming-tokens.mjs';
import { renderThemingBlock, withThemingBlock } from '../scripts/generate-theming-docs.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = resolve(REPO_ROOT, 'src');
const STYLES_CSS_PATH = resolve(REPO_ROOT, 'src', 'styles.css');
const README_PATH = resolve(REPO_ROOT, 'README.md');
const DEFINED_TOKENS_BASELINE_PATH = resolve(
  REPO_ROOT,
  'scripts',
  'lib',
  'theming-defined-tokens-baseline.json',
);

function definedTokensBaseline(): string[] {
  return JSON.parse(readFileSync(DEFINED_TOKENS_BASELINE_PATH, 'utf-8'));
}

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

describe('theming contract: every consumed token has a human-readable description', () => {
  it('has a non-empty TOKEN_DESCRIPTIONS entry (FR-003) for every token src/ consumes', () => {
    const consumed = new Set(buildInventory(SRC_ROOT, STYLES_CSS_PATH).map((row) => row.name));
    const undescribed = [...consumed].filter((name) => !describeToken(name));

    expect(
      undescribed,
      'consumed but missing a TOKEN_DESCRIPTIONS entry in scripts/lib/theming-tokens.mjs — ' +
        'FR-003 requires every documented property to state what it controls',
    ).toEqual([]);
  });
});

describe('theming contract: every legacy name is a shim to its --liminis-editor-* target (#98)', () => {
  it('declares every LEGACY_SHIM_TARGET entry as a one-line var() forward in styles.css (FR-002)', () => {
    const stripped = stripCssComments(readFileSync(STYLES_CSS_PATH, 'utf-8'));

    const broken = Object.entries(LEGACY_SHIM_TARGET)
      .filter(([legacyName, target]) => !resolvesToShimTarget(legacyName, target, stripped))
      .map(([legacyName]) => legacyName);

    expect(
      broken,
      'legacy name(s) not declared as a one-line shim to their --liminis-editor-* target — a host still ' +
        'setting only the legacy name would stop theming the package (see #98)',
    ).toEqual([]);
  });

  it('reads no --vscode-*, --slashmd-* or --checkbox- custom property anywhere under src/ (FR-003)', () => {
    const files = [
      ...readdirSync(SRC_ROOT, { recursive: true, encoding: 'utf-8' }).filter((entry) =>
        /\.(css|ts|tsx)$/.test(entry),
      ),
    ].map((entry) => join(SRC_ROOT, entry));

    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      if (/var\(\s*--(vscode|slashmd|checkbox)-/.test(text)) offenders.push(file);
    }

    expect(
      offenders,
      'file(s) still reading a --vscode-*/--slashmd-*/--checkbox- custom property — #98 requires every ' +
        'internal consumption site to read --liminis-editor-* only',
    ).toEqual([]);
  });

  it('declares no --slashmd-* custom property anywhere (FR-006, SC-002)', () => {
    const stripped = stripCssComments(readFileSync(STYLES_CSS_PATH, 'utf-8'));
    expect(
      stripped.includes('--slashmd-'),
      '--slashmd-* found in styles.css — #98 deletes this prefix outright (verified unread by any known consumer)',
    ).toBe(false);
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

describe('theming contract: defined tokens are a public API surface (verveguy/liminis-editor#79)', () => {
  it('finds defined tokens and a baseline to check them against', () => {
    // Anti-vacuity: if either side is empty, the equality assertion below
    // would pass trivially without checking anything.
    expect(
      defaultedTokens(STYLES_CSS_PATH).size,
      'found no declared custom properties in styles.css; the guard would be vacuous',
    ).toBeGreaterThan(0);
    expect(
      definedTokensBaseline().length,
      'scripts/lib/theming-defined-tokens-baseline.json is empty; the guard would be vacuous',
    ).toBeGreaterThan(0);
  });

  it('declares every token in the checked-in baseline (FR-004, FR-005, FR-007)', () => {
    const current = defaultedTokens(STYLES_CSS_PATH);
    const baseline = definedTokensBaseline();

    const { missing } = diffDefinedTokenBaseline(current, baseline);

    expect(
      missing,
      'declared with a value in the checked-in baseline (scripts/lib/theming-defined-tokens-baseline.json) ' +
        'but no longer declared anywhere in styles.css — a host reading this token directly (e.g. Zusammen\'s ' +
        '--vscode-* mapping) loses its value silently. If this removal (or rename) is intentional, update the ' +
        'baseline with `pnpm docs:theming-baseline`.',
    ).toEqual([]);
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

  it('flags a token with no TOKEN_DESCRIPTIONS entry', () => {
    const fixtureRoot = makeFixtureRoot();
    const stylesPath = join(fixtureRoot, 'styles.css');
    writeFileSync(stylesPath, ':root {\n  --checkbox-border: red;\n}\n');
    mkdirSync(join(fixtureRoot, 'app'));
    writeFileSync(
      join(fixtureRoot, 'app', 'Widget.tsx'),
      "export const Widget = () => <div style={{ color: 'var(--liminis-editor-checkbox-border, var(--checkbox-border))' }} />;\n" +
        "export const Rogue = () => <div style={{ color: 'var(--never-described-token)' }} />;\n",
    );

    const consumed = new Set(buildInventory(fixtureRoot, stylesPath).map((row) => row.name));
    const undescribed = [...consumed].filter((name) => !describeToken(name));

    expect(undescribed).toEqual(['--never-described-token']);
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

  it('flags a legacy name missing its one-line shim declaration (FR-002)', () => {
    const stripped = stripCssComments(
      ':root {\n  --checkbox-border: var(--liminis-editor-checkbox-border);\n  /* --vscode-focus-border has no shim here */\n}\n',
    );

    const broken = Object.entries({
      '--checkbox-border': '--liminis-editor-checkbox-border',
      '--vscode-focus-border': '--liminis-editor-focus-border',
    })
      .filter(([legacyName, target]) => !resolvesToShimTarget(legacyName, target, stripped))
      .map(([legacyName]) => legacyName);

    expect(broken).toEqual(['--vscode-focus-border']);
  });

  it('flags an internal consumption site still reading a legacy custom property (FR-003)', () => {
    const good = "export const Good = () => <div style={{ color: 'var(--liminis-editor-foreground)' }} />;\n";
    const bad = "export const Bad = () => <div style={{ borderColor: 'var(--vscode-border)' }} />;\n";

    expect(/var\(\s*--(vscode|slashmd|checkbox)-/.test(good)).toBe(false);
    expect(/var\(\s*--(vscode|slashmd|checkbox)-/.test(bad)).toBe(true);
  });

  it('flags a --slashmd-* declaration surviving anywhere (FR-006, SC-002)', () => {
    const clean = ':root {\n  --liminis-editor-token-comment: red;\n}\n';
    const dirty = ':root {\n  --slashmd-token-comment: red;\n}\n';

    expect(clean.includes('--slashmd-')).toBe(false);
    expect(dirty.includes('--slashmd-')).toBe(true);
  });

  it('flags a baselined token whose declaration is removed from styles.css (FR-004, SC-001)', () => {
    const fixtureRoot = makeFixtureRoot();
    const stylesPath = join(fixtureRoot, 'styles.css');
    // The baseline recorded --removed-token as defined; the current stylesheet
    // no longer declares it — the exact silent-drop scenario #52 broke.
    writeFileSync(stylesPath, ':root {\n  --kept-token: red;\n}\n');
    const baseline = ['--kept-token', '--removed-token'];

    const { missing } = diffDefinedTokenBaseline(defaultedTokens(stylesPath), baseline);

    expect(missing).toEqual(['--removed-token']);
  });

  it('flags a same-count rename, not masked by an unchanged total (Acceptance Scenario 3)', () => {
    const fixtureRoot = makeFixtureRoot();
    const stylesPath = join(fixtureRoot, 'styles.css');
    // Same total count (1) as the baseline, but a different name — reproduces
    // the exact 0.2.0 near miss: 42 defined before, 42 after, 0 removed by count.
    writeFileSync(stylesPath, ':root {\n  --new-name-token: red;\n}\n');
    const baseline = ['--old-name-token'];

    const { missing, added } = diffDefinedTokenBaseline(defaultedTokens(stylesPath), baseline);

    expect(missing).toEqual(['--old-name-token']);
    expect(added).toEqual(['--new-name-token']);
  });

  it('does not flag a token added without a baseline update (FR-006, SC-002)', () => {
    const fixtureRoot = makeFixtureRoot();
    const stylesPath = join(fixtureRoot, 'styles.css');
    writeFileSync(stylesPath, ':root {\n  --kept-token: red;\n  --new-token: blue;\n}\n');
    const baseline = ['--kept-token'];

    const { missing } = diffDefinedTokenBaseline(defaultedTokens(stylesPath), baseline);

    expect(missing).toEqual([]);
  });

  it('flags a token defined only inside a non-:root rule if removed (Acceptance Scenario 5)', () => {
    const fixtureRoot = makeFixtureRoot();
    const stylesPath = join(fixtureRoot, 'styles.css');
    // First prove extraction finds a token declared outside :root at all...
    writeFileSync(
      stylesPath,
      ':root {\n  --kept-token: red;\n}\n.dark {\n  --dark-only-token: blue;\n}\n',
    );
    expect(defaultedTokens(stylesPath)).toContain('--dark-only-token');

    // ...then remove its declaration and confirm the guard flags the loss.
    writeFileSync(stylesPath, ':root {\n  --kept-token: red;\n}\n');
    const baseline = ['--kept-token', '--dark-only-token'];

    const { missing } = diffDefinedTokenBaseline(defaultedTokens(stylesPath), baseline);

    expect(missing).toEqual(['--dark-only-token']);
  });
});
