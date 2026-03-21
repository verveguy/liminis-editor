import { useCallback, useEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey, NodeKey } from 'lexical';
import { $isImageNode } from './ImageNode';
import { useAssetContext } from '../AssetContext';
import { DiagramContextMenu } from './DiagramContextMenu';

interface ImageComponentProps {
  src: string;
  alt: string;
  title?: string;
  width?: number;
  height?: number;
  nodeKey: NodeKey;
}

function isAbsoluteUrl(path: string): boolean {
  return (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('data:') ||
    path.startsWith('blob:') ||
    path.startsWith('vscode-webview-resource:')
  );
}

export function ImageComponent({
  src,
  alt,
  title,
  width,
  height,
  nodeKey,
}: ImageComponentProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const { resolveAssetPath, resolveLocalAsset } = useAssetContext();
  const imageRef = useRef<HTMLImageElement>(null);

  // Resolve the src path for display
  const resolvedSrc = resolveAssetPath(src);
  const [localDataUrl, setLocalDataUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (isAbsoluteUrl(resolvedSrc) || !resolveLocalAsset) {
      setLocalDataUrl(null);
      setLoadError(false);
      return;
    }

    let cancelled = false;
    setLoadError(false);
    resolveLocalAsset(resolvedSrc).then((dataUrl) => {
      if (!cancelled) {
        if (dataUrl) {
          setLocalDataUrl(dataUrl);
        } else {
          setLoadError(true);
        }
      }
    }).catch(() => {
      if (!cancelled) setLoadError(true);
    });
    return () => { cancelled = true; };
  }, [resolvedSrc, resolveLocalAsset]);

  // Use local data URL for relative paths, otherwise use the resolved src directly
  const displaySrc = isAbsoluteUrl(resolvedSrc) ? resolvedSrc : (localDataUrl ?? resolvedSrc);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 });

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY });
  }, []);

  const handleCopyImage = useCallback(async () => {
    const img = imageRef.current;
    if (!img) {
      setContextMenu((prev) => ({ ...prev, visible: false }));
      return;
    }
    try {
      // Use rendered size (not naturalWidth which can be 0 for viewBox-only SVGs)
      const scale = window.devicePixelRatio || 2;
      const rect = img.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (!w || !h) return;

      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => b ? resolve(b) : reject(new Error('toBlob failed')),
          'image/png'
        );
      });
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
    } catch (err) {
      console.error('Failed to copy image to clipboard:', err);
    }
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  const [isResizing, setIsResizing] = useState(false);
  const [isSelected, setIsSelected] = useState(false);
  const [currentWidth, setCurrentWidth] = useState<number | undefined>(width);
  const [naturalWidth, setNaturalWidth] = useState<number>(0);
  const [naturalHeight, setNaturalHeight] = useState<number>(0);

  // Track resize start position
  const resizeStartRef = useRef<{
    startX: number;
    startWidth: number;
    corner: string;
  } | null>(null);

  // Update current width when prop changes
  useEffect(() => {
    setCurrentWidth(width);
  }, [width]);

  // Handle image load to get natural dimensions
  const handleImageLoad = useCallback(() => {
    if (imageRef.current) {
      setNaturalWidth(imageRef.current.naturalWidth);
      setNaturalHeight(imageRef.current.naturalHeight);
    }
  }, []);

  // Handle click to select image
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsSelected(true);
  }, []);

  // Handle click outside to deselect
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (imageRef.current && !imageRef.current.parentElement?.contains(e.target as Node)) {
        setIsSelected(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle resize start
  const handleResizeStart = useCallback((e: React.MouseEvent, corner: string) => {
    e.preventDefault();
    e.stopPropagation();

    const startWidth = currentWidth || imageRef.current?.offsetWidth || naturalWidth;

    resizeStartRef.current = {
      startX: e.clientX,
      startWidth,
      corner,
    };

    setIsResizing(true);
  }, [currentWidth, naturalWidth]);

  // Use refs for values accessed in event handlers to avoid effect re-registration
  const currentWidthRef = useRef(currentWidth);
  currentWidthRef.current = currentWidth;
  const naturalWidthRef = useRef(naturalWidth);
  naturalWidthRef.current = naturalWidth;
  const naturalHeightRef = useRef(naturalHeight);
  naturalHeightRef.current = naturalHeight;

  // Handle resize move
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeStartRef.current) return;

      const { startX, startWidth, corner } = resizeStartRef.current;
      let deltaX = e.clientX - startX;

      // For left corners, invert the delta
      if (corner === 'nw' || corner === 'sw') {
        deltaX = -deltaX;
      }

      const newWidth = Math.max(50, startWidth + deltaX);
      setCurrentWidth(newWidth);
    };

    const handleMouseUp = () => {
      const width = currentWidthRef.current;
      const natWidth = naturalWidthRef.current;
      const natHeight = naturalHeightRef.current;

      if (resizeStartRef.current && width) {
        // Calculate proportional height
        const aspectRatio = natHeight / natWidth;
        const newHeight = Math.round(width * aspectRatio);

        // Update the node with new dimensions
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if ($isImageNode(node)) {
            node.setWidth(width);
            node.setHeight(newHeight);
          }
        });
      }

      resizeStartRef.current = null;
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, editor, nodeKey]);

  // Calculate display dimensions
  const displayWidth = currentWidth || width;
  const displayHeight = displayWidth && naturalWidth && naturalHeight
    ? Math.round(displayWidth * (naturalHeight / naturalWidth))
    : height;

  // Show placeholder while loading local assets
  if (!isAbsoluteUrl(resolvedSrc) && resolveLocalAsset && !localDataUrl && !loadError) {
    return (
      <div className="image-wrapper">
        <div className="image-placeholder" style={{ padding: '1em', opacity: 0.5 }}>
          Loading image…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="image-wrapper">
        <div className="image-placeholder" style={{ padding: '1em', opacity: 0.5 }}>
          Image not found: {src}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`image-wrapper ${isSelected ? 'selected' : ''} ${isResizing ? 'resizing' : ''} ${!displayWidth ? 'no-dimensions' : ''}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <img
        ref={imageRef}
        src={displaySrc}
        alt={alt}
        title={title}
        draggable={false}
        onLoad={handleImageLoad}
        style={{
          width: displayWidth ? `${displayWidth}px` : '100%',
          height: displayHeight ? `${displayHeight}px` : undefined,
        }}
      />
      {isSelected && (
        <>
          <div
            className="image-resize-handle nw"
            onMouseDown={(e) => handleResizeStart(e, 'nw')}
          />
          <div
            className="image-resize-handle ne"
            onMouseDown={(e) => handleResizeStart(e, 'ne')}
          />
          <div
            className="image-resize-handle sw"
            onMouseDown={(e) => handleResizeStart(e, 'sw')}
          />
          <div
            className="image-resize-handle se"
            onMouseDown={(e) => handleResizeStart(e, 'se')}
          />
        </>
      )}
      {isSelected && displayWidth && (
        <div className="image-size-badge">
          {displayWidth} × {displayHeight}
        </div>
      )}
      <DiagramContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        onCopyImage={handleCopyImage}
        onClose={() => setContextMenu((prev) => ({ ...prev, visible: false }))}
      />
    </div>
  );
}
