// Responsibility: Exercise Bookly's orchestration across routing, memory, workflows, guardrails, and tools.
// Boundary: Uses deterministic or stubbed collaborators; HTTP, browser UI, and real provider calls stay out of scope.

import { afterEach, describe, expect, it, vi } from "vitest";
import { BooklyAgent } from "../src/agent/bookly-agent.js";
import { DeterministicIntentRouter } from "../src/agent/deterministic-intent-router.js";
import {
  OpenAIIntentRouter,
  type IntentResponsesParseClient,
} from "../src/providers/openai-intent-router.js";
import {
  MockBooklyTools,
  type MockBooklyToolsOptions,
} from "../src/tools/mock-bookly-tools.js";

const MAYA_EMAIL = "maya.chen@example.com";

function createHarness(options: MockBooklyToolsOptions = {}) {
  const tools = new MockBooklyTools(options);
  const agent = new BooklyAgent(new DeterministicIntentRouter(), tools);
  return { agent, tools };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BooklyAgent", () => {
  // --- FAQ grounding and safe topic changes ---

  it.each([
    "Can you recommend a mystery novel?",
    "Do you offer membership in Canada?",
  ])("hands an unsupported question to a specialist instead of guessing: %s", async (question) => {
    const { agent } = createHarness();

    const reply = await agent.handleMessage(
      `unknown-intent-${question.length}`,
      question,
    );

    expect(reply).toMatchObject({
      intent: "handoff",
      status: "resolved",
    });
    expect(reply.message).toMatch(/won't guess/i);
    expect(reply.message).toMatch(/support specialist/i);
    expect(reply.trace).toContainEqual(
      expect.objectContaining({
        category: "routing",
        name: "intentRouter",
        status: "succeeded",
      }),
    );
  });

  it.each([
    ["How long does shipping to Canada take?", /7 to 12 business days/i],
    ["What is Bookly's return policy?", /30 days/i],
    ["How do I reset my password?", /Forgot password/i],
  ])("answers an approved FAQ without transactional tools: %s", async (question, expected) => {
    const { agent, tools } = createHarness();
    const lookupOrder = vi.spyOn(tools, "lookupOrder");
    const checkEligibility = vi.spyOn(tools, "checkReturnEligibility");
    const createReturn = vi.spyOn(tools, "createReturn");

    const reply = await agent.handleMessage(`faq-${question}`, question);

    expect(reply).toMatchObject({ intent: "faq", status: "resolved" });
    expect(reply.message).toMatch(expected);
    expect(reply.trace).toContainEqual(
      expect.objectContaining({ name: "KnowledgeRetrieval", status: "succeeded" }),
    );
    expect(reply.trace).toContainEqual(
      expect.objectContaining({ name: "GroundedAnswer", status: "succeeded" }),
    );
    expect(lookupOrder).not.toHaveBeenCalled();
    expect(checkEligibility).not.toHaveBeenCalled();
    expect(createReturn).not.toHaveBeenCalled();
  });

  it("hands an out-of-knowledge question to a specialist instead of guessing", async () => {
    const { agent, tools } = createHarness();
    const createReturn = vi.spyOn(tools, "createReturn");

    const reply = await agent.handleMessage(
      "faq-out-of-knowledge",
      "Do you offer audiobook subscriptions?",
    );

    expect(reply).toMatchObject({ intent: "handoff", status: "resolved" });
    expect(reply.message).toMatch(/won't guess|support specialist/i);
    expect(reply.trace).toContainEqual(
      expect.objectContaining({ name: "KnowledgeRetrieval", status: "blocked" }),
    );
    expect(reply.trace).toContainEqual(
      expect.objectContaining({ name: "human_handoff", status: "blocked" }),
    );
    expect(createReturn).not.toHaveBeenCalled();
  });

  // Grounded prose is safe only when every citation points to a passage the answerer received.
  it("never displays an FAQ answer with an invalid citation", async () => {
    const tools = new MockBooklyTools();
    const agent = new BooklyAgent(
      new DeterministicIntentRouter(),
      tools,
      undefined,
      {
        answer: async () => ({
          answer: "Invented policy text that must stay hidden.",
          citedPassageIds: ["not-retrieved"],
        }),
      },
    );

    const reply = await agent.handleMessage(
      "faq-invalid-citation",
      "What is Bookly's return policy?",
    );

    expect(reply).toMatchObject({ intent: "handoff", status: "resolved" });
    expect(reply.message).not.toMatch(/Invented policy text/i);
    expect(reply.trace).toContainEqual(
      expect.objectContaining({ name: "GroundedAnswer", status: "blocked" }),
    );
  });

  it("cancels a pending return when the customer switches to an FAQ", async () => {
    const { agent, tools } = createHarness();
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "faq-cancels-pending-return";

    const prepared = await agent.handleMessage(
      sessionId,
      `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    expect(prepared.status).toBe("needs_confirmation");

    const faq = await agent.handleMessage(sessionId, "What is your return policy?");
    expect(faq).toMatchObject({ intent: "faq", status: "resolved" });

    const staleYes = await agent.handleMessage(sessionId, "yes");
    expect(staleYes.status).not.toBe("needs_confirmation");
    expect(createReturn).not.toHaveBeenCalled();
  });

  // --- Required fields, session memory, and verified context reuse ---

  it("clarifies missing order-status fields and resolves BK-10421", async () => {
    const { agent } = createHarness();
    const sessionId = "status-clarification";

    const missingOrder = await agent.handleMessage(
      sessionId,
      "Where is my order?",
    );
    expect(missingOrder).toMatchObject({
      intent: "order_status",
      status: "needs_input",
    });
    expect(missingOrder.message).toMatch(/order number/i);
    expect(missingOrder.trace).toContainEqual(
      expect.objectContaining({
        category: "guardrail",
        name: "required_order_id",
        status: "blocked",
      }),
    );

    const missingEmail = await agent.handleMessage(sessionId, "BK-10421");
    expect(missingEmail.status).toBe("needs_input");
    expect(missingEmail.message).toMatch(/email address/i);
    expect(missingEmail.trace).toContainEqual(
      expect.objectContaining({
        category: "guardrail",
        name: "customer_match",
        status: "blocked",
      }),
    );

    const resolved = await agent.handleMessage(sessionId, MAYA_EMAIL);
    expect(resolved).toMatchObject({
      intent: "order_status",
      status: "resolved",
    });
    expect(resolved.message).toContain("Order BK-10421 has shipped with UPS");
    expect(resolved.message).toContain("August 10, 2026");
    expect(resolved.message).toContain("1ZBOOKLY10421");
    expect(resolved.trace).toContainEqual(
      expect.objectContaining({
        category: "tool",
        name: "lookupOrder",
        status: "succeeded",
      }),
    );
  });

  it("explains which return field is still missing after a premature yes", async () => {
    const { agent, tools } = createHarness();
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "premature-yes";

    const asksForOrder = await agent.handleMessage(
      sessionId,
      "Start a return.",
    );
    expect(asksForOrder.message).toMatch(/use the format BK-10422/i);
    expect(asksForOrder.message).not.toMatch(/it looks like/i);
    const explainsOrder = await agent.handleMessage(sessionId, "yes");
    expect(explainsOrder).toMatchObject({
      intent: "return_request",
      status: "needs_input",
    });
    expect(explainsOrder.message).toMatch(/yes—I can help start a return/i);
    expect(explainsOrder.message).toMatch(/still need the Bookly order number/i);
    expect(explainsOrder.message).not.toBe(asksForOrder.message);

    await agent.handleMessage(sessionId, "BK-10422");
    const explainsEmail = await agent.handleMessage(sessionId, "yes");
    expect(explainsEmail.message).toMatch(/still need the full email address/i);
    expect(explainsEmail.message).toMatch(/yes alone doesn't provide it/i);

    await agent.handleMessage(sessionId, MAYA_EMAIL);
    const explainsReason = await agent.handleMessage(sessionId, "yes");
    expect(explainsReason.message).toMatch(/still need a short reason/i);
    expect(explainsReason.trace).toContainEqual(
      expect.objectContaining({
        category: "guardrail",
        name: "required_input_after_confirmation",
        status: "blocked",
      }),
    );
    expect(createReturn).not.toHaveBeenCalled();
  });

  it("closes an unfinished request when the customer says no", async () => {
    const { agent, tools } = createHarness();
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "cancel-unfinished-return";

    await agent.handleMessage(sessionId, "Start a return.");
    const cancelled = await agent.handleMessage(sessionId, "no");

    expect(cancelled).toMatchObject({ intent: "unknown", status: "resolved" });
    expect(cancelled.message).toMatch(/haven't created or changed anything/i);
    expect(cancelled.trace).toContainEqual(
      expect.objectContaining({
        category: "guardrail",
        name: "workflow_cancelled",
        status: "succeeded",
      }),
    );
    expect(createReturn).not.toHaveBeenCalled();
  });

  it("remembers collected slots across turns and contextual follow-ups", async () => {
    const { agent, tools } = createHarness();
    const lookupOrder = vi.spyOn(tools, "lookupOrder");
    const sessionId = "slot-memory";

    const asksForEmail = await agent.handleMessage(
      sessionId,
      "Track order BK-10421.",
    );
    expect(asksForEmail.message).toMatch(/email address/i);

    const firstLookup = await agent.handleMessage(sessionId, MAYA_EMAIL);
    expect(firstLookup.status).toBe("resolved");

    const followUp = await agent.handleMessage(
      sessionId,
      "Is it still on the way?",
    );
    expect(followUp.status).toBe("resolved");
    expect(followUp.message).toContain("BK-10421");
    expect(followUp.message).toContain("has shipped");
    expect(lookupOrder).toHaveBeenCalledTimes(2);
    expect(lookupOrder).toHaveBeenLastCalledWith({
      orderId: "BK-10421",
      email: MAYA_EMAIL,
    });
  });

  it("carries a verified order into an explicit 'return it' request", async () => {
    const { agent, tools } = createHarness();
    const lookupOrder = vi.spyOn(tools, "lookupOrder");
    const checkEligibility = vi.spyOn(tools, "checkReturnEligibility");
    const sessionId = "status-to-return-context";

    const status = await agent.handleMessage(
      sessionId,
      `Where is order BK-10421? My email is ${MAYA_EMAIL}.`,
    );
    expect(status.status).toBe("resolved");

    const contextualReturn = await agent.handleMessage(sessionId, "return it");
    expect(contextualReturn).toMatchObject({
      intent: "return_request",
      status: "resolved",
    });
    expect(contextualReturn.message).toMatch(/after the order has been delivered/i);
    expect(contextualReturn.message).not.toMatch(/order number|email address/i);
    expect(contextualReturn.trace).toContainEqual(
      expect.objectContaining({
        category: "memory",
        name: "context_carried_forward",
        status: "succeeded",
      }),
    );
    expect(lookupOrder).toHaveBeenCalledTimes(2);
    expect(lookupOrder).toHaveBeenLastCalledWith({
      orderId: "BK-10421",
      email: MAYA_EMAIL,
    });
    expect(checkEligibility).toHaveBeenCalledWith({ orderId: "BK-10421" });
  });

  it("asks only for the return reason when the referenced order is eligible", async () => {
    const { agent } = createHarness();
    const sessionId = "eligible-status-to-return-context";

    await agent.handleMessage(
      sessionId,
      `Where is order BK-10422? My email is ${MAYA_EMAIL}.`,
    );
    const contextualReturn = await agent.handleMessage(
      sessionId,
      "Can I return it?",
    );

    expect(contextualReturn).toMatchObject({
      intent: "return_request",
      status: "needs_input",
    });
    expect(contextualReturn.message).toMatch(/reason for the return/i);
    expect(contextualReturn.message).not.toMatch(/order number|email address/i);
  });

  it("does not carry an order across a conflicting customer email", async () => {
    const { agent } = createHarness();
    const sessionId = "contextual-return-customer-change";

    await agent.handleMessage(
      sessionId,
      `Where is order BK-10421? My email is ${MAYA_EMAIL}.`,
    );
    const differentCustomer = await agent.handleMessage(
      sessionId,
      "Return it. My email is jon.bell@example.com.",
    );

    expect(differentCustomer).toMatchObject({
      intent: "return_request",
      status: "needs_input",
    });
    expect(differentCustomer.message).toMatch(/order number/i);
    expect(differentCustomer.message).not.toMatch(/BK-10421 has shipped/i);
  });

  it.each(["Track another order.", "Where is my other order?"])(
    "asks for a new identifier for a fresh order lookup: %s",
    async (message) => {
      const { agent, tools } = createHarness();
      const lookupOrder = vi.spyOn(tools, "lookupOrder");
      const sessionId = `fresh-order-${message.length}`;

      const firstOrder = await agent.handleMessage(
        sessionId,
        `Where is BK-10421? My email is ${MAYA_EMAIL}.`,
      );
      expect(firstOrder.status).toBe("resolved");

      const freshOrder = await agent.handleMessage(sessionId, message);
      expect(freshOrder).toMatchObject({
        intent: "order_status",
        status: "needs_input",
      });
      expect(freshOrder.message).toMatch(/order number/i);
      expect(lookupOrder).toHaveBeenCalledTimes(1);
      expect(freshOrder.trace).toContainEqual(
        expect.objectContaining({
          category: "memory",
          name: "workflow_restart",
          status: "succeeded",
        }),
      );
    },
  );

  // --- Return write path: eligibility, confirmation, and stale-input guards ---

  it("collects return fields and creates exactly one return only after confirmation", async () => {
    const { agent, tools } = createHarness();
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "eligible-return";

    const asksForOrder = await agent.handleMessage(
      sessionId,
      "I need to return a book.",
    );
    expect(asksForOrder.message).toMatch(/order number/i);

    const asksForEmail = await agent.handleMessage(sessionId, "BK-10422");
    expect(asksForEmail.message).toMatch(/email address/i);

    const asksForReason = await agent.handleMessage(sessionId, MAYA_EMAIL);
    expect(asksForReason.message).toMatch(/reason for the return/i);

    const confirmationGate = await agent.handleMessage(
      sessionId,
      "It did not fit.",
    );
    expect(confirmationGate).toMatchObject({
      intent: "return_request",
      status: "needs_confirmation",
    });
    expect(confirmationGate.message).toMatch(/eligible for return/i);
    expect(confirmationGate.message).toMatch(/reply yes or no/i);
    expect(createReturn).not.toHaveBeenCalled();
    expect(confirmationGate.trace).toContainEqual(
      expect.objectContaining({
        category: "guardrail",
        name: "explicit_confirmation",
        status: "blocked",
      }),
    );

    const confirmed = await agent.handleMessage(sessionId, "yes");
    expect(confirmed).toMatchObject({
      intent: "return_request",
      status: "resolved",
    });
    expect(confirmed.message).toContain("Return RET-0001 is authorized");
    expect(confirmed.message).toContain("order BK-10422");
    expect(createReturn).toHaveBeenCalledTimes(1);
    expect(createReturn).toHaveBeenCalledWith({
      orderId: "BK-10422",
      email: MAYA_EMAIL,
      reason: "It did not fit",
      confirmed: true,
    });
  });

  // Structured provider output is a hint; customer-authored evidence must win before a write is staged.
  it("asks for a reason when the model proposes one the customer never supplied", async () => {
    const client: IntentResponsesParseClient = {
      responses: {
        parse: async () => ({
          output_parsed: {
            intent: "return_request",
            contextAction: "continue",
            orderId: "BK-10422",
            email: MAYA_EMAIL,
            returnReason: "arrived damaged",
          },
        }),
      },
    };
    const tools = new MockBooklyTools();
    const agent = new BooklyAgent(
      new OpenAIIntentRouter("unused-test-key", "test-model", client),
      tools,
    );
    const createReturn = vi.spyOn(tools, "createReturn");

    const reply = await agent.handleMessage(
      "ungrounded-return-reason",
      `Please return BK-10422. My email is ${MAYA_EMAIL}.`,
    );

    expect(reply).toMatchObject({
      intent: "return_request",
      status: "needs_input",
    });
    expect(reply.message).toMatch(/reason for the return/i);
    expect(createReturn).not.toHaveBeenCalled();
  });

  it("does not copy a trailing email into the return reason", async () => {
    const { agent, tools } = createHarness();
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "reason-boundary";

    const prepared = await agent.handleMessage(
      sessionId,
      `I need to return order BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    expect(prepared.status).toBe("needs_confirmation");

    await agent.handleMessage(sessionId, "Yes, create the return.");
    expect(createReturn).toHaveBeenCalledWith({
      orderId: "BK-10422",
      email: MAYA_EMAIL,
      reason: "it did not fit",
      confirmed: true,
    });
  });

  it("never creates a return for ineligible order BK-10423", async () => {
    const { agent, tools } = createHarness();
    const createReturn = vi.spyOn(tools, "createReturn");

    const reply = await agent.handleMessage(
      "ineligible-return",
      `Can I return BK-10423? My email is ${MAYA_EMAIL}.`,
    );

    expect(reply).toMatchObject({
      intent: "return_request",
      status: "resolved",
    });
    expect(reply.message).toMatch(/30-day return window has ended/i);
    expect(reply.message).toMatch(/haven't created a return/i);
    expect(reply.message).not.toMatch(/reason for the return/i);
    expect(createReturn).not.toHaveBeenCalled();
    expect(reply.trace).toContainEqual(
      expect.objectContaining({
        category: "tool",
        name: "checkReturnEligibility",
        status: "succeeded",
      }),
    );
  });

  it("blocks an ambiguous response at the confirmation boundary", async () => {
    const { agent, tools } = createHarness();
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "ambiguous-confirmation";

    const prepared = await agent.handleMessage(
      sessionId,
      `My email is ${MAYA_EMAIL}. I need to return BK-10422 because it did not fit.`,
    );
    expect(prepared.status).toBe("needs_confirmation");

    const ambiguous = await agent.handleMessage(
      sessionId,
      "Yes, if return shipping is free.",
    );
    expect(ambiguous.status).toBe("needs_confirmation");
    expect(ambiguous.message).toMatch(/clear yes or no/i);
    expect(createReturn).not.toHaveBeenCalled();
    expect(ambiguous.trace).toContainEqual(
      expect.objectContaining({
        category: "guardrail",
        name: "explicit_confirmation",
        status: "blocked",
      }),
    );
  });

  it("does not create a return when the customer says no", async () => {
    const { agent, tools } = createHarness();
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "declined-return";

    const prepared = await agent.handleMessage(
      sessionId,
      `My email is ${MAYA_EMAIL}. Return BK-10422 because it did not fit.`,
    );
    expect(prepared.status).toBe("needs_confirmation");

    const declined = await agent.handleMessage(sessionId, "No thanks.");
    expect(declined.status).toBe("resolved");
    expect(declined.message).toMatch(/did not create a return/i);
    expect(createReturn).not.toHaveBeenCalled();
  });

  it("invalidates a pending return when its customer details change", async () => {
    const { agent, tools } = createHarness();
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "changed-pending-input";

    const prepared = await agent.handleMessage(
      sessionId,
      `My email is ${MAYA_EMAIL}. Return BK-10422 because it did not fit.`,
    );
    expect(prepared.status).toBe("needs_confirmation");

    const changed = await agent.handleMessage(
      sessionId,
      "Actually, use jon.bell@example.com.",
    );
    expect(changed.status).toBe("needs_input");
    expect(changed.trace).toContainEqual(
      expect.objectContaining({
        category: "guardrail",
        name: "stale_confirmation",
        status: "blocked",
      }),
    );

    const staleYes = await agent.handleMessage(sessionId, "yes");
    expect(staleYes.status).not.toBe("resolved");
    expect(createReturn).not.toHaveBeenCalled();
  });

  it("handles an identity mismatch without revealing order data", async () => {
    const { agent } = createHarness();

    const reply = await agent.handleMessage(
      "identity-mismatch",
      "Where is order BK-10421? My email is jon.bell@example.com.",
    );

    expect(reply.status).toBe("needs_input");
    expect(reply.message).toMatch(/couldn't match that order number and email/i);
    expect(reply.message).not.toMatch(/Maya|UPS|1ZBOOKLY10421/i);
    expect(reply.trace).toContainEqual(
      expect.objectContaining({
        category: "tool",
        name: "lookupOrder",
        status: "failed",
      }),
    );
    expect(JSON.stringify(reply.trace)).not.toMatch(
      /maya\.chen@example\.com|jon\.bell@example\.com|1ZBOOKLY10421/i,
    );
  });

  it("returns a safe error and trace when return creation is unavailable", async () => {
    const { agent } = createHarness({ failOperations: ["createReturn"] });
    const sessionId = "tool-outage";

    const prepared = await agent.handleMessage(
      sessionId,
      `My email is ${MAYA_EMAIL}. Return BK-10422 because it did not fit.`,
    );
    expect(prepared.status).toBe("needs_confirmation");

    const failed = await agent.handleMessage(sessionId, "yes");
    expect(failed.status).toBe("error");
    expect(failed.message).toMatch(/temporarily unavailable/i);
    expect(failed.message).toMatch(/haven't made any changes/i);
    expect(failed.message).not.toContain("createReturn");
    expect(failed.trace).toContainEqual({
      category: "tool",
      name: "createReturn",
      status: "failed",
      detail: "The tool returned a safe temporary_unavailable failure.",
    });
  });

  it("clears a stale pending return on topic switch while retaining email", async () => {
    const { agent, tools } = createHarness();
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "topic-switch";

    const pendingReturn = await agent.handleMessage(
      sessionId,
      `My email is ${MAYA_EMAIL}. Return BK-10422 because it did not fit.`,
    );
    expect(pendingReturn.status).toBe("needs_confirmation");

    const switched = await agent.handleMessage(
      sessionId,
      "Where is order BK-10421?",
    );
    expect(switched).toMatchObject({
      intent: "order_status",
      status: "resolved",
    });
    expect(switched.message).toContain("Order BK-10421 has shipped");
    expect(switched.message).not.toMatch(/email address/i);
    expect(switched.trace).toContainEqual(
      expect.objectContaining({
        category: "memory",
        name: "workflow_switch",
        status: "succeeded",
      }),
    );

    const staleYes = await agent.handleMessage(sessionId, "yes");
    expect(staleYes.intent).toBe("unknown");
    expect(staleYes.status).toBe("needs_input");
    expect(createReturn).not.toHaveBeenCalled();
  });

  // --- Failure repair and completed-workflow boundaries ---

  it("does not repeat a completed workflow for an unrelated message", async () => {
    const { agent, tools } = createHarness();
    const lookupOrder = vi.spyOn(tools, "lookupOrder");
    const sessionId = "completed-topic";

    const resolved = await agent.handleMessage(
      sessionId,
      `Where is BK-10421? My email is ${MAYA_EMAIL}.`,
    );
    expect(resolved.status).toBe("resolved");

    const unrelated = await agent.handleMessage(sessionId, "Thanks for the help.");
    expect(unrelated).toMatchObject({
      intent: "unknown",
      status: "needs_input",
    });
    expect(lookupOrder).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a completed order in a later workflow", async () => {
    const { agent } = createHarness();
    const sessionId = "completed-order-cleanup";

    const status = await agent.handleMessage(
      sessionId,
      `Where is BK-10421? My email is ${MAYA_EMAIL}.`,
    );
    expect(status.status).toBe("resolved");

    const closed = await agent.handleMessage(sessionId, "Thanks.");
    expect(closed.intent).toBe("unknown");

    const newReturn = await agent.handleMessage(
      sessionId,
      "I want to return a book.",
    );
    expect(newReturn).toMatchObject({
      intent: "return_request",
      status: "needs_input",
    });
    expect(newReturn.message).toMatch(/order number/i);
    expect(newReturn.message).not.toContain("BK-10421");
  });

  it("returns a safe response when the language router fails", async () => {
    const tools = new MockBooklyTools();
    const agent = new BooklyAgent(
      {
        route: async () => {
          throw new Error("provider details must not reach the customer");
        },
      },
      tools,
    );

    const reply = await agent.handleMessage("router-failure", "Where is my order?");

    expect(reply).toMatchObject({ intent: "unknown", status: "error" });
    expect(reply.message).toMatch(/try again/i);
    expect(reply.message).not.toMatch(/provider details/i);
    expect(reply.trace).toContainEqual({
      category: "routing",
      name: "intentRouter",
      status: "failed",
      detail: "The router failed without exposing its internal error.",
    });
  });

  // Confirmation is resolved before routing so a provider outage cannot weaken the final write gate.
  it("completes an exact pending confirmation without another router call", async () => {
    const tools = new MockBooklyTools();
    const deterministicRouter = new DeterministicIntentRouter();
    let routerCalls = 0;
    const agent = new BooklyAgent(
      {
        route: async (input) => {
          routerCalls += 1;
          if (routerCalls > 1) throw new Error("simulated provider outage");
          return deterministicRouter.route(input);
        },
      },
      tools,
    );
    const sessionId = "confirmation-with-provider-outage";

    const prepared = await agent.handleMessage(
      sessionId,
      `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    expect(prepared.status).toBe("needs_confirmation");

    const confirmed = await agent.handleMessage(sessionId, "yes");
    expect(confirmed.status).toBe("resolved");
    expect(confirmed.message).toMatch(/RET-0001 is authorized/i);
    expect(routerCalls).toBe(1);
    expect(confirmed.trace).toContainEqual(
      expect.objectContaining({
        name: "confirmationPolicy",
        status: "succeeded",
      }),
    );
  });

  it("discards a pending write when changed input cannot be routed safely", async () => {
    const tools = new MockBooklyTools();
    const deterministicRouter = new DeterministicIntentRouter();
    let routerCalls = 0;
    const agent = new BooklyAgent(
      {
        route: async (input) => {
          routerCalls += 1;
          if (routerCalls > 1) throw new Error("simulated provider outage");
          return deterministicRouter.route(input);
        },
      },
      tools,
    );
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "changed-input-provider-outage";

    const prepared = await agent.handleMessage(
      sessionId,
      `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    expect(prepared.status).toBe("needs_confirmation");

    const failedChange = await agent.handleMessage(
      sessionId,
      "Yes, but change the email to jon.bell@example.com.",
    );
    expect(failedChange.status).toBe("error");
    expect(failedChange.trace).toContainEqual(
      expect.objectContaining({
        name: "stale_confirmation",
        status: "blocked",
      }),
    );

    const staleYes = await agent.handleMessage(sessionId, "yes");
    expect(staleYes.status).toBe("needs_input");
    expect(staleYes.message).toMatch(/reason for the return/i);
    expect(createReturn).not.toHaveBeenCalled();
  });

  it("invalidates an explicit identity change even when the router omits its slot", async () => {
    const tools = new MockBooklyTools();
    const deterministicRouter = new DeterministicIntentRouter();
    let routerCalls = 0;
    const agent = new BooklyAgent(
      {
        route: async (input) => {
          routerCalls += 1;
          if (routerCalls === 1) return deterministicRouter.route(input);
          return {
            intent: "unknown" as const,
            slots: {},
            contextAction: "continue" as const,
          };
        },
      },
      tools,
    );
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "router-omits-changed-identity";

    await agent.handleMessage(
      sessionId,
      `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    const changed = await agent.handleMessage(
      sessionId,
      "Actually use jon.bell@example.com instead.",
    );

    expect(changed.trace).toContainEqual(
      expect.objectContaining({
        name: "stale_confirmation",
        status: "blocked",
      }),
    );
    await agent.handleMessage(sessionId, "yes");
    expect(createReturn).not.toHaveBeenCalled();
  });

  it("re-stages an explicit reason change and confirms the new reason", async () => {
    const { agent, tools } = createHarness();
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "changed-return-reason";

    const prepared = await agent.handleMessage(
      sessionId,
      `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    expect(prepared.message).toMatch(/it did not fit/i);

    const changed = await agent.handleMessage(
      sessionId,
      "Actually change the reason to unopened.",
    );
    expect(changed).toMatchObject({
      intent: "return_request",
      status: "needs_confirmation",
    });
    expect(changed.message).toMatch(/return reason:.*unopened/i);
    expect(changed.message).not.toMatch(/it did not fit/i);
    expect(changed.trace).toContainEqual(
      expect.objectContaining({
        name: "stale_confirmation",
        status: "blocked",
      }),
    );

    await agent.handleMessage(sessionId, "yes");
    expect(createReturn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "unopened", confirmed: true }),
    );
  });

  it("closes confirmation state when a return already exists", async () => {
    const tools = new MockBooklyTools();
    const firstAgent = new BooklyAgent(new DeterministicIntentRouter(), tools);
    const secondAgent = new BooklyAgent(new DeterministicIntentRouter(), tools);
    const request = `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`;

    await firstAgent.handleMessage("first-return", request);
    await firstAgent.handleMessage("first-return", "yes");

    await secondAgent.handleMessage("duplicate-return", request);
    const duplicate = await secondAgent.handleMessage("duplicate-return", "yes");
    expect(duplicate).toMatchObject({ status: "resolved" });
    expect(duplicate.message).toMatch(/return already exists/i);

    const nextTurn = await secondAgent.handleMessage(
      "duplicate-return",
      "Thanks for the help.",
    );
    expect(nextTurn).toMatchObject({
      intent: "unknown",
      status: "needs_input",
    });
    expect(nextTurn.message).not.toMatch(/clear yes or no/i);
  });

  // --- Post-return aftercare and specialist handoff ---

  it("hands off a missing-label follow-up without replaying the completed return", async () => {
    const { agent, tools } = createHarness();
    const lookupOrder = vi.spyOn(tools, "lookupOrder");
    const checkEligibility = vi.spyOn(tools, "checkReturnEligibility");
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "missing-label-handoff";

    await agent.handleMessage(
      sessionId,
      `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    const created = await agent.handleMessage(sessionId, "yes");
    expect(created.message).toMatch(/RET-0001 is authorized/i);

    const handoff = await agent.handleMessage(
      sessionId,
      "I didn't get the labe yet.",
    );

    expect(handoff).toMatchObject({
      intent: "handoff",
      status: "resolved",
    });
    expect(handoff.message).toMatch(/RET-0001 is already authorized/i);
    expect(handoff.message).toMatch(/can't verify return status/i);
    expect(handoff.message).toMatch(/support specialist/i);
    expect(handoff.message).toMatch(/haven't changed anything/i);
    expect(handoff.message).not.toMatch(/eligible for return|reply yes or no/i);
    expect(handoff.trace).toContainEqual(
      expect.objectContaining({
        category: "routing",
        name: "intentRouter",
        status: "succeeded",
      }),
    );
    expect(handoff.trace).toContainEqual(
      expect.objectContaining({
        category: "guardrail",
        name: "human_handoff",
        status: "blocked",
      }),
    );
    expect(handoff.trace).not.toContainEqual(
      expect.objectContaining({ category: "tool" }),
    );
    expect(lookupOrder).toHaveBeenCalledTimes(1);
    expect(checkEligibility).toHaveBeenCalledTimes(1);
    expect(createReturn).toHaveBeenCalledTimes(1);

    const staleYes = await agent.handleMessage(sessionId, "yes");
    expect(staleYes.message).toMatch(/no pending action/i);
    expect(staleYes.message).toMatch(/RET-0001 remains authorized/i);
    expect(lookupOrder).toHaveBeenCalledTimes(1);
    expect(checkEligibility).toHaveBeenCalledTimes(1);
    expect(createReturn).toHaveBeenCalledTimes(1);

    const supportedFollowUp = await agent.handleMessage(
      sessionId,
      "Where is order BK-10421?",
    );
    expect(supportedFollowUp).toMatchObject({
      intent: "order_status",
      status: "resolved",
    });
    expect(supportedFollowUp.message).toMatch(/BK-10421 has shipped/i);
    expect(lookupOrder).toHaveBeenCalledTimes(2);
    expect(checkEligibility).toHaveBeenCalledTimes(1);
    expect(createReturn).toHaveBeenCalledTimes(1);
  });

  it("handles a known post-return issue even when the language router is unavailable", async () => {
    const tools = new MockBooklyTools();
    const deterministicRouter = new DeterministicIntentRouter();
    let routerCalls = 0;
    const agent = new BooklyAgent(
      {
        route: async (input) => {
          routerCalls += 1;
          if (routerCalls > 1) throw new Error("simulated provider outage");
          return deterministicRouter.route(input);
        },
      },
      tools,
    );
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "post-return-provider-outage";

    await agent.handleMessage(
      sessionId,
      `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    await agent.handleMessage(sessionId, "yes");
    const handoff = await agent.handleMessage(
      sessionId,
      "Can you resend the label?",
    );

    expect(handoff).toMatchObject({ intent: "handoff", status: "resolved" });
    expect(handoff.message).toMatch(/RET-0001/i);
    expect(routerCalls).toBe(2);
    expect(handoff.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "intentRouter", status: "failed" }),
        expect.objectContaining({
          name: "providerOutageFallback",
          status: "succeeded",
        }),
      ]),
    );
    expect(createReturn).toHaveBeenCalledTimes(1);
  });

  it("uses the language router for novel existing-return phrasing without replaying tools", async () => {
    const tools = new MockBooklyTools();
    const deterministicRouter = new DeterministicIntentRouter();
    let routerCalls = 0;
    const agent = new BooklyAgent(
      {
        route: async (input) => {
          routerCalls += 1;
          if (routerCalls === 1) return deterministicRouter.route(input);
          return {
            intent: "existing_return_status" as const,
            slots: {},
            contextAction: "continue" as const,
          };
        },
      },
      tools,
    );
    const lookupOrder = vi.spyOn(tools, "lookupOrder");
    const checkEligibility = vi.spyOn(tools, "checkReturnEligibility");
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "novel-routed-aftercare";

    await agent.handleMessage(
      sessionId,
      `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    await agent.handleMessage(sessionId, "yes");
    const handoff = await agent.handleMessage(
      sessionId,
      "The paperwork for my approved return is unreadable.",
    );

    expect(handoff).toMatchObject({ intent: "handoff", status: "resolved" });
    expect(handoff.message).toMatch(/RET-0001|support specialist/i);
    expect(handoff.trace).toContainEqual(
      expect.objectContaining({ name: "intentRouter", status: "succeeded" }),
    );
    expect(handoff.trace).not.toContainEqual(
      expect.objectContaining({ name: "providerOutageFallback" }),
    );
    expect(routerCalls).toBe(2);
    expect(lookupOrder).toHaveBeenCalledTimes(1);
    expect(checkEligibility).toHaveBeenCalledTimes(1);
    expect(createReturn).toHaveBeenCalledTimes(1);
  });

  // A router may request reuse, but only completed lookup evidence can establish trusted context.
  it("rejects a router hint to reuse context without a verified completed lookup", async () => {
    const tools = new MockBooklyTools();
    const agent = new BooklyAgent(
      {
        route: async () => ({
          intent: "return_request" as const,
          slots: {},
          contextAction: "reuse_verified_order" as const,
        }),
      },
      tools,
    );
    const lookupOrder = vi.spyOn(tools, "lookupOrder");

    const reply = await agent.handleMessage(
      "invalid-context-reuse",
      "Return it.",
    );

    expect(reply).toMatchObject({
      intent: "return_request",
      status: "needs_input",
    });
    expect(reply.message).toMatch(/order number/i);
    expect(reply.trace).toContainEqual(
      expect.objectContaining({
        category: "guardrail",
        name: "context_reuse",
        status: "blocked",
      }),
    );
    expect(lookupOrder).not.toHaveBeenCalled();
  });

  it.each([
    "I got the label, thanks.",
    "The return label arrived.",
    "I downloaded my label successfully.",
  ])("acknowledges a successful label update without replay: %s", async (message) => {
    const { agent, tools } = createHarness();
    const lookupOrder = vi.spyOn(tools, "lookupOrder");
    const checkEligibility = vi.spyOn(tools, "checkReturnEligibility");
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = `label-arrived-${message.length}`;

    await agent.handleMessage(
      sessionId,
      `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    await agent.handleMessage(sessionId, "yes");
    const acknowledgement = await agent.handleMessage(sessionId, message);

    expect(acknowledgement).toMatchObject({
      intent: "post_return_acknowledgement",
      status: "resolved",
    });
    expect(acknowledgement.message).toMatch(/RET-0001 remains authorized/i);
    expect(acknowledgement.message).not.toMatch(/order number|reply yes or no/i);
    expect(acknowledgement.trace).toContainEqual(
      expect.objectContaining({
        category: "routing",
        name: "postReturnAcknowledgement",
        status: "succeeded",
      }),
    );
    expect(lookupOrder).toHaveBeenCalledTimes(1);
    expect(checkEligibility).toHaveBeenCalledTimes(1);
    expect(createReturn).toHaveBeenCalledTimes(1);
  });

  it.each([
    "I have trouble downloading my return label.",
    "I haven’t received the label yet.",
    "I downloaded my label but it doesn't work.",
    "I received the label, but it is blank.",
  ])("hands off a label problem instead of treating it as success: %s", async (message) => {
    const { agent, tools } = createHarness();
    const lookupOrder = vi.spyOn(tools, "lookupOrder");
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "label-download-problem";

    await agent.handleMessage(
      sessionId,
      `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    await agent.handleMessage(sessionId, "yes");
    const problem = await agent.handleMessage(sessionId, message);

    expect(problem).toMatchObject({ intent: "handoff", status: "resolved" });
    expect(problem.message).toMatch(/support specialist/i);
    expect(problem.message).not.toMatch(/glad it arrived/i);
    expect(lookupOrder).toHaveBeenCalledTimes(1);
    expect(createReturn).toHaveBeenCalledTimes(1);
  });

  // --- Fresh workflows and identity isolation after completion ---

  it("starts a genuinely new return without reusing completed-return fields", async () => {
    const { agent, tools } = createHarness();
    const lookupOrder = vi.spyOn(tools, "lookupOrder");
    const createReturn = vi.spyOn(tools, "createReturn");
    const sessionId = "new-return-after-completion";

    await agent.handleMessage(
      sessionId,
      `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    await agent.handleMessage(sessionId, "yes");

    const missingNewOrder = await agent.handleMessage(
      sessionId,
      "I need to return another book.",
    );
    expect(missingNewOrder).toMatchObject({
      intent: "return_request",
      status: "needs_input",
    });
    expect(missingNewOrder.message).toMatch(/order number/i);
    expect(lookupOrder).toHaveBeenCalledTimes(1);
    expect(missingNewOrder.trace).toContainEqual(
      expect.objectContaining({
        category: "memory",
        name: "workflow_restart",
        status: "succeeded",
      }),
    );

    const newReturn = await agent.handleMessage(sessionId, "BK-10423");
    expect(newReturn).toMatchObject({
      intent: "return_request",
      status: "resolved",
    });
    expect(newReturn.message).toMatch(/30-day return window has ended/i);
    expect(createReturn).toHaveBeenCalledTimes(1);
  });

  it("clears the old return receipt when starting a fresh order lookup", async () => {
    const { agent } = createHarness();
    const sessionId = "fresh-order-clears-return-receipt";

    await agent.handleMessage(
      sessionId,
      `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    await agent.handleMessage(sessionId, "yes");

    const freshOrder = await agent.handleMessage(
      sessionId,
      "Track another order.",
    );
    expect(freshOrder).toMatchObject({
      intent: "order_status",
      status: "needs_input",
    });

    const unrelatedAftercare = await agent.handleMessage(
      sessionId,
      "I didn't get the label yet.",
    );
    expect(unrelatedAftercare).toMatchObject({
      intent: "handoff",
      status: "resolved",
    });
    expect(unrelatedAftercare.message).not.toMatch(/RET-0001|BK-10422/i);
  });

  it("routes an explicit human request to a terminal handoff without tools", async () => {
    const { agent, tools } = createHarness();
    const lookupOrder = vi.spyOn(tools, "lookupOrder");

    const reply = await agent.handleMessage(
      "explicit-human-handoff",
      "Can I talk to a human representative?",
    );

    expect(reply).toMatchObject({ intent: "handoff", status: "resolved" });
    expect(reply.message).toMatch(/outside the approved FAQs/i);
    expect(reply.message).toMatch(/support specialist/i);
    expect(lookupOrder).not.toHaveBeenCalled();
  });

  it.each([
    "Where is my refund?",
    "What is the status of return RET-0001?",
  ])("routes existing-return aftercare to handoff: %s", async (message) => {
    const { agent, tools } = createHarness();
    const lookupOrder = vi.spyOn(tools, "lookupOrder");

    const reply = await agent.handleMessage(
      `aftercare-${message.length}`,
      message,
    );

    expect(reply).toMatchObject({ intent: "handoff", status: "resolved" });
    expect(reply.message).toMatch(/support specialist/i);
    expect(reply.message).not.toMatch(/order number|reply yes or no/i);
    expect(lookupOrder).not.toHaveBeenCalled();
  });

  it("clears a completed return reference when the customer email changes", async () => {
    const { agent } = createHarness();
    const sessionId = "customer-context-switch";

    await agent.handleMessage(
      sessionId,
      `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    await agent.handleMessage(sessionId, "yes");

    const switchedCustomer = await agent.handleMessage(
      sessionId,
      "Where is order BK-10424? My email is jon.bell@example.com.",
    );
    expect(switchedCustomer).toMatchObject({
      intent: "order_status",
      status: "resolved",
    });
    expect(switchedCustomer.trace).toContainEqual(
      expect.objectContaining({
        category: "memory",
        name: "customer_context_changed",
        status: "succeeded",
      }),
    );

    const aftercare = await agent.handleMessage(
      sessionId,
      "I didn't get the label yet.",
    );
    expect(aftercare).toMatchObject({ intent: "handoff", status: "resolved" });
    expect(aftercare.message).not.toMatch(/RET-0001|BK-10422/i);
    expect(aftercare.message).toMatch(/support specialist/i);
  });

  it("does not reveal a completed return when aftercare supplies a different email", async () => {
    const { agent } = createHarness();
    const sessionId = "same-turn-customer-switch";

    await agent.handleMessage(
      sessionId,
      `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    await agent.handleMessage(sessionId, "yes");

    const aftercare = await agent.handleMessage(
      sessionId,
      "I did not get the label. My email is jon.bell@example.com.",
    );

    expect(aftercare).toMatchObject({ intent: "handoff", status: "resolved" });
    expect(aftercare.message).not.toMatch(/RET-0001|BK-10422/i);
    expect(aftercare.message).toMatch(/support specialist/i);
    expect(aftercare.trace).toContainEqual(
      expect.objectContaining({
        category: "memory",
        name: "customer_context_changed",
        status: "succeeded",
      }),
    );
  });

  it("does not reveal a completed return when aftercare names a different order", async () => {
    const { agent } = createHarness();
    const sessionId = "same-turn-order-switch";

    await agent.handleMessage(
      sessionId,
      `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
    );
    await agent.handleMessage(sessionId, "yes");

    const aftercare = await agent.handleMessage(
      sessionId,
      "Where is my return label for BK-10423?",
    );

    expect(aftercare).toMatchObject({ intent: "handoff", status: "resolved" });
    expect(aftercare.message).not.toMatch(/RET-0001|BK-10422/i);
    expect(aftercare.message).toMatch(/support specialist/i);
    expect(aftercare.trace).toContainEqual(
      expect.objectContaining({
        category: "memory",
        name: "order_context_changed",
        status: "succeeded",
      }),
    );
  });

  // Privacy ordering matters: clear conflicting context before considering an outage fallback.
  it.each([
    [
      "customer",
      "I did not get the label. My email is jon.bell@example.com.",
      "customer_context_changed",
    ],
    [
      "order",
      "Where is my return label for BK-10423?",
      "order_context_changed",
    ],
  ])(
    "does not use the outage fallback after a same-turn %s context change",
    async (_kind, message, contextTrace) => {
      const tools = new MockBooklyTools();
      const deterministicRouter = new DeterministicIntentRouter();
      let routerCalls = 0;
      const agent = new BooklyAgent(
        {
          route: async (input) => {
            routerCalls += 1;
            if (routerCalls === 1) return deterministicRouter.route(input);
            throw new Error("simulated provider outage");
          },
        },
        tools,
      );
      const lookupOrder = vi.spyOn(tools, "lookupOrder");
      const checkEligibility = vi.spyOn(tools, "checkReturnEligibility");
      const createReturn = vi.spyOn(tools, "createReturn");
      const sessionId = `outage-context-change-${_kind}`;

      await agent.handleMessage(
        sessionId,
        `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
      );
      await agent.handleMessage(sessionId, "yes");
      const reply = await agent.handleMessage(sessionId, message);

      expect(reply.status).toBe("error");
      expect(reply.message).not.toMatch(/RET-0001|BK-10422/i);
      expect(reply.trace).toContainEqual(
        expect.objectContaining({ name: contextTrace, status: "succeeded" }),
      );
      expect(reply.trace).toContainEqual(
        expect.objectContaining({ name: "intentRouter", status: "failed" }),
      );
      expect(reply.trace).not.toContainEqual(
        expect.objectContaining({ name: "providerOutageFallback" }),
      );
      expect(routerCalls).toBe(2);
      expect(lookupOrder).toHaveBeenCalledTimes(1);
      expect(checkEligibility).toHaveBeenCalledTimes(1);
      expect(createReturn).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [
      "customer",
      `Change my email from ${MAYA_EMAIL} to jon.bell@example.com. I did not get the label.`,
      "customer_context_changed",
    ],
    [
      "order",
      "Ignore BK-10422; I mean BK-10423. I did not get the label.",
      "order_context_changed",
    ],
  ])(
    "clears a receipt when a same-turn %s correction includes old and new values",
    async (_kind, message, contextTrace) => {
      const { agent } = createHarness();
      const sessionId = `multi-value-context-change-${_kind}`;

      await agent.handleMessage(
        sessionId,
        `Return BK-10422 because it did not fit. My email is ${MAYA_EMAIL}.`,
      );
      await agent.handleMessage(sessionId, "yes");
      const reply = await agent.handleMessage(sessionId, message);

      expect(reply).toMatchObject({ intent: "handoff", status: "resolved" });
      expect(reply.message).not.toMatch(/RET-0001|BK-10422/i);
      expect(reply.trace).toContainEqual(
        expect.objectContaining({ name: contextTrace, status: "succeeded" }),
      );
    },
  );
});
