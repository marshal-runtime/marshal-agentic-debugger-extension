import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

import type { DebugSession } from '../session/session.js';
import type { SessionEvent, SessionStateChangedEvent } from '../session/events.js';
import { SessionEventType } from '../session/events.js';
import { SessionState } from '../types/session.js';

/** MCP notification event names for debug state changes. */
export const McpNotificationType = {
  Stopped: 'notifications/debug/stopped',
  Continued: 'notifications/debug/continued',
  Terminated: 'notifications/debug/terminated',
  Output: 'notifications/debug/output',
  Breakpoint: 'notifications/debug/breakpoint',
  Thread: 'notifications/debug/thread',
} as const;

/** Union type of all MCP notification event names. */
export type McpNotificationType = (typeof McpNotificationType)[keyof typeof McpNotificationType];

/** Base payload for all MCP debug notifications. */
export interface McpNotificationPayload {
  readonly sessionId: string;
  readonly timestamp: string;
}

/** Payload for the debug/stopped notification. */
export interface StoppedNotificationPayload extends McpNotificationPayload {
  readonly reason: string;
  readonly threadId?: number;
  readonly description?: string;
}

/** Payload for the debug/continued notification. */
export interface ContinuedNotificationPayload extends McpNotificationPayload {
  readonly threadId?: number;
}

/** Payload for the debug/terminated notification. */
export interface TerminatedNotificationPayload extends McpNotificationPayload {
  readonly reason: string;
}

/** Payload for the debug/output notification. */
export interface OutputNotificationPayload extends McpNotificationPayload {
  readonly category: string;
  readonly output: string;
}

/** Payload for the debug/breakpoint notification. */
export interface BreakpointNotificationPayload extends McpNotificationPayload {
  readonly reason: string;
  readonly breakpoint: Record<string, unknown>;
}

/** Payload for the debug/thread notification. */
export interface ThreadNotificationPayload extends McpNotificationPayload {
  readonly reason: string;
  readonly threadId: number;
}

/** Send a notification through the MCP server. */
function sendNotification(server: Server, method: string, params: Record<string, unknown>): void {
  server.notification({ method, params }).catch(() => {
    // Notifications are best-effort; swallow errors from disconnected clients
  });
}

/**
 * Wire MCP notifications to a single debug session's events.
 *
 * Maps DAP-level state changes to MCP notification messages:
 * - Session entering Stopped state → `notifications/debug/stopped`
 * - Session entering Running from Stopped → `notifications/debug/continued`
 * - Session entering Terminated state → `notifications/debug/terminated`
 */
export function wireSessionNotifications(server: Server, session: DebugSession): void {
  session.eventEmitter.on(SessionEventType.StateChanged, (event: SessionEvent) => {
    const stateEvent = event as SessionStateChangedEvent;
    const timestamp = stateEvent.timestamp;
    const sessionId = stateEvent.sessionId;

    if (stateEvent.newState === SessionState.Stopped) {
      sendNotification(server, McpNotificationType.Stopped, {
        sessionId,
        timestamp,
        reason: 'breakpoint',
      });
    }

    if (
      stateEvent.newState === SessionState.Running &&
      stateEvent.previousState === SessionState.Stopped
    ) {
      sendNotification(server, McpNotificationType.Continued, {
        sessionId,
        timestamp,
      });
    }

    if (stateEvent.newState === SessionState.Terminated) {
      sendNotification(server, McpNotificationType.Terminated, {
        sessionId,
        timestamp,
        reason: 'terminated',
      });
    }
  });
}

/**
 * Wire MCP notifications for all existing sessions and provide
 * a hook for wiring new sessions as they are created.
 *
 * @returns A function to call when a new session is created to wire its notifications.
 */
export function wireNotifications(
  server: Server,
  existingSessions: readonly DebugSession[],
): (session: DebugSession) => void {
  for (const session of existingSessions) {
    wireSessionNotifications(server, session);
  }

  return (session: DebugSession) => {
    wireSessionNotifications(server, session);
  };
}
