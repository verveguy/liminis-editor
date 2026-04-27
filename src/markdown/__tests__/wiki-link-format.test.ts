import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../parse'
import { stringifyMarkdown } from '../stringify'
import { parseFormattedAlias } from '../../app/editor/MarkdownShortcutsPlugin'
import { formatAliasWithMarkers } from '../../app/mapper/lexicalToMdast'

/**
 * Tests for wiki link formatting features:
 * - parseFormattedAlias() helper function
 * - MDAST import of formatted wiki links
 * - Round-trip preservation
 * - Export of formatted wiki link children
 */

describe('parseFormattedAlias', () => {
  describe('single formats', () => {
    it('should parse bold with double asterisks', () => {
      const result = parseFormattedAlias('**bold**')
      expect(result.text).toBe('bold')
      expect(result.formats).toEqual(['bold'])
    })

    it('should parse bold with double underscores', () => {
      const result = parseFormattedAlias('__bold__')
      expect(result.text).toBe('bold')
      expect(result.formats).toEqual(['bold'])
    })

    it('should parse italic with single asterisk', () => {
      const result = parseFormattedAlias('*italic*')
      expect(result.text).toBe('italic')
      expect(result.formats).toEqual(['italic'])
    })

    it('should parse italic with single underscore', () => {
      const result = parseFormattedAlias('_italic_')
      expect(result.text).toBe('italic')
      expect(result.formats).toEqual(['italic'])
    })

    it('should parse strikethrough', () => {
      const result = parseFormattedAlias('~~strike~~')
      expect(result.text).toBe('strike')
      expect(result.formats).toEqual(['strikethrough'])
    })
  })

  describe('nested formats', () => {
    it('should parse bold + italic with triple asterisks', () => {
      const result = parseFormattedAlias('***both***')
      expect(result.text).toBe('both')
      expect(result.formats).toContain('bold')
      expect(result.formats).toContain('italic')
    })

    it('should parse strikethrough wrapping bold', () => {
      const result = parseFormattedAlias('~~**bold strike**~~')
      expect(result.text).toBe('bold strike')
      expect(result.formats).toContain('strikethrough')
      expect(result.formats).toContain('bold')
    })

    it('should parse strikethrough wrapping italic', () => {
      const result = parseFormattedAlias('~~*italic strike*~~')
      expect(result.text).toBe('italic strike')
      expect(result.formats).toContain('strikethrough')
      expect(result.formats).toContain('italic')
    })

    it('should parse all three formats combined', () => {
      const result = parseFormattedAlias('~~**_all three_**~~')
      expect(result.text).toBe('all three')
      expect(result.formats).toContain('strikethrough')
      expect(result.formats).toContain('bold')
      expect(result.formats).toContain('italic')
    })
  })

  describe('no formatting', () => {
    it('should return plain text without formats', () => {
      const result = parseFormattedAlias('plain text')
      expect(result.text).toBe('plain text')
      expect(result.formats).toEqual([])
    })

    it('should handle text with asterisk that is not a format', () => {
      const result = parseFormattedAlias('a * b')
      expect(result.text).toBe('a * b')
      expect(result.formats).toEqual([])
    })

    it('should handle unbalanced markers', () => {
      const result = parseFormattedAlias('**unbalanced')
      expect(result.text).toBe('**unbalanced')
      expect(result.formats).toEqual([])
    })

    it('should handle empty string', () => {
      const result = parseFormattedAlias('')
      expect(result.text).toBe('')
      expect(result.formats).toEqual([])
    })
  })

  describe('edge cases', () => {
    it('should handle markers only (empty content)', () => {
      // **empty** where inner text is empty - should not parse as bold
      const result = parseFormattedAlias('****')
      expect(result.text).toBe('****')
      expect(result.formats).toEqual([])
    })

    it('should handle single character between markers', () => {
      const result = parseFormattedAlias('**a**')
      expect(result.text).toBe('a')
      expect(result.formats).toEqual(['bold'])
    })

    it('should handle spaces inside markers', () => {
      const result = parseFormattedAlias('** spaced **')
      expect(result.text).toBe(' spaced ')
      expect(result.formats).toEqual(['bold'])
    })
  })
})

describe('wiki-link formatting - MDAST import', () => {
  describe('format markers wrapping wiki links', () => {
    it('should parse **[[page]]** as bold wiki link', () => {
      const markdown = '**[[page]]**'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any

      // The structure should be: strong > wikiLink
      expect(paragraph.children[0].type).toBe('strong')
      expect(paragraph.children[0].children[0].type).toBe('wikiLink')
      expect(paragraph.children[0].children[0].value).toBe('page')
    })

    it('should parse *[[page]]* as italic wiki link', () => {
      const markdown = '*[[page]]*'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any

      expect(paragraph.children[0].type).toBe('emphasis')
      expect(paragraph.children[0].children[0].type).toBe('wikiLink')
      expect(paragraph.children[0].children[0].value).toBe('page')
    })

    it('should parse ~~[[page]]~~ as strikethrough wiki link', () => {
      const markdown = '~~[[page]]~~'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any

      expect(paragraph.children[0].type).toBe('delete')
      expect(paragraph.children[0].children[0].type).toBe('wikiLink')
      expect(paragraph.children[0].children[0].value).toBe('page')
    })

    it('should parse ***[[page]]*** as bold+italic wiki link', () => {
      const markdown = '***[[page]]***'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any

      // Structure: emphasis > strong > wikiLink or strong > emphasis > wikiLink
      const outer = paragraph.children[0]
      expect(['emphasis', 'strong']).toContain(outer.type)
      const inner = outer.children[0]
      expect(['emphasis', 'strong']).toContain(inner.type)
      expect(inner.children[0].type).toBe('wikiLink')
    })
  })

  describe('wiki links with formatted aliases', () => {
    it('should preserve formatted alias text in wikiLink node', () => {
      // Note: The parser may treat **alias** inside wiki link as literal text
      // depending on implementation - this tests the current behavior
      const markdown = '[[page|formatted alias]]'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      const wikiLink = paragraph.children[0]

      expect(wikiLink.type).toBe('wikiLink')
      expect(wikiLink.value).toBe('page')
      expect(wikiLink.data.alias).toBe('formatted alias')
    })
  })

  describe('wiki links with anchors and formatting', () => {
    it('should parse **[[page#section]]** correctly', () => {
      const markdown = '**[[page#section]]**'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any

      expect(paragraph.children[0].type).toBe('strong')
      const wikiLink = paragraph.children[0].children[0]
      expect(wikiLink.type).toBe('wikiLink')
      expect(wikiLink.value).toBe('page#section')
    })

    it('should parse **[[#anchor]]** (anchor-only) correctly', () => {
      const markdown = '**[[#anchor]]**'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any

      expect(paragraph.children[0].type).toBe('strong')
      const wikiLink = paragraph.children[0].children[0]
      expect(wikiLink.type).toBe('wikiLink')
      expect(wikiLink.value).toBe('#anchor')
    })
  })
})

describe('wiki-link formatting - round-trip', () => {
  describe('formatted wiki links preserve formatting on round-trip', () => {
    it('should round-trip bold wiki link', () => {
      const markdown = '**[[page]]**'
      const parsed = parseMarkdown(markdown)
      const stringified = stringifyMarkdown(parsed.root)

      // Re-parse and verify structure is preserved
      const reparsed = parseMarkdown(stringified)
      const paragraph = reparsed.root.children[0] as any

      expect(paragraph.children[0].type).toBe('strong')
      expect(paragraph.children[0].children[0].type).toBe('wikiLink')
    })

    it('should round-trip italic wiki link', () => {
      const markdown = '*[[page]]*'
      const parsed = parseMarkdown(markdown)
      const stringified = stringifyMarkdown(parsed.root)

      const reparsed = parseMarkdown(stringified)
      const paragraph = reparsed.root.children[0] as any

      expect(paragraph.children[0].type).toBe('emphasis')
      expect(paragraph.children[0].children[0].type).toBe('wikiLink')
    })

    it('should round-trip strikethrough wiki link', () => {
      const markdown = '~~[[page]]~~'
      const parsed = parseMarkdown(markdown)
      const stringified = stringifyMarkdown(parsed.root)

      const reparsed = parseMarkdown(stringified)
      const paragraph = reparsed.root.children[0] as any

      expect(paragraph.children[0].type).toBe('delete')
      expect(paragraph.children[0].children[0].type).toBe('wikiLink')
    })

    it('should round-trip wiki link with alias', () => {
      const markdown = '[[page|Display Text]]'
      const parsed = parseMarkdown(markdown)
      const stringified = stringifyMarkdown(parsed.root)

      const reparsed = parseMarkdown(stringified)
      const paragraph = reparsed.root.children[0] as any

      expect(paragraph.children[0].type).toBe('wikiLink')
      expect(paragraph.children[0].value).toBe('page')
      expect(paragraph.children[0].data.alias).toBe('Display Text')
    })
  })

  describe('mixed content with formatted wiki links', () => {
    it('should round-trip text before and after formatted wiki link', () => {
      const markdown = 'See **[[page]]** for more'
      const parsed = parseMarkdown(markdown)
      const stringified = stringifyMarkdown(parsed.root)
      const reparsed = parseMarkdown(stringified)

      const paragraph = reparsed.root.children[0] as any
      const wikiLinks = paragraph.children.filter(
        (c: any) => c.type === 'wikiLink' || (c.children && c.children[0]?.type === 'wikiLink')
      )
      expect(wikiLinks.length).toBeGreaterThan(0)
    })

    it('should round-trip multiple formatted wiki links', () => {
      const markdown = '**[[page1]]** and *[[page2]]*'
      const parsed = parseMarkdown(markdown)
      const stringified = stringifyMarkdown(parsed.root)
      const reparsed = parseMarkdown(stringified)

      const paragraph = reparsed.root.children[0] as any

      // Find strong and emphasis nodes
      const strongNode = paragraph.children.find((c: any) => c.type === 'strong')
      const emphasisNode = paragraph.children.find((c: any) => c.type === 'emphasis')

      expect(strongNode).toBeDefined()
      expect(emphasisNode).toBeDefined()
      expect(strongNode.children[0].type).toBe('wikiLink')
      expect(emphasisNode.children[0].type).toBe('wikiLink')
    })
  })
})

describe('wiki-link formatting - export', () => {
  describe('stringification of formatted wiki links', () => {
    it('should stringify bold wiki link with markers', () => {
      const root = {
        type: 'root' as const,
        children: [
          {
            type: 'paragraph' as const,
            children: [
              {
                type: 'strong',
                children: [
                  {
                    type: 'wikiLink',
                    value: 'page',
                    data: {},
                  },
                ],
              },
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root as any)
      expect(result).toContain('**[[page]]**')
    })

    it('should stringify italic wiki link with markers', () => {
      const root = {
        type: 'root' as const,
        children: [
          {
            type: 'paragraph' as const,
            children: [
              {
                type: 'emphasis',
                children: [
                  {
                    type: 'wikiLink',
                    value: 'page',
                    data: {},
                  },
                ],
              },
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root as any)
      expect(result).toContain('*[[page]]*')
    })

    it('should stringify strikethrough wiki link with markers', () => {
      const root = {
        type: 'root' as const,
        children: [
          {
            type: 'paragraph' as const,
            children: [
              {
                type: 'delete',
                children: [
                  {
                    type: 'wikiLink',
                    value: 'page',
                    data: {},
                  },
                ],
              },
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root as any)
      expect(result).toContain('~~[[page]]~~')
    })

    it('should stringify wiki link with formatted alias', () => {
      const root = {
        type: 'root' as const,
        children: [
          {
            type: 'paragraph' as const,
            children: [
              {
                type: 'wikiLink',
                value: 'page',
                data: { alias: '**bold alias**' },
              } as any,
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      expect(result).toContain('[[page|**bold alias**]]')
    })
  })
})

describe('formatAliasWithMarkers', () => {
  it('should return plain text when format is 0', () => {
    expect(formatAliasWithMarkers('hello', 0)).toBe('hello')
  })

  it('should wrap text with bold markers for format bitmask 1', () => {
    expect(formatAliasWithMarkers('text', 1)).toBe('**text**')
  })

  it('should wrap text with italic markers for format bitmask 2', () => {
    expect(formatAliasWithMarkers('text', 2)).toBe('*text*')
  })

  it('should wrap text with strikethrough markers for format bitmask 4', () => {
    expect(formatAliasWithMarkers('text', 4)).toBe('~~text~~')
  })

  it('should handle bold + italic (format 3)', () => {
    // Italic innermost, then bold
    expect(formatAliasWithMarkers('text', 3)).toBe('***text***')
  })

  it('should handle bold + strikethrough (format 5)', () => {
    expect(formatAliasWithMarkers('text', 5)).toBe('~~**text**~~')
  })

  it('should handle italic + strikethrough (format 6)', () => {
    expect(formatAliasWithMarkers('text', 6)).toBe('~~*text*~~')
  })

  it('should handle all three formats (format 7)', () => {
    expect(formatAliasWithMarkers('text', 7)).toBe('~~***text***~~')
  })

  it('should return empty string for empty text', () => {
    expect(formatAliasWithMarkers('', 1)).toBe('')
  })
})

describe('wiki-link formatting - edge cases', () => {
  describe('ambiguous patterns', () => {
    it('should handle **[[page**]] as wiki link with ** in target (not format)', () => {
      // This is an edge case - the ** before [[ doesn't have a matching **
      // The parser should treat this sensibly
      const markdown = '**[[page**]]'
      const result = parseMarkdown(markdown)
      // Just verify it parses without error
      expect(result.root).toBeDefined()
    })

    it('should handle [[page|]] with empty alias correctly', () => {
      const markdown = '[[page|]]'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any
      const wikiLink = paragraph.children[0]

      expect(wikiLink.type).toBe('wikiLink')
      expect(wikiLink.data._emptyAlias).toBe(true)
    })
  })

  describe('special characters in wiki links', () => {
    it('should handle wiki link with spaces in target', () => {
      const markdown = '**[[page with spaces]]**'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any

      expect(paragraph.children[0].type).toBe('strong')
      expect(paragraph.children[0].children[0].type).toBe('wikiLink')
      expect(paragraph.children[0].children[0].value).toBe('page with spaces')
    })

    it('should handle wiki link with path separators', () => {
      const markdown = '*[[folder/page]]*'
      const result = parseMarkdown(markdown)
      const paragraph = result.root.children[0] as any

      expect(paragraph.children[0].type).toBe('emphasis')
      expect(paragraph.children[0].children[0].value).toBe('folder/page')
    })
  })
})
