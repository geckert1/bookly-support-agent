// Responsibility: Verify that confirmation language is classified as affirmative, negative, or ambiguous.
// Boundary: Covers the pure parser only; the tool's hard confirmed:true write gate is tested separately.

import { describe, expect, it } from "vitest";
import { parseExplicitConfirmation } from "../src/agent/confirmation-policy.js";

describe("parseExplicitConfirmation", () => {
  it.each([
    "sure go ahead",
    "yep",
    "ok please create it",
    "yes do it",
    "yeah",
    "yes please do it",
    "go for it",
    "absolutely",
    "sounds good",
    "ok do it",
    "please create the return",
    "yes, go ahead and create it",
  ])("accepts an unambiguous approval: %s", (message) => {
    expect(
      parseExplicitConfirmation(message, "awaiting_confirmation"),
    ).toBe(true);
  });

  it("accepts approval only at the confirmation step", () => {
    expect(parseExplicitConfirmation("yes", "collecting")).toBeUndefined();
  });

  it.each(["no", "No thanks.", "do not create the return"])(
    "recognizes an explicit decline: %s",
    (message) => {
      expect(
        parseExplicitConfirmation(message, "awaiting_confirmation"),
      ).toBe(false);
    },
  );

  it("rejects a confirmation that also changes a protected input", () => {
    expect(
      parseExplicitConfirmation(
        "Yes, but change the email.",
        "awaiting_confirmation",
      ),
    ).toBeUndefined();
  });

  it("does not mistake a return reason containing negation for a decline", () => {
    expect(
      parseExplicitConfirmation("It did not fit.", "awaiting_confirmation"),
    ).toBeUndefined();
  });

  it.each(["Maybe.", "Yes, if return shipping is free."])(
    "rejects hedged or conditional approval: %s",
    (message) => {
      expect(
        parseExplicitConfirmation(message, "awaiting_confirmation"),
      ).toBeUndefined();
    },
  );
});
