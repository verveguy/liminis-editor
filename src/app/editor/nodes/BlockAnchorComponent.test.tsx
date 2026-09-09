import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import BlockAnchorComponent from './BlockAnchorComponent';

const ULID = '01M00VDX0S4JHMDNA7F776Y8R8';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('BlockAnchorComponent (#122)', () => {
  it('exposes the full id via the title attribute (User Story 2)', () => {
    const { container } = render(<BlockAnchorComponent id={ULID} />);
    const badge = container.querySelector('.block-anchor-badge');
    expect(badge?.getAttribute('title')).toBe(ULID);
  });

  it('copies the exact id to the clipboard when clicked (SC-003)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { ...navigator.clipboard, writeText },
    });

    const { container } = render(<BlockAnchorComponent id={ULID} />);
    const badge = container.querySelector<HTMLElement>('.block-anchor-badge')!;
    fireEvent.click(badge);

    expect(writeText).toHaveBeenCalledWith(ULID);
    await waitFor(() => {
      expect(badge.textContent).toBe('Copied');
    });
  });

  it('renders a compact marker, not the raw id, before interaction', () => {
    const { container } = render(<BlockAnchorComponent id={ULID} />);
    const badge = container.querySelector('.block-anchor-badge');
    expect(badge?.textContent).not.toContain(ULID);
  });
});
