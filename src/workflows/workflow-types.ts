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
  trace.push(TraceEventSchema.parse(event));
}
