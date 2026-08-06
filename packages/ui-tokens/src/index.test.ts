import { describe, expect, it } from 'vitest';
import { spacing } from './index';

describe('spacing', () => {
  it('scales the base unit by the given multiplier', () => {
    expect(spacing(2)).toBe('8px');
  });
});
