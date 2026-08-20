/**
 * Package-level e2e for the `--liminis-editor-*` definition-side alias layer
 * (verveguy/liminis-editor#93, ADR-93), run against real Electron/Chromium
 * rather than a CSS-reading unit test — FR-002/FR-003/FR-004/FR-007 all
 * explicitly require verification "by computed style in a running app, not
 * by reading CSS," since the whole failure mode this issue guards against
 * (a definition-side alias silently disabling the ADR-087 fallback layer) is
 * only observable through `getComputedStyle`, not through the stylesheet's
 * text.
 *
 * Covers, for a representative token from each of the four alias groups
 * ADR-93 records (flat legacy alias, nested-fallback alias, literal-backed
 * alias, host-brand-token alias) plus Zusammen's actual read list
 * (verveguy/zusammen#129):
 *
 * - No host override, light and dark mode: the new name resolves to a real,
 *   non-empty value equal to its legacy name's computed value (User Story 1).
 * - Legacy-only override: the new name reflects the host's legacy-named
 *   override, not the package's own default (User Story 2 — the regression
 *   this issue exists to prevent).
 * - New-name override wins over a simultaneously-set legacy override (User
 *   Story 3).
 * - `@media print`: the new name picks up the print-safe literal the
 *   package's own print block resets its legacy target to.
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

// One representative token from each alias group ADR-93 records, plus every
// name Zusammen's own read migration (verveguy/zusammen#129) depends on.
// `legacyName` is only set where the legacy name itself has a real
// package-level declaration to compare against; `--color-primary` (a host
// brand token liminis-app supplies, not this package) resolves to an empty
// string when no host sets it — confirmed empirically, not assumed — so
// that case is checked against its literal fallback instead (`literal`).
const NO_OVERRIDE_CASES: Array<{ newName: string; legacyName?: string; literal?: string; group: string }> = [
  { newName: '--liminis-editor-foreground', legacyName: '--vscode-foreground', group: 'flat alias (real legacy default)' },
  { newName: '--liminis-editor-background', legacyName: '--vscode-background', group: 'flat alias — zusammen#129 read' },
  { newName: '--liminis-editor-code-bg', legacyName: '--vscode-code-bg', group: 'flat alias — zusammen#129 read (secondary)' },
  { newName: '--liminis-editor-border', legacyName: '--vscode-border', group: 'flat alias — zusammen#129 read (border/input)' },
  { newName: '--liminis-editor-input-bg', legacyName: '--vscode-code-bg', group: 'nested-fallback alias (no own legacy default)' },
  { newName: '--liminis-editor-focus-border', literal: '#007acc', group: 'literal-backed alias (no CSS backing anywhere)' },
  { newName: '--liminis-editor-primary', literal: '#3b82f6', group: "host-brand-token alias (liminis-app's own Tailwind token, no package-level declaration)" },
];

test.describe('Electron shell — --liminis-editor-* definition-side aliases (#93)', () => {
  test('every sampled --liminis-editor-* name resolves to a real value equal to its legacy name (or literal default), light and dark, with no host override', async () => {
    const { app, page } = await launchShell();
    try {
      for (const { newName, legacyName, literal, group } of NO_OVERRIDE_CASES) {
        const newValue = await computedVar(page, newName);
        expect(newValue, `${newName} (${group}) resolved empty in light mode`).not.toBe('');
        if (legacyName) {
          const legacyValue = await computedVar(page, legacyName);
          expect(newValue, `${newName} !== ${legacyName} in light mode (${group})`).toBe(legacyValue);
        } else if (literal) {
          expect(newValue, `${newName} !== its literal default in light mode (${group})`).toBe(literal);
        }
      }

      await setDark(page, true);
      try {
        for (const { newName, legacyName, literal, group } of NO_OVERRIDE_CASES) {
          const newValue = await computedVar(page, newName);
          expect(newValue, `${newName} (${group}) resolved empty in dark mode`).not.toBe('');
          if (legacyName) {
            const legacyValue = await computedVar(page, legacyName);
            expect(newValue, `${newName} !== ${legacyName} in dark mode (${group})`).toBe(legacyValue);
          } else if (literal) {
            expect(newValue, `${newName} !== its literal default in dark mode (${group})`).toBe(literal);
          }
        }
      } finally {
        await setDark(page, false);
      }
    } finally {
      await app.close();
    }
  });

  test('a literal-backed alias with a dark-mode-varying JS literal (--liminis-editor-menu-background) tracks its own light/dark split', async () => {
    const { app, page } = await launchShell();
    try {
      const light = await computedVar(page, '--liminis-editor-menu-background');
      expect(light).not.toBe('');

      await setDark(page, true);
      const dark = await computedVar(page, '--liminis-editor-menu-background');
      await setDark(page, false);

      expect(dark).not.toBe('');
      expect(dark, 'menu-background alias did not vary between light and dark').not.toBe(light);
    } finally {
      await app.close();
    }
  });

  test('a host supplying only a legacy name is reflected by the corresponding --liminis-editor-* name (User Story 2)', async () => {
    const { app, page } = await launchShell();
    try {
      const cases: Array<{ legacyName: string; newName: string; value: string }> = [
        { legacyName: '--vscode-foreground', newName: '--liminis-editor-foreground', value: 'rgb(1, 2, 3)' },
        { legacyName: '--vscode-border', newName: '--liminis-editor-border', value: 'rgb(4, 5, 6)' },
        // liminis-app's actual current setup (Background/Edge Cases): only
        // its own Tailwind brand tokens set, nothing else.
        { legacyName: '--color-primary', newName: '--liminis-editor-primary', value: 'rgb(7, 8, 9)' },
        { legacyName: '--color-muted-foreground', newName: '--liminis-editor-muted-foreground', value: 'rgb(10, 11, 12)' },
        // A no-CSS-backing token overridden only via its legacy name.
        { legacyName: '--vscode-focus-border', newName: '--liminis-editor-focus-border', value: 'rgb(13, 14, 15)' },
      ];

      for (const { legacyName, newName, value } of cases) {
        await setHostOverride(page, legacyName, value);
        try {
          const resolved = await computedVar(page, newName);
          expect(resolved, `${newName} did not track host override of ${legacyName}`).toBe(value);
        } finally {
          await clearHostOverrides(page, [legacyName]);
        }
      }
    } finally {
      await app.close();
    }
  });

  test('a host setting the new name wins over a simultaneously-set legacy name (User Story 3)', async () => {
    const { app, page } = await launchShell();
    try {
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

  test('the @media print block\'s reset is picked up by the corresponding --liminis-editor-* aliases', async () => {
    const { app, page } = await launchShell();
    try {
      // src/styles.css's `@media print { :root, .dark { ... } }` block
      // (Background) resets these legacy names to print-safe literals. Each
      // alias is compared against its own legacy name's computed value
      // under print media, rather than a hardcoded literal — Chromium
      // normalizes some custom-property color text at computed-style time
      // (e.g. `#000000` serializes as `#000`), confirmed empirically while
      // writing this spec, so the legacy name's own computed value (subject
      // to the identical normalization) is the correct thing to compare
      // against, not the literal text as authored in styles.css.
      const printTargets: Array<[newName: string, legacyName: string]> = [
        ['--liminis-editor-foreground', '--vscode-foreground'],
        ['--liminis-editor-background', '--vscode-background'],
        ['--liminis-editor-code-bg', '--vscode-code-bg'],
        ['--liminis-editor-border', '--vscode-border'],
        ['--liminis-editor-checkbox-border', '--checkbox-border'],
        ['--liminis-editor-link', '--vscode-link'],
        ['--liminis-editor-h1-color', '--slashmd-h1-color'],
      ];

      // Establish the light-mode (non-print) values first, to prove the
      // print-mode comparison below is actually exercising the print
      // block's override and not merely re-confirming light-mode equality.
      const beforePrint = new Map<string, string>();
      for (const [newName] of printTargets) {
        beforePrint.set(newName, await computedVar(page, newName));
      }

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
      } finally {
        await page.emulateMedia({ media: null });
      }
    } finally {
      await app.close();
    }
  });
});
