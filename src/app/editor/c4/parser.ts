/**
 * C4-PlantUML Parser
 *
 * Parses C4-PlantUML macro syntax into a C4 diagram AST.
 * Supports: Person, System, Container, Component (and _Ext, Db, Queue variants),
 * System_Boundary, Container_Boundary, Rel (and directional variants), BiRel.
 *
 * Strips: @startuml/@enduml, !include, SHOW_LEGEND(), LAYOUT_* directives.
 */

import type {
  C4Diagram,
  C4Element,
  C4ElementType,
  C4Properties,
  C4Relationship,
  C4Shape,
  ParseError,
  ParseResult,
} from './types';

// =============================================================================
// ELEMENT MACRO CLASSIFICATION
// =============================================================================

interface MacroInfo {
  type: C4ElementType;
  external: boolean;
  shape: C4Shape;
  /** Argument order: 'system' = (alias, label, desc), 'detail' = (alias, label, tech, desc) */
  argStyle: 'system' | 'detail';
  /** Whether this is a boundary (children expected) */
  boundary: boolean;
}

const ELEMENT_MACROS: Record<string, MacroInfo> = {
  // Person
  Person:     { type: 'person', external: false, shape: 'rectangle', argStyle: 'system', boundary: false },
  Person_Ext: { type: 'person', external: true,  shape: 'rectangle', argStyle: 'system', boundary: false },

  // System
  System:       { type: 'system', external: false, shape: 'rectangle', argStyle: 'system', boundary: false },
  System_Ext:   { type: 'system', external: true,  shape: 'rectangle', argStyle: 'system', boundary: false },
  SystemDb:     { type: 'system', external: false, shape: 'cylinder',  argStyle: 'system', boundary: false },
  SystemDb_Ext: { type: 'system', external: true,  shape: 'cylinder',  argStyle: 'system', boundary: false },
  SystemQueue:     { type: 'system', external: false, shape: 'queue', argStyle: 'system', boundary: false },
  SystemQueue_Ext: { type: 'system', external: true,  shape: 'queue', argStyle: 'system', boundary: false },

  // Container
  Container:       { type: 'container', external: false, shape: 'rectangle', argStyle: 'detail', boundary: false },
  Container_Ext:   { type: 'container', external: true,  shape: 'rectangle', argStyle: 'detail', boundary: false },
  ContainerDb:     { type: 'container', external: false, shape: 'cylinder',  argStyle: 'detail', boundary: false },
  ContainerDb_Ext: { type: 'container', external: true,  shape: 'cylinder',  argStyle: 'detail', boundary: false },
  ContainerQueue:     { type: 'container', external: false, shape: 'queue', argStyle: 'detail', boundary: false },
  ContainerQueue_Ext: { type: 'container', external: true,  shape: 'queue', argStyle: 'detail', boundary: false },

  // Component
  Component:       { type: 'component', external: false, shape: 'rectangle', argStyle: 'detail', boundary: false },
  Component_Ext:   { type: 'component', external: true,  shape: 'rectangle', argStyle: 'detail', boundary: false },
  ComponentDb:     { type: 'component', external: false, shape: 'cylinder',  argStyle: 'detail', boundary: false },
  ComponentDb_Ext: { type: 'component', external: true,  shape: 'cylinder',  argStyle: 'detail', boundary: false },
  ComponentQueue:     { type: 'component', external: false, shape: 'queue', argStyle: 'detail', boundary: false },
  ComponentQueue_Ext: { type: 'component', external: true,  shape: 'queue', argStyle: 'detail', boundary: false },

  // Boundaries
  System_Boundary:    { type: 'system',    external: false, shape: 'rectangle', argStyle: 'system', boundary: true },
  Container_Boundary: { type: 'container', external: false, shape: 'rectangle', argStyle: 'system', boundary: true },
  Enterprise_Boundary:{ type: 'system',    external: false, shape: 'rectangle', argStyle: 'system', boundary: true },
  Boundary:           { type: 'system',    external: false, shape: 'rectangle', argStyle: 'system', boundary: true },

  // Deployment nodes (C4 deployment diagrams)
  Deployment_Node:     { type: 'system', external: false, shape: 'rectangle', argStyle: 'detail', boundary: true },
  Deployment_Node_L:   { type: 'system', external: false, shape: 'rectangle', argStyle: 'detail', boundary: true },
  Deployment_Node_R:   { type: 'system', external: false, shape: 'rectangle', argStyle: 'detail', boundary: true },
  Node:                { type: 'system', external: false, shape: 'rectangle', argStyle: 'detail', boundary: true },
  Node_L:              { type: 'system', external: false, shape: 'rectangle', argStyle: 'detail', boundary: true },
  Node_R:              { type: 'system', external: false, shape: 'rectangle', argStyle: 'detail', boundary: true },
};

const REL_MACROS = new Set([
  'Rel', 'Rel_Back', 'Rel_Neighbor',
  'Rel_D', 'Rel_U', 'Rel_L', 'Rel_R',
  'BiRel', 'BiRel_D', 'BiRel_U', 'BiRel_L', 'BiRel_R',
]);

/** Directives and macros to silently skip */
const SKIP_PREFIXES = ['@startuml', '@enduml', '!include', '!define', 'SHOW_', 'LAYOUT_', 'HIDE_', 'title '];

// =============================================================================
// LINE-BASED PARSER
// =============================================================================

/**
 * Parse C4-PlantUML code into a C4 diagram AST.
 */
export function parseC4(code: string): ParseResult {
  const parser = new C4PlantUMLParser(code);
  return parser.parse();
}

/**
 * Validate that a C4 diagram is well-formed.
 * Checks for duplicate IDs, missing relationship targets, etc.
 */
export function validateC4(diagram: C4Diagram): ParseError[] {
  const errors: ParseError[] = [];
  const elementIds = new Set<string>();

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

class C4PlantUMLParser {
  private lines: string[];
  private lineNum: number = 0;
  private elements: C4Element[] = [];
  private relationships: C4Relationship[] = [];
  private errors: ParseError[] = [];

  constructor(code: string) {
    this.lines = code.split('\n');
  }

  parse(): ParseResult {
    this.parseLines(undefined);

    const diagram: C4Diagram = {
      elements: this.elements,
      relationships: this.relationships,
    };

    return {
      diagram,
      errors: this.errors,
    };
  }

  /**
   * Parse lines at the current level. If parentId is set, we're inside a boundary.
   * Stops when we hit a closing brace or run out of lines.
   */
  private parseLines(parentId: string | undefined): void {
    while (this.lineNum < this.lines.length) {
      const rawLine = this.lines[this.lineNum];
      const line = this.stripComment(rawLine).trim();

      // Empty or comment-only line
      if (line === '') {
        this.lineNum++;
        continue;
      }

      // Closing brace — return to parent
      if (line === '}' || line.startsWith('}')) {
        this.lineNum++;
        return;
      }

      // Skip directives
      if (this.isSkippable(line)) {
        this.lineNum++;
        continue;
      }

      // Extract the macro name (first word before '(')
      const macroMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
      if (!macroMatch) {
        // Unknown line
        this.errors.push({
          message: `Unrecognized syntax: '${line.slice(0, 50)}'`,
          line: this.lineNum + 1,
          column: 1,
        });
        this.lineNum++;
        continue;
      }

      const macroName = macroMatch[1];

      // Element macro
      if (macroName in ELEMENT_MACROS) {
        this.parseElementMacro(macroName, line, parentId);
        continue;
      }

      // Relationship macro
      if (REL_MACROS.has(macroName)) {
        this.parseRelMacro(line);
        this.lineNum++;
        continue;
      }

      // Unknown macro — skip
      this.errors.push({
        message: `Unknown macro: '${macroName}'`,
        line: this.lineNum + 1,
        column: 1,
      });
      this.lineNum++;
    }
  }

  /**
   * Parse an element macro like Person(alias, "Label", "Description")
   * or a boundary like System_Boundary(alias, "Label") { ... }
   */
  private parseElementMacro(macroName: string, line: string, parentId: string | undefined): void {
    const info = ELEMENT_MACROS[macroName];
    const currentLine = this.lineNum + 1;

    // Extract arguments from parentheses
    const args = this.extractArgs(line, currentLine);
    if (args === null) {
      this.lineNum++;
      return;
    }

    // First arg is always the alias (unquoted identifier)
    const alias = args[0]?.replace(/^"|"$/g, '');
    if (!alias) {
      this.errors.push({
        message: `${macroName}: missing alias (first argument)`,
        line: currentLine,
        column: 1,
      });
      this.lineNum++;
      return;
    }

    // Build properties from remaining args
    const properties: C4Properties = {};
    let name: string;

    if (info.external) properties.external = true;
    if (info.shape !== 'rectangle') properties.shape = info.shape;
    if (info.boundary) properties.style = 'boundary';

    if (info.argStyle === 'system') {
      // (alias, "label", "description")
      name = this.unquote(args[1] ?? '') || alias;
      const desc = this.unquote(args[2] ?? '');
      if (desc) properties.description = desc;
    } else {
      // (alias, "label", "technology", "description")
      name = this.unquote(args[1] ?? '') || alias;
      const tech = this.unquote(args[2] ?? '');
      const desc = this.unquote(args[3] ?? '');
      if (tech) properties.tech = tech;
      if (desc) properties.description = desc;
    }

    // Check for $tags and other named params
    for (const arg of args) {
      if (arg.startsWith('$tags=')) {
        // Could be used for styling in the future
      }
    }

    const element: C4Element = {
      type: info.type,
      id: alias,
      name,
      properties,
      children: [],
      parent: parentId,
    };

    this.elements.push(element);

    // Check if this line ends with { (boundary with children)
    const hasBrace = line.includes('{') && !line.includes('}');

    if (hasBrace) {
      this.lineNum++;
      // Parse children
      const childrenBefore = this.elements.length;
      this.parseLines(alias);
      // Link children
      for (let i = childrenBefore; i < this.elements.length; i++) {
        if (this.elements[i].parent === alias) {
          element.children.push(this.elements[i]);
        }
      }
    } else {
      this.lineNum++;
    }
  }

  /**
   * Parse a relationship macro like Rel(from, to, "label", "tech")
   */
  private parseRelMacro(line: string): void {
    const currentLine = this.lineNum + 1;
    const args = this.extractArgs(line, currentLine);
    if (args === null) return;

    if (args.length < 3) {
      this.errors.push({
        message: `Relationship requires at least 3 arguments (from, to, label)`,
        line: currentLine,
        column: 1,
      });
      return;
    }

    const sourceId = args[0].replace(/^"|"$/g, '');
    const targetId = args[1].replace(/^"|"$/g, '');
    const label = this.unquote(args[2]);
    const tech = this.unquote(args[3] ?? '');

    const fullLabel = tech ? `${label} [${tech}]` : label;

    this.relationships.push({
      sourceId,
      targetId,
      label: fullLabel,
    });
  }

  /**
   * Extract comma-separated arguments from a macro call.
   * Handles quoted strings with commas inside them.
   */
  private extractArgs(line: string, lineNum: number): string[] | null {
    // Find opening paren
    const openIdx = line.indexOf('(');
    if (openIdx === -1) {
      this.errors.push({
        message: `Expected '(' in macro call`,
        line: lineNum,
        column: 1,
      });
      return null;
    }

    // Find matching closing paren (handle nested parens in edge cases)
    let depth = 0;
    let closeIdx = -1;
    for (let i = openIdx; i < line.length; i++) {
      if (line[i] === '(') depth++;
      else if (line[i] === ')') {
        depth--;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }

    if (closeIdx === -1) {
      this.errors.push({
        message: `Unmatched '(' — missing closing ')'`,
        line: lineNum,
        column: openIdx + 1,
      });
      return null;
    }

    const inner = line.slice(openIdx + 1, closeIdx);
    return this.splitArgs(inner);
  }

  /**
   * Split a comma-separated argument string, respecting quoted strings.
   */
  private splitArgs(inner: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuote = false;
    let escaped = false;

    for (const char of inner) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        current += char;
        continue;
      }
      if (char === '"') {
        inQuote = !inQuote;
        current += char;
        continue;
      }
      if (char === ',' && !inQuote) {
        const trimmed = current.trim();
        if (trimmed) args.push(trimmed);
        current = '';
        continue;
      }
      current += char;
    }

    const trimmed = current.trim();
    if (trimmed) args.push(trimmed);

    return args;
  }

  /**
   * Remove surrounding quotes from a string argument.
   */
  private unquote(s: string): string {
    s = s.trim();
    if (s.startsWith('"') && s.endsWith('"')) {
      return s.slice(1, -1);
    }
    return s;
  }

  /**
   * Strip single-line comment (C4-PlantUML uses ' for comments)
   */
  private stripComment(line: string): string {
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') inQuote = !inQuote;
      if (line[i] === '\'' && !inQuote) {
        return line.slice(0, i);
      }
    }
    return line;
  }

  /**
   * Check if a line should be silently skipped (directives, etc.)
   */
  private isSkippable(line: string): boolean {
    return SKIP_PREFIXES.some((p) => line.startsWith(p));
  }
}
