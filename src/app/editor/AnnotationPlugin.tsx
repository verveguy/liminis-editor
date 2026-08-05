import { useCallback, useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { COMMAND_PRIORITY_CRITICAL } from 'lexical';
import type { AnchorFields } from '../../annotations/anchor-model';
import type { AnnotationKindConfigs } from '../../annotations/types';
import {
  readAnchorFields,
  removeMarksForAnnotation,
  removeMarksForAnnotations,
  wrapNativeRangeInMark,
} from './annotation-marks';
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
    // crypto.randomUUID is unavailable in some non-secure contexts (an
    // unpackaged Electron or file:// window); the id only has to be unique
    // within this document's live marks, so a fallback is fine.
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // A timestamp alone is not enough: `performance.now()` is coarsened for
    // fingerprinting protection, so two creates in quick succession can land on
    // the same value. Ids gate mark placement and removal via `hasID`/`deleteID`,
    // so a collision would merge two annotations onto one live mark and let
    // removing either delete the other's anchor. The random suffix makes that
    // effectively impossible without needing a real UUID source.
    const stamp = Math.floor(performance.now() * 1000).toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    return `anno-${stamp}-${random}-${globalThis.isSecureContext ? 's' : 'u'}`;
  }, []);

  // Marks placed by a create whose anchor read hasn't run yet. The wrap is
  // synchronous but the read-back is deferred, so between the two the mark
  // exists in the document while its id exists nowhere else — the host has not
  // been told, and `AnnotationMarkerPlugin` walks only host-supplied
  // annotations. Dropping one there would strand a bare `<mark>` the user
  // cannot dismiss until the document is reparsed (review finding,
  // @handarbeit-pruefer). The teardown effect below retracts whatever is left.
  //
  // Held in a ref, not an effect-local, so it survives a re-run of the
  // command-registration effect: a create in flight belongs to the plugin, not
  // to the effect run that happened to register the handler.
  const pendingIdsRef = useRef<Set<string>>(new Set());

  // Cancellation is a property of the plugin's *lifetime*, not of one effect
  // run. Scoping it per-run would make correctness depend on React flushing the
  // cleanup after the pending microtask: that holds on the default async render
  // path (verified by test), but a synchronous re-render — `flushSync`, or a
  // discrete input forcing one — runs the cleanup first, and a create in flight
  // would be silently dropped with the host never told (review finding,
  // CodeRabbit). Tying the flag to unmount makes the ordering irrelevant.
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    const pendingIds = pendingIdsRef.current;
    return () => {
      // Runs only on unmount (`editor` is stable for the composer's lifetime),
      // which is exactly the case where a deferred read must not proceed: it
      // would touch a torn-down editor and call the host back with a stale rect
      // and a stale closure.
      unmountedRef.current = true;
      // Retract regardless of the kind's `retainMarkOnCreate`: a retained mark
      // is only safe to leave behind because the host owns it from the moment
      // `onCreateAnnotation` fires, and that never happened for these.
      //
      // Safe to touch the editor here: this cleanup runs as ordinary React
      // work, not inside the Lexical update the command handler ran in, so the
      // queued wrap has already been applied by the time we get here.
      if (pendingIds.size > 0) {
        removeMarksForAnnotations(editor, [...pendingIds]);
        pendingIds.clear();
      }
    };
  }, [editor]);

  useEffect(() => {
    const pendingIds = pendingIdsRef.current;

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
        // The mark is now in the tree but its id has not been reported to the
        // host yet, so nothing outside this plugin can clean it up. Tracked
        // until the microtask hands it over (or the cleanup retracts it).
        pendingIds.add(id);

        queueMicrotask(() => {
          if (unmountedRef.current) return;
          pendingIds.delete(id);
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

    // Only the registration is scoped to this effect run; cancellation and the
    // pending-mark retraction live in the teardown effect above.
    return unregister;
  }, [editor, kinds, onCreateAnnotation, logger, mintId]);

  return null;
}
