import { describe, expect, it, vi } from "vitest";
import type { TraceEvent } from "../src/domain/agent.js";
import { BOOKLY_KNOWLEDGE } from "../src/knowledge/bookly-knowledge.js";
import {
  DeterministicKnowledgeAnswerer,
  type KnowledgeAnswerer,
} from "../src/knowledge/knowledge-answerer.js";
import { runFaqWorkflow } from "../src/workflows/faq-workflow.js";

describe("FAQ workflow", () => {
  it.each([
    ["Do you ship to Canada?", "shipping-and-canada", /Canada/i],
    ["What is Bookly's return policy?", "return-policy", /30 days/i],
    ["How do I reset my password?", "password-reset", /Forgot password/i],
  ])(
    "answers a grounded FAQ: %s",
    async (question, expectedPassageId, expectedAnswer) => {
      const trace: TraceEvent[] = [];
      const result = await runFaqWorkflow({
        question,
        answerer: new DeterministicKnowledgeAnswerer(),
        trace,
      });

      expect(result).toMatchObject({
        outcome: "answered",
        citedPassageIds: [expectedPassageId],
      });
      if (result.outcome === "answered") {
        expect(result.answer).toMatch(expectedAnswer);
      }
      expect(trace).toContainEqual(
        expect.objectContaining({
          name: "KnowledgeRetrieval",
          status: "succeeded",
        }),
      );
      expect(trace).toContainEqual(
        expect.objectContaining({
          name: "GroundedAnswer",
          status: "succeeded",
        }),
      );
    },
  );

  it("passes only matching passages to the answerer", async () => {
    const answer = vi.fn<KnowledgeAnswerer["answer"]>(async (input) => ({
      answer: input.passages[0]?.content ?? "",
      citedPassageIds: input.passages.map((passage) => passage.id),
    }));

    const result = await runFaqWorkflow({
      question: "Can Bookly deliver to Canada?",
      answerer: { answer },
      trace: [],
    });

    expect(result.outcome).toBe("answered");
    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer.mock.calls[0]?.[0].passages.map((passage) => passage.id)).toEqual([
      "shipping-and-canada",
    ]);
  });

  it("signals handoff without calling the answerer for an out-of-KB question", async () => {
    const answer = vi.fn<KnowledgeAnswerer["answer"]>();
    const trace: TraceEvent[] = [];

    const result = await runFaqWorkflow({
      question: "Which fantasy novel should I read next?",
      answerer: { answer },
      trace,
    });

    expect(result).toEqual({
      outcome: "handoff",
      reason: "out_of_knowledge",
    });
    expect(answer).not.toHaveBeenCalled();
    expect(trace).toEqual([
      expect.objectContaining({
        name: "KnowledgeRetrieval",
        status: "blocked",
      }),
      expect.objectContaining({
        name: "GroundedAnswer",
        status: "blocked",
      }),
    ]);
  });

  it.each([
    "Do you offer membership in Canada?",
    "What does citizenship in Canada mean?",
    "Do you have a rewards membership with delivery perks?",
  ])("does not confuse a word ending in ship with shipping: %s", async (question) => {
    const answer = vi.fn<KnowledgeAnswerer["answer"]>();

    const result = await runFaqWorkflow({
      question,
      answerer: { answer },
      trace: [],
    });

    expect(result).toEqual({
      outcome: "handoff",
      reason: "out_of_knowledge",
    });
    expect(answer).not.toHaveBeenCalled();
  });

  it("never returns unrelated passages, even with a zero threshold", async () => {
    const answer = vi.fn<KnowledgeAnswerer["answer"]>();

    const result = await runFaqWorkflow({
      question: "Which fantasy novel should I read next?",
      answerer: { answer },
      trace: [],
      confidenceThreshold: 0,
    });

    expect(result).toEqual({
      outcome: "handoff",
      reason: "out_of_knowledge",
    });
    expect(answer).not.toHaveBeenCalled();
  });

  it.each([
    ["no citations", []],
    ["an unknown citation", ["not-retrieved"]],
  ])("signals handoff for %s", async (_label, citedPassageIds) => {
    const trace: TraceEvent[] = [];
    const result = await runFaqWorkflow({
      question: "Do you ship to Canada?",
      answerer: {
        answer: async () => ({
          answer: "An unsupported answer.",
          citedPassageIds,
        }),
      },
      trace,
    });

    expect(result).toEqual({
      outcome: "handoff",
      reason: "grounding_failed",
    });
    expect(trace).toContainEqual(
      expect.objectContaining({
        name: "GroundedAnswer",
        status: "blocked",
      }),
    );
  });

  it("signals handoff when the answerer fails", async () => {
    const trace: TraceEvent[] = [];
    const result = await runFaqWorkflow({
      question: "What is the return policy?",
      answerer: {
        answer: async () => {
          throw new Error("provider details");
        },
      },
      trace,
      knowledge: BOOKLY_KNOWLEDGE,
    });

    expect(result).toEqual({
      outcome: "handoff",
      reason: "grounding_failed",
    });
    expect(trace).toContainEqual(
      expect.objectContaining({
        name: "GroundedAnswer",
        status: "failed",
        detail: expect.not.stringMatching(/provider details/i),
      }),
    );
  });
});
