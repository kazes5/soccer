import { describe, expect, it } from 'vitest';
import {
  createScheduleTemplateRequestSchema,
  updateScheduleTemplateRequestSchema,
} from './schedule-template';

describe('createScheduleTemplateRequestSchema', () => {
  const base = {
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    startDate: '2026-08-10',
    defaultTime: '18:00',
    defaultFieldLocation: 'Central Field',
    collectionPointIds: ['00000000-0000-4000-8000-000000000001'],
  };

  it('accepts a valid template and defaults horizonWeeks to 8', () => {
    const result = createScheduleTemplateRequestSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.horizonWeeks).toBe(8);
    }
  });

  it('rejects a time not in 24-hour HH:MM form', () => {
    const result = createScheduleTemplateRequestSchema.safeParse({
      ...base,
      defaultTime: '6:00pm',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty collection point list', () => {
    const result = createScheduleTemplateRequestSchema.safeParse({
      ...base,
      collectionPointIds: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a horizon over 52 weeks', () => {
    const result = createScheduleTemplateRequestSchema.safeParse({
      ...base,
      horizonWeeks: 53,
    });
    expect(result.success).toBe(false);
  });
});

describe('updateScheduleTemplateRequestSchema', () => {
  it('accepts an empty object (no fields changed)', () => {
    const result = updateScheduleTemplateRequestSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a partial update of just one field', () => {
    const result = updateScheduleTemplateRequestSchema.safeParse({ horizonWeeks: 12 });
    expect(result.success).toBe(true);
  });

  it('strips an explicit startDate field — it is not part of the editable shape', () => {
    const result = updateScheduleTemplateRequestSchema.safeParse({
      startDate: '2026-09-01',
      horizonWeeks: 12,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ horizonWeeks: 12 });
    }
  });

  it('rejects an invalid time the same way the create schema does', () => {
    const result = updateScheduleTemplateRequestSchema.safeParse({ defaultTime: '6:00pm' });
    expect(result.success).toBe(false);
  });
});
