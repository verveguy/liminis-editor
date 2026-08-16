import { useCallback, useEffect, useMemo, useState, useRef, type MutableRefObject } from 'react';
import { Editor } from './editor';
import type { SelectionContextMenuEvent } from './editor/SelectionContextMenuPlugin';
import type { SweepFn } from './editor/AmbientCorrectionPlugin';
import type { AnnotationCreateEvent } from './editor/AnnotationPlugin';
import type { Annotation, AnnotationEditorHandle, AnnotationKindConfigs } from '../annotations/types';
import type { WikiLinkPromotionMode } from './mapper/lexicalToMdast';
import type { HostToUIMessage, SlashMDSettings, TextEdit, ThemeOverrides } from '../types';
import { useEditorHost } from '../host/context';
import { useHostMessages } from '../host/messages';

// Cursor state with fuzzy anchoring for robust restoration
export interface CursorState {
  // Absolute offset (fallback)
  offset: number;
  // Text before cursor for fuzzy matching (up to 50 chars)
  contextBefore: string;
  // Text after cursor for fuzzy matching (up to 50 chars)
  contextAfter: string;
}

// Simple diff algorithm to find the changed region between two strings
function computeMinimalEdits(oldText: string, newText: string): TextEdit[] {
  if (oldText === newText) return [];

  // Find common prefix
  let prefixLen = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (but don't overlap with prefix)
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  // Calculate the changed region
  const start = prefixLen;
  const end = oldText.length - suffixLen;
  const newTextContent = newText.slice(prefixLen, newText.length - suffixLen);

  return [{
    start,
    end,
    newText: newTextContent,
  }];
}

interface AppProps {
  /** When false, the editor is read-only */
  editable?: boolean;
  /**
   * Whether the editor takes focus shortly after mounting. Defaults to
   * `false`; see `Editor`'s own prop for when to opt in.
   */
  autoFocus?: boolean;
  /** Content to display - when provided, used instead of IPC */
  content?: string;
  /** Called when content changes */
  onChange?: (content: string) => void;
  /** Path to the file being edited (used for file-type-specific UI like .mdc) */
  filePath?: string;
  /** Resolve a workspace-relative file path to a data URL for display */
  resolveLocalAsset?: (relativePath: string) => Promise<string | null>;
  /**
   * Whether an untitled relative link is promoted to wiki-link syntax on
   * export. Defaults to `'promote'`, today's only behavior. Unlike
   * `imagePathResolution`, this is a direct prop rather than sourced from IPC
   * `SlashMDSettings` — `App` also supports a non-IPC "inline" mode (`content`/
   * `onChange` props), where `settings` stays null forever, and a
   * settings-only path would be unreachable there (liminis#951).
   */
  wikiLinkPromotion?: WikiLinkPromotionMode;
  /** Called when user right-clicks a text selection and chooses a context menu action */
  onSelectionContextMenu?: (event: SelectionContextMenuEvent) => void;
  /** Called when a single-word substitution is detected after a debounce window. */
  onSubstitutionDetected?: (oldTerm: string, newTerm: string) => void;
  /** Ref populated with a sweep function by AmbientCorrectionPlugin when active. */
  sweepRef?: MutableRefObject<SweepFn | null>;
  /**
   * Annotation kind configuration (ADR-077), forwarded to <Editor>. Absent
   * means the annotation mechanism stays off entirely.
   */
  annotationKinds?: AnnotationKindConfigs;
  annotations?: Annotation[];
  activeAnnotationId?: string | null;
  scrollToAnnotation?: { id: string; nonce: number } | null;
  onCreateAnnotation?: (event: AnnotationCreateEvent) => void;
  onActivateAnnotation?: (id: string) => void;
  annotationEditorHandleRef?: MutableRefObject<AnnotationEditorHandle | null>;
  annotationLogger?: { warn: (message: string, ...args: unknown[]) => void };
  /** Override className on the root div (default: "min-h-screen p-0"). */
  className?: string;
}

export function App({ editable = true, autoFocus = false, content: propContent, onChange: propOnChange, filePath, resolveLocalAsset, wikiLinkPromotion, onSelectionContextMenu, onSubstitutionDetected, sweepRef, annotationKinds, annotations, activeAnnotationId, scrollToAnnotation, onCreateAnnotation, onActivateAnnotation, annotationEditorHandleRef, annotationLogger, className = 'min-h-screen p-0' }: AppProps) {
  const { bridge, logger } = useEditorHost();
  const log = useMemo(() => logger('slashmd/App'), [logger]);
  const { requestInit, applyTextEdits } = useHostMessages();
  const [internalContent, setInternalContent] = useState<string | null>(null);
  const [settings, setSettings] = useState<SlashMDSettings | null>(null);
  const [assetBaseUri, setAssetBaseUri] = useState<string | undefined>(undefined);
  const [ipcDocumentDirUri, setIpcDocumentDirUri] = useState<string | undefined>(undefined);

  // Derive documentDirUri from filePath when not provided via IPC (inline mode).
  // This ensures relative image paths like "image.svg" resolve relative to the document's directory.
  const documentDirUri = useMemo(() => {
    if (ipcDocumentDirUri) return ipcDocumentDirUri;
    if (!filePath) return undefined;
    const lastSlash = filePath.lastIndexOf('/');
    return lastSlash >= 0 ? filePath.slice(0, lastSlash + 1) : '';
  }, [ipcDocumentDirUri, filePath]);
  const [themeOverrides, setThemeOverrides] = useState<ThemeOverrides | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const pendingAssetCallback = useRef<((relPath: string) => void) | null>(null);
  // Track the last known document content for diff computation
  const lastDocumentContent = useRef<string>('');
  
  // Cursor state - persists across content reloads
  const cursorStateRef = useRef<CursorState | null>(null);
  // Counter to trigger cursor restoration after content changes
  const [contentVersion, setContentVersion] = useState(0);
  
  // Use prop content if provided, otherwise use internal state
  const content = propContent !== undefined ? propContent : internalContent;
  
  // Track when editor-initiated changes happen to skip cursor restoration
  const lastEditorChangeTime = useRef<number>(0);
  
  // Track prop content changes to update lastDocumentContent and trigger cursor restoration
  // BUT only increment contentVersion for EXTERNAL changes (file switch, reload)
  // NOT for changes that came from the editor itself (typing)
  const prevPropContent = useRef<string | undefined>(propContent);
  useEffect(() => {
    if (propContent !== undefined && propContent !== prevPropContent.current) {
      const timeSinceEditorChange = Date.now() - lastEditorChangeTime.current;
      const isEditorInitiated = timeSinceEditorChange < 500;
      
      log.info('Content prop changed', { 
        chars: propContent.length,
        isEditorInitiated,
        timeSinceEditorChange 
      });
      
      lastDocumentContent.current = propContent;
      
      // Only increment contentVersion for external changes (triggers cursor restore)
      // Skip for editor-initiated changes (would mess up cursor during typing)
      if (!isEditorInitiated) {
        setContentVersion((v) => v + 1);
      }
    }
    prevPropContent.current = propContent;
  }, [propContent, log]);

  useEffect(() => {
    log.info('Setting up message handler');
    const removeHandler = bridge.addMessageHandler((message: HostToUIMessage) => {
      log.debug('Handling message', message.type);
      switch (message.type) {
        case 'DOC_INIT':
          // Only use IPC content if not controlled by prop
          if (propContent === undefined) {
            log.info('DOC_INIT', { chars: message.text?.length });
            lastDocumentContent.current = message.text;
            setInternalContent(message.text);
          }
          setSettings(message.settings);
          setAssetBaseUri(message.assetBaseUri);
          setIpcDocumentDirUri(message.documentDirUri);
          setThemeOverrides(message.themeOverrides);
          break;

        case 'DOC_CHANGED':
          // Only use IPC content if not controlled by prop
          if (propContent === undefined) {
            log.debug('DOC_CHANGED', { chars: message.text?.length });
            // Skip if content matches what we already have (our own save echoing back)
            if (message.text === lastDocumentContent.current) {
              log.debug('DOC_CHANGED skipped - content unchanged');
              return;
            }
            log.info('DOC_CHANGED - content differs, will restore cursor', {
              cursorOffset: cursorStateRef.current?.offset,
            });
            lastDocumentContent.current = message.text;
            setInternalContent(message.text);
            // Increment version to signal Editor to restore cursor
            setContentVersion((v) => v + 1);
          }
          break;

        case 'SETTINGS_CHANGED':
          setSettings(message.settings);
          setThemeOverrides(message.themeOverrides);
          break;

        case 'ASSET_WRITTEN':
          if (pendingAssetCallback.current) {
            pendingAssetCallback.current(message.relPath);
            pendingAssetCallback.current = null;
          }
          break;

        case 'ERROR':
          log.warn('ERROR', message.message);
          setError(message.message);
          setTimeout(() => setError(null), 5000);
          break;
      }
    });

    // Only request init if not controlled by prop
    if (propContent === undefined) {
      requestInit();
    }

    return removeHandler;
  }, [propContent, bridge, requestInit, log]);

  // Apply theme overrides as CSS variables
  useEffect(() => {
    if (!themeOverrides) return;

    const root = document.documentElement;
    for (const [property, value] of Object.entries(themeOverrides)) {
      root.style.setProperty(property, value);
    }
  }, [themeOverrides]);

  const handleChange = useCallback((markdown: string) => {
    // Calculate diff and send minimal edits
    const edits = computeMinimalEdits(lastDocumentContent.current, markdown);
    if (edits.length > 0) {
      // This can happen even without typing if the editor normalizes/serializes markdown
      // (e.g., whitespace normalization). Logging helps verify what's being changed.
      log.debug('onChange -> applyTextEdits', {
        edits: edits.map((e) => ({ start: e.start, end: e.end, newTextLen: e.newText.length })),
        beforeLen: lastDocumentContent.current.length,
        afterLen: markdown.length,
      });
      lastDocumentContent.current = markdown;
      applyTextEdits(edits, 'typing');

      // Mark this as an editor-initiated change BEFORE calling propOnChange
      // This prevents the prop change from triggering cursor restoration
      lastEditorChangeTime.current = Date.now();

      // Call prop onChange if provided
      propOnChange?.(markdown);
    }
  }, [propOnChange, applyTextEdits, log]);

  // Track cursor position whenever it changes
  const handleCursorChange = useCallback((cursor: CursorState) => {
    cursorStateRef.current = cursor;
  }, []);

  if (content === null) {
    return (
      <div className="flex items-center justify-center gap-3 min-h-screen text-[var(--vscode-foreground)] opacity-70">
        <div className="loading-spinner" />
        <span>Loading document...</span>
      </div>
    );
  }

  return (
    <div className={className}>
      {error && (
        <div className="fixed top-0 left-0 right-0 px-4 py-2 bg-red-500 text-white text-center z-[1000]" role="alert">
          {error}
        </div>
      )}
      <Editor
        initialContent={content}
        autoFocus={autoFocus}
        contentVersion={contentVersion}
        cursorToRestoreRef={cursorStateRef}
        onChange={handleChange}
        onCursorChange={handleCursorChange}
        assetBaseUri={assetBaseUri}
        documentDirUri={documentDirUri}
        imagePathResolution={settings?.imagePathResolution ?? 'document'}
        wikiLinkPromotion={wikiLinkPromotion}
        resolveLocalAsset={resolveLocalAsset}
        editable={editable}
        filePath={filePath}
        onSelectionContextMenu={onSelectionContextMenu}
        onSubstitutionDetected={onSubstitutionDetected}
        sweepRef={sweepRef}
        annotationKinds={annotationKinds}
        annotations={annotations}
        activeAnnotationId={activeAnnotationId}
        scrollToAnnotation={scrollToAnnotation}
        onCreateAnnotation={onCreateAnnotation}
        onActivateAnnotation={onActivateAnnotation}
        annotationEditorHandleRef={annotationEditorHandleRef}
        annotationLogger={annotationLogger}
      />
    </div>
  );
}
