/**
 * The transient "waiting" visual for block transclusion (#119) — split into
 * its own, deliberately dependency-light module.
 *
 * `TransclusionNode.tsx` needs this for its `Suspense` fallback, and
 * `TransclusionNode.tsx` is part of the `./nodes` subpath's *static* (eagerly
 * evaluated) import graph — unlike `TransclusionComponent.tsx`, which is only
 * ever reached through a dynamic `import()`. `transclusion-render.tsx`
 * imports `parseMarkdown` (and, transitively, the whole micromark/mdast-util
 * pipeline) to do its real work; if `TransclusionNode.tsx` imported this
 * function from that module instead, `./nodes` would statically pull in the
 * entire markdown pipeline it does not otherwise need — exactly the weight
 * `src/__tests__/nodes-subpath.test.ts` exists to keep out. Keeping this one
 * function here, with no import of `transclusion-render.tsx`, is what keeps
 * that boundary intact.
 */
import { createElement, type ReactNode } from 'react';

/**
 * The transient "resolver call in flight" state — not part of
 * `TransclusionRenderState` (`transclusion-render.tsx`) because it is a UI
 * concern of the lazily-mounted `TransclusionComponent`, not an outcome the
 * pure resolver ever produces (it only returns once fully settled). Also
 * used as the `Suspense` fallback in `TransclusionNode.decorate()` while the
 * component's own code chunk is still loading, so both "waiting" cases look
 * the same.
 */
export function renderTransclusionLoading(): ReactNode {
  return createElement('span', { className: 'editor-transclusion-loading' }, 'Loading…');
}
