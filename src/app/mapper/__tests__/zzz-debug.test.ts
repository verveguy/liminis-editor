import { describe, it } from 'vitest';
import { roundTrip } from './roundtrip-test-utils';

describe('debug2', () => {
  it('idempotency check for space-style double break', async () => {
    const input = "1. Line one  \n     \n   Line two\n2. Item two\n";
    const { output } = await roundTrip(input, { registerListPlugin: true });
    console.log('INPUT ', JSON.stringify(input));
    console.log('OUTPUT', JSON.stringify(output));
    console.log('MATCH', input === output);
  });

  it('idempotency check for space-style double break (plain harness)', async () => {
    const input = "1. Line one  \n     \n   Line two\n2. Item two\n";
    const { output } = await roundTrip(input);
    console.log('PLAIN INPUT ', JSON.stringify(input));
    console.log('PLAIN OUTPUT', JSON.stringify(output));
    console.log('PLAIN MATCH', input === output);
  });
});
