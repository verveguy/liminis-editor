import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { openLink } from '../../messaging-electron';

interface LinkClickPluginProps {
  /** When false (read-only mode), clicks follow links immediately without requiring modifier key */
  editable?: boolean;
}

/**
 * LinkClickPlugin - Controls link click behavior
 *
 * In editable mode:
 * - Regular click: Edit the link (prevents default navigation)
 * - Cmd+click (Mac) / Ctrl+click (Windows/Linux): Open the link
 *
 * In read-only mode:
 * - Regular click: Open the link immediately (no modifier key required)
 *
 * Links:
 * - Wiki-links (.md files): Opens the linked document in the editor
 * - External URLs (http/https): Opens in default browser
 *
 * Also provides visual feedback: cursor changes to pointer when hovering over a link
 * (in read-only mode) or when Cmd/Ctrl is held (in editable mode).
 */
export function LinkClickPlugin({ editable = true }: LinkClickPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    const handleClick = (event: MouseEvent) => {
      // Find if we clicked on a link
      const target = event.target as HTMLElement;
      const linkElement = target.closest('a');
      if (!linkElement) return;

      // Check for modifier key (Cmd on Mac, Ctrl on Windows/Linux)
      const isModifierClick = event.metaKey || event.ctrlKey;

      // In read-only mode: click opens link immediately
      // In editable mode: need modifier key to open link
      const shouldOpenLink = !editable || isModifierClick;

      if (shouldOpenLink) {
        // Open the link
        event.preventDefault();
        event.stopPropagation();

        // URL is stored in data-href (not href) to prevent webview interception
        const url = linkElement.getAttribute('data-href');
        if (url) {
          openLink(url);
        }
      }
      // In editable mode without modifier: No action needed - since there's no href,
      // the browser won't navigate, and the editor handles placing the cursor normally
    };

    // Handle modifier key state for cursor feedback (only needed in editable mode)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (editable && (event.metaKey || event.ctrlKey)) {
        rootElement.classList.add('modifier-held');
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      // Remove class when Cmd/Ctrl is released
      if (event.key === 'Meta' || event.key === 'Control') {
        rootElement.classList.remove('modifier-held');
      }
    };

    // Also handle when window loses focus (user switches apps while holding Cmd)
    const handleBlur = () => {
      rootElement.classList.remove('modifier-held');
    };

    // In read-only mode, always show pointer cursor on links
    if (!editable) {
      rootElement.classList.add('links-clickable');
    } else {
      rootElement.classList.remove('links-clickable');
    }

    // Use capture phase to intercept before the link's default behavior
    rootElement.addEventListener('click', handleClick, { capture: true });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      rootElement.removeEventListener('click', handleClick, { capture: true });
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      rootElement.classList.remove('modifier-held');
      rootElement.classList.remove('links-clickable');
    };
  }, [editor, editable]);

  return null;
}
