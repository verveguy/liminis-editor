import { useCallback, useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { COMMAND_PRIORITY_CRITICAL } from 'lexical';
import type { AnchorFields } from '../../annotations/anchor-model';
import type { AnnotationKindConfigs } from '../../annotations/types';
import { readAnchorFields, removeMarksForAnnotation, wrapNativeRangeInMark } from './annotation-marks';
import { OPEN_ANNOTATION_COMPOSER_COMMAND } from './annotationCommands';

export interface AnnotationCreateEvent {
  /** The kind that was created, as configured by the host. */
  kind: string;
  /** The id the package minted for the transient mark. Hosts may adopt it or mint their own. */
  id: string;
  /** The captured anchor, or null if the selection didn't resolve to real content. */
  anchor: AnchorFields | null;
  /** Where the selection was on screen, for hosts that position a composer. */
  rect: DOMRect;
}

interface AnnotationPluginProps {
  kinds: AnnotationKindConfigs;
  /**
   * Fires when the user invokes a kind's create affordance. The package
   * captures the anchor and hands it over — it never persists anything
   * (ADR-075/FR-005); storage, identity and lifecycle are the host's.
   */
  onCreateAnnotation: (event: AnnotationCreateEvent) => void;
  /** Injected so the package never imports a host logger directly (FR-010). */
  logger?: { warn: (message: string, ...args: unknown[]) => void };
}

/**
 * Turns a user selection into a captured anchor for a configured kind.
 *
 * Deliberately headless: it renders no composer of its own. Whether a comment
 * gets a textarea or a correction gets a panel is host UX, so this plugin's
 * whole job is to listen for the create command, run the shared capture
 * primitive, and hand the anchor out. Both kinds take the same path here —
 * only `retainMarkOnCreate` differs, which is what SC-001 rests on.
 *
 * Not gated on `editable`: annotating is decoupled from editing, and a
 * read-only document is a legitimate place to comment.
 */
export function AnnotationPlugin({ kinds, onCreateAnnotation, logger }: AnnotationPluginProps) {
  const [editor] = useLexicalComposerContext();

  const mintId = useCallback((): string => {
    // crypto.randomUUID is unavailable in some non-secure contexts; the id only
    // has to be unique within this document's live marks, so a fallback is fine.
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `anno-${Math.floor(performance.now() * 1000).toString(36)}-${(globalThis.isSecureContext ? 's' : 'u')}`;
  }, []);

  useEffect(() => {
    // The deferred anchor read below outlives the command handler, so it can
    // still be pending when this plugin unmounts — the document is swapped, or
    // the panel owning it closes, in the same tick the command fired. Left
    // unguarded it would then touch a torn-down editor and call the host back
    // with a stale rect and a stale closure. Cleared in the cleanup below.
    let cancelled = false;

    const unregister = editor.registerCommand(
      OPEN_ANNOTATION_COMPOSER_COMMAND,
      ({ kind }) => {
        const config = kinds[kind];
        if (!config) {
          // An unconfigured kind is a host wiring mistake, not a crash (edge
          // case in the spec): warn through the injected logger and decline.
          logger?.warn(`[annotations] ignoring create for unconfigured kind "${kind}"`);
          return false;
        }
        if (!config.createAffordance) {
          logger?.warn(`[annotations] kind "${kind}" is host-injected only; no create affordance`);
          return false;
        }

        // Read the on-screen rect while the selection is still live and before
        // wrapping mutates the DOM around it.
        const nativeSelection = window.getSelection();
        if (!nativeSelection || nativeSelection.rangeCount === 0 || nativeSelection.isCollapsed) return false;
        const nativeRange = nativeSelection.getRangeAt(0);
        const rect = nativeRange.getBoundingClientRect();

        const id = mintId();
        const retainMark = config.retainMarkOnCreate ?? false;

        // Wrap now, while the native range still points at live DOM — but read
        // the anchor back on a microtask rather than inline.
        //
        // A command handler runs *inside* an active Lexical update, so the
        // update `wrapNativeRangeInMark` performs is nested: Lexical queues it
        // and applies it when the outer update completes, which means its
        // result is not observable synchronously here. Reading the anchor
        // inline would read the pre-mark state and always come back null. The
        // microtask runs after the outer update has flushed, so the mark is
        // really in the tree by then.
        wrapNativeRangeInMark(editor, nativeRange, id);

        queueMicrotask(() => {
          if (cancelled) return;
          const anchor = readAnchorFields(editor, id);
          // Comments keep the mark (it is their live anchor and the composer's
          // highlight); corrections discard it so nothing ever paints.
          if (!retainMark) removeMarksForAnnotation(editor, id);
          onCreateAnnotation({ kind, id, anchor, rect });
        });

        return true;
      },
      COMMAND_PRIORITY_CRITICAL,
    );

    return () => {
      cancelled = true;
      unregister();
    };
  }, [editor, kinds, onCreateAnnotation, logger, mintId]);

  return null;
}
