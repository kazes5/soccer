import { describe, expect, it } from 'vitest';
import { setPasswordRequestSchema } from './auth';

describe('setPasswordRequestSchema', () => {
  it('rejects mismatched password/confirmation', () => {
    const result = setPasswordRequestSchema.safeParse({
      password: 'Cedar-River!Otter-52',
      passwordConfirmation: 'different',
    });

    expect(result.success).toBe(false);
  });

  it('accepts a matching password/confirmation of sufficient length', () => {
    const result = setPasswordRequestSchema.safeParse({
      password: 'Cedar-River!Otter-52',
      passwordConfirmation: 'Cedar-River!Otter-52',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a password shorter than 15 characters', () => {
    const result = setPasswordRequestSchema.safeParse({
      password: 'short12',
      passwordConfirmation: 'short12',
    });

    expect(result.success).toBe(false);
  });
});
