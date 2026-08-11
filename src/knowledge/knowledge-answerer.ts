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
    const uniquePassages = [
      ...new Map(input.passages.map((passage) => [passage.id, passage])).values(),
    ];

    return {
      answer: uniquePassages.map((passage) => passage.content).join(" "),
      citedPassageIds: uniquePassages.map((passage) => passage.id),
    };
  }
}
