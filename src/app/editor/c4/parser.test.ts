import { describe, it, expect } from 'vitest';
import { parseC4, validateC4 } from './parser';

describe('C4 Parser', () => {
  describe('basic parsing', () => {
    it('should parse empty input', () => {
      const result = parseC4('');
      expect(result.diagram).not.toBeNull();
      expect(result.diagram!.elements).toHaveLength(0);
      expect(result.diagram!.relationships).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should parse a simple system', () => {
      const result = parseC4('system "My System" [mysys] {}');
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(1);

      const system = result.diagram!.elements[0];
      expect(system.type).toBe('system');
      expect(system.name).toBe('My System');
      expect(system.id).toBe('mysys');
    });

    it('should generate id from name if not provided', () => {
      const result = parseC4('system "My System" {}');
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements[0].id).toBe('my_system');
    });

    it('should parse element without body braces', () => {
      const result = parseC4('system "Email System" [email]');
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(1);
      expect(result.diagram!.elements[0].name).toBe('Email System');
    });
  });

  describe('element types', () => {
    it('should parse system element', () => {
      const result = parseC4('system "Banking System" [banking] {}');
      expect(result.diagram!.elements[0].type).toBe('system');
    });

    it('should parse container element', () => {
      const result = parseC4('container "Web App" [webapp] {}');
      expect(result.diagram!.elements[0].type).toBe('container');
    });

    it('should parse component element', () => {
      const result = parseC4('component "Auth Service" [auth] {}');
      expect(result.diagram!.elements[0].type).toBe('component');
    });

    it('should parse person element', () => {
      const result = parseC4('person "Customer" [customer] {}');
      expect(result.diagram!.elements[0].type).toBe('person');
    });
  });

  describe('properties', () => {
    it('should parse tech property', () => {
      const result = parseC4(`
        container "API" [api] {
          tech: "Node.js, Express"
        }
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements[0].properties.tech).toBe('Node.js, Express');
    });

    it('should parse description property', () => {
      const result = parseC4(`
        container "Database" [db] {
          description: "Stores user data"
        }
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements[0].properties.description).toBe('Stores user data');
    });

    it('should parse external property as true', () => {
      const result = parseC4(`
        system "Email" [email] {
          external: true
        }
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements[0].properties.external).toBe(true);
    });

    it('should parse external property as false', () => {
      const result = parseC4(`
        system "Internal" [internal] {
          external: false
        }
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements[0].properties.external).toBe(false);
    });

    it('should parse shape property', () => {
      const result = parseC4(`
        container "Database" [db] {
          shape: cylinder
        }
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements[0].properties.shape).toBe('cylinder');
    });

    it('should parse direction property', () => {
      const result = parseC4(`
        system "System" [sys] {
          direction: down
        }
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements[0].properties.direction).toBe('down');
    });

    it('should parse style property', () => {
      const result = parseC4(`
        system "Boundary" [boundary] {
          style: boundary
        }
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements[0].properties.style).toBe('boundary');
    });

    it('should parse multiple properties', () => {
      const result = parseC4(`
        container "API" [api] {
          tech: "Node.js"
          description: "Backend service"
          direction: right
        }
      `);
      expect(result.errors).toHaveLength(0);
      const props = result.diagram!.elements[0].properties;
      expect(props.tech).toBe('Node.js');
      expect(props.description).toBe('Backend service');
      expect(props.direction).toBe('right');
    });
  });

  describe('nested elements', () => {
    it('should parse container inside system', () => {
      const result = parseC4(`
        system "Banking" [banking] {
          container "Web App" [webapp] {
            tech: "React"
          }
        }
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(2);

      const system = result.diagram!.elements.find((e) => e.id === 'banking');
      const container = result.diagram!.elements.find((e) => e.id === 'webapp');

      expect(system).toBeDefined();
      expect(container).toBeDefined();
      expect(container!.parent).toBe('banking');
      expect(system!.children).toHaveLength(1);
      expect(system!.children[0].id).toBe('webapp');
    });

    it('should parse deeply nested elements', () => {
      const result = parseC4(`
        system "System" [sys] {
          container "Container" [cont] {
            component "Component" [comp] {
              tech: "Java"
            }
          }
        }
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(3);

      const comp = result.diagram!.elements.find((e) => e.id === 'comp');
      expect(comp!.parent).toBe('cont');
    });

    it('should parse multiple siblings', () => {
      const result = parseC4(`
        system "System" [sys] {
          container "A" [a] {}
          container "B" [b] {}
          container "C" [c] {}
        }
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(4);

      const system = result.diagram!.elements.find((e) => e.id === 'sys');
      expect(system!.children).toHaveLength(3);
    });
  });

  describe('relationships', () => {
    it('should parse simple relationship', () => {
      const result = parseC4(`
        container "A" [a] {}
        container "B" [b] {}
        a -> b: "Calls"
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.relationships).toHaveLength(1);

      const rel = result.diagram!.relationships[0];
      expect(rel.sourceId).toBe('a');
      expect(rel.targetId).toBe('b');
      expect(rel.label).toBe('Calls');
    });

    it('should parse relationship inside element body', () => {
      const result = parseC4(`
        system "System" [sys] {
          container "A" [a] {}
          container "B" [b] {}
          a -> b: "Uses"
        }
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.relationships).toHaveLength(1);
    });

    it('should parse multiple relationships', () => {
      const result = parseC4(`
        container "A" [a] {}
        container "B" [b] {}
        container "C" [c] {}
        a -> b: "First"
        b -> c: "Second"
        a -> c: "Third"
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.relationships).toHaveLength(3);
    });

    it('should parse relationship with protocol labels', () => {
      const result = parseC4(`
        container "Web" [web] {}
        container "API" [api] {}
        web -> api: "JSON/HTTPS"
      `);
      expect(result.diagram!.relationships[0].label).toBe('JSON/HTTPS');
    });
  });

  describe('comments', () => {
    it('should ignore single-line comments', () => {
      const result = parseC4(`
        // This is a comment
        system "System" [sys] {}
        // Another comment
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(1);
    });

    it('should ignore multi-line comments', () => {
      const result = parseC4(`
        /* Multi-line
           comment */
        system "System" [sys] {}
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements).toHaveLength(1);
    });
  });

  describe('complex example', () => {
    it('should parse the full example from the spec', () => {
      const code = `
        system "Internet Banking" [banking] {
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

        api -> email: "SMTP"
      `;

      const result = parseC4(code);
      expect(result.errors).toHaveLength(0);

      // Check elements
      expect(result.diagram!.elements).toHaveLength(5);

      const banking = result.diagram!.elements.find((e) => e.id === 'banking');
      expect(banking!.properties.style).toBe('boundary');
      expect(banking!.children).toHaveLength(3);

      const webapp = result.diagram!.elements.find((e) => e.id === 'webapp');
      expect(webapp!.properties.tech).toBe('React, TypeScript');
      expect(webapp!.parent).toBe('banking');

      const db = result.diagram!.elements.find((e) => e.id === 'db');
      expect(db!.properties.shape).toBe('cylinder');

      const email = result.diagram!.elements.find((e) => e.id === 'email');
      expect(email!.properties.external).toBe(true);

      // Check relationships
      expect(result.diagram!.relationships).toHaveLength(3);
      expect(result.diagram!.relationships.map((r) => r.label)).toContain('JSON/HTTPS');
      expect(result.diagram!.relationships.map((r) => r.label)).toContain('SQL/TCP');
      expect(result.diagram!.relationships.map((r) => r.label)).toContain('SMTP');
    });
  });

  describe('error handling', () => {
    it('should report missing closing brace', () => {
      const result = parseC4(`
        system "System" [sys] {
          container "Container" [cont] {
      `);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.message.includes('}'))).toBe(true);
    });

    it('should report invalid property value', () => {
      const result = parseC4(`
        system "System" [sys] {
          shape: invalid_shape
        }
      `);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.message.includes('shape'))).toBe(true);
    });

    it('should report invalid direction', () => {
      const result = parseC4(`
        system "System" [sys] {
          direction: diagonal
        }
      `);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.message.includes('direction'))).toBe(true);
    });

    it('should report line numbers in errors', () => {
      const result = parseC4(`system "System" [sys] {
  shape: bad
}`);
      expect(result.errors.length).toBeGreaterThan(0);
      const error = result.errors[0];
      expect(error.line).toBeGreaterThan(0);
      expect(error.column).toBeGreaterThan(0);
    });

    it('should continue parsing after error', () => {
      const result = parseC4(`
        system "First" [first] {
          shape: bad
        }
        system "Second" [second] {}
      `);
      // Should have error for bad shape
      expect(result.errors.length).toBeGreaterThan(0);
      // But should still parse both systems
      expect(result.diagram!.elements).toHaveLength(2);
    });
  });

  describe('escape sequences', () => {
    it('should handle escaped quotes in strings', () => {
      const result = parseC4(`
        system "Say \\"Hello\\"" [hello] {}
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements[0].name).toBe('Say "Hello"');
    });

    it('should handle escaped newlines in strings', () => {
      const result = parseC4(`
        container "Multi\\nLine" [multi] {}
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.diagram!.elements[0].name).toBe('Multi\nLine');
    });
  });
});

describe('C4 Validator', () => {
  it('should detect duplicate element IDs', () => {
    const result = parseC4(`
      system "First" [dup] {}
      system "Second" [dup] {}
    `);
    const validationErrors = validateC4(result.diagram!);
    expect(validationErrors.some((e) => e.message.includes('Duplicate'))).toBe(true);
  });

  it('should detect missing relationship source', () => {
    const result = parseC4(`
      system "Target" [target] {}
      missing -> target: "Bad"
    `);
    const validationErrors = validateC4(result.diagram!);
    expect(validationErrors.some((e) => e.message.includes('missing'))).toBe(true);
  });

  it('should detect missing relationship target', () => {
    const result = parseC4(`
      system "Source" [source] {}
      source -> missing: "Bad"
    `);
    const validationErrors = validateC4(result.diagram!);
    expect(validationErrors.some((e) => e.message.includes('missing'))).toBe(true);
  });

  it('should pass valid diagram', () => {
    const result = parseC4(`
      system "A" [a] {}
      system "B" [b] {}
      a -> b: "Valid"
    `);
    const validationErrors = validateC4(result.diagram!);
    expect(validationErrors).toHaveLength(0);
  });
});
