/**
 * Package-level tests for the annotation React surface (US2).
 *
 * These run against a test host that supplies in-memory state only — no
 * liminis-app involvement and no persistence inside the package (FR-005).
 * They cover create-on-selection, marker activation, and the scroll-to no-op
 * cases the spec calls out as edge cases.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { LexicalComposer as Composer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorState } from '../../mapper/mdastToLexical';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { AnnotationPlugin, type AnnotationCreateEvent } from '../AnnotationPlugin';
import { AnnotationMarkerPlugin } from '../AnnotationMarkerPlugin';
import { OPEN_ANNOTATION_COMPOSER_COMMAND } from '../annotationCommands';
import type { AnnotationKindConfigs, MarkerTarget } from '../../../annotations/types';
import { captureAnchor } from '../../../annotations/anchor-model';

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
