/**
 * TransclusionComponent - resolves and renders a block transclusion
 * (`![[file#^id]]`, #119)
 *
 * Mirrors `MermaidComponent`'s split: `TransclusionNode` is a static,
 * serializable value (`file`/`blockId`/`alias`); the actual host-resolver
 * call happens here, inside the lazily-loaded component, since resolution is
 * `Promise`-based and the mdast<->Lexical mapper is synchronous.
 */
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { NodeKey } from 'lexical';
import { useEffect, useRef, useState } from 'react';
import { useEditorHost } from '../../../host/context';
import {
  resolveAndRenderTransclusion,
  renderTransclusionState,
  renderTransclusionLoading,
  type TransclusionRenderState,
} from './transclusion-render';

interface TransclusionComponentProps {
  file: string;
  blockId: string;
  nodeKey: NodeKey;
}

export default function TransclusionComponent({ file, blockId }: TransclusionComponentProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const { resolveTransclusion } = useEditorHost();
  const [state, setState] = useState<TransclusionRenderState | null>(null);
  // Guards against a stale resolution landing after a newer one already
  // started (e.g. file/blockId changed, or two update-listener firings
  // overlap) — only the most recent request is allowed to commit state.
  const generationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const resolve = async (): Promise<void> => {
      const generation = ++generationRef.current;
      const result = await resolveAndRenderTransclusion(file, blockId, resolveTransclusion, []);
      if (!cancelled && generation === generationRef.current) {
        setState(result);
      }
    };

    void resolve();

    // FR-006/SC-002: re-resolve on every document change so an edit to the
    // source block — in this document, or elsewhere once the host's own
    // resolver reflects it — shows up without the host having to remount
    // the editor. Pull-based and unmemoized (every dirty update re-resolves
    // every visible transclusion): an accepted v1 cost, not a correctness
    // gap — see the Plan's "no push/invalidation channel" risk note.
    const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size > 0 || dirtyLeaves.size > 0) {
        void resolve();
      }
    });

    return () => {
      cancelled = true;
      unregister();
    };
  }, [editor, file, blockId, resolveTransclusion]);

  if (state === null) {
    return renderTransclusionLoading() as JSX.Element;
  }
  return renderTransclusionState(state) as JSX.Element;
}
