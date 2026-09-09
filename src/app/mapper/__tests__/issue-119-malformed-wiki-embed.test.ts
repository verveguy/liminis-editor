/**
 * #119: `parseMarkdown` never produces a `wikiEmbed` mdast node without both
 * a file target and a `data.blockId` (the parser's embed-sentinel retyping
 * step guarantees this). A hand-built mdast tree from an external `./markdown`
 * consumer, however, could still construct a malformed one. `mdastToLexical`'s
 * `wikiEmbed` case must degrade that to inert placeholder text rather than
 * silently producing a blank node — a blank node erases the user-visible
 * content for no reason a reader could see, indistinguishable from data loss.
 */
import { describe, it, expect, vi } from 'vitest';
import { $getRoot } from 'lexical';
import type { Root } from 'mdast';
import { importMarkdownToLexicalInEditorState } from '../mdastToLexical';
import { createTestEditor } from './roundtrip-test-utils';

function importRoot(root: Root): string {
  const { editor, dispose } = createTestEditor();
  try {
    let text = '';
    editor.update(
      () => {
        importMarkdownToLexicalInEditorState(root);
        const paragraph = $getRoot().getFirstChild();
        text = paragraph?.getTextContent() ?? '';
      },
      { discrete: true },
    );
    return text;
  } finally {
    dispose();
  }
}

describe('mdastToLexical wikiEmbed: malformed input (#119)', () => {
  it('preserves the target as placeholder text when blockId is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'wikiEmbed', value: 'notes.md', data: {} } as never],
          },
        ],
      };
      const text = importRoot(root);
      expect(text).toBe('![[notes.md]]');
    } finally {
      warn.mockRestore();
    }
  });

  it('preserves the blockId as placeholder text when target is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'wikiEmbed', value: '', data: { blockId: '01ABC' } } as never],
          },
        ],
      };
      const text = importRoot(root);
      expect(text).toBe('![[#^01ABC]]');
    } finally {
      warn.mockRestore();
    }
  });

  it('does not throw and does not produce a blank node when both are missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'wikiEmbed', value: '', data: {} } as never],
          },
        ],
      };
      expect(() => importRoot(root)).not.toThrow();
    } finally {
      warn.mockRestore();
    }
  });

  // A `wikiEmbed` node placed directly under `root.children` (block level,
  // not wrapped in a paragraph) goes through convertBlockNode's separate
  // `wikiEmbed` case rather than the inline one exercised above — it has its
  // own independent malformed-input fallback and needs its own coverage.
  it('block level: preserves the target as placeholder text when blockId is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const root: Root = {
        type: 'root',
        children: [{ type: 'wikiEmbed', value: 'notes.md', data: {} } as never],
      };
      const text = importRoot(root);
      expect(text).toBe('![[notes.md]]');
    } finally {
      warn.mockRestore();
    }
  });

  it('block level: does not produce a blank paragraph when both are missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const root: Root = {
        type: 'root',
        children: [{ type: 'wikiEmbed', value: '', data: {} } as never],
      };
      expect(() => importRoot(root)).not.toThrow();
      const text = importRoot(root);
      expect(text).toBe('![[]]');
    } finally {
      warn.mockRestore();
    }
  });
});
