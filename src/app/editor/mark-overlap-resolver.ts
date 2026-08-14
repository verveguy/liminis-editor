/**
 * Un-nests overlapping annotation marks into id-unioned siblings (Liminis
 * #970, FR-005/FR-006).
 *
 * `$wrapSelectionInMarkNode` does not merge ids. When a placement's selection
 * lands inside an existing `MarkNode`, it creates a *nested* `MarkNode` inside
 * it — its own source says as much, and defers un-nesting to "a call to
 * `registerNestedElementResolver<MarkNode>` somewhere else in the codebase".
 * Nothing registered one, so a pair of overlapping annotations produced a
 * `<mark>` inside a `<mark>`: the inner element carries only the inner id, so
 * the shared region resolves to one annotation rather than both, and a click
 * there fires once for the inner mark and again for the outer as the event
 * bubbles. `AnnotationMarkerPlugin` already groups its decorations *by DOM
 * element*, on the stated assumption that "overlapping annotations share one
 * MarkNode — and therefore one element"; this registration is what makes that
 * assumption true.
 *
 * With it, an overlap becomes a run of sibling marks — the disjoint parts
 * carrying one id each, the shared part carrying both — so every id still has
 * at least one element, the shared element resolves to both ids, and removing
 * one id leaves the other's coverage over the shared region intact (a
 * `MarkNode` with ids remaining is not unwrapped; see
 * `removeMarksForAnnotations`).
 *
 * `annotation-marks.ts`'s `locateLiveMarkdownRange` already handles an id
 * spread across several sibling marks (first open token → last close token,
 * with interior tokens stripped), so splitting a mark this way does not change
 * any recovered range.
 *
 * This is a Lexical *node transform*, so it runs at the end of the update that
 * created the nesting — inside the same `editor.update()` as the batch that
 * placed the marks, preserving the single-reconciliation guarantee (FR-009).
 */
import { $createMarkNode, MarkNode } from '@lexical/mark';
import { registerNestedElementResolver } from '@lexical/utils';
import type { LexicalEditor } from 'lexical';

/**
 * Registers the un-nesting transform on `editor`. Returns the unregister
 * function, so a host that mounts it in an effect can tear it down.
 */
export function registerMarkOverlapResolver(editor: LexicalEditor): () => void {
  return registerNestedElementResolver<MarkNode>(
    editor,
    MarkNode,
    (from) => $createMarkNode(from.getIDs()),
    (from, to) => {
      for (const id of from.getIDs()) to.addID(id);
    },
  );
}
