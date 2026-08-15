/**
 * Node-class completeness gate for the round-trip fixture corpus (#1 / spec FR-001).
 *
 * `editorNodes.ts` is the single source of truth for every Lexical node class the
 * production editor can construct (ADR-075). This test enumerates that list, imports
 * every fixture under `fixtures/roundtrip/` through the real
 * `parseMarkdown -> importMarkdownToLexical` pipeline, and fails — naming the offending
 * class — if any class outside the exclusion list below has zero fixtures constructing
 * it anywhere in the corpus.
 *
 * This is deliberately a *separate* test from `fixture-roundtrip.test.ts`: that suite
 * asserts each fixture round-trips correctly; this one asserts the corpus as a whole
 * covers every node class, independent of whether any individual fixture passes.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discoverFixtures, collectImportedNodeTypes, editorNodes } from './roundtrip-test-utils';
import { MarkNode } from '@lexical/mark';
import { AutoLinkNode } from '@lexical/link';
import { CodeHighlightNode } from '@lexical/code';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, 'fixtures', 'roundtrip');

/**
 * Node classes registered in `editorNodes.ts` so the *live* editor's plugins can
 * construct them during interactive editing, but which `importMarkdownToLexical`
 * itself never constructs (confirmed by inspecting `mdastToLexical.ts` — no reference
 * to any of the three exists there):
 *
 * - `MarkNode`: created only by the live annotation feature.
 * - `AutoLinkNode`: created only by the live `LinkPlugin` autolink behavior.
 * - `CodeHighlightNode`: created only by the live `registerCodeHighlighting` plugin.
 *
 * A markdown-fixture-driven completeness test can therefore never exercise these
 * structurally. Per FR-002, this list must be revisited by name — not silently
 * extended — if a future node class turns out to be similarly unreachable.
 */
const UNREACHABLE_VIA_MARKDOWN_IMPORT = new Set<string>([MarkNode.getType(), AutoLinkNode.getType(), CodeHighlightNode.getType()]);

describe('Node class completeness (round-trip fixture corpus)', () => {
  it('every editor node class outside the documented exclusion list has at least one covering fixture', async () => {
    const fixtures = discoverFixtures(FIXTURES_DIR);
    expect(fixtures.length).toBeGreaterThan(0);

    const coveredTypes = new Set<string>();
    for (const fixture of fixtures) {
      // A fixture with an `.error.txt` sidecar is expected to throw during import, so
      // it never reaches a stable Lexical tree — skip it rather than let the rejection
      // fail this test, mirroring how fixture-roundtrip.test.ts treats these fixtures.
      if (fixture.expectedError !== null) continue;

      const types = await collectImportedNodeTypes(fixture.input);
      for (const type of types) {
        coveredTypes.add(type);
      }
    }

    const requiredClasses = editorNodes.filter((klass) => !UNREACHABLE_VIA_MARKDOWN_IMPORT.has(klass.getType()));

    const missing = requiredClasses.filter((klass) => !coveredTypes.has(klass.getType())).map((klass) => klass.name);

    expect(missing, `Node classes with zero covering fixtures in fixtures/roundtrip/: ${missing.join(', ')}`).toEqual([]);
  });
});
