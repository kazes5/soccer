import { describe, expect, it, vi } from 'vitest';
import { createConfirmationToken, verifyConfirmationToken } from './chat-confirmation';

const payload = {
  userId: 'user-1',
  teamId: 'team-1',
  toolName: 'cancel_session',
  argsJson: '{"sessionId":"session-1"}',
};
const secret = 'test-secret';

describe('chat confirmation tokens', () => {
  it('round-trips: a freshly created token verifies against the same payload', () => {
    const token = createConfirmationToken(payload, secret);
    expect(verifyConfirmationToken(token, payload, secret)).toBe(true);
  });

  it('rejects a token whose args were tampered with', () => {
    const token = createConfirmationToken(payload, secret);
    const tampered = { ...payload, argsJson: '{"sessionId":"other"}' };
    expect(verifyConfirmationToken(token, tampered, secret)).toBe(false);
  });

  it('rejects a token presented by a different user', () => {
    const token = createConfirmationToken(payload, secret);
    expect(verifyConfirmationToken(token, { ...payload, userId: 'user-2' }, secret)).toBe(false);
  });

  it('rejects a token for a different team', () => {
    const token = createConfirmationToken(payload, secret);
    expect(verifyConfirmationToken(token, { ...payload, teamId: 'team-2' }, secret)).toBe(false);
  });

  it('rejects a token for a different tool', () => {
    const token = createConfirmationToken(payload, secret);
    const different = { ...payload, toolName: 'remove_member' };
    expect(verifyConfirmationToken(token, different, secret)).toBe(false);
  });

  it('rejects an expired token', () => {
    vi.useFakeTimers();
    try {
      const token = createConfirmationToken(payload, secret);
      vi.advanceTimersByTime(6 * 60 * 1000); // past the 5-minute TTL
      expect(verifyConfirmationToken(token, payload, secret)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a malformed token', () => {
    expect(verifyConfirmationToken('not-a-real-token', payload, secret)).toBe(false);
    expect(verifyConfirmationToken('', payload, secret)).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const token = createConfirmationToken(payload, secret);
    expect(verifyConfirmationToken(token, payload, 'a-different-secret')).toBe(false);
  });
});
