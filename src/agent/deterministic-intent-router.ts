import type { SupportIntent, SupportSlots } from "../domain/agent.js";
import {
  IntentRouterInputSchema,
  IntentRouterResultSchema,
  type IntentRouter,
  type IntentRouterInput,
  type IntentRouterResult,
} from "./intent-router.js";
import {
  isExistingReturnFallbackMessage,
  isPositiveReturnAcknowledgementFallback,
} from "./handoff-policy.js";
import {
  extractEmailAddresses,
  extractOrderIds,
} from "./slot-normalization.js";

const RETURN_PATTERN = /\b(return|refund|send\s+(?:it\s+)?back)\b/i;
const STATUS_PATTERN =
  /\b(order status|track|tracking|where(?:'s| is)|on the way|arrive|delivery update|shipped)\b/i;
const MISSING_DELIVERY_PATTERN =
  /\b(?:package|order)\b.{0,30}\b(?:hasn'?t|has not|didn'?t|did not|never)\b.{0,20}\b(?:shown? up|arriv(?:e|ed))\b/i;
const DAMAGED_DELIVERY_PATTERN =
  /\b(?:book|item|package)\b.{0,30}\b(?:came|arrived|was delivered)\b.{0,20}\b(?:broken|damaged)\b/i;
const FAQ_PATTERN =
  /\b(?:shipping (?:time|times|policy)|how long (?:does )?(?:shipping|delivery)|(?:return|refund) policy|(?:reset|forgot(?:ten)?) (?:my )?password|password reset)\b/i;
const GENERAL_QUESTION_PATTERN =
  /^(?:what|how|do|does|can|could|is|are|will|when|why)\b|\?\s*$/i;
const HUMAN_HANDOFF_PATTERN =
  /\b(?:human|live agent|representative|support specialist|escalat(?:e|ion))\b/i;
const FRESH_ORDER_CONTEXT_PATTERN =
  /\b(?:another|other|different|a\s+different|my\s+other)\s+order\b/i;
const REUSE_VERIFIED_ORDER_PATTERN =
  /\b(?:return|refund|send\s+back)\s+(?:it|that)\b/i;

export class DeterministicIntentRouter implements IntentRouter {
  // This small adapter makes the repo runnable without credentials and keeps
  // tests deterministic. It follows the same contract as the OpenAI adapter;
  // swapping routers does not change workflow or tool behavior.
  async route(input: IntentRouterInput): Promise<IntentRouterResult> {
    const parsed = IntentRouterInputSchema.parse(input);
    const explicitIntent = detectIntent(parsed.message);
    const intent = chooseIntent(
      explicitIntent,
      parsed.currentIntent,
      parsed.phase,
    );

    return IntentRouterResultSchema.parse({
      intent,
      slots: extractSlots(parsed.message, intent),
      contextAction: chooseContextAction(parsed, intent),
    });
  }
}

function detectIntent(message: string): SupportIntent {
  if (HUMAN_HANDOFF_PATTERN.test(message)) {
    return "handoff";
  }
  if (isPositiveReturnAcknowledgementFallback(message)) {
    return "post_return_acknowledgement";
  }
  if (isExistingReturnFallbackMessage(message)) {
    return "existing_return_status";
  }
  // Informational policy questions are read-only FAQ requests, not attempts to
  // start the similarly worded return workflow.
  if (FAQ_PATTERN.test(message)) {
    return "faq";
  }
  if (DAMAGED_DELIVERY_PATTERN.test(message)) {
    return "return_request";
  }
  if (RETURN_PATTERN.test(message)) {
    return "return_request";
  }
  if (
    MISSING_DELIVERY_PATTERN.test(message) ||
    STATUS_PATTERN.test(message)
  ) {
    return "order_status";
  }
  // In offline mode, a remaining question is allowed to reach retrieval. The
  // FAQ workflow still answers only when approved knowledge clears its fixed
  // confidence threshold; otherwise it hands off instead of guessing.
  if (GENERAL_QUESTION_PATTERN.test(message.trim())) {
    return "faq";
  }
  return "unknown";
}

function chooseIntent(
  explicitIntent: SupportIntent,
  currentIntent: SupportIntent,
  phase: IntentRouterInput["phase"],
): SupportIntent {
  if (explicitIntent !== "unknown") {
    return explicitIntent;
  }

  // Keep a workflow for slot answers and confirmations, but do not let a
  // completed request turn every later message into a repeat of the old answer.
  return phase === "completed" ? "unknown" : currentIntent;
}

function chooseContextAction(
  input: IntentRouterInput,
  intent: SupportIntent,
): IntentRouterResult["contextAction"] {
  if (FRESH_ORDER_CONTEXT_PATTERN.test(input.message)) {
    return "start_fresh";
  }

  if (
    intent === "return_request" &&
    input.currentIntent === "order_status" &&
    input.phase === "completed" &&
    REUSE_VERIFIED_ORDER_PATTERN.test(input.message)
  ) {
    return "reuse_verified_order";
  }

  return "continue";
}

function extractSlots(message: string, intent: SupportIntent): SupportSlots {
  const slots: SupportSlots = {};
  const orderId = extractOrderId(message);
  const email = extractEmail(message);
  const returnReason = extractReturnReason(message, intent);

  if (orderId) slots.orderId = orderId;
  if (email) slots.email = email;
  if (returnReason) slots.returnReason = returnReason;
  return slots;
}

function extractOrderId(message: string): string | undefined {
  const orderIds = extractOrderIds(message);
  return orderIds.length === 1 ? orderIds[0] : undefined;
}

function extractEmail(message: string): string | undefined {
  const emails = extractEmailAddresses(message);
  return emails.length === 1 ? emails[0] : undefined;
}

function extractReturnReason(
  message: string,
  intent: SupportIntent,
): string | undefined {
  if (intent !== "return_request") {
    return undefined;
  }

  if (DAMAGED_DELIVERY_PATTERN.test(message)) {
    const damagedSpan = message.match(DAMAGED_DELIVERY_PATTERN)?.[0];
    return damagedSpan ? cleanReason(damagedSpan) : undefined;
  }

  const changedReason = message.match(
    /(?:change|update|correct|replace)\s+(?:the\s+)?(?:return\s+)?reason\s+(?:to|as)\s+(.{3,300})$/i,
  )?.[1];
  if (changedReason) {
    return cleanReason(changedReason);
  }

  const afterMarker = message.match(
    /(?:because|reason(?:\s+is)?\s*:)\s*(.{3,300})$/i,
  )?.[1];
  if (afterMarker) {
    return cleanReason(afterMarker);
  }

  if (
    /\b(damaged|wrong (?:book|item)|did not fit|didn't fit|not as described|changed my mind|duplicate)\b/i.test(
      message,
    )
  ) {
    const reasonSentence = message
      .split(/[.!?]+/)
      .map((part) => part.trim())
      .find((part) =>
        /\b(damaged|wrong|fit|described|changed my mind|duplicate)\b/i.test(
          part,
        ),
      );
    return reasonSentence ? cleanReason(reasonSentence) : undefined;
  }

  return undefined;
}

function cleanReason(value: string): string {
  // A common one-line request puts contact details after the reason. Keep only
  // the first sentence so an email is not duplicated into pending action data.
  const [firstSentence = value] = value.split(/[.!?](?=\s|$)/, 1);
  return firstSentence.trim().replace(/[.!?]+$/, "").slice(0, 300);
}
