import {
  AgentReplySchema,
  type AgentReply,
  type SessionState,
  type SupportIntent,
  type TraceEvent,
} from "../domain/agent.js";
import {
  DeterministicKnowledgeAnswerer,
  type KnowledgeAnswerer,
} from "../knowledge/knowledge-answerer.js";
import {
  createMockBooklyTools,
  MockBooklyTools,
  type BooklyTools,
} from "../tools/index.js";
import {
  runFaqWorkflow,
  runOrderStatusWorkflow,
  runReturnWorkflow,
} from "../workflows/index.js";
import { DeterministicIntentRouter } from "./deterministic-intent-router.js";
import {
  IntentRouterResultSchema,
  type IntentRouter,
  type IntentRouterResult,
} from "./intent-router.js";
import {
  parseConfirmationPhrase,
  parseExplicitConfirmation,
} from "./confirmation-policy.js";
import {
  explainHandoff,
  explainKnowledgeHandoff,
  explainNoPendingAction,
  explainPostReturnAcknowledgement,
  isExistingReturnFallbackMessage,
  isPositiveReturnAcknowledgementFallback,
} from "./handoff-policy.js";
import { SessionMemory } from "./session-memory.js";
import {
  extractEmailAddresses,
  extractOrderIds,
} from "./slot-normalization.js";

export type { AgentReply } from "../domain/agent.js";

/**
 * Intentionally a small orchestrator, not a general-purpose agent loop.
 * The router interprets language; this class owns state and dispatch; explicit
 * workflows own tool order, policy checks, and customer-facing commitments.
 */
export class BooklyAgent {
  constructor(
    private readonly router: IntentRouter = new DeterministicIntentRouter(),
    private readonly tools: BooklyTools = createMockBooklyTools(),
    private readonly memory: SessionMemory = new SessionMemory(),
    private readonly knowledgeAnswerer: KnowledgeAnswerer =
      new DeterministicKnowledgeAnswerer(),
  ) {}

  async handleMessage(
    sessionId: string,
    message: string,
  ): Promise<AgentReply> {
    const session = this.memory.load(sessionId);
    const trace: TraceEvent[] = [];
    session.turnCount += 1;

    if (!message.trim()) {
      trace.push({
        category: "guardrail",
        name: "non_empty_message",
        status: "blocked",
        detail: "Routing was held because the customer message was empty.",
      });
      this.memory.save(session);
      return makeReply(
        "Please enter a question about an order, a return, or Bookly policy.",
        session.intent,
        "needs_input",
        trace,
      );
    }

    const suppliedEmails = extractEmailAddresses(message);
    const suppliedOrderIds = extractOrderIds(message);
    clearCompletedReturnForCustomerChange(session, suppliedEmails, trace);
    clearCompletedReturnForOrderChange(session, suppliedOrderIds, trace);
    invalidatePendingReturnForExplicitChange(
      session,
      message,
      suppliedEmails,
      suppliedOrderIds,
      trace,
    );

    const confirmationPhrase = parseConfirmationPhrase(message);
    const directConfirmation = parseExplicitConfirmation(message, session.phase);
    if (
      directConfirmation !== undefined &&
      session.intent === "return_request"
    ) {
      // Exact confirmation is already a deterministic policy decision. Bypass
      // the router so a provider outage cannot block or reinterpret a staged
      // action. Longer replies still route normally for changes or topic shifts.
      trace.push({
        category: "routing",
        name: "confirmationPolicy",
        status: "succeeded",
        detail: "Handled an exact pending confirmation without a model call.",
      });
      const result = await runReturnWorkflow({
        session,
        tools: this.tools,
        confirmation: directConfirmation,
        trace,
      });
      this.memory.save(session);
      return makeReply(result.message, session.intent, result.status, trace);
    }

    const collectingClarification = explainCollectingConfirmation(
      session,
      confirmationPhrase,
      trace,
    );
    if (collectingClarification) {
      this.memory.save(session);
      return makeReply(
        collectingClarification.message,
        session.intent,
        collectingClarification.status,
        trace,
      );
    }

    if (
      confirmationPhrase !== undefined &&
      session.phase === "completed" &&
      (session.intent === "handoff" || session.completedReturn !== undefined)
    ) {
      const result = explainNoPendingAction(session, trace);
      this.memory.save(session);
      return makeReply(result.message, session.intent, result.status, trace);
    }

    const decision = await this.routeSafely(session, message, trace);
    if (!decision) {
      this.memory.save(session);
      return makeReply(
        "I couldn't interpret that message just now. Please try again.",
        session.intent,
        "error",
        trace,
      );
    }

    applyDecision(session, decision, trace);
    const confirmation = parseExplicitConfirmation(message, session.phase);
    this.memory.save(session);

    const routedIntent = session.intent;
    let result: { message: string; status: AgentReply["status"] };
    switch (routedIntent) {
      case "unknown":
        result = {
          message:
            "I can check an order's status, help start a return, or answer an approved Bookly policy question. For anything else, a support specialist is the safest next step.",
          status: "needs_input",
        };
        break;
      case "handoff":
        result = explainHandoff(session, "general", trace);
        break;
      case "existing_return_status":
        // Existing-return operations are intentionally outside the two action
        // workflows. Preserve a verified receipt for the specialist, but never
        // call a transactional tool or silently start another return.
        session.intent = "handoff";
        result = explainHandoff(session, "existing_return", trace);
        break;
      case "post_return_acknowledgement":
        result = explainPostReturnAcknowledgement(session, trace);
        break;
      case "faq": {
        const faqResult = await runFaqWorkflow({
          question: message,
          answerer: this.knowledgeAnswerer,
          trace,
        });
        if (faqResult.outcome === "handoff") {
          // Keep the outward intent as handoff so the UI exposes the existing
          // specialist action. A rejected model answer is never displayed.
          session.intent = "handoff";
          result = explainKnowledgeHandoff(session, trace);
        } else {
          session.pendingReturn = undefined;
          session.phase = "completed";
          result = { message: faqResult.answer, status: "resolved" };
        }
        break;
      }
      case "order_status":
        result = await runOrderStatusWorkflow({
          session,
          tools: this.tools,
          confirmation,
          trace,
        });
        break;
      case "return_request":
        result = await runReturnWorkflow({
          session,
          tools: this.tools,
          confirmation,
          trace,
        });
        break;
      default:
        result = assertNever(routedIntent);
    }

    this.memory.save(session);
    return makeReply(result.message, session.intent, result.status, trace);
  }

  resetSession(sessionId: string): void {
    this.memory.reset(sessionId);

    // The browser reset is a demo boundary. Clear the in-memory mock receipt so
    // the exact return scenario is replayable, while real tool implementations
    // keep their durable idempotency records untouched.
    if (this.tools instanceof MockBooklyTools) {
      this.tools.resetDemoState();
    }
  }

  private async routeSafely(
    session: SessionState,
    message: string,
    trace: TraceEvent[],
  ): Promise<IntentRouterResult | undefined> {
    try {
      const decision = await this.router.route({
        message,
        currentIntent: session.intent,
        phase: session.phase,
      });
      trace.push({
        category: "routing",
        name: "intentRouter",
        status: "succeeded",
        detail:
          describeRoutingDecision(decision.intent),
      });
      return decision;
    } catch {
      trace.push({
        category: "routing",
        name: "intentRouter",
        status: "failed",
        detail: "The router failed without exposing its internal error.",
      });

      if (session.phase === "awaiting_confirmation") {
        // Exact yes/no replies bypass the provider above. Any other message may
        // contain changed action details, so a routing failure must discard the
        // staged command instead of leaving an old write available to a later yes.
        session.pendingReturn = undefined;
        session.phase = "collecting";
        trace.push({
          category: "guardrail",
          name: "stale_confirmation",
          status: "blocked",
          detail:
            "Discarded the pending action because changed input could not be interpreted safely.",
        });
      }

      // The language router owns normal aftercare interpretation. These compact
      // checks exist only as a provider-outage safety net after a verified
      // return. They can acknowledge or hand off, but can never call a tool.
      if (session.completedReturn) {
        const fallbackIntent = isPositiveReturnAcknowledgementFallback(message)
          ? "post_return_acknowledgement"
          : isExistingReturnFallbackMessage(message)
            ? "existing_return_status"
            : undefined;

        if (fallbackIntent) {
          trace.push({
            category: "routing",
            name: "providerOutageFallback",
            status: "succeeded",
            detail:
              "Used a narrow read-only fallback after the language router failed.",
          });
          return IntentRouterResultSchema.parse({
            intent: fallbackIntent,
            slots: {},
            contextAction: "continue",
          });
        }
      }
      return undefined;
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported intent: ${String(value)}`);
}

function describeRoutingDecision(intent: SupportIntent): string {
  switch (intent) {
    case "handoff":
      return "Selected the safe human-handoff boundary.";
    case "faq":
      return "Selected the grounded FAQ workflow.";
    case "existing_return_status":
      return "Selected the existing-return support boundary.";
    case "post_return_acknowledgement":
      return "Selected a completed-return acknowledgement.";
    case "unknown":
      return "No supported workflow was selected.";
    default:
      return `Selected the ${intent} workflow.`;
  }
}

function applyDecision(
  session: SessionState,
  decision: IntentRouterResult,
  trace: TraceEvent[],
): void {
  const previousIntent = session.intent;
  const previousPhase = session.phase;
  const previousSlots = { ...session.slots };

  // A short reply such as "yes" may be classified as unknown. While a write is
  // pending, keep the active return workflow unless the router found a clear
  // different intent. The confirmation policy still decides whether to act.
  const routedIntent =
    session.phase === "awaiting_confirmation" && decision.intent === "unknown"
      ? session.intent
      : decision.intent;

  clearCompletedReturnForCustomerChange(
    session,
    decision.slots.email ? [decision.slots.email] : [],
    trace,
  );
  clearCompletedReturnForOrderChange(
    session,
    decision.slots.orderId ? [decision.slots.orderId] : [],
    trace,
  );

  let contextActionApplied = false;

  if (decision.contextAction === "start_fresh") {
    const retainedEmail = decision.slots.email ?? previousSlots.email;
    session.slots = retainedEmail ? { email: retainedEmail } : {};
    session.pendingReturn = undefined;
    session.completedReturn = undefined;
    session.phase = "collecting";
    contextActionApplied = true;
    trace.push({
      category: "memory",
      name: "workflow_restart",
      status: "succeeded",
      detail:
        "Started a fresh request without reusing the completed order identifier.",
    });
  }

  if (decision.contextAction === "reuse_verified_order") {
    const canReuseVerifiedOrder =
      previousPhase === "completed" &&
      previousIntent === "order_status" &&
      routedIntent === "return_request" &&
      previousSlots.orderId !== undefined &&
      previousSlots.email !== undefined &&
      (decision.slots.orderId === undefined ||
        decision.slots.orderId === previousSlots.orderId) &&
      (decision.slots.email === undefined ||
        decision.slots.email === previousSlots.email);

    if (canReuseVerifiedOrder) {
      session.slots = {
        orderId: previousSlots.orderId,
        email: previousSlots.email,
      };
      trace.push({
        category: "memory",
        name: "context_carried_forward",
        status: "succeeded",
        detail:
          "Carried only the verified order and matched email into the return request.",
      });
    } else {
      // A model-supplied context hint is not authority to reuse state. If the
      // prior lookup was not completed and identity-matched, collect afresh.
      const retainedEmail = decision.slots.email ?? previousSlots.email;
      session.slots = retainedEmail ? { email: retainedEmail } : {};
      trace.push({
        category: "guardrail",
        name: "context_reuse",
        status: "blocked",
        detail:
          "Declined to reuse an order because no matching completed lookup established it.",
      });
    }
    session.pendingReturn = undefined;
    session.completedReturn = undefined;
    session.phase = "collecting";
    contextActionApplied = true;
  }

  // A new return request after a completed return starts with fresh operational
  // fields, even when the router chooses the same intent. Read-only order-status
  // follow-ups may safely reuse their prior order; write workflows may not.
  const completedReturnRestarted =
    !contextActionApplied &&
    previousPhase === "completed" &&
    session.completedReturn !== undefined &&
    routedIntent === "return_request";
  if (completedReturnRestarted) {
    const retainedEmail = decision.slots.email ?? previousSlots.email;
    session.slots = retainedEmail ? { email: retainedEmail } : {};
    session.pendingReturn = undefined;
    session.completedReturn = undefined;
    session.phase = "collecting";
    trace.push({
      category: "memory",
      name: "workflow_restart",
      status: "succeeded",
      detail:
        "Started a fresh return without reusing the completed return's operational fields.",
    });
  }

  const completedWorkflowClosed =
    !contextActionApplied &&
    previousPhase === "completed" &&
    previousIntent !== "unknown" &&
    routedIntent === "unknown";
  if (completedWorkflowClosed) {
    const retainedEmail = session.slots.email;
    session.slots = retainedEmail ? { email: retainedEmail } : {};
    session.pendingReturn = undefined;
    session.phase = "collecting";
    trace.push({
      category: "memory",
      name: "workflow_closed",
      status: "succeeded",
      detail: "Cleared completed workflow details while retaining the session email.",
    });
  }

  const intentChanged =
    !contextActionApplied &&
    previousIntent !== "unknown" &&
    routedIntent !== "unknown" &&
    routedIntent !== previousIntent;

  if (intentChanged) {
    const retainedEmail = decision.slots.email ?? session.slots.email;
    session.slots = retainedEmail ? { email: retainedEmail } : {};
    session.pendingReturn = undefined;
    session.phase = "collecting";
    trace.push({
      category: "memory",
      name: "workflow_switch",
      status: "succeeded",
      detail: "Started a new workflow while retaining the session email.",
    });
  }

  const pendingInputChanged =
    session.phase === "awaiting_confirmation" &&
    Object.entries(decision.slots).some(
      ([key, value]) =>
        value !== undefined &&
        value !== session.slots[key as keyof typeof session.slots],
    );

  if (pendingInputChanged) {
    session.pendingReturn = undefined;
    session.phase = "collecting";
    trace.push({
      category: "guardrail",
      name: "stale_confirmation",
      status: "blocked",
      detail: "Discarded a pending action after its inputs changed.",
    });
  }

  const orderChanged =
    decision.slots.orderId !== undefined &&
    decision.slots.orderId !== session.slots.orderId;
  if (orderChanged) {
    delete session.slots.returnReason;
    session.pendingReturn = undefined;
    session.phase = "collecting";
  }

  session.intent = routedIntent;
  session.slots = { ...session.slots, ...decision.slots };
  trace.push({
    category: "memory",
    name: "structured_session",
    status: "succeeded",
    detail: "Stored only intent and workflow slots; no raw transcript was retained.",
  });
}

function makeReply(
  message: string,
  intent: SupportIntent,
  status: AgentReply["status"],
  trace: TraceEvent[],
): AgentReply {
  return AgentReplySchema.parse({ message, intent, status, trace });
}

function explainCollectingConfirmation(
  session: SessionState,
  confirmation: boolean | undefined,
  trace: TraceEvent[],
): { message: string; status: AgentReply["status"] } | undefined {
  if (
    confirmation === undefined ||
    session.phase !== "collecting" ||
    (session.intent !== "order_status" && session.intent !== "return_request")
  ) {
    return undefined;
  }

  if (!confirmation) {
    const retainedEmail = session.slots.email;
    session.intent = "unknown";
    session.phase = "collecting";
    session.slots = retainedEmail ? { email: retainedEmail } : {};
    session.pendingReturn = undefined;
    trace.push({
      category: "guardrail",
      name: "workflow_cancelled",
      status: "succeeded",
      detail: "Closed the unfinished workflow without making any changes.",
    });
    return {
      message:
        "No problem. I haven't created or changed anything, and I closed that request.",
      status: "resolved",
    };
  }

  let requiredField: string;
  let message: string;
  if (!session.slots.orderId) {
    requiredField = "orderId";
    message =
      session.intent === "return_request"
        ? "Yes—I can help start a return. I still need the Bookly order number. Please enter it in the form BK-10422."
        : "Yes—I can help check it. I still need the Bookly order number. Please enter it in the form BK-10421.";
  } else if (!session.slots.email) {
    requiredField = "email";
    message =
      "I have the order number. I still need the full email address used for that order; yes alone doesn't provide it.";
  } else if (
    session.intent === "return_request" &&
    !session.slots.returnReason
  ) {
    requiredField = "returnReason";
    message =
      "I have the order and email. I still need a short reason for the return, such as “arrived damaged” or “did not fit.”";
  } else {
    requiredField = "correctedDetails";
    message =
      "A yes alone can't resolve the previous lookup. Please provide a corrected order number or email address.";
  }

  trace.push({
    category: "guardrail",
    name: "required_input_after_confirmation",
    status: "blocked",
    detail: `A yes/no response did not contain the required ${requiredField}.`,
  });
  return { message, status: "needs_input" };
}

function clearCompletedReturnForCustomerChange(
  session: SessionState,
  suppliedEmails: readonly string[],
  trace: TraceEvent[],
): void {
  if (
    !session.completedReturn ||
    suppliedEmails.length === 0 ||
    suppliedEmails.every((email) => email === session.slots.email)
  ) {
    return;
  }

  // A completed receipt belongs to the customer context in which it was
  // created. This runs before provider-independent shortcuts as well as after
  // routing, so a same-message email switch cannot reveal the prior receipt.
  session.completedReturn = undefined;
  trace.push({
    category: "memory",
    name: "customer_context_changed",
    status: "succeeded",
    detail:
      "Cleared the completed return reference after the customer email changed.",
  });
}

function clearCompletedReturnForOrderChange(
  session: SessionState,
  suppliedOrderIds: readonly string[],
  trace: TraceEvent[],
): void {
  if (
    !session.completedReturn ||
    suppliedOrderIds.length === 0 ||
    suppliedOrderIds.every(
      (orderId) => orderId === session.completedReturn?.orderId,
    )
  ) {
    return;
  }

  session.completedReturn = undefined;
  trace.push({
    category: "memory",
    name: "order_context_changed",
    status: "succeeded",
    detail:
      "Cleared the completed return reference after the order context changed.",
  });
}

function invalidatePendingReturnForExplicitChange(
  session: SessionState,
  message: string,
  suppliedEmails: readonly string[],
  suppliedOrderIds: readonly string[],
  trace: TraceEvent[],
): void {
  const pending = session.pendingReturn;
  if (!pending || session.phase !== "awaiting_confirmation") return;

  const emailChanged = suppliedEmails.some(
    (email) => email !== pending.email,
  );
  const orderChanged = suppliedOrderIds.some(
    (orderId) => orderId !== pending.orderId,
  );
  const reasonChanged = hasExplicitReasonChange(message);
  if (!emailChanged && !orderChanged && !reasonChanged) return;

  const nextSlots = { ...session.slots };
  if (suppliedEmails.length === 1) {
    nextSlots.email = suppliedEmails[0];
  } else if (suppliedEmails.length > 1) {
    delete nextSlots.email;
  }
  if (suppliedOrderIds.length === 1) {
    nextSlots.orderId = suppliedOrderIds[0];
  } else if (suppliedOrderIds.length > 1) {
    delete nextSlots.orderId;
  }
  delete nextSlots.returnReason;

  session.slots = nextSlots;
  session.pendingReturn = undefined;
  session.phase = "collecting";
  trace.push({
    category: "guardrail",
    name: "stale_confirmation",
    status: "blocked",
    detail:
      "Discarded the pending action after the customer supplied changed action details.",
  });
}

function hasExplicitReasonChange(message: string): boolean {
  return /\b(?:change|update|correct|replace)\b.{0,30}\b(?:return\s+)?reason\b|\breason\s+(?:is|to|as)\b/i.test(
    message,
  );
}
