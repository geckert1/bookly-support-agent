/**
 * Responsibility: Uses OpenAI to rephrase only the FAQ passages supplied by retrieval.
 * Boundary: It proposes text and citations; the workflow independently verifies both.
 */
import { OpenAI } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type {
  KnowledgeAnswer,
  KnowledgeAnswerer,
  KnowledgeAnswerInput,
} from "../knowledge/knowledge-answerer.js";

const ModelKnowledgeAnswerSchema = z.object({
  answer: z.string(),
  citedPassageIds: z.array(z.string().trim().min(1)),
});

const KNOWLEDGE_PROMPT = `You answer FAQs for Bookly, an online bookstore.

Use only facts stated in the retrieved passages supplied by the application.
- Do not use outside knowledge, assumptions, or facts from earlier messages.
- Cite every passage used by its exact passage ID.
- Cite only IDs present in the retrieved passages.
- If the passages do not fully support an answer, return an empty answer and an empty citedPassageIds array. Never guess.`;

export interface KnowledgeParseRequest {
  model: string;
  input: Array<{
    role: "system" | "user";
    content: string;
  }>;
  text: { format: unknown };
  store: false;
}

export interface ResponsesParseClient {
  responses: {
    parse(request: KnowledgeParseRequest): Promise<{
      output_parsed: unknown;
    }>;
  };
}

export class OpenAIKnowledgeAnswerer implements KnowledgeAnswerer {
  private readonly client: ResponsesParseClient;

  constructor(
    apiKey: string,
    private readonly model: string,
    client?: ResponsesParseClient,
  ) {
    this.client = client ?? createResponsesParseClient(apiKey);
  }

  async answer(input: KnowledgeAnswerInput): Promise<KnowledgeAnswer> {
    // Do not call the provider without evidence. An empty model answer gives
    // the workflow a deterministic fail-closed result instead of inviting recall.
    if (input.passages.length === 0) {
      return { answer: "", citedPassageIds: [] };
    }

    const response = await this.client.responses.parse({
      model: this.model,
      input: [
        { role: "system", content: KNOWLEDGE_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            question: input.question,
            retrievedPassages: input.passages.map((passage) => ({
              id: passage.id,
              title: passage.title,
              content: passage.content,
            })),
          }),
        },
      ],
      text: {
        format: zodTextFormat(
          ModelKnowledgeAnswerSchema,
          "bookly_grounded_knowledge_answer",
        ),
      },
      store: false,
    });

    if (!response.output_parsed) {
      throw new Error("OpenAI returned no structured knowledge answer.");
    }

    // Structured parsing constrains shape, not truth. Citation membership is
    // deliberately rechecked by the workflow after this provider returns.
    const parsed = ModelKnowledgeAnswerSchema.parse(response.output_parsed);
    return {
      answer: parsed.answer.trim(),
      citedPassageIds: parsed.citedPassageIds,
    };
  }
}

function createResponsesParseClient(apiKey: string): ResponsesParseClient {
  const openai = new OpenAI({ apiKey });

  return {
    responses: {
      parse: async (request) => {
        // Keep the injected test surface tiny while the real adapter still calls
        // the SDK's Responses API directly.
        const response = await openai.responses.parse(request as never);
        return { output_parsed: response.output_parsed };
      },
    },
  };
}
