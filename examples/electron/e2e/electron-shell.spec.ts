/**
 * Package-level e2e for `@liminis/editor`, run against the minimal Electron
 * shell in this directory rather than `liminis-app` (verveguy/liminis-editor#2,
 * FR-003/FR-004).
 *
 * Both scenarios below reproduce, against real Electron/Chromium, defects
 * that previously escaped a jsdom/happy-dom-based unit test:
 *
 * - verveguy/liminis#961: a `toolbar`-surfaced annotation kind whose type
 *   advertised the affordance but no code implemented it.
 * - verveguy/liminis#965: the toolbar's create affordance was unreachable
 *   specifically when the editor is read-only, because happy-dom does not
 *   report a Lexical range selection for a native double-click the way real
 *   Electron does (see `Toolbar.tsx`'s own regression-guard unit test for
 *   the synthetic `selectionchange` workaround that test needs and this one
 *   does not).
 *
 * `_electron.launch()` manages the CDP connection itself, satisfying FR-002
 * without a manual attach step.
 */
import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

const EDITOR = '[aria-label="Markdown editor"]'
const MARKER = `${EDITOR} mark`

async function launchShell(extraArgs: string[] = []): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [APP_DIR, ...extraArgs] })
  const page = await app.firstWindow()
  await page.waitForSelector(EDITOR)
  return { app, page }
}

/**
 * A real double-click, driven at the OS/Chromium level by Playwright — not a
 * synthetic `Range` + dispatched event, which is what a jsdom/happy-dom unit
 * test has to construct in place of the browser behavior this test exists to
 * observe directly.
 */
async function selectWordByDoubleClick(page: Page, word: string): Promise<void> {
  await page.getByText(word, { exact: false }).first().dblclick();
}

test.describe('Electron shell — toolbar annotation affordance', () => {
  test('a toolbar-surfaced kind renders a working create affordance in an editable document (#961 shape)', async () => {
    const { app, page } = await launchShell();
    try {
      const shell = page.locator('[data-testid="shell"]');
      await expect(shell).toHaveAttribute('data-editable', 'true');

      await selectWordByDoubleClick(page, 'fox');

      const noteButton = page.getByRole('button', { name: 'Note' });
      await expect(noteButton).toBeVisible();
      await noteButton.click();

      // A working affordance has a visible effect — #961 was a rendered
      // button that did nothing at all when clicked.
      await expect(page.locator(MARKER)).toHaveCount(1);
    } finally {
      await app.close();
    }
  });

  test('the create affordance works against a read-only document (#965 shape)', async () => {
    const { app, page } = await launchShell(['--readonly']);
    try {
      const shell = page.locator('[data-testid="shell"]');
      await expect(shell).toHaveAttribute('data-editable', 'false');

      // The exact case a jsdom-class unit test cannot observe: real
      // Electron reports a Lexical range selection for a native
      // double-click on a non-editable root; happy-dom did not (#965).
      await selectWordByDoubleClick(page, 'fox');

      const noteButton = page.getByRole('button', { name: 'Note' });
      await expect(noteButton).toBeVisible();
      await noteButton.click();

      await expect(page.locator(MARKER)).toHaveCount(1);
    } finally {
      await app.close();
    }
  });
});
