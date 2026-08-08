/**
 * End-to-end coverage for the toolbar-surfaced create affordance (SC-006),
 * including the read-only path (issue #965).
 *
 * `Toolbar` and `AnnotationPlugin` are already each covered in isolation
 * (`selection-context-menu-selection.test.tsx`'s Seed pattern for a live
 * Lexical selection, `annotation-plugins.test.tsx`'s Harness/selectText
 * pattern for the capture path) — this file wires the two together the way
 * `Editor.tsx` does, so the actual user path (select → click the rendered
 * button → onCreateAnnotation) is exercised, not just its two halves.
 *
 * jsdom does not fire `selectionchange` when a native `Range` is added
 * programmatically (documented jsdom limitation), so every test here that
 * exercises the real user path dispatches a manual `selectionchange` event
 * to stand in for it.
 *
 * Two distinct selection helpers matter, because they exercise different
 * code paths in `Toolbar`:
 *   - `selectNeedle` sets *both* a live Lexical selection and the native
 *     selection, then dispatches `SELECTION_CHANGE_COMMAND` by hand — the
 *     proxy for a drag-selection while editable, where Lexical's own command
 *     reliably fires.
 *   - `selectNeedleNatively` sets *only* the native selection and fires a
 *     manual `selectionchange` event, with no Lexical selection and no
 *     `SELECTION_CHANGE_COMMAND` dispatch at all — the proxy for a
 *     double-click selection, and for *any* selection on a non-editable
 *     root, where Lexical never reports a range selection. Before #965,
 *     `Toolbar` computed visibility exclusively from Lexical's selection, so
 *     this path is exactly what the bug hid.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import {
  $createRangeSelection,
  $getRoot,
  $setSelection,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { Toolbar } from '../Toolbar';
import { AnnotationPlugin, type AnnotationCreateEvent } from '../AnnotationPlugin';
import { OPEN_ANNOTATION_COMPOSER_COMMAND } from '../annotationCommands';
import type { AnnotationKindConfigs } from '../../../annotations/types';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorState } from '../../mapper/mdastToLexical';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';

afterEach(cleanup);

const MARKDOWN = 'The quick brown fox jumps over the lazy dog.\n';
const NEEDLE = 'quick brown fox';

// The story's own example config (spec Acceptance Scenario 1): a single
// toolbar-surfaced kind, no `correction` kind configured at all.
const COMMENT_KINDS: AnnotationKindConfigs = {
  comment: {
    markerStyle: 'highlight',
    createAffordance: { surface: 'toolbar', label: 'Comment' },
    retainMarkOnCreate: true,
  },
};

/** Seeds markdown content and wires `Toolbar` + `AnnotationPlugin` together. */
function Harness({
  onCreate,
  annotationAffordances,
}: {
  onCreate: (e: AnnotationCreateEvent) => void;
  annotationAffordances: { kind: string; label: string }[];
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.update(
      () => {
        importMarkdownToLexicalInEditorState(parseMarkdown(MARKDOWN).root);
      },
      { discrete: true },
    );
  }, [editor]);

  return (
    <>
      <Toolbar annotationAffordances={annotationAffordances} />
      <AnnotationPlugin kinds={COMMENT_KINDS} onCreateAnnotation={onCreate} />
    </>
  );
}

/**
 * Selects `needle` both natively (what `AnnotationPlugin`'s capture reads)
 * and as a live Lexical selection (what `Toolbar`'s visibility reads), then
 * dispatches `SELECTION_CHANGE_COMMAND` — jsdom's stand-in for the
 * `selectionchange` event a real selection would fire. Returns the editor so
 * callers don't need a second `useLexicalComposerContext` plumbing.
 */
function selectNeedle(editor: import('lexical').LexicalEditor, needle: string): void {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let found = false;
  while ((node = walker.nextNode())) {
    const index = node.textContent?.indexOf(needle) ?? -1;
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`no text node containing ${JSON.stringify(needle)}`);

  editor.update(
    () => {
      const textNode = $getRoot()
        .getAllTextNodes()
        .find((n) => n.getTextContent().includes(needle))!;
      const idx = textNode.getTextContent().indexOf(needle);
      const selection = $createRangeSelection();
      selection.anchor.set(textNode.getKey(), idx, 'text');
      selection.focus.set(textNode.getKey(), idx + needle.length, 'text');
      $setSelection(selection);
    },
    { discrete: true },
  );

  editor.dispatchCommand(SELECTION_CHANGE_COMMAND, undefined);
}

/**
 * Selects `needle` in the native DOM only — no Lexical selection is ever
 * set, and `SELECTION_CHANGE_COMMAND` is never dispatched. This is the path
 * a real double-click selection takes, and the only path any selection can
 * take on a non-editable root, since Lexical does not sync a non-editable
 * root's native selection into its own model. A manual `selectionchange`
 * event stands in for jsdom's documented failure to fire one for a
 * programmatically-added `Range`.
 */
function selectNeedleNatively(needle: string): void {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let found = false;
  while ((node = walker.nextNode())) {
    const index = node.textContent?.indexOf(needle) ?? -1;
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`no text node containing ${JSON.stringify(needle)}`);

  document.dispatchEvent(new Event('selectionchange'));
}

/**
 * Sets a zero-length (collapsed) native selection at `needle` — a plain
 * click, no drag — and fires the event. Distinct from an empty selection
 * (`rangeCount === 0`): this is a real `Range` whose start equals its end.
 */
function collapseNativeSelection(needle: string): void {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let found = false;
  while ((node = walker.nextNode())) {
    const index = node.textContent?.indexOf(needle) ?? -1;
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`no text node containing ${JSON.stringify(needle)}`);

  document.dispatchEvent(new Event('selectionchange'));
}

/**
 * Selects text in an element appended outside the editor's own root, to
 * exercise the containment check (FR-003): a `selectionchange` fired for a
 * selection elsewhere on the page must not show this editor's toolbar.
 */
function selectOutsideRoot(text: string): HTMLElement {
  const outside = document.createElement('div');
  outside.textContent = text;
  document.body.appendChild(outside);

  const range = document.createRange();
  range.selectNodeContents(outside);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);

  document.dispatchEvent(new Event('selectionchange'));
  return outside;
}

/** Captures the live editor instance for use by `selectNeedle` outside React. */
function EditorCapture({ editorRef }: { editorRef: { current: import('lexical').LexicalEditor | null } }) {
  const [editor] = useLexicalComposerContext();
  editorRef.current = editor;
  return null;
}

describe('Toolbar — the toolbar-surfaced create affordance (US1/SC-001/SC-006)', () => {
  function renderAndSelect(onCreate: (e: AnnotationCreateEvent) => void, editable = true) {
    const editorRef: { current: import('lexical').LexicalEditor | null } = { current: null };
    const utils = render(
      <LexicalComposer
        initialConfig={{
          namespace: 'toolbar-annotation-create-test',
          nodes: editorNodes,
          editable,
          onError: (error: Error) => {
            throw error;
          },
        }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable />}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <EditorCapture editorRef={editorRef} />
        <Harness onCreate={onCreate} annotationAffordances={[{ kind: 'comment', label: 'Comment' }]} />
      </LexicalComposer>,
    );

    act(() => {
      selectNeedle(editorRef.current!, NEEDLE);
    });

    return utils;
  }

  it('offers a "Comment" affordance once a non-collapsed selection is live', () => {
    const { getByLabelText } = renderAndSelect(vi.fn());

    const button = getByLabelText('Comment');
    expect(button).not.toBeNull();
    expect(button.tagName).toBe('BUTTON');
  });

  it('fires onCreateAnnotation exactly once with the minted id, anchor, and rect on invocation', async () => {
    const onCreate = vi.fn();
    const { getByLabelText } = renderAndSelect(onCreate);

    await act(async () => {
      fireEvent.mouseDown(getByLabelText('Comment'));
    });

    expect(onCreate).toHaveBeenCalledOnce();
    const event = onCreate.mock.calls[0][0] as AnnotationCreateEvent;
    expect(event.kind).toBe('comment');
    expect(event.id).toBeTruthy();
    expect(event.anchor?.targetText).toBe(NEEDLE);
    expect(event.rect).toBeDefined();
  });

  it('offers one affordance per toolbar-surfaced kind (FR-009)', () => {
    const editorRef: { current: import('lexical').LexicalEditor | null } = { current: null };
    const { getByLabelText } = render(
      <LexicalComposer
        initialConfig={{
          namespace: 'toolbar-multi-kind-test',
          nodes: editorNodes,
          onError: (error: Error) => {
            throw error;
          },
        }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable />}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <EditorCapture editorRef={editorRef} />
        <Harness
          onCreate={vi.fn()}
          annotationAffordances={[
            { kind: 'comment', label: 'Comment' },
            { kind: 'flag', label: 'Flag' },
          ]}
        />
      </LexicalComposer>,
    );

    act(() => {
      selectNeedle(editorRef.current!, NEEDLE);
    });

    expect(() => getByLabelText('Comment')).not.toThrow();
    expect(() => getByLabelText('Flag')).not.toThrow();
  });
});

/** Renders `Toolbar` + `AnnotationPlugin` wired together, `editable` and affordances configurable. */
function renderToolbar({
  editable = true,
  annotationAffordances = [{ kind: 'comment', label: 'Comment' }],
  onCreate = vi.fn(),
}: {
  editable?: boolean;
  annotationAffordances?: { kind: string; label: string }[];
  onCreate?: (e: AnnotationCreateEvent) => void;
} = {}) {
  const editorRef: { current: import('lexical').LexicalEditor | null } = { current: null };
  const utils = render(
    <LexicalComposer
      initialConfig={{
        namespace: 'toolbar-readonly-test',
        nodes: editorNodes,
        editable,
        onError: (error: Error) => {
          throw error;
        },
      }}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <EditorCapture editorRef={editorRef} />
      <Harness onCreate={onCreate} annotationAffordances={annotationAffordances} />
    </LexicalComposer>,
  );
  return { ...utils, editorRef, onCreate };
}

// US1: a read-only editor's native selection (drag or double-click both
// collapse to "a Range is set and selectionchange fires" in jsdom — see the
// file header) must make the toolbar-surfaced affordance reachable, since
// Lexical never reports a range selection on a non-editable root (#965).
describe('Toolbar — reachable in a read-only editor via the native selection (US1, issue #965)', () => {
  it('shows only the configured affordance, no formatting controls (AC1/AC2)', () => {
    const { getByLabelText, queryByLabelText } = renderToolbar({ editable: false });

    act(() => {
      selectNeedleNatively(NEEDLE);
    });

    const button = getByLabelText('Comment');
    expect(button).not.toBeNull();
    expect(queryByLabelText('Bold')).toBeNull();
    expect(queryByLabelText('Italic')).toBeNull();
    expect(queryByLabelText('Link')).toBeNull();
  });

  it('fires onCreateAnnotation with a captured anchor on invocation (AC3, SC-001)', async () => {
    const onCreate = vi.fn();
    const { getByLabelText } = renderToolbar({ editable: false, onCreate });

    act(() => {
      selectNeedleNatively(NEEDLE);
    });

    await act(async () => {
      fireEvent.mouseDown(getByLabelText('Comment'));
    });

    expect(onCreate).toHaveBeenCalledOnce();
    const event = onCreate.mock.calls[0][0] as AnnotationCreateEvent;
    expect(event.kind).toBe('comment');
    expect(event.anchor?.targetText).toBe(NEEDLE);
  });
});

// US2/SC-003: a read-only editor with no toolbar-surfaced kind configured has
// nothing to offer — the toolbar must not render an empty, contentless bar.
describe('Toolbar — nothing renders read-only with no toolbar-surfaced kind (US2/SC-003)', () => {
  it('renders no .toolbar element for any selection', () => {
    const { container } = renderToolbar({ editable: false, annotationAffordances: [] });

    act(() => {
      selectNeedleNatively(NEEDLE);
    });

    expect(container.querySelector('.toolbar')).toBeNull();
  });
});

// US3/SC-005: while editable, a double-click-style selection (native
// selection only, no SELECTION_CHANGE_COMMAND dispatch) must also show the
// toolbar — previously only drag-selections reliably did.
describe('Toolbar — double-click parity while editable (US3/SC-005)', () => {
  it('shows formatting controls and configured affordances on a native-only selection', () => {
    const { getByLabelText } = renderToolbar({ editable: true });

    act(() => {
      selectNeedleNatively(NEEDLE);
    });

    expect(getByLabelText('Bold')).not.toBeNull();
    expect(getByLabelText('Comment')).not.toBeNull();
  });
});

describe('Toolbar — edge cases', () => {
  it('does not appear for a selection outside the editor root (FR-003)', () => {
    const { container } = renderToolbar();

    let outside!: HTMLElement;
    act(() => {
      outside = selectOutsideRoot('elsewhere on the page');
    });

    expect(container.querySelector('.toolbar')).toBeNull();
    outside.remove();
  });

  it('does not appear for a collapsed native selection while editable (FR-009)', () => {
    const { container } = renderToolbar();

    act(() => {
      selectNeedleNatively(NEEDLE);
    });
    expect(container.querySelector('.toolbar')).not.toBeNull();

    act(() => {
      collapseNativeSelection(NEEDLE);
    });
    expect(container.querySelector('.toolbar')).toBeNull();
  });

  it('does not appear for a collapsed native selection while read-only (FR-009)', () => {
    const { container } = renderToolbar({ editable: false });

    act(() => {
      collapseNativeSelection(NEEDLE);
    });

    expect(container.querySelector('.toolbar')).toBeNull();
  });
});

// User Story 3 / FR-007: with no toolbar-surfaced kind configured, the
// toolbar shows only its existing formatting controls, and no annotation
// command is ever dispatched — unchanged from today's behaviour.
describe('Toolbar — no configured kind means no affordance (User Story 3)', () => {
  it('renders no annotation button when annotationAffordances is empty', () => {
    const { queryByLabelText } = render(
      <LexicalComposer
        initialConfig={{
          namespace: 'toolbar-no-kinds-test',
          nodes: editorNodes,
          onError: (error: Error) => {
            throw error;
          },
        }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable />}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <Toolbar />
      </LexicalComposer>,
    );

    expect(queryByLabelText('Comment')).toBeNull();
  });

  it('never dispatches OPEN_ANNOTATION_COMPOSER_COMMAND when no affordance is configured', async () => {
    const seen: string[] = [];
    const editorRef: { current: import('lexical').LexicalEditor | null } = { current: null };

    function CommandRecorder() {
      const [editor] = useLexicalComposerContext();
      useEffect(
        () =>
          editor.registerCommand(
            OPEN_ANNOTATION_COMPOSER_COMMAND,
            ({ kind }) => {
              seen.push(kind);
              return true;
            },
            0,
          ),
        [editor],
      );
      return null;
    }

    render(
      <LexicalComposer
        initialConfig={{
          namespace: 'toolbar-no-dispatch-test',
          nodes: editorNodes,
          onError: (error: Error) => {
            throw error;
          },
        }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable />}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <EditorCapture editorRef={editorRef} />
        <CommandRecorder />
        <Harness onCreate={vi.fn()} annotationAffordances={[]} />
      </LexicalComposer>,
    );

    act(() => {
      selectNeedle(editorRef.current!, NEEDLE);
    });

    expect(seen).toEqual([]);
  });
});
