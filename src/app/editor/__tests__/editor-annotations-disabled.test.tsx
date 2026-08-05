/**
 * FR-004, behavioural half: an `<Editor>` with no `annotationKinds` registers
 * no annotation command and renders no annotation UI.
 *
 * The structural half — that the annotation modules aren't even reachable from
 * `Editor.tsx` by static import — lives in annotations-off-by-default.test.tsx.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { Editor } from '../Editor';
import { EditorHostProvider } from '../../../host/context';

afterEach(cleanup);

const MARKDOWN = 'The quick brown fox jumps over the lazy dog.\n';

/**
 * The annotation surface is behind `React.lazy` (that boundary is the whole
 * point of FR-004), so under test the module has to actually finish loading
 * before Suspense can commit it. Importing it once up front makes the
 * subsequent lazy resolution synchronous, which keeps these tests
 * deterministic instead of racing a module load against a fixed number of
 * act() turns.
 */
beforeAll(async () => {
  await import('../AnnotationSurface');
});

/** Lets Suspense commit the (already-loaded) lazy children and their effects run. */
async function flushLazy(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function renderEditor(props: Record<string, unknown> = {}) {
  return render(
    <EditorHostProvider>
      <Editor initialContent={MARKDOWN} onChange={() => undefined} {...props} />
    </EditorHostProvider>,
  );
}

describe('Editor with annotations disabled (FR-004)', () => {
  it('renders the document without any annotation marker or affordance', async () => {
    await act(async () => {
      renderEditor();
    });

    expect(document.body.textContent).toContain('quick brown fox');
    expect(document.querySelectorAll('mark').length).toBe(0);
    expect(document.querySelectorAll('[data-annotation-kind]').length).toBe(0);
  });

  it('places no marks even when annotations are supplied without kinds', async () => {
    // A host that passes annotation data but configures no kinds gets nothing:
    // the mechanism is gated on the kind configuration, not on the data.
    await act(async () => {
      renderEditor({
        annotations: [
          {
            id: 'a1',
            kind: 'comment',
            anchor: {
              targetText: 'quick brown fox',
              prefixContext: 'The ',
              suffixContext: ' jumps',
              blockType: 'paragraph',
              occurrenceIndex: 0,
              docVersion: 'v1',
            },
          },
        ],
      });
    });

    expect(document.querySelectorAll('mark').length).toBe(0);
  });

  it('does not warn about unconfigured kinds when the mechanism is off entirely', async () => {
    const logger = { warn: vi.fn() };

    await act(async () => {
      renderEditor({ annotationLogger: logger });
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('Editor with the comment kind enabled', () => {
  const ANCHOR = {
    targetText: 'quick brown fox',
    prefixContext: 'The ',
    suffixContext: ' jumps over the lazy dog.\n',
    blockType: 'paragraph' as const,
    occurrenceIndex: 0,
    docVersion: 'v1',
  };

  it('places and decorates a live mark for an unchanged anchor', async () => {
    await act(async () => {
      renderEditor({
        annotationKinds: {
          comment: { markerStyle: 'highlight', createAffordance: { surface: 'toolbar' }, retainMarkOnCreate: true },
        },
        annotations: [{ id: 'a1', kind: 'comment', anchor: ANCHOR, outcome: 'unchanged' }],
      });
    });
    await flushLazy();

    expect(document.querySelectorAll('mark').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-annotation-kind="comment"]')).not.toBeNull();
  });

  it('places no live mark for an orphaned anchor — panel-only', async () => {
    await act(async () => {
      renderEditor({
        annotationKinds: {
          comment: { markerStyle: 'highlight', createAffordance: { surface: 'toolbar' }, retainMarkOnCreate: true },
        },
        annotations: [{ id: 'a1', kind: 'comment', anchor: ANCHOR, outcome: 'orphaned' }],
      });
    });
    await flushLazy();

    expect(document.querySelectorAll('mark').length).toBe(0);
  });

  /**
   * The offset table is collected on every parse regardless of whether
   * annotations are on, because `InitializePlugin` imports exactly once — a
   * host that resolves its kinds asynchronously would otherwise be left with a
   * permanently empty table and silently place nothing (an earlier review
   * finding). Only the `offsetsVersion` state bump is gated on
   * `annotationsEnabled`, so this pins the behaviour that gate must not break.
   */
  it('places a mark when the kinds arrive after the initial parse', async () => {
    const props = {
      annotationKinds: {
        comment: {
          markerStyle: 'highlight' as const,
          createAffordance: { surface: 'toolbar' as const },
          retainMarkOnCreate: true,
        },
      },
      annotations: [{ id: 'a1', kind: 'comment', anchor: ANCHOR, outcome: 'unchanged' as const }],
    };

    let rerender!: (ui: React.ReactElement) => void;
    await act(async () => {
      // First render with no kinds at all: the import runs here, and this is
      // the only time it runs.
      ({ rerender } = renderEditor());
    });
    expect(document.querySelectorAll('mark').length).toBe(0);

    await act(async () => {
      rerender(
        <EditorHostProvider>
          <Editor initialContent={MARKDOWN} onChange={() => undefined} {...props} />
        </EditorHostProvider>,
      );
    });
    await flushLazy();

    expect(document.querySelectorAll('mark').length).toBeGreaterThan(0);
  });

  it('warns via the injected logger for an annotation whose kind is unconfigured', async () => {
    const logger = { warn: vi.fn() };
    await act(async () => {
      renderEditor({
        annotationKinds: { comment: { markerStyle: 'highlight' } },
        annotations: [{ id: 'z1', kind: 'no-such-kind', anchor: ANCHOR, outcome: 'unchanged' }],
        annotationLogger: logger,
      });
    });
    await flushLazy();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unconfigured kind "no-such-kind"'));
    expect(document.querySelectorAll('mark').length).toBe(0);
  });
});
