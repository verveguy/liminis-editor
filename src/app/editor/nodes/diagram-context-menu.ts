/**
 * Shared "Copy image to clipboard" for diagram nodes (C4, Mermaid).
 *
 * Converts the diagram SVG to a high-res PNG and writes it to the
 * clipboard. Uses devicePixelRatio for crisp retina output.
 */

/**
 * Find the SVG element within a container.
 * Checks both direct children and shadow DOM.
 */
function findSvgElement(container: HTMLElement): SVGSVGElement | null {
  // Direct child SVG (React renderer — C4)
  // Prefer svg[data-diagram] to skip toolbar icon SVGs (Lucide),
  // then fall back to any svg
  const directSvg = container.querySelector<SVGSVGElement>('svg[data-diagram]')
    ?? container.querySelector('svg');
  if (directSvg) return directSvg;

  // Shadow DOM SVG (Mermaid renderer)
  const shadowRoot = container.shadowRoot;
  if (shadowRoot) {
    const shadowSvg = shadowRoot.querySelector('svg');
    if (shadowSvg) return shadowSvg;
  }

  return null;
}

/**
 * Serialize an SVG element to a standalone SVG string with xmlns.
 */
function svgToString(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(clone);
}

/**
 * Convert an SVG element to a PNG blob via off-screen canvas.
 */
async function svgToPngBlob(svg: SVGSVGElement, scale?: number): Promise<Blob> {
  const effectiveScale = scale ?? (window.devicePixelRatio || 2);
  const width = svg.width.baseVal.value || svg.getBoundingClientRect().width;
  const height = svg.height.baseVal.value || svg.getBoundingClientRect().height;

  const svgString = svgToString(svg);
  // Use a data URL instead of blob URL to avoid tainting the canvas
  const svgBytes = new TextEncoder().encode(svgString);
  let binary = '';
  for (const byte of svgBytes) {
    binary += String.fromCharCode(byte);
  }
  const url = 'data:image/svg+xml;base64,' + btoa(binary);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * effectiveScale);
  canvas.height = Math.round(height * effectiveScale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(effectiveScale, effectiveScale);

  // Theme-aware background
  const isDark = document.documentElement.classList.contains('dark');
  ctx.fillStyle = isDark ? '#131619' : '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });

  ctx.drawImage(img, 0, 0, width, height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('toBlob failed')),
      'image/png'
    );
  });
}

/**
 * Copy the diagram to the clipboard as a high-res PNG.
 * Returns true on success, false on failure.
 */
export async function copyDiagramToClipboard(container: HTMLElement): Promise<boolean> {
  const svg = findSvgElement(container);
  if (!svg) return false;

  try {
    const pngBlob = await svgToPngBlob(svg);

    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': pngBlob })
    ]);
    return true;
  } catch (err) {
    console.error('Failed to copy diagram to clipboard:', err);
    return false;
  }
}
