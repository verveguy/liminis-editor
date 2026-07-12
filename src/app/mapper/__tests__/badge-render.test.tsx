import { describe, it, expect, vi } from 'vitest';
import { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $createParagraphNode, type LexicalEditor } from 'lexical';
import { editorNodes } from './roundtrip-test-utils';
import { $createCustomLinkNode, $createImageNode } from '../../editor/nodes';

/**
 * Smoke test for #898's badge fix: an ImageNode nested inside a CustomLinkNode is a
 * tree shape (a block DecoratorNode inside an inline ElementNode) that nothing else in
 * this codebase produces, since ImageNode.isInline() is hardcoded false. The round-trip
 * fixture harness only exercises the headless parse<->stringify pipeline and never
 * renders to a real DOM, so this confirms the shape also reconciles cleanly through an
 * actual mounted Lexical editor (no thrown invariant violations, no console errors).
 */
function CaptureEditor({ onReady }: { onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    onReady(editor);
  }, [editor, onReady]);
  return null;
}

describe('badge (ImageNode inside CustomLinkNode) rendered in a mounted editor', () => {
  it('reconciles to DOM without throwing or logging errors', async () => {
    const errors: unknown[] = [];
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });

    let editor: LexicalEditor | null = null;
    let container: HTMLElement;
    try {
      ({ container } = render(
        <LexicalComposer initialConfig={{ namespace: 'test', nodes: editorNodes, onError: (e) => { throw e; } }}>
          <RichTextPlugin
            contentEditable={<ContentEditable data-testid="editable" />}
            placeholder={null}
            ErrorBoundary={({ children }) => <>{children}</>}
          />
          <CaptureEditor onReady={(e) => { editor = e; }} />
        </LexicalComposer>
      ));

      await act(async () => {
        editor!.update(() => {
          const link = $createCustomLinkNode('https://ci.example.com/build');
          const image = $createImageNode('https://img.shields.io/badge/build-passing-green', 'Build Status');
          link.append(image);
          const paragraph = $createParagraphNode();
          paragraph.append(link);
          $getRoot().clear().append(paragraph);
        });
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(errors).toEqual([]);
    expect(container!.innerHTML).toContain('img.shields.io/badge/build-passing-green');
  });
});
