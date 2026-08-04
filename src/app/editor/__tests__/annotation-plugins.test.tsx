/**
 * Package-level tests for the annotation React surface (US2).
 *
 * These run against a test host that supplies in-memory state only — no
 * liminis-app involvement and no persistence inside the package (FR-005).
 * They cover create-on-selection, marker activation, and the scroll-to no-op
 * cases the spec calls out as edge cases.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useEffect, useRef } from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { LexicalComposer as Composer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { $createRangeSelection, $getRoot, $setSelection, createEditor, type LexicalEditor } from 'lexical';
import { $isMarkNode, $wrapSelectionInMarkNode } from '@lexical/mark';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorState } from '../../mapper/mdastToLexical';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { AnnotationPlugin, type AnnotationCreateEvent } from '../AnnotationPlugin';
import { AnnotationMarkerPlugin } from '../AnnotationMarkerPlugin';
import { OPEN_ANNOTATION_COMPOSER_COMMAND } from '../annotationCommands';
import type { AnnotationKindConfigs, MarkerTarget } from '../../../annotations/types';
import { captureAnchor } from '../../../annotations/anchor-model';
import { markElementsByAnnotationId } from '../annotation-marks';

const MARKDOWN = 'The quick brown fox jumps over the lazy dog.\n';

const COMMENT_KINDS: AnnotationKindConfigs = {
  comment: { markerStyle: 'highlight', createAffordance: { surface: 'toolbar' }, retainMarkOnCreate: true },
};

const CORRECTION_KINDS: AnnotationKindConfigs = {
  correction: {
    markerStyle: 'none',
    createAffordance: { surface: 'contextMenu' },
    livemarkPolicy: () => false,
  },
};

afterEach(cleanup);

/** Seeds the editor with markdown and exposes a dispatch hook to the test. */
function Harness({
  kinds,
  onCreate,
  dispatchRef,
}: {
  kinds: AnnotationKindConfigs;
  onCreate: (e: AnnotationCreateEvent) => void;
  dispatchRef: { current: ((kind: string) => void) | null };
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.update(
      () => {
        importMarkdownToLexicalInEditorState(parseMarkdown(MARKDOWN).root);
      },
      { discrete: true },
    );
    dispatchRef.current = (kind: string) => {
      editor.dispatchCommand(OPEN_ANNOTATION_COMPOSER_COMMAND, { kind });
    };
  }, [editor, dispatchRef]);

  return <AnnotationPlugin kinds={kinds} onCreateAnnotation={onCreate} logger={testLogger} />;
}

const testLogger = { warn: vi.fn() };

function renderEditor(
  kinds: AnnotationKindConfigs,
  onCreate: (e: AnnotationCreateEvent) => void,
  dispatchRef: { current: ((kind: string) => void) | null },
) {
  return render(
    <Composer
      initialConfig={{
        namespace: 'annotation-test',
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
      <Harness kinds={kinds} onCreate={onCreate} dispatchRef={dispatchRef} />
    </Composer>,
  );
}

/** Selects `needle` in the rendered document, so the plugin sees a live selection. */
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

describe('AnnotationPlugin — create on selection', () => {
  it('fires onCreateAnnotation with a captured anchor and persists nothing itself', async () => {
    const onCreate = vi.fn();
    const dispatchRef: { current: ((kind: string) => void) | null } = { current: null };
    renderEditor(COMMENT_KINDS, onCreate, dispatchRef);

    await act(async () => {
      selectText('quick brown fox');
      dispatchRef.current!('comment');
    });

    expect(onCreate).toHaveBeenCalledOnce();
    const event = onCreate.mock.calls[0][0] as AnnotationCreateEvent;
    expect(event.kind).toBe('comment');
    expect(event.anchor?.targetText).toBe('quick brown fox');
    expect(event.id).toBeTruthy();
  });

  it('captures for the correction kind too — same path, no retained mark', async () => {
    const onCreate = vi.fn();
    const dispatchRef: { current: ((kind: string) => void) | null } = { current: null };
    renderEditor(CORRECTION_KINDS, onCreate, dispatchRef);

    await act(async () => {
      selectText('quick brown fox');
      dispatchRef.current!('correction');
    });

    expect(onCreate).toHaveBeenCalledOnce();
    const event = onCreate.mock.calls[0][0] as AnnotationCreateEvent;
    expect(event.kind).toBe('correction');
    expect(event.anchor?.targetText).toBe('quick brown fox');
    expect(document.querySelectorAll('mark').length).toBe(0);
  });

  it('warns via the injected logger and does not crash for an unconfigured kind', async () => {
    testLogger.warn.mockClear();
    const onCreate = vi.fn();
    const dispatchRef: { current: ((kind: string) => void) | null } = { current: null };
    renderEditor(COMMENT_KINDS, onCreate, dispatchRef);

    await act(async () => {
      selectText('quick brown fox');
      dispatchRef.current!('no-such-kind');
    });

    expect(onCreate).not.toHaveBeenCalled();
    expect(testLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unconfigured kind "no-such-kind"'),
    );
  });

  // The plugin guards three distinct conditions — no selection object, zero
  // ranges, and a collapsed range. `removeAllRanges()` only reaches the second,
  // so the collapsed branch needs its own case (review finding, CodeRabbit).
  it('does nothing when the selection is collapsed', async () => {
    const onCreate = vi.fn();
    const dispatchRef: { current: ((kind: string) => void) | null } = { current: null };
    renderEditor(COMMENT_KINDS, onCreate, dispatchRef);

    await act(async () => {
      selectText('quick brown fox');
      window.getSelection()!.getRangeAt(0).collapse(true);
      dispatchRef.current!('comment');
    });

    expect(onCreate).not.toHaveBeenCalled();
  });

  it('does nothing when there is no selection range at all', async () => {
    const onCreate = vi.fn();
    const dispatchRef: { current: ((kind: string) => void) | null } = { current: null };
    renderEditor(COMMENT_KINDS, onCreate, dispatchRef);

    await act(async () => {
      window.getSelection()?.removeAllRanges();
      dispatchRef.current!('comment');
    });

    expect(onCreate).not.toHaveBeenCalled();
  });

  // Review finding (@handarbeit-pruefer): the anchor read is deferred to a
  // microtask, so it outlives the command handler. If the plugin unmounts in
  // between — document swapped, owning panel closed — the callback must not
  // touch the torn-down editor or call the host back with a stale rect.
  it('does not call back after unmount when the deferred read is still pending', async () => {
    const onCreate = vi.fn();
    const dispatchRef: { current: ((kind: string) => void) | null } = { current: null };
    const { unmount } = renderEditor(COMMENT_KINDS, onCreate, dispatchRef);

    await act(async () => {
      selectText('quick brown fox');
      // Dispatch and unmount within the same synchronous turn, so the
      // microtask queued by the handler is still pending when cleanup runs.
      dispatchRef.current!('comment');
      unmount();
    });

    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('AnnotationMarkerPlugin — scroll-to edge cases', () => {
  const ANCHOR = captureAnchor(MARKDOWN, { start: 4, end: 19 }, 'v1');

  function MarkerHarness({ targets, scrollTo }: { targets: MarkerTarget[]; scrollTo: { id: string; nonce: number } | null }) {
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
      <AnnotationMarkerPlugin
        targets={targets}
        kinds={COMMENT_KINDS}
        activeAnnotationId={null}
        onActivateAnnotation={() => undefined}
        scrollToAnnotation={scrollTo}
      />
    );
  }

  function renderMarkers(targets: MarkerTarget[], scrollTo: { id: string; nonce: number } | null) {
    return render(
      <Composer
        initialConfig={{
          namespace: 'marker-test',
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
        <MarkerHarness targets={targets} scrollTo={scrollTo} />
      </Composer>,
    );
  }

  it('is a no-op, not an error, when scrollToAnnotation targets an unknown id', () => {
    expect(() => renderMarkers([], { id: 'never-existed', nonce: 1 })).not.toThrow();
  });

  it('is a no-op when scrollToAnnotation targets an orphaned annotation with no live mark', () => {
    const orphaned: MarkerTarget[] = [
      { annotationId: 'o1', kind: 'comment', anchor: ANCHOR, outcome: 'orphaned' },
    ];
    expect(() => renderMarkers(orphaned, { id: 'o1', nonce: 1 })).not.toThrow();
  });

  it('decorates nothing for a kind whose markerStyle is none', () => {
    const corrections: MarkerTarget[] = [
      { annotationId: 'x1', kind: 'correction', anchor: ANCHOR, outcome: 'unchanged' },
    ];
    render(
      <Composer
        initialConfig={{
          namespace: 'marker-none-test',
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
        <AnnotationMarkerPlugin
          targets={corrections}
          kinds={CORRECTION_KINDS}
          activeAnnotationId={null}
          onActivateAnnotation={() => undefined}
          scrollToAnnotation={null}
        />
      </Composer>,
    );

    expect(document.querySelectorAll('[data-annotation-kind]').length).toBe(0);
  });
});

/**
 * Overlapping annotations share one MarkNode, and therefore one DOM element —
 * the spec lists that as an edge case, and `removeMarksForAnnotation` is built
 * for it. Decorating per-target attached a second listener pair to the shared
 * element, so one click fired `onActivateAnnotation` once per annotation
 * (review finding, @handarbeit-pruefer).
 */
describe('AnnotationMarkerPlugin — overlapping annotations on one element', () => {
  const OVERLAP_KINDS: AnnotationKindConfigs = {
    comment: { markerStyle: 'highlight', createAffordance: { surface: 'toolbar' }, retainMarkOnCreate: true },
  };

  /** Seeds the document and puts two annotation ids on the same MarkNode. */
  function OverlapHarness({
    onActivate,
    activeId,
  }: {
    onActivate: (id: string) => void;
    activeId: string | null;
  }) {
    const [editor] = useLexicalComposerContext();
    const seeded = useRef(false);
    editorRef.current = editor;

    if (!seeded.current) {
      seeded.current = true;
      editor.update(
        () => {
          importMarkdownToLexicalInEditorState(parseMarkdown(MARKDOWN).root);
          const textNode = $getRoot().getAllTextNodes()[0];
          const idx = textNode.getTextContent().indexOf('quick brown fox');
          const selection = $createRangeSelection();
          selection.anchor.set(textNode.getKey(), idx, 'text');
          selection.focus.set(textNode.getKey(), idx + 'quick brown fox'.length, 'text');
          $setSelection(selection);
          // Both ids on one MarkNode — exactly what $wrapSelectionInMarkNode
          // produces when a second annotation covers already-marked text.
          $wrapSelectionInMarkNode(selection, false, 'a1');
          for (const node of $getRoot().getAllTextNodes()) {
            const parent = node.getParent();
            if (parent && $isMarkNode(parent)) parent.addID('a2');
          }
        },
        { discrete: true },
      );
    }

    const targets: MarkerTarget[] = [
      { annotationId: 'a1', kind: 'comment', anchor: OVERLAP_ANCHOR, outcome: 'unchanged' },
      { annotationId: 'a2', kind: 'comment', anchor: OVERLAP_ANCHOR, outcome: 'unchanged' },
    ];

    return (
      <AnnotationMarkerPlugin
        targets={targets}
        kinds={OVERLAP_KINDS}
        activeAnnotationId={activeId}
        onActivateAnnotation={onActivate}
        scrollToAnnotation={null}
      />
    );
  }

  const OVERLAP_ANCHOR = captureAnchor(MARKDOWN, { start: 4, end: 19 }, 'v1');
  const editorRef: { current: LexicalEditor | null } = { current: null };

  function renderOverlap(onActivate: (id: string) => void, activeId: string | null = null) {
    return render(
      <Composer
        initialConfig={{
          namespace: 'overlap-test',
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
        <OverlapHarness onActivate={onActivate} activeId={activeId} />
      </Composer>,
    );
  }

  it('fires onActivateAnnotation exactly once when the shared marker is clicked', () => {
    const onActivate = vi.fn();
    const { container } = renderOverlap(onActivate);

    const mark = container.querySelector('mark');
    expect(mark).not.toBeNull();

    act(() => {
      mark!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('activates the active annotation, not merely the first in document order', () => {
    // 'a2' is second in `targets`, so a plain first-wins rule would pick 'a1'
    // and a per-target loop would fire for both.
    const onActivate = vi.fn();
    const { container } = renderOverlap(onActivate, 'a2');

    act(() => {
      container.querySelector('mark')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith('a2');
  });

  it("says so in the accessible label rather than naming only one annotation", () => {
    const { container } = renderOverlap(vi.fn());
    expect(container.querySelector('mark')!.getAttribute('aria-label')).toContain('+1 more here');
  });

  /**
   * Decoration runs from an update listener, tears down and rebuilds every
   * decorated element's listeners and attributes, and used to do a full tree
   * walk per target. Both halves of that cost mattered on a path Lexical fires
   * for cursor moves as well as edits (review finding, @handarbeit-pruefer).
   */
  it('does not re-decorate on a selection-only update', () => {
    const onActivate = vi.fn();
    const { container } = renderOverlap(onActivate);
    const mark = container.querySelector('mark')!;

    // Every decoration pass tears the element's listeners down and re-adds
    // them with fresh closures, so counting addEventListener calls counts
    // decoration passes. Instrument only after the initial pass has run.
    let listenerAdds = 0;
    const realAdd = mark.addEventListener.bind(mark);
    mark.addEventListener = ((...args: Parameters<typeof realAdd>) => {
      listenerAdds++;
      return realAdd(...args);
    }) as typeof mark.addEventListener;

    // Distinct offsets per call: two identical selections could be collapsed
    // into a no-op by Lexical, which would make the second call prove nothing
    // (review finding, CodeRabbit).
    const moveCaret = (offset: number) =>
      act(() => {
        editorRef.current!.update(
          () => {
            const textNode = $getRoot().getAllTextNodes()[0];
            const selection = $createRangeSelection();
            selection.anchor.set(textNode.getKey(), offset, 'text');
            selection.focus.set(textNode.getKey(), offset, 'text');
            $setSelection(selection);
          },
          { discrete: true },
        );
      });

    moveCaret(0);
    moveCaret(1);

    expect(listenerAdds).toBe(0);
    // ...and the element is still decorated, i.e. skipping did not drop it.
    expect(mark.getAttribute('role')).toBe('button');
  });
});

describe('markElementsByAnnotationId', () => {
  it('resolves many ids in one pass, in document order, skipping ids with no mark', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    document.body.appendChild(el);
    const editor = createEditor({
      namespace: 'by-id-test',
      nodes: editorNodes,
      onError: (e) => {
        throw e;
      },
    });
    editor.setRootElement(el);

    editor.update(
      () => {
        importMarkdownToLexicalInEditorState(parseMarkdown(MARKDOWN).root);
        const wrap = (needle: string, id: string) => {
          const node = $getRoot().getAllTextNodes().find((n) => n.getTextContent().includes(needle))!;
          const idx = node.getTextContent().indexOf(needle);
          const selection = $createRangeSelection();
          selection.anchor.set(node.getKey(), idx, 'text');
          selection.focus.set(node.getKey(), idx + needle.length, 'text');
          $setSelection(selection);
          $wrapSelectionInMarkNode(selection, false, id);
        };
        // Back to front, so each wrap leaves the earlier text intact.
        wrap('fox', 'b');
        wrap('quick', 'a');
      },
      { discrete: true },
    );

    const found = markElementsByAnnotationId(editor, new Set(['a', 'b', 'absent']));

    expect([...found.keys()].sort()).toEqual(['a', 'b']);
    expect(found.get('a')![0].textContent).toBe('quick');
    expect(found.get('b')![0].textContent).toBe('fox');
    expect(found.has('absent')).toBe(false);

    el.remove();
  });

  it('returns an empty map without walking anything when given no ids', () => {
    const editor = createEditor({
      namespace: 'by-id-empty',
      nodes: editorNodes,
      onError: (e) => {
        throw e;
      },
    });
    expect(markElementsByAnnotationId(editor, new Set()).size).toBe(0);
  });
});
