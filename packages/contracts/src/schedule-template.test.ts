import { describe, expect, it } from 'vitest';
import {
  createScheduleTemplateRequestSchema,
  scheduleTemplateSchema,
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

describe('scheduleTemplateSchema', () => {
  const base = {
    id: '00000000-0000-4000-8000-000000000001',
    teamId: '00000000-0000-4000-8000-000000000002',
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    startDate: '2026-08-10',
    defaultTime: '18:00',
    defaultFieldLocation: 'Central Field',
    horizonWeeks: 8,
    collectionPointIds: ['00000000-0000-4000-8000-000000000003'],
    createdByUserId: '00000000-0000-4000-8000-000000000004',
    createdAt: '2026-08-10T00:00:00.000Z',
  };

  it('accepts a template with its collectionPointIds', () => {
    expect(scheduleTemplateSchema.safeParse(base).success).toBe(true);
  });

  it('accepts an empty collectionPointIds array (e.g. all points since removed)', () => {
    const result = scheduleTemplateSchema.safeParse({ ...base, collectionPointIds: [] });
    expect(result.success).toBe(true);
  });

  it('rejects a missing collectionPointIds field', () => {
    const withoutIds: Partial<typeof base> = { ...base };
    delete withoutIds.collectionPointIds;
    expect(scheduleTemplateSchema.safeParse(withoutIds).success).toBe(false);
  });
});
