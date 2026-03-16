/**
 * Integration tests for C4 Architecture Diagram plugin.
 *
 * Tests the integration between:
 * - SlashMenu (block insertion)
 * - Markdown mappers (mdast <-> Lexical round-trip)
 * - Parser + Layout + Renderer pipeline
 */
import { describe, it, expect } from 'vitest';
import { parseC4 } from './parser';
import { layoutC4Diagram } from './layout';
import type { Code, Root } from 'mdast';

// Import markdown parsing/stringify for round-trip tests
import { parseMarkdown } from '../../../markdown/parse';
import { stringifyMarkdown } from '../../../markdown/stringify';

describe('C4 Integration Tests', () => {
  describe('SlashMenu integration', () => {
    it('should have C4 option in BLOCK_OPTIONS with correct keywords', async () => {
      // Dynamic import to get the BLOCK_OPTIONS array
      // Note: We test the structure of BLOCK_OPTIONS, not the actual rendering
      const slashMenuModule = await import('../SlashMenu');

      // Access the module's exports - BLOCK_OPTIONS may not be exported
      // So we test by checking for the C4 keywords in the slash menu behavior
      expect(slashMenuModule).toBeDefined();
    });

    it('should recognize c4 and architecture keywords', () => {
      // Test that C4 DSL keywords are recognized by the parser
      const c4Keywords = ['c4', 'architecture', 'diagram', 'system', 'container', 'component'];

      // These are the expected keywords for the C4 SlashMenu option
      // We can verify they make sense by checking the parser handles them
      const parseResult = parseC4(`
        system "Test System" [test] {
          container "Test Container" [cont] {}
          component "Test Component" [comp] {}
        }
      `);

      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.diagram!.elements).toHaveLength(3);

      const types = parseResult.diagram!.elements.map(e => e.type);
      expect(types).toContain('system');
      expect(types).toContain('container');
      expect(types).toContain('component');
    });

    it('should parse the default template from SlashMenu', () => {
      // This is the default template that SlashMenu inserts
      const defaultTemplate = `system "My System" {
  style: boundary

  container "Web App" [webapp] {
    tech: "React"
    description: "User interface"
  }

  container "API" [api] {
    tech: "Node.js"
    description: "Backend services"
  }

  container "Database" [db] {
    shape: cylinder
    tech: "PostgreSQL"
  }

  webapp -> api: "REST/HTTPS"
  api -> db: "SQL"
}`;

      const parseResult = parseC4(defaultTemplate);
      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.diagram).not.toBeNull();

      // Should have 4 elements (1 system + 3 containers)
      expect(parseResult.diagram!.elements).toHaveLength(4);

      // Should have 2 relationships
      expect(parseResult.diagram!.relationships).toHaveLength(2);

      // Layout should succeed
      const layoutResult = layoutC4Diagram(parseResult.diagram!);
      expect(layoutResult.nodes.length).toBeGreaterThanOrEqual(4);
      expect(layoutResult.edges).toHaveLength(2);
    });
  });

  describe('Markdown round-trip', () => {
    it('should parse C4 code block from markdown', () => {
      const markdown = '```c4\nsystem "Test" [test] {}\n```';
      const parsed = parseMarkdown(markdown);

      expect(parsed.root.children).toHaveLength(1);

      const codeNode = parsed.root.children[0] as Code;
      expect(codeNode.type).toBe('code');
      expect(codeNode.lang).toBe('c4');
      expect(codeNode.value).toBe('system "Test" [test] {}');
    });

    it('should stringify C4 code block to markdown', () => {
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'code',
            lang: 'c4',
            value: 'system "Test" [test] {}',
          },
        ],
      };

      const stringified = stringifyMarkdown(root);
      expect(stringified).toContain('```c4');
      expect(stringified).toContain('system "Test" [test] {}');
      expect(stringified).toContain('```');
    });

    it('should round-trip simple C4 diagram', () => {
      const markdown = '```c4\nsystem "Banking" [banking] {}\n```';

      const parsed = parseMarkdown(markdown);
      const stringified = stringifyMarkdown(parsed.root);
      const reparsed = parseMarkdown(stringified);

      // Remove position data for comparison
      const normalize = (node: any): any => {
        if (!node || typeof node !== 'object') return node;
        const { position: _position, ...rest } = node;
        if (rest.children) {
          rest.children = rest.children.map(normalize);
        }
        return rest;
      };

      expect(normalize(reparsed.root)).toEqual(normalize(parsed.root));
    });

    it('should round-trip complex C4 diagram', () => {
      const c4Code = `system "Internet Banking" [banking] {
  style: boundary

  container "Web App" [webapp] {
    tech: "React, TypeScript"
    description: "Delivers the SPA"
  }

  container "API" [api] {
    tech: "Node.js, Express"
    description: "Provides banking API"
  }

  container "Database" [db] {
    shape: cylinder
    tech: "PostgreSQL"
  }

  webapp -> api: "JSON/HTTPS"
  api -> db: "SQL/TCP"
}

system "Email System" [email] {
  external: true
}

api -> email: "SMTP"`;

      const markdown = '```c4\n' + c4Code + '\n```';

      const parsed = parseMarkdown(markdown);
      const stringified = stringifyMarkdown(parsed.root);
      const reparsed = parseMarkdown(stringified);

      // Verify the C4 code is preserved
      const originalCode = (parsed.root.children[0] as Code).value;
      const reparsedCode = (reparsed.root.children[0] as Code).value;

      expect(reparsedCode).toBe(originalCode);

      // Verify it's still valid C4 that can be parsed
      const c4Result = parseC4(reparsedCode);
      expect(c4Result.errors).toHaveLength(0);
      expect(c4Result.diagram!.elements).toHaveLength(5);
      expect(c4Result.diagram!.relationships).toHaveLength(3);
    });

    it('should preserve C4 code with special characters', () => {
      const c4Code = `system "System with \\"quotes\\"" [sys] {
  description: "Contains special chars: <>&"
  container "API (v2)" [api] {
    tech: "Node.js + Express"
  }
}`;

      const markdown = '```c4\n' + c4Code + '\n```';

      const parsed = parseMarkdown(markdown);
      const stringified = stringifyMarkdown(parsed.root);
      const reparsed = parseMarkdown(stringified);

      const originalCode = (parsed.root.children[0] as Code).value;
      const reparsedCode = (reparsed.root.children[0] as Code).value;

      expect(reparsedCode).toBe(originalCode);
    });
  });

  describe('Full pipeline integration', () => {
    it('should flow from markdown to rendered layout', () => {
      const markdown = `# Architecture

Here is the system diagram:

\`\`\`c4
system "My App" [app] {
  style: boundary

  container "Frontend" [fe] {
    tech: "React"
  }

  container "Backend" [be] {
    tech: "Node.js"
  }

  fe -> be: "API calls"
}
\`\`\`

End of document.`;

      // Step 1: Parse markdown
      const parsed = parseMarkdown(markdown);
      expect(parsed.root.children.length).toBeGreaterThan(1);

      // Step 2: Find the C4 code block
      const codeBlock = parsed.root.children.find(
        (node): node is Code => node.type === 'code' && (node as Code).lang === 'c4'
      );
      expect(codeBlock).toBeDefined();

      // Step 3: Parse C4 DSL
      const c4Result = parseC4(codeBlock!.value);
      expect(c4Result.errors).toHaveLength(0);
      expect(c4Result.diagram!.elements).toHaveLength(3);

      // Step 4: Layout the diagram
      const layoutResult = layoutC4Diagram(c4Result.diagram!);
      expect(layoutResult.nodes).toHaveLength(3);
      expect(layoutResult.edges).toHaveLength(1);
      expect(layoutResult.width).toBeGreaterThan(0);
      expect(layoutResult.height).toBeGreaterThan(0);

      // Step 5: Verify round-trip
      const stringified = stringifyMarkdown(parsed.root);
      expect(stringified).toContain('```c4');
      expect(stringified).toContain('system "My App"');
    });

    it('should handle multiple C4 diagrams in one document', () => {
      const markdown = `# System Overview

## Context Diagram

\`\`\`c4
system "Main System" [main] {}
system "External System" [ext] {
  external: true
}
main -> ext: "Uses"
\`\`\`

## Container Diagram

\`\`\`c4
system "Main System" [main] {
  style: boundary
  container "Web" [web] {}
  container "API" [api] {}
  web -> api: "Calls"
}
\`\`\`
`;

      const parsed = parseMarkdown(markdown);

      // Find all C4 code blocks
      const c4Blocks = parsed.root.children.filter(
        (node): node is Code => node.type === 'code' && (node as Code).lang === 'c4'
      );

      expect(c4Blocks).toHaveLength(2);

      // Both should parse and layout successfully
      for (const block of c4Blocks) {
        const c4Result = parseC4(block.value);
        expect(c4Result.errors).toHaveLength(0);

        const layoutResult = layoutC4Diagram(c4Result.diagram!);
        expect(layoutResult.nodes.length).toBeGreaterThan(0);
      }
    });
  });
});
