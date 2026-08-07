/**
 * FR-006 / SC-005: proves the `./nodes` export is *sufficient on its own* — a
 * consumer importing only from `@liminis/editor`'s declared entry points
 * (`./nodes` and `./markdown` here, `lexical` itself is the peer library, not
 * a package-internal path) can build a headless editor and round-trip
 * markdown through the real mapper, with no reliance on any package-internal
 * test helper such as `roundtrip-test-utils.ts`.
 *
 * Deliberately asserts on the exported mdast tree's shape, not on
 * re-stringified markdown: `./markdown` does not export `stringifyMarkdown`,
 * and reaching for the root barrel to get it would reintroduce the
 * `<App>`/`<Editor>`/Prism weight this subpath exists to avoid (see the Plan
 * stage's Key Decisions for #954). This does not lower the fidelity bar —
 * FR-005's fidelity is unchanged — it only bounds what this particular test
 * checks.
 */
import { describe, expect, it } from 'vitest';
import { createEditor } from 'lexical';
import { editorNodes, importMarkdownToLexical, exportLexicalToMdast } from '../nodes';
import { parseMarkdown, isHeading, isList, isTable, isCode, isBlockquote, isText, isLink } from '../markdown';

const SAMPLE_MARKDOWN = `# Heading

Some [link](https://example.com) text.

- Item one
- Item two

| A | B |
| --- | --- |
| 1 | 2 |

\`\`\`js
const x = 1;
\`\`\`

![alt text](image.png)

> [!NOTE]
> This is a note.
`;

describe('./nodes subpath: headless editor round trip (FR-006, SC-005)', () => {
  it('constructs a working createEditor() from the exported node array (SC-001)', () => {
    expect(() =>
      createEditor({
        namespace: 'nodes-subpath-roundtrip-test',
        nodes: editorNodes,
        onError: (error) => {
          throw error;
        },
      }),
    ).not.toThrow();
  });

  it('round-trips representative markdown through importMarkdownToLexical -> exportLexicalToMdast (SC-002)', () => {
    const editor = createEditor({
      namespace: 'nodes-subpath-roundtrip-test',
      nodes: editorNodes,
      onError: (error) => {
        throw error;
      },
    });

    const parsed = parseMarkdown(SAMPLE_MARKDOWN);
    // `importMarkdownToLexical` schedules its own `editor.update()`, which by
    // default reconciles on a microtask — reading the export synchronously
    // right after would race it. Wrapping it in a `discrete: true` update (the
    // same convention the package's own internal round-trip helper uses)
    // forces the mutation to commit before this call returns.
    editor.update(
      () => {
        importMarkdownToLexical(editor, parsed.root);
      },
      { discrete: true },
    );
    const mdast = exportLexicalToMdast(editor);

    const [heading, linkParagraph, list, table, code, imageParagraph, callout] = mdast.children;

    if (!isHeading(heading)) throw new Error(`expected heading, got ${heading.type}`);
    expect(heading.depth).toBe(1);
    const headingText = heading.children.find(isText);
    expect(headingText?.value).toBe('Heading');

    if (linkParagraph.type !== 'paragraph') throw new Error(`expected paragraph, got ${linkParagraph.type}`);
    const link = linkParagraph.children.find(isLink);
    expect(link?.url).toBe('https://example.com');
    const linkText = link?.children.find(isText);
    expect(linkText?.value).toBe('link');

    if (!isList(list)) throw new Error(`expected list, got ${list.type}`);
    expect(list.children).toHaveLength(2);

    if (!isTable(table)) throw new Error(`expected table, got ${table.type}`);
    expect(table.children).toHaveLength(2);

    if (!isCode(code)) throw new Error(`expected code, got ${code.type}`);
    expect(code.lang).toBe('js');
    expect(code.value).toBe('const x = 1;');

    if (imageParagraph.type !== 'paragraph') throw new Error(`expected paragraph, got ${imageParagraph.type}`);
    const image = imageParagraph.children[0];
    if (image.type !== 'image') throw new Error(`expected image, got ${image.type}`);
    expect(image.url).toBe('image.png');
    expect(image.alt).toBe('alt text');

    if (!isBlockquote(callout)) throw new Error(`expected blockquote (callout), got ${callout.type}`);
    const calloutParagraph = callout.children[0];
    if (calloutParagraph.type !== 'paragraph') throw new Error('expected callout to contain a paragraph');
    const calloutPrefix = calloutParagraph.children.find(isText);
    expect(calloutPrefix?.value).toContain('[!NOTE]');
  });
});
