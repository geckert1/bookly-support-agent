/**
 * Responsibility: Defines and validates every Bookly tool input and output.
 * Boundary: Schemas protect the command edge; implementations still enforce policy and identity.
 */
import { z } from "zod";
import { OrderSchema } from "../domain/order.js";
import {
  ReturnEligibilitySchema,
  ReturnReceiptSchema,
} from "../domain/returns.js";

const OrderIdSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^BK-\d{5}$/));

const CustomerEmailSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(z.string().email());

export const LookupOrderInputSchema = z.object({
  orderId: OrderIdSchema,
  email: CustomerEmailSchema,
});

export const LookupOrderOutputSchema = OrderSchema;

export const CheckReturnEligibilityInputSchema = z.object({
  orderId: OrderIdSchema,
});

export const CheckReturnEligibilityOutputSchema = ReturnEligibilitySchema;

export const CreateReturnInputSchema = z.object({
  orderId: OrderIdSchema,
  email: CustomerEmailSchema,
  reason: z.string().trim().min(3).max(300),
  // A literal true makes confirmation part of the command type, so callers
  // cannot accidentally omit or soften the write authorization signal.
  confirmed: z.literal(true),
});

export const CreateReturnOutputSchema = ReturnReceiptSchema;

export type LookupOrderInput = z.input<typeof LookupOrderInputSchema>;
export type LookupOrderOutput = z.output<typeof LookupOrderOutputSchema>;
export type CheckReturnEligibilityInput = z.input<
  typeof CheckReturnEligibilityInputSchema
>;
export type CheckReturnEligibilityOutput = z.output<
  typeof CheckReturnEligibilityOutputSchema
>;
export type CreateReturnInput = z.input<typeof CreateReturnInputSchema>;
export type CreateReturnOutput = z.output<typeof CreateReturnOutputSchema>;

export interface BooklyTools {
  lookupOrder(input: LookupOrderInput): Promise<LookupOrderOutput>;
  checkReturnEligibility(
    input: CheckReturnEligibilityInput,
  ): Promise<CheckReturnEligibilityOutput>;
  createReturn(input: CreateReturnInput): Promise<CreateReturnOutput>;
}
