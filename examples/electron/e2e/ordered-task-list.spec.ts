/**
 * Package-level e2e for #12 (ordered task lists render literal `[ ]` text
 * instead of checkboxes), run against real Electron/Chromium rather than the
 * text-only round-trip corpus — the whole reason this defect escaped that
 * corpus is that the buggy import produced the same output text as the
 * input, so a rendering-level assertion (SC-001/SC-004) is the only thing
 * that can actually see the checkbox affordance (or its absence).
 *
 * Loads the exact fixtures named in the issue/spec via `--content-file`
 * (added to `main.cjs`/`App.jsx` for this issue) rather than duplicating
 * their markdown inline.
 */
import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'app', 'mapper', '__tests__', 'fixtures', 'roundtrip');

const EDITOR = '[aria-label="Markdown editor"]';

async function launchShell(contentFile: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [APP_DIR, '--content-file', contentFile] });
  const page = await app.firstWindow();
  await page.waitForSelector(EDITOR);
  await page.waitForLoadState('networkidle');
  return { app, page };
}

test.describe('Electron shell — ordered task-list checkboxes (#12)', () => {
  test('ordered-task-list.md renders real checkboxes, still numbered, with no literal [ ]/[x] text (SC-001)', async () => {
    const { app, page } = await launchShell(join(FIXTURES_DIR, 'ordered-task-list.md'));
    try {
      const items = page.locator(`${EDITOR} li`);
      await expect(items).toHaveCount(2);

      const texts = await items.allTextContents();
      for (const text of texts) {
        expect(text).not.toMatch(/^\[( |x|X)\]/);
      }

      // Still numbered — an <ol>, not demoted to a bullet list.
      await expect(page.locator(`${EDITOR} ol`)).toHaveCount(1);

      await expect(items.nth(0)).toHaveClass(/editor-listitem-ordered-unchecked/);
      await expect(items.nth(0)).toHaveAttribute('aria-checked', 'false');
      await expect(items.nth(1)).toHaveClass(/editor-listitem-ordered-checked/);
      await expect(items.nth(1)).toHaveAttribute('aria-checked', 'true');
    } finally {
      await app.close();
    }
  });

  test('897-list-item-block-content/ordered-task-list-leading-link.md: leading link renders normally alongside the checkbox', async () => {
    const { app, page } = await launchShell(join(FIXTURES_DIR, '897-list-item-block-content', 'ordered-task-list-leading-link.md'));
    try {
      const items = page.locator(`${EDITOR} li`);
      await expect(items).toHaveCount(2);

      const texts = await items.allTextContents();
      for (const text of texts) {
        expect(text).not.toMatch(/^\[( |x|X)\]/);
      }

      await expect(items.nth(0)).toHaveClass(/editor-listitem-ordered-unchecked/);
      await expect(page.locator(`${EDITOR} li a`)).toHaveText('Link text');
    } finally {
      await app.close();
    }
  });

  test('clicking a checkbox toggles it and the exported markdown reflects exactly one marker (SC-002)', async () => {
    const { app, page } = await launchShell(join(FIXTURES_DIR, 'ordered-task-list.md'));
    try {
      const firstItem = page.locator(`${EDITOR} li`).nth(0);
      await expect(firstItem).toHaveClass(/editor-listitem-ordered-unchecked/);

      // Click inside the checkbox's ::before box — position:relative on the
      // <li>, ::before at left:0/top:4px/16x16px (styles.css) — using a real
      // Chromium click, the same real-coordinate technique
      // electron-shell.spec.ts's selectWordByDoubleClick uses, since only a
      // real browser (not happy-dom) lays out ::before geometry for
      // OrderedTaskListPlugin's hit-test to read.
      const box = await firstItem.boundingBox();
      if (!box) throw new Error('ordered task item has no bounding box');
      await page.mouse.click(box.x + 8, box.y + 12);

      await expect(firstItem).toHaveClass(/editor-listitem-ordered-checked/);
      await expect(firstItem).toHaveAttribute('aria-checked', 'true');

      const output = page.locator('[data-testid="markdown-output"]');
      await expect(output).toHaveText('1. [x] Task one\n2. [x] Task two\n');
    } finally {
      await app.close();
    }
  });
});
