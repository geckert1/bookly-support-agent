// Responsibility: Verify offline intent, slot, and context-action extraction for supported customer language.
// Boundary: Routing is pure here; session orchestration and operational tool effects are tested elsewhere.

import { describe, expect, it } from "vitest";
import { DeterministicIntentRouter } from "../src/agent/deterministic-intent-router.js";
import { normalizeOrderId } from "../src/agent/slot-normalization.js";

const router = new DeterministicIntentRouter();

function route(message: string) {
  return router.route({
    message,
    currentIntent: "unknown",
    phase: "collecting",
  });
}

describe("normalizeOrderId", () => {
  it.each(["BK-10421", "BK10421", "BK 10421", "10421"])(
    "normalizes %s to the canonical order ID",
    (value) => {
      expect(normalizeOrderId(value)).toBe("BK-10421");
    },
  );

  it("rejects values that are not complete Bookly order IDs", () => {
    expect(normalizeOrderId("BK-1042")).toBeUndefined();
  });
});

describe("DeterministicIntentRouter", () => {
  it.each(["BK-10421", "BK10421", "BK 10421", "10421"])(
    "extracts and normalizes order ID format %s",
    async (orderId) => {
      const result = await route(`Where is order ${orderId}?`);

      expect(result).toMatchObject({
        intent: "order_status",
        slots: { orderId: "BK-10421" },
        contextAction: "continue",
      });
    },
  );

  it("recognizes a missing package as an order-status request", async () => {
    const result = await route("hey my package hasnt shown up");

    expect(result.intent).toBe("order_status");
    expect(result.contextAction).toBe("continue");
  });

  it("recognizes a broken delivery and extracts a useful return reason", async () => {
    const result = await route("my book came broken, what are my options?");

    expect(result).toMatchObject({
      intent: "return_request",
      slots: { returnReason: "book came broken" },
    });
  });

  it.each([
    "How long does shipping to Canada take?",
    "What is Bookly's return policy?",
    "What is Bookly's refund policy?",
    "whats the return window",
  ])("keeps an informational policy question in the FAQ path: %s", async (message) => {
    const result = await route(message);

      expect(result.intent).toBe("faq");
      expect(result.contextAction).toBe("continue");
    });

  it("keeps an order-specific return-window question in the return workflow", async () => {
    const result = await route("Can I return BK-10422 within the return window?");

    expect(result).toMatchObject({
      intent: "return_request",
      slots: { orderId: "BK-10422" },
    });
  });

  it("treats a new refund request as a return workflow", async () => {
    const result = await route("I want a refund for BK-10422.");

    expect(result).toMatchObject({
      intent: "return_request",
      slots: { orderId: "BK-10422" },
      contextAction: "continue",
    });
  });

  it.each([
    "Where is my refund?",
    "I didn't get the label yet.",
    "Can you resend my return QR code?",
  ])("routes existing-return aftercare explicitly: %s", async (message) => {
    const result = await route(message);

    expect(result).toMatchObject({
      intent: "existing_return_status",
      contextAction: "continue",
      slots: {},
    });
  });

  it.each([
    "I got the return label, thanks.",
    "The label arrived.",
  ])("routes positive return acknowledgements explicitly: %s", async (message) => {
    const result = await route(message);

    expect(result).toMatchObject({
      intent: "post_return_acknowledgement",
      contextAction: "continue",
      slots: {},
    });
  });

  it("requests verified-order reuse for 'return it' after order status", async () => {
    const result = await router.route({
      message: "I want to return it.",
      currentIntent: "order_status",
      phase: "completed",
    });

    expect(result).toMatchObject({
      intent: "return_request",
      contextAction: "reuse_verified_order",
      slots: {},
    });
  });

  it.each(["Track another order.", "Where is my different order?"])(
    "starts fresh context for another order: %s",
    async (message) => {
      const result = await router.route({
        message,
        currentIntent: "order_status",
        phase: "completed",
      });

      expect(result).toMatchObject({
        intent: "order_status",
        contextAction: "start_fresh",
        slots: {},
      });
    },
  );
});
