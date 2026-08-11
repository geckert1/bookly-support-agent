import { describe, expect, it } from "vitest";
import { parseExplicitConfirmation } from "../src/agent/confirmation-policy.js";

describe("parseExplicitConfirmation", () => {
  it.each([
    "Yes, create the return.",
    "Sure.",
    "Sure, go ahead.",
    "Go ahead.",
    "Yep!",
    "OK, please create it.",
    "Yes, do it.",
  ])("accepts an unambiguous approval: %s", (message) => {
    expect(
      parseExplicitConfirmation(message, "awaiting_confirmation"),
    ).toBe(true);
  });

  it("accepts approval only at the confirmation step", () => {
    expect(parseExplicitConfirmation("yes", "collecting")).toBeUndefined();
  });

  it("recognizes an explicit decline", () => {
    expect(parseExplicitConfirmation("No thanks.", "awaiting_confirmation")).toBe(
      false,
    );
  });

  it.each([
    "Maybe.",
    "Yes, but change the email.",
    "Yes, if return shipping is free.",
  ])("rejects hedged or conditional approval: %s", (message) => {
    expect(
      parseExplicitConfirmation(message, "awaiting_confirmation"),
    ).toBeUndefined();
  });
});
