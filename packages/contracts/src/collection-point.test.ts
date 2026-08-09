import { describe, expect, it } from 'vitest';
import { collectionPointRequestSchema } from './collection-point';

describe('collectionPointRequestSchema', () => {
  it('accepts a point without GPS coordinates', () => {
    const result = collectionPointRequestSchema.safeParse({
      name: 'Oak St',
      address: '123 Oak St',
      type: 'pickup',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an out-of-range latitude', () => {
    const result = collectionPointRequestSchema.safeParse({
      name: 'Oak St',
      address: '123 Oak St',
      type: 'pickup',
      gpsLat: 200,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an invalid type', () => {
    const result = collectionPointRequestSchema.safeParse({
      name: 'Oak St',
      address: '123 Oak St',
      type: 'somewhere',
    });

    expect(result.success).toBe(false);
  });
});
