import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $createParagraphNode, LexicalEditor } from 'lexical';
import { EditorHostProvider } from '../../../host/context';
import type { EditorHostServices } from '../../../host/types';
import TransclusionComponent from './TransclusionComponent';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';

function Harness({
  file,
  blockId,
  editorRef,
}: {
  file: string;
  blockId: string;
  editorRef: { current: LexicalEditor | null };
}) {
  const [editor] = useLexicalComposerContext();
  editorRef.current = editor;
  return <TransclusionComponent file={file} blockId={blockId} nodeKey="fake-node-key" />;
}

function mountTransclusion(
  file: string,
  blockId: string,
  services: EditorHostServices | undefined,
  editorRef: { current: LexicalEditor | null },
) {
  return render(
    <EditorHostProvider services={services}>
      <LexicalComposer
        initialConfig={{
          namespace: 'transclusion-component-test',
          nodes: editorNodes,
          onError: (e) => {
            throw e;
          },
        }}
      >
        <Harness file={file} blockId={blockId} editorRef={editorRef} />
      </LexicalComposer>
    </EditorHostProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TransclusionComponent (#119)', () => {
  // SC-003: <Editor> mounted with default (no-op) host services renders a
  // transclusion without throwing.
  it('renders an unresolved placeholder with no host services at all', async () => {
    const editorRef: { current: LexicalEditor | null } = { current: null };
    const { container } = mountTransclusion('notes.md', '01ABC', undefined, editorRef);

    await waitFor(() => {
      expect(container.querySelector('.editor-transclusion-unresolved')).not.toBeNull();
    });
  });

  it('shows a loading state before the resolver settles', () => {
    let resolveContent: (value: string | null) => void = () => {};
    const resolveTransclusion = vi.fn(
      () => new Promise<string | null>((resolve) => { resolveContent = resolve; }),
    );
    const editorRef: { current: LexicalEditor | null } = { current: null };
    const { container } = mountTransclusion('notes.md', '01ABC', { resolveTransclusion }, editorRef);

    expect(container.querySelector('.editor-transclusion-loading')).not.toBeNull();
    // Settle the pending promise so the test doesn't leak a dangling timer.
    resolveContent('done');
  });

  it('renders resolved content once the resolver settles', async () => {
    const resolveTransclusion = vi.fn(async () => 'Draft the boundary doc');
    const editorRef: { current: LexicalEditor | null } = { current: null };
    const { container } = mountTransclusion('notes.md', '01ABC', { resolveTransclusion }, editorRef);

    await waitFor(() => {
      expect(container.textContent).toContain('Draft the boundary doc');
    });
    expect(resolveTransclusion).toHaveBeenCalledWith('notes.md', '01ABC');
  });

  it('renders "unresolved" when the resolver cannot find the block', async () => {
    const resolveTransclusion = vi.fn(async () => null);
    const editorRef: { current: LexicalEditor | null } = { current: null };
    const { container } = mountTransclusion('notes.md', '01ABC', { resolveTransclusion }, editorRef);

    await waitFor(() => {
      expect(container.querySelector('.editor-transclusion-unresolved')).not.toBeNull();
    });
  });

  // SC-002: a change to the source block's content is reflected once the
  // transcluding document re-renders — here, driven by any editor update,
  // not just a remount.
  it('re-resolves and reflects updated content after the document changes', async () => {
    // A mutable "source of truth" rather than counting calls: the initial
    // Lexical editor-state population can itself fire the update listener
    // before the test's own explicit update, so asserting on call count is
    // flaky. Returning the same value until the test flips it is not.
    let currentContent = '- [ ] Draft the boundary doc';
    const resolveTransclusion = vi.fn(async () => currentContent);
    const editorRef: { current: LexicalEditor | null } = { current: null };
    const { container } = mountTransclusion('notes.md', '01ABC', { resolveTransclusion }, editorRef);

    await waitFor(() => {
      expect(container.textContent).toContain('Draft the boundary doc');
    });
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.checked).toBe(false);

    // Simulate the source block changing and the transcluding document
    // re-rendering: any dirty editor update should trigger re-resolution.
    currentContent = '- [x] Draft the boundary doc';
    await act(async () => {
      editorRef.current!.update(() => {
        $getRoot().append($createParagraphNode());
      });
    });

    await waitFor(() => {
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      expect(checkbox?.checked).toBe(true);
    });
  });

  it('never throws when the resolver rejects', async () => {
    const resolveTransclusion = vi.fn(async () => {
      throw new Error('boom');
    });
    const editorRef: { current: LexicalEditor | null } = { current: null };
    const { container } = mountTransclusion('notes.md', '01ABC', { resolveTransclusion }, editorRef);

    await waitFor(() => {
      expect(container.querySelector('.editor-transclusion-unresolved')).not.toBeNull();
    });
  });
});
