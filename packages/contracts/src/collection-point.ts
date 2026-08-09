import { z } from 'zod';
import { collectionPointTypeSchema } from './enums';

export const collectionPointRequestSchema = z.object({
  name: z.string().min(1).max(255),
  address: z.string().min(1).max(255),
  gpsLat: z.number().min(-90).max(90).optional(),
  gpsLng: z.number().min(-180).max(180).optional(),
  type: collectionPointTypeSchema,
});
export type CollectionPointRequest = z.infer<typeof collectionPointRequestSchema>;

export const collectionPointSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  name: z.string(),
  address: z.string(),
  gpsLat: z.number().nullable(),
  gpsLng: z.number().nullable(),
  type: collectionPointTypeSchema,
});
export type CollectionPoint = z.infer<typeof collectionPointSchema>;

export const collectionPointListResponseSchema = z.object({
  points: z.array(collectionPointSchema),
});
export type CollectionPointListResponse = z.infer<typeof collectionPointListResponseSchema>;
