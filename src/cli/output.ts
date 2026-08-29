/** Options controlling how CLI output is serialized. */
export interface WriteOutputOptions {
  /** When true, output JSON with 2-space indentation. */
  readonly pretty?: boolean;
}

/** Structured JSON output envelope for all CLI commands. */
export interface CliOutput {
  readonly success: boolean;
  readonly sessionId: string | null;
  readonly command: string;
  readonly timestamp: string;
  readonly data: unknown;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly resolution: string | null;
  } | null;
}

/** Format a successful result as a JSON envelope. */
export function formatOutput(command: string, data: unknown, sessionId?: string): CliOutput {
  return {
    success: true,
    sessionId: sessionId ?? null,
    command,
    timestamp: new Date().toISOString(),
    data: data ?? null,
    error: null,
  };
}

/** Format an error result as a JSON envelope. */
export function formatErrorOutput(
  command: string,
  code: string,
  message: string,
  sessionId?: string,
  resolution?: string,
): CliOutput {
  return {
    success: false,
    sessionId: sessionId ?? null,
    command,
    timestamp: new Date().toISOString(),
    data: null,
    error: {
      code,
      message,
      resolution: resolution ?? null,
    },
  };
}

/** Write a CliOutput object to stdout as JSON. */
export function writeOutput(output: CliOutput, options?: WriteOutputOptions): void {
  const indent = options?.pretty ? 2 : undefined;
  const json = JSON.stringify(output, null, indent);
  process.stdout.write(json + '\n');
}
