/**
 * Liminis #17, review follow-up (Copilot): the `--md-force-escape:1` style
 * hint is set on a `TextNode` that, at import time, is guaranteed to hold
 * exactly one force-escaped character (see `splitTextNodeEscapes` in
 * `parse.ts`). But Lexical's own reconciliation can extend that same
 * `TextNode`'s text content (keeping its style) when a user types adjacent
 * to it during live editing — nothing re-validates the hint against the
 * node's current text.
 *
 * Without a gate, a stale hint on a since-edited node would carry
 * `_forceEscape` onto the *entire* string, including characters the user
 * never escaped, and stringify would wrap all of them in a spurious,
 * meaning-changing backslash (e.g. `\a`, `\1` — not valid CommonMark escapes,
 * so the backslash itself becomes visible content). `isForceEscapableContent`
 * (`lexicalToMdast.ts`) guards against this by only trusting the hint when
 * every character of the node's live text is itself one of the seven
 * force-escapable characters.
 *
 * **These states are built by parsing a serialized editor state, not by
 * `editor.update()`**, mirroring `issue-973-empty-node-marker-hint.test.ts`:
 * Lexical's normalization would merge/adjust nodes during a live `update()`
 * in ways that don't reliably reproduce "one stale-styled node whose text
 * has grown," but a persisted editor state can carry exactly that shape (the
 * path a loaded document takes), which is what this guards against.
 */
import { describe, it, expect } from 'vitest';
import { exportLexicalToMdast } from '../lexicalToMdast';
import { stringifyMarkdown } from '../../../markdown/stringify';
import { createTestEditor } from './roundtrip-test-utils';

interface SerializedTextNode {
  detail: number;
  format: number;
  mode: string;
  style: string;
  text: string;
  type: 'text';
  version: 1;
}

function textNode(text: string, style: string): SerializedTextNode {
  return { detail: 0, format: 0, mode: 'normal', style, text, type: 'text', version: 1 };
}

/** Builds a one-paragraph editor state from serialized text nodes and serializes it to markdown. */
function serializeParagraph(children: SerializedTextNode[]): string {
  const { editor, dispose } = createTestEditor();
  try {
    const state = {
      root: {
        children: [
          { children, direction: null, format: '', indent: 0, type: 'paragraph', version: 1 },
        ],
        direction: null,
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    };

    editor.setEditorState(editor.parseEditorState(JSON.stringify(state)));
    return stringifyMarkdown(exportLexicalToMdast(editor));
  } finally {
    dispose();
  }
}

describe('#17: --md-force-escape hint on an edited (grown) TextNode', () => {
  it('still escapes a genuine single-character force-escaped node', () => {
    const output = serializeParagraph([
      textNode('a ', ''),
      textNode('_', '--md-force-escape:1;'),
      textNode(' b', ''),
    ]);

    expect(output).toBe('a \\_ b\n');
  });

  it('ignores a stale hint on a node whose text grew to include a non-escapable character', () => {
    // Simulates the user typing "a" right after a force-escaped "_", which
    // Lexical's reconciliation can fold into the same styled TextNode.
    const output = serializeParagraph([
      textNode('before ', ''),
      textNode('_a', '--md-force-escape:1;'),
      textNode(' after', ''),
    ]);

    // Must not become "before \_\a after" (or worse, "before \_a after" —
    // either way, a spurious backslash in front of a plain "a").
    expect(output).not.toMatch(/\\a/);
    expect(output).toBe('before \\_a after\n');
  });

  it('still escapes every character of a node whose text is entirely force-escapable', () => {
    // Two force-escaped characters fused into one TextNode by Lexical's
    // reconciliation (both legitimately escaped) — every character here is
    // in the force-escapable set, so the hint is trusted for all of them.
    const output = serializeParagraph([
      textNode('literal ', ''),
      textNode('**', '--md-force-escape:1;'),
      textNode(' end', ''),
    ]);

    expect(output).toBe('literal \\*\\* end\n');
  });
});
