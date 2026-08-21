/**
 * A content reload must not take focus unless the editor already had it.
 *
 * `CursorRestorePlugin` restores the caret after `contentVersion` changes, and
 * used to end that restore with an unconditional `rootElement.focus()`. But a
 * reload is not always the user's doing: when an agent writes the file that is
 * open, the host bumps `contentVersion` too, and the focus call pulled the
 * caret out of whatever the user was typing in — a chat prompt beside the
 * editor — mid-sentence, silently redirecting keystrokes into the document.
 *
 * This is the same rule `editor-autofocus.test.tsx` covers for mount: the
 * editor never takes focus unasked. These tests exist because that rule had no
 * coverage on the reload path, where the steal was worse — it repeats on every
 * agent write, not once per mount.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import { Editor } from '../Editor';
import { EditorHostProvider } from '../../../host/context';
import type { CursorState } from '../../App';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const MARKDOWN = 'The quick brown fox jumps over the lazy dog.\n';
const RELOADED = 'The quick brown fox jumps over the lazy dog. Reloaded.\n';

/**
 * A cursor ref that is already populated, which is what makes the restore path
 * run at all — `CursorTrackingPlugin` fills it on any prior selection.
 */
function Harness({ content, contentVersion }: { content: string; contentVersion: number }) {
  const cursorRef = useRef<CursorState | null>({
    offset: 4,
    contextBefore: 'The ',
    contextAfter: 'quick',
  });
  return (
    <EditorHostProvider>
      <Editor
        initialContent={content}
        contentVersion={contentVersion}
        cursorToRestoreRef={cursorRef}
        onChange={() => {}}
      />
    </EditorHostProvider>
  );
}

/** Lets the plugin's requestAnimationFrame callback and effects settle. */
async function settleRestore(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(250);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('CursorRestorePlugin focus behaviour', () => {
  it('does not steal focus when the reload arrives while the user types elsewhere', async () => {
    vi.useFakeTimers();
    const outside = document.createElement('input');
    document.body.appendChild(outside);

    const { rerender } = render(<Harness content={MARKDOWN} contentVersion={1} />);
    await settleRestore();

    // The user moves to another input — the chat prompt, in the real case.
    outside.focus();
    expect(document.activeElement).toBe(outside);

    // An agent rewrites the open file: same signal as any other reload.
    rerender(<Harness content={RELOADED} contentVersion={2} />);
    await settleRestore();

    // Keystrokes keep going where the user aimed them.
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('still restores focus when the editor had it before the reload', async () => {
    vi.useFakeTimers();

    const { container, rerender } = render(<Harness content={MARKDOWN} contentVersion={1} />);
    await settleRestore();

    const root = container.querySelector<HTMLElement>('[contenteditable]');
    if (!root) throw new Error('editor root not found');

    // The user is editing the document itself when the reload lands.
    root.focus();
    expect(document.activeElement).toBe(root);

    rerender(<Harness content={RELOADED} contentVersion={2} />);
    await settleRestore();

    // Focus the reload disturbed is given back, not taken.
    expect(document.activeElement).toBe(root);
  });
});
