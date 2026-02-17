import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getRoot,
  $isTextNode,
  LexicalNode,
  $isElementNode,
  ElementNode,
  type TextFormatType,
} from 'lexical';
import { $isLinkNode, LinkNode } from '@lexical/link';

/**
 * Format marker configuration.
 * Each entry maps a pair of markers to the format they represent.
 */
interface FormatMarker {
  /** Opening/closing marker (same for both) */
  marker: string;
  /** The Lexical text format to apply */
  format: TextFormatType;
}

/**
 * Ordered list of format markers to check.
 * Order matters: longer markers (e.g., **) must come before shorter ones (e.g., *)
 * to avoid partial matches.
 */
const FORMAT_MARKERS: FormatMarker[] = [
  { marker: '**', format: 'bold' },
  { marker: '__', format: 'bold' },
  { marker: '~~', format: 'strikethrough' },
  // Single * and _ must come after ** and __
  { marker: '*', format: 'italic' },
  { marker: '_', format: 'italic' },
];

/**
 * Result of detecting format markers surrounding a LinkNode.
 */
interface DetectedFormat {
  /** The format to apply */
  format: TextFormatType;
  /** Length of the marker (e.g., 2 for **, 1 for *) */
  markerLength: number;
}

/**
 * Detect format markers at the end of a text node and start of another.
 * Returns the formats that should be applied based on matching markers.
 *
 * @param beforeText - Text content of the node before the link
 * @param afterText - Text content of the node after the link
 * @returns Array of detected formats with their marker lengths
 */
function detectSurroundingFormats(
  beforeText: string,
  afterText: string
): DetectedFormat[] {
  const detected: DetectedFormat[] = [];
  let remainingBefore = beforeText;
  let remainingAfter = afterText;

  // Keep checking for markers until no more matches
  let foundMatch = true;
  while (foundMatch) {
    foundMatch = false;

    for (const { marker, format } of FORMAT_MARKERS) {
      // Check if before ends with marker and after starts with marker
      if (remainingBefore.endsWith(marker) && remainingAfter.startsWith(marker)) {
        // Ensure we're not matching partial markers
        // e.g., don't match single * when we're actually looking at **
        // For single char markers (* and _), ensure we're not part of a double marker
        if (marker.length === 1) {
          const beforeIndex = remainingBefore.length - marker.length - 1;
          const afterIndex = marker.length;

          // If the character before our marker is the same, skip (it's part of ** or __)
          const isDoubleBefore =
            beforeIndex >= 0 && remainingBefore[beforeIndex] === marker;
          // If the character after the closing marker is the same, skip
          const isDoubleAfter =
            afterIndex < remainingAfter.length && remainingAfter[afterIndex] === marker;

          if (isDoubleBefore || isDoubleAfter) continue;
        }

        detected.push({ format, markerLength: marker.length });
        remainingBefore = remainingBefore.slice(0, -marker.length);
        remainingAfter = remainingAfter.slice(marker.length);
        foundMatch = true;
        break; // Restart from beginning to handle nested formats correctly
      }
    }
  }

  return detected;
}

/**
 * Apply formats to all text children of a LinkNode.
 */
function applyFormatsToLinkChildren(link: LinkNode, formats: TextFormatType[]): void {
  for (const child of link.getChildren()) {
    if ($isTextNode(child)) {
      for (const format of formats) {
        if (!child.hasFormat(format)) {
          child.toggleFormat(format);
        }
      }
    }
  }
}

/**
 * Process a single LinkNode and its surrounding TextNodes.
 * Returns true if any changes were made.
 */
function processLinkNode(linkNode: LinkNode): boolean {
  const prevSibling = linkNode.getPreviousSibling();
  const nextSibling = linkNode.getNextSibling();

  // We need TextNodes on both sides
  if (!$isTextNode(prevSibling) || !$isTextNode(nextSibling)) {
    return false;
  }

  const beforeText = prevSibling.getTextContent();
  const afterText = nextSibling.getTextContent();

  // Detect format markers
  const detected = detectSurroundingFormats(beforeText, afterText);
  if (detected.length === 0) {
    return false;
  }

  // Calculate total marker lengths to remove
  let totalBeforeLength = 0;
  let totalAfterLength = 0;
  const formats: TextFormatType[] = [];

  for (const { format, markerLength } of detected) {
    formats.push(format);
    totalBeforeLength += markerLength;
    totalAfterLength += markerLength;
  }

  // Apply formats to link children
  applyFormatsToLinkChildren(linkNode, formats);

  // Remove markers from surrounding TextNodes
  const newBeforeText = beforeText.slice(0, -totalBeforeLength);
  const newAfterText = afterText.slice(totalAfterLength);

  // Update or remove the before TextNode
  if (newBeforeText.length === 0) {
    prevSibling.remove();
  } else {
    prevSibling.setTextContent(newBeforeText);
  }

  // Update or remove the after TextNode
  if (newAfterText.length === 0) {
    nextSibling.remove();
  } else {
    nextSibling.setTextContent(newAfterText);
  }

  return true;
}

/**
 * Find all LinkNodes in the editor tree.
 */
function findAllLinkNodes(root: ElementNode): LinkNode[] {
  const linkNodes: LinkNode[] = [];

  const traverse = (node: LexicalNode): void => {
    if ($isLinkNode(node)) {
      linkNodes.push(node);
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        traverse(child);
      }
    }
  };

  traverse(root);
  return linkNodes;
}

/**
 * WikiLinkFormatPlugin - Applies formatting to wiki links when surrounded by format markers
 *
 * This plugin detects patterns like `**[[page]]**` typed during live editing and:
 * 1. Removes the format markers from the surrounding TextNodes
 * 2. Applies the format (bold, italic, strikethrough) to the wiki link's text children
 *
 * Supports:
 * - Bold: **[[page]]** or __[[page]]__
 * - Italic: *[[page]]* or _[[page]]_
 * - Strikethrough: ~~[[page]]~~
 * - Nested: ***[[page]]*** (bold + italic)
 *
 * The plugin runs as a post-processing step after the markdown shortcuts transforms,
 * using an update listener to detect and modify the tree.
 */
export function WikiLinkFormatPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      // Skip if this update was triggered by us to prevent infinite loops
      if (tags.has('wiki-link-format')) {
        return;
      }

      // Early exit if nothing changed in this update
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) {
        return;
      }

      // Check if there are any LinkNodes with adjacent format markers,
      // and apply formatting in a single pass if found
      let needsUpdate = false;

      editorState.read(() => {
        const root = $getRoot();
        const linkNodes = findAllLinkNodes(root);

        for (const linkNode of linkNodes) {
          const prevSibling = linkNode.getPreviousSibling();
          const nextSibling = linkNode.getNextSibling();

          if (!$isTextNode(prevSibling) || !$isTextNode(nextSibling)) {
            continue;
          }

          const beforeText = prevSibling.getTextContent();
          const afterText = nextSibling.getTextContent();

          const detected = detectSurroundingFormats(beforeText, afterText);
          if (detected.length > 0) {
            needsUpdate = true;
            break;
          }
        }
      });

      if (!needsUpdate) {
        return;
      }

      // Perform the update
      editor.update(
        () => {
          const root = $getRoot();
          const linkNodes = findAllLinkNodes(root);

          for (const linkNode of linkNodes) {
            processLinkNode(linkNode);
          }
        },
        { tag: 'wiki-link-format' }
      );
    });
  }, [editor]);

  return null;
}
