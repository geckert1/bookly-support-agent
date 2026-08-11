/**
 * Responsibility: Defines the FAQ answerer contract and its offline implementation.
 * Boundary: Answerers receive selected passages but do not decide whether an answer is grounded.
 */
import type { KnowledgePassage } from "./bookly-knowledge.js";

export interface KnowledgeAnswerInput {
  question: string;
  passages: readonly KnowledgePassage[];
}

export interface KnowledgeAnswer {
  answer: string;
  citedPassageIds: string[];
}

export interface KnowledgeAnswerer {
  answer(input: KnowledgeAnswerInput): Promise<KnowledgeAnswer>;
}

/**
 * Offline mode quotes the curated facts directly. It is intentionally plain:
 * the same workflow and grounding guard can be exercised without credentials.
 */
export class DeterministicKnowledgeAnswerer implements KnowledgeAnswerer {
  async answer(input: KnowledgeAnswerInput): Promise<KnowledgeAnswer> {
    // Deduplication keeps an accidental repeated retrieval from producing a
    // repeated answer or making one source appear to be multiple sources.
    const uniquePassages = [
      ...new Map(input.passages.map((passage) => [passage.id, passage])).values(),
    ];

    return {
      answer: uniquePassages.map((passage) => passage.content).join(" "),
      citedPassageIds: uniquePassages.map((passage) => passage.id),
    };
  }
}
