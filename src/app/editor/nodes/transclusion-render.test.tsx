import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  resolveAndRenderTransclusion,
  renderTransclusionState,
  MAX_TRANSCLUSION_DEPTH,
  type TransclusionResolver,
} from './transclusion-render';

async function renderResult(
  file: string,
  blockId: string,
  resolver: TransclusionResolver | undefined,
  visitedPath: string[] = [],
): Promise<{ kind: string; html: string }> {
  const result = await resolveAndRenderTransclusion(file, blockId, resolver, visitedPath);
  return { kind: result.kind, html: renderToStaticMarkup(renderTransclusionState(result) as never) };
}

describe('resolveAndRenderTransclusion (#119)', () => {
  it('renders "unresolved" when no resolver is supplied (FR-008/SC-003)', async () => {
    const { kind, html } = await renderResult('notes.md', '01ABC', undefined);
    expect(kind).toBe('unresolved');
    expect(html).toContain('editor-transclusion-unresolved');
  });

  it('renders "unresolved" when the resolver returns null (FR-009)', async () => {
    const resolver: TransclusionResolver = vi.fn(async () => null);
    const { kind, html } = await renderResult('notes.md', '01ABC', resolver);
    expect(kind).toBe('unresolved');
    expect(html).toContain('editor-transclusion-unresolved');
    expect(resolver).toHaveBeenCalledWith('notes.md', '01ABC');
  });

  it('renders "unresolved" rather than throwing when the resolver rejects (FR-009)', async () => {
    const resolver: TransclusionResolver = vi.fn(async () => {
      throw new Error('boom');
    });
    const { kind } = await renderResult('notes.md', '01ABC', resolver);
    expect(kind).toBe('unresolved');
  });

  it('renders "unresolved" rather than throwing when the resolver returns a non-string value', async () => {
    // A resolver that violates its own Promise<string | null> contract (a
    // host bug, or a non-TS host) must still degrade safely instead of
    // reaching parseMarkdown with a non-string and throwing.
    const resolver = vi.fn(async () => 42) as unknown as TransclusionResolver;
    const { kind, html } = await renderResult('notes.md', '01ABC', resolver);
    expect(kind).toBe('unresolved');
    expect(html).toContain('editor-transclusion-unresolved');
  });

  it('renders resolved plain-text content', async () => {
    const resolver: TransclusionResolver = vi.fn(async () => 'Hello world');
    const { kind, html } = await renderResult('notes.md', '01ABC', resolver);
    expect(kind).toBe('resolved');
    expect(html).toContain('Hello world');
    expect(html).toContain('editor-transclusion-content');
  });

  it('renders a resolved checkbox action item with checked state', async () => {
    const resolver: TransclusionResolver = vi.fn(async () => '- [x] Draft the boundary doc');
    const { html } = await renderResult('notes.md', '01ABC', resolver);
    expect(html).toContain('Draft the boundary doc');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
  });

  it('renders inline formatting (bold/italic/code) inside resolved content', async () => {
    const resolver: TransclusionResolver = vi.fn(async () => '**bold** and *italic* and `code`');
    const { html } = await renderResult('notes.md', '01ABC', resolver);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
  });

  it('detects a direct self-reference cycle (FR-010/SC-004)', async () => {
    const resolver: TransclusionResolver = vi.fn(async (file, blockId) => `![[${file}#^${blockId}]]`);
    const { kind, html } = await renderResult('notes.md', '01ABC', resolver);
    expect(kind).toBe('resolved'); // top-level call resolves; the *nested* embed is what's circular
    expect(html).toContain('editor-transclusion-circular');
  });

  it('detects a longer A -> B -> C -> A cycle (FR-010/SC-004)', async () => {
    const chain: Record<string, string> = {
      'a.md#^A': '![[b.md#^B]]',
      'b.md#^B': '![[c.md#^C]]',
      'c.md#^C': '![[a.md#^A]]',
    };
    const resolver: TransclusionResolver = vi.fn(async (file, blockId) => chain[`${file}#^${blockId}`] ?? null);
    const { html } = await renderResult('a.md', 'A', resolver);
    expect(html).toContain('editor-transclusion-circular');
  });

  it('renders nested (non-circular) transclusion within the bound', async () => {
    const resolver: TransclusionResolver = vi.fn(async (file, blockId) => {
      if (file === 'a.md' && blockId === 'A') return 'top ![[b.md#^B]] end';
      if (file === 'b.md' && blockId === 'B') return 'nested content';
      return null;
    });
    const { html } = await renderResult('a.md', 'A', resolver);
    expect(html).toContain('top');
    expect(html).toContain('nested content');
    expect(html).toContain('end');
    expect(html).not.toContain('editor-transclusion-circular');
    expect(html).not.toContain('editor-transclusion-depth-exceeded');
  });

  it('degrades to "depth-exceeded" beyond the bounded recursion depth (FR-011/SC-004)', async () => {
    // A chain of MAX_TRANSCLUSION_DEPTH + 2 distinct blocks, each embedding the next.
    const length = MAX_TRANSCLUSION_DEPTH + 2;
    const resolver: TransclusionResolver = vi.fn(async (_file, blockId) => {
      const n = Number(blockId);
      if (n >= length) return 'leaf';
      return `![[chain.md#^${n + 1}]]`;
    });
    const { html } = await renderResult('chain.md', '0', resolver);
    expect(html).toContain('editor-transclusion-depth-exceeded');
  });

  it('does not falsely flag the same block transcluded from two unrelated sites', async () => {
    const resolver: TransclusionResolver = vi.fn(async (file, blockId) => {
      if (file === 'a.md' && blockId === 'A') return 'left ![[shared.md#^S]] right ![[shared.md#^S]] end';
      if (file === 'shared.md' && blockId === 'S') return 'shared content';
      return null;
    });
    const { html } = await renderResult('a.md', 'A', resolver);
    expect(html).not.toContain('editor-transclusion-circular');
    const occurrences = html.split('shared content').length - 1;
    expect(occurrences).toBe(2);
  });
});
