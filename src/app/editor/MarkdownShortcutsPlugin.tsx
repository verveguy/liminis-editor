import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  registerMarkdownShortcuts,
  UNORDERED_LIST,
  ORDERED_LIST,
  CHECK_LIST,
  HEADING,
  QUOTE,
  CODE,
  // Text format transformers for inline markdown syntax
  BOLD_STAR,
  BOLD_UNDERSCORE,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  INLINE_CODE,
  // Text match transformers for links
  LINK,
  type TextMatchTransformer,
} from '@lexical/markdown';
import { $createTextNode } from 'lexical';
import { LinkNode } from '@lexical/link';
import { $createCustomLinkNode } from './nodes';
import { $createImageNode, ImageNode } from './nodes/ImageNode';
import { $createEquationNode, EquationNode } from './nodes';
import type { TextFormatType } from 'lexical';

/**
 * Parses a wiki link alias and extracts format markers.
 * Supports nested formats like ***bold italic***.
 *
 * @param alias - The raw alias text potentially containing format markers
 * @returns Object with the plain text and array of formats to apply
 *
 * @example
 * parseFormattedAlias('**bold**')     // { text: 'bold', formats: ['bold'] }
 * parseFormattedAlias('*italic*')     // { text: 'italic', formats: ['italic'] }
 * parseFormattedAlias('***both***')   // { text: 'both', formats: ['bold', 'italic'] }
 * parseFormattedAlias('~~strike~~')   // { text: 'strike', formats: ['strikethrough'] }
 */
export function parseFormattedAlias(alias: string): { text: string; formats: TextFormatType[] } {
  const formats: TextFormatType[] = [];
  let text = alias;

  // Process from outermost to innermost format markers
  // We loop to handle nested formats like ***bold italic*** or ~~**bold strike**~~
  let changed = true;
  while (changed && text.length >= 2) {
    changed = false;

    // Check for strikethrough: ~~text~~
    if (text.startsWith('~~') && text.endsWith('~~') && text.length >= 4) {
      const inner = text.slice(2, -2);
      if (inner.length > 0) {
        formats.push('strikethrough');
        text = inner;
        changed = true;
        continue;
      }
    }

    // Check for bold: **text** (must check before single *)
    if (text.startsWith('**') && text.endsWith('**') && text.length >= 4) {
      const inner = text.slice(2, -2);
      if (inner.length > 0) {
        formats.push('bold');
        text = inner;
        changed = true;
        continue;
      }
    }

    // Check for bold: __text__ (must check before single _)
    if (text.startsWith('__') && text.endsWith('__') && text.length >= 4) {
      const inner = text.slice(2, -2);
      if (inner.length > 0) {
        formats.push('bold');
        text = inner;
        changed = true;
        continue;
      }
    }

    // Check for italic: *text* (but not if inner starts/ends with * which would be **)
    if (text.startsWith('*') && text.endsWith('*') && text.length >= 2 && !text.startsWith('**') && !text.endsWith('**')) {
      const inner = text.slice(1, -1);
      if (inner.length > 0) {
        formats.push('italic');
        text = inner;
        changed = true;
        continue;
      }
    }

    // Check for italic: _text_ (but not if inner starts/ends with _ which would be __)
    if (text.startsWith('_') && text.endsWith('_') && text.length >= 2 && !text.startsWith('__') && !text.endsWith('__')) {
      const inner = text.slice(1, -1);
      if (inner.length > 0) {
        formats.push('italic');
        text = inner;
        changed = true;
        continue;
      }
    }
  }

  return { text, formats };
}

/**
 * Custom IMAGE transformer for ![alt](url) markdown syntax.
 * Creates an ImageNode block when the pattern is completed.
 */
const IMAGE: TextMatchTransformer = {
  dependencies: [ImageNode],
  // Export: convert ImageNode back to markdown
  export: (node) => {
    if (node instanceof ImageNode) {
      const alt = node.getAlt();
      const src = node.getSrc();
      const title = node.getTitle();
      if (title) {
        return `![${alt}](${src} "${title}")`;
      }
      return `![${alt}](${src})`;
    }
    return null;
  },
  // Import regex for parsing markdown files (more permissive)
  importRegExp: /!\[([^\]]*)\]\(([^()\s]+)(?:\s"([^"]*)")?\)/,
  // Trigger regex for live typing (must end at cursor position)
  regExp: /!\[([^\]]*)\]\(([^()\s]+)(?:\s"([^"]*)")?\)$/,
  // Replace the matched text with an ImageNode
  replace: (textNode, match) => {
    const [, alt, src, title] = match;
    const imageNode = $createImageNode(src, alt || '', title);
    textNode.replace(imageNode);
  },
  // Trigger character - transform happens when ) is typed
  trigger: ')',
  type: 'text-match',
};

/**
 * Custom BLOCK_EQUATION transformer for $$...$$ markdown syntax.
 * Creates a block (display) EquationNode when the pattern is completed.
 */
const BLOCK_EQUATION: TextMatchTransformer = {
  dependencies: [EquationNode],
  export: (node) => {
    if (node instanceof EquationNode && !node.isInline()) {
      return `$$${node.getEquation()}$$`;
    }
    return null;
  },
  // Import regex - matches $$...$$ anywhere
  importRegExp: /\$\$([^$]+)\$\$/,
  // Trigger regex - must end at cursor
  regExp: /\$\$([^$]+)\$\$$/,
  replace: (textNode, match) => {
    const [, equation] = match;
    const equationNode = $createEquationNode(equation.trim(), false);
    textNode.replace(equationNode);
  },
  trigger: '$',
  type: 'text-match',
};

/**
 * Custom INLINE_EQUATION transformer for $...$ markdown syntax.
 * Creates an inline EquationNode when the pattern is completed.
 * Note: Must come after BLOCK_EQUATION to avoid premature matching.
 */
const INLINE_EQUATION: TextMatchTransformer = {
  dependencies: [EquationNode],
  export: (node) => {
    if (node instanceof EquationNode && node.isInline()) {
      return `$${node.getEquation()}$`;
    }
    return null;
  },
  // Import regex - matches $...$ but not $$...$$ (negative lookahead/lookbehind)
  importRegExp: /(?<!\$)\$([^$]+)\$(?!\$)/,
  // Trigger regex - matches single $ but not $$
  regExp: /(?<!\$)\$([^$]+)\$$/,
  replace: (textNode, match) => {
    const [, equation] = match;
    const equationNode = $createEquationNode(equation.trim(), true);
    textNode.replace(equationNode);
  },
  trigger: '$',
  type: 'text-match',
};

/**
 * Custom WIKI_LINK transformer for [[target|alias]] and [[target]] markdown syntax.
 * Creates a LinkNode that will be exported back as a wiki-link.
 * The URL is set to target.md so the exporter knows it's a wiki-link.
 *
 * Supports:
 * - [[page]] → page.md
 * - [[page|alias]] → page.md with display text "alias"
 * - [[#anchor]] → #anchor (anchor-only, no .md)
 * - [[page#anchor]] → page.md#anchor
 * - [[page#anchor|alias]] → page.md#anchor with display text "alias"
 */
const WIKI_LINK: TextMatchTransformer = {
  dependencies: [LinkNode],
  export: (_node) => {
    void _node;
    // Export is handled by lexicalToMdast.ts convertLinkNode
    // which detects .md URLs and exports as wiki-links
    return null;
  },
  // Import regex - matches [[target|alias]], [[target|]] (empty alias), or [[target]]
  importRegExp: /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/,
  // Trigger regex - must end at cursor position
  regExp: /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/,
  replace: (textNode, match) => {
    const [, target, alias] = match;

    // Handle anchors properly
    let url: string;
    if (target.startsWith('#')) {
      // Anchor-only link: [[#anchor]] → #anchor
      url = target;
    } else if (target.includes('#')) {
      // Path with anchor: [[page#anchor]] → page.md#anchor
      const [path, anchor] = target.split('#', 2);
      const pathWithExt = path.endsWith('.md') ? path : `${path}.md`;
      url = `${pathWithExt}#${anchor}`;
    } else {
      // Simple path: [[page]] → page.md
      url = target.endsWith('.md') ? target : `${target}.md`;
    }

    // Parse alias for format markers (e.g., **bold**, *italic*, ~~strikethrough~~)
    const rawDisplayText = alias || target;
    const { text: displayText, formats } = parseFormattedAlias(rawDisplayText);

    const linkNode = $createCustomLinkNode(url);
    const textNodeChild = $createTextNode(displayText);

    // Apply detected formats to the text node
    for (const format of formats) {
      textNodeChild.toggleFormat(format);
    }

    linkNode.append(textNodeChild);
    textNode.replace(linkNode);
  },
  trigger: ']',
  type: 'text-match',
};

/**
 * Plugin that enables markdown shortcuts for block types and inline formatting.
 *
 * Block shortcuts (triggered at start of line):
 * - "- " or "* " → Bulleted list
 * - "1. " → Numbered list
 * - "[] " or "[ ] " → Todo/checkbox list
 * - "# ", "## ", "### " → Headings (h1-h6)
 * - "> " → Block quote
 * - "```" → Code block
 *
 * Inline formatting (Slack-style - transforms when closing delimiter is typed):
 * - *text* → Italic
 * - **text** → Bold
 * - ***text*** → Bold + Italic
 * - _text_ → Italic
 * - __text__ → Bold
 * - ___text___ → Bold + Italic
 * - `text` → Inline code
 * - ~~text~~ → Strikethrough
 * - [text](url) → Link
 * - [[target|alias]] → Wiki-link (Obsidian/Foam style)
 * - ![alt](url) → Image
 * - $equation$ → Inline math (KaTeX)
 * - $$equation$$ → Block math (KaTeX)
 */
export function MarkdownShortcutsPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Register both element (block) and text format (inline) transformers
    // This enables "live preview" markdown editing where typing *text* becomes italic, **text** becomes bold
    return registerMarkdownShortcuts(editor, [
      // Block-level transformers
      UNORDERED_LIST,
      ORDERED_LIST,
      CHECK_LIST,
      HEADING,
      QUOTE,
      CODE,
      // Inline text format transformers (Slack-style resolution)
      // Order matters: more specific patterns (longer) should come first
      BOLD_ITALIC_STAR,      // ***text*** → bold + italic
      BOLD_ITALIC_UNDERSCORE, // ___text___ → bold + italic
      BOLD_STAR,             // **text** → bold
      BOLD_UNDERSCORE,       // __text__ → bold
      ITALIC_STAR,           // *text* → italic
      ITALIC_UNDERSCORE,     // _text_ → italic
      STRIKETHROUGH,         // ~~text~~ → strikethrough
      INLINE_CODE,           // `text` → code
      // Link and image transformers
      IMAGE,                 // ![alt](url) → image (must come before LINK)
      WIKI_LINK,             // [[target|alias]] → wiki-link (must come before LINK)
      LINK,                  // [text](url) → link
      // Equation transformers (block must come before inline)
      BLOCK_EQUATION,        // $$equation$$ → block math
      INLINE_EQUATION,       // $equation$ → inline math
    ]);
  }, [editor]);

  return null;
}
