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
import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const EDITOR = '[aria-label="Markdown editor"]';
const MARKER = `${EDITOR} mark`;

async function launchShell(extraArgs: string[] = []): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [APP_DIR, ...extraArgs] });
  const page = await app.firstWindow();
  await page.waitForSelector(EDITOR);
  // `AnnotationPlugin` — the piece that registers the create-affordance
  // command handler — is mounted inside a `React.lazy()` boundary
  // (`Editor.tsx`'s `LazyAnnotationSurface`), while `Toolbar` (which renders
  // the "Note" button) is not. The button can therefore be visible and
  // clickable before its own command handler has finished loading; clicking
  // in that window is indistinguishable from #961's defect (a rendered
  // button that does nothing) even though nothing is actually broken.
  // Waiting for the network to settle after the shell first paints ensures
  // the lazily-loaded chunk has arrived before any test interacts with it.
  await page.waitForLoadState('networkidle');
  return { app, page };
}

/**
 * Double-clicks the exact on-screen position of `word`, using a real
 * `page.mouse` event dispatched by Playwright — the actual point of this
 * suite, since Chromium's own word-selection algorithm decides what gets
 * selected, not a synthetic `Range` the way a jsdom/happy-dom unit test has
 * to construct one.
 *
 * A plain `locator.dblclick()` targets an element's bounding-box center,
 * which for a paragraph is wherever the *paragraph* happens to center on —
 * not the specific word inside it. A short, precisely-positioned `Range` is
 * used only to compute *where* to click; the click itself, and everything it
 * selects, is the browser's.
 */
async function selectWordByDoubleClick(page: Page, word: string): Promise<void> {
  const { x, y } = await page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf(needle) ?? -1;
      if (index !== -1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        // Bring the match into view before measuring. The shell loads a long
        // sample document, so a match can sit far below the fold — and a
        // click at an off-screen coordinate silently lands on whatever is
        // actually at that point in the viewport, rather than failing.
        node.parentElement?.scrollIntoView({ block: 'center' });
        const rect = range.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    throw new Error(`no text node containing ${JSON.stringify(needle)}`);
  }, word);

  await page.mouse.dblclick(x, y);
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
