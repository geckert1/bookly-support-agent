import { z } from "zod";

export const ReturnEligibilityCodeSchema = z.enum([
  "eligible",
  "not_delivered",
  "window_expired",
  "final_sale",
]);

export const ReturnEligibilitySchema = z.object({
  eligible: z.boolean(),
  code: ReturnEligibilityCodeSchema,
  explanation: z.string().min(1),
  returnBy: z.string().date().optional(),
});

export const ReturnReceiptSchema = z.object({
  returnId: z.string().regex(/^RET-\d{4}$/),
  orderId: z.string().regex(/^BK-\d{5}$/),
  status: z.literal("authorized"),
  createdAt: z.string().datetime(),
  instructions: z.string().min(1),
});

export type ReturnEligibilityCode = z.infer<
  typeof ReturnEligibilityCodeSchema
>;
export type ReturnEligibility = z.infer<typeof ReturnEligibilitySchema>;
export type ReturnReceipt = z.infer<typeof ReturnReceiptSchema>;
