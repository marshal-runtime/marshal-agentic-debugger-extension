import { z } from 'zod';

/** Valid session state values. */
export const sessionStateSchema = z.enum([
  'idle',
  'initializing',
  'running',
  'stopped',
  'terminating',
  'terminated',
]);

/** Valid language identifier values. */
export const languageIdSchema = z.enum([
  'javascript',
  'typescript',
  'python',
  'csharp',
]);

/** Schema for session configuration in API requests. */
export const sessionConfigSchema = z.object({
  sessionId: z.string(),
  program: z.string(),
  language: languageIdSchema,
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  stopOnEntry: z.boolean().optional(),
});

/** Schema for session information in API responses. */
export const sessionSchema = z.object({
  sessionId: z.string(),
  state: sessionStateSchema,
  language: languageIdSchema,
  createdAt: z.string(),
  program: z.string(),
});

/** Schema for a launch-session request. */
export const launchRequestSchema = z.object({
  program: z.string(),
  language: languageIdSchema.optional(),
  stopOnEntry: z.boolean().optional(),
  cwd: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

/** Schema for an attach-session request. */
export const attachRequestSchema = z.object({
  processId: z.number().int().positive().optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  language: languageIdSchema.optional(),
});

/** Inferred type from the session schema. */
export type SessionSchemaType = z.infer<typeof sessionSchema>;

/** Inferred type from the session config schema. */
export type SessionConfigSchemaType = z.infer<typeof sessionConfigSchema>;

/** Inferred type from the launch request schema. */
export type LaunchRequestSchemaType = z.infer<typeof launchRequestSchema>;

/** Inferred type from the attach request schema. */
export type AttachRequestSchemaType = z.infer<typeof attachRequestSchema>;
