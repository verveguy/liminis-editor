/**
 * `stripAnnotateSentinels` is what lets annotate mode stay invisible to the
 * *decisions* the export makes from a text value — the explicit task-marker
 * test in `convertListItemNode` and the ends-with-a-colon join rule in
 * `stringify.ts` (Liminis #970). A strip that removes too much is therefore
 * not cosmetic: it silently changes emitted markdown.
 */
import { describe, it, expect } from 'vitest';
import {
  SENTINEL_OPEN_START,
  SENTINEL_OPEN_END,
  SENTINEL_CLOSE_START,
  SENTINEL_CLOSE_END,
  stripAnnotateSentinels,
} from '../annotate-sentinels';

const OS = SENTINEL_OPEN_START;
const OE = SENTINEL_OPEN_END;
const CS = SENTINEL_CLOSE_START;
const CE = SENTINEL_CLOSE_END;

describe('stripAnnotateSentinels', () => {
  it('removes well-formed open and close tokens', () => {
    expect(stripAnnotateSentinels(`a${OS}id${OE}b`)).toBe('ab');
    expect(stripAnnotateSentinels(`a${CS}id${CE}b`)).toBe('ab');
    expect(stripAnnotateSentinels(`${OS}id${OE}text${CS}id${CE}`)).toBe('text');
  });

  it('leaves sentinel-free text exactly as-is', () => {
    const plain = '- [ ] Run the setup script, then note this:\n';
    expect(stripAnnotateSentinels(plain)).toBe(plain);
  });

  it('preserves the decisions the strip exists to serve', () => {
    // The two real call sites: an explicit task marker, and a trailing colon.
    expect(/^\[( |x|X)\]\s+/.test(stripAnnotateSentinels(`${OS}i${OE}[ ] Run it`))).toBe(true);
    expect(stripAnnotateSentinels(`As follows:${CS}i${CE}`).trimEnd().endsWith(':')).toBe(true);
  });

  it('does not delete real text between MISMATCHED delimiters (open paired with close)', () => {
    // The emitters only ever produce open/open and close/close pairs, so an
    // open-to-close span is not a token — it is real content that happens to
    // sit between two stray PUA characters. Matching it would take the text
    // with it. Reported by Copilot on PR #971.
    const mismatched = `a${OS}real text${CE}b`;
    expect(stripAnnotateSentinels(mismatched)).toBe(mismatched);
  });

  it('does not let a stray unpaired delimiter swallow the text after it', () => {
    // A lazy `.*?` id run would span the stray opener to the first closer and
    // eat `b`; the negated character class cannot cross a delimiter.
    expect(stripAnnotateSentinels(`a${OS}b${OS}id${OE}c`)).toBe(`a${OS}bc`);
  });
});
