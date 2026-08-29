import { SessionState } from '../types/session.js';

/** Session lifecycle event type constants. */
export const SessionEventType = {
  Created: 'session:created',
  Started: 'session:started',
  StateChanged: 'session:stateChanged',
  Stopped: 'session:stopped',
  Terminated: 'session:terminated',
  Error: 'session:error',
} as const;

export type SessionEventType = (typeof SessionEventType)[keyof typeof SessionEventType];

/** Payload for a session lifecycle event. */
export interface SessionEvent {
  readonly type: SessionEventType;
  readonly sessionId: string;
  readonly timestamp: string;
}

/** Payload for a state-change event. */
export interface SessionStateChangedEvent extends SessionEvent {
  readonly type: typeof SessionEventType.StateChanged;
  readonly previousState: SessionState;
  readonly newState: SessionState;
}

/** Payload for a session error event. */
export interface SessionErrorEvent extends SessionEvent {
  readonly type: typeof SessionEventType.Error;
  readonly message: string;
}

/** Handler for session lifecycle events. */
export type SessionEventHandler<T extends SessionEvent = SessionEvent> = (event: T) => void;

/** Map of event types to their handler signatures. */
export interface SessionEventMap {
  [SessionEventType.Created]: SessionEvent;
  [SessionEventType.Started]: SessionEvent;
  [SessionEventType.StateChanged]: SessionStateChangedEvent;
  [SessionEventType.Stopped]: SessionEvent;
  [SessionEventType.Terminated]: SessionEvent;
  [SessionEventType.Error]: SessionErrorEvent;
}

/** Interface for session event emitters. */
export interface SessionEventEmitter {
  on(eventType: SessionEventType, handler: SessionEventHandler): void;
  off(eventType: SessionEventType, handler: SessionEventHandler): void;
  emit(event: SessionEvent): void;
}

/** Concrete session event emitter using a handler map. */
export class DefaultSessionEventEmitter implements SessionEventEmitter {
  private readonly handlers = new Map<SessionEventType, SessionEventHandler[]>();

  on(eventType: SessionEventType, handler: SessionEventHandler): void {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
  }

  off(eventType: SessionEventType, handler: SessionEventHandler): void {
    const list = this.handlers.get(eventType);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
  }

  emit(event: SessionEvent): void {
    const list = this.handlers.get(event.type);
    if (!list) return;
    for (const handler of list) {
      handler(event);
    }
  }
}
