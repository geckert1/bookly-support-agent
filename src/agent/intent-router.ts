import { z } from "zod";
import {
  SessionPhaseSchema,
  SupportIntentSchema,
  SupportSlotsSchema,
} from "../domain/agent.js";

export const IntentRouterInputSchema = z.object({
  message: z.string().trim().min(1).max(2_000),
  currentIntent: SupportIntentSchema,
  phase: SessionPhaseSchema,
});

export const ContextActionSchema = z.enum([
  "continue",
  "start_fresh",
  "reuse_verified_order",
]);

export const IntentRouterResultSchema = z.object({
  intent: SupportIntentSchema,
  slots: SupportSlotsSchema.partial(),
  contextAction: ContextActionSchema,
});

export type IntentRouterInput = z.infer<typeof IntentRouterInputSchema>;
export type IntentRouterResult = z.infer<typeof IntentRouterResultSchema>;
export type ContextAction = z.infer<typeof ContextActionSchema>;

export interface IntentRouter {
  route(input: IntentRouterInput): Promise<IntentRouterResult>;
}
