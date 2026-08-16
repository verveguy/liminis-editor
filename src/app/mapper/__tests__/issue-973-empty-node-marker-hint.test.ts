/**
 * Liminis #973, review follow-up: an **empty** format-carrying `TextNode` must
 * not contribute its marker-style hint to the run it sits in.
 *
 * The #973 fix had to read the run's `--md-strong-marker` / `--md-emphasis-marker`
 * hints (now in `resolveMarkers`, originally in `convertFormattedRun`) *before* the
 * code-buffering branch, or a run whose only styled member is code-formatted
 * would never reach the read and would normalize `__` to `**` (FR-004). The
 * first cut of that change hoisted
 * the read above the pre-existing `text === ''` early-continue as well, which
 * was wider than necessary: before #973, an empty node hit `continue` before the
 * marker read and had no influence at all.
 *
 * That matters because the hints are captured with `??` — first non-null wins —
 * so an empty node *preceding* the run's real content decides the marker for the
 * whole wrapper. Lexical creates empty format-carrying `TextNode`s as caret
 * placeholders whenever a format is toggled before anything is typed, and such a
 * node can carry a stale marker style from wherever the caret has been.
 *
 * **These states are built by parsing a serialized editor state, not by
 * `editor.update()`.** Lexical's normalization strips an empty `TextNode` during
 * a live update, so an `update()`-built fixture cannot reach this code path at
 * all — it silently passes either way and proves nothing. `parseEditorState`
 * performs no such normalization, which is also why the shape is reachable in
 * production: it is the path a persisted editor state takes on load.
 */
import { describe, it, expect } from 'vitest';
import { exportLexicalToMdast } from '../lexicalToMdast';
import { stringifyMarkdown } from '../../../markdown/stringify';
import { createTestEditor } from './roundtrip-test-utils';

// Lexical's TextFormat bits.
const BOLD = 1;
const ITALIC = 2;
const CODE = 16;

interface SerializedTextNode {
  detail: number;
  format: number;
  mode: string;
  style: string;
  text: string;
  type: 'text';
  version: 1;
}

function textNode(text: string, format: number, style: string): SerializedTextNode {
  return { detail: 0, format, mode: 'normal', style, text, type: 'text', version: 1 };
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

describe('#973: empty format-carrying nodes and marker hints', () => {
  it('ignores a leading empty placeholder carrying a conflicting strong marker', () => {
    // The empty placeholder says `_` (i.e. `__bold__`); the real content says
    // `*` (i.e. `**bold**`). The real content must win.
    const output = serializeParagraph([
      textNode('', BOLD, '--md-strong-marker: _'),
      textNode('--flag', BOLD | CODE, '--md-strong-marker: *'),
      textNode(' sets the mode', BOLD, '--md-strong-marker: *'),
    ]);

    expect(output).toBe('**`--flag` sets the mode**\n');
  });

  it('ignores a leading empty placeholder carrying a conflicting emphasis marker', () => {
    const output = serializeParagraph([
      textNode('', ITALIC, '--md-emphasis-marker: _'),
      textNode('--flag', ITALIC | CODE, '--md-emphasis-marker: *'),
      textNode(' sets the mode', ITALIC, '--md-emphasis-marker: *'),
    ]);

    expect(output).toBe('*`--flag` sets the mode*\n');
  });

  it('still takes the marker from a code-only-styled run (FR-004 is not regressed)', () => {
    // Why the read had to move above the code branch in the first place: every
    // member of this run is code-formatted, so a read placed after the code
    // branch would never happen and `__` would normalize to `**`.
    const output = serializeParagraph([
      textNode('--in', BOLD | CODE, '--md-strong-marker: _'),
      textNode('--out', BOLD | CODE, '--md-strong-marker: _'),
    ]);

    expect(output).toBe('__`--in--out`__\n');
  });

  it('lets a non-empty node with a marker style set the run marker', () => {
    // The complement of the first two cases: hints from *real* content are read
    // exactly as before, so narrowing the hoist did not disable the mechanism.
    const output = serializeParagraph([
      textNode('--flag', BOLD | CODE, '--md-strong-marker: _'),
      textNode(' sets the mode', BOLD, '--md-strong-marker: _'),
    ]);

    expect(output).toBe('__`--flag` sets the mode__\n');
  });
});
