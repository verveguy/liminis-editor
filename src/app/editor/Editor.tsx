import { useCallback, useEffect, useRef, useMemo, type MutableRefObject } from 'react';
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
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListItemNode } from '@lexical/list';
import { CodeNode, CodeHighlightNode, $isCodeNode } from '@lexical/code';
import { registerCodeHighlighting } from '@lexical/code-prism';
import { AutoLinkNode } from '@lexical/link';
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table';
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
import {
  CalloutNode,
  ToggleContainerNode,
  ToggleTitleNode,
  ToggleContentNode,
  ImageNode,
  HorizontalRuleNode,
  EquationNode,
  MermaidNode,
  C4Node,
  FrontmatterNode,
  FootnoteNode,
  CustomLinkNode,
  CustomListNode,
} from './nodes';
import { importMarkdownToLexical, importMarkdownToLexicalInEditorState } from '../mapper/mdastToLexical';
import { exportLexicalToMdast } from '../mapper/lexicalToMdast';
import { parseMarkdown } from '../../markdown/parse';
import { stringifyMarkdown } from '../../markdown/stringify';
import type { ImagePathResolution } from '../../types';
import type { CursorState } from '../App';

interface EditorProps {
  initialContent: string;
  contentVersion?: number;
  /** Ref to cursor state - read inside effects, not during render */
  cursorToRestoreRef?: React.RefObject<CursorState | null>;
  onChange: (markdown: string) => void;
  onCursorChange?: (cursor: CursorState) => void;
  onSelectionContextMenu?: (event: SelectionContextMenuEvent) => void;
  assetBaseUri?: string;
  documentDirUri?: string;
  imagePathResolution?: ImagePathResolution;
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

const editorNodes = [
  HeadingNode,
  QuoteNode,
  CustomListNode,  // Replaces ListNode - uses same type 'list' but carries spread (loose/tight) state
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  CustomLinkNode,  // Replaces LinkNode - uses same type 'link' but renders data-href
  AutoLinkNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  CalloutNode,
  ToggleContainerNode,
  ToggleTitleNode,
  ToggleContentNode,
  ImageNode,
  HorizontalRuleNode,
  EquationNode,
  MermaidNode,
  C4Node,
  FrontmatterNode,
  FootnoteNode,
];

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
function InitializePlugin({ content }: { content: string }) {
  const [editor] = useLexicalComposerContext();
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    if (content) {
      const { root } = parseMarkdown(content);
      importMarkdownToLexical(editor, root);
    }
  }, [editor, content]);

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
}: {
  content: string;
  lastExternalLoadRef: React.MutableRefObject<number>;
  currentContentRef: React.MutableRefObject<string>;
  lastEditorChangeRef: React.MutableRefObject<number>;
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
      editor.update(
        () => {
          importMarkdownToLexicalInEditorState(root);
        },
        { discrete: true }
      );
    });
  }, [editor, content, lastExternalLoadRef, currentContentRef, lastEditorChangeRef]);

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
  contentVersion = 0,
  cursorToRestoreRef,
  onChange,
  onCursorChange,
  onSelectionContextMenu,
  assetBaseUri,
  documentDirUri,
  imagePathResolution,
  resolveLocalAsset,
  editable = true,
  filePath,
  onSubstitutionDetected,
  sweepRef,
}: EditorProps) {
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

  // Export pending editor state and propagate if changed.
  // Shared by the debounce timer callback and unmount flush.
  const flushPendingChange = useCallback(() => {
    const pendingEditor = pendingEditorRef.current;
    if (!pendingEditor) return;

    const timeSinceLoad = Date.now() - lastExternalLoadRef.current;
    if (timeSinceLoad < POST_LOAD_SUPPRESS_MS) return;

    const mdast = exportLexicalToMdast(pendingEditor);
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
        <div className="relative max-w-[800px] ml-5 mr-1 pl-6 pr-6">
          <div className="editor-inner relative">
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
            <TabIndentationPlugin />
            <LinkPlugin />
            <TablePlugin />
            <CodeHighlightPlugin />
            <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
            <InitializePlugin content={initialContent} />
            <EditablePlugin editable={editable} />
            <AutoFocusPlugin />
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
            <Toolbar />
            <SearchPlugin />
            <FrontmatterPlugin filePath={filePath} />
            <WikiLinkExistencePlugin />
            <WikiLinkFormatPlugin />
            <AnchorScrollPlugin />
            <SelectionContextMenuPlugin onSelectionContextMenu={onSelectionContextMenu} />
            <CorrectionPanelPlugin />
            {onSubstitutionDetected && (
              <AmbientCorrectionPlugin
                onSubstitutionDetected={onSubstitutionDetected}
                sweepRef={sweepRef}
              />
            )}
          </div>
        </div>
      </LexicalComposer>
    </AssetContext.Provider>
  );
}
