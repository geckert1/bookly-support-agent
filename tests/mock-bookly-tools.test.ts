// Responsibility: Verify the deterministic operational boundary for lookup, eligibility, and return creation.
// Boundary: Covers fixture-backed tool invariants, not agent routing or any real bookstore integration.

import { describe, expect, it } from "vitest";
import type { CreateReturnInput } from "../src/tools/contracts.js";
import { MockBooklyTools } from "../src/tools/mock-bookly-tools.js";

const validReturn = {
  orderId: "BK-10422",
  email: "maya.chen@example.com",
  reason: "It did not fit",
  confirmed: true,
} satisfies CreateReturnInput;

describe("MockBooklyTools command boundary", () => {
  // Defense in depth keeps an orchestration bug from becoming an unconfirmed write.
  it("rejects a return without explicit confirmation", async () => {
    const tools = new MockBooklyTools();
    const unconfirmed = { ...validReturn, confirmed: false } as unknown as CreateReturnInput;

    await expect(tools.createReturn(unconfirmed)).rejects.toMatchObject({
      code: "confirmation_required",
    });
  });

  it("blocks a duplicate until the demo state is explicitly reset", async () => {
    const tools = new MockBooklyTools();

    await expect(tools.createReturn(validReturn)).resolves.toMatchObject({
      returnId: "RET-0001",
      orderId: "BK-10422",
    });
    await expect(tools.createReturn(validReturn)).rejects.toMatchObject({
      code: "return_already_exists",
    });

    tools.resetDemoState();

    await expect(tools.createReturn(validReturn)).resolves.toMatchObject({
      returnId: "RET-0001",
      orderId: "BK-10422",
    });
  });
});
