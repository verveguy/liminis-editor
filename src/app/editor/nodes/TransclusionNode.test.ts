import { describe, it, expect } from 'vitest';
import { createEditor } from 'lexical';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { TransclusionNode, $createTransclusionNode, $isTransclusionNode } from './TransclusionNode';

function withEditor(fn: () => void): void {
  const editor = createEditor({ nodes: editorNodes, onError: (e) => { throw e; } });
  editor.update(fn, { discrete: true });
}

describe('TransclusionNode (#119)', () => {
  it('carries file and blockId', () => {
    withEditor(() => {
      const node = $createTransclusionNode('notes.md', '01ABC');
      expect(node.getFile()).toBe('notes.md');
      expect(node.getBlockId()).toBe('01ABC');
      expect(node.getAlias()).toBe(null);
      expect(node.getEmptyAlias()).toBe(false);
    });
  });

  it('is an inline node', () => {
    withEditor(() => {
      const node = $createTransclusionNode('notes.md', '01ABC');
      expect(node.isInline()).toBe(true);
    });
  });

  it('$isTransclusionNode distinguishes it from other node types', () => {
    withEditor(() => {
      const node = $createTransclusionNode('notes.md', '01ABC');
      expect($isTransclusionNode(node)).toBe(true);
      expect($isTransclusionNode(null)).toBe(false);
    });
  });

  it('alias accessors round-trip (for byte-identical stringify, never rendered)', () => {
    withEditor(() => {
      const node = $createTransclusionNode('notes.md', '01ABC');
      node.setAlias('Display');
      expect(node.getAlias()).toBe('Display');
      node.setEmptyAlias(true);
      expect(node.getEmptyAlias()).toBe(true);
    });
  });

  it('clone() preserves every field', () => {
    withEditor(() => {
      const node = $createTransclusionNode('notes.md', '01ABC', 'Display', false);
      const cloned = TransclusionNode.clone(node);
      expect(cloned.getFile()).toBe('notes.md');
      expect(cloned.getBlockId()).toBe('01ABC');
      expect(cloned.getAlias()).toBe('Display');
    });
  });

  it('exportJSON/importJSON round-trips every field', () => {
    withEditor(() => {
      const node = $createTransclusionNode('notes.md', '01ABC', 'Display', false);
      const json = node.exportJSON();
      expect(json).toMatchObject({
        type: 'transclusion',
        file: 'notes.md',
        blockId: '01ABC',
        alias: 'Display',
        emptyAlias: false,
      });

      const imported = TransclusionNode.importJSON(json);
      expect(imported.getFile()).toBe('notes.md');
      expect(imported.getBlockId()).toBe('01ABC');
      expect(imported.getAlias()).toBe('Display');
    });
  });

  it('exportDOM writes the file/blockId/alias as data attributes and a plain-text placeholder', () => {
    withEditor(() => {
      const node = $createTransclusionNode('notes.md', '01ABC', 'Display');
      const { element } = node.exportDOM();
      expect((element as HTMLElement).getAttribute('data-lexical-transclusion-file')).toBe('notes.md');
      expect((element as HTMLElement).getAttribute('data-lexical-transclusion-block-id')).toBe('01ABC');
      expect((element as HTMLElement).getAttribute('data-lexical-transclusion-alias')).toBe('Display');
      // Never resolves synchronously (FR-008): a plain, inert placeholder.
      expect((element as HTMLElement).textContent).toBe('![[notes.md#^01ABC]]');
    });
  });

  it('createDOM never throws (FR-008/SC-003 — no resolver required to construct the node)', () => {
    withEditor(() => {
      const node = $createTransclusionNode('notes.md', '01ABC');
      expect(() => node.createDOM()).not.toThrow();
    });
  });
});
