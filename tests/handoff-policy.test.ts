import { describe, expect, it } from "vitest";
import {
  explainHandoff,
  isExistingReturnFallbackMessage,
  isPositiveReturnAcknowledgementFallback,
} from "../src/agent/handoff-policy.js";
import { SessionStateSchema } from "../src/domain/agent.js";

function completedReturnSession() {
  return SessionStateSchema.parse({
    sessionId: "post-return-policy",
    intent: "return_request",
    phase: "completed",
    slots: { email: "maya.chen@example.com" },
    completedReturn: { orderId: "BK-10422", returnId: "RET-0001" },
    turnCount: 2,
  });
}

describe("existing-return fallback", () => {
  it.each([
    "Where is my return label?",
    "Where is my refund?",
    "What is the status of return RET-0001?",
    "Can I get a return QR code?",
    "I didn't get the label yet.",
    "I didn't get the labe yet.",
    "Can you resend the label?",
    "I can't print the label.",
    "The label is missing.",
    "I downloaded my label but it doesn't work.",
    "I received the label, but it is blank.",
  ])("recognizes a conservative fallback concept: %s", (message) => {
    expect(isExistingReturnFallbackMessage(message)).toBe(true);
  });

  it.each([
    "I got the label, thanks.",
    "I like the label design.",
    "What does this label mean?",
    "I need to return another item.",
    "What is Bookly's return policy?",
  ])("does not broaden the offline fallback surface: %s", (message) => {
    expect(isExistingReturnFallbackMessage(message)).toBe(false);
  });
});

describe("positive return acknowledgement fallback", () => {
  it.each([
    "I got the label, thanks.",
    "The return label arrived.",
    "I downloaded my label successfully.",
    "I have the label now.",
  ])("recognizes a strict positive update: %s", (message) => {
    expect(isPositiveReturnAcknowledgementFallback(message)).toBe(true);
  });

  it.each([
    "I have trouble downloading my return label.",
    "I got an error opening the return label.",
    "I received the wrong return label.",
    "I found a problem with the label.",
    "The return label is invalid.",
    "My return label is missing.",
    "I did not receive the return label.",
    "I never got the return label.",
    "I haven’t received the label yet.",
    "I downloaded my label but it doesn't work.",
    "I received the label, but it is blank.",
  ])("does not misread a problem as success: %s", (message) => {
    expect(isPositiveReturnAcknowledgementFallback(message)).toBe(false);
  });
});

describe("explainHandoff", () => {
  it("uses the verified receipt only for an explicit existing-return reason", () => {
    const result = explainHandoff(
      completedReturnSession(),
      "existing_return",
      [],
    );

    expect(result.message).toMatch(/RET-0001.*BK-10422/i);
  });

  it("keeps a general handoff generic", () => {
    const result = explainHandoff(completedReturnSession(), "general", []);

    expect(result.message).toMatch(/outside the approved FAQs/i);
    expect(result.message).not.toMatch(/RET-0001|BK-10422/i);
  });
});
