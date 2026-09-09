import { describe, it, expect } from 'vitest';
import { createEditor } from 'lexical';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { BlockAnchorNode, $createBlockAnchorNode, $isBlockAnchorNode } from './BlockAnchorNode';

const ULID = '01M00VDX0S4JHMDNA7F776Y8R8';

function withEditor(fn: () => void): void {
  const editor = createEditor({ nodes: editorNodes, onError: (e) => { throw e; } });
  editor.update(fn, { discrete: true });
}

describe('BlockAnchorNode (#122)', () => {
  it('carries the id', () => {
    withEditor(() => {
      const node = $createBlockAnchorNode(ULID);
      expect(node.getId()).toBe(ULID);
    });
  });

  it('is an inline node', () => {
    withEditor(() => {
      const node = $createBlockAnchorNode(ULID);
      expect(node.isInline()).toBe(true);
    });
  });

  it('$isBlockAnchorNode distinguishes it from other node types', () => {
    withEditor(() => {
      const node = $createBlockAnchorNode(ULID);
      expect($isBlockAnchorNode(node)).toBe(true);
      expect($isBlockAnchorNode(null)).toBe(false);
    });
  });

  it('format bitmask and marker accessors round-trip', () => {
    withEditor(() => {
      const node = $createBlockAnchorNode(ULID);
      expect(node.hasFormat('bold')).toBe(false);
      node.toggleFormat('bold');
      expect(node.hasFormat('bold')).toBe(true);
      node.setStrongMarker('_');
      expect(node.getStrongMarker()).toBe('_');
      node.setEmphasisMarker('*');
      expect(node.getEmphasisMarker()).toBe('*');
    });
  });

  it('clone() preserves every field', () => {
    withEditor(() => {
      const node = $createBlockAnchorNode(ULID);
      node.toggleFormat('italic');
      node.setEmphasisMarker('_');
      const cloned = BlockAnchorNode.clone(node);
      expect(cloned.getId()).toBe(ULID);
      expect(cloned.hasFormat('italic')).toBe(true);
      expect(cloned.getEmphasisMarker()).toBe('_');
    });
  });

  it('exportJSON/importJSON round-trips every field', () => {
    withEditor(() => {
      const node = $createBlockAnchorNode(ULID);
      node.toggleFormat('bold');
      node.setStrongMarker('*');
      const json = node.exportJSON();
      expect(json).toMatchObject({
        type: 'blockAnchor',
        id: ULID,
        strongMarker: '*',
      });

      const imported = BlockAnchorNode.importJSON(json);
      expect(imported.getId()).toBe(ULID);
      expect(imported.hasFormat('bold')).toBe(true);
      expect(imported.getStrongMarker()).toBe('*');
    });
  });

  it('exportDOM writes the id as a data attribute and a plain-text fallback', () => {
    withEditor(() => {
      const node = $createBlockAnchorNode(ULID);
      const { element } = node.exportDOM();
      expect((element as HTMLElement).getAttribute('data-block-anchor-id')).toBe(ULID);
      expect((element as HTMLElement).textContent).toBe(`^${ULID}`);
    });
  });

  it('createDOM never throws', () => {
    withEditor(() => {
      const node = $createBlockAnchorNode(ULID);
      expect(() => node.createDOM()).not.toThrow();
    });
  });
});
