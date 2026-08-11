import { z } from 'zod';

/** 24-hour "HH:MM" wall-clock time, e.g. "22:00" or "07:00". */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24-hour).');
