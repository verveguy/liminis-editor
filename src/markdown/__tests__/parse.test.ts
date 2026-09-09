import { describe, it, expect } from 'vitest'
import {
  parseMarkdown,
  isParagraph,
  isHeading,
  isList,
  isListItem,
  isBlockquote,
  isCode,
  isThematicBreak,
  isTable,
  isImage,
  isLink,
  isHtml,
  isText,
  isStrong,
  isEmphasis,
  isInlineCode,
  isDelete,
} from '../parse'
import { stringifyMarkdown } from '../stringify'

describe('parseMarkdown', () => {
  describe('basic parsing', () => {
    it('should parse simple paragraph', () => {
      const result = parseMarkdown('Hello, world!')
      expect(result.root.type).toBe('root')
      expect(result.root.children).toHaveLength(1)
      expect(result.root.children[0].type).toBe('paragraph')
    })

    it('should parse headings at all levels', () => {
      const markdown = `# H1
## H2
### H3
#### H4
##### H5
###### H6`
      const result = parseMarkdown(markdown)
      const headings = result.root.children.filter(c => c.type === 'heading') as any[]
      expect(headings).toHaveLength(6)
      expect(headings.map(h => h.depth)).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('should parse unordered lists', () => {
      const markdown = `- Item 1
- Item 2
- Item 3`
      const result = parseMarkdown(markdown)
      expect(result.root.children).toHaveLength(1)
      const list = result.root.children[0] as any
      expect(list.type).toBe('list')
      expect(list.ordered).toBe(false)
      expect(list.children).toHaveLength(3)
    })

    it('should parse ordered lists', () => {
      const markdown = `1. First
2. Second
3. Third`
      const result = parseMarkdown(markdown)
      const list = result.root.children[0] as any
      expect(list.type).toBe('list')
      expect(list.ordered).toBe(true)
    })

    it('should parse code blocks', () => {
      const markdown = '```javascript\nconsole.log("hello")\n```'
      const result = parseMarkdown(markdown)
      const code = result.root.children[0] as any
      expect(code.type).toBe('code')
      expect(code.lang).toBe('javascript')
      expect(code.value).toBe('console.log("hello")')
    })

    it('should parse blockquotes', () => {
      const markdown = '> This is a quote'
      const result = parseMarkdown(markdown)
      expect(result.root.children[0].type).toBe('blockquote')
    })

    it('should parse thematic breaks', () => {
      const markdown = '---'
      const result = parseMarkdown(markdown)
      expect(result.root.children[0].type).toBe('thematicBreak')
    })
  })

  describe('GFM extensions', () => {
    it('should parse task lists in unordered lists', () => {
      const markdown = `- [ ] Unchecked
- [x] Checked`
      const result = parseMarkdown(markdown)
      const list = result.root.children[0] as any
      expect(list.children[0].checked).toBe(false)
      expect(list.children[1].checked).toBe(true)
    })

    it('should parse task lists in ordered lists', () => {
      const markdown = `1. [ ] Unchecked ordered
2. [x] Checked ordered`
      const result = parseMarkdown(markdown)
      const list = result.root.children[0] as any
      expect(list.ordered).toBe(true)
      expect(list.children[0].checked).toBe(false)
      expect(list.children[1].checked).toBe(true)
    })

    it('should parse tables', () => {
      const markdown = `| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |`
      const result = parseMarkdown(markdown)
      expect(result.root.children[0].type).toBe('table')
    })

    it('should parse strikethrough', () => {
      const markdown = '~~deleted~~'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      expect(paragraph.children[0].type).toBe('delete')
    })

    it('should parse autolinks', () => {
      const markdown = 'Visit https://example.com for more'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      const link = paragraph.children.find((c: any) => c.type === 'link')
      expect(link).toBeDefined()
      expect(link.url).toBe('https://example.com')
    })
  })

  describe('wiki-links', () => {
    it('should parse basic wiki-link', () => {
      const markdown = '[[my-note]]'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      expect(paragraph.children[0].type).toBe('wikiLink')
      expect(paragraph.children[0].value).toBe('my-note')
    })

    it('should parse wiki-link with alias', () => {
      const markdown = '[[my-note|Display Text]]'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      const wikiLink = paragraph.children[0]
      expect(wikiLink.type).toBe('wikiLink')
      expect(wikiLink.value).toBe('my-note')
      expect(wikiLink.data.alias).toBe('Display Text')
    })

    it('should parse wiki-link with empty alias', () => {
      const markdown = '[[my-note|]]'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      const wikiLink = paragraph.children[0]
      expect(wikiLink.type).toBe('wikiLink')
      expect(wikiLink.data._emptyAlias).toBe(true)
      expect(wikiLink.data.alias).toBe('')
    })

    it('should parse multiple wiki-links in paragraph', () => {
      const markdown = 'See [[note-a]] and [[note-b|B Note]]'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      const wikiLinks = paragraph.children.filter((c: any) => c.type === 'wikiLink')
      expect(wikiLinks).toHaveLength(2)
    })
  })

  describe('block-scoped links and transclusion (#119)', () => {
    it('parses a block-scoped link as a wikiLink carrying data.blockId', () => {
      const result = parseMarkdown('[[notes.md#^01ABC]]')
      const paragraph = result.root.children[0] as any
      const link = paragraph.children[0]
      expect(link.type).toBe('wikiLink')
      expect(link.value).toBe('notes.md')
      expect(link.data.blockId).toBe('01ABC')
    })

    it('does not set blockId for an ordinary heading anchor', () => {
      const result = parseMarkdown('[[notes.md#some-heading]]')
      const paragraph = result.root.children[0] as any
      const link = paragraph.children[0]
      expect(link.type).toBe('wikiLink')
      expect(link.value).toBe('notes.md#some-heading')
      expect(link.data.blockId ?? null).toBe(null)
    })

    it('retypes a transclusion embed to wikiEmbed', () => {
      const result = parseMarkdown('![[notes.md#^01ABC]]')
      const paragraph = result.root.children[0] as any
      expect(paragraph.children).toHaveLength(1)
      const embed = paragraph.children[0]
      expect(embed.type).toBe('wikiEmbed')
      expect(embed.value).toBe('notes.md')
      expect(embed.data.blockId).toBe('01ABC')
    })

    it('carries an alias on a transclusion embed', () => {
      const result = parseMarkdown('![[notes.md#^01ABC|Display]]')
      const paragraph = result.root.children[0] as any
      const embed = paragraph.children[0]
      expect(embed.type).toBe('wikiEmbed')
      expect(embed.data.alias).toBe('Display')
    })

    it('preserves surrounding text around an embed', () => {
      const result = parseMarkdown('before ![[notes.md#^01ABC]] after')
      const paragraph = result.root.children[0] as any
      expect(paragraph.children.map((c: any) => c.type)).toEqual(['text', 'wikiEmbed', 'text'])
      expect(paragraph.children[0].value).toBe('before ')
      expect(paragraph.children[2].value).toBe(' after')
    })

    it('does not embed a whole-file transclusion with no #^id (FR-013)', () => {
      const result = parseMarkdown('![[notes.md]]')
      const paragraph = result.root.children[0] as any
      expect(paragraph.children.map((c: any) => c.type)).toEqual(['text', 'wikiLink'])
      expect(paragraph.children[0].value).toBe('!')
      expect(paragraph.children[1].value).toBe('notes.md')
    })

    it('leaves an explicitly escaped ! before a wiki-link alone', () => {
      const result = parseMarkdown('\\![[notes.md#^01ABC]]')
      const paragraph = result.root.children[0] as any
      expect(paragraph.children.map((c: any) => c.type)).toEqual(['text', 'wikiLink'])
      expect(paragraph.children[0].value).toBe('!')
      // Explicitly escaped: stays a plain block-scoped link, not an embed.
      expect(paragraph.children[1].data.blockId).toBe('01ABC')
    })

    it('treats an even run of backslashes as not escaping the ! (CommonMark parity)', () => {
      // Two backslashes pair off into one literal `\`, so the `!` is NOT
      // escaped and this is still an embed — unlike the single-backslash
      // case above.
      const result = parseMarkdown('\\\\![[notes.md#^01ABC]]')
      const paragraph = result.root.children[0] as any
      const last = paragraph.children[paragraph.children.length - 1]
      expect(last.type).toBe('wikiEmbed')
      expect(last.data.blockId).toBe('01ABC')
      const precedingText = paragraph.children.slice(0, -1).map((c: any) => c.value ?? '').join('')
      expect(precedingText).toBe('\\')
      expect(precedingText).not.toContain('\u{E005}')
    })

    it('treats an odd run of backslashes (3) as escaping the ! (CommonMark parity)', () => {
      const result = parseMarkdown('\\\\\\![[notes.md#^01ABC]]')
      const paragraph = result.root.children[0] as any
      const last = paragraph.children[paragraph.children.length - 1]
      expect(last.type).toBe('wikiLink')
      expect(last.data.blockId).toBe('01ABC')
      const precedingText = paragraph.children.slice(0, -1).map((c: any) => c.value ?? '').join('')
      expect(precedingText).toBe('\\!')
    })

    it('parses multiple embeds and links in one paragraph', () => {
      const result = parseMarkdown('a [[b]] c ![[d#^e]] f [[g|h]] end')
      const paragraph = result.root.children[0] as any
      const types = paragraph.children.map((c: any) => c.type)
      expect(types).toEqual(['text', 'wikiLink', 'text', 'wikiEmbed', 'text', 'wikiLink', 'text'])
    })

    it('parses an embed inside a table cell', () => {
      const result = parseMarkdown('| a | ![[foo#^bar]] |\n| --- | --- |\n| 1 | 2 |')
      const table = result.root.children[0] as any
      const cell = table.children[0].children[1]
      expect(cell.children[0].type).toBe('wikiEmbed')
      expect(cell.children[0].value).toBe('foo')
      expect(cell.children[0].data.blockId).toBe('bar')
    })

    it('never leaks the embed-marker sentinel into text content', () => {
      // A malformed/unclosed wiki-link after the substituted `!` falls back
      // to plain text — the sentinel must be restored to a literal `!`.
      const result = parseMarkdown('![[unterminated')
      const paragraph = result.root.children[0] as any
      const text = paragraph.children.map((c: any) => c.value ?? '').join('')
      expect(text).not.toContain('\u{E005}')
      expect(text).toBe('![[unterminated')
    })

    it('never leaks the embed-marker sentinel into an inline code span', () => {
      // Inside a code span the wiki-link tokenizer never runs at all (the
      // content is verbatim), so there is no wikiLink node for
      // resolveWikiEmbeds's leftover-sentinel sweep to clean up around, and
      // that sweep doesn't walk into inlineCode's `value` anyway — the
      // substitution must not fire here in the first place.
      const result = parseMarkdown('Use `![[file#^id]]` syntax.')
      const paragraph = result.root.children[0] as any
      const codeNode = paragraph.children.find((c: any) => c.type === 'inlineCode')
      expect(codeNode.value).toBe('![[file#^id]]')
      expect(codeNode.value).not.toContain('\u{E005}')
    })

    it('never leaks the embed-marker sentinel into a fenced code block', () => {
      const result = parseMarkdown('```\n![[file#^id]]\n```')
      const codeNode = result.root.children[0] as any
      expect(codeNode.type).toBe('code')
      expect(codeNode.value).toBe('![[file#^id]]')
      expect(codeNode.value).not.toContain('\u{E005}')
    })
  })

  describe('wiki-links in tables', () => {
    it('should parse wiki-link with alias inside table cell', () => {
      const markdown = '| Header |\n| - |\n| [[page|alias]] |'
      const result = parseMarkdown(markdown)

      expect(result.root.children[0].type).toBe('table')
      const table = result.root.children[0] as any
      expect(table.children).toHaveLength(2) // header + data row

      const dataRow = table.children[1]
      expect(dataRow.children).toHaveLength(1) // 1 cell

      const cell = dataRow.children[0]
      expect(cell.children[0].type).toBe('wikiLink')
      expect(cell.children[0].value).toBe('page')
      expect(cell.children[0].data.alias).toBe('alias')
    })

    it('should parse multiple wiki-links with aliases in same cell', () => {
      const markdown = '| Links |\n| - |\n| [[a|A]], [[b|B]] |'
      const result = parseMarkdown(markdown)

      const table = result.root.children[0] as any
      const cell = table.children[1].children[0]

      const wikiLinks = cell.children.filter((c: any) => c.type === 'wikiLink')
      expect(wikiLinks).toHaveLength(2)
      expect(wikiLinks[0].value).toBe('a')
      expect(wikiLinks[0].data.alias).toBe('A')
      expect(wikiLinks[1].value).toBe('b')
      expect(wikiLinks[1].data.alias).toBe('B')
    })

    it('should parse wiki-link without alias in table (no regression)', () => {
      const markdown = '| Link |\n| - |\n| [[page]] |'
      const result = parseMarkdown(markdown)

      const table = result.root.children[0] as any
      const cell = table.children[1].children[0]
      expect(cell.children[0].type).toBe('wikiLink')
      expect(cell.children[0].value).toBe('page')
      // Note: mdast-util-wiki-link sets alias to target value when no explicit alias
      expect(cell.children[0].data.alias).toBe('page')
    })

    it('should parse mixed content in table cell (text + wiki-link)', () => {
      const markdown = '| Content |\n| - |\n| See [[page|link]] for details |'
      const result = parseMarkdown(markdown)

      const table = result.root.children[0] as any
      const cell = table.children[1].children[0]

      // Should have text, wiki-link, and more text
      const wikiLink = cell.children.find((c: any) => c.type === 'wikiLink')
      expect(wikiLink).toBeDefined()
      expect(wikiLink.value).toBe('page')
      expect(wikiLink.data.alias).toBe('link')

      const textNodes = cell.children.filter((c: any) => c.type === 'text')
      expect(textNodes.length).toBeGreaterThanOrEqual(1)
    })

    it('should parse wiki-link in table header row', () => {
      const markdown = '| [[page|Header Link]] |\n| - |\n| Data |'
      const result = parseMarkdown(markdown)

      const table = result.root.children[0] as any
      const headerRow = table.children[0]
      const headerCell = headerRow.children[0]

      expect(headerCell.children[0].type).toBe('wikiLink')
      expect(headerCell.children[0].value).toBe('page')
      expect(headerCell.children[0].data.alias).toBe('Header Link')
    })

    it('should round-trip wiki-links in tables', () => {
      const markdown = '| Col |\n| - |\n| [[page|alias]] |'
      const parsed = parseMarkdown(markdown)
      const stringified = stringifyMarkdown(parsed.root)
      const reparsed = parseMarkdown(stringified)

      const cell = (reparsed.root.children[0] as any).children[1].children[0]
      expect(cell.children[0].type).toBe('wikiLink')
      expect(cell.children[0].value).toBe('page')
      expect(cell.children[0].data.alias).toBe('alias')
    })

    it('should parse complex table from issue description', () => {
      const markdown = `| Time | Meeting |
| - | - |
| 10:05 am | [[meeting-note|Meeting Title]] — [[people/person|Person Name]] |`

      const result = parseMarkdown(markdown)
      const table = result.root.children[0] as any

      // Verify correct structure: 2 columns
      expect(table.children[0].children).toHaveLength(2) // header row: 2 cells
      expect(table.children[1].children).toHaveLength(2) // data row: 2 cells

      // Verify wiki-links in second cell
      const meetingCell = table.children[1].children[1]
      const wikiLinks = meetingCell.children.filter((c: any) => c.type === 'wikiLink')
      expect(wikiLinks).toHaveLength(2)
      expect(wikiLinks[0].value).toBe('meeting-note')
      expect(wikiLinks[0].data.alias).toBe('Meeting Title')
      expect(wikiLinks[1].value).toBe('people/person')
      expect(wikiLinks[1].data.alias).toBe('Person Name')
    })

    it('should parse full meeting table from issue #347', () => {
      // This is the exact markdown from the issue description
      const markdown = `| Time | Meeting | Key Outcome |
| - | - | - |
| 10:05 am | [[2026-03-05-gareth-jones|JARVIS/Tyto Architecture Sync — Gareth Jones]] (25m) — [[people/michelangelo-capraro|Michelangelo Capraro]], [[people/gareth-jones|Gareth Jones]] | Multi-agent domain boundary research collaboration initiated. |
| 10:35 am | [[2026-03-05-agentic-accelerator-leads|Agentic Acceleration - Leads check-in]] (25m) — [[people/ritesh-bansal|Ritesh Bansal]], [[people/carl-white|Carl White]] | All Hands reception confirmed positive. |`

      const result = parseMarkdown(markdown)
      const table = result.root.children[0] as any

      // Verify correct structure: 3 columns, not broken by wiki-link pipes
      expect(table.children[0].children).toHaveLength(3) // header row: 3 cells
      expect(table.children[1].children).toHaveLength(3) // data row 1: 3 cells
      expect(table.children[2].children).toHaveLength(3) // data row 2: 3 cells

      // Verify wiki-links in first data row (Meeting column)
      const row1MeetingCell = table.children[1].children[1]
      const row1WikiLinks = row1MeetingCell.children.filter((c: any) => c.type === 'wikiLink')
      expect(row1WikiLinks).toHaveLength(3)
      expect(row1WikiLinks[0].value).toBe('2026-03-05-gareth-jones')
      expect(row1WikiLinks[0].data.alias).toBe('JARVIS/Tyto Architecture Sync — Gareth Jones')
      expect(row1WikiLinks[1].value).toBe('people/michelangelo-capraro')
      expect(row1WikiLinks[2].value).toBe('people/gareth-jones')

      // Verify wiki-links in second data row (3 wiki-links)
      const row2MeetingCell = table.children[2].children[1]
      const row2WikiLinks = row2MeetingCell.children.filter((c: any) => c.type === 'wikiLink')
      expect(row2WikiLinks).toHaveLength(3)
      expect(row2WikiLinks[0].value).toBe('2026-03-05-agentic-accelerator-leads')
      expect(row2WikiLinks[0].data.alias).toBe('Agentic Acceleration - Leads check-in')
      expect(row2WikiLinks[1].value).toBe('people/ritesh-bansal')
      expect(row2WikiLinks[2].value).toBe('people/carl-white')
    })

    it('should round-trip full meeting table preserving wiki-link aliases', () => {
      const markdown = `| Time | Meeting |
| - | - |
| 10:05 am | [[meeting-note|Meeting Title]] — [[people/person|Person Name]] |`

      const parsed = parseMarkdown(markdown)
      const stringified = stringifyMarkdown(parsed.root)
      const reparsed = parseMarkdown(stringified)

      const table = reparsed.root.children[0] as any
      expect(table.children[0].children).toHaveLength(2) // Still 2 columns
      expect(table.children[1].children).toHaveLength(2)

      const meetingCell = table.children[1].children[1]
      const wikiLinks = meetingCell.children.filter((c: any) => c.type === 'wikiLink')
      expect(wikiLinks).toHaveLength(2)
      expect(wikiLinks[0].value).toBe('meeting-note')
      expect(wikiLinks[0].data.alias).toBe('Meeting Title')
      expect(wikiLinks[1].value).toBe('people/person')
      expect(wikiLinks[1].data.alias).toBe('Person Name')
    })
  })

  describe('frontmatter', () => {
    it('should parse YAML frontmatter', () => {
      const markdown = `---
title: My Note
tags: [test, sample]
---

Content here`
      const result = parseMarkdown(markdown)
      expect(result.root.children[0].type).toBe('yaml')
      const yaml = result.root.children[0] as any
      expect(yaml.value).toContain('title: My Note')
    })
  })

  describe('math', () => {
    it('should parse inline math', () => {
      const markdown = 'The equation $E = mc^2$ is famous.'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      const inlineMath = paragraph.children.find((c: any) => c.type === 'inlineMath')
      expect(inlineMath).toBeDefined()
      expect(inlineMath.value).toBe('E = mc^2')
    })

    it('should parse block math', () => {
      const markdown = `$$
\\sum_{i=1}^{n} x_i
$$`
      const result = parseMarkdown(markdown)
      const math = result.root.children[0] as any
      expect(math.type).toBe('math')
    })
  })

  describe('emphasis markers', () => {
    it('should annotate emphasis with asterisk marker', () => {
      const markdown = '*emphasized*'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      expect(paragraph.children[0].type).toBe('emphasis')
      expect(paragraph.children[0].data._emphasisMarker).toBe('*')
    })

    it('should annotate emphasis with underscore marker', () => {
      const markdown = '_emphasized_'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      expect(paragraph.children[0].type).toBe('emphasis')
      expect(paragraph.children[0].data._emphasisMarker).toBe('_')
    })

    it('should annotate strong with asterisk marker', () => {
      const markdown = '**strong**'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      expect(paragraph.children[0].type).toBe('strong')
      expect(paragraph.children[0].data._strongMarker).toBe('*')
    })

    it('should annotate strong with underscore marker', () => {
      const markdown = '__strong__'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      expect(paragraph.children[0].type).toBe('strong')
      expect(paragraph.children[0].data._strongMarker).toBe('_')
    })
  })

  describe('escaped punctuation provenance (#17)', () => {
    function textChildren(markdown: string): any[] {
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      return paragraph.children
    }

    it.each([
      ['*', 'backslash\\*star'],
      ['_', 'backslash\\_underscore'],
      ['`', 'backslash\\`tick'],
      ['[', 'backslash\\[bracket'],
      [']', 'backslash\\]bracket'],
      ['#', 'backslash\\#hash'],
      ['\\', 'backslash\\\\slash'],
    ])('flags an escaped %s as force-escaped', (char, markdown) => {
      const children = textChildren(markdown)
      const flagged = children.find((c) => c.data?._forceEscape === true)
      expect(flagged).toBeDefined()
      expect(flagged.value).toBe(char)
      // The run before the escaped char and the run after it should still
      // be present as plain text, and concatenating everything reproduces
      // the fully-decoded value.
      expect(children.map((c) => c.value).join('')).toBe(
        markdown.replace(/\\(.)/, '$1')
      )
    })

    it('does not flag a genuinely unescaped underscore', () => {
      const children = textChildren('mac_onboarding.sh')
      expect(children).toHaveLength(1)
      expect(children[0].data?._forceEscape).toBeUndefined()
      expect(children[0].value).toBe('mac_onboarding.sh')
    })

    it('does not flag a mid-sentence # (no escape present)', () => {
      const children = textChildren('a # b')
      expect(children).toHaveLength(1)
      expect(children[0].data?._forceEscape).toBeUndefined()
    })

    it('handles an escaped backslash followed by a bare underscore (\\\\_)', () => {
      // \\_ : an escaped backslash, then a plain, non-escaped underscore
      const children = textChildren('a \\\\_ b')
      const flagged = children.filter((c) => c.data?._forceEscape === true)
      expect(flagged).toHaveLength(1)
      expect(flagged[0].value).toBe('\\')
      expect(children.map((c) => c.value).join('')).toBe('a \\_ b')
    })

    it('bails out safely on a text node containing a character reference', () => {
      // &amp; decodes to '&', which desyncs the source-span replay from
      // node.value for the whole merged text node (fromMarkdown merges the
      // entity reference and surrounding literal text, including the
      // escaped asterisk, into a single text node) — so this conservatively
      // leaves the whole run unsplit rather than risk a wrong split. No
      // crash, no false flag; the pre-existing defect for this narrow
      // combination is unchanged (see splitTextNodeEscapes doc comment).
      const markdown = 'a &amp; b \\* c'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      expect(() => paragraph.children).not.toThrow()
      expect(paragraph.children).toHaveLength(1)
      expect(paragraph.children[0].value).toBe('a & b * c')
      expect(paragraph.children[0].data?._forceEscape).toBeUndefined()
    })

    it('still protects an escaped char when a character reference is in a separate text node', () => {
      // Here the entity reference and the escaped asterisk are split across
      // sibling text nodes by the emphasis span between them, so each is
      // decoded independently and the asterisk's escape is preserved.
      const markdown = 'a &amp; b *em* \\* c'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      const allText = paragraph.children.filter((c: any) => c.type === 'text')
      const flagged = allText.filter((c: any) => c.data?._forceEscape === true)
      expect(flagged).toHaveLength(1)
      expect(flagged[0].value).toBe('*')
    })

    it('leaves emphasis/strong marker annotation untouched alongside a split run', () => {
      const markdown = '*em \\_x\\_ text*'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      const emphasis = paragraph.children[0]
      expect(emphasis.type).toBe('emphasis')
      expect(emphasis.data._emphasisMarker).toBe('*')
      const flagged = emphasis.children.filter((c: any) => c.data?._forceEscape === true)
      expect(flagged).toHaveLength(2)
      expect(flagged.map((c: any) => c.value)).toEqual(['_', '_'])
    })

    it('computes accurate line/column positions for split nodes across a line break', () => {
      // Regression test (Copilot review, PR #29): split nodes previously
      // copied the original node's *start* line/column onto every sibling's
      // *end* position too, so a node split after an embedded newline got a
      // wrong (too-early) end position.
      const markdown = 'line one \\* still\nline two'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      const children = paragraph.children as any[]
      expect(children.map((c) => c.value)).toEqual(['line one ', '*', ' still\nline two'])

      const [before, star, after] = children
      expect(before.position.start).toEqual({ line: 1, column: 1, offset: 0 })
      expect(before.position.end).toEqual({ line: 1, column: 10, offset: 9 })
      expect(star.position.start).toEqual({ line: 1, column: 10, offset: 9 })
      expect(star.position.end).toEqual({ line: 1, column: 12, offset: 11 })
      // The trailing run crosses the embedded newline, so its end position
      // must land on line 2, not stay pinned to line 1.
      expect(after.position.start).toEqual({ line: 1, column: 12, offset: 11 });
      expect(after.position.end.line).toBe(2)
      expect(after.position.end.column).toBe(9)
    })
  })

  describe('block anchor badges (#122)', () => {
    const ULID = '01M00VDX0S4JHMDNA7F776Y8R8'

    function paragraphChildren(markdown: string): any[] {
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      return paragraph.children
    }

    it('splits a bare ^ULID at the end of a line into a blockAnchor node', () => {
      const children = paragraphChildren(`Draft the boundary doc ^${ULID}`)
      expect(children.map((c) => c.type)).toEqual(['text', 'blockAnchor'])
      expect(children[1].id).toBe(ULID)
      expect(children[0].value).toBe('Draft the boundary doc ')
    })

    it('renders multiple independent anchors, each split out on its own', () => {
      const ULID2 = '01M00VDX0S4JHMDNA7F776Y8R9'
      const children = paragraphChildren(`first ^${ULID} and second ^${ULID2}`)
      const anchors = children.filter((c) => c.type === 'blockAnchor')
      expect(anchors).toHaveLength(2)
      expect(anchors.map((a) => a.id)).toEqual([ULID, ULID2])
    })

    it('matches an anchor immediately after a link with no preceding space', () => {
      const children = paragraphChildren(`[[notes]]^${ULID}`)
      expect(children[0].type).toBe('wikiLink')
      expect(children[1].type).toBe('blockAnchor')
      expect(children[1].id).toBe(ULID)
    })

    it('matches an anchor immediately after emphasis with no preceding space', () => {
      const result = parseMarkdown(`*text*^${ULID}`)
      const paragraph = result.root.children[0] as any
      expect(paragraph.children[0].type).toBe('emphasis')
      expect(paragraph.children[1].type).toBe('blockAnchor')
      expect(paragraph.children[1].id).toBe(ULID)
    })

    it('leaves a caret inside an inline code span as literal text', () => {
      const children = paragraphChildren(`\`^${ULID}\``)
      expect(children).toHaveLength(1)
      expect(children[0].type).toBe('inlineCode')
      expect(children[0].value).toBe(`^${ULID}`)
    })

    it('leaves a caret inside a fenced code block as literal text', () => {
      const result = parseMarkdown('```\n^' + ULID + '\n```')
      const code = result.root.children[0] as any
      expect(code.type).toBe('code')
      expect(code.value).toBe(`^${ULID}`)
    })

    it('badges a 25-character run via Branch B even though it is one character short of a ULID (#124)', () => {
      const children = paragraphChildren('^01M00VDX0S4JHMDNA7F776Y8R') // 25 chars
      expect(children).toHaveLength(1)
      expect(children[0].type).toBe('blockAnchor')
      expect(children[0].id).toBe('01M00VDX0S4JHMDNA7F776Y8R')
    })

    it('badges the full run when a ULID-shaped id is followed by more of the same charset (widened charset, no truncation) (#124)', () => {
      const children = paragraphChildren(`^${ULID}EXTRA`)
      expect(children).toHaveLength(1)
      expect(children[0].type).toBe('blockAnchor')
      expect(children[0].id).toBe(`${ULID}EXTRA`)
    })

    it.each([
      ['x^2'],
      ['2^10'],
      ['a ^ b'],
      ['mc^2'],
      ['10^100'],
      ['The value is 2^10'],
      ['The value is 2^10 today'],
      ['A googol is 10^100'],
      ['Einstein wrote mc^2'],
      ['Compare a ^ b here'],
    ])('does not badge the non-anchor caret in %s (SC-004/FR-003)', (markdown) => {
      const children = paragraphChildren(markdown)
      expect(children.every((c) => c.type === 'text')).toBe(true)
    })

    it('does not badge a backslash-escaped caret immediately before a ULID-shaped run', () => {
      // `decoded` resolves `\^` to a plain `^` before matching, so without
      // consulting `replayDecodeEscapes`'s per-offset `escaped` flag the
      // matcher can't tell this apart from a genuine anchor — but a badge
      // here would defeat the escape the author deliberately wrote.
      const children = paragraphChildren(`escaped \\^${ULID} stays literal`)
      expect(children.every((c) => c.type === 'text')).toBe(true)
    })

    it('round-trips byte-identical through parse -> stringify', () => {
      const markdown = `- [ ] @me Draft the boundary doc by 2026-09-15 ^${ULID}\n`
      const result = parseMarkdown(markdown)
      const output = stringifyMarkdown(result.root)
      expect(output).toBe(markdown)
    })
  })

  describe('block anchor badges - widened id forms (#124)', () => {
    function paragraphChildren(markdown: string): any[] {
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      return paragraph.children
    }

    it.each([
      ['raw-decimal snowflake', '1867432905318744064'],
      ['NanoID-shaped (underscore/hyphen)', 'V1StGXR8_Z5jdHi6B-myT'],
      ['mixed-case base62', '2Xq9vBc1aZk'],
      ['UUID-shaped (hyphens)', '018f3a2c-1234-7abc-9def-0123456789ab'],
      ['short alphanumeric', 'a1b2c3'],
    ])('badges a %s id at end of line, preceded by whitespace (FR-001/SC-001)', (_label, id) => {
      const children = paragraphChildren(`A block. ^${id}`)
      expect(children.map((c) => c.type)).toEqual(['text', 'blockAnchor'])
      expect(children[1].id).toBe(id)
    })

    it('badges a bare short numeric run at line end preceded by whitespace — an accepted, rare false positive, not a bug (spec Edge Cases)', () => {
      const children = paragraphChildren('The answer is ^100')
      expect(children.map((c) => c.type)).toEqual(['text', 'blockAnchor'])
      expect(children[1].id).toBe('100')
    })

    it('agrees with the resolver position rule across every case discussed on the issue (SC-005)', () => {
      const cases: [string, boolean][] = [
        ['Ship the thing ^01KKE2V4H0B2DRJ6CEER5S4E6F', true],
        ['Ship the thing ^1867432905318744064', true],
        ['A block. ^V1StGXR8_Z5jdHi6B-myT', true],
        ['A block. ^2Xq9vBc1aZk', true],
        ['The value is 2^10 today', false],
        ['The value is 2^10', false],
        ['A googol is 10^100', false],
        ['Einstein wrote mc^2', false],
        ['Compare a ^ b here', false],
      ]
      for (const [markdown, shouldBadge] of cases) {
        const children = paragraphChildren(markdown)
        const hasAnchor = children.some((c) => c.type === 'blockAnchor')
        expect(hasAnchor).toBe(shouldBadge)
      }
    })

    it('leaves a wider-charset id inside an inline code span as literal text (FR-005)', () => {
      const children = paragraphChildren('`^a1b2c3-snowflake_id`')
      expect(children).toHaveLength(1)
      expect(children[0].type).toBe('inlineCode')
      expect(children[0].value).toBe('^a1b2c3-snowflake_id')
    })

    it('leaves a wider-charset id inside a fenced code block as literal text (FR-005)', () => {
      const result = parseMarkdown('```\n^a1b2c3-snowflake_id\n```')
      const code = result.root.children[0] as any
      expect(code.type).toBe('code')
      expect(code.value).toBe('^a1b2c3-snowflake_id')
    })

    it('leaves a wider-charset id inside inline math as literal text (FR-005)', () => {
      const result = parseMarkdown('The value $x^{a1b2c3}$ stays literal.')
      const paragraph = result.root.children[0] as any
      const inlineMath = paragraph.children.find((c: any) => c.type === 'inlineMath')
      expect(inlineMath).toBeDefined()
      expect(inlineMath.value).toBe('x^{a1b2c3}')
      expect(paragraph.children.some((c: any) => c.type === 'blockAnchor')).toBe(false)
    })

    it.each([
      ['A block ^abc\\#def', 'a delimiter mid-id, more text after'],
      ['A block ^abc\\]   ', 'a delimiter mid-id, only trailing whitespace after'],
      ['A block ^abc\\#', 'a delimiter as the final character of the line'],
    ])(
      'does not badge an id containing a backslash-escaped delimiter (%s: %s) — review finding: confirmed no badge/resolver disagreement',
      (markdown) => {
        // A `\#`/`\]` inside an id decodes to a literal `#`/`]`, which
        // WIDE_ID_CHAR excludes, so the capture truncates before that point.
        // Verified (not just asserted) that this never diverges from what a
        // raw-text match would decide: whatever follows the truncation is
        // identical, non-whitespace content either way, so the end-of-line
        // right-boundary check rejects the match under both models alike —
        // see the comment above `findBlockAnchorMatches`'s id-capture loop.
        const children = paragraphChildren(markdown)
        expect(children.some((c: any) => c.type === 'blockAnchor')).toBe(false)
      },
    )
  })
})

describe('type guards', () => {
  describe('block-level type guards', () => {
    it('isParagraph should correctly identify paragraphs', () => {
      const result = parseMarkdown('Hello')
      expect(isParagraph(result.root.children[0])).toBe(true)

      const result2 = parseMarkdown('# Heading')
      expect(isParagraph(result2.root.children[0])).toBe(false)
    })

    it('isHeading should correctly identify headings', () => {
      const result = parseMarkdown('# Heading')
      expect(isHeading(result.root.children[0])).toBe(true)

      const result2 = parseMarkdown('Paragraph')
      expect(isHeading(result2.root.children[0])).toBe(false)
    })

    it('isList should correctly identify lists', () => {
      const result = parseMarkdown('- Item')
      expect(isList(result.root.children[0])).toBe(true)

      const result2 = parseMarkdown('Not a list')
      expect(isList(result2.root.children[0])).toBe(false)
    })

    it('isListItem should correctly identify list items', () => {
      const result = parseMarkdown('- Item')
      const list = result.root.children[0] as any
      expect(isListItem(list.children[0])).toBe(true)
    })

    it('isBlockquote should correctly identify blockquotes', () => {
      const result = parseMarkdown('> Quote')
      expect(isBlockquote(result.root.children[0])).toBe(true)
    })

    it('isCode should correctly identify code blocks', () => {
      const result = parseMarkdown('```\ncode\n```')
      expect(isCode(result.root.children[0])).toBe(true)
    })

    it('isThematicBreak should correctly identify thematic breaks', () => {
      const result = parseMarkdown('---')
      expect(isThematicBreak(result.root.children[0])).toBe(true)
    })

    it('isTable should correctly identify tables', () => {
      const result = parseMarkdown('| A | B |\n| - | - |\n| 1 | 2 |')
      expect(isTable(result.root.children[0])).toBe(true)
    })

    it('isHtml should correctly identify HTML blocks', () => {
      const result = parseMarkdown('<div>HTML</div>')
      expect(isHtml(result.root.children[0])).toBe(true)
    })
  })

  describe('phrasing-level type guards', () => {
    it('isText should correctly identify text nodes', () => {
      const result = parseMarkdown('Plain text')
      const paragraph = result.root.children[0] as any
      expect(isText(paragraph.children[0])).toBe(true)
    })

    it('isStrong should correctly identify strong nodes', () => {
      const result = parseMarkdown('**bold**')
      const paragraph = result.root.children[0] as any
      expect(isStrong(paragraph.children[0])).toBe(true)
    })

    it('isEmphasis should correctly identify emphasis nodes', () => {
      const result = parseMarkdown('*italic*')
      const paragraph = result.root.children[0] as any
      expect(isEmphasis(paragraph.children[0])).toBe(true)
    })

    it('isInlineCode should correctly identify inline code', () => {
      const result = parseMarkdown('Use `code` here')
      const paragraph = result.root.children[0] as any
      const inlineCode = paragraph.children.find((c: any) => c.type === 'inlineCode')
      expect(isInlineCode(inlineCode)).toBe(true)
    })

    it('isDelete should correctly identify strikethrough', () => {
      const result = parseMarkdown('~~deleted~~')
      const paragraph = result.root.children[0] as any
      expect(isDelete(paragraph.children[0])).toBe(true)
    })

    it('isLink should correctly identify links', () => {
      const result = parseMarkdown('[Link](https://example.com)')
      const paragraph = result.root.children[0] as any
      expect(isLink(paragraph.children[0])).toBe(true)
    })

    it('isImage should correctly identify images', () => {
      const result = parseMarkdown('![Alt](image.png)')
      const paragraph = result.root.children[0] as any
      expect(isImage(paragraph.children[0])).toBe(true)
    })
  })
})
