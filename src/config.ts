import "dotenv/config";
import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const environmentSchema = z.object({
  AGENT_MODE: z.enum(["auto", "mock", "openai"]).default("auto"),
  // `cp .env.example .env` leaves this blank. Treat that as absent so the
  // documented no-key path starts in deterministic mode instead of crashing.
  OPENAI_API_KEY: optionalSecret,
  OPENAI_MODEL: z.string().min(1).default("gpt-5.6-luna"),
  PORT: z.coerce.number().int().positive().default(3000),
});

const environment = environmentSchema.parse(process.env);

const resolvedMode =
  environment.AGENT_MODE === "auto"
    ? environment.OPENAI_API_KEY
      ? "openai"
      : "mock"
    : environment.AGENT_MODE;

if (resolvedMode === "openai" && !environment.OPENAI_API_KEY) {
  throw new Error(
    "AGENT_MODE=openai requires OPENAI_API_KEY. Use AGENT_MODE=mock to run without a key.",
  );
}

export const config = {
  mode: resolvedMode,
  openaiConfigured: Boolean(environment.OPENAI_API_KEY),
  openaiApiKey: environment.OPENAI_API_KEY,
  openaiModel: environment.OPENAI_MODEL,
  port: environment.PORT,
} as const;
