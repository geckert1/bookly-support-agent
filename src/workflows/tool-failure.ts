/**
 * Responsibility: Converts tool failures into stable traces and customer-safe replies.
 * Boundary: Raw provider details stop here and never enter response copy.
 */
import type { TraceEvent } from "../domain/agent.js";
import {
  isBooklyToolError,
  type ToolErrorCode,
} from "../tools/tool-error.js";
import { addTrace, type WorkflowResult } from "./workflow-types.js";

export function toolFailureResult(
  toolName: string,
  error: unknown,
  trace: TraceEvent[],
): WorkflowResult {
  // Unknown exceptions intentionally collapse to one safe code. Leaking raw
  // errors could expose fixture identities, provider details, or stack context.
  const code: ToolErrorCode | "unexpected" = isBooklyToolError(error)
    ? error.code
    : "unexpected";

  addTrace(trace, {
    category: "tool",
    name: toolName,
    status: "failed",
    detail: `The tool returned a safe ${code} failure.`,
  });

  switch (code) {
    case "order_not_found":
      return {
        message:
          "I couldn't match that order number and email. Please check both and try again.",
        status: "needs_input",
      };
    case "confirmation_required":
      return {
        message:
          "I still need a clear yes or no before I can create the return.",
        status: "needs_confirmation",
      };
    case "return_not_eligible":
      return {
        message:
          "That order is not eligible for a self-service return. I haven't made any changes.",
        status: "resolved",
      };
    case "return_already_exists":
      return {
        message:
          "A return already exists for that order, so I did not create another one.",
        status: "resolved",
      };
    case "invalid_input":
      return {
        message:
          "I couldn't use those order details. Please check the order number and email, then try again.",
        status: "needs_input",
      };
    case "temporary_unavailable":
    case "unexpected":
      return {
        message:
          "Bookly's order system is temporarily unavailable. I haven't made any changes. Please try again.",
        status: "error",
      };
  }
}
