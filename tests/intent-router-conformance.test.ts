// Responsibility: Hold deterministic and OpenAI routers to the same intent and slot contract.
// Boundary: Provider output is stubbed; workflow execution, session mutation, and tool calls stay out of scope.

import { describe, expect, it } from "vitest";
import { DeterministicIntentRouter } from "../src/agent/deterministic-intent-router.js";
import type {
  ContextAction,
  IntentRouter,
  IntentRouterInput,
} from "../src/agent/intent-router.js";
import type { SupportIntent } from "../src/domain/agent.js";
import {
  OpenAIIntentRouter,
  type IntentResponsesParseClient,
} from "../src/providers/openai-intent-router.js";

interface ConformanceCase {
  name: string;
  message: string;
  currentIntent?: SupportIntent;
  phase?: IntentRouterInput["phase"];
  modelRoute: {
    intent: SupportIntent;
    contextAction: ContextAction;
    orderId: string | null;
    email: string | null;
    returnReason: string | null;
  };
  expected: {
    intent: SupportIntent;
    contextAction: ContextAction;
    slots: Record<string, string>;
  };
}

const CASES: ConformanceCase[] = [
  {
    name: "normalizes an order ID without a hyphen",
    message: "where is BK10421",
    modelRoute: {
      intent: "order_status",
      contextAction: "continue",
      orderId: "BK10421",
      email: null,
      returnReason: null,
    },
    expected: {
      intent: "order_status",
      contextAction: "continue",
      slots: { orderId: "BK-10421" },
    },
  },
  {
    name: "recognizes a missing package",
    message: "hey my package hasnt shown up",
    modelRoute: {
      intent: "order_status",
      contextAction: "continue",
      orderId: null,
      email: null,
      returnReason: null,
    },
    expected: { intent: "order_status", contextAction: "continue", slots: {} },
  },
  {
    name: "recognizes a damaged delivered book",
    message: "my book came broken, what are my options?",
    modelRoute: {
      intent: "return_request",
      contextAction: "continue",
      orderId: null,
      email: null,
      returnReason: "book came broken",
    },
    expected: {
      intent: "return_request",
      contextAction: "continue",
      slots: { returnReason: "book came broken" },
    },
  },
  {
    name: "routes shipping knowledge",
    message: "How long does shipping to Canada take?",
    modelRoute: {
      intent: "faq",
      contextAction: "continue",
      orderId: null,
      email: null,
      returnReason: null,
    },
    expected: { intent: "faq", contextAction: "continue", slots: {} },
  },
  {
    name: "routes return policy knowledge",
    message: "What is Bookly's return policy?",
    modelRoute: {
      intent: "faq",
      contextAction: "continue",
      orderId: null,
      email: null,
      returnReason: null,
    },
    expected: { intent: "faq", contextAction: "continue", slots: {} },
  },
  {
    name: "routes password reset knowledge",
    message: "How do I reset my password?",
    modelRoute: {
      intent: "faq",
      contextAction: "continue",
      orderId: null,
      email: null,
      returnReason: null,
    },
    expected: { intent: "faq", contextAction: "continue", slots: {} },
  },
  {
    name: "routes an existing return problem",
    message: "I didn't get the label yet.",
    currentIntent: "return_request",
    phase: "completed",
    modelRoute: {
      intent: "existing_return_status",
      contextAction: "continue",
      orderId: null,
      email: null,
      returnReason: null,
    },
    expected: {
      intent: "existing_return_status",
      contextAction: "continue",
      slots: {},
    },
  },
  {
    name: "routes a positive return acknowledgement",
    message: "The label arrived.",
    currentIntent: "return_request",
    phase: "completed",
    modelRoute: {
      intent: "post_return_acknowledgement",
      contextAction: "continue",
      orderId: null,
      email: null,
      returnReason: null,
    },
    expected: {
      intent: "post_return_acknowledgement",
      contextAction: "continue",
      slots: {},
    },
  },
  {
    name: "reuses a verified order for a contextual return",
    message: "I want to return it.",
    currentIntent: "order_status",
    phase: "completed",
    modelRoute: {
      intent: "return_request",
      contextAction: "reuse_verified_order",
      orderId: null,
      email: null,
      returnReason: null,
    },
    expected: {
      intent: "return_request",
      contextAction: "reuse_verified_order",
      slots: {},
    },
  },
  {
    name: "starts fresh for another order",
    message: "Track another order.",
    currentIntent: "order_status",
    phase: "completed",
    modelRoute: {
      intent: "order_status",
      contextAction: "start_fresh",
      orderId: null,
      email: null,
      returnReason: null,
    },
    expected: {
      intent: "order_status",
      contextAction: "start_fresh",
      slots: {},
    },
  },
];

function openAIRouterFor(modelRoute: ConformanceCase["modelRoute"]): IntentRouter {
  const client: IntentResponsesParseClient = {
    responses: {
      parse: async () => ({ output_parsed: modelRoute }),
    },
  };
  return new OpenAIIntentRouter("unused-test-key", "test-model", client);
}

describe("intent-router conformance", () => {
  // The extraction mechanism may differ, but changing modes must not change the routing contract.
  for (const testCase of CASES) {
    it.each([
      ["deterministic", () => new DeterministicIntentRouter()],
      ["OpenAI adapter", () => openAIRouterFor(testCase.modelRoute)],
    ] as const)(`${testCase.name} in %s mode`, async (_name, createRouter) => {
      const result = await createRouter().route({
        message: testCase.message,
        currentIntent: testCase.currentIntent ?? "unknown",
        phase: testCase.phase ?? "collecting",
      });

      expect(result).toEqual(testCase.expected);
    });
  }
});
