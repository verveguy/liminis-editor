/**
 * Package-level e2e for the `--liminis-editor-*` direction inversion
 * (verveguy/liminis-editor#98, ADR-98, superseding ADR-93's alias layer),
 * run against real Electron/Chromium rather than a CSS-reading unit test —
 * FR-002/FR-003/FR-004 all explicitly require verification "by computed
 * style in a running app, not by reading CSS," since the whole point of
 * this issue was that the previous direction's failure mode (an alias
 * silently baking a literal, or — discovered here — a shim silently not
 * doing what its own issue text claimed) is only observable through
 * `getComputedStyle`, not through the stylesheet's text.
 *
 * Covers:
 *
 * - No host override, light and dark mode: every `--liminis-editor-*` name
 *   resolves to a real, non-empty value equal to its legacy name's computed
 *   value (User Story 1) — including `--liminis-editor-primary`, whose
 *   value is now brand-derived rather than a forward to an undefined
 *   `--color-primary` (FR-008).
 * - **The corrected, documented guarantee (ADR-98's "Verified, not
 *   assumed"): a legacy name's shim preserves reads, not writes.** A host
 *   that only *reads* a legacy name still gets the real value (covered by
 *   the no-override cases above, since nothing overrides it). A host that
 *   *sets* only a legacy name no longer themes the editor — this is a
 *   deliberate, accepted breaking change (see `CHANGELOG.md`'s
 *   `## Unreleased`), not a regression, and is pinned directly below so a
 *   future change that silently reintroduces (or silently further breaks)
 *   this behavior shows up as an intentional, reviewed diff to this
 *   assertion.
 * - `@media print`: the real name picks up the print-safe literal the
 *   package's own print block sets, and the legacy shim continues to track
 *   it (the "reads still work" guarantee holds under print media too).
 * - A host setting the real name wins outright (User Story 3) — with the
 *   legacy name no longer in the resolution path at all, there is no longer
 *   any contention to resolve, but the assertion is kept as a regression
 *   guard.
 * - The one exception to "every internal consumption site reads
 *   `--liminis-editor-*` only": `C4Component.tsx`'s `--color-*` sites, which
 *   deliberately check `liminis-app`'s own Tailwind brand token first,
 *   falling back to the package's own default — the one place a
 *   non-`--liminis-editor-*` name is still a supported way to theme this
 *   package.
 */
import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR = '[aria-label="Markdown editor"]';

async function launchShell(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [APP_DIR] });
  const page = await app.firstWindow();
  await page.waitForSelector(EDITOR);
  await page.waitForLoadState('networkidle');
  return { app, page };
}

/** Computed value of a custom property on the editor root, trimmed. */
function computedVar(page: Page, name: string): Promise<string> {
  return page.evaluate(
    ([selector, prop]) => {
      const el = document.querySelector(selector as string);
      if (!el) throw new Error(`no element matching ${selector}`);
      return getComputedStyle(el).getPropertyValue(prop as string).trim();
    },
    [EDITOR, name],
  );
}

async function setDark(page: Page, dark: boolean): Promise<void> {
  await page.evaluate((isDark) => {
    document.documentElement.classList.toggle('dark', isDark);
  }, dark);
}

/** Sets a custom property inline on `<html>` — outranks the package's own `:root`/`.dark` rules. */
async function setHostOverride(page: Page, name: string, value: string): Promise<void> {
  await page.evaluate(
    ([prop, val]) => {
      document.documentElement.style.setProperty(prop as string, val as string);
    },
    [name, value],
  );
}

async function clearHostOverrides(page: Page, names: string[]): Promise<void> {
  await page.evaluate((props) => {
    for (const prop of props as string[]) {
      document.documentElement.style.removeProperty(prop);
    }
  }, names);
}

// A representative sample of `LEGACY_SHIM_TARGET` entries (scripts/lib/theming-tokens.mjs),
// plus every name Zusammen's read list (verveguy/zusammen#134, #129) depends
// on. Every one of these 26 legacy names now has a real one-line shim
// declaration, so — unlike the pre-#98 suite — every case has a legacyName
// to compare against; there is no longer a "no package-level declaration"
// group, because #98's whole point was giving `--liminis-editor-primary`
// (previously the one gap) a real, package-owned value instead of an
// undefined `--color-primary` forward.
const NO_OVERRIDE_CASES: Array<{ newName: string; legacyName: string; group: string }> = [
  { newName: '--liminis-editor-foreground', legacyName: '--vscode-foreground', group: 'zusammen#129 read' },
  { newName: '--liminis-editor-background', legacyName: '--vscode-background', group: 'zusammen#129 read' },
  { newName: '--liminis-editor-code-bg', legacyName: '--vscode-code-bg', group: 'zusammen#129 read (secondary)' },
  { newName: '--liminis-editor-border', legacyName: '--vscode-border', group: 'zusammen#129 read (border/input)' },
  { newName: '--liminis-editor-input-bg', legacyName: '--vscode-input-bg', group: 'previously-undeclared shim (#98 Constraint 3)' },
  { newName: '--liminis-editor-focus-border', legacyName: '--vscode-focus-border', group: 'zusammen#134 read' },
  { newName: '--liminis-editor-errorForeground', legacyName: '--vscode-errorForeground', group: 'zusammen#134 read' },
  { newName: '--liminis-editor-checkbox-border', legacyName: '--checkbox-border', group: 'standalone legacy name' },
  { newName: '--liminis-editor-primary', legacyName: '--editor-brand', group: 'brand-derived default, replacing the --color-primary defect (FR-008)' },
];

test.describe('Electron shell — --liminis-editor-* direction inversion (#98)', () => {
  test('every sampled --liminis-editor-* name resolves to a real value equal to its legacy shim, light and dark, with no host override', async () => {
    const { app, page } = await launchShell();
    try {
      for (const { newName, legacyName, group } of NO_OVERRIDE_CASES) {
        const newValue = await computedVar(page, newName);
        const legacyValue = await computedVar(page, legacyName);
        expect(newValue, `${newName} (${group}) resolved empty in light mode`).not.toBe('');
        expect(newValue, `${newName} !== ${legacyName} in light mode (${group})`).toBe(legacyValue);
      }

      await setDark(page, true);
      try {
        for (const { newName, legacyName, group } of NO_OVERRIDE_CASES) {
          const newValue = await computedVar(page, newName);
          const legacyValue = await computedVar(page, legacyName);
          expect(newValue, `${newName} (${group}) resolved empty in dark mode`).not.toBe('');
          expect(newValue, `${newName} !== ${legacyName} in dark mode (${group})`).toBe(legacyValue);
        }
      } finally {
        await setDark(page, false);
      }
    } finally {
      await app.close();
    }
  });

  test('a literal-backed token with a dark-mode-varying value (--liminis-editor-menu-background) tracks its own light/dark split', async () => {
    const { app, page } = await launchShell();
    try {
      const light = await computedVar(page, '--liminis-editor-menu-background');
      expect(light).not.toBe('');

      await setDark(page, true);
      const dark = await computedVar(page, '--liminis-editor-menu-background');
      await setDark(page, false);

      expect(dark).not.toBe('');
      expect(dark, 'menu-background did not vary between light and dark').not.toBe(light);
    } finally {
      await app.close();
    }
  });

  test('documented breaking change: a host setting only a legacy name no longer themes the editor (ADR-98)', async () => {
    // This is the corrected finding from this issue's own "verify, not
    // assume" instruction: the issue's proposed shim was claimed to let a
    // legacy-only override keep working. It does not — checked empirically
    // here, not reasoned about. Every internal consumption site reads
    // --liminis-editor-* only (FR-003), so nothing inside this package ever
    // looks at the legacy name's value; the shim declaration exists solely
    // so a host that only *reads* the legacy name still gets a real value
    // (see the no-override case above), not so a host that *sets* it
    // affects anything. If this assertion starts failing, that means a
    // legacy-only override started working again — which would mean some
    // internal consumption site regressed back to reading a legacy name,
    // reintroducing the dependence #98 removed. Fix the regression; do not
    // loosen this assertion.
    const { app, page } = await launchShell();
    try {
      const cases: Array<{ legacyName: string; newName: string; value: string }> = [
        { legacyName: '--vscode-foreground', newName: '--liminis-editor-foreground', value: 'rgb(1, 2, 3)' },
        { legacyName: '--vscode-border', newName: '--liminis-editor-border', value: 'rgb(4, 5, 6)' },
        { legacyName: '--vscode-focus-border', newName: '--liminis-editor-focus-border', value: 'rgb(13, 14, 15)' },
        { legacyName: '--editor-brand', newName: '--liminis-editor-primary', value: 'rgb(7, 8, 9)' },
      ];

      for (const { legacyName, newName, value } of cases) {
        const before = await computedVar(page, newName);
        await setHostOverride(page, legacyName, value);
        try {
          const resolved = await computedVar(page, newName);
          expect(
            resolved,
            `${newName} changed when only ${legacyName} was set — a legacy-only override should no longer reach the editor (ADR-98)`,
          ).toBe(before);
          expect(resolved).not.toBe(value);

          // The "reads still work" half: the legacy name itself faithfully
          // reflects whatever was just set on it (ordinary CSS, no package
          // involvement) — trivial on its own, but establishes that the
          // *lack* of effect on newName above is specifically because
          // nothing reads legacyName, not because setHostOverride silently
          // failed to apply.
          const legacyResolved = await computedVar(page, legacyName);
          expect(legacyResolved).toBe(value);
        } finally {
          await clearHostOverrides(page, [legacyName]);
        }
      }
    } finally {
      await app.close();
    }
  });

  test('a host setting the real name themes the editor regardless of any legacy name (User Story 3)', async () => {
    const { app, page } = await launchShell();
    try {
      // With the legacy name no longer in the resolution path at all (see
      // the breaking-change test above), setting it alongside the real name
      // is no longer genuine contention — this guards against a regression
      // that reintroduces the legacy name into the resolution chain in a
      // way that lets it compete with (or override) a direct new-name set.
      await setHostOverride(page, '--vscode-foreground', 'rgb(255, 0, 0)');
      await setHostOverride(page, '--liminis-editor-foreground', 'rgb(0, 255, 0)');
      try {
        const resolved = await computedVar(page, '--liminis-editor-foreground');
        expect(resolved).toBe('rgb(0, 255, 0)');
      } finally {
        await clearHostOverrides(page, ['--vscode-foreground', '--liminis-editor-foreground']);
      }
    } finally {
      await app.close();
    }
  });

  test("the @media print block's reset is picked up directly, and the legacy shim's read still tracks it", async () => {
    const { app, page } = await launchShell();
    try {
      // src/styles.css's `@media print { :root, .dark { ... } }` block now
      // resets --liminis-editor-* names directly (ADR-98 migrated it off
      // the legacy names it used to target). Comparing against the legacy
      // shim's own computed value (rather than a hardcoded literal) checks
      // that the "reads still work" guarantee holds under print media too
      // — Chromium also normalizes some custom-property color text at
      // computed-style time (e.g. `#000000` serializes as `#000`),
      // confirmed empirically while writing this spec, so a literal
      // comparison would be brittle regardless.
      const printTargets: Array<[newName: string, legacyName: string]> = [
        ['--liminis-editor-foreground', '--vscode-foreground'],
        ['--liminis-editor-background', '--vscode-background'],
        ['--liminis-editor-code-bg', '--vscode-code-bg'],
        ['--liminis-editor-border', '--vscode-border'],
        ['--liminis-editor-checkbox-border', '--checkbox-border'],
        ['--liminis-editor-link', '--vscode-link'],
      ];

      // Establish the light-mode (non-print) values first, to prove the
      // print-mode comparison below is actually exercising the print
      // block's override and not merely re-confirming light-mode equality.
      const beforePrint = new Map<string, string>();
      for (const [newName] of printTargets) {
        beforePrint.set(newName, await computedVar(page, newName));
      }
      // --liminis-editor-h1-color has no legacy shim to compare against —
      // its legacy counterpart, --slashmd-h1-color, was deleted outright
      // (#98 FR-006), not shimmed. Checked separately: non-empty and
      // changed under print, with no legacy-name comparison available.
      const h1Before = await computedVar(page, '--liminis-editor-h1-color');

      await page.emulateMedia({ media: 'print' });
      try {
        for (const [newName, legacyName] of printTargets) {
          const newValue = await computedVar(page, newName);
          const legacyValue = await computedVar(page, legacyName);
          expect(newValue, `${newName} resolved empty under print media`).not.toBe('');
          expect(newValue, `${newName} !== ${legacyName} under print media`).toBe(legacyValue);
          expect(
            newValue,
            `${newName} did not change under print media — the print block's reset was not picked up`,
          ).not.toBe(beforePrint.get(newName));
        }

        const h1Print = await computedVar(page, '--liminis-editor-h1-color');
        expect(h1Print, '--liminis-editor-h1-color resolved empty under print media').not.toBe('');
        expect(h1Print, '--liminis-editor-h1-color did not change under print media').not.toBe(h1Before);
      } finally {
        await page.emulateMedia({ media: null });
      }
    } finally {
      await app.close();
    }
  });

  test('the C4Component.tsx exception: --color-* (liminis-app\'s own token) wins over --liminis-editor-* when set (#98)', async () => {
    // examples/electron has no C4 diagram fixture, so this reproduces the
    // exact expression C4Component.tsx uses at its 6 consumption sites —
    // `var(--color-x, var(--liminis-editor-x))` — on a detached element, to
    // confirm the one deliberate exception to "every internal consumption
    // site reads --liminis-editor-* only" behaves as designed: liminis-app's
    // own override wins when set, and the package default applies otherwise.
    const { app, page } = await launchShell();
    try {
      const result = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.color = 'var(--color-primary, var(--liminis-editor-primary))';
        document.body.appendChild(probe);
        const packageDefault = getComputedStyle(probe).color;

        document.documentElement.style.setProperty('--color-primary', 'rgb(9, 9, 9)');
        const withHostOverride = getComputedStyle(probe).color;

        document.documentElement.style.removeProperty('--color-primary');
        probe.remove();

        return { packageDefault, withHostOverride };
      });

      expect(result.packageDefault, 'no-override case resolved empty').not.toBe('');
      expect(
        result.withHostOverride,
        '--color-primary override did not win over --liminis-editor-primary at the C4Component.tsx-style expression',
      ).toBe('rgb(9, 9, 9)');
      expect(result.withHostOverride).not.toBe(result.packageDefault);
    } finally {
      await app.close();
    }
  });
});
