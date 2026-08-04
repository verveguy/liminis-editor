import { useCallback, useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type { AnnotationKindConfigs, MarkerTarget } from '../../annotations/types';
import { markElementsForId } from './annotation-marks';

interface AnnotationMarkerPluginProps {
  targets: MarkerTarget[];
  kinds: AnnotationKindConfigs;
  activeAnnotationId: string | null;
  onActivateAnnotation: (id: string) => void;
  /** Host-driven signal to scroll to an annotation's marker (nonce forces re-scroll on repeats). */
  scrollToAnnotation?: { id: string; nonce: number } | null;
}

const ACTIVE_CLASS = 'annotation-mark-active';
const PULSE_CLASS = 'annotation-mark-pulse';

type Cleanup = () => void;

/**
 * Decorates the real `MarkNode` DOM elements placed by `annotation-marks.ts`
 * with per-kind styling and click/keydown activation — never a separate
 * overlay layer.
 *
 * Only targets that earned a live mark are decorated; `flagged`/`orphaned`
 * anchors, and any kind whose `livemarkPolicy` declines, are simply absent
 * from the DOM here and stay panel-only. Activation routes back to the host,
 * which owns whatever panel or thread the annotation belongs to.
 */
export function AnnotationMarkerPlugin({
  targets,
  kinds,
  activeAnnotationId,
  onActivateAnnotation,
  scrollToAnnotation,
}: AnnotationMarkerPluginProps) {
  const [editor] = useLexicalComposerContext();
  // Cleanups from the previous decoration pass, run before the next one —
  // avoids leaking listeners/attributes onto an element a since-removed or
  // since-recreated target no longer covers.
  const cleanupsRef = useRef<Cleanup[]>([]);

  const decorate = useCallback(() => {
    const cleanups = cleanupsRef.current;
    for (const cleanup of cleanups) cleanup();
    cleanups.length = 0;

    // Group by DOM element before decorating, rather than iterating targets.
    // Overlapping annotations share one MarkNode — and therefore one element —
    // by design (`removeMarksForAnnotation` keeps a mark alive while it still
    // carries other ids). Decorating per-target would attach a second listener
    // pair to that shared element, so one click fired `onActivateAnnotation`
    // once per overlapping annotation, and title/aria-label/data-kind/active
    // would each reflect only whichever target happened to be processed last.
    const byElement = new Map<HTMLElement, MarkerTarget[]>();
    for (const target of targets) {
      const config = kinds[target.kind];
      if (!config || config.markerStyle === 'none') continue;
      for (const element of markElementsForId(editor, target.annotationId)) {
        const existing = byElement.get(element);
        if (existing) existing.push(target);
        else byElement.set(element, [target]);
      }
    }

    for (const [element, elementTargets] of byElement) {
      // Visual classes are additive — every annotation covering this element
      // contributes its kind's marker style and any host-supplied className, so
      // an overlap can be styled as one.
      const classes = new Set<string>();
      for (const target of elementTargets) {
        classes.add(`annotation-mark-${kinds[target.kind].markerStyle}`);
        const extra = target.presentation?.className;
        if (extra) classes.add(extra);
      }

      // Identity and behaviour are single-valued, so one target has to speak
      // for the element: the active annotation if one of them is active,
      // otherwise the first in document order. Activation fires exactly once.
      const representative =
        elementTargets.find((t) => t.annotationId === activeAnnotationId) ?? elementTargets[0];
      const isActive = elementTargets.some((t) => t.annotationId === activeAnnotationId);

      const baseLabel = representative.presentation?.label ?? representative.kind;
      // A host-supplied `presentation.label` wins over the kind default; the
      // flagged suffix still applies so the uncertainty isn't hidden by an
      // override, and an overlap says so rather than silently naming one of them.
      const flaggedLabel =
        representative.outcome === 'flagged'
          ? `${baseLabel} — location uncertain since this text changed`
          : baseLabel;
      const label =
        elementTargets.length > 1
          ? `${flaggedLabel} (+${elementTargets.length - 1} more here)`
          : flaggedLabel;

      for (const className of classes) element.classList.add(className);
      element.classList.toggle(ACTIVE_CLASS, isActive);
      element.dataset.annotationKind = representative.kind;
      element.title = label;
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', label);

      const activate = () => onActivateAnnotation(representative.annotationId);
      const handleKeydown = (e: KeyboardEvent) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        activate();
      };
      element.addEventListener('click', activate);
      element.addEventListener('keydown', handleKeydown);

      cleanups.push(() => {
        element.classList.remove(ACTIVE_CLASS);
        for (const className of classes) element.classList.remove(className);
        delete element.dataset.annotationKind;
        element.removeAttribute('title');
        element.removeAttribute('aria-label');
        element.removeAttribute('role');
        element.removeAttribute('tabindex');
        element.removeEventListener('click', activate);
        element.removeEventListener('keydown', handleKeydown);
      });
    }
  }, [editor, targets, kinds, activeAnnotationId, onActivateAnnotation]);

  useEffect(() => {
    decorate();
  }, [decorate]);

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      decorate();
    });
  }, [editor, decorate]);

  useEffect(() => {
    // Captured here rather than read in the cleanup: the ref's *identity* is
    // stable for the component's lifetime (decorate mutates the array in
    // place, never reassigns), so this holds the same array the last
    // decoration pass filled.
    const cleanups = cleanupsRef.current;
    return () => {
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
    };
  }, []);

  // Smooth-scroll to an annotation's marker, keep it centered as the layout
  // settles, and pulse it on arrival. Scrolling once lands short on a fresh
  // open: async content above the anchor (images loading their height,
  // diagrams/syntax highlighting rendering) shifts the anchor down *after* the
  // scroll, and that timing is variable. Rather than guess when layout is
  // "done", react to it — scroll once the marker exists, then re-center on
  // every content resize for a short window.
  //
  // An unknown or orphaned id has no marker element, so `center` never
  // succeeds and this quietly gives up after the appear window: a no-op, not
  // an error.
  useEffect(() => {
    const id = scrollToAnnotation?.id;
    if (!id) return;
    let raf = 0;
    let appearFrames = 0;
    let stopTimer = 0;
    let pulseTimer = 0;
    let observer: ResizeObserver | null = null;
    let visibility: IntersectionObserver | null = null;

    const center = (behavior: ScrollBehavior): boolean => {
      const element = markElementsForId(editor, id)[0];
      if (!element) return false;
      element.scrollIntoView({ behavior, block: 'center' });
      return true;
    };

    const pulse = (): void => {
      for (const el of markElementsForId(editor, id)) {
        el.classList.remove(PULSE_CLASS);
        void el.offsetWidth; // reflow so the animation restarts on a repeat navigation
        el.classList.add(PULSE_CLASS);
      }
      pulseTimer = window.setTimeout(() => {
        for (const el of markElementsForId(editor, id)) el.classList.remove(PULSE_CLASS);
      }, 1400);
    };

    const start = () => {
      if (!center('smooth')) {
        if (appearFrames++ < 60) raf = requestAnimationFrame(start); // wait for the mark to be placed
        return;
      }
      // Pulse when the anchor actually scrolls into view, not now — firing it
      // here plays the flash while it's still off-screen so it fades before you
      // see it.
      const marker = markElementsForId(editor, id)[0];
      if (marker && typeof IntersectionObserver !== 'undefined') {
        visibility = new IntersectionObserver(
          (entries, io) => {
            if (entries.some((e) => e.isIntersecting)) {
              pulse();
              io.disconnect();
              visibility = null;
            }
          },
          // threshold 0 (fire as soon as any part is visible), not 0.5 — a mark
          // spanning more than half the viewport never reaches a 0.5 ratio, so
          // the pulse would silently never play.
          { threshold: 0 },
        );
        visibility.observe(marker);
      } else {
        pulse();
      }
      const root = editor.getRootElement();
      if (root && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => center('smooth'));
        observer.observe(root);
        stopTimer = window.setTimeout(() => observer?.disconnect(), 2500);
      }
    };
    start();

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      visibility?.disconnect();
      if (stopTimer) clearTimeout(stopTimer);
      if (pulseTimer) clearTimeout(pulseTimer);
    };
    // Depends on `nonce` as well as `id` so a repeat scroll-to the same
    // annotation re-triggers rather than being skipped as an unchanged dep.
  }, [editor, scrollToAnnotation?.id, scrollToAnnotation?.nonce]);

  return null;
}
