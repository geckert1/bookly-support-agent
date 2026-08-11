import { z } from "zod";

export const ToolErrorCodeSchema = z.enum([
  "invalid_input",
  "order_not_found",
  "confirmation_required",
  "return_not_eligible",
  "return_already_exists",
  "temporary_unavailable",
]);

export type ToolErrorCode = z.infer<typeof ToolErrorCodeSchema>;

export class BooklyToolError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BooklyToolError";
  }
}

export function isBooklyToolError(error: unknown): error is BooklyToolError {
  return error instanceof BooklyToolError;
}
