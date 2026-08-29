import { z } from 'zod';

/** Schema for the error object within the response envelope. */
export const envelopeErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  resolution: z.string().optional(),
});

/** Schema for the standard JSON response envelope returned by all commands (NFR-021). */
export const responseEnvelopeSchema = z.object({
  success: z.boolean(),
  sessionId: z.string().nullable(),
  command: z.string(),
  timestamp: z.string(),
  data: z.unknown().nullable(),
  error: envelopeErrorSchema.nullable(),
});

/** Inferred type from the response envelope schema. */
export type ResponseEnvelope = z.infer<typeof responseEnvelopeSchema>;
