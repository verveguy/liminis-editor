import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { calculateZoomLevel } from '@lexical/utils';
import { $getNearestNodeFromDOMNode } from 'lexical';
import { $isCustomListItemNode, ORDERED_TASK_CHECKED_CLASS, ORDERED_TASK_UNCHECKED_CLASS } from './nodes/CustomListItemNode';

/**
 * OrderedTaskListPlugin - Click-to-toggle for ordered task-item checkboxes.
 *
 * @lexical/react's CheckListPlugin only wires up click/keyboard handling for
 * a list whose DOM `__lexicalListType` is 'check' (see @lexical/list's
 * registerCheckList/handleCheckItemEvent) — it never fires for our
 * 'number'-typed ordered lists, so this plugin reimplements the click half
 * of that behavior for CustomListItemNode's own ordered-task classes
 * (CustomListItemNode.tsx's createDOM/updateDOM override). The hit-box
 * geometry (clientX vs. the rendered ::before pseudo-element's width) is
 * copied from @lexical/list's handleCheckItemEvent so clicking anywhere
 * across the visible checkbox — not just its exact CSS box — toggles it,
 * matching the feel of the unordered checklist.
 *
 * Toggling calls setTaskChecked() exclusively, never setChecked()/
 * toggleChecked() — see CustomListItemNode's docstring and
 * ListNode's updateChildrenListItemValue transform, which resets any
 * non-null raw __checked back to undefined for a non-'check' list and would
 * cascade into wiping __taskChecked too.
 */
export function OrderedTaskListPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    const isOrderedTaskTarget = (target: EventTarget | null): target is HTMLElement =>
      target instanceof HTMLElement &&
      (target.classList.contains(ORDERED_TASK_CHECKED_CLASS) || target.classList.contains(ORDERED_TASK_UNCHECKED_CLASS));

    const isCheckboxHit = (target: HTMLElement, clientX: number): boolean => {
      const rect = target.getBoundingClientRect();
      const zoom = calculateZoomLevel(target);
      const clientXInPixels = clientX / zoom;
      const beforeStyles = window.getComputedStyle(target, '::before');
      const beforeWidthInPixels = parseFloat(beforeStyles.width);

      return target.dir === 'rtl'
        ? clientXInPixels < rect.right && clientXInPixels > rect.right - beforeWidthInPixels
        : clientXInPixels > rect.left && clientXInPixels < rect.left + beforeWidthInPixels;
    };

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!isOrderedTaskTarget(target)) return;
      if (!isCheckboxHit(target, event.clientX)) return;
      // Prevents the caret moving when clicking on the checkbox, matching
      // CheckListPlugin's handleSelectDefaults for the unordered case.
      event.preventDefault();
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!isOrderedTaskTarget(target)) return;
      if (!isCheckboxHit(target, event.clientX)) return;
      if (!editor.isEditable()) return;

      const domNode = target;
      editor.update(() => {
        const node = $getNearestNodeFromDOMNode(domNode);
        if ($isCustomListItemNode(node)) {
          node.setTaskChecked(!node.getTaskChecked());
        }
      });
    };

    rootElement.addEventListener('mousedown', handleMouseDown, { capture: true });
    rootElement.addEventListener('click', handleClick);

    return () => {
      rootElement.removeEventListener('mousedown', handleMouseDown, { capture: true });
      rootElement.removeEventListener('click', handleClick);
    };
  }, [editor]);

  return null;
}
