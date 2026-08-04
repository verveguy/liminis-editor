/**
 * A kind's `livemarkPolicy` is the single authority on whether an annotation
 * gets a live `MarkNode`.
 *
 * The default policy is `shouldPlaceLiveMark` — only `unchanged`/`re-attached`
 * anchors earn a mark. A host may override it, and the override must be able to
 * *widen* as well as narrow: a second outcome filter downstream of
 * `deriveMarkerTargets` would let the policy only ever subtract, producing a
 * marker target the marker plugin decorates but placement never satisfies.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { useRef } from 'react';
import { render, cleanup } from '@testing-library/react';
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
import { captureAnchor } from '../../../annotations/anchor-model';
import type { Annotation, AnnotationKindConfigs } from '../../../annotations/types';
import AnnotationSurface from '../AnnotationSurface';

const MARKDOWN = 'The quick brown fox jumps over the lazy dog.\n';

afterEach(cleanup);

/** Seeds the editor and hands the surface a live offset table for this parse. */
function Surface({ kinds, annotations }: { kinds: AnnotationKindConfigs; annotations: Annotation[] }) {
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
      offsetSpansRef={offsetSpansRef}
      markdownTextRef={markdownTextRef}
      offsetsVersion={1}
    />
  );
}

function renderSurface(kinds: AnnotationKindConfigs, annotations: Annotation[]) {
  return render(
    <Composer
      initialConfig={{
        namespace: 'livemark-policy-test',
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
      <Surface kinds={kinds} annotations={annotations} />
    </Composer>,
  );
}

/** "quick brown fox" — present verbatim in MARKDOWN, so it always locates. */
const ANCHOR = captureAnchor(MARKDOWN, { start: 4, end: 19 }, 'v1');

function annotation(outcome: Annotation['outcome']): Annotation[] {
  return [{ id: 'a1', kind: 'note', anchor: ANCHOR, outcome }];
}

describe('livemarkPolicy is the sole live-mark authority', () => {
  it('places no mark for a flagged anchor under the default policy', () => {
    const kinds: AnnotationKindConfigs = { note: { markerStyle: 'highlight' } };
    const { container } = renderSurface(kinds, annotation('flagged'));

    expect(container.querySelectorAll('mark').length).toBe(0);
  });

  it('places a mark for a flagged anchor when the kind opts in', () => {
    const kinds: AnnotationKindConfigs = { note: { markerStyle: 'highlight', livemarkPolicy: () => true } };
    const { container } = renderSurface(kinds, annotation('flagged'));

    expect(container.querySelectorAll('mark').length).toBe(1);
  });

  it('places no mark for an unchanged anchor when the kind opts out', () => {
    const kinds: AnnotationKindConfigs = { note: { markerStyle: 'highlight', livemarkPolicy: () => false } };
    const { container } = renderSurface(kinds, annotation('unchanged'));

    expect(container.querySelectorAll('mark').length).toBe(0);
  });
});

describe('placed marks are retracted when an annotation stops being eligible', () => {
  const KINDS: AnnotationKindConfigs = { note: { markerStyle: 'highlight' } };

  it('removes the mark when the annotation disappears from `annotations`', () => {
    const { container, rerender } = renderSurface(KINDS, annotation('unchanged'));
    expect(container.querySelectorAll('mark').length).toBe(1);

    rerender(
      <Composer
        initialConfig={{
          namespace: 'livemark-policy-test',
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
        <Surface kinds={KINDS} annotations={[]} />
      </Composer>,
    );

    expect(container.querySelectorAll('mark').length).toBe(0);
  });

  it("removes the mark when the annotation's outcome stops earning one", () => {
    const { container, rerender } = renderSurface(KINDS, annotation('unchanged'));
    expect(container.querySelectorAll('mark').length).toBe(1);

    rerender(
      <Composer
        initialConfig={{
          namespace: 'livemark-policy-test',
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
        <Surface kinds={KINDS} annotations={annotation('orphaned')} />
      </Composer>,
    );

    expect(container.querySelectorAll('mark').length).toBe(0);
  });
});
