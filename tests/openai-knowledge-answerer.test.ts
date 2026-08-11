import { describe, expect, it, vi } from "vitest";
import { BOOKLY_KNOWLEDGE } from "../src/knowledge/bookly-knowledge.js";
import {
  OpenAIKnowledgeAnswerer,
  type KnowledgeParseRequest,
  type ResponsesParseClient,
} from "../src/providers/openai-knowledge-answerer.js";

describe("OpenAIKnowledgeAnswerer", () => {
  it("calls Responses API parsing with only retrieved passages and store disabled", async () => {
    let capturedRequest: KnowledgeParseRequest | undefined;
    const parse = vi.fn(async (request: KnowledgeParseRequest) => {
      capturedRequest = request;
      return {
        output_parsed: {
          answer: "Yes. Bookly ships to Canada.",
          citedPassageIds: ["shipping-and-canada"],
        },
      };
    });
    const client: ResponsesParseClient = { responses: { parse } };
    const answerer = new OpenAIKnowledgeAnswerer(
      "unused-test-key",
      "test-model",
      client,
    );

    const result = await answerer.answer({
      question: "Do you ship to Canada?",
      passages: [BOOKLY_KNOWLEDGE[0]],
    });

    expect(result).toEqual({
      answer: "Yes. Bookly ships to Canada.",
      citedPassageIds: ["shipping-and-canada"],
    });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(capturedRequest).toMatchObject({
      model: "test-model",
      store: false,
    });
    expect(capturedRequest?.input[0]?.content).toMatch(
      /only facts stated in the retrieved passages/i,
    );

    const userPayload = JSON.parse(
      capturedRequest?.input[1]?.content ?? "{}",
    ) as {
      question?: string;
      retrievedPassages?: Array<{ id: string }>;
    };
    expect(userPayload).toEqual({
      question: "Do you ship to Canada?",
      retrievedPassages: [
        {
          id: "shipping-and-canada",
          title: "Shipping times and destinations",
          content: BOOKLY_KNOWLEDGE[0].content,
        },
      ],
    });
  });

  it("fails safely when the API returns no structured answer", async () => {
    const client: ResponsesParseClient = {
      responses: {
        parse: async () => ({ output_parsed: null }),
      },
    };
    const answerer = new OpenAIKnowledgeAnswerer(
      "unused-test-key",
      "test-model",
      client,
    );

    await expect(
      answerer.answer({
        question: "What is the return policy?",
        passages: [BOOKLY_KNOWLEDGE[1]],
      }),
    ).rejects.toThrow(/no structured knowledge answer/i);
  });
});
