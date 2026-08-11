/**
 * Responsibility: Looks up a verified order and formats its read-only status reply.
 * Boundary: It requires both identity fields and never mutates an order.
 */
import type { Order } from "../domain/order.js";
import { formatUtcDate } from "./format-date.js";
import { toolFailureResult } from "./tool-failure.js";
import {
  addTrace,
  type WorkflowContext,
  type WorkflowResult,
} from "./workflow-types.js";

export async function runOrderStatusWorkflow(
  context: WorkflowContext,
): Promise<WorkflowResult> {
  const { session, tools, trace } = context;
  session.phase = "collecting";
  session.pendingReturn = undefined;

  if (!session.slots.orderId) {
    return askForOrderId(trace);
  }
  if (!session.slots.email) {
    return askForEmail(trace);
  }

  try {
    const order = await tools.lookupOrder({
      orderId: session.slots.orderId,
      email: session.slots.email,
    });
    addTrace(trace, {
      category: "tool",
      name: "lookupOrder",
      status: "succeeded",
      detail: "Retrieved an order after matching its customer email.",
    });
    session.phase = "completed";
    return { message: formatOrderStatus(order), status: "resolved" };
  } catch (error) {
    return toolFailureResult("lookupOrder", error, trace);
  }
}

function askForOrderId(trace: WorkflowContext["trace"]): WorkflowResult {
  addTrace(trace, {
    category: "guardrail",
    name: "required_order_id",
    status: "blocked",
    detail: "Order lookup was held until an order identifier is provided.",
  });
  return {
    message:
      "What is the Bookly order number? Order numbers use the format BK-10421.",
    status: "needs_input",
  };
}

function askForEmail(trace: WorkflowContext["trace"]): WorkflowResult {
  addTrace(trace, {
    category: "guardrail",
    name: "customer_match",
    status: "blocked",
    detail: "Order lookup was held until a customer email is provided.",
  });
  return {
    message: "What email address was used for that order?",
    status: "needs_input",
  };
}

function formatOrderStatus(order: Order): string {
  switch (order.status) {
    case "processing":
      return `Order ${order.id} is being prepared. Its current estimated delivery date is ${formatDate(order.estimatedDelivery)}.`;
    case "shipped":
      return `Order ${order.id} has shipped with ${order.carrier}. It is expected by ${formatDate(order.estimatedDelivery)}. Tracking number: ${order.trackingNumber}.`;
    case "delivered":
      return `Order ${order.id} was delivered on ${formatDate(order.deliveredAt)}.`;
    case "cancelled":
      return `Order ${order.id} was cancelled. It will not be shipped.`;
  }
}

function formatDate(value: string | undefined): string {
  if (!value) return "not yet available";
  return formatUtcDate(value);
}
