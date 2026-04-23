import { useCallback, useEffect, useState, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey, $getNearestNodeFromDOMNode, $getSelection, $isRangeSelection, COMMAND_PRIORITY_EDITOR, createCommand, LexicalCommand } from 'lexical';
import { ImageModal, ImageData } from './ImageModal';
import { $createImageNode } from './nodes';
import { writeAsset, addMessageHandler } from '../../messaging-electron';
import type { HostToUIMessage } from '../../types';

// eslint-disable-next-line react-refresh/only-export-components
export const INSERT_IMAGE_COMMAND: LexicalCommand<void> = createCommand('INSERT_IMAGE_COMMAND');

const HANDLED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB

type PendingItem = { alt: string; dropTargetKey: string | null };

export function ImagePlugin() {
  const [editor] = useLexicalComposerContext();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const pendingQueueRef = useRef<PendingItem[]>([]);

  // Listen for INSERT_IMAGE_COMMAND
  useEffect(() => {
    return editor.registerCommand(
      INSERT_IMAGE_COMMAND,
      () => {
        setIsModalOpen(true);
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor]);

  // Listen for ASSET_WRITTEN messages
  useEffect(() => {
    const removeHandler = addMessageHandler((message: HostToUIMessage) => {
      if (message.type === 'ASSET_WRITTEN' && pendingQueueRef.current.length > 0) {
        const item = pendingQueueRef.current.shift()!;
        const { alt, dropTargetKey } = item;
        const relPath = message.relPath;
        const webviewUri = message.webviewUri;

        editor.update(() => {
          if (dropTargetKey !== null) {
            const node = $getNodeByKey(dropTargetKey);
            if (node) node.selectEnd();
          }
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            const imageNode = $createImageNode(relPath, alt, { displaySrc: webviewUri });
            selection.insertNodes([imageNode]);
          }
        });
      } else if (message.type === 'ASSET_WRITE_FAILED' && pendingQueueRef.current.length > 0) {
        pendingQueueRef.current.shift();
      }
    });

    return removeHandler;
  }, [editor]);

  // Clipboard paste interceptor: captures image/* paste events before Lexical sees them
  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;

      let imageFile: File | null = null;
      for (const item of items) {
        if (item.kind === 'file' && HANDLED_IMAGE_TYPES.includes(item.type)) {
          const file = item.getAsFile();
          if (file) {
            imageFile = file;
            break;
          }
        }
      }

      if (!imageFile) return;

      // Suppress the paste event whenever an image is present — even if oversized —
      // so Lexical's default handler never inserts a broken blob URL.
      e.preventDefault();
      e.stopPropagation();

      if (imageFile.size > MAX_IMAGE_SIZE) {
        console.warn('ImagePlugin: pasted image exceeds 5 MB limit, ignoring');
        return;
      }

      const file = imageFile;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUri = reader.result as string;
        const rawExt = file.type.split('/')[1];
        const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
        const suggestedName = `pasted-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        pendingQueueRef.current.push({ alt: '', dropTargetKey: null });
        writeAsset(dataUri, suggestedName);
      };
      reader.readAsDataURL(file);
    }

    rootElement.addEventListener('paste', handlePaste, { capture: true });
    return () => rootElement.removeEventListener('paste', handlePaste, { capture: true });
  }, [editor]);

  // Drag-drop interceptor: handles external image file drops
  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    function handleDragOver(e: DragEvent) {
      const items = e.dataTransfer?.items;
      if (!items) return;
      let hasImage = false;
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && HANDLED_IMAGE_TYPES.includes(item.type)) {
          hasImage = true;
          break;
        }
      }
      if (hasImage) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      }
    }

    function handleDrop(e: DragEvent) {
      const files = Array.from(e.dataTransfer?.files ?? []);
      const imageFile = files.find(f => HANDLED_IMAGE_TYPES.includes(f.type));
      if (!imageFile) return;

      e.preventDefault();
      e.stopPropagation();

      if (imageFile.size > MAX_IMAGE_SIZE) {
        console.warn('ImagePlugin: dropped image exceeds 5 MB limit, ignoring');
        return;
      }

      // Attempt to find the Lexical node key at the drop position
      let dropTargetKey: string | null = null;
      if (typeof document.caretRangeFromPoint === 'function') {
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (range) {
          const domNode = range.startContainer instanceof Element
            ? range.startContainer
            : range.startContainer.parentElement;
          if (domNode) {
            editor.getEditorState().read(() => {
              const lexNode = $getNearestNodeFromDOMNode(domNode);
              if (lexNode) dropTargetKey = lexNode.getKey();
            });
          }
        }
      }

      const file = imageFile;
      const dot = file.name.lastIndexOf('.');
      const nameBase = dot > 0 ? file.name.slice(0, dot) : file.name;
      const nameExt = dot > 0 ? file.name.slice(dot) : '';
      const sanitizedName = nameBase.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 95) + nameExt.slice(0, 10);
      const reader = new FileReader();
      reader.onload = () => {
        const dataUri = reader.result as string;
        pendingQueueRef.current.push({ alt: '', dropTargetKey });
        writeAsset(dataUri, sanitizedName);
      };
      reader.readAsDataURL(file);
    }

    rootElement.addEventListener('dragover', handleDragOver);
    rootElement.addEventListener('drop', handleDrop);
    return () => {
      rootElement.removeEventListener('dragover', handleDragOver);
      rootElement.removeEventListener('drop', handleDrop);
    };
  }, [editor]);

  const handleClose = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleInsert = useCallback((data: ImageData) => {
    if (data.isLocal && data.dataUri) {
      pendingQueueRef.current.push({ alt: data.alt, dropTargetKey: null });
      writeAsset(data.dataUri);
    } else {
      // Direct URL — insert immediately without going through the asset pipeline
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          const imageNode = $createImageNode(data.src, data.alt);
          selection.insertNodes([imageNode]);
        }
      });
    }
  }, [editor]);

  return (
    <ImageModal
      isOpen={isModalOpen}
      onClose={handleClose}
      onInsert={handleInsert}
    />
  );
}
