/**
 * `AnnotationEditorHandle.createAnnotation` (FR-001/FR-002) is the bridge a
 * host uses to trigger the same create-on-selection flow the toolbar's
 * affordance button dispatches, from outside the `LexicalComposer` tree
 * entirely — e.g. an ancestor-rendered context menu (User Story 1).
 *
 * These tests exercise it exclusively through `AnnotationSurface`'s public
 * surface (`editorHandleRef` + `onCreateAnnotation`), the same way a real
 * host would: never reaching into `AnnotationEditorHandlePlugin` directly,
 * since it isn't exported.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useRef } from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { LexicalComposer as Composer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { parseMarkdown } from '../../../markdown/parse';
import {
  importMarkdownToLexicalInEditorStateWithOffsets,
  type OffsetSpan,
} from '../../mapper/mdastToLexical';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import type { Annotation, AnnotationEditorHandle, AnnotationKindConfigs } from '../../../annotations/types';
import type { AnnotationCreateEvent } from '../AnnotationPlugin';
import AnnotationSurface from '../AnnotationSurface';

const MARKDOWN = 'The quick brown fox jumps over the lazy dog.\n';
const NEEDLE = 'quick brown fox';

const COMMENT_KINDS: AnnotationKindConfigs = {
  comment: { markerStyle: 'highlight', createAffordance: { surface: 'toolbar' }, retainMarkOnCreate: true },
};

const HOST_INJECTED_ONLY_KINDS: AnnotationKindConfigs = {
  comment: { markerStyle: 'highlight' },
};

afterEach(cleanup);

/** Selects `needle` in the rendered document natively. */
function selectText(needle: string): void {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const index = node.textContent?.indexOf(needle) ?? -1;
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
  }
  throw new Error(`no text node containing ${JSON.stringify(needle)}`);
}

/** Seeds the editor and hands the surface a live offset table and handle ref. */
function Surface({
  kinds,
  annotations,
  onCreate,
  handleRef,
}: {
  kinds: AnnotationKindConfigs;
  annotations: Annotation[];
  onCreate: (e: AnnotationCreateEvent) => void;
  handleRef: { current: AnnotationEditorHandle | null };
}) {
  const [editor] = useLexicalComposerContext();
  const offsetSpansRef = useRef<OffsetSpan[]>([]);
  const markdownTextRef = useRef<string>(MARKDOWN);
  const seeded = useRef(false);

  if (!seeded.current) {
    seeded.current = true;
    editor.update(
      () => {
        offsetSpansRef.current = importMarkdownToLexicalInEditorStateWithOffsets(
          parseMarkdown(MARKDOWN).root,
        );
      },
      { discrete: true },
    );
  }

  return (
    <AnnotationSurface
      kinds={kinds}
      annotations={annotations}
      activeAnnotationId={null}
      onCreateAnnotation={onCreate}
      editorHandleRef={handleRef}
      offsetSpansRef={offsetSpansRef}
      markdownTextRef={markdownTextRef}
      offsetsVersion={1}
    />
  );
}

function renderSurface(
  kinds: AnnotationKindConfigs,
  onCreate: (e: AnnotationCreateEvent) => void,
  handleRef: { current: AnnotationEditorHandle | null },
) {
  return render(
    <Composer
      initialConfig={{
        namespace: 'annotation-editor-handle-create-test',
        nodes: editorNodes,
        onError: (e: Error) => {
          throw e;
        },
      }}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <Surface kinds={kinds} annotations={[]} onCreate={onCreate} handleRef={handleRef} />
    </Composer>,
  );
}

describe('AnnotationEditorHandle.createAnnotation (US1/FR-001/FR-002/SC-001)', () => {
  it('fires onCreateAnnotation with a captured anchor for a live non-collapsed selection', async () => {
    const onCreate = vi.fn();
    const handleRef: { current: AnnotationEditorHandle | null } = { current: null };
    renderSurface(COMMENT_KINDS, onCreate, handleRef);

    expect(handleRef.current).not.toBeNull();

    await act(async () => {
      selectText(NEEDLE);
      handleRef.current!.createAnnotation('comment');
    });

    expect(onCreate).toHaveBeenCalledOnce();
    const event = onCreate.mock.calls[0][0] as AnnotationCreateEvent;
    expect(event.kind).toBe('comment');
    expect(event.anchor?.targetText).toBe(NEEDLE);
    expect(event.id).toBeTruthy();
  });

  it('is reset to null after the surface unmounts', () => {
    const onCreate = vi.fn();
    const handleRef: { current: AnnotationEditorHandle | null } = { current: null };
    const { unmount } = renderSurface(COMMENT_KINDS, onCreate, handleRef);

    expect(handleRef.current).not.toBeNull();
    unmount();
    expect(handleRef.current).toBeNull();
  });

  it('declines silently for a kind with no createAffordance configured', async () => {
    const onCreate = vi.fn();
    const handleRef: { current: AnnotationEditorHandle | null } = { current: null };
    renderSurface(HOST_INJECTED_ONLY_KINDS, onCreate, handleRef);

    await act(async () => {
      selectText(NEEDLE);
      handleRef.current!.createAnnotation('comment');
    });

    expect(onCreate).not.toHaveBeenCalled();
  });

  it('declines silently for an unconfigured kind', async () => {
    const onCreate = vi.fn();
    const handleRef: { current: AnnotationEditorHandle | null } = { current: null };
    renderSurface(COMMENT_KINDS, onCreate, handleRef);

    await act(async () => {
      selectText(NEEDLE);
      handleRef.current!.createAnnotation('no-such-kind');
    });

    expect(onCreate).not.toHaveBeenCalled();
  });

  it('declines silently when there is no live selection', async () => {
    const onCreate = vi.fn();
    const handleRef: { current: AnnotationEditorHandle | null } = { current: null };
    renderSurface(COMMENT_KINDS, onCreate, handleRef);

    await act(async () => {
      window.getSelection()?.removeAllRanges();
      handleRef.current!.createAnnotation('comment');
    });

    expect(onCreate).not.toHaveBeenCalled();
  });

  it('declines silently when the selection is collapsed', async () => {
    const onCreate = vi.fn();
    const handleRef: { current: AnnotationEditorHandle | null } = { current: null };
    renderSurface(COMMENT_KINDS, onCreate, handleRef);

    await act(async () => {
      selectText(NEEDLE);
      window.getSelection()!.getRangeAt(0).collapse(true);
      handleRef.current!.createAnnotation('comment');
    });

    expect(onCreate).not.toHaveBeenCalled();
  });
});
