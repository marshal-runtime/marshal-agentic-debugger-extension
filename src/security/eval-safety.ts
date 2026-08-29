/** Result of an expression safety check. */
export interface ExpressionSafetyResult {
  /** Whether the expression is considered safe to evaluate. */
  readonly safe: boolean;
  /** Warning message when expression may have side effects. */
  readonly warning?: string;
}

/** Interface context that determines default safety level. */
export type InterfaceContext = 'mcp' | 'cli';

/** Safety mode for expression evaluation. */
export type SafetyMode = 'safe' | 'unrestricted';

/** Options for {@link isSafeExpression}. */
export interface EvalSafetyOptions {
  /** Override safety mode. When omitted, defaults based on {@link interfaceContext}. */
  mode?: SafetyMode;
  /** Interface that initiated the evaluation. */
  interfaceContext?: InterfaceContext;
}

/**
 * Patterns that indicate an expression may mutate state.
 * These are checked in safe mode to warn or block side-effecting evaluations.
 */
const MUTATION_PATTERNS: readonly RegExp[] = [
  /(?<!=|!)=(?!=)/,     // assignment (but not == or != or ===)
  /\+\+/,               // increment
  /--/,                  // decrement
  /\+=|-=|\*=|\/=|%=/,  // compound assignment
  /\bdelete\b/,         // delete operator
  /\bnew\b/,            // object construction
];

/**
 * Patterns that indicate potentially dangerous operations.
 * These are always flagged, even in unrestricted mode (as warnings).
 */
const DANGEROUS_PATTERNS: readonly RegExp[] = [
  /\beval\s*\(/,         // eval() calls
  /\bFunction\s*\(/,     // Function constructor
  /\brequire\s*\(/,      // require() calls
  /\bimport\s*\(/,       // dynamic import
  /\bprocess\s*\./,      // process access
  /\bchild_process\b/,   // child process module
  /\bexec\s*\(/,         // exec calls
];

/**
 * Resolve the effective safety mode based on explicit option or interface context.
 *
 * Defaults: MCP → `"safe"`, CLI → `"unrestricted"`.
 */
function resolveSafetyMode(options: EvalSafetyOptions): SafetyMode {
  if (options.mode !== undefined) {
    return options.mode;
  }
  return options.interfaceContext === 'cli' ? 'unrestricted' : 'safe';
}

/**
 * Check whether a debug expression is safe to evaluate.
 *
 * In **safe** mode (default for MCP):
 * - Expressions with assignment operators, `delete`, or `new` are rejected.
 * - Expressions with dangerous patterns (`eval`, `require`, etc.) are rejected.
 *
 * In **unrestricted** mode (default for CLI):
 * - Mutation patterns are allowed but produce warnings.
 * - Dangerous patterns produce warnings but are allowed.
 *
 * @param expression - The expression string to evaluate.
 * @param options - Safety mode and interface context.
 */
export function isSafeExpression(
  expression: string,
  options: EvalSafetyOptions = {},
): ExpressionSafetyResult {
  const mode = resolveSafetyMode(options);

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(expression)) {
      if (mode === 'safe') {
        return {
          safe: false,
          warning: `Expression contains a potentially dangerous operation: ${pattern.source}`,
        };
      }
      return {
        safe: true,
        warning: `Expression may perform dangerous operations — use caution`,
      };
    }
  }

  for (const pattern of MUTATION_PATTERNS) {
    if (pattern.test(expression)) {
      if (mode === 'safe') {
        return {
          safe: false,
          warning: `Expression may modify program state (detected: ${pattern.source})`,
        };
      }
      return {
        safe: true,
        warning: `Expression may modify program state`,
      };
    }
  }

  return { safe: true };
}
