import {
  SessionStateSchema,
  type SessionState,
} from "../domain/agent.js";

export class SessionMemory {
  // Store only validated workflow state and the minimal completed-return
  // reference needed for safe aftercare. Raw messages and model reasoning are
  // intentionally absent, which keeps the demo traceable without building a
  // transcript database or retaining more customer data than the flow needs.
  private readonly sessions = new Map<string, SessionState>();

  load(sessionId: string): SessionState {
    const normalizedId = normalizeSessionId(sessionId);
    const existing = this.sessions.get(normalizedId);
    return existing
      ? SessionStateSchema.parse(existing)
      : createSession(normalizedId);
  }

  save(session: SessionState): void {
    const validated = SessionStateSchema.parse(session);
    this.sessions.set(validated.sessionId, validated);
  }

  reset(sessionId: string): void {
    this.sessions.delete(normalizeSessionId(sessionId));
  }
}

function createSession(sessionId: string): SessionState {
  return {
    sessionId,
    intent: "unknown",
    phase: "collecting",
    slots: {},
    turnCount: 0,
  };
}

function normalizeSessionId(sessionId: string): string {
  const normalized = sessionId.trim();
  if (!normalized) {
    throw new Error("sessionId must not be empty.");
  }
  return normalized;
}
