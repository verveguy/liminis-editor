/**
 * The Lexical node classes the production editor configures its
 * `LexicalComposer` with — extracted into its own module so it can be the
 * single source of truth for both `Editor.tsx` and the public `./nodes`
 * entry point (see #954 / ADR-075). A hand-maintained second copy of this
 * list is exactly the drift risk this module exists to eliminate.
 */
import type { Klass, LexicalNode } from 'lexical';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { AutoLinkNode } from '@lexical/link';
import { MarkNode } from '@lexical/mark';
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table';
import {
  CalloutNode,
  ToggleContainerNode,
  ToggleTitleNode,
  ToggleContentNode,
  ImageNode,
  HorizontalRuleNode,
  EquationNode,
  MermaidNode,
  C4Node,
  FrontmatterNode,
  FootnoteNode,
  HtmlNode,
  ListItemParagraphBreakNode,
  CustomLinkNode,
  CustomListNode,
  DefinitionListNode,
  DefinitionTermNode,
  DefinitionDescriptionNode,
  CustomListItemNode,
} from './nodes';

export const editorNodes: Klass<LexicalNode>[] = [
  HeadingNode,
  QuoteNode,
  CustomListNode,  // Replaces ListNode - uses same type 'list' but carries spread (loose/tight) state
  CustomListItemNode,  // Replaces ListItemNode - uses same type 'listitem' but carries per-item task-checked state
  CodeNode,
  CodeHighlightNode,
  CustomLinkNode,  // Replaces LinkNode - uses same type 'link' but renders data-href
  AutoLinkNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  CalloutNode,
  ToggleContainerNode,
  ToggleTitleNode,
  ToggleContentNode,
  ImageNode,
  HorizontalRuleNode,
  EquationNode,
  MermaidNode,
  C4Node,
  FrontmatterNode,
  FootnoteNode,
  DefinitionListNode,
  DefinitionTermNode,
  DefinitionDescriptionNode,
  HtmlNode,
  ListItemParagraphBreakNode,
  MarkNode,  // Annotation live marks (see ADR-077); inert unless an annotation kind is configured
];
