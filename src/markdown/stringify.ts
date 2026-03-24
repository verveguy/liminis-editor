import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { mathToMarkdown } from 'mdast-util-math';
import { defListToMarkdown } from 'mdast-util-definition-list';
import { gfmFootnoteToMarkdown } from 'mdast-util-gfm-footnote';
import { frontmatterToMarkdown } from 'mdast-util-frontmatter';
import type { Root } from 'mdast';

export interface StringifyOptions {
  wrapWidth?: number;
  bulletStyle?: '-' | '*' | '+';
  fenceStyle?: '`' | '~';
}

// Wiki-link options: use | as the alias divider (Obsidian/Foam style)
const wikiLinkOptions = { aliasDivider: '|' };

/**
 * Make all lists "tight" (no blank lines between items).
 * 
 * The mdast `spread` property on lists and list items controls whether
 * blank lines are added between items. By setting spread: false on all
 * lists and list items, we get compact lists without extra blank lines.
 */
function makeTightLists(node: any): any {
  if (!node || typeof node !== 'object') {
    return node;
  }
  
  if (node.type === 'list') {
    return {
      ...node,
      spread: false,
      children: node.children?.map((item: any) => ({
        ...makeTightLists(item),
        spread: false,
      })),
    };
  }
  
  if (node.type === 'listItem') {
    return {
      ...node,
      spread: false,
      children: node.children?.map(makeTightLists),
    };
  }
  
  // Recursively process children
  if (node.children && Array.isArray(node.children)) {
    return {
      ...node,
      children: node.children.map(makeTightLists),
    };
  }
  
  return node;
}

/**
 * Add checkbox text to ordered list items that have checked property.
 * 
 * GFM only outputs checkboxes ([ ] or [x]) for unordered lists.
 * For ordered lists with checkboxes (common in Foam/Obsidian), we need to
 * manually add the checkbox text to the first paragraph.
 */
function addCheckboxTextToOrderedLists(root: any): any {
  function processNode(node: any): any {
    if (node.type === 'list' && node.ordered === true) {
      return {
        ...node,
        children: node.children.map((listItem: any) => {
          // Only process list items that have a checked property
          if (listItem.checked === true || listItem.checked === false) {
            const checkbox = listItem.checked ? '[x] ' : '[ ] ';
            
            // Find the first paragraph and prepend the checkbox text
            if (listItem.children && listItem.children.length > 0) {
              const firstChild = listItem.children[0];
              if (firstChild.type === 'paragraph' && firstChild.children && firstChild.children.length > 0) {
                const firstInline = firstChild.children[0];
                if (firstInline.type === 'text') {
                  // If text already starts with a checkbox marker, don't duplicate it
                  if (firstInline.value.match(/^\[( |x|X)\]\s+/)) {
                    return listItem;
                  }
                  // Prepend checkbox to existing text
                  return {
                    ...listItem,
                    checked: null, // Clear checked so gfm doesn't output it again
                    children: [
                      {
                        ...firstChild,
                        children: [
                          { ...firstInline, value: checkbox + firstInline.value },
                          ...firstChild.children.slice(1),
                        ],
                      },
                      ...listItem.children.slice(1),
                    ],
                  };
                } else {
                  // First inline is not text, insert checkbox text before it
                  return {
                    ...listItem,
                    checked: null,
                    children: [
                      {
                        ...firstChild,
                        children: [
                          { type: 'text', value: checkbox },
                          ...firstChild.children,
                        ],
                      },
                      ...listItem.children.slice(1),
                    ],
                  };
                }
              }
            }
          }
          return listItem;
        }),
      };
    }
    
    // Recursively process children
    if (node.children && Array.isArray(node.children)) {
      return {
        ...node,
        children: node.children.map(processNode),
      };
    }
    
    return node;
  }
  
  return processNode(root);
}

/**
 * Normalize wiki-link nodes for stringification
 *
 * mdast-util-wiki-link expects `data` to exist and reads `data.alias` directly.
 * We keep `data` as an object to avoid runtime errors.
 *
 * We keep data as an object if present, but do not force alias state here.
 */
function normalizeWikiLinkNodes(node: any): any {
  if (!node || typeof node !== 'object') {
    return node;
  }
  
  if (node.type === 'wikiLink') {
    const data = node.data && typeof node.data === 'object' ? { ...node.data } : {};
    return {
      ...node,
      data,
    };
  }
  
  // Recursively normalize children
  if (node.children && Array.isArray(node.children)) {
    return {
      ...node,
      children: node.children.map(normalizeWikiLinkNodes),
    };
  }
  
  return node;
}

export function stringifyMarkdown(root: Root, options: StringifyOptions = {}): string {
  // Pre-process: add checkbox text to ordered list items (GFM only outputs for unordered)
  let processedRoot = addCheckboxTextToOrderedLists(root);
  
  // Normalize wiki-link nodes before stringifying
  processedRoot = normalizeWikiLinkNodes(processedRoot) as Root;
  
  // Make lists tight (no blank lines between items) by default
  processedRoot = makeTightLists(processedRoot) as Root;
  
  let result = toMarkdown(processedRoot, {
    extensions: [
      gfmToMarkdown({
        // Keep a single space padding around cell content, but don't align columns.
        // This preserves the common "| a | b |" style without spacing churn.
        tableCellPadding: true,
        tablePipeAlign: false,
      }),
      mathToMarkdown(),
      defListToMarkdown,
      gfmFootnoteToMarkdown(),
      frontmatterToMarkdown(['yaml']),
      {
        // Custom handlers for emphasis markers and wiki links
        // Cast to allow custom wikiLink handler (not in base Handlers type)
        handlers: {
          emphasis: (node: any, _parent: any, state: any) => {
            const marker = node?.data?._emphasisMarker === '_' ? '_' : '*';
            const content = state.containerPhrasing(node, { before: marker, after: marker });
            return marker + content + marker;
          },
          strong: (node: any, _parent: any, state: any) => {
            const markerChar = node?.data?._strongMarker === '_' ? '_' : '*';
            const marker = markerChar + markerChar;
            const content = state.containerPhrasing(node, { before: marker, after: marker });
            return marker + content + marker;
          },
          wikiLink: (node: any) => {
            const value = node.value ?? '';
            const data = node.data && typeof node.data === 'object' ? node.data : {};
            const alias = typeof data.alias === 'string' ? data.alias : '';
            const hasAlias = alias.length > 0 && alias !== value;
            const emptyAlias = data._emptyAlias === true;
            const aliasPart = hasAlias ? `${wikiLinkOptions.aliasDivider}${alias}` : emptyAlias ? `${wikiLinkOptions.aliasDivider}` : '';
            return `[[${value}${aliasPart}]]`;
          },
        } as Record<string, unknown>,
      },
    ],
    bullet: options.bulletStyle || '-',
    fence: options.fenceStyle || '`',
    listItemIndent: 'one',
    rule: '-',
    // Custom join function to prevent extra blank lines
    join: [
      // Don't add blank line between paragraph and block when paragraph ends with ':'
      // This preserves the "label + block" pattern (e.g., "Fenced code:", "Block math:").
      (left: any, right: any) => {
        if (left.type === 'paragraph') {
          const lastChild = left.children?.[left.children.length - 1];
          const endsWithColon = lastChild?.type === 'text' && lastChild.value?.trimEnd().endsWith(':');
          if (endsWithColon && ['list', 'table', 'code', 'math'].includes(right.type)) {
            return 0; // No blank line
          }
        }
        return undefined; // Use default
      },
    ],
  });

  // Post-process: convert escaped spaces back to regular spaces
  // mdast-util-to-markdown escapes leading/trailing spaces at paragraph
  // boundaries as &#x20; which looks ugly in raw markdown
  result = result.replace(/&#x20;/g, ' ');

  // Post-process: prefer two-space hard breaks over backslash hard breaks
  // Convert a trailing backslash at end of line to two spaces.
  result = result.replace(/\\\n/g, '  \n');

  // Post-process: unescape callout markers in blockquotes
  // Convert "> \[!NOTE]" -> "> [!NOTE]"
  result = result.replace(/^> \\\[!([A-Z]+)\]/gm, '> [!$1]');

  // Post-process: unescape ordered task list markers
  // Convert "1. \[ ]" -> "1. [ ]"
  result = result.replace(/^(\s*\d+\.\s*)\\\[( |x|X)\]/gm, '$1[$2]');

  // Post-process: unescape wiki-link brackets that were escaped
  // mdast-util-to-markdown escapes [ to \[ to prevent link interpretation
  // Pattern: \[\[content]] or \[\[content\]\] → [[content]]
  // NOTE: must run before the bracket preservation step below
  result = result.replace(/\\\[\\\[([^\]\n]+?)\\\]\\\]/g, '[[$1]]');
  result = result.replace(/\\\[\\\[([^\]\n]+?)\]\]/g, '[[$1]]');

  // Post-process: preserve escaped brackets (ensure closing bracket is also escaped)
  result = result.replace(/\\\[([^\]\n]+)\](?!\])/g, '\\[$1\\]');

  // Post-process: collapse excessive blank lines introduced during stringify
  // Keep at most one blank line between blocks.
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}
