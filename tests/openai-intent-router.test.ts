// Responsibility: Verify the OpenAI routing adapter's structured request, validation, and normalization behavior.
// Boundary: The Responses client is mocked; no network call, workflow, session, or tool side effect is exercised.

import { ZodError } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  OpenAIIntentRouter,
  type IntentParseRequest,
  type IntentResponsesParseClient,
} from "../src/providers/openai-intent-router.js";

const ROUTER_INPUT = {
  message:
    "Return BK10421 because the cover arrived damaged. My email is maya.chen@example.com.",
  currentIntent: "unknown",
  phase: "collecting",
} as const;

describe("OpenAIIntentRouter", () => {
  it("calls structured Responses parsing and normalizes extracted slots", async () => {
    let capturedRequest: IntentParseRequest | undefined;
    const parse = vi.fn(async (request: IntentParseRequest) => {
      capturedRequest = request;
      return {
        output_parsed: {
          intent: "return_request",
          contextAction: "continue",
          orderId: "BK10421",
          email: "  MAYA.CHEN@EXAMPLE.COM  ",
          returnReason: "  the cover arrived damaged  ",
        },
      };
    });
    const client: IntentResponsesParseClient = { responses: { parse } };
    const router = new OpenAIIntentRouter(
      "unused-test-key",
      "test-model",
      client,
    );

    const result = await router.route(ROUTER_INPUT);

    expect(result).toEqual({
      intent: "return_request",
      contextAction: "continue",
      slots: {
        orderId: "BK-10421",
        email: "maya.chen@example.com",
        returnReason: "the cover arrived damaged",
      },
    });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(capturedRequest).toMatchObject({
      model: "test-model",
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "bookly_intent_route",
          strict: true,
        },
      },
    });
    expect(capturedRequest?.input[1]?.content).toBe(
      JSON.stringify(ROUTER_INPUT),
    );

    const prompt = capturedRequest?.input[0]?.content ?? "";
    expect(prompt).toMatch(/BK-10421, BK10421, or BK 10421/i);
    expect(prompt).toMatch(/server canonicalizes/i);
    expect(prompt).toMatch(/missing package is not a return_request/i);
    expect(prompt).toMatch(/damaged book/i);
    expect(prompt).toMatch(/faq/i);
    expect(prompt).toMatch(/existing_return_status/i);
    expect(prompt).toMatch(/post_return_acknowledgement/i);
    expect(prompt).toMatch(/reuse_verified_order/i);
    expect(prompt).toMatch(/start_fresh/i);
  });

  it.each([
    {
      name: "existing return status",
      input: {
        message: "I didn't get the return label yet.",
        currentIntent: "return_request",
        phase: "completed",
      },
      modelRoute: {
        intent: "existing_return_status",
        contextAction: "continue",
      },
    },
    {
      name: "positive return acknowledgement",
      input: {
        message: "The return label arrived.",
        currentIntent: "return_request",
        phase: "completed",
      },
      modelRoute: {
        intent: "post_return_acknowledgement",
        contextAction: "continue",
      },
    },
    {
      name: "verified order reuse",
      input: {
        message: "I want to return it.",
        currentIntent: "order_status",
        phase: "completed",
      },
      modelRoute: {
        intent: "return_request",
        contextAction: "reuse_verified_order",
      },
    },
    {
      name: "fresh order context",
      input: {
        message: "Track another order.",
        currentIntent: "order_status",
        phase: "completed",
      },
      modelRoute: {
        intent: "order_status",
        contextAction: "start_fresh",
      },
    },
  ] as const)("returns the model's $name contract outcome", async (testCase) => {
    const client: IntentResponsesParseClient = {
      responses: {
        parse: async () => ({
          output_parsed: {
            ...testCase.modelRoute,
            orderId: null,
            email: null,
            returnReason: null,
          },
        }),
      },
    };
    const router = new OpenAIIntentRouter(
      "unused-test-key",
      "test-model",
      client,
    );

    await expect(router.route(testCase.input)).resolves.toEqual({
      intent: testCase.modelRoute.intent,
      contextAction: testCase.modelRoute.contextAction,
      slots: {},
    });
  });

  it("rejects a null structured result", async () => {
    const client: IntentResponsesParseClient = {
      responses: {
        parse: async () => ({ output_parsed: null }),
      },
    };
    const router = new OpenAIIntentRouter(
      "unused-test-key",
      "test-model",
      client,
    );

    await expect(router.route(ROUTER_INPUT)).rejects.toThrow(
      /no structured routing result/i,
    );
  });

  it("rejects malformed structured output", async () => {
    const client: IntentResponsesParseClient = {
      responses: {
        parse: async () => ({
          output_parsed: {
            intent: "unsupported_intent",
            contextAction: "continue",
            orderId: 10421,
            email: null,
            returnReason: null,
          },
        }),
      },
    };
    const router = new OpenAIIntentRouter(
      "unused-test-key",
      "test-model",
      client,
    );

    await expect(router.route(ROUTER_INPUT)).rejects.toBeInstanceOf(ZodError);
  });

  it("propagates provider errors to the orchestrator boundary", async () => {
    const providerError = new Error("simulated provider outage");
    const client: IntentResponsesParseClient = {
      responses: {
        parse: async () => {
          throw providerError;
        },
      },
    };
    const router = new OpenAIIntentRouter(
      "unused-test-key",
      "test-model",
      client,
    );

    await expect(router.route(ROUTER_INPUT)).rejects.toBe(providerError);
  });

  // Model-extracted write inputs remain untrusted until exact customer text supports them.
  it("drops identity slots that were not literally supplied by the customer", async () => {
    const client: IntentResponsesParseClient = {
      responses: {
        parse: async () => ({
          output_parsed: {
            intent: "return_request",
            contextAction: "continue",
            orderId: "BK-10422",
            email: "maya.chen@example.com",
            returnReason: "did not fit",
          },
        }),
      },
    };
    const router = new OpenAIIntentRouter(
      "unused-test-key",
      "test-model",
      client,
    );

    await expect(
      router.route({
        message: "Please help me.",
        currentIntent: "unknown",
        phase: "collecting",
      }),
    ).resolves.toEqual({
      intent: "return_request",
      contextAction: "continue",
      slots: {},
    });
  });

  it("drops a return reason that was not copied from the customer message", async () => {
    const client: IntentResponsesParseClient = {
      responses: {
        parse: async () => ({
          output_parsed: {
            intent: "return_request",
            contextAction: "continue",
            orderId: "BK-10422",
            email: "maya.chen@example.com",
            returnReason: "arrived damaged",
          },
        }),
      },
    };
    const router = new OpenAIIntentRouter(
      "unused-test-key",
      "test-model",
      client,
    );

    await expect(
      router.route({
        message:
          "Please return BK-10422. My email is maya.chen@example.com.",
        currentIntent: "unknown",
        phase: "collecting",
      }),
    ).resolves.toEqual({
      intent: "return_request",
      contextAction: "continue",
      slots: {
        orderId: "BK-10422",
        email: "maya.chen@example.com",
      },
    });
  });

  it("drops ambiguous identity slots when multiple values are present", async () => {
    const client: IntentResponsesParseClient = {
      responses: {
        parse: async () => ({
          output_parsed: {
            intent: "return_request",
            contextAction: "continue",
            orderId: "BK-10423",
            email: "jon.bell@example.com",
            returnReason: null,
          },
        }),
      },
    };
    const router = new OpenAIIntentRouter(
      "unused-test-key",
      "test-model",
      client,
    );

    await expect(
      router.route({
        message:
          "Change BK-10422 to BK-10423 and maya.chen@example.com to jon.bell@example.com.",
        currentIntent: "return_request",
        phase: "awaiting_confirmation",
      }),
    ).resolves.toEqual({
      intent: "return_request",
      contextAction: "continue",
      slots: {},
    });
  });
});
