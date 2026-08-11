import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  ContextActionSchema,
  IntentRouterInputSchema,
  IntentRouterResultSchema,
  type IntentRouter,
  type IntentRouterInput,
  type IntentRouterResult,
} from "../agent/intent-router.js";
import {
  extractEmailAddresses,
  extractOrderIds,
  normalizeOrderId,
} from "../agent/slot-normalization.js";
import { SupportIntentSchema } from "../domain/agent.js";

const modelRouteSchema = z.object({
  intent: SupportIntentSchema,
  contextAction: ContextActionSchema,
  orderId: z.string().nullable(),
  email: z.string().nullable(),
  returnReason: z.string().nullable(),
});

const ROUTER_PROMPT = `You route messages for Bookly, an online bookstore support agent.

Return only the structured route. Your job is intentionally narrow:
- Classify the message as order_status, return_request, existing_return_status,
  post_return_acknowledgement, faq, handoff, or unknown.
- Use faq for read-only Bookly knowledge questions such as shipping times,
  return policy, password reset, or a general damaged-book policy. A question
  about policy is faq; a request to act on a specific purchase is operational.
- Use order_status for tracking, delivery timing, or a package reported missing
  or not delivered. A missing package is not a return_request.
- Use return_request when the customer wants to return or refund a specific
  purchase, including a damaged book; extract the supplied damage as its reason.
- Use existing_return_status for any operational question or problem involving
  an already-started return, refund, return label, or return QR code. "I didn't
  get the label yet" is existing_return_status, never a new return_request.
- Use post_return_acknowledgement when the customer reports that a return label
  arrived, downloaded, printed, or otherwise worked successfully.
- Use handoff only for an explicit human request or a request outside the
  supported workflows and approved FAQ knowledge.
- Set contextAction to start_fresh when the customer asks about another, other,
  or different order.
- Set contextAction to reuse_verified_order when currentIntent is order_status,
  phase is completed, and the customer asks to "return it" without restating the
  order. The application may reuse only its previously verified order context.
- Otherwise set contextAction to continue.
- Extract order IDs written as BK-10421, BK10421, or BK 10421. Return the text
  the customer supplied; the server canonicalizes accepted formats.
- Extract an email address only when the customer supplied one.
- Extract a short return reason only when the customer supplied one. Copy an
  exact contiguous span from the message; do not paraphrase or infer a reason.
- While phase is collecting or awaiting_confirmation, use currentIntent to interpret short follow-ups. Application memory preserves previously collected fields.
- When phase is completed, classify the new message on its own. Only use return_request for an explicit request to start a new return; do not restart a completed return for an operational follow-up.

Do not invent identifiers, customer facts, order status, eligibility, policy, or approval. Application code owns every factual, policy, and confirmation decision.`;

export interface IntentParseRequest {
  model: string;
  input: Array<{
    role: "system" | "user";
    content: string;
  }>;
  text: { format: unknown };
  store: false;
}

export interface IntentResponsesParseClient {
  responses: {
    parse(request: IntentParseRequest): Promise<{
      output_parsed: unknown;
    }>;
  };
}

export class OpenAIIntentRouter implements IntentRouter {
  private readonly client: IntentResponsesParseClient;

  constructor(
    apiKey: string,
    private readonly model: string,
    client?: IntentResponsesParseClient,
  ) {
    this.client = client ?? createResponsesParseClient(apiKey);
  }

  async route(rawInput: IntentRouterInput): Promise<IntentRouterResult> {
    const input = IntentRouterInputSchema.parse(rawInput);

    // This routing call keeps the model at a narrow interpretation boundary;
    // it never sees tools, previously stored slots, or write authorization. A
    // separate FAQ adapter may generate text only from retrieved passages.
    const response = await this.client.responses.parse({
      model: this.model,
      input: [
        { role: "system", content: ROUTER_PROMPT },
        { role: "user", content: JSON.stringify(input) },
      ],
      text: {
        format: zodTextFormat(modelRouteSchema, "bookly_intent_route"),
      },
      store: false,
    });

    if (!response.output_parsed) {
      throw new Error("OpenAI returned no structured routing result.");
    }

    // The injected client intentionally returns unknown. Validate again at the
    // application boundary instead of trusting either a provider or test double.
    const parsed = modelRouteSchema.parse(response.output_parsed);
    const suppliedOrderIds = extractOrderIds(input.message);
    const suppliedEmails = extractEmailAddresses(input.message);
    const modelOrderId = parsed.orderId
      ? normalizeOrderId(parsed.orderId)
      : undefined;
    const modelEmail = parsed.email?.trim().toLowerCase();

    // Identity keys must be literal customer input, not merely schema-valid
    // model output. Multiple distinct values are ambiguous and are dropped so
    // the workflow asks a clarifying question instead of guessing which wins.
    const orderId =
      suppliedOrderIds.length === 1 && modelOrderId === suppliedOrderIds[0]
        ? modelOrderId
        : undefined;
    const email =
      suppliedEmails.length === 1 && modelEmail === suppliedEmails[0]
        ? modelEmail
        : undefined;
    const proposedReturnReason = parsed.returnReason?.trim();
    const returnReason =
      proposedReturnReason &&
      isLiteralMessageSpan(proposedReturnReason, input.message)
        ? proposedReturnReason
        : undefined;

    const slots = {
      ...(orderId ? { orderId } : {}),
      ...(email ? { email } : {}),
      ...(returnReason ? { returnReason } : {}),
    };

    return IntentRouterResultSchema.parse({
      intent: parsed.intent,
      slots,
      contextAction: parsed.contextAction,
    });
  }
}

function isLiteralMessageSpan(value: string, message: string): boolean {
  const normalizedValue = normalizeForLiteralComparison(value);
  const normalizedMessage = normalizeForLiteralComparison(message);
  return (
    normalizedValue.length >= 3 &&
    ` ${normalizedMessage} `.includes(` ${normalizedValue} `)
  );
}

function normalizeForLiteralComparison(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function createResponsesParseClient(apiKey: string): IntentResponsesParseClient {
  const openai = new OpenAI({ apiKey });

  return {
    responses: {
      parse: async (request) => {
        const response = await openai.responses.parse(request as never);
        return { output_parsed: response.output_parsed };
      },
    },
  };
}
