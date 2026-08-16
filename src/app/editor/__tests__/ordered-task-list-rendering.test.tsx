/**
 * Component-level rendering coverage for #12: ordered task items must render
 * a real checkbox (not literal `[ ]`/`[x]` text), must be toggleable by click,
 * and toggling must round-trip to Markdown with exactly one marker per item.
 * fixture-roundtrip.test.ts's text-only comparison cannot see any of this —
 * the input and (buggy) output text were identical before this fix — so this
 * suite renders through a real DOM (happy-dom) with the production plugin
 * set (ListPlugin, CheckListPlugin, OrderedTaskListPlugin) mounted.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { render, act, cleanup } from '@testing-library/react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type { LexicalEditor } from 'lexical';
import { parseMarkdown } from '../../../markdown/parse';
import { stringifyMarkdown } from '../../../markdown/stringify';
import { importMarkdownToLexical } from '../../mapper/mdastToLexical';
import { exportLexicalToMdast } from '../../mapper/lexicalToMdast';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { OrderedTaskListPlugin } from '../OrderedTaskListPlugin';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, '..', '..', 'mapper', '__tests__', 'fixtures', 'roundtrip');

function CaptureEditor({ onReady }: { onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    onReady(editor);
  }, [editor, onReady]);
  return null;
}

/** Mounts a real editor with the production list/checklist plugin set, plus OrderedTaskListPlugin. */
async function mountEditor(extra: ReactNode = null): Promise<{ editor: LexicalEditor; container: HTMLElement }> {
  let editor: LexicalEditor | null = null;
  let container!: HTMLElement;
  await act(async () => {
    ({ container } = render(
      <LexicalComposer
        initialConfig={{
          namespace: 'ordered-task-list-rendering-test',
          nodes: editorNodes,
          theme: {
            list: {
              ul: 'editor-list-ul',
              ol: 'editor-list-ol',
              listitem: 'editor-listitem',
              listitemChecked: 'editor-listitem-checked',
              listitemUnchecked: 'editor-listitem-unchecked',
              nested: { listitem: 'editor-nested-listitem' },
            },
          },
          onError: (e) => {
            throw e;
          },
        }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable />}
          placeholder={null}
          ErrorBoundary={({ children }) => <>{children}</>}
        />
        <ListPlugin />
        <CheckListPlugin />
        <OrderedTaskListPlugin />
        <CaptureEditor
          onReady={(e) => {
            editor = e;
          }}
        />
        {extra}
      </LexicalComposer>,
    ));
  });
  return { editor: editor!, container };
}

async function importMarkdown(editor: LexicalEditor, markdown: string): Promise<void> {
  const parsed = parseMarkdown(markdown);
  await act(async () => {
    editor.update(() => {
      importMarkdownToLexical(editor, parsed.root);
    });
  });
}

function exportMarkdown(editor: LexicalEditor): string {
  const mdast = exportLexicalToMdast(editor);
  return stringifyMarkdown(mdast);
}

afterEach(() => {
  cleanup();
});

describe('Ordered task list rendering (#12)', () => {
  it('ordered-task-list.md renders checkboxes with no literal marker text', async () => {
    const markdown = readFileSync(join(FIXTURES_DIR, 'ordered-task-list.md'), 'utf-8');
    const { editor, container } = await mountEditor();
    await importMarkdown(editor, markdown);

    const items = Array.from(container.querySelectorAll('li'));
    expect(items).toHaveLength(2);

    for (const item of items) {
      expect(item.textContent).not.toMatch(/^\[( |x|X)\]/);
    }

    expect(items[0].classList.contains('editor-listitem-ordered-unchecked')).toBe(true);
    expect(items[0].getAttribute('aria-checked')).toBe('false');
    expect(items[1].classList.contains('editor-listitem-ordered-checked')).toBe(true);
    expect(items[1].getAttribute('aria-checked')).toBe('true');

    // Still numbered, not demoted to a bullet list.
    expect(container.querySelector('ol')).not.toBeNull();
  });

  it('897-list-item-block-content/ordered-task-list-leading-link.md: leading link is not conflated with the checkbox', async () => {
    const markdown = readFileSync(join(FIXTURES_DIR, '897-list-item-block-content', 'ordered-task-list-leading-link.md'), 'utf-8');
    const { editor, container } = await mountEditor();
    await importMarkdown(editor, markdown);

    const items = Array.from(container.querySelectorAll('li'));
    expect(items).toHaveLength(2);

    for (const item of items) {
      expect(item.textContent).not.toMatch(/^\[( |x|X)\]/);
    }

    expect(items[0].classList.contains('editor-listitem-ordered-unchecked')).toBe(true);
    expect(items[1].classList.contains('editor-listitem-ordered-checked')).toBe(true);
    // The leading link's own text must render normally, with no marker prefix.
    expect(items[0].querySelector('a')?.textContent).toBe('Link text');
  });

  it('a plain item in a mixed ordered list gets no checkbox (FR-007)', async () => {
    const markdown = '1. [ ] Task one\n2. Plain item\n3. [x] Task two\n';
    const { editor, container } = await mountEditor();
    await importMarkdown(editor, markdown);

    const items = Array.from(container.querySelectorAll('li'));
    expect(items).toHaveLength(3);

    expect(items[0].classList.contains('editor-listitem-ordered-unchecked')).toBe(true);
    expect(items[1].classList.contains('editor-listitem-ordered-checked')).toBe(false);
    expect(items[1].classList.contains('editor-listitem-ordered-unchecked')).toBe(false);
    expect(items[1].hasAttribute('role')).toBe(false);
    expect(items[2].classList.contains('editor-listitem-ordered-checked')).toBe(true);
  });

  it('a nested ordered task list renders checkboxes the same as top-level', async () => {
    const markdown = '1. [ ] Parent task\n   1. [ ] Nested task one\n   2. [x] Nested task two\n';
    const { editor, container } = await mountEditor();
    await importMarkdown(editor, markdown);

    const nestedOl = container.querySelector('ol ol');
    expect(nestedOl).not.toBeNull();
    const nestedItems = Array.from(nestedOl!.querySelectorAll(':scope > li'));
    expect(nestedItems).toHaveLength(2);
    expect(nestedItems[0].classList.contains('editor-listitem-ordered-unchecked')).toBe(true);
    expect(nestedItems[1].classList.contains('editor-listitem-ordered-checked')).toBe(true);
  });

  it('clicking an ordered checkbox toggles it, and export produces exactly one marker reflecting the new state', async () => {
    const markdown = '1. [ ] Task one\n2. [x] Task two\n';
    const { editor, container } = await mountEditor();
    await importMarkdown(editor, markdown);

    const items = Array.from(container.querySelectorAll('li'));
    const target = items[0];
    expect(target.classList.contains('editor-listitem-ordered-unchecked')).toBe(true);

    // happy-dom has no real layout engine, so stub the geometry OrderedTaskListPlugin's
    // hit-test reads (matches the stubbing convention in host-plugins.test.tsx) to place
    // a click squarely inside the checkbox's ::before box. calculateZoomLevel() (@lexical/utils)
    // multiplies getComputedStyle(el).getPropertyValue('zoom') across every ancestor up to
    // <html> — happy-dom has no 'zoom' property, so the real implementation returns '' there,
    // and Number('') is 0, poisoning the whole product to 0 (clientX / 0 = Infinity). Stub
    // getPropertyValue('zoom') to '1' unconditionally so the geometry math resolves the way
    // it would in a real browser, and reserve the custom ::before width for the target only.
    target.getBoundingClientRect = () => ({ left: 100, right: 400 }) as DOMRect;
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const width = el === target && pseudo === '::before' ? '16px' : '0px';
      return {
        width,
        getPropertyValue: (prop: string) => (prop === 'zoom' ? '1' : ''),
      } as unknown as CSSStyleDeclaration;
    });

    try {
      await act(async () => {
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 105 }));
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 105 }));
      });
    } finally {
      getComputedStyleSpy.mockRestore();
    }

    expect(target.classList.contains('editor-listitem-ordered-checked')).toBe(true);
    expect(target.getAttribute('aria-checked')).toBe('true');

    const output = exportMarkdown(editor);
    expect(output).toBe('1. [x] Task one\n2. [x] Task two\n');

    // FR-006: a second round trip after the toggle is a fixed point.
    const secondEditor = await mountEditor();
    await importMarkdown(secondEditor.editor, output);
    const secondOutput = exportMarkdown(secondEditor.editor);
    expect(secondOutput).toBe(output);
  });
});
