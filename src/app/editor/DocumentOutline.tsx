import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { DocumentOutlineHandle, OutlineEntry } from './documentOutlineHandle';

export interface DocumentOutlineProps {
  /** The controller created by `createDocumentOutlineHandle()` and also passed to `<Editor documentOutlineHandle={…}>`. */
  handle: DocumentOutlineHandle;
  /** Additional class name on the outer `<nav>`, for host placement/layout (FR-008). */
  className?: string;
  /**
   * Fires with the clicked entry in addition to `handle.scrollToHeading`.
   * `handle.scrollToHeading` no-ops when no Lexical editor is connected
   * (the markdown-derived/raw-mode path, issue #84) — a raw-mode host has no
   * other way to react to a click, since it doesn't render the entry list
   * itself, so this is how it navigates its own (non-Lexical) editor via
   * `entry.line`.
   */
  onEntrySelect?: (entry: OutlineEntry) => void;
}

/**
 * Renders a navigable "on this page" heading outline for one editor
 * instance, driven by the `DocumentOutlineHandle` shared with that editor's
 * `<Editor documentOutlineHandle={…}>` (issue #69).
 *
 * Renders nothing when the document has no headings (FR-007). Visibility,
 * placement, width-gating, and collapse/persistence are the host's concern
 * (FR-008) — this component only renders the list and reacts to the handle.
 */
export function DocumentOutline({ handle, className, onEntrySelect }: DocumentOutlineProps) {
  // Wrapped rather than passed directly: `handle.subscribe`/`handle.getSnapshot`
  // are unbound method references off a plain interface value.
  const subscribe = useCallback((onStoreChange: () => void) => handle.subscribe(onStoreChange), [handle]);
  const getSnapshot = useCallback(() => handle.getSnapshot(), [handle]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the active entry visible within the outline itself (US2-AC2).
  useEffect(() => {
    if (snapshot.activeIndex === null) return;
    const item = listRef.current?.querySelector<HTMLElement>(
      `[data-outline-index="${snapshot.activeIndex}"]`
    );
    item?.scrollIntoView({ block: 'nearest' });
  }, [snapshot.activeIndex]);

  if (snapshot.entries.length === 0) return null;

  return (
    <nav
      className={className ? `editor-outline ${className}` : 'editor-outline'}
      aria-label="Document outline"
    >
      <ul className="editor-outline-list" ref={listRef}>
        {snapshot.entries.map((entry) => {
          const isActive = entry.index === snapshot.activeIndex;
          return (
            <li
              key={entry.index}
              data-outline-index={entry.index}
              data-outline-level={entry.level}
              className={
                isActive ? 'editor-outline-item editor-outline-item-active' : 'editor-outline-item'
              }
            >
              <button
                type="button"
                className="editor-outline-item-button"
                aria-current={isActive ? 'location' : undefined}
                onClick={() => {
                  handle.scrollToHeading(entry.index);
                  onEntrySelect?.(entry);
                }}
              >
                <span className="editor-outline-indicator" aria-hidden="true" />
                <span className="editor-outline-item-text">{entry.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
