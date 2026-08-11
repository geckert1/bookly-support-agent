// Responsibility: Interpret explicit approval or decline language for a staged return.
// Boundary: This parser reports intent only; the workflow retains the confirmed write gate.

import type { SessionPhase } from "../domain/agent.js";

const AFFIRMATIVE_WORDS = new Set([
  "absolutely",
  "confirm",
  "confirmed",
  "ok",
  "okay",
  "sure",
  "yeah",
  "yep",
  "yes",
]);

const DIRECT_DECLINE_WORDS = new Set(["cancel", "nevermind", "no", "stop"]);

const NEGATED_ACTION_WORDS = new Set([
  "continue",
  "create",
  "do",
  "go",
  "proceed",
]);

const AMBIGUITY_OR_CHANGE_WORDS = new Set([
  "after",
  "although",
  "before",
  "but",
  "change",
  "except",
  "however",
  "if",
  "instead",
  "maybe",
  "perhaps",
  "though",
  "unless",
  "update",
  "wait",
]);

// Every word in an approval must belong to this deliberately small grammar.
// This lets us understand natural combinations without letting a leading
// "yes" hide a second request that should be handled before the write.
const CONFIRMATION_VOCABULARY = new Set([
  ...AFFIRMATIVE_WORDS,
  "ahead",
  "and",
  "create",
  "do",
  "for",
  "go",
  "good",
  "it",
  "please",
  "return",
  "sounds",
  "the",
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
  const words = message
    .trim()
    .toLowerCase()
    .replace(/[^a-z'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  if (words.length === 0) return undefined;

  // Conditional language and changed inputs are never approval. Returning
  // undefined leaves the orchestrator free to update the relevant slot and
  // ask for a fresh confirmation instead of mutating with stale details.
  if (words.some((word) => AMBIGUITY_OR_CHANGE_WORDS.has(word))) {
    return undefined;
  }

  const hasAffirmativeWord = words.some((word) =>
    AFFIRMATIVE_WORDS.has(word),
  );
  const hasNegativeIntent = isDirectDecline(words) || isNegatedAction(words);

  // Mixed signals are ambiguous. Declines require direct language or a
  // negated action, so ordinary return reasons such as "it did not fit" do
  // not accidentally cancel the workflow.
  if (hasNegativeIntent) {
    return hasAffirmativeWord ? undefined : false;
  }

  const hasActionDirective =
    includesWords(words, ["go", "ahead"]) ||
    includesWords(words, ["go", "for", "it"]) ||
    includesWords(words, ["do", "it"]) ||
    includesWords(words, ["create", "it"]) ||
    (words.includes("create") && words.includes("return")) ||
    includesWords(words, ["please", "do"]);
  const hasAffirmativeExpression =
    hasAffirmativeWord || includesWords(words, ["sounds", "good"]);

  if (!hasAffirmativeExpression && !hasActionDirective) return undefined;

  // Unknown words mean the reply contains more than a confirmation. That is
  // intentionally conservative because createReturn is irreversible in this
  // prototype once called with confirmed: true.
  if (words.some((word) => !CONFIRMATION_VOCABULARY.has(word))) {
    return undefined;
  }

  return true;
}

function includesWords(words: string[], phrase: string[]): boolean {
  return words.some((_, start) =>
    phrase.every((word, offset) => words[start + offset] === word),
  );
}

function isDirectDecline(words: string[]): boolean {
  const meaningfulWords = words.filter(
    (word) => !["please", "thank", "thanks", "you"].includes(word),
  );

  return (
    (meaningfulWords.length === 1 &&
      DIRECT_DECLINE_WORDS.has(meaningfulWords[0] ?? "")) ||
    (meaningfulWords.length === 2 &&
      meaningfulWords[0] === "never" &&
      meaningfulWords[1] === "mind") ||
    (meaningfulWords.length === 2 &&
      meaningfulWords[0] === "not" &&
      ["now", "yet"].includes(meaningfulWords[1] ?? ""))
  );
}

function isNegatedAction(words: string[]): boolean {
  const doNotIndex = words.findIndex(
    (word, index) => word === "do" && words[index + 1] === "not",
  );
  const contractionIndex = words.indexOf("don't");
  const negationEnd =
    doNotIndex >= 0
      ? doNotIndex + 2
      : contractionIndex >= 0
        ? contractionIndex + 1
        : -1;

  if (negationEnd < 0) return false;

  const wordsAfterNegation = words.slice(negationEnd);
  return (
    wordsAfterNegation.length === 0 ||
    wordsAfterNegation.some((word) => NEGATED_ACTION_WORDS.has(word))
  );
}
