import { createCommand, type LexicalCommand } from 'lexical';

/**
 * Dispatched to open the annotation composer for the current selection,
 * carrying the kind to create. Kept in its own module so a toolbar or context
 * menu can trigger creation without importing the annotation plugin (and its
 * anchor-capture dependencies) directly.
 *
 * The listener reads the live selection itself, so there is no range in the
 * payload — the selection must still be live when this is dispatched.
 */
export const OPEN_ANNOTATION_COMPOSER_COMMAND: LexicalCommand<{ kind: string }> =
  createCommand('OPEN_ANNOTATION_COMPOSER');
