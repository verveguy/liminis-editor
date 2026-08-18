/**
 * The controller shared between one `<Editor documentOutlineHandle={…}>` and
 * one `<DocumentOutline handle={…}>`. `OutlinePlugin` feeds it from inside the
 * Lexical tree; `DocumentOutline` reads it via `useSyncExternalStore`.
 *
 * A plain `MutableRefObject` (the pattern `annotationEditorHandleRef` uses)
 * does not fit here: `DocumentOutline` must re-render live as the reader
 * scrolls and the document changes, and mutating a ref's `.current` does not
 * propagate to a sibling component reading the same ref. An external-store
 * object solves that, and — because the consumer creates one per editor
 * instance — it is naturally scoped to that instance, so mounting more than
 * one editor at once never aggregates headings across them.
 */

/** A single heading captured for display. */
export interface OutlineEntry {
  /**
   * Position within the document's H1–H5 heading order. Identity for
   * selection and active-tracking is by this index, not by `text`, so
   * duplicate heading titles are handled correctly.
   */
  index: number;
  /** Heading level. H6 is out of scope — the editor theme has no class for it. */
  level: 1 | 2 | 3 | 4 | 5;
  /** Heading text with inline content (including inline code) reduced to plain text. */
  text: string;
}

export interface DocumentOutlineSnapshot {
  entries: OutlineEntry[];
  /** Index of the entry whose heading is at the top of the viewport, or `null` when there is no active heading (e.g. no headings at all). */
  activeIndex: number | null;
}

/**
 * Not exported, so nothing outside this module can reference it. Its only
 * purpose is to make `DocumentOutlineHandle` nominal instead of structural:
 * without it, any object with matching method names would type-check as a
 * handle, and `OutlinePlugin`'s cast to `OutlineHandleImpl` (to reach
 * `connect`/`disconnect`/`publish`) would throw at runtime for a hand-rolled
 * one. Only `OutlineHandleImpl`, constructed exclusively by
 * `createDocumentOutlineHandle()`, can supply this property.
 */
const HANDLE_BRAND = Symbol('DocumentOutlineHandle');

/**
 * The public surface a consumer reads and passes around. Create one with
 * `createDocumentOutlineHandle()` and pass the same instance to both
 * `<Editor documentOutlineHandle>` and `<DocumentOutline handle>`.
 */
export interface DocumentOutlineHandle {
  /** Brand only, not a real property to read — see `HANDLE_BRAND`. */
  readonly [HANDLE_BRAND]: true;
  /** React external-store subscription — see `useSyncExternalStore`. */
  subscribe(onStoreChange: () => void): () => void;
  /** React external-store snapshot. Stable by reference until the outline actually changes. */
  getSnapshot(): DocumentOutlineSnapshot;
  /** Scroll the editor to the heading at `index`. No-ops if no editor is currently connected, or `index` is out of range. */
  scrollToHeading(index: number): void;
}

const EMPTY_SNAPSHOT: DocumentOutlineSnapshot = { entries: [], activeIndex: null };

function snapshotsEqual(a: DocumentOutlineSnapshot, b: DocumentOutlineSnapshot): boolean {
  if (a.activeIndex !== b.activeIndex) return false;
  if (a.entries.length !== b.entries.length) return false;
  for (let i = 0; i < a.entries.length; i++) {
    const x = a.entries[i];
    const y = b.entries[i];
    if (x.index !== y.index || x.level !== y.level || x.text !== y.text) return false;
  }
  return true;
}

/**
 * The concrete object `createDocumentOutlineHandle()` returns. Consumers only
 * ever see the `DocumentOutlineHandle` surface above; `OutlinePlugin` — the
 * only other reader of an instance, always produced by
 * `createDocumentOutlineHandle()` — reaches `connect`/`disconnect`/`publish`
 * directly on this class.
 */
export class OutlineHandleImpl implements DocumentOutlineHandle {
  readonly [HANDLE_BRAND] = true as const;
  private snapshot: DocumentOutlineSnapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private scrollImpl: ((index: number) => void) | null = null;

  subscribe = (onStoreChange: () => void): (() => void) => {
    this.listeners.add(onStoreChange);
    return () => {
      this.listeners.delete(onStoreChange);
    };
  };

  getSnapshot = (): DocumentOutlineSnapshot => this.snapshot;

  scrollToHeading = (index: number): void => {
    this.scrollImpl?.(index);
  };

  /** Called by `OutlinePlugin` while its editor is mounted. */
  connect(scrollImpl: (index: number) => void): void {
    this.scrollImpl = scrollImpl;
  }

  /** Called by `OutlinePlugin` on unmount, so a stale handle no-ops rather than scrolling a torn-down editor. */
  disconnect(): void {
    this.scrollImpl = null;
  }

  /** Called by `OutlinePlugin` whenever headings or the active heading change. */
  publish(next: DocumentOutlineSnapshot): void {
    if (snapshotsEqual(this.snapshot, next)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

/**
 * Create a controller shared between one `<Editor documentOutlineHandle={…}>`
 * and one `<DocumentOutline handle={…}>`. Create it once per editor instance
 * (e.g. via `useState(() => createDocumentOutlineHandle())`) and pass the
 * same object to both — that is what scopes the outline to that editor, even
 * when a consumer mounts several editors at once.
 */
export function createDocumentOutlineHandle(): DocumentOutlineHandle {
  return new OutlineHandleImpl();
}
