import { describe, it, expect } from 'vitest'
import { stringifyMarkdown } from '../stringify'
import { parseMarkdown } from '../parse'
import type { Root } from 'mdast'

describe('stringifyMarkdown', () => {
  describe('basic stringification', () => {
    it('should stringify paragraphs', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Hello, world!' }],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      expect(result.trim()).toBe('Hello, world!')
    })

    it('should stringify headings', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'heading',
            depth: 2,
            children: [{ type: 'text', value: 'My Heading' }],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      expect(result.trim()).toBe('## My Heading')
    })

    it('should stringify unordered lists with dash bullets', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'list',
            ordered: false,
            spread: false,
            children: [
              {
                type: 'listItem',
                spread: false,
                children: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', value: 'Item 1' }],
                  },
                ],
              },
              {
                type: 'listItem',
                spread: false,
                children: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', value: 'Item 2' }],
                  },
                ],
              },
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      expect(result).toContain('- Item 1')
      expect(result).toContain('- Item 2')
    })

    it('should stringify ordered lists', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'list',
            ordered: true,
            start: 1,
            spread: false,
            children: [
              {
                type: 'listItem',
                spread: false,
                children: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', value: 'First' }],
                  },
                ],
              },
              {
                type: 'listItem',
                spread: false,
                children: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', value: 'Second' }],
                  },
                ],
              },
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      expect(result).toContain('1.')
      expect(result).toContain('2.')
    })

    it('should stringify code blocks with backticks', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'code',
            lang: 'javascript',
            value: 'console.log("hello")',
          },
        ],
      }
      const result = stringifyMarkdown(root)
      expect(result).toContain('```javascript')
      expect(result).toContain('console.log("hello")')
      expect(result).toContain('```')
    })

    it('should stringify blockquotes', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'blockquote',
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'A quote' }],
              },
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      expect(result).toContain('> A quote')
    })

    it('should stringify thematic breaks as dashes', () => {
      const root: Root = {
        type: 'root',
        children: [{ type: 'thematicBreak' }],
      }
      const result = stringifyMarkdown(root)
      expect(result.trim()).toBe('---')
    })
  })

  describe('wiki-links', () => {
    it('should stringify basic wiki-link', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'wikiLink',
                value: 'my-note',
                data: {},
              } as any,
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      expect(result).toContain('[[my-note]]')
    })

    it('should stringify wiki-link with alias', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'wikiLink',
                value: 'my-note',
                data: { alias: 'Display Text' },
              } as any,
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      expect(result).toContain('[[my-note|Display Text]]')
    })

    it('should stringify wiki-link with empty alias marker', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'wikiLink',
                value: 'my-note',
                data: { alias: '', _emptyAlias: true },
              } as any,
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      expect(result).toContain('[[my-note|]]')
    })
  })

  describe('emphasis markers preservation', () => {
    it('should preserve asterisk emphasis markers', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'emphasis',
                data: { _emphasisMarker: '*' } as any,
                children: [{ type: 'text', value: 'italic' }],
              },
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      expect(result).toContain('*italic*')
    })

    it('should preserve underscore emphasis markers', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'emphasis',
                data: { _emphasisMarker: '_' } as any,
                children: [{ type: 'text', value: 'italic' }],
              },
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      expect(result).toContain('_italic_')
    })

    it('should preserve asterisk strong markers', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'strong',
                data: { _strongMarker: '*' } as any,
                children: [{ type: 'text', value: 'bold' }],
              },
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      expect(result).toContain('**bold**')
    })

    it('should preserve underscore strong markers', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'strong',
                data: { _strongMarker: '_' } as any,
                children: [{ type: 'text', value: 'bold' }],
              },
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      expect(result).toContain('__bold__')
    })
  })

  describe('ordered list checkboxes', () => {
    it('should add checkbox text to ordered list items with checked property', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'list',
            ordered: true,
            start: 1,
            spread: false,
            children: [
              {
                type: 'listItem',
                spread: false,
                checked: false,
                children: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', value: 'Task 1' }],
                  },
                ],
              },
              {
                type: 'listItem',
                spread: false,
                checked: true,
                children: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', value: 'Task 2' }],
                  },
                ],
              },
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      expect(result).toContain('[ ] Task 1')
      expect(result).toContain('[x] Task 2')
    })
  })

  describe('post-processing', () => {
    // #943 FR-002 removed the `/\n{3,}/g` collapse post-process on the grounds that
    // mdast-util-to-markdown's own join logic already never emits 3+ newlines between
    // sibling blocks. This test is the direct in-repo evidence for that claim: it
    // passes unchanged with the post-process gone. It no longer covers any Liminis
    // code — it pins the library guarantee that FR-002's removal rests on, so that
    // if a future upgrade breaks the guarantee, this fails rather than silently
    // letting blank-line runs through.
    it('never emits 3+ consecutive newlines between sibling blocks (library guarantee)', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'First' }],
          },
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Second' }],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      // Two plain sibling paragraphs: the library emits exactly one blank line between
      // them, with no post-process help from us.
      expect(result).not.toMatch(/\n{3,}/)
    })

    it('should convert backslash line breaks to two-space breaks', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'Line 1' },
              { type: 'break' },
              { type: 'text', value: 'Line 2' },
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root)
      // The result should have two spaces before newline, not backslash
      expect(result).toContain('  \n')
    })
  })

  describe('options', () => {
    it('should support asterisk bullet style', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'list',
            ordered: false,
            spread: false,
            children: [
              {
                type: 'listItem',
                spread: false,
                children: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', value: 'Item' }],
                  },
                ],
              },
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root, { bulletStyle: '*' })
      expect(result).toContain('* Item')
    })

    it('should support plus bullet style', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'list',
            ordered: false,
            spread: false,
            children: [
              {
                type: 'listItem',
                spread: false,
                children: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', value: 'Item' }],
                  },
                ],
              },
            ],
          },
        ],
      }
      const result = stringifyMarkdown(root, { bulletStyle: '+' })
      expect(result).toContain('+ Item')
    })
  })
})

describe('round-trip fidelity', () => {
  const testCases = [
    {
      name: 'simple paragraph',
      markdown: 'Hello, world!',
    },
    {
      name: 'headings',
      markdown: '# Heading 1\n\n## Heading 2',
    },
    {
      name: 'unordered list',
      markdown: '- Item 1\n- Item 2\n- Item 3',
    },
    {
      name: 'ordered list',
      markdown: '1. First\n2. Second\n3. Third',
    },
    {
      name: 'wiki-link basic',
      markdown: '[[my-note]]',
    },
    {
      name: 'wiki-link with alias',
      markdown: '[[target|Display Name]]',
    },
    {
      name: 'emphasis with asterisks',
      markdown: '*italic* and **bold**',
    },
    {
      name: 'emphasis with underscores',
      markdown: '_italic_ and __bold__',
    },
    {
      name: 'code block',
      markdown: '```javascript\nconst x = 1;\n```',
    },
    {
      name: 'blockquote',
      markdown: '> This is a quote',
    },
    {
      name: 'inline code',
      markdown: 'Use `code` here',
    },
    {
      name: 'link',
      markdown: '[Link Text](https://example.com)',
    },
    {
      name: 'image',
      markdown: '![Alt text](image.png)',
    },
    {
      name: 'strikethrough',
      markdown: '~~deleted text~~',
    },
    {
      name: 'frontmatter',
      markdown: '---\ntitle: Test\n---\n\nContent',
    },
    {
      name: 'c4 diagram',
      markdown: '```c4\nSystem(test, "Test")\n```',
    },
    {
      name: 'mermaid diagram',
      markdown: '```mermaid\nflowchart TD\n    A --> B\n```',
    },
  ]

  testCases.forEach(({ name, markdown }) => {
    it(`should round-trip ${name}`, () => {
      const parsed = parseMarkdown(markdown)
      const stringified = stringifyMarkdown(parsed.root)
      const reparsed = parseMarkdown(stringified)

      // Compare the structure (ignoring position data)
      const normalizeTree = (node: any): any => {
        if (!node || typeof node !== 'object') return node
        const { position: _position, ...rest } = node
        if (rest.children) {
          rest.children = rest.children.map(normalizeTree)
        }
        return rest
      }

      expect(normalizeTree(reparsed.root)).toEqual(normalizeTree(parsed.root))
    })
  })
})
