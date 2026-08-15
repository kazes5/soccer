import { describe, expect, it } from 'vitest';
import { normalizeEmail, normalizePhone } from './identifiers';

describe('login identifier normalization', () => {
  it('normalizes email casing and surrounding whitespace', () => {
    expect(normalizeEmail('  Parent@Example.COM ')).toBe('parent@example.com');
  });

  it('maps Israeli local and international phone formats to the same E.164 identity', () => {
    expect(normalizePhone('050-123-4567')).toBe('+972501234567');
    expect(normalizePhone('+972 50 123 4567')).toBe('+972501234567');
    expect(normalizePhone('00972501234567')).toBe('+972501234567');
  });
});
