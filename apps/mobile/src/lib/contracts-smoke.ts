import { pushConfigResponseSchema, type PushConfigResponse } from '@soccer/contracts';

/**
 * Proves `@soccer/contracts` resolves and validates through Metro's bundler
 * (this app's real cross-package boundary, unlike `apps/web`'s webpack) —
 * exercised by a real Zod parse, not just a type-only import that could
 * pass typecheck while failing to actually bundle/run. Stands in for real
 * contract usage until Checkpoint 3 (auth) and Checkpoint 4 (schedule/shift
 * screens) call these schemas against live API responses.
 */
export function parseSamplePushConfig(): PushConfigResponse {
  return pushConfigResponseSchema.parse({ publicKey: null });
}
