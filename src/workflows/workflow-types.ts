/**
 * Responsibility: Defines workflow context/results and validates public trace events.
 * Boundary: Shared shapes live here; each workflow owns its state transitions and policy.
 */
import {
  TraceEventSchema,
  type AgentReplyStatus,
  type SessionState,
  type TraceEvent,
} from "../domain/agent.js";
import type { BooklyTools } from "../tools/contracts.js";

export interface WorkflowContext {
  session: SessionState;
  tools: BooklyTools;
  confirmation?: boolean;
  trace: TraceEvent[];
}

export interface WorkflowResult {
  message: string;
  status: AgentReplyStatus;
}

export function addTrace(
  trace: TraceEvent[],
  event: TraceEvent,
): void {
  // Traces are reviewer-facing operational metadata. Schema validation prevents
  // arbitrary internal or provider data from slipping into that public surface.
  trace.push(TraceEventSchema.parse(event));
}
