import { z } from 'zod';

/** Valid log level values. */
export const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

/** Valid process attach policy values (NFR-010). */
export const attachPolicySchema = z.enum(['own', 'unrestricted']);

/** Zod schema for agentic debugger configuration. */
export const configSchema = z.object({
  logLevel: logLevelSchema.default('info'),
  auditLogPath: z.string().default('~/.agentic-debugger/audit.log'),
  auditLogMaxBytes: z
    .number()
    .int()
    .positive()
    .default(50 * 1024 * 1024),
  evalTimeout: z.number().int().positive().default(10_000),
  maxSessions: z.number().int().positive().default(10),
  allowAttach: attachPolicySchema.default('own'),
  redactPatterns: z
    .array(z.string())
    .default([
      '*password*',
      '*secret*',
      '*token*',
      '*apikey*',
      '*api_key*',
      '*credential*',
      '*private_key*',
      '*connection_string*',
    ]),
  redactionEnabled: z.boolean().default(true),
});

/** Inferred TypeScript type from the config schema. */
export type AppConfig = z.infer<typeof configSchema>;
