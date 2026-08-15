export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const parsed = parsePhoneNumberFromString(trimmed, env.DEFAULT_PHONE_REGION as CountryCode);
  if (parsed?.isValid()) return parsed.number;
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

export function normalizeLoginIdentifier(value: string): {
  normalizedEmail?: string;
  normalizedPhone?: string;
} {
  return value.includes('@')
    ? { normalizedEmail: normalizeEmail(value) }
    : { normalizedPhone: normalizePhone(value) };
}
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { env } from '../env';
