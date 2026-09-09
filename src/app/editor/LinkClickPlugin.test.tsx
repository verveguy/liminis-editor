/**
 * Coverage for LinkClickPlugin threading blockId through openLink (#119).
 *
 * FR-004: activating a block-scoped link must request navigation to that
 * specific file *and* block id when the host supports it. `blockId` is
 * additive on the OPEN_LINK payload, so a host that ignores it still opens
 * the file exactly as before.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $createParagraphNode, $createTextNode, type LexicalEditor } from 'lexical';
import { EditorHostProvider } from '../../host/context';
import type { EditorHostBridge } from '../../host/types';
import type { UIToHostMessage } from '../../types';
import { $createCustomLinkNode } from './nodes';
import { LinkClickPlugin } from './LinkClickPlugin';
import { editorNodes } from '../mapper/__tests__/roundtrip-test-utils';

function CaptureEditor({ onReady }: { onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    onReady(editor);
  }, [editor, onReady]);
  return null;
}

function stubBridge(): { bridge: EditorHostBridge; posted: UIToHostMessage[] } {
  const posted: UIToHostMessage[] = [];
  return {
    bridge: { postMessage: (message) => posted.push(message), addMessageHandler: () => () => {} },
    posted,
  };
}

async function mountPlugin(
  bridge: EditorHostBridge,
  plugin: ReactNode,
): Promise<{ editor: LexicalEditor; container: HTMLElement }> {
  let editor: LexicalEditor | null = null;
  let container!: HTMLElement;
  await act(async () => {
    ({ container } = render(
      <EditorHostProvider services={{ bridge }}>
        <LexicalComposer
          initialConfig={{
            namespace: 'link-click-plugin-test',
            nodes: editorNodes,
            onError: (e) => {
              throw e;
            },
          }}
        >
          <RichTextPlugin
            contentEditable={<ContentEditable />}
            placeholder={null}
            ErrorBoundary={({ children }) => <>{children}</>}
          />
          <CaptureEditor
            onReady={(e) => {
              editor = e;
            }}
          />
          {plugin}
        </LexicalComposer>
      </EditorHostProvider>,
    ));
  });
  return { editor: editor!, container };
}

afterEach(() => {
  cleanup();
});

describe('LinkClickPlugin blockId threading (#119)', () => {
  it('includes blockId in the OPEN_LINK payload for a block-scoped link, read-only mode', async () => {
    const { bridge, posted } = stubBridge();
    const { editor, container } = await mountPlugin(bridge, <LinkClickPlugin editable={false} />);

    await act(async () => {
      editor.update(() => {
        const paragraph = $createParagraphNode();
        const link = $createCustomLinkNode('notes.md');
        link.setBlockId('01ABC');
        link.append($createTextNode('notes.md'));
        paragraph.append(link);
        $getRoot().clear().append(paragraph);
      });
    });

    const anchor = container.querySelector('a[data-wiki-link="true"]')!;
    fireEvent.click(anchor);

    expect(posted).toEqual([{ type: 'OPEN_LINK', url: 'notes.md', blockId: '01ABC' }]);
  });

  it('omits blockId for an ordinary file-only link, read-only mode', async () => {
    const { bridge, posted } = stubBridge();
    const { editor, container } = await mountPlugin(bridge, <LinkClickPlugin editable={false} />);

    await act(async () => {
      editor.update(() => {
        const paragraph = $createParagraphNode();
        const link = $createCustomLinkNode('notes.md');
        link.append($createTextNode('notes.md'));
        paragraph.append(link);
        $getRoot().clear().append(paragraph);
      });
    });

    const anchor = container.querySelector('a[data-wiki-link="true"]')!;
    fireEvent.click(anchor);

    expect(posted).toEqual([{ type: 'OPEN_LINK', url: 'notes.md' }]);
    expect(posted[0]).not.toHaveProperty('blockId');
  });

  it('includes blockId on a modifier-click in editable mode too', async () => {
    const { bridge, posted } = stubBridge();
    const { editor, container } = await mountPlugin(bridge, <LinkClickPlugin editable />);

    await act(async () => {
      editor.update(() => {
        const paragraph = $createParagraphNode();
        const link = $createCustomLinkNode('notes.md');
        link.setBlockId('01ABC');
        link.append($createTextNode('notes.md'));
        paragraph.append(link);
        $getRoot().clear().append(paragraph);
      });
    });

    const anchor = container.querySelector('a[data-wiki-link="true"]')!;
    fireEvent.click(anchor, { metaKey: true });

    expect(posted).toEqual([{ type: 'OPEN_LINK', url: 'notes.md', blockId: '01ABC' }]);
  });
});
