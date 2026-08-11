/**
 * Responsibility: Stages an eligible return, confirms it, then performs one guarded write.
 * Boundary: No return reaches the command tool before explicit customer confirmation.
 */
import type { Order } from "../domain/order.js";
import type { ReturnEligibility } from "../domain/returns.js";
import { formatUtcDate } from "./format-date.js";
import { toolFailureResult } from "./tool-failure.js";
import {
  addTrace,
  type WorkflowContext,
  type WorkflowResult,
} from "./workflow-types.js";

export async function runReturnWorkflow(
  context: WorkflowContext,
): Promise<WorkflowResult> {
  // The workflow is deliberately staged: read -> evaluate -> collect reason ->
  // confirm -> write. A model never chooses the order or calls a tool directly.
  if (context.session.phase === "awaiting_confirmation") {
    return finishConfirmation(context);
  }
  return prepareReturn(context);
}

async function prepareReturn(
  context: WorkflowContext,
): Promise<WorkflowResult> {
  const { session, tools, trace } = context;
  session.phase = "collecting";

  if (!session.slots.orderId) {
    return askFor("orderId", trace);
  }
  if (!session.slots.email) {
    return askFor("email", trace);
  }

  let order: Order;
  try {
    order = await tools.lookupOrder({
      orderId: session.slots.orderId,
      email: session.slots.email,
    });
    addTrace(trace, {
      category: "tool",
      name: "lookupOrder",
      status: "succeeded",
      detail: "Retrieved an order after matching its customer email.",
    });
  } catch (error) {
    return toolFailureResult("lookupOrder", error, trace);
  }

  let eligibility: ReturnEligibility;
  try {
    eligibility = await tools.checkReturnEligibility({
      orderId: order.id,
    });
    addTrace(trace, {
      category: "tool",
      name: "checkReturnEligibility",
      status: "succeeded",
      detail: "Applied Bookly's deterministic 30-day return policy.",
    });
  } catch (error) {
    return toolFailureResult("checkReturnEligibility", error, trace);
  }

  if (!eligibility.eligible) {
    session.phase = "completed";
    return {
      message: `${eligibility.explanation} I haven't created a return. A support specialist can review an exception if needed.`,
      status: "resolved",
    };
  }

  // Do not ask why the customer is returning an item until we know the order is
  // eligible. This keeps an ineligible path shorter and avoids collecting data
  // that the workflow does not need.
  if (!session.slots.returnReason) {
    return askFor("returnReason", trace);
  }

  session.pendingReturn = {
    orderId: order.id,
    email: session.slots.email,
    reason: session.slots.returnReason,
  };
  session.phase = "awaiting_confirmation";
  addTrace(trace, {
    category: "guardrail",
    name: "explicit_confirmation",
    status: "blocked",
    detail: "Return creation is held until the customer explicitly confirms.",
  });

  return {
    message: `Order ${order.id} is eligible for return through ${formatDate(eligibility.returnBy)}. Return reason: “${session.pendingReturn.reason}”. Should I create the return now? Please reply yes or no.`,
    status: "needs_confirmation",
  };
}

async function finishConfirmation(
  context: WorkflowContext,
): Promise<WorkflowResult> {
  const { session, confirmation, tools, trace } = context;
  const pendingReturn = session.pendingReturn;

  if (!pendingReturn) {
    session.phase = "collecting";
    return {
      message:
        "I no longer have the return details. Please share the order number so we can start again.",
      status: "needs_input",
    };
  }

  if (confirmation === undefined) {
    addTrace(trace, {
      category: "guardrail",
      name: "explicit_confirmation",
      status: "blocked",
      detail: "The latest response was not an unambiguous yes or no.",
    });
    return {
      message: "Before I create the return, please reply with a clear yes or no.",
      status: "needs_confirmation",
    };
  }

  if (!confirmation) {
    session.pendingReturn = undefined;
    session.phase = "completed";
    addTrace(trace, {
      category: "guardrail",
      name: "explicit_confirmation",
      status: "succeeded",
      detail: "The customer declined, so no return action was taken.",
    });
    return {
      message: "Understood. I did not create a return.",
      status: "resolved",
    };
  }

  addTrace(trace, {
    category: "guardrail",
    name: "explicit_confirmation",
    status: "succeeded",
    detail: "The customer explicitly approved the staged return.",
  });

  try {
    // This literal is emitted only after the explicit-confirmation branch above.
    // Removing that ordering would turn conversational ambiguity into write access.
    const receipt = await tools.createReturn({
      ...pendingReturn,
      confirmed: true,
    });
    session.pendingReturn = undefined;
    // The aftercare receipt retains only verified identifiers. Clear the
    // completed order and reason; keeping the already-validated session email
    // is the sole convenience carried into a possible next workflow.
    session.slots = session.slots.email
      ? { email: session.slots.email }
      : {};
    session.completedReturn = {
      orderId: receipt.orderId,
      returnId: receipt.returnId,
    };
    session.phase = "completed";
    addTrace(trace, {
      category: "tool",
      name: "createReturn",
      status: "succeeded",
      detail: "Created one return after explicit customer confirmation.",
    });
    return {
      message: `Return ${receipt.returnId} is authorized for order ${receipt.orderId}. ${receipt.instructions}`,
      status: "resolved",
    };
  } catch (error) {
    const failure = toolFailureResult("createReturn", error, trace);

    // A terminal outcome must also close the staged action. Keep it pending only
    // for confirmation or retryable dependency failures, where another exact
    // yes/no can safely retry the same command.
    if (failure.status === "resolved") {
      session.pendingReturn = undefined;
      session.phase = "completed";
    } else if (failure.status === "needs_input") {
      session.pendingReturn = undefined;
      session.phase = "collecting";
    }

    return failure;
  }
}

function askFor(
  slot: "orderId" | "email" | "returnReason",
  trace: WorkflowContext["trace"],
): WorkflowResult {
  const messages = {
    orderId:
      "What is the Bookly order number? Order numbers use the format BK-10422.",
    email: "What email address was used for that order?",
    returnReason: "What is the reason for the return?",
  } as const;

  addTrace(trace, {
    category: "guardrail",
    name: `required_${slot}`,
    status: "blocked",
    detail: `Return processing was held until the ${slot} slot is provided.`,
  });
  return { message: messages[slot], status: "needs_input" };
}

function formatDate(value: string | undefined): string {
  if (!value) return "the end of the return window";
  return formatUtcDate(value, true);
}
