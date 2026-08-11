// Responsibility: Close unsupported or post-return requests with safe customer guidance.
// Boundary: Handoff responses preserve references but never call transactional tools.

import type {
  AgentReplyStatus,
  SessionState,
  TraceEvent,
} from "../domain/agent.js";

interface HandoffResult {
  message: string;
  status: AgentReplyStatus;
}

const EXISTING_RETURN_FALLBACK_PATTERN =
  /\b(?:return\s+label|return\s+status|status\s+of\s+(?:my\s+)?return|(?:return\s+)?qr\s*code|(?:where|when)\b.{0,20}\brefund|refund\s+(?:status|progress|pending|missing|late)|(?:status|progress)\s+of\s+(?:my\s+)?refund)\b/i;
const BARE_LABEL_PROBLEM_PATTERNS = [
  /\b(?:did(?:\s+not|n['’]t)\s+(?:get|receive)|have(?:\s+not|n['’]t)\s+(?:got|received)|never\s+(?:got|received)|do(?:\s+not|n['’]t)\s+have)\s+(?:(?:my|the)\s+)?labe(?:l)?\b/i,
  /\b(?:resend|re-?send)\s+(?:(?:me\s+)?(?:my|the)\s+)?label\b|\bsend\s+(?:me\s+)?(?:(?:my|the|another|a\s+new)\s+)?label\s+again\b/i,
  /\b(?:cannot|can(?:\s+not|['’]t)|unable\s+to)\s+(?:print|open|download)\s+(?:(?:my|the)\s+)?label\b|\blabel\s+(?:is\s+)?(?:missing|not\s+(?:here|available)|has(?:\s+not|n['’]t)\s+arrived)\b/i,
  /\blabel\b.{0,40}\b(?:does(?:\s+not|n['’]t)\s+work|blank|unreadable|wrong|invalid|problem|error)\b|\b(?:wrong|blank|unreadable|invalid|problem|error)\b.{0,40}\blabel\b/i,
] as const;
const POSITIVE_RETURN_ACKNOWLEDGEMENT_PATTERNS = [
  /^\s*(?:i\s+)?(?:got|received|have|downloaded|printed|found)\s+(?:(?:my|the)\s+)?(?:return\s+)?label(?:\s+(?:successfully|now))?(?:\s*[,!-]?\s*(?:thanks|thank\s+you))?[.!]?\s*$/i,
  /^\s*(?:(?:my|the)\s+)?(?:return\s+)?label\s+(?:has\s+)?(?:arrived|works|worked)(?:\s+(?:successfully|now))?(?:\s*[,!-]?\s*(?:thanks|thank\s+you))?[.!]?\s*$/i,
] as const;

/**
 * Conservative signal used only when normal language routing is unavailable.
 * It identifies a few unmistakable existing-return concepts without attempting
 * to reproduce the provider's broader natural-language classification.
 */
export function isExistingReturnFallbackMessage(message: string): boolean {
  return (
    EXISTING_RETURN_FALLBACK_PATTERN.test(message) ||
    BARE_LABEL_PROBLEM_PATTERNS.some((pattern) => pattern.test(message))
  );
}

export function isPositiveReturnAcknowledgementFallback(
  message: string,
): boolean {
  return POSITIVE_RETURN_ACKNOWLEDGEMENT_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
}

export function explainPostReturnAcknowledgement(
  session: SessionState,
  trace: TraceEvent[],
): HandoffResult {
  const completedReturn = session.completedReturn;
  if (!completedReturn) {
    return {
      message: "Thanks for the update. I haven't changed anything.",
      status: "resolved",
    };
  }

  session.pendingReturn = undefined;
  session.phase = "completed";
  trace.push({
    category: "routing",
    name: "postReturnAcknowledgement",
    status: "succeeded",
    detail:
      "Recognized a positive label update without replaying the return workflow.",
  });
  return {
    message: `Glad it arrived. Return ${completedReturn.returnId} remains authorized for order ${completedReturn.orderId}. I haven't changed anything.`,
    status: "resolved",
  };
}

/**
 * Handoff is a terminal safety boundary, not a third self-service workflow.
 * Bookly does not invent label, refund, or help-desk capabilities: it preserves
 * the verified reference, states the limitation, and makes no operational call.
 */
export function explainHandoff(
  session: SessionState,
  reason: "existing_return" | "general",
  trace: TraceEvent[],
): HandoffResult {
  closeForHandoff(
    session,
    trace,
    "Stopped self-service because the request requires a support specialist; no action was taken.",
  );

  if (reason === "existing_return" && session.completedReturn) {
    const { orderId, returnId } = session.completedReturn;
    return {
      message: `Return ${returnId} is already authorized for order ${orderId}, so I won't start another return. I can't verify return status, refund progress, labels, or QR codes in this prototype. Please contact a Bookly support specialist and share return ID ${returnId}; I haven't changed anything.`,
      status: "resolved",
    };
  }

  return {
    message:
      "That request is outside the approved FAQs and two self-service actions I can safely handle: checking order status and starting eligible returns. Please contact a Bookly support specialist; I haven't changed anything.",
    status: "resolved",
  };
}

export function explainKnowledgeHandoff(
  session: SessionState,
  trace: TraceEvent[],
): HandoffResult {
  closeForHandoff(
    session,
    trace,
    "Stopped the FAQ path because approved Bookly knowledge did not support a grounded answer.",
  );

  return {
    message:
      "I couldn't find an approved Bookly knowledge passage that answers that, so I won't guess. A Bookly support specialist is the safest next step; I haven't changed anything.",
    status: "resolved",
  };
}

export function explainNoPendingAction(
  session: SessionState,
  trace: TraceEvent[],
): HandoffResult {
  trace.push({
    category: "guardrail",
    name: "no_pending_action",
    status: "blocked",
    detail:
      "Ignored a stale confirmation because no customer action was pending.",
  });

  const reference = session.completedReturn
    ? ` Return ${session.completedReturn.returnId} remains authorized.`
    : "";
  return {
    message: `There is no pending action to confirm, so I didn't create or change anything.${reference} Please contact a Bookly support specialist if you need help beyond order status or a new return.`,
    status: "resolved",
  };
}

function closeForHandoff(
  session: SessionState,
  trace: TraceEvent[],
  detail: string,
): void {
  // Closing the staged write before adding the trace makes every handoff path
  // terminal even if a caller later changes its customer-facing copy.
  session.pendingReturn = undefined;
  session.phase = "completed";
  trace.push({
    category: "guardrail",
    name: "human_handoff",
    status: "blocked",
    detail,
  });
}
