import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import { frontmatter } from 'micromark-extension-frontmatter';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { syntax as wikiLinkSyntax } from 'micromark-extension-wiki-link';
import * as wikiLinkMdast from 'mdast-util-wiki-link';
import type { Root, Content, PhrasingContent } from 'mdast';

export interface ParseOptions {
  mathEnabled?: boolean;
}

export interface ParseResult {
  root: Root;
}

// Wiki-link options: use | as the alias divider (Obsidian/Foam style)
const wikiLinkOptions = { aliasDivider: '|' };
const EMPTY_ALIAS_SENTINEL = '__EMPTY_ALIAS__';

interface Replacement {
  normalizedStart: number;
  normalizedEnd: number;
  delta: number;
  originalStart: number;
  originalEnd: number;
}

/**
 * Normalize wiki-links with empty aliases: [[target|]] → [[target|__EMPTY_ALIAS__]]
 * We preserve the intent by using a sentinel, then strip it after parsing.
 * Returns the normalized text plus offset mapping data.
 */
function normalizeWikiLinks(text: string): { text: string; replacements: Replacement[] } {
  const replacements: Replacement[] = [];
  const pattern = /\[\[([^\]|]+)\|\]\]/g;

  let result = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const originalStart = match.index;
    const originalEnd = match.index + match[0].length;
    const replacement = `[[${match[1]}|${EMPTY_ALIAS_SENTINEL}]]`;

    result += text.slice(cursor, originalStart);
    const normalizedStart = result.length;
    result += replacement;
    const normalizedEnd = result.length;

    replacements.push({
      normalizedStart,
      normalizedEnd,
      delta: replacement.length - match[0].length,
      originalStart,
      originalEnd,
    });

    cursor = originalEnd;
  }

  result += text.slice(cursor);
  return { text: result, replacements };
}

function mapNormalizedOffsetToOriginal(offset: number, replacements: Replacement[]): number {
  let delta = 0;
  for (const rep of replacements) {
    if (offset >= rep.normalizedEnd) {
      delta += rep.delta;
      continue;
    }
    if (offset >= rep.normalizedStart) {
      // Offset falls within a replacement; map to the start of the original span.
      return rep.originalStart;
    }
    break;
  }
  return offset - delta;
}

function annotateEmphasisMarkers(root: Root, originalText: string, replacements: Replacement[]): Root {
  function walk(node: any): any {
    if (!node || typeof node !== 'object') return node;

    if ((node.type === 'emphasis' || node.type === 'strong') && node.position?.start?.offset != null) {
      const normalizedOffset = node.position.start.offset as number;
      const originalOffset = mapNormalizedOffsetToOriginal(normalizedOffset, replacements);
      const data = node.data && typeof node.data === 'object' ? { ...node.data } : {};

      if (node.type === 'emphasis') {
        const marker = originalText[originalOffset];
        if (marker === '_' || marker === '*') {
          data._emphasisMarker = marker;
        }
      } else if (node.type === 'strong') {
        const two = originalText.slice(originalOffset, originalOffset + 2);
        if (two === '__' || two === '**') {
          data._strongMarker = two[0];
        } else {
          const marker = originalText[originalOffset];
          if (marker === '_' || marker === '*') {
            data._strongMarker = marker;
          }
        }
      }

      node.data = data;
    }

    if (node.children && Array.isArray(node.children)) {
      node.children = node.children.map(walk);
    }

    return node;
  }

  return walk(root);
}

/**
 * Mark wiki-links that had an empty alias in the source.
 * Sets data._emptyAlias = true and clears alias to empty string.
 */
function markEmptyAliasWikiLinks(root: Root): Root {
  function walk(node: any): any {
    if (!node || typeof node !== 'object') return node;

    if (node.type === 'wikiLink') {
      const alias = node.data?.alias;
      if (alias === EMPTY_ALIAS_SENTINEL) {
        return {
          ...node,
          data: { ...(node.data || {}), alias: '', _emptyAlias: true },
        };
      }
      return node;
    }

    if (node.children && Array.isArray(node.children)) {
      return {
        ...node,
        children: node.children.map(walk),
      };
    }

    return node;
  }

  return walk(root);
}

/**
 * Post-process mdast tree to support checkboxes in ordered lists.
 * 
 * GFM task lists only work with unordered lists (- [ ]), but Foam/Obsidian
 * commonly use them in ordered lists too (1. [ ]). The GFM parser leaves
 * the checkbox text as regular text in ordered lists.
 * 
 * This function finds ordered list items that start with [ ] or [x] text
 * and converts them to proper task list items by:
 * 1. Setting the checked property on the list item
 * 2. Removing the checkbox text from the content
 */
function addCheckboxesToOrderedLists(root: Root): Root {
  function processNode(node: any): any {
    if (node.type === 'list' && node.ordered === true) {
      // Process children (list items)
      return {
        ...node,
        children: node.children.map((listItem: any) => processOrderedListItem(listItem)),
      };
    }
    
    // Recursively process children for other node types
    if (node.children && Array.isArray(node.children)) {
      return {
        ...node,
        children: node.children.map(processNode),
      };
    }
    
    return node;
  }
  
  function processOrderedListItem(listItem: any): any {
    // List item should have checked: null for non-task items
    // Check if the first paragraph starts with [ ] or [x]
    if (listItem.children && listItem.children.length > 0) {
      const firstChild = listItem.children[0];
      if (firstChild.type === 'paragraph' && firstChild.children && firstChild.children.length > 0) {
        const firstInline = firstChild.children[0];
        if (firstInline.type === 'text') {
          const text = firstInline.value;
          // Match [ ] or [x] or [X] at the start
          const checkboxMatch = text.match(/^\[( |x|X)\]\s*/);
          if (checkboxMatch) {
            const isChecked = checkboxMatch[1].toLowerCase() === 'x';

            // Mark as checked but keep the original text intact.
            // This preserves "[ ]" in the editor and lets export detect it later.
            return {
              ...listItem,
              checked: isChecked,
            };
          }
        }
      }
    }

    return listItem;
  }
  
  return processNode(root);
}

export function parseMarkdown(text: string, _options: ParseOptions = {}): ParseResult {
  // Pre-process to handle edge cases
  const { text: normalizedText, replacements } = normalizeWikiLinks(text);
  
  let root = fromMarkdown(normalizedText, {
    extensions: [gfm(), math(), frontmatter(['yaml']), wikiLinkSyntax(wikiLinkOptions as any)],
    mdastExtensions: [
      gfmFromMarkdown(),
      mathFromMarkdown(),
      frontmatterFromMarkdown(['yaml']),
      wikiLinkMdast.fromMarkdown(wikiLinkOptions as any),
    ],
  } as any);

  // Post-process: add checkbox support for ordered lists
  // GFM only supports task lists in unordered lists, but Foam/Obsidian use them in ordered lists too
  root = addCheckboxesToOrderedLists(root);

  // Post-process: mark wiki-links that had empty aliases in the source
  root = markEmptyAliasWikiLinks(root);

  // Post-process: annotate emphasis/strong marker characters from original source
  root = annotateEmphasisMarkers(root, text, replacements);

  return { root };
}

// Type guards for mdast nodes
export function isParagraph(node: Content): node is Extract<Content, { type: 'paragraph' }> {
  return node.type === 'paragraph';
}

export function isHeading(node: Content): node is Extract<Content, { type: 'heading' }> {
  return node.type === 'heading';
}

export function isList(node: Content): node is Extract<Content, { type: 'list' }> {
  return node.type === 'list';
}

export function isListItem(node: Content): node is Extract<Content, { type: 'listItem' }> {
  return node.type === 'listItem';
}

export function isBlockquote(node: Content): node is Extract<Content, { type: 'blockquote' }> {
  return node.type === 'blockquote';
}

export function isCode(node: Content): node is Extract<Content, { type: 'code' }> {
  return node.type === 'code';
}

export function isThematicBreak(node: Content): node is Extract<Content, { type: 'thematicBreak' }> {
  return node.type === 'thematicBreak';
}

export function isTable(node: Content): node is Extract<Content, { type: 'table' }> {
  return node.type === 'table';
}

export function isImage(node: Content | PhrasingContent): node is Extract<Content, { type: 'image' }> {
  return node.type === 'image';
}

export function isLink(node: Content | PhrasingContent): node is Extract<Content, { type: 'link' }> {
  return node.type === 'link';
}

export function isHtml(node: Content): node is Extract<Content, { type: 'html' }> {
  return node.type === 'html';
}

export function isText(node: Content | PhrasingContent): node is Extract<PhrasingContent, { type: 'text' }> {
  return node.type === 'text';
}

export function isStrong(node: Content | PhrasingContent): node is Extract<PhrasingContent, { type: 'strong' }> {
  return node.type === 'strong';
}

export function isEmphasis(node: Content | PhrasingContent): node is Extract<PhrasingContent, { type: 'emphasis' }> {
  return node.type === 'emphasis';
}

export function isInlineCode(node: Content | PhrasingContent): node is Extract<PhrasingContent, { type: 'inlineCode' }> {
  return node.type === 'inlineCode';
}

export function isDelete(node: Content | PhrasingContent): node is Extract<PhrasingContent, { type: 'delete' }> {
  return node.type === 'delete';
}
