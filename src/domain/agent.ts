// Responsibility: Define runtime-validated agent state, replies, and trace contracts.
// Boundary: Domain schemas describe valid data but do not execute routing or workflows.

import { z } from "zod";

export const SupportIntentSchema = z.enum([
  "order_status",
  "return_request",
  "existing_return_status",
  "post_return_acknowledgement",
  "faq",
  "handoff",
  "unknown",
]);

export const SessionPhaseSchema = z.enum([
  "collecting",
  "awaiting_confirmation",
  "completed",
]);

export const SupportSlotsSchema = z.object({
  orderId: z.string().regex(/^BK-\d{5}$/).optional(),
  email: z.string().email().optional(),
  returnReason: z.string().min(3).max(300).optional(),
});

export const PendingReturnSchema = z.object({
  orderId: z.string().regex(/^BK-\d{5}$/),
  email: z.string().email(),
  reason: z.string().min(3).max(300),
});

export const CompletedReturnSchema = z.object({
  orderId: z.string().regex(/^BK-\d{5}$/),
  returnId: z.string().regex(/^RET-\d{4}$/),
});

export const SessionStateSchema = z.object({
  sessionId: z.string().min(1),
  intent: SupportIntentSchema,
  phase: SessionPhaseSchema,
  slots: SupportSlotsSchema,
  pendingReturn: PendingReturnSchema.optional(),
  completedReturn: CompletedReturnSchema.optional(),
  turnCount: z.number().int().nonnegative(),
});

export const TraceEventSchema = z.object({
  category: z.enum(["routing", "memory", "tool", "guardrail"]),
  name: z.string().min(1),
  status: z.enum(["succeeded", "blocked", "failed"]),
  detail: z.string().min(1),
});

export const AgentReplyStatusSchema = z.enum([
  "needs_input",
  "needs_confirmation",
  "resolved",
  "error",
]);

export const AgentReplySchema = z.object({
  message: z.string().min(1),
  intent: SupportIntentSchema,
  status: AgentReplyStatusSchema,
  trace: z.array(TraceEventSchema),
});

export type SupportIntent = z.infer<typeof SupportIntentSchema>;
export type SessionPhase = z.infer<typeof SessionPhaseSchema>;
export type SupportSlots = z.infer<typeof SupportSlotsSchema>;
export type PendingReturn = z.infer<typeof PendingReturnSchema>;
export type CompletedReturn = z.infer<typeof CompletedReturnSchema>;
export type SessionState = z.infer<typeof SessionStateSchema>;
export type TraceEvent = z.infer<typeof TraceEventSchema>;
export type AgentReplyStatus = z.infer<typeof AgentReplyStatusSchema>;
export type AgentReply = z.infer<typeof AgentReplySchema>;
