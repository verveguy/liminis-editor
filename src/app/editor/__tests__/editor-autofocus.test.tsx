/**
 * The editor must not take focus unless the host asks for it.
 *
 * `AutoFocusPlugin` focuses the editor root on a 100ms timer after mount. When
 * that ran unconditionally, mounting or remounting the editor pulled the caret
 * out of whatever the user was actually typing in — an input beside it, or a
 * source pane driving the editor's own content. Because the steal is on a
 * timer, a host cannot take focus back afterwards; declining it up front is
 * the only reliable option, which is what `autoFocus` is for.
 *
 * These tests exist because the behaviour previously had no coverage at all:
 * the full suite passed both before and after the default was flipped.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { Editor } from '../Editor';
import { EditorHostProvider } from '../../../host/context';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const MARKDOWN = 'The quick brown fox jumps over the lazy dog.\n';

function renderEditor(props: Record<string, unknown> = {}) {
  return render(
    <EditorHostProvider>
      <Editor initialContent={MARKDOWN} onChange={() => {}} {...props} />
    </EditorHostProvider>,
  );
}

/** Runs past the plugin's 100ms delay and lets its effects settle. */
async function settleAutoFocusWindow(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(250);
    await Promise.resolve();
  });
}

describe('Editor autofocus', () => {
  it('does not take focus by default', async () => {
    vi.useFakeTimers();
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    renderEditor();
    await settleAutoFocusWindow();

    // The caret stays where the user put it.
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('takes focus when the host opts in', async () => {
    vi.useFakeTimers();
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();

    const { container } = renderEditor({ autoFocus: true });
    await settleAutoFocusWindow();

    const root = container.querySelector('[contenteditable]');
    expect(root).not.toBeNull();
    expect(document.activeElement).toBe(root);
    outside.remove();
  });

  it('leaves focus alone on remount, which is when the steal was worst', async () => {
    vi.useFakeTimers();
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();

    const { rerender } = render(
      <EditorHostProvider>
        <Editor key="1" initialContent={MARKDOWN} onChange={() => {}} />
      </EditorHostProvider>,
    );
    await settleAutoFocusWindow();

    // A new key remounts the editor — the shape a host uses to push fresh
    // content into it, and the case that made the steal visible.
    rerender(
      <EditorHostProvider>
        <Editor key="2" initialContent={`${MARKDOWN}More text.\n`} onChange={() => {}} />
      </EditorHostProvider>,
    );
    await settleAutoFocusWindow();

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
