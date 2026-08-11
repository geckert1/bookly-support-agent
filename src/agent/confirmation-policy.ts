import type { SessionPhase } from "../domain/agent.js";

const APPROVE_PHRASES = new Set([
  "yes",
  "yes please",
  "yes do it",
  "yep",
  "sure",
  "sure go ahead",
  "confirm",
  "confirmed",
  "go ahead",
  "ok please create it",
  "okay please create it",
  "please do",
  "do it",
  "create it",
  "create the return",
  "yes create it",
  "yes create the return",
]);

const DECLINE_PHRASES = new Set([
  "no",
  "no thanks",
  "cancel",
  "stop",
  "never mind",
  "nevermind",
  "do not",
  "don't",
]);

/**
 * A return is a state-changing action, so the LLM is not allowed to approve it.
 * We accept only a small set of complete, unambiguous replies and only while a
 * return is waiting for confirmation. Anything else asks the customer again.
 */
export function parseExplicitConfirmation(
  message: string,
  phase: SessionPhase,
): boolean | undefined {
  if (phase !== "awaiting_confirmation") return undefined;

  return parseConfirmationPhrase(message);
}

/**
 * Recognize a bare confirmation independently from workflow state. The
 * orchestrator uses this only to explain that an already-completed action is
 * not pending; it never turns a stale "yes" into a new write.
 */
export function parseConfirmationPhrase(
  message: string,
): boolean | undefined {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[^a-z'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (APPROVE_PHRASES.has(normalized)) return true;
  if (DECLINE_PHRASES.has(normalized)) return false;
  return undefined;
}
