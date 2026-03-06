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
