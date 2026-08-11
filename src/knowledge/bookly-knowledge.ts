/**
 * Responsibility: Defines the approved facts and retrieval terms for Bookly FAQs.
 * Boundary: This is evidence only; routing and answer generation live elsewhere.
 */
export interface KnowledgePassage {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly keywords: readonly string[];
}

/**
 * A deliberately tiny knowledge base for the FAQ prototype. These passages are
 * the complete source of truth: an answerer may rephrase them, but may not add
 * facts from model memory or the wider web.
 */
export const BOOKLY_KNOWLEDGE = [
  {
    id: "shipping-and-canada",
    title: "Shipping times and destinations",
    content:
      "Bookly standard shipping usually arrives 3 to 5 business days after shipment in the contiguous United States and 7 to 12 business days after shipment in Canada. Canadian customers see the delivery estimate before payment, and customs can add time.",
    keywords: [
      "shipping",
      "ship",
      "delivery",
      "deliver",
      "Canada",
      "Canadian",
      "shipping time",
      "shipping times",
      "delivery time",
      "delivery times",
      "shipping cost",
      "delivery cost",
      "shipping policy",
      "international shipping",
    ],
  },
  {
    id: "return-policy",
    title: "Return policy",
    content:
      "Most delivered Bookly orders can be returned within 30 days of delivery. Final-sale items are not eligible, and Bookly verifies the order before creating a return.",
    keywords: [
      "return policy",
      "return window",
      "return",
      "returns",
      "30 days",
      "final sale",
      "send back",
      "eligible",
    ],
  },
  {
    id: "password-reset",
    title: "Password reset",
    content:
      "To reset a Bookly password, select Forgot password on the sign-in page and use the reset link sent to the account email. If the link expires, request a new one. Bookly support will never ask for the password.",
    keywords: [
      "password",
      "forgot password",
      "reset password",
      "sign in",
      "login",
      "reset link",
    ],
  },
] as const satisfies readonly KnowledgePassage[];

export type BooklyKnowledgePassageId =
  (typeof BOOKLY_KNOWLEDGE)[number]["id"];
