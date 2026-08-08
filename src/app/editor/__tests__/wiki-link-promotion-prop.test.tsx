/**
 * SC-003 (#951): `<Editor wikiLinkPromotion="off">` reaches the markdown export
 * path end to end — a host that sets the prop sees an untitled relative link
 * come back through `onChange` as a standard markdown link, not promoted to
 * wiki-link syntax. Mirrors the mount pattern in `editor-annotations-disabled.test.tsx`.
 *
 * The mounted `<Editor>` doesn't expose its internal `LexicalEditor` via any
 * prop, so the test drives a real edit through `getNearestEditorFromDOMNode`
 * (public Lexical API) against the rendered contenteditable root, then lets
 * the same debounce/flush path a real host goes through (`OnChangePlugin` ->
 * `flushPendingChange` -> `exportLexicalToMdast`) run under fake timers.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { $createParagraphNode, $createTextNode, $getRoot, getNearestEditorFromDOMNode } from 'lexical';
import { Editor } from '../Editor';
import { EditorHostProvider } from '../../../host/context';
import { $createCustomLinkNode } from '../nodes';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const INITIAL_CONTENT = 'placeholder\n';
// Mirrors Editor.tsx's own constants: the change from replaceWithLink below
// must land after the post-load suppress window, then clear its own debounce.
const POST_LOAD_SUPPRESS_MS = 500;
const DEBOUNCE_DELAY = 100;

function renderEditor(props: Record<string, unknown> = {}) {
  return render(
    <EditorHostProvider>
      <Editor initialContent={INITIAL_CONTENT} onChange={() => undefined} {...props} />
    </EditorHostProvider>,
  );
}

/** Replaces the document with a single paragraph containing one link, and waits for the debounced onChange to fire. */
async function replaceWithLink(container: HTMLElement, options: { wikiLinkOrigin?: boolean } = {}): Promise<void> {
  const root = container.querySelector<HTMLElement>('[contenteditable]')!;
  const editor = getNearestEditorFromDOMNode(root)!;

  // Let the initial-load suppress window elapse first, or this edit's own
  // change event would be swallowed as normalization noise (see Editor.tsx's
  // POST_LOAD_SUPPRESS_MS handling in handleChange/flushPendingChange).
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POST_LOAD_SUPPRESS_MS + 10);
  });

  await act(async () => {
    editor.update(() => {
      const paragraph = $createParagraphNode();
      const link = $createCustomLinkNode('notes.md');
      if (options.wikiLinkOrigin) link.setWikiLinkOrigin(true);
      link.append($createTextNode('note'));
      paragraph.append(link);
      $getRoot().clear().append(paragraph);
    });
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(DEBOUNCE_DELAY + 10);
  });
}

describe('Editor wikiLinkPromotion prop (#951, SC-003)', () => {
  it('emits an untitled relative link unpromoted when set to "off"', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    let container!: HTMLElement;

    await act(async () => {
      ({ container } = renderEditor({ wikiLinkPromotion: 'off', onChange }));
    });

    await replaceWithLink(container);

    expect(onChange).toHaveBeenCalledWith('[note](notes.md)\n');
  });

  it('still promotes the same link to wiki-link syntax when the prop is unset (default parity)', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    let container!: HTMLElement;

    await act(async () => {
      ({ container } = renderEditor({ onChange }));
    });

    await replaceWithLink(container);

    expect(onChange).toHaveBeenCalledWith('[[notes|note]]\n');
  });

  it('still emits a genuine wiki-link as wiki-link syntax when set to "off"', async () => {
    // The opt-out only stops promoting an *ordinary* link that merely looks
    // wiki-link-shaped — it must not demote a link that was genuine
    // author-written [[...]] syntax, or an opted-out host would corrupt a
    // document's existing wiki-links on save. See CustomLinkNode's
    // wikiLinkOrigin flag, set by mdastToLexical's `wikiLink` case.
    vi.useFakeTimers();
    const onChange = vi.fn();
    let container!: HTMLElement;

    await act(async () => {
      ({ container } = renderEditor({ wikiLinkPromotion: 'off', onChange }));
    });

    await replaceWithLink(container, { wikiLinkOrigin: true });

    expect(onChange).toHaveBeenCalledWith('[[notes|note]]\n');
  });
});
