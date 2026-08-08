/**
 * End-to-end coverage for the toolbar-surfaced create affordance (SC-006).
 *
 * `Toolbar` and `AnnotationPlugin` are already each covered in isolation
 * (`selection-context-menu-selection.test.tsx`'s Seed pattern for a live
 * Lexical selection, `annotation-plugins.test.tsx`'s Harness/selectText
 * pattern for the capture path) — this file wires the two together the way
 * `Editor.tsx` does, so the actual user path (select → click the rendered
 * button → onCreateAnnotation) is exercised, not just its two halves.
 *
 * jsdom does not fire `selectionchange` when a native `Range` is added
 * programmatically, so a real click-and-drag selection would leave `Toolbar`
 * invisible in this environment no matter what the component does. Both the
 * native selection (which `AnnotationPlugin`'s capture reads) and the live
 * Lexical selection (which `Toolbar`'s visibility reads) are set explicitly,
 * and `SELECTION_CHANGE_COMMAND` is dispatched by hand to stand in for the
 * event jsdom won't produce.
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

  // Annotating is decoupled from editing (FR-006) — AnnotationPlugin already
  // ignores `editable`, and neither Toolbar's existing buttons nor the new one
  // check it either. SC-002 pins that the toolbar path specifically inherits
  // this rather than regressing it.
  it('still offers the affordance and fires onCreateAnnotation when read-only (SC-002)', async () => {
    const onCreate = vi.fn();
    const { getByLabelText } = renderAndSelect(onCreate, false);

    const button = getByLabelText('Comment');
    expect(button).not.toBeNull();

    await act(async () => {
      fireEvent.mouseDown(button);
    });

    expect(onCreate).toHaveBeenCalledOnce();
    expect((onCreate.mock.calls[0][0] as AnnotationCreateEvent).kind).toBe('comment');
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
