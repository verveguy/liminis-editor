import { describe, it, expect } from 'vitest';
import { createEditor } from 'lexical';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { CustomLinkNode, $createCustomLinkNode } from './CustomLinkNode';

/**
 * Block-scoped wiki-link support (#119): `blockId` is carried as a field
 * separate from `url` end-to-end, so it never has to survive the lossy
 * `.md#`-anchor URL-string round trip the plain heading-anchor path uses.
 *
 * Every Lexical node has to be constructed inside an active editor context
 * (`$setNodeKey` requires one), so each case runs inside `editor.update()`.
 */
function withEditor(fn: () => void): void {
  const editor = createEditor({ nodes: editorNodes, onError: (e) => { throw e; } });
  editor.update(fn, { discrete: true });
}

describe('CustomLinkNode blockId (#119)', () => {
  it('defaults to null', () => {
    withEditor(() => {
      const link = $createCustomLinkNode('notes.md');
      expect(link.getBlockId()).toBe(null);
    });
  });

  it('get/setBlockId round-trips a value', () => {
    withEditor(() => {
      const link = $createCustomLinkNode('notes.md');
      link.setBlockId('01ABC');
      expect(link.getBlockId()).toBe('01ABC');
    });
  });

  it('clone() preserves blockId', () => {
    withEditor(() => {
      const link = $createCustomLinkNode('notes.md');
      link.setBlockId('01ABC');
      const cloned = CustomLinkNode.clone(link);
      expect(cloned.getBlockId()).toBe('01ABC');
    });
  });

  it('exportJSON/importJSON round-trips blockId', () => {
    withEditor(() => {
      const link = $createCustomLinkNode('notes.md');
      link.setBlockId('01ABC');
      const json = link.exportJSON();
      expect(json.blockId).toBe('01ABC');

      const imported = CustomLinkNode.importJSON(json);
      expect(imported.getBlockId()).toBe('01ABC');
    });
  });

  it('exportJSON omits blockId when absent', () => {
    withEditor(() => {
      const link = $createCustomLinkNode('notes.md');
      const json = link.exportJSON();
      expect(json.blockId).toBeUndefined();
    });
  });

  it('createDOM omits data-block-id for a wiki-link with no blockId', () => {
    withEditor(() => {
      const link = $createCustomLinkNode('notes.md');
      const dom = link.createDOM({ theme: {} } as never);
      expect(dom.hasAttribute('data-block-id')).toBe(false);
    });
  });

  it('createDOM includes data-block-id when set', () => {
    withEditor(() => {
      const link = $createCustomLinkNode('notes.md');
      link.setBlockId('01ABC');
      const dom = link.createDOM({ theme: {} } as never);
      expect(dom.getAttribute('data-block-id')).toBe('01ABC');
    });
  });

  it('createDOM omits data-block-id for an external link even if blockId is set', () => {
    withEditor(() => {
      const link = $createCustomLinkNode('https://example.com');
      link.setBlockId('01ABC');
      const dom = link.createDOM({ theme: {} } as never);
      expect(dom.hasAttribute('data-block-id')).toBe(false);
    });
  });
});
