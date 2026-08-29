import { z } from 'zod';

/** Breakpoint type discriminator. */
export const breakpointTypeSchema = z.enum([
  'line',
  'conditional',
  'exception',
  'function',
  'data',
  'logpoint',
  'hitCount',
]);

/** Schema for a breakpoint in API responses. */
export const breakpointSchema = z.object({
  breakpointId: z.string(),
  type: breakpointTypeSchema,
  verified: z.boolean(),
  source: z.string().optional(),
  line: z.number().int().positive().optional(),
  condition: z.string().optional(),
  hitCondition: z.string().optional(),
  logMessage: z.string().optional(),
  enabled: z.boolean().optional(),
});

/** Schema for a set-breakpoint request. */
export const setBreakpointRequestSchema = z.object({
  sessionId: z.string(),
  source: z.string(),
  line: z.number().int().positive(),
  condition: z.string().optional(),
  hitCondition: z.string().optional(),
  logMessage: z.string().optional(),
});

/** Schema for a remove-breakpoint request. */
export const removeBreakpointRequestSchema = z.object({
  sessionId: z.string(),
  breakpointId: z.string(),
});

/** Inferred type from the breakpoint schema. */
export type BreakpointSchemaType = z.infer<typeof breakpointSchema>;

/** Inferred type from the set-breakpoint request schema. */
export type SetBreakpointRequest = z.infer<typeof setBreakpointRequestSchema>;

/** Inferred type from the remove-breakpoint request schema. */
export type RemoveBreakpointRequest = z.infer<typeof removeBreakpointRequestSchema>;
