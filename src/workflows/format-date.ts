/**
 * Responsibility: Formats workflow dates consistently in UTC for customer replies.
 * Boundary: Callers own missing-value copy and state whether an input is date-only.
 */

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function formatUtcDate(
  value: string,
  treatAsDateOnly = DATE_ONLY_PATTERN.test(value),
): string {
  // Noon UTC avoids an apparent prior-day shift when a date-only value is
  // parsed in another local timezone. Timestamp inputs retain their instant.
  const timestamp = treatAsDateOnly ? `${value}T12:00:00.000Z` : value;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}
