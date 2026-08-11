// Responsibility: Normalize literal order and email identifiers from customer messages.
// Boundary: These helpers extract explicit values only; they do not infer identity or intent.

/**
 * Normalize the order-ID formats customers commonly type into the one format
 * expected by workflow state and tool schemas.
 */
export function normalizeOrderId(value: string): string | undefined {
  const match = value.trim().toUpperCase().match(/^(?:BK[-\s]?)?(\d{5})$/);
  return match?.[1] ? `BK-${match[1]}` : undefined;
}

/** Return every distinct order identifier that the customer literally typed. */
export function extractOrderIds(value: string): string[] {
  const candidates = value.match(/\b(?:BK[-\s]?)?\d{5}\b/gi) ?? [];
  return [
    ...new Set(
      candidates
        .map((candidate) => normalizeOrderId(candidate))
        .filter((candidate): candidate is string => candidate !== undefined),
    ),
  ];
}

/** Return every distinct email address that the customer literally typed. */
export function extractEmailAddresses(value: string): string[] {
  const candidates =
    value.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) ?? [];
  return [...new Set(candidates.map((candidate) => candidate.toLowerCase()))];
}

/** Return one unambiguous order ID; multiple IDs require orchestration to clarify. */
export function extractSingleOrderId(value: string): string | undefined {
  const orderIds = extractOrderIds(value);
  return orderIds.length === 1 ? orderIds[0] : undefined;
}

/** Return one unambiguous email; multiple addresses require orchestration to clarify. */
export function extractSingleEmailAddress(value: string): string | undefined {
  const emails = extractEmailAddresses(value);
  return emails.length === 1 ? emails[0] : undefined;
}
