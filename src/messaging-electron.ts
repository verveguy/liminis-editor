import { UIToHostMessage, HostToUIMessage, TextEdit, validateHostToUIMessage } from './types';
import { createLogger } from '../shared/logger';

// Electron IPC adapter - replaces VS Code messaging
// This file replaces messaging.ts for Electron environment

const log = createLogger('slashmd/messaging');

// Send messages to main process
export function postMessage(message: UIToHostMessage): void {
  if (!window.api?.editor) {
    log.error('window.api.editor not available');
    return;
  }
  window.api.editor.postMessage(message).catch((err) => {
    log.error('Error posting message', err);
  });
}

export function requestInit(): void {
  log.info('Requesting init from host');
  postMessage({ type: 'REQUEST_INIT' });
}

export function requestSettings(): void {
  postMessage({ type: 'REQUEST_SETTINGS' });
}

export function applyTextEdits(
  edits: TextEdit[],
  reason: 'typing' | 'drag' | 'paste' | 'format'
): void {
  log.debug('applyTextEdits', {
    reason,
    edits: edits.map((e) => ({ start: e.start, end: e.end, newTextLen: e.newText.length }))
  });
  postMessage({ type: 'APPLY_TEXT_EDITS', edits, reason });
}

export function writeAsset(dataUri: string, suggestedName?: string): void {
  postMessage({ type: 'WRITE_ASSET', dataUri, suggestedName });
}

export function openLink(url: string): void {
  log.debug('openLink', { url });
  postMessage({ type: 'OPEN_LINK', url });
}

// Listen for messages from main process
export type MessageHandler = (message: HostToUIMessage) => void;

const messageHandlers = new Set<MessageHandler>();
const MAX_HANDLERS = 10;

export function addMessageHandler(handler: MessageHandler): () => void {
  if (messageHandlers.size >= MAX_HANDLERS) {
    log.error('Max message handlers reached. This indicates a memory leak.');
    throw new Error('Max message handlers reached. Ensure handlers are properly cleaned up.');
  }
  messageHandlers.add(handler);
  
  // Register with Electron IPC if available
  if (window.api?.editor) {
    const unsubscribe = window.api.editor.onMessage((message) => {
      // Validate message
      const validated = validateHostToUIMessage(message);
      if (validated) {
        try {
          handler(validated);
        } catch (error) {
          log.error('Error in message handler', error);
        }
      }
    });
    
    return () => {
      messageHandlers.delete(handler);
      unsubscribe();
    };
  }
  
  return () => {
    messageHandlers.delete(handler);
  };
}

// Initialize message listener
function initMessageListener(): void {
  console.log('SlashMD: Electron IPC message listener ready');
  // Message handling is set up via addMessageHandler calls
}

// Auto-initialize
initMessageListener();
