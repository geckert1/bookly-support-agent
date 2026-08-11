import { ZodError } from "zod";
import { findBooklyOrder } from "../data/bookly-fixtures.js";
import type { Order } from "../domain/order.js";
import {
  ReturnEligibilitySchema,
  ReturnReceiptSchema,
  type ReturnEligibility,
  type ReturnReceipt,
} from "../domain/returns.js";
import {
  CheckReturnEligibilityInputSchema,
  CreateReturnInputSchema,
  LookupOrderInputSchema,
  LookupOrderOutputSchema,
  type BooklyTools,
  type CheckReturnEligibilityInput,
  type CheckReturnEligibilityOutput,
  type CreateReturnInput,
  type CreateReturnOutput,
  type LookupOrderInput,
  type LookupOrderOutput,
} from "./contracts.js";
import { BooklyToolError } from "./tool-error.js";

export type BooklyToolName =
  | "lookupOrder"
  | "checkReturnEligibility"
  | "createReturn";

export interface MockBooklyToolsOptions {
  now?: Date;
  failOperations?: readonly BooklyToolName[];
}

const DEMO_NOW = new Date("2026-08-07T12:00:00.000Z");
const RETURN_WINDOW_DAYS = 30;

export class MockBooklyTools implements BooklyTools {
  private readonly now: Date;
  private readonly failOperations: ReadonlySet<BooklyToolName>;
  private readonly returnsByOrderId = new Map<string, ReturnReceipt>();

  constructor(options: MockBooklyToolsOptions = {}) {
    this.now = new Date(options.now ?? DEMO_NOW);
    this.failOperations = new Set(options.failOperations ?? []);
  }

  /**
   * Reset only the mocked write state so a reviewer can replay the demo.
   * Real Bookly tools must never erase durable return records this way.
   */
  resetDemoState(): void {
    this.returnsByOrderId.clear();
  }

  async lookupOrder(input: LookupOrderInput): Promise<LookupOrderOutput> {
    this.maybeFail("lookupOrder");
    const parsed = parseToolInput(LookupOrderInputSchema, input);
    const order = findBooklyOrder(parsed.orderId);

    // Use the same response for an unknown order and an identity mismatch so an
    // attacker cannot learn whether another customer's order exists.
    if (!order || order.customerEmail.toLowerCase() !== parsed.email) {
      throw new BooklyToolError(
        "order_not_found",
        "No order matched the supplied identifier and customer email.",
      );
    }

    return LookupOrderOutputSchema.parse(order);
  }

  async checkReturnEligibility(
    input: CheckReturnEligibilityInput,
  ): Promise<CheckReturnEligibilityOutput> {
    this.maybeFail("checkReturnEligibility");
    const parsed = parseToolInput(CheckReturnEligibilityInputSchema, input);
    const order = findBooklyOrder(parsed.orderId);

    if (!order) {
      throw new BooklyToolError(
        "order_not_found",
        "No order matched the supplied identifier.",
      );
    }

    return ReturnEligibilitySchema.parse(evaluateEligibility(order, this.now));
  }

  async createReturn(input: CreateReturnInput): Promise<CreateReturnOutput> {
    this.maybeFail("createReturn");

    // Defense in depth belongs at the command boundary. Even if orchestration
    // regresses, the write rechecks confirmation, identity, current policy, and
    // idempotency instead of trusting earlier workflow state.
    if ((input as { confirmed?: unknown }).confirmed !== true) {
      throw new BooklyToolError(
        "confirmation_required",
        "An explicit customer confirmation is required.",
      );
    }

    const parsed = parseToolInput(CreateReturnInputSchema, input);
    const order = findBooklyOrder(parsed.orderId);

    if (!order || order.customerEmail.toLowerCase() !== parsed.email) {
      throw new BooklyToolError(
        "order_not_found",
        "No order matched the supplied identifier and customer email.",
      );
    }

    if (!evaluateEligibility(order, this.now).eligible) {
      throw new BooklyToolError(
        "return_not_eligible",
        "The order is not eligible for a self-service return.",
      );
    }

    if (this.returnsByOrderId.has(order.id)) {
      throw new BooklyToolError(
        "return_already_exists",
        "A return has already been created for this order.",
      );
    }

    const receipt = ReturnReceiptSchema.parse({
      returnId: `RET-${String(this.returnsByOrderId.size + 1).padStart(4, "0")}`,
      orderId: order.id,
      status: "authorized",
      createdAt: this.now.toISOString(),
      instructions:
        "A prepaid label will be emailed within a few minutes. Please ship the item within 7 days.",
    });

    this.returnsByOrderId.set(order.id, receipt);
    return receipt;
  }

  private maybeFail(operation: BooklyToolName): void {
    if (this.failOperations.has(operation)) {
      throw new BooklyToolError(
        "temporary_unavailable",
        `${operation} is temporarily unavailable.`,
      );
    }
  }
}

export function createMockBooklyTools(
  options: MockBooklyToolsOptions = {},
): BooklyTools {
  return new MockBooklyTools(options);
}

function parseToolInput<T>(
  schema: { parse(value: unknown): T },
  input: unknown,
): T {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BooklyToolError("invalid_input", "Tool input was invalid.", {
        cause: error,
      });
    }
    throw error;
  }
}

function evaluateEligibility(order: Order, now: Date): ReturnEligibility {
  if (order.status !== "delivered" || !order.deliveredAt) {
    return {
      eligible: false,
      code: "not_delivered",
      explanation:
        "Returns can be started after the order has been delivered.",
    };
  }

  if (order.items.some((item) => item.finalSale)) {
    return {
      eligible: false,
      code: "final_sale",
      explanation: "This order contains a final-sale item.",
    };
  }

  const returnBy = addDays(new Date(order.deliveredAt), RETURN_WINDOW_DAYS);
  if (now.getTime() > returnBy.getTime()) {
    return {
      eligible: false,
      code: "window_expired",
      explanation: "Bookly's 30-day return window has ended for this order.",
      returnBy: toDateString(returnBy),
    };
  }

  return {
    eligible: true,
    code: "eligible",
    explanation: "This order is within Bookly's 30-day return window.",
    returnBy: toDateString(returnBy),
  };
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
