/**
 * C4 DSL Parser
 *
 * Tokenizer and recursive descent parser for C4 architecture diagram DSL.
 * Produces an AST conforming to the types defined in types.ts.
 */

import type {
  C4Diagram,
  C4Element,
  C4ElementType,
  C4Properties,
  C4Relationship,
  C4Direction,
  C4Shape,
  C4Style,
  ParseError,
  ParseResult,
} from './types';

// =============================================================================
// TOKEN TYPES
// =============================================================================

type TokenType =
  | 'KEYWORD' // system, container, component, person
  | 'PROPERTY' // tech, description, external, shape, direction, style
  | 'STRING' // "quoted string"
  | 'IDENTIFIER' // [bracketed_id]
  | 'LBRACE' // {
  | 'RBRACE' // }
  | 'ARROW' // ->
  | 'COLON' // :
  | 'TRUE' // true
  | 'FALSE' // false
  | 'BAREWORD' // unquoted identifier (e.g., cylinder, boundary, right)
  | 'NEWLINE' // line break
  | 'EOF'; // end of input

interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

// =============================================================================
// TOKENIZER
// =============================================================================

const KEYWORDS = new Set(['system', 'container', 'component', 'person']);
const PROPERTIES = new Set([
  'tech',
  'description',
  'external',
  'shape',
  'direction',
  'style',
]);

class Tokenizer {
  private input: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private tokens: Token[] = [];
  public errors: ParseError[] = [];

  constructor(input: string) {
    this.input = input;
  }

  tokenize(): Token[] {
    while (this.pos < this.input.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.input.length) break;

      const char = this.input[this.pos];

      // Newline
      if (char === '\n') {
        this.addToken('NEWLINE', '\n');
        this.advance();
        this.line++;
        this.column = 1;
        continue;
      }

      // Skip carriage return
      if (char === '\r') {
        this.advance();
        continue;
      }

      // Single character tokens
      if (char === '{') {
        this.addToken('LBRACE', '{');
        this.advance();
        continue;
      }

      if (char === '}') {
        this.addToken('RBRACE', '}');
        this.advance();
        continue;
      }

      if (char === ':') {
        this.addToken('COLON', ':');
        this.advance();
        continue;
      }

      // Arrow ->
      if (char === '-' && this.peek(1) === '>') {
        this.addToken('ARROW', '->');
        this.advance();
        this.advance();
        continue;
      }

      // String literal
      if (char === '"') {
        this.readString();
        continue;
      }

      // Bracketed identifier [id]
      if (char === '[') {
        this.readIdentifier();
        continue;
      }

      // Word (keyword, property, bareword, true/false)
      if (this.isWordChar(char)) {
        this.readWord();
        continue;
      }

      // Unknown character - report error and skip
      this.errors.push({
        message: `Unexpected character: '${char}'`,
        line: this.line,
        column: this.column,
      });
      this.advance();
    }

    this.addToken('EOF', '');
    return this.tokens;
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.input.length) {
      const char = this.input[this.pos];

      // Skip spaces and tabs (not newlines - they're significant)
      if (char === ' ' || char === '\t') {
        this.advance();
        continue;
      }

      // Skip single-line comments
      if (char === '/' && this.peek(1) === '/') {
        while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
          this.advance();
        }
        continue;
      }

      // Skip multi-line comments
      if (char === '/' && this.peek(1) === '*') {
        this.advance(); // skip /
        this.advance(); // skip *
        while (this.pos < this.input.length) {
          if (this.input[this.pos] === '*' && this.peek(1) === '/') {
            this.advance(); // skip *
            this.advance(); // skip /
            break;
          }
          if (this.input[this.pos] === '\n') {
            this.line++;
            this.column = 0;
          }
          this.advance();
        }
        continue;
      }

      break;
    }
  }

  private readString(): void {
    const startLine = this.line;
    const startColumn = this.column;
    this.advance(); // skip opening quote

    let value = '';
    while (this.pos < this.input.length && this.input[this.pos] !== '"') {
      if (this.input[this.pos] === '\n') {
        this.errors.push({
          message: 'Unterminated string literal',
          line: startLine,
          column: startColumn,
        });
        break;
      }
      // Handle escape sequences
      if (this.input[this.pos] === '\\' && this.pos + 1 < this.input.length) {
        this.advance();
        const escaped = this.input[this.pos];
        switch (escaped) {
          case 'n':
            value += '\n';
            break;
          case 't':
            value += '\t';
            break;
          case '"':
            value += '"';
            break;
          case '\\':
            value += '\\';
            break;
          default:
            value += escaped;
        }
        this.advance();
        continue;
      }
      value += this.input[this.pos];
      this.advance();
    }

    if (this.pos < this.input.length && this.input[this.pos] === '"') {
      this.advance(); // skip closing quote
    }

    this.tokens.push({
      type: 'STRING',
      value,
      line: startLine,
      column: startColumn,
    });
  }

  private readIdentifier(): void {
    const startLine = this.line;
    const startColumn = this.column;
    this.advance(); // skip opening [

    let value = '';
    while (this.pos < this.input.length && this.input[this.pos] !== ']') {
      if (this.input[this.pos] === '\n') {
        this.errors.push({
          message: 'Unterminated identifier',
          line: startLine,
          column: startColumn,
        });
        break;
      }
      value += this.input[this.pos];
      this.advance();
    }

    if (this.pos < this.input.length && this.input[this.pos] === ']') {
      this.advance(); // skip closing ]
    }

    this.tokens.push({
      type: 'IDENTIFIER',
      value: value.trim(),
      line: startLine,
      column: startColumn,
    });
  }

  private readWord(): void {
    const startLine = this.line;
    const startColumn = this.column;
    let value = '';

    while (this.pos < this.input.length && this.isWordChar(this.input[this.pos])) {
      value += this.input[this.pos];
      this.advance();
    }

    let type: TokenType;
    if (KEYWORDS.has(value)) {
      type = 'KEYWORD';
    } else if (PROPERTIES.has(value)) {
      type = 'PROPERTY';
    } else if (value === 'true') {
      type = 'TRUE';
    } else if (value === 'false') {
      type = 'FALSE';
    } else {
      type = 'BAREWORD';
    }

    this.tokens.push({
      type,
      value,
      line: startLine,
      column: startColumn,
    });
  }

  private isWordChar(char: string): boolean {
    return /[a-zA-Z0-9_-]/.test(char);
  }

  private peek(offset: number): string | undefined {
    return this.input[this.pos + offset];
  }

  private advance(): void {
    this.pos++;
    this.column++;
  }

  private addToken(type: TokenType, value: string): void {
    this.tokens.push({
      type,
      value,
      line: this.line,
      column: this.column,
    });
  }
}

// =============================================================================
// PARSER
// =============================================================================

class Parser {
  private tokens: Token[];
  private pos: number = 0;
  public errors: ParseError[] = [];

  constructor(tokens: Token[], tokenizerErrors: ParseError[] = []) {
    this.tokens = tokens;
    this.errors = [...tokenizerErrors];
  }

  parse(): C4Diagram {
    const elements: C4Element[] = [];
    const relationships: C4Relationship[] = [];

    this.skipNewlines();

    while (!this.isAtEnd()) {
      try {
        // Check for element declaration
        if (this.check('KEYWORD')) {
          const element = this.parseElement();
          if (element) {
            elements.push(element);
          }
        }
        // Check for top-level relationship
        else if (this.check('BAREWORD') || this.check('IDENTIFIER')) {
          const rel = this.parseRelationship();
          if (rel) {
            relationships.push(rel);
          }
        }
        // Skip newlines
        else if (this.check('NEWLINE')) {
          this.advance();
        }
        // Unexpected token
        else if (!this.isAtEnd()) {
          const token = this.current();
          this.errors.push({
            message: `Unexpected token: ${token.type} '${token.value}'`,
            line: token.line,
            column: token.column,
          });
          this.advance();
        }
      } catch {
        // Recovery: skip to next line or closing brace
        this.synchronize();
      }

      this.skipNewlines();
    }

    return { elements, relationships };
  }

  private parseElement(parentId?: string): C4Element | null {
    const keyword = this.consume('KEYWORD', 'Expected element keyword');
    if (!keyword) return null;

    const elementType = keyword.value as C4ElementType;

    // Parse name (required string)
    const name = this.consume('STRING', `Expected name for ${elementType}`);
    if (!name) return null;

    // Parse optional id [bracketed]
    let id: string;
    if (this.check('IDENTIFIER')) {
      const idToken = this.advance();
      id = idToken.value;
    } else {
      // Generate id from name if not provided
      id = this.generateId(name.value);
    }

    // Parse optional body { ... }
    const properties: C4Properties = {};
    const children: C4Element[] = [];
    const relationships: C4Relationship[] = [];

    this.skipNewlines();

    if (this.check('LBRACE')) {
      this.advance(); // consume {
      this.skipNewlines();

      while (!this.check('RBRACE') && !this.isAtEnd()) {
        // Property
        if (this.check('PROPERTY')) {
          this.parseProperty(properties);
        }
        // Nested element
        else if (this.check('KEYWORD')) {
          const child = this.parseElement(id);
          if (child) {
            children.push(child);
          }
        }
        // Relationship (id -> target: "label")
        else if (this.check('BAREWORD') || this.check('IDENTIFIER')) {
          const rel = this.parseRelationship();
          if (rel) {
            relationships.push(rel);
          }
        }
        // Skip newlines
        else if (this.check('NEWLINE')) {
          this.advance();
        }
        // Unexpected
        else if (!this.check('RBRACE')) {
          const token = this.current();
          this.errors.push({
            message: `Unexpected token in ${elementType} body: ${token.type}`,
            line: token.line,
            column: token.column,
          });
          this.advance();
        }
      }

      if (!this.consume('RBRACE', `Expected '}' to close ${elementType}`)) {
        // Try to recover
      }
    }

    const element: C4Element = {
      type: elementType,
      id,
      name: name.value,
      properties,
      children,
      parent: parentId,
    };

    // Attach relationships to children for later flattening
    // Relationships are stored at diagram level, so we need to handle this
    // during AST construction
    if (relationships.length > 0) {
      // We'll attach these to a temporary property and flatten later
      (element as C4Element & { _relationships?: C4Relationship[] })._relationships =
        relationships;
    }

    return element;
  }

  private parseProperty(properties: C4Properties): void {
    const propToken = this.advance(); // PROPERTY token
    const propName = propToken.value;

    this.consume('COLON', `Expected ':' after property ${propName}`);

    // Parse property value based on property type
    if (propName === 'external') {
      if (this.check('TRUE')) {
        this.advance();
        properties.external = true;
      } else if (this.check('FALSE')) {
        this.advance();
        properties.external = false;
      } else {
        this.errors.push({
          message: `Expected 'true' or 'false' for external property`,
          line: this.current().line,
          column: this.current().column,
        });
      }
    } else if (propName === 'shape') {
      if (this.check('BAREWORD') || this.check('STRING')) {
        const value = this.advance().value;
        if (value === 'cylinder' || value === 'rectangle') {
          properties.shape = value as C4Shape;
        } else {
          this.errors.push({
            message: `Invalid shape: '${value}'. Expected 'cylinder' or 'rectangle'`,
            line: propToken.line,
            column: propToken.column,
          });
        }
      }
    } else if (propName === 'direction') {
      if (this.check('BAREWORD') || this.check('STRING')) {
        const value = this.advance().value;
        if (['right', 'down', 'left', 'up'].includes(value)) {
          properties.direction = value as C4Direction;
        } else {
          this.errors.push({
            message: `Invalid direction: '${value}'. Expected 'right', 'down', 'left', or 'up'`,
            line: propToken.line,
            column: propToken.column,
          });
        }
      }
    } else if (propName === 'style') {
      if (this.check('BAREWORD') || this.check('STRING')) {
        const value = this.advance().value;
        if (value === 'boundary') {
          properties.style = value as C4Style;
        } else {
          this.errors.push({
            message: `Invalid style: '${value}'. Expected 'boundary'`,
            line: propToken.line,
            column: propToken.column,
          });
        }
      }
    } else if (propName === 'tech' || propName === 'description') {
      if (this.check('STRING')) {
        const value = this.advance().value;
        properties[propName] = value;
      } else {
        this.errors.push({
          message: `Expected string value for ${propName}`,
          line: this.current().line,
          column: this.current().column,
        });
      }
    }

    // Skip trailing newlines after property
    this.skipNewlines();
  }

  private parseRelationship(): C4Relationship | null {
    // Get source id
    let sourceId: string;
    if (this.check('BAREWORD')) {
      sourceId = this.advance().value;
    } else if (this.check('IDENTIFIER')) {
      sourceId = this.advance().value;
    } else {
      return null;
    }

    // Expect arrow
    if (!this.check('ARROW')) {
      // Not a relationship, put back and return
      this.pos--;
      return null;
    }
    this.advance(); // consume ->

    // Get target id
    let targetId: string;
    if (this.check('BAREWORD')) {
      targetId = this.advance().value;
    } else if (this.check('IDENTIFIER')) {
      targetId = this.advance().value;
    } else {
      this.errors.push({
        message: 'Expected target identifier after arrow',
        line: this.current().line,
        column: this.current().column,
      });
      return null;
    }

    // Expect colon and label
    if (!this.consume('COLON', 'Expected \':\' after relationship target')) {
      return null;
    }

    let label = '';
    if (this.check('STRING')) {
      label = this.advance().value;
    } else {
      this.errors.push({
        message: 'Expected string label for relationship',
        line: this.current().line,
        column: this.current().column,
      });
    }

    this.skipNewlines();

    return { sourceId, targetId, label };
  }

  private generateId(name: string): string {
    // Convert name to a valid id: lowercase, replace spaces with underscores
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }

  private skipNewlines(): void {
    while (this.check('NEWLINE')) {
      this.advance();
    }
  }

  private synchronize(): void {
    // Skip until we find a safe point to resume parsing
    while (!this.isAtEnd()) {
      if (this.previous()?.type === 'NEWLINE') return;
      if (this.check('KEYWORD')) return;
      if (this.check('RBRACE')) return;
      this.advance();
    }
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.current().type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.pos++;
    return this.previous()!;
  }

  private consume(type: TokenType, message: string): Token | null {
    if (this.check(type)) {
      return this.advance();
    }

    const token = this.current();
    this.errors.push({
      message,
      line: token.line,
      column: token.column,
    });
    return null;
  }

  private current(): Token {
    return this.tokens[this.pos];
  }

  private previous(): Token | undefined {
    return this.tokens[this.pos - 1];
  }

  private isAtEnd(): boolean {
    return this.current().type === 'EOF';
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Flatten nested elements and collect all relationships from a diagram.
 * Also sets parent references correctly.
 */
function flattenDiagram(diagram: C4Diagram): C4Diagram {
  const allElements: C4Element[] = [];
  const allRelationships: C4Relationship[] = [...diagram.relationships];

  function visitElement(element: C4Element, parentId?: string): void {
    // Update parent reference
    const flatElement: C4Element = {
      ...element,
      parent: parentId,
      children: [], // Keep children for rendering, but also flatten
    };

    // Extract relationships attached during parsing
    const elementWithRels = element as C4Element & { _relationships?: C4Relationship[] };
    if (elementWithRels._relationships) {
      allRelationships.push(...elementWithRels._relationships);
      delete elementWithRels._relationships;
    }

    allElements.push(flatElement);

    // Visit children
    for (const child of element.children) {
      visitElement(child, element.id);
      flatElement.children.push(child);
    }
  }

  for (const element of diagram.elements) {
    visitElement(element);
  }

  return {
    elements: allElements,
    relationships: allRelationships,
  };
}

/**
 * Parse C4 DSL code into an AST.
 *
 * @param code - The C4 DSL source code
 * @returns ParseResult with diagram (if successful) and any errors
 */
export function parseC4(code: string): ParseResult {
  const tokenizer = new Tokenizer(code);
  const tokens = tokenizer.tokenize();

  const parser = new Parser(tokens, tokenizer.errors);
  const diagram = parser.parse();

  // Flatten nested structure and collect relationships
  const flatDiagram = flattenDiagram(diagram);

  const errors = parser.errors;

  return {
    diagram: errors.length === 0 ? flatDiagram : flatDiagram,
    errors,
  };
}

/**
 * Validate that a C4 diagram is well-formed.
 * Checks for duplicate IDs, missing relationship targets, etc.
 */
export function validateC4(diagram: C4Diagram): ParseError[] {
  const errors: ParseError[] = [];
  const elementIds = new Set<string>();

  // Check for duplicate IDs
  for (const element of diagram.elements) {
    if (elementIds.has(element.id)) {
      errors.push({
        message: `Duplicate element ID: '${element.id}'`,
        line: 0,
        column: 0,
      });
    }
    elementIds.add(element.id);
  }

  // Check relationship targets exist
  for (const rel of diagram.relationships) {
    if (!elementIds.has(rel.sourceId)) {
      errors.push({
        message: `Relationship source '${rel.sourceId}' not found`,
        line: 0,
        column: 0,
      });
    }
    if (!elementIds.has(rel.targetId)) {
      errors.push({
        message: `Relationship target '${rel.targetId}' not found`,
        line: 0,
        column: 0,
      });
    }
  }

  return errors;
}
