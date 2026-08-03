import { createContext, useContext } from 'react';
import type { ImagePathResolution } from '../../types';

interface AssetContextValue {
  assetBaseUri: string | undefined;
  documentDirUri: string | undefined;
  imagePathResolution: ImagePathResolution;
  resolveAssetPath: (path: string) => string;
  /** Resolve a workspace-relative file path to a data URL for display */
  resolveLocalAsset?: (relativePath: string) => Promise<string | null>;
}

export const AssetContext = createContext<AssetContextValue>({
  assetBaseUri: undefined,
  documentDirUri: undefined,
  imagePathResolution: 'document',
  resolveAssetPath: (path) => path,
});

export function useAssetContext() {
  return useContext(AssetContext);
}

/**
 * Normalize a relative path by resolving . and .. segments
 * Examples:
 *   "./images/photo.png" -> "images/photo.png"
 *   "../assets/image.png" -> "../assets/image.png" (kept as-is, resolved by browser)
 *   "assets/../images/photo.png" -> "images/photo.png"
 */
function normalizePath(path: string): string {
  // Remove leading ./ (current directory reference)
  const normalized = path.replace(/^\.\//, '');

  // Split into segments and resolve . and ..
  const segments = normalized.split('/');
  const result: string[] = [];

  for (const segment of segments) {
    if (segment === '.' || segment === '') {
      // Skip current directory references and empty segments
      continue;
    } else if (segment === '..') {
      // Go up one directory if possible
      if (result.length > 0 && result[result.length - 1] !== '..') {
        result.pop();
      } else {
        // Keep leading .. segments (they go above the base)
        result.push(segment);
      }
    } else {
      result.push(segment);
    }
  }

  return result.join('/');
}

export interface AssetContextOptions {
  assetBaseUri?: string;
  documentDirUri?: string;
  imagePathResolution?: ImagePathResolution;
  /** Resolve a workspace-relative file path to a data URL for display */
  resolveLocalAsset?: (relativePath: string) => Promise<string | null>;
}

export function createAssetContextValue(options: AssetContextOptions): AssetContextValue {
  const {
    assetBaseUri,
    documentDirUri,
    imagePathResolution = 'document',
    resolveLocalAsset,
  } = options;

  return {
    assetBaseUri,
    documentDirUri,
    imagePathResolution,
    resolveLocalAsset,
    resolveAssetPath: (path: string) => {
      // If it's already an absolute URL (http, https, vscode-webview-resource, data), return as-is
      if (
        path.startsWith('http://') ||
        path.startsWith('https://') ||
        path.startsWith('vscode-webview-resource:') ||
        path.startsWith('data:')
      ) {
        return path;
      }

      // Paths starting with / are absolute from workspace root, regardless of
      // imagePathResolution setting. Strip the leading / so the path is
      // workspace-relative (readBinaryFile joins with workspace root).
      // Check BEFORE normalizePath which strips the leading /.
      if (path.startsWith('/')) {
        return normalizePath(path.slice(1));
      }

      // Normalize the path to handle ./ and ../ correctly
      const normalizedPath = normalizePath(path);

      // Choose the base URI based on settings
      const baseUri = imagePathResolution === 'document' ? documentDirUri : assetBaseUri;

      // If we have a base URI, resolve relative paths and normalize the
      // combined result so that "../" segments are resolved (e.g.
      // "notes/sub/" + "../assets/img.svg" → "notes/assets/img.svg")
      if (baseUri) {
        return normalizePath(baseUri + normalizedPath);
      }

      // Fallback to original path
      return path;
    },
  };
}
