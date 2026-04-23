import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $isElementNode, $isTextNode, type LexicalNode } from 'lexical';
import { $isCodeNode } from '@lexical/code';
import { $isFrontmatterNode } from './nodes';

export type SweepFn = (oldTerm: string, newTerm: string) => Promise<number>;

interface AmbientCorrectionPluginProps {
  onSubstitutionDetected: (oldTerm: string, newTerm: string) => void;
  sweepRef?: React.MutableRefObject<SweepFn | null>;
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
  const firstChar = match.charAt(0);
  if (
    match.length > 0 &&
    firstChar.toUpperCase() === firstChar &&
    firstChar.toLowerCase() !== firstChar &&
    match.slice(1) === match.slice(1).toLowerCase()
  ) {
    return replacement.length > 0
      ? replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase()
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

  // Use word-boundary regex so only exact whole-word appearances in excluded
  // regions suppress detection (avoids false negatives from substring matches).
  if (new RegExp(`\\b${escapeRegex(oldRegion)}\\b`, 'i').test(excludedText)) return null;

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
    sweepRef.current = (oldTerm: string, newTerm: string): Promise<number> =>
      new Promise<number>((resolve) => {
        let count = 0;
        const escaped = escapeRegex(oldTerm);
        const regex = new RegExp(`\\b${escaped}\\b`, 'gi');

        editor.update(
          () => {
            // Tree-walker: skip entire code/frontmatter subtrees rather than
            // checking ancestors per-node (O(N) vs O(N * depth)).
            const walk = (node: LexicalNode) => {
              if ($isCodeNode(node) || $isFrontmatterNode(node)) return;
              if ($isTextNode(node)) {
                const text = node.getTextContent();
                const replaced = text.replace(regex, (match) => {
                  count++;
                  return applyCase(match, newTerm);
                });
                if (replaced !== text) node.setTextContent(replaced);
                return;
              }
              if ($isElementNode(node)) {
                for (const child of node.getChildren()) walk(child);
              }
            };
            walk($getRoot());
          },
          { discrete: true, onUpdate: () => resolve(count) }
        );
      });

    return () => {
      sweepRef.current = null;
    };
  }, [editor, sweepRef]);

  // Register change listener for substitution detection.
  useEffect(() => {
    const unregister = editor.registerUpdateListener(
      ({ editorState, prevEditorState, dirtyElements, dirtyLeaves }) => {
        // Skip pure selection changes that don't touch content nodes.
        if (dirtyLeaves.size === 0 && dirtyElements.size === 0) return;

        if (debounceRef.current !== null) clearTimeout(debounceRef.current);

        // Capture editor state refs — defer expensive getTextContent() reads
        // until the debounce fires, so we don't read full document on every keystroke.
        const capturedState = editorState;
        const capturedPrevState = prevEditorState;

        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;

          let currentText = '';
          let prevText = '';
          capturedState.read(() => {
            currentText = $getRoot().getTextContent();
          });
          capturedPrevState.read(() => {
            prevText = $getRoot().getTextContent();
          });

          if (currentText === prevText) return;

          let excludedText = '';
          capturedState.read(() => {
            excludedText = collectExcludedText($getRoot());
          });

          const result = analyzeForSubstitution(prevText, currentText, excludedText);
          if (result) {
            callbackRef.current(result.oldTerm, result.newTerm);
          }
        }, 300);
      }
    );

    return () => {
      unregister();
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [editor]);

  return null;
}
