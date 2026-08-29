import { z } from 'zod';

const languageEnum = z.enum(['typescript', 'javascript', 'python', 'csharp']);

/** Schema for the launch_debug tool input. */
export const launchDebugSchema = z.object({
  program: z.string().describe('Path to the program to debug'),
  language: languageEnum
    .optional()
    .describe('Programming language (auto-detected if omitted)'),
  args: z.array(z.string()).optional().describe('Arguments to pass to the debuggee'),
  cwd: z.string().optional().describe('Working directory for the debuggee'),
  stopOnEntry: z.boolean().optional().describe('Break on the first line'),
});

/** Schema for the attach_debug tool input. */
export const attachDebugSchema = z.object({
  pid: z.number().int().positive().optional().describe('Process ID to attach to'),
  host: z.string().optional().describe('Host to attach to'),
  port: z.number().int().positive().optional().describe('Port to attach to'),
  language: languageEnum.describe('Programming language of the debuggee'),
  type: z.enum(['node', 'chrome', 'msedge']).optional().describe(
    'Debug target type. Use "node" for V8 inspector (default for JS/TS), ' +
    '"chrome" for Chrome DevTools Protocol (CDP), or "msedge" for Edge/WebView2 CDP.',
  ),
});

/** Schema for the disconnect tool input. */
export const disconnectSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  terminateDebuggee: z.boolean().optional().describe('Whether to terminate the debuggee process'),
});

/** Schema for the terminate tool input. */
export const terminateSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
});

/** Schema for the list_sessions tool input. */
export const listSessionsSchema = z.object({}).describe('No parameters required');

/** Schema for the set_breakpoint tool input. */
export const setBreakpointSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  file: z.string().describe('Source file path'),
  line: z.number().int().positive().describe('Line number'),
  condition: z.string().optional().describe('Conditional expression'),
  hitCondition: z.string().optional().describe('Hit count expression'),
  logMessage: z.string().optional().describe('Log message (logpoint)'),
});

/** Schema for the remove_breakpoint tool input. */
export const removeBreakpointSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  file: z.string().describe('Source file path'),
  line: z.number().int().positive().describe('Line number'),
});

/** Schema for the set_function_breakpoint tool input. */
export const setFunctionBreakpointSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  name: z.string().describe('Function name to break on'),
  condition: z.string().optional().describe('Conditional expression'),
  hitCondition: z.string().optional().describe('Hit count expression'),
});

/** Schema for the set_exception_breakpoints tool input. */
export const setExceptionBreakpointsSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  filters: z.array(z.string()).describe('Exception filter IDs (e.g. "all", "caught", "uncaught")'),
});

/** Schema for the set_data_breakpoint tool input. */
export const setDataBreakpointSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  dataId: z.string().describe('Data identifier for the watchpoint'),
  accessType: z
    .enum(['read', 'write', 'readWrite'])
    .optional()
    .default('write')
    .describe('Access type that triggers the breakpoint'),
});

/** Schema for the list_breakpoints tool input. */
export const listBreakpointsSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
});

/** Schema for the continue tool input. */
export const continueSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  threadId: z.number().optional().describe('Thread to continue (default: all)'),
});

/** Schema for step tools (step_over, step_into, step_out) input. */
export const stepSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  threadId: z.number().optional().describe('Thread to step'),
});

/** Schema for the pause tool input. */
export const pauseSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  threadId: z.number().optional().describe('Thread to pause (default: all)'),
});

/** Schema for the set_next_statement tool input. */
export const setNextStatementSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  file: z.string().describe('Source file path'),
  line: z.number().int().positive().describe('Target line number'),
  threadId: z.number().optional().describe('Thread identifier'),
});

/** Schema for the get_variables tool input. */
export const getVariablesSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  variablesReference: z.number().int().describe('Variables reference from scope or parent variable'),
  depth: z.number().int().positive().optional().describe('Maximum depth for nested variables'),
  maxProperties: z.number().int().positive().optional().describe('Maximum number of properties to return'),
});

/** Schema for the get_call_stack tool input. */
export const getCallStackSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  threadId: z.number().describe('Thread identifier'),
  startFrame: z.number().int().nonnegative().optional().describe('Start frame index for pagination'),
  levels: z.number().int().positive().optional().describe('Number of frames to return'),
});

/** Schema for the evaluate tool input. */
export const evaluateSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  expression: z.string().describe('Expression to evaluate'),
  frameId: z.number().optional().describe('Stack frame context'),
  context: z.enum(['watch', 'repl', 'hover']).optional().describe('Evaluation context'),
});

/** Schema for the get_threads tool input. */
export const getThreadsSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
});

/** Schema for the get_scopes tool input. */
export const getScopesSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  frameId: z.number().int().describe('Stack frame identifier'),
});

/** Schema for the manage_watch tool input. */
export const manageWatchSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  action: z.enum(['add', 'remove', 'list', 'evaluate']).describe('Watch operation to perform'),
  expression: z.string().optional().describe('Watch expression (required for add/remove)'),
  frameId: z.number().optional().describe('Stack frame context for evaluate action'),
});

/** Inferred types for each schema. */
export type LaunchDebugInput = z.infer<typeof launchDebugSchema>;
export type AttachDebugInput = z.infer<typeof attachDebugSchema>;
export type DisconnectInput = z.infer<typeof disconnectSchema>;
export type TerminateInput = z.infer<typeof terminateSchema>;
export type ListSessionsInput = z.infer<typeof listSessionsSchema>;
export type SetBreakpointInput = z.infer<typeof setBreakpointSchema>;
export type RemoveBreakpointInput = z.infer<typeof removeBreakpointSchema>;
export type SetFunctionBreakpointInput = z.infer<typeof setFunctionBreakpointSchema>;
export type SetExceptionBreakpointsInput = z.infer<typeof setExceptionBreakpointsSchema>;
export type SetDataBreakpointInput = z.infer<typeof setDataBreakpointSchema>;
export type ListBreakpointsInput = z.infer<typeof listBreakpointsSchema>;
export type ContinueInput = z.infer<typeof continueSchema>;
export type StepInput = z.infer<typeof stepSchema>;
export type PauseInput = z.infer<typeof pauseSchema>;
export type SetNextStatementInput = z.infer<typeof setNextStatementSchema>;
export type GetVariablesInput = z.infer<typeof getVariablesSchema>;
export type GetCallStackInput = z.infer<typeof getCallStackSchema>;
export type EvaluateInput = z.infer<typeof evaluateSchema>;
export type GetThreadsInput = z.infer<typeof getThreadsSchema>;
export type GetScopesInput = z.infer<typeof getScopesSchema>;
export type ManageWatchInput = z.infer<typeof manageWatchSchema>;
