import { useCallback, useEffect, useRef, useMemo, useState, lazy, Suspense, type MutableRefObject } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $isCodeNode } from '@lexical/code';
import { registerCodeHighlighting } from '@lexical/code-prism';
import {
  $createParagraphNode,
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  EditorState,
  KEY_ENTER_COMMAND,
  LexicalEditor,
  LexicalNode,
  RangeSelection,
} from 'lexical';
import { mergeRegister } from '@lexical/utils';

import { Toolbar } from './Toolbar';
import { SlashMenuPlugin } from './SlashMenuPlugin';
import { DragHandlePlugin } from './DragHandlePlugin';
import { MarkdownShortcutsPlugin } from './MarkdownShortcutsPlugin';
import { TableActionsPlugin } from './TableActionsPlugin';
import { CodeBlockPlugin } from './CodeBlockPlugin';
import { TogglePlugin } from './TogglePlugin';
import { ImagePlugin } from './ImagePlugin';
import { BlockClickPlugin } from './BlockClickPlugin';
import { LinkClickPlugin } from './LinkClickPlugin';
import { OrderedTaskListPlugin } from './OrderedTaskListPlugin';
import { SearchPlugin } from './SearchPlugin';
import { FrontmatterPlugin } from './FrontmatterPlugin';
import { WikiLinkExistencePlugin } from './WikiLinkExistencePlugin';
import { WikiLinkFormatPlugin } from './WikiLinkFormatPlugin';
import { AnchorScrollPlugin } from './AnchorScrollPlugin';
import { SelectionContextMenuPlugin } from './SelectionContextMenuPlugin';
import type { SelectionContextMenuEvent } from './SelectionContextMenuPlugin';
import { CorrectionPanelPlugin } from './CorrectionPanelPlugin';
import { AmbientCorrectionPlugin, type SweepFn } from './AmbientCorrectionPlugin';
import { AssetContext, createAssetContextValue } from './AssetContext';
import { editorNodes } from './editorNodes';
import {
  importMarkdownToLexicalInEditorStateWithOffsets,
  importMarkdownToLexicalWithOffsets,
  type OffsetSpan,
} from '../mapper/mdastToLexical';
// Type-only: erased at compile time, so these do not put the annotation
// modules in this file's runtime import graph (FR-004/SC-004).
import type {
  Annotation,
  AnnotationEditorHandle,
  AnnotationKindConfigs,
} from '../../annotations/types';
import type { AnnotationCreateEvent } from './AnnotationPlugin';

import { exportLexicalToMdast, type WikiLinkPromotionMode } from '../mapper/lexicalToMdast';
import { parseMarkdown } from '../../markdown/parse';
import { stringifyMarkdown } from '../../markdown/stringify';
import type { ImagePathResolution } from '../../types';
import type { CursorState } from '../App';

/**
 * The annotation feature surface, loaded only when a host configures at least
 * one kind. A static import here would defeat FR-004: every consumer would
 * pull the annotation modules into its graph whether or not it uses them.
 */
const LazyAnnotationSurface = lazy(() => import('./AnnotationSurface'));

/** Stable identity, so an unconfigured `annotations` prop doesn't re-render the surface. */
const EMPTY_ANNOTATIONS: Annotation[] = [];


interface EditorProps {
  initialContent: string;
  /**
   * Whether the editor takes focus shortly after mounting. Defaults to
   * `false`: an embedded editor does not know whether it is the surface the
   * user is working in, and the host does.
   *
   * Opt in where opening the editor *is* the user's action — clicking a
   * document to edit it. Do not opt in for an editor that mounts beside
   * something else the user may be typing in, renders in a preview or a list,
   * or remounts while focus belongs elsewhere.
   *
   * This defaulted to on until it was found to steal the caret out of
   * whatever the user was actually using. Focus is taken on a timer after
   * mount, so a host cannot reliably take it back afterwards — it has to be
   * declined up front, which is why this is a prop and not something to work
   * around at the call site.
   */
  autoFocus?: boolean;
  contentVersion?: number;
  /** Ref to cursor state - read inside effects, not during render */
  cursorToRestoreRef?: React.RefObject<CursorState | null>;
  onChange: (markdown: string) => void;
  onCursorChange?: (cursor: CursorState) => void;
  onSelectionContextMenu?: (event: SelectionContextMenuEvent) => void;
  assetBaseUri?: string;
  documentDirUri?: string;
  imagePathResolution?: ImagePathResolution;
  /**
   * Whether an untitled relative link (a `.md` path, a `.md` path with an
   * anchor, a bare `#anchor`, or a directory-style path) is promoted to
   * wiki-link syntax on export. Defaults to `'promote'`, today's only
   * behavior — set to `'off'` for a host whose documents are rendered
   * somewhere that doesn't understand wiki-link syntax (liminis#951). Never
   * affects a genuine author-written `[[target]]` wiki-link, which always
   * round-trips as one regardless of this setting.
   */
  wikiLinkPromotion?: WikiLinkPromotionMode;
  /** Resolve a workspace-relative file path to a data URL for display */
  resolveLocalAsset?: (relativePath: string) => Promise<string | null>;
  /** When false, the editor is read-only */
  editable?: boolean;
  /** Path to the file being edited (used for file-type-specific UI like .mdc) */
  filePath?: string;
  /** Called when a single-word substitution is detected after a debounce window. */
  onSubstitutionDetected?: (oldTerm: string, newTerm: string) => void;
  /** Ref populated with a sweep function by AmbientCorrectionPlugin when active. */
  sweepRef?: MutableRefObject<SweepFn | null>;

  // --- Annotations (ADR-077). Entirely opt-in: with no `annotationKinds`, no
  // annotation module is loaded, no command is registered and nothing renders.
  /**
   * Per-kind configuration. Supplying this is what turns the annotation
   * mechanism on; the kinds themselves are the only difference between
   * features built on it (a comment kind vs. a correction kind).
   */
  annotationKinds?: AnnotationKindConfigs;
  /** Host-supplied annotations to render markers for, already resolved by the host. */
  annotations?: Annotation[];
  /** Which annotation is currently active, for marker styling. */
  activeAnnotationId?: string | null;
  /** Host-driven scroll-to signal; `nonce` forces a re-scroll to the same id. */
  scrollToAnnotation?: { id: string; nonce: number } | null;
  /** Fires when a user creates an annotation via a kind's create affordance. */
  onCreateAnnotation?: (event: AnnotationCreateEvent) => void;
  /** Fires when a marker is activated; the host opens its own panel or thread. */
  onActivateAnnotation?: (id: string) => void;
  /** Populated with the imperative handle for the mounted editor's live marks. */
  annotationEditorHandleRef?: MutableRefObject<AnnotationEditorHandle | null>;
  /** Injected logger, so the package never imports a host logger (FR-010). */
  annotationLogger?: { warn: (message: string, ...args: unknown[]) => void };
}

const editorTheme = {
  paragraph: 'editor-paragraph',
  heading: {
    h1: 'editor-heading-h1',
    h2: 'editor-heading-h2',
    h3: 'editor-heading-h3',
    h4: 'editor-heading-h4',
    h5: 'editor-heading-h5',
  },
  list: {
    ul: 'editor-list-ul',
    ol: 'editor-list-ol',
    listitem: 'editor-listitem',
    listitemChecked: 'editor-listitem-checked',
    listitemUnchecked: 'editor-listitem-unchecked',
    nested: {
      listitem: 'editor-nested-listitem',
    },
  },
  quote: 'editor-quote',
  code: 'editor-code',
  codeHighlight: {
    atrule: 'editor-tokenAttr',
    attr: 'editor-tokenAttr',
    boolean: 'editor-tokenProperty',
    builtin: 'editor-tokenSelector',
    cdata: 'editor-tokenComment',
    char: 'editor-tokenSelector',
    class: 'editor-tokenFunction',
    'class-name': 'editor-tokenFunction',
    comment: 'editor-tokenComment',
    constant: 'editor-tokenProperty',
    deleted: 'editor-tokenProperty',
    doctype: 'editor-tokenComment',
    entity: 'editor-tokenOperator',
    function: 'editor-tokenFunction',
    important: 'editor-tokenVariable',
    inserted: 'editor-tokenSelector',
    keyword: 'editor-tokenAttr',
    namespace: 'editor-tokenVariable',
    number: 'editor-tokenProperty',
    operator: 'editor-tokenOperator',
    prolog: 'editor-tokenComment',
    property: 'editor-tokenProperty',
    punctuation: 'editor-tokenPunctuation',
    regex: 'editor-tokenVariable',
    selector: 'editor-tokenSelector',
    string: 'editor-tokenSelector',
    symbol: 'editor-tokenProperty',
    tag: 'editor-tokenProperty',
    url: 'editor-tokenOperator',
    variable: 'editor-tokenVariable',
  },
  link: 'editor-link',
  table: 'editor-table',
  tableRow: 'editor-table-row',
  tableCell: 'editor-table-cell',
  tableCellHeader: 'editor-table-cell-header',
  text: {
    bold: 'editor-text-bold',
    italic: 'editor-text-italic',
    strikethrough: 'editor-text-strikethrough',
    code: 'editor-text-code',
    underline: 'editor-text-underline',
  },
};

function editorOnError(error: Error): void {
  console.error('Lexical error:', error);
}

// Mirror of $exitCodeNodeOnEnter in @lexical/code-core@0.44 (CodeExtension.register).
// CodePrismExtension requires LexicalExtensionComposer which is incompatible with
// LexicalComposer, so the Enter×3 escape logic is wired here instead.
// Re-verify against upstream when bumping @lexical/code past 0.44 (#8360).
function $exitCodeBlockOnEnter(selection: RangeSelection): boolean {
  const { anchor } = selection;
  if (!selection.isCollapsed() || anchor.type !== 'element') return false;
  const codeNode = anchor.getNode();
  if (!$isCodeNode(codeNode)) return false;
  const childrenSize = codeNode.getChildrenSize();
  if (childrenSize < 2 || anchor.offset !== childrenSize) return false;
  const lastChild = codeNode.getLastChild();
  if (!$isLineBreakNode(lastChild) || !$isLineBreakNode(lastChild.getPreviousSibling())) return false;
  const newElement = $createParagraphNode();
  codeNode.splice(childrenSize - 2, 2, []).insertAfter(newElement, false);
  newElement.select();
  return true;
}

// Plugin to enable syntax highlighting in code blocks and wire the Enter×3 escape
// handler that moved to CodeExtension in Lexical 0.44 (#8360).
function CodeHighlightPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return mergeRegister(
      registerCodeHighlighting(editor),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !$exitCodeBlockOnEnter(selection)) return false;
          event?.preventDefault();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor]);

  return null;
}

// Plugin to initialize editor with markdown content
function InitializePlugin({
  content,
  onOffsets,
}: {
  content: string;
  /**
   * Receives the raw-markdown offset->node table this parse produced, for the
   * annotation surface's mark placement.
   *
   * Deliberately not gated on whether annotations are currently enabled. This
   * effect body runs exactly once (`hasInitialized`), so a host whose
   * `annotationKinds` arrive after mount — an async config load, a
   * feature-flag fetch — would otherwise leave the offset table permanently
   * empty, and every later placement pass would silently find no containing
   * span and place no marks at all. Collecting spans unconditionally costs one
   * small record per text node on a path that is already walking every node,
   * which is cheaper than the failure it removes.
   */
  onOffsets: (spans: OffsetSpan[], markdownText: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    if (content) {
      const { root } = parseMarkdown(content);
      onOffsets(importMarkdownToLexicalWithOffsets(editor, root), content);
    }
  }, [editor, content, onOffsets]);

  return null;
}

// Plugin to auto-focus the editor when it mounts
function AutoFocusPlugin() {
  const [editor] = useLexicalComposerContext();
  const hasFocused = useRef(false);

  useEffect(() => {
    if (hasFocused.current) return;
    hasFocused.current = true;

    // Small delay to ensure the editor is fully ready
    const timeoutId = setTimeout(() => {
      const rootElement = editor.getRootElement();
      if (rootElement) {
        // Focus without scrolling
        rootElement.focus({ preventScroll: true });
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [editor]);

  return null;
}

// Plugin to handle dynamic editable state changes
function EditablePlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(editable);
  }, [editor, editable]);

  return null;
}

// Plugin to track cursor position and report to parent
function CursorTrackingPlugin({
  onCursorChange,
}: {
  onCursorChange?: (cursor: CursorState) => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onCursorChange) return;

    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        const offset = getGlobalOffsetForPoint(selection.anchor);
        if (offset === null) return;

        const textContent = $getRoot().getTextContent();
        const CONTEXT_CHARS = 50;
        const contextBefore = textContent.slice(
          Math.max(0, offset - CONTEXT_CHARS),
          offset
        );
        const contextAfter = textContent.slice(
          offset,
          Math.min(textContent.length, offset + CONTEXT_CHARS)
        );

        onCursorChange({
          offset,
          contextBefore,
          contextAfter,
        });
      });
    });
  }, [editor, onCursorChange]);

  return null;
}

// Plugin to restore cursor after content reload
function CursorRestorePlugin({
  contentVersion,
  cursorToRestoreRef,
}: {
  contentVersion: number;
  cursorToRestoreRef: React.RefObject<CursorState | null>;
}) {
  const [editor] = useLexicalComposerContext();
  const lastRestoredVersion = useRef(contentVersion);

  useEffect(() => {
    // Only restore when contentVersion actually changes (content was reloaded)
    if (contentVersion === lastRestoredVersion.current) return;
    lastRestoredVersion.current = contentVersion;

    // Read ref value inside effect, not during render
    const cursorToRestore = cursorToRestoreRef.current;
    if (!cursorToRestore) return;

    console.log('[CursorRestorePlugin] Restoring cursor', {
      contentVersion,
      offset: cursorToRestore.offset,
    });

    // Delay slightly to ensure content has been imported
    requestAnimationFrame(() => {
      editor.update(() => {
        const root = $getRoot();
        const textContent = root.getTextContent();

        // Try to find cursor position using context
        let newOffset = findOffsetByContext(
          textContent,
          cursorToRestore.offset,
          cursorToRestore.contextBefore,
          cursorToRestore.contextAfter
        );

        // Clamp to valid range
        newOffset = Math.max(0, Math.min(textContent.length, newOffset));

        const point = findTextPointAtOffset(root, newOffset);
        if (point) {
          const selection = $createRangeSelection();
          selection.anchor.set(point.key, point.offset, 'text');
          selection.focus.set(point.key, point.offset, 'text');
          $setSelection(selection);
          console.log('[CursorRestorePlugin] Selection restored at offset', newOffset);
        }
      });

      // Re-focus the editor
      const rootElement = editor.getRootElement();
      if (rootElement) {
        rootElement.focus({ preventScroll: true });
      }
    });
  }, [editor, contentVersion, cursorToRestoreRef]);

  return null;
}

// Find best matching offset using context strings
function findOffsetByContext(
  text: string,
  fallbackOffset: number,
  contextBefore: string,
  contextAfter: string
): number {
  // Try to find the exact junction of before+after context
  if (contextBefore && contextAfter) {
    const combined = contextBefore + contextAfter;
    const idx = text.indexOf(combined);
    if (idx !== -1) {
      return idx + contextBefore.length;
    }
  }

  // Try to find just the before context (cursor at end of it)
  if (contextBefore.length >= 10) {
    const idx = text.indexOf(contextBefore);
    if (idx !== -1) {
      return idx + contextBefore.length;
    }
  }

  // Try to find just the after context (cursor at start of it)
  if (contextAfter.length >= 10) {
    const idx = text.indexOf(contextAfter);
    if (idx !== -1) {
      return idx;
    }
  }

  // Fallback to absolute offset (clamped)
  return fallbackOffset;
}

// Plugin to handle content updates from extension host
// This should ONLY reload when content comes from external source (file open/reload)
// NOT when content flows back from editor's own onChange
function ExternalUpdatePlugin({
  content,
  lastExternalLoadRef,
  currentContentRef,
  lastEditorChangeRef,
  onOffsets,
}: {
  content: string;
  lastExternalLoadRef: React.MutableRefObject<number>;
  currentContentRef: React.MutableRefObject<string>;
  lastEditorChangeRef: React.MutableRefObject<number>;
  /**
   * Same contract as `InitializePlugin`'s, and unconditional for the same
   * reason: an external reload re-parses the document from scratch, so the
   * annotation surface's offset->node table must be rebuilt with it. Without
   * this the table would keep pointing at node keys this reload destroyed, and
   * mark placement would throw on a key Lexical no longer knows.
   */
  onOffsets: (spans: OffsetSpan[], markdownText: string) => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Skip if content matches what we already have
    if (content === currentContentRef.current) {
      return;
    }

    // Skip if this change likely came from the editor itself (via onChange callback)
    // This prevents the feedback loop: type -> onChange -> prop change -> reload
    const timeSinceEditorChange = Date.now() - lastEditorChangeRef.current;
    if (timeSinceEditorChange < POST_LOAD_SUPPRESS_MS) {
      // Still update the ref so we don't reload on next render either
      currentContentRef.current = content;
      return;
    }

    console.log('[ExternalUpdatePlugin] Reloading content', {
      contentLen: content.length,
      currentLen: currentContentRef.current.length,
    });

    // Mark that we're loading external content
    lastExternalLoadRef.current = Date.now();
    currentContentRef.current = content;

    // Defer the editor update to avoid React's flushSync warning
    // This moves the Lexical update out of React's commit phase
    queueMicrotask(() => {
      // Double-check content still needs updating (user might have typed during microtask)
      if (content !== currentContentRef.current) {
        console.log('[ExternalUpdatePlugin] Skipping stale reload');
        return;
      }
      
      const { root } = parseMarkdown(content);
      let spans: OffsetSpan[] = [];
      editor.update(
        () => {
          spans = importMarkdownToLexicalInEditorStateWithOffsets(root);
        },
        { discrete: true }
      );
      onOffsets(spans, content);
    });
  }, [editor, content, lastExternalLoadRef, currentContentRef, lastEditorChangeRef, onOffsets]);

  return null;
}

// Convert a Lexical selection point to a global character offset
function getGlobalOffsetForPoint(point: { key: string; offset: number }): number | null {
  const root = $getRoot();
  let currentOffset = 0;
  let found = false;

  const walk = (node: LexicalNode) => {
    if (found) return;

    if (node.getKey() === point.key) {
      if ($isTextNode(node)) {
        currentOffset += Math.min(point.offset, node.getTextContent().length);
        found = true;
        return;
      }
      if ($isElementNode(node)) {
        const children = node.getChildren();
        const limit = Math.min(point.offset, children.length);
        for (let i = 0; i < limit; i += 1) {
          currentOffset += children[i].getTextContent().length;
        }
        found = true;
        return;
      }
    }

    if ($isTextNode(node)) {
      currentOffset += node.getTextContent().length;
      return;
    }

    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        walk(child);
        if (found) return;
      }
    }
  };

  walk(root);
  return found ? currentOffset : null;
}

// Find a text node and offset for a given global character offset
function findTextPointAtOffset(
  root: ReturnType<typeof $getRoot>,
  offset: number
): { key: string; offset: number } | null {
  const textNodes = root.getAllTextNodes();
  if (textNodes.length === 0) {
    return null;
  }

  let remaining = Math.max(0, offset);
  for (const node of textNodes) {
    const length = node.getTextContent().length;
    if (remaining <= length) {
      return { key: node.getKey(), offset: remaining };
    }
    remaining -= length;
  }

  const lastNode = textNodes[textNodes.length - 1];
  return { key: lastNode.getKey(), offset: lastNode.getTextContent().length };
}

// Debounce delay in ms - balances responsiveness with performance
const DEBOUNCE_DELAY = 100;

// Window after an external content load (file open/reload) or editor-initiated change
// during which we suppress onChange/reload to avoid feedback loops and normalization noise.
const POST_LOAD_SUPPRESS_MS = 500;

export function Editor({
  initialContent,
  autoFocus = false,
  contentVersion = 0,
  cursorToRestoreRef,
  onChange,
  onCursorChange,
  onSelectionContextMenu,
  assetBaseUri,
  documentDirUri,
  imagePathResolution,
  wikiLinkPromotion,
  resolveLocalAsset,
  editable = true,
  filePath,
  onSubstitutionDetected,
  sweepRef,
  annotationKinds,
  annotations,
  activeAnnotationId = null,
  scrollToAnnotation,
  onCreateAnnotation,
  onActivateAnnotation,
  annotationEditorHandleRef,
  annotationLogger,
}: EditorProps) {
  // Annotations are on only when the host configured at least one kind
  // (FR-004). Everything annotation-specific hangs off this flag, including
  // the dynamic import below — with no kinds, none of those modules is ever
  // loaded and no annotation command is registered.
  const annotationsEnabled = !!annotationKinds && Object.keys(annotationKinds).length > 0;

  // Derived, kind-agnostic affordance lists (FR-001/FR-004/FR-009/FR-010):
  // one entry per configured kind on each surface, label falling back to the
  // kind name (FR-003). Plain data only, so `Toolbar`/`SelectionContextMenuPlugin`
  // never need to know about annotation types.
  const toolbarAnnotationAffordances = useMemo(() => {
    if (!annotationKinds) return [];
    return Object.entries(annotationKinds)
      .filter(([, config]) => config.createAffordance?.surface === 'toolbar')
      .map(([kind, config]) => ({ kind, label: config.createAffordance?.label ?? kind }));
  }, [annotationKinds]);

  const contextMenuAnnotationAffordances = useMemo(() => {
    if (!annotationKinds) return [];
    return Object.entries(annotationKinds)
      .filter(([, config]) => config.createAffordance?.surface === 'contextMenu')
      .map(([kind, config]) => ({ kind, label: config.createAffordance?.label ?? kind }));
  }, [annotationKinds]);

  const offsetSpansRef = useRef<OffsetSpan[]>([]);
  const markdownTextRef = useRef<string>(initialContent);
  const [offsetsVersion, setOffsetsVersion] = useState(0);

  // Read inside `handleOffsets` rather than closed over, so the callback's
  // identity stays stable — it is an effect dependency in `InitializePlugin`
  // and `ExternalUpdatePlugin`, and a new identity there would re-run them.
  const annotationsEnabledRef = useRef(annotationsEnabled);
  annotationsEnabledRef.current = annotationsEnabled;

  /**
   * Records the offset table each (re)parse produces.
   *
   * The two ref writes are unconditional on purpose. `InitializePlugin` runs
   * its import exactly once, so gating span collection on `annotationsEnabled`
   * left a host that loads its kinds asynchronously with a permanently empty
   * table and silently placed nothing (an earlier review finding). The cost is
   * one small record per text node on a walk that already visits every node.
   *
   * The `offsetsVersion` bump, on the other hand, is a state update that
   * re-renders `Editor` — so it is gated. With annotations off nothing
   * consumes the version, and a host that never passes `annotationKinds`
   * should not re-render on every parse and external reload to maintain a
   * counter nobody reads (review finding, @handarbeit-pruefer). When kinds
   * arrive later, `AnnotationSurface` mounts and its placement effect runs
   * against the refs, which are already current.
   */
  const handleOffsets = useCallback((spans: OffsetSpan[], markdownText: string) => {
    offsetSpansRef.current = spans;
    markdownTextRef.current = markdownText;
    if (annotationsEnabledRef.current) setOffsetsVersion((v) => v + 1);
  }, []);

  const lastExternalLoadRef = useRef<number>(0);
  const currentContentRef = useRef<string>(initialContent);
  const debounceTimerRef = useRef<number | null>(null);
  const pendingEditorRef = useRef<LexicalEditor | null>(null);
  // Track when editor-initiated changes happen to prevent feedback loops
  const lastEditorChangeRef = useRef<number>(0);
  // Fallback ref for cursor restore when not provided
  const fallbackCursorRef = useRef<CursorState | null>(null);
  const effectiveCursorRef = cursorToRestoreRef ?? fallbackCursorRef;

  const assetContextValue = useMemo(
    () => createAssetContextValue({ assetBaseUri, documentDirUri, imagePathResolution, resolveLocalAsset }),
    [assetBaseUri, documentDirUri, imagePathResolution, resolveLocalAsset]
  );

  // Keep a ref to onChange so the unmount flush always calls the latest handler
  // without causing the effect to re-run (and spuriously flush) on re-renders.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Same reasoning as onChangeRef: flushPendingChange must stay a stable
  // ([]) callback, so the latest prop value is read through a ref rather than
  // closed over.
  const wikiLinkPromotionRef = useRef(wikiLinkPromotion);
  wikiLinkPromotionRef.current = wikiLinkPromotion;

  // Export pending editor state and propagate if changed.
  // Shared by the debounce timer callback and unmount flush.
  const flushPendingChange = useCallback(() => {
    const pendingEditor = pendingEditorRef.current;
    if (!pendingEditor) return;

    const timeSinceLoad = Date.now() - lastExternalLoadRef.current;
    if (timeSinceLoad < POST_LOAD_SUPPRESS_MS) return;

    const mdast = exportLexicalToMdast(pendingEditor, { wikiLinkPromotion: wikiLinkPromotionRef.current });
    const markdown = stringifyMarkdown(mdast);

    if (markdown !== currentContentRef.current) {
      currentContentRef.current = markdown;
      lastEditorChangeRef.current = Date.now();
      onChangeRef.current(markdown);
    }
  }, []);

  // Flush pending debounced change on unmount so we don't lose edits
  // (e.g. when switching from WYSIWYG to raw text view)
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        flushPendingChange();
      }
    };
  }, [flushPendingChange]);

  const handleChange = useCallback(
    (editorState: EditorState, editor: LexicalEditor) => {
      void editorState;
      // Skip changes that happen right after external content load
      // These are normalization diffs, not user edits
      const timeSinceExternalLoad = Date.now() - lastExternalLoadRef.current;
      if (timeSinceExternalLoad < POST_LOAD_SUPPRESS_MS) {
        return;
      }

      // Store the latest editor for debounced processing
      pendingEditorRef.current = editor;

      // Clear existing timer
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }

      // Debounce the expensive mdast conversion
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        flushPendingChange();
      }, DEBOUNCE_DELAY);
    },
    [flushPendingChange]
  );

  const initialConfig = {
    namespace: 'SlashMD',
    theme: editorTheme,
    nodes: editorNodes,
    onError: editorOnError,
    editable,
  };

  return (
    <AssetContext.Provider value={assetContextValue}>
      <LexicalComposer initialConfig={initialConfig}>
        <div className="editor-container">
          <div className="editor-inner">
            <RichTextPlugin
              contentEditable={
                <ContentEditable className="editor-input" aria-label="Markdown editor" />
              }
              placeholder={
                <div className="editor-placeholder">
                  Type '/' for commands...
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            <ListPlugin />
            <CheckListPlugin />
            <OrderedTaskListPlugin />
            <TabIndentationPlugin />
            <LinkPlugin />
            <TablePlugin />
            <CodeHighlightPlugin />
            <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
            <InitializePlugin
              content={initialContent}
              onOffsets={handleOffsets}
            />
            <EditablePlugin editable={editable} />
            {autoFocus && <AutoFocusPlugin />}
            <CursorTrackingPlugin onCursorChange={onCursorChange} />
            <CursorRestorePlugin
              contentVersion={contentVersion}
              cursorToRestoreRef={effectiveCursorRef}
            />
            <ExternalUpdatePlugin
              content={initialContent}
              lastExternalLoadRef={lastExternalLoadRef}
              currentContentRef={currentContentRef}
              lastEditorChangeRef={lastEditorChangeRef}
              onOffsets={handleOffsets}
            />
            <SlashMenuPlugin />
            <DragHandlePlugin />
            <MarkdownShortcutsPlugin />
            <TableActionsPlugin />
            <CodeBlockPlugin />
            <TogglePlugin />
            <ImagePlugin />
            <BlockClickPlugin />
            <LinkClickPlugin editable={editable} />
            <Toolbar annotationAffordances={toolbarAnnotationAffordances} />
            <SearchPlugin />
            <FrontmatterPlugin filePath={filePath} />
            <WikiLinkExistencePlugin />
            <WikiLinkFormatPlugin />
            <AnchorScrollPlugin />
            <SelectionContextMenuPlugin
              onSelectionContextMenu={onSelectionContextMenu}
              // Only kinds that actually ask for a context-menu affordance:
              // with none configured, or one on another surface, AnnotationPlugin
              // would decline the command anyway, and dispatching from here would
              // claim an entry point the kind never opted into.
              annotationAffordances={contextMenuAnnotationAffordances}
            />
            <CorrectionPanelPlugin />
            {onSubstitutionDetected && (
              <AmbientCorrectionPlugin
                onSubstitutionDetected={onSubstitutionDetected}
                sweepRef={sweepRef}
              />
            )}
            {annotationsEnabled && (
              <Suspense fallback={null}>
                <LazyAnnotationSurface
                  kinds={annotationKinds}
                  annotations={annotations ?? EMPTY_ANNOTATIONS}
                  activeAnnotationId={activeAnnotationId}
                  scrollToAnnotation={scrollToAnnotation}
                  onCreateAnnotation={onCreateAnnotation}
                  onActivateAnnotation={onActivateAnnotation}
                  editorHandleRef={annotationEditorHandleRef}
                  offsetSpansRef={offsetSpansRef}
                  markdownTextRef={markdownTextRef}
                  offsetsVersion={offsetsVersion}
                  logger={annotationLogger}
                  wikiLinkPromotion={wikiLinkPromotion}
                />
              </Suspense>
            )}
          </div>
        </div>
      </LexicalComposer>
    </AssetContext.Provider>
  );
}
