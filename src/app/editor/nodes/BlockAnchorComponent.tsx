/**
 * BlockAnchorComponent — the compact badge a `BlockAnchorNode` decorates
 * itself with (#122).
 *
 * User Story 2 (the id must remain readable and copyable) is satisfied with
 * no new interaction pattern: the full id is exposed via the native `title`
 * tooltip on hover, and a click copies it via `navigator.clipboard.writeText`
 * with brief "Copied" feedback — mirroring `CodeBlockPlugin.tsx`'s existing
 * copy-button pattern.
 */
import { useCallback, useState } from 'react';

interface BlockAnchorComponentProps {
  id: string;
}

const COPIED_FEEDBACK_MS = 1500;

export default function BlockAnchorComponent({ id }: BlockAnchorComponentProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(() => {
    void navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    });
  }, [id]);

  return (
    <button
      type="button"
      className="block-anchor-badge"
      title={id}
      aria-label={`Block anchor ${id}. Click to copy.`}
      onClick={handleClick}
      contentEditable={false}
      style={{
        display: 'inline-block',
        cursor: 'pointer',
        border: 'none',
        font: 'inherit',
        fontSize: '0.75em',
        lineHeight: '1.4em',
        padding: '0 0.4em',
        marginLeft: '0.3em',
        borderRadius: '1em',
        backgroundColor: 'var(--liminis-editor-muted-100)',
        color: 'var(--liminis-editor-muted-foreground)',
        userSelect: 'none',
        verticalAlign: 'middle',
      }}
    >
      {copied ? 'Copied' : '^'}
    </button>
  );
}
