/**
 * Responsibility: Selects approved FAQ passages with deterministic concept matching.
 * Boundary: Retrieval can expose evidence but cannot compose or approve an answer.
 */
import {
  BOOKLY_KNOWLEDGE,
  type KnowledgePassage,
} from "./bookly-knowledge.js";

export const KNOWLEDGE_CONFIDENCE_THRESHOLD = 1;

const KEYWORD_MATCHES_FOR_FULL_CONFIDENCE = 2;

const TOKEN_ALIASES: Readonly<Record<string, string>> = {
  costs: "cost",
  delivered: "deliver",
  deliveries: "deliver",
  delivery: "deliver",
  delivers: "deliver",
  fees: "cost",
  long: "time",
  much: "cost",
  fee: "cost",
  price: "cost",
  prices: "cost",
  pricing: "cost",
  rate: "cost",
  rates: "cost",
  returned: "return",
  returning: "return",
  returns: "return",
  shipped: "ship",
  shipment: "ship",
  shipments: "ship",
  shipping: "ship",
  times: "time",
  windows: "window",
};

export interface KnowledgeRetrievalOptions {
  knowledge?: readonly KnowledgePassage[];
  confidenceThreshold?: number;
}

/**
 * Small deterministic retrieval keeps the grounding boundary explainable.
 * Two distinct curated concepts reach the default threshold. Small aliases let
 * natural wording such as "how long" match the approved "shipping time"
 * concept, while deduplication prevents synonyms such as ship/shipping from
 * counting twice. Requiring two signals keeps a lone location or delivery word
 * from grounding an unrelated membership question.
 */
export function retrieveKnowledge(
  question: string,
  options: KnowledgeRetrievalOptions = {},
): readonly KnowledgePassage[] {
  const knowledge = options.knowledge ?? BOOKLY_KNOWLEDGE;
  const threshold =
    options.confidenceThreshold ?? KNOWLEDGE_CONFIDENCE_THRESHOLD;
  assertConfidenceThreshold(threshold);

  const questionTokens = tokenize(question);
  if (questionTokens.length === 0) return [];

  const questionTokenSet = new Set(questionTokens);

  return knowledge
    .map((passage, index) => {
      const keywordConcepts = new Set(
        passage.keywords.map(keywordSignature).filter(Boolean),
      );
      const matchedConcepts = [...keywordConcepts].filter((keyword) =>
        matchesKeyword(questionTokenSet, keyword),
      );
      const confidence = Math.min(
        1,
        matchedConcepts.length / KEYWORD_MATCHES_FOR_FULL_CONFIDENCE,
      );
      return { passage, confidence, index };
    })
    // A threshold of zero is valid for experimentation, but it must not turn
    // retrieval into "return the whole knowledge base."
    .filter(({ confidence }) => confidence > 0 && confidence >= threshold)
    .sort(
      (left, right) =>
        right.confidence - left.confidence || left.index - right.index,
    )
    .map(({ passage }) => passage);
}

function matchesKeyword(
  questionTokenSet: ReadonlySet<string>,
  keywordSignature: string,
): boolean {
  const keywordTokens = keywordSignature.split(" ");
  if (keywordTokens.length === 0) return false;
  if (keywordTokens.length === 1) {
    return questionTokenSet.has(keywordTokens[0] as string);
  }

  return keywordTokens.every((token) => questionTokenSet.has(token));
}

function keywordSignature(value: string): string {
  return [...new Set(tokenize(value))].sort().join(" ");
}

function tokenize(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(
    (token) => TOKEN_ALIASES[token] ?? token,
  );
}

function assertConfidenceThreshold(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("confidenceThreshold must be between 0 and 1.");
  }
}
