/**
 * `undefined` for blank; `null` for present-but-not-a-finite-number, so the
 * caller can show a field-specific error instead of letting a NaN silently
 * become JSON `null` and fail the server's `z.number().optional()` schema.
 *
 * Kept outside `page.tsx` because Next.js route modules may export only the
 * page component and supported route metadata/configuration fields.
 */
export function parseOptionalCoordinate(value: string): number | null | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
