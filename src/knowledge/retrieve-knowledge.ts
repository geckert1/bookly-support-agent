import {
  BOOKLY_KNOWLEDGE,
  type KnowledgePassage,
} from "./bookly-knowledge.js";

export const KNOWLEDGE_CONFIDENCE_THRESHOLD = 1;

const KEYWORD_MATCHES_FOR_FULL_CONFIDENCE = 2;

export interface KnowledgeRetrievalOptions {
  knowledge?: readonly KnowledgePassage[];
  confidenceThreshold?: number;
}

/**
 * Small deterministic retrieval keeps the grounding boundary explainable.
 * Two matching curated concepts reach the default threshold. Requiring two
 * signals prevents a generic word such as "return" from grounding an unrelated
 * question. Only passages at or above the explicit threshold are returned.
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
      const matchedKeywords = passage.keywords.filter((keyword) =>
        matchesKeyword(questionTokens, questionTokenSet, keyword),
      );
      const confidence = Math.min(
        1,
        matchedKeywords.length / KEYWORD_MATCHES_FOR_FULL_CONFIDENCE,
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
  questionTokens: readonly string[],
  questionTokenSet: ReadonlySet<string>,
  keyword: string,
): boolean {
  const keywordTokens = tokenize(keyword);
  if (keywordTokens.length === 0) return false;
  if (keywordTokens.length === 1) {
    return questionTokenSet.has(keywordTokens[0] as string);
  }

  return keywordTokens.every((token) => questionTokenSet.has(token));
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function assertConfidenceThreshold(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("confidenceThreshold must be between 0 and 1.");
  }
}
