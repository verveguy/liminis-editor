/**
 * Covers #952: `crossOrigin="anonymous"` on the rendered `<img>` made display of
 * every remote image depend on the host sending `Access-Control-Allow-Origin`,
 * breaking ordinary hosts (e.g. shields.io badges) that don't send it. The fix
 * removes the attribute entirely and, since that makes a cross-origin `<img>`
 * taint the copy-to-clipboard canvas, routes the existing tainted-canvas catch
 * through `notifyError` so the failure is user-visible instead of console-only.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { EditorHostProvider } from '../../../host/context';
import { AssetContext, createAssetContextValue } from '../AssetContext';
import { ImageComponent } from './ImageComponent';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';

function mountImage(
  props: Partial<React.ComponentProps<typeof ImageComponent>>,
  options: { notifyError?: (message: string, description?: string) => void; resolveLocalAsset?: (path: string) => Promise<string | null> } = {}
) {
  const assetValue = createAssetContextValue({ resolveLocalAsset: options.resolveLocalAsset });
  return render(
    <EditorHostProvider services={{ notifyError: options.notifyError }}>
      <LexicalComposer
        initialConfig={{
          namespace: 'image-component-test',
          nodes: editorNodes,
          onError: (e) => {
            throw e;
          },
        }}
      >
        <AssetContext.Provider value={assetValue}>
          <ImageComponent
            src="placeholder.png"
            alt="alt text"
            nodeKey="fake-node-key"
            {...props}
          />
        </AssetContext.Provider>
      </LexicalComposer>
    </EditorHostProvider>
  );
}

/** Give the rendered `<img>` a non-zero rendered size so handleCopyImage proceeds. */
function stubImageSize(img: HTMLImageElement, size = 100) {
  img.getBoundingClientRect = () => ({
    width: size,
    height: size,
    top: 0,
    left: 0,
    right: size,
    bottom: size,
    x: 0,
    y: 0,
    toJSON() {},
  });
}

async function triggerCopyImage(container: HTMLElement) {
  const wrapper = container.querySelector('.image-wrapper')!;
  await act(async () => {
    fireEvent.contextMenu(wrapper);
  });
  const copyButton = await screen.findByText('Copy image to clipboard');
  await act(async () => {
    fireEvent.click(copyButton);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ImageComponent crossOrigin (FR-001/FR-002)', () => {
  it('renders a remote https src without a crossOrigin attribute', () => {
    const { container } = mountImage({ src: 'https://img.shields.io/badge/build-passing-green' });
    const img = container.querySelector('img')!;
    expect(img.getAttribute('crossorigin')).toBeNull();
    expect(img.src).toContain('img.shields.io');
  });

  it('renders a data: URL src without a crossOrigin attribute (FR-003, unaffected)', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const { container } = mountImage({ src: dataUrl });
    const img = container.querySelector('img')!;
    expect(img.getAttribute('crossorigin')).toBeNull();
    expect(img.src).toBe(dataUrl);
  });

  it('renders a resolved local/relative asset without a crossOrigin attribute (FR-003, unaffected)', async () => {
    const localDataUrl = 'data:image/png;base64,localasset';
    const resolveLocalAsset = vi.fn(async () => localDataUrl);
    const { container } = mountImage(
      { src: 'images/photo.png' },
      { resolveLocalAsset }
    );

    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    const img = container.querySelector('img')!;
    expect(resolveLocalAsset).toHaveBeenCalled();
    expect(img.getAttribute('crossorigin')).toBeNull();
    expect(img.src).toBe(localDataUrl);
  });
});

describe('ImageComponent copy-to-clipboard (FR-004/FR-005)', () => {
  it('surfaces a tainted-canvas failure via notifyError instead of failing silently', async () => {
    const notifyError = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Simulate the tainted-canvas SecurityError a real browser throws when a
    // cross-origin (no-crossOrigin-attribute) <img> is drawn onto a canvas
    // whose toBlob()/getImageData() is then called. happy-dom doesn't enforce
    // real cross-origin canvas tainting, so this mocks the code path rather
    // than exercising true browser CORS semantics (see Fabrik Research notes).
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      scale: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(null);
    });

    const { container } = mountImage(
      { src: 'https://example.com/remote-image.png' },
      { notifyError }
    );
    const img = container.querySelector('img')!;
    stubImageSize(img);

    await triggerCopyImage(container);

    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect(notifyError).toHaveBeenCalledWith('Failed to copy image', 'toBlob failed');
    expect(consoleErrorSpy).toHaveBeenCalled();
    // The context menu closes regardless of outcome.
    expect(screen.queryByText('Copy image to clipboard')).toBeNull();
  });

  it('still succeeds for a data: URL image (no regression, FR-005)', async () => {
    const notifyError = vi.fn();
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { ...navigator.clipboard, write: clipboardWrite },
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      scale: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['fake-png-bytes'], { type: 'image/png' }));
    });

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const { container } = mountImage({ src: dataUrl }, { notifyError });
    const img = container.querySelector('img')!;
    stubImageSize(img);

    await triggerCopyImage(container);

    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1));
    expect(notifyError).not.toHaveBeenCalled();
  });
});
