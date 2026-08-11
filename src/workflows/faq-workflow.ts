import type { TraceEvent } from "../domain/agent.js";
import type { KnowledgePassage } from "../knowledge/bookly-knowledge.js";
import type {
  KnowledgeAnswer,
  KnowledgeAnswerer,
} from "../knowledge/knowledge-answerer.js";
import {
  KNOWLEDGE_CONFIDENCE_THRESHOLD,
  retrieveKnowledge,
} from "../knowledge/retrieve-knowledge.js";
import { addTrace } from "./workflow-types.js";

export interface FaqWorkflowInput {
  question: string;
  answerer: KnowledgeAnswerer;
  trace: TraceEvent[];
  knowledge?: readonly KnowledgePassage[];
  confidenceThreshold?: number;
}

export type FaqWorkflowResult =
  | {
      outcome: "answered";
      answer: string;
      citedPassageIds: string[];
    }
  | {
      outcome: "handoff";
      reason: "out_of_knowledge" | "grounding_failed";
    };

/**
 * Retrieval and answer generation are separate on purpose. The answerer may
 * rephrase retrieved facts, but this workflow owns the final citation boundary.
 */
export async function runFaqWorkflow(
  input: FaqWorkflowInput,
): Promise<FaqWorkflowResult> {
  const threshold =
    input.confidenceThreshold ?? KNOWLEDGE_CONFIDENCE_THRESHOLD;
  const passages = retrieveKnowledge(input.question, {
    ...(input.knowledge ? { knowledge: input.knowledge } : {}),
    confidenceThreshold: threshold,
  });

  if (passages.length === 0) {
    addTrace(input.trace, {
      category: "tool",
      name: "KnowledgeRetrieval",
      status: "blocked",
      detail: `No knowledge passage met the ${threshold} confidence threshold.`,
    });
    addTrace(input.trace, {
      category: "guardrail",
      name: "GroundedAnswer",
      status: "blocked",
      detail: "No answer was generated without retrieved evidence.",
    });
    return { outcome: "handoff", reason: "out_of_knowledge" };
  }

  addTrace(input.trace, {
    category: "tool",
    name: "KnowledgeRetrieval",
    status: "succeeded",
    detail: `Retrieved ${passages.length} passage(s) at or above the ${threshold} confidence threshold.`,
  });

  let proposedAnswer: KnowledgeAnswer;
  try {
    proposedAnswer = await input.answerer.answer({
      question: input.question,
      passages,
    });
  } catch {
    addTrace(input.trace, {
      category: "guardrail",
      name: "GroundedAnswer",
      status: "failed",
      detail: "The answerer failed without exposing internal error details.",
    });
    return { outcome: "handoff", reason: "grounding_failed" };
  }

  const grounded = validateGrounding(proposedAnswer, passages);
  if (!grounded) {
    addTrace(input.trace, {
      category: "guardrail",
      name: "GroundedAnswer",
      status: "blocked",
      detail:
        "Rejected an answer without non-empty citations drawn only from retrieved passages.",
    });
    return { outcome: "handoff", reason: "grounding_failed" };
  }

  addTrace(input.trace, {
    category: "guardrail",
    name: "GroundedAnswer",
    status: "succeeded",
    detail:
      "Accepted an answer whose citations all reference retrieved passages.",
  });
  return {
    outcome: "answered",
    answer: grounded.answer,
    citedPassageIds: grounded.citedPassageIds,
  };
}

function validateGrounding(
  proposedAnswer: KnowledgeAnswer,
  passages: readonly KnowledgePassage[],
): { answer: string; citedPassageIds: string[] } | undefined {
  if (typeof proposedAnswer.answer !== "string") return undefined;
  if (!Array.isArray(proposedAnswer.citedPassageIds)) return undefined;

  const answer = proposedAnswer.answer.trim();
  const citedPassageIds = proposedAnswer.citedPassageIds.map((id) => id.trim());
  const retrievedIds = new Set(passages.map((passage) => passage.id));

  if (
    !answer ||
    citedPassageIds.length === 0 ||
    !citedPassageIds.every(
      (id) => id.length > 0 && retrievedIds.has(id),
    )
  ) {
    return undefined;
  }

  return {
    answer,
    citedPassageIds: [...new Set(citedPassageIds)],
  };
}
