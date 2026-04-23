import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical';
import { $isCodeNode } from '@lexical/code';
import { $isFrontmatterNode } from './nodes';

export type SweepFn = (oldTerm: string, newTerm: string) => Promise<number>;

interface AmbientCorrectionPluginProps {
  onSubstitutionDetected: (oldTerm: string, newTerm: string) => void;
  sweepRef?: React.RefObject<SweepFn | null>;
}

// ── Utilities ────────────────────────────────────────────────────────────────

/** Return text content contributed by non-prose nodes (code blocks, frontmatter). */
function collectExcludedText(root: LexicalNode): string {
  let text = '';
  const walk = (node: LexicalNode) => {
    if ($isCodeNode(node) || $isFrontmatterNode(node)) {
      text += node.getTextContent();
      return;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) walk(child);
    }
  };
  walk(root);
  return text;
}

/** True if any ancestor of `node` is a code or frontmatter block. */
function hasExcludedAncestor(node: LexicalNode): boolean {
  let parent = node.getParent();
  while (parent !== null) {
    if ($isCodeNode(parent) || $isFrontmatterNode(parent)) return true;
    parent = parent.getParent();
  }
  return false;
}

/** True if the char is a word character (letter, digit, or underscore). */
function isWordChar(c: string): boolean {
  return /\w/.test(c);
}

/** True if `region` consists only of word characters (single word token). */
function isSingleWordToken(region: string): boolean {
  return region.length > 0 && /^\w+$/.test(region);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Preserve the original capitalisation pattern of a matched word when replacing.
 * - ALL-CAPS → ALL-CAPS replacement
 * - Title-case → Title-case replacement
 * - otherwise → lowercase replacement
 */
function applyCase(match: string, replacement: string): string {
  if (match === match.toUpperCase() && match !== match.toLowerCase()) {
    return replacement.toUpperCase();
  }
  if (
    match.length > 0 &&
    match[0] === match[0].toUpperCase() &&
    match[0] !== match[0].toLowerCase() &&
    match.slice(1) === match.slice(1).toLowerCase()
  ) {
    return replacement.length > 0
      ? replacement[0].toUpperCase() + replacement.slice(1).toLowerCase()
      : replacement;
  }
  return replacement.toLowerCase();
}

// ── Substitution detection ────────────────────────────────────────────────────

/**
 * Analyse a before/after text pair to detect a single-word substitution.
 * Returns `{ oldTerm, newTerm }` when a valid substitution is detected, or null.
 */
function analyzeForSubstitution(
  prev: string,
  current: string,
  excludedText: string
): { oldTerm: string; newTerm: string } | null {
  if (prev === current) return null;

  // Find common prefix
  let prefixLen = 0;
  const minLen = Math.min(prev.length, current.length);
  while (prefixLen < minLen && prev[prefixLen] === current[prefixLen]) prefixLen++;

  // Find common suffix (must not overlap with prefix)
  let suffixLen = 0;
  const maxSuffix = minLen - prefixLen;
  while (
    suffixLen < maxSuffix &&
    prev[prev.length - 1 - suffixLen] === current[current.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const oldRegion = prev.slice(prefixLen, suffixLen > 0 ? -suffixLen : undefined);
  const newRegion = current.slice(prefixLen, suffixLen > 0 ? -suffixLen : undefined);

  if (!isSingleWordToken(oldRegion) || !isSingleWordToken(newRegion)) return null;
  if (oldRegion.toLowerCase() === newRegion.toLowerCase()) return null;

  // Must sit at word boundaries in the source text
  const charBefore = prefixLen > 0 ? prev[prefixLen - 1] : null;
  const charAfter = prev.length - suffixLen < prev.length ? prev[prev.length - suffixLen] : null;
  if (charBefore !== null && isWordChar(charBefore)) return null;
  if (charAfter !== null && isWordChar(charAfter)) return null;

  // Skip changes that only affect excluded regions (code blocks, frontmatter)
  if (excludedText.includes(oldRegion)) return null;

  return { oldTerm: oldRegion, newTerm: newRegion };
}

// ── Plugin ────────────────────────────────────────────────────────────────────

/**
 * Ambient correction plugin.
 *
 * 1. Detects single-word substitutions (debounced 300 ms) and calls
 *    `onSubstitutionDetected` so the parent can show a nudge toast.
 *
 * 2. Populates `sweepRef.current` with a function that performs the confirmed
 *    sweep: replaces all remaining occurrences of `oldTerm` with `newTerm`
 *    (case-preserving, skipping code blocks and frontmatter) inside a single
 *    `editor.update()` call so undo produces one history entry.
 */
export function AmbientCorrectionPlugin({
  onSubstitutionDetected,
  sweepRef,
}: AmbientCorrectionPluginProps) {
  const [editor] = useLexicalComposerContext();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(onSubstitutionDetected);
  callbackRef.current = onSubstitutionDetected;

  // Populate the sweep ref so the parent can trigger a sweep from outside.
  useEffect(() => {
    if (!sweepRef) return;
    (sweepRef as React.MutableRefObject<SweepFn | null>).current = (
      oldTerm: string,
      newTerm: string
    ): Promise<number> =>
      new Promise<number>((resolve) => {
        let count = 0;
        const escaped = escapeRegex(oldTerm);
        const regex = new RegExp(`\\b${escaped}\\b`, 'gi');

        editor.update(
          () => {
            const textNodes = $getRoot().getAllTextNodes();
            for (const node of textNodes) {
              if (hasExcludedAncestor(node)) continue;
              const text = node.getTextContent();
              const replaced = text.replace(regex, (match) => {
                count++;
                return applyCase(match, newTerm);
              });
              if (replaced !== text) node.setTextContent(replaced);
            }
          },
          { discrete: true, onUpdate: () => resolve(count) }
        );
      });

    return () => {
      (sweepRef as React.MutableRefObject<SweepFn | null>).current = null;
    };
  }, [editor, sweepRef]);

  // Register change listener for substitution detection.
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, prevEditorState }) => {
      let currentText = '';
      let prevText = '';

      editorState.read(() => {
        currentText = $getRoot().getTextContent();
      });
      prevEditorState.read(() => {
        prevText = $getRoot().getTextContent();
      });

      if (currentText === prevText) return;

      if (debounceRef.current !== null) clearTimeout(debounceRef.current);

      const capturedPrev = prevText;
      const capturedCurrent = currentText;

      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;

        let excludedText = '';
        editor.getEditorState().read(() => {
          excludedText = collectExcludedText($getRoot());
        });

        const result = analyzeForSubstitution(capturedPrev, capturedCurrent, excludedText);
        if (result) {
          callbackRef.current(result.oldTerm, result.newTerm);
        }
      }, 300);
    });
  }, [editor]);

  return null;
}
