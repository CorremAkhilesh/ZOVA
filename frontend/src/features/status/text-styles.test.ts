import { STATUS_BACKGROUNDS } from '@zuvo/protocol';
import { contrastRatio } from '@zuvo/ui-tokens';
import { describe, expect, it } from 'vitest';
import { BACKGROUND_COLORS } from './text-styles';

describe('text status backgrounds', () => {
  it.each(STATUS_BACKGROUNDS)('%s: white text is AA on both ends of the gradient', (name) => {
    const { from, to } = BACKGROUND_COLORS[name];
    expect(contrastRatio('#FFFFFF', from)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#FFFFFF', to)).toBeGreaterThanOrEqual(4.5);
  });
});
