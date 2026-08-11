import { fileURLToPath } from "node:url";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import { BooklyAgent } from "./agent/bookly-agent.js";
import { DeterministicIntentRouter } from "./agent/deterministic-intent-router.js";
import type { IntentRouter } from "./agent/intent-router.js";
import { SessionMemory } from "./agent/session-memory.js";
import { config } from "./config.js";
import {
  DeterministicKnowledgeAnswerer,
  type KnowledgeAnswerer,
} from "./knowledge/knowledge-answerer.js";
import { OpenAIIntentRouter } from "./providers/openai-intent-router.js";
import { OpenAIKnowledgeAnswerer } from "./providers/openai-knowledge-answerer.js";
import { createMockBooklyTools } from "./tools/index.js";

const publicDirectory = fileURLToPath(new URL("./public", import.meta.url));

const chatRequestSchema = z.object({
  sessionId: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(2_000),
});

const resetRequestSchema = z.object({
  sessionId: z.string().trim().min(1).max(120),
});

export interface AppOptions {
  agent?: BooklyAgent;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const agent = options.agent ?? createConfiguredAgent();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      mode: config.mode,
      model: config.mode === "openai" ? config.openaiModel : "deterministic",
      openaiConfigured: config.openaiConfigured,
    });
  });

  app.post("/api/chat", async (request, response) => {
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: "Send a sessionId and a non-empty message under 2,000 characters.",
      });
      return;
    }

    try {
      const reply = await agent.handleMessage(
        parsed.data.sessionId,
        parsed.data.message,
      );
      response.json({ reply });
    } catch {
      // Keep unexpected implementation or provider details out of the browser.
      // Expected router/tool failures are already represented by AgentReply.
      response.status(500).json({
        error: "Bookly couldn't complete that request. Please try again.",
      });
    }
  });

  app.post("/api/reset", (request, response) => {
    const parsed = resetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Send the sessionId to reset." });
      return;
    }

    agent.resetSession(parsed.data.sessionId);
    response.status(204).send();
  });

  app.use(express.static(publicDirectory));

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "API route not found." });
  });

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      if (isRequestTooLargeError(error)) {
        response.status(413).json({ error: "Request body is too large." });
        return;
      }

      if (isJsonParseError(error)) {
        response.status(400).json({ error: "Send valid JSON." });
        return;
      }

      response.status(500).json({
        error: "Bookly couldn't complete that request. Please try again.",
      });
    },
  );

  return app;
}

function isRequestTooLargeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "status" in error &&
    (error as { status?: unknown }).status === 413
  );
}

function isJsonParseError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    "status" in error &&
    (error as { status?: unknown }).status === 400
  );
}

function createConfiguredAgent(): BooklyAgent {
  let router: IntentRouter = new DeterministicIntentRouter();
  let knowledgeAnswerer: KnowledgeAnswerer =
    new DeterministicKnowledgeAnswerer();

  if (config.mode === "openai") {
    router = new OpenAIIntentRouter(
      config.openaiApiKey as string,
      config.openaiModel,
    );
    knowledgeAnswerer = new OpenAIKnowledgeAnswerer(
      config.openaiApiKey as string,
      config.openaiModel,
    );
  }

  return new BooklyAgent(
    router,
    createMockBooklyTools(),
    new SessionMemory(),
    knowledgeAnswerer,
  );
}

if (process.env.NODE_ENV !== "test") {
  createApp().listen(config.port, () => {
    console.log(
      `Bookly is running at http://localhost:${config.port} in ${config.mode} mode.`,
    );
  });
}
