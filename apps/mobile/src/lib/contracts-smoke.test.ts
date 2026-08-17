import { parseSamplePushConfig } from './contracts-smoke';

describe('parseSamplePushConfig', () => {
  it('validates a sample response through the real @soccer/contracts schema', () => {
    expect(parseSamplePushConfig()).toEqual({ publicKey: null });
  });
});
