# Solution Decisions

> **Use AI for ambiguity; use code for commitments.**

The assistant can interpret a customer's language and write a read-only FAQ response from retrieved Bookly passages. Order facts, return decisions, and write authorization must come from validated data and deterministic application code.

## Scope

- Answer order-status questions from the supplied order data.
- Explain whether an order is returnable and give the correct next step.
- Answer approved shipping, return-policy, and password-reset questions from a small grounded knowledge base.
- Preserve enough conversation context for natural follow-up questions.
- Fail clearly when an order cannot be found, required information is missing, a dependency is unavailable, or the request requires a specialist.

## Assumptions

- The prototype fixtures are the source of truth for this exercise.
- A customer can identify an order with the fixture fields exposed by the backend; production would require authenticated identity and authorization.
- Return eligibility is a deterministic 30-day policy for this prototype.
- `createReturn` is a mocked, in-memory write that produces one auditable receipt per order.
- The three static Bookly knowledge passages are the complete source of truth for FAQ answers in this prototype.
- A successful return retains only its order ID and return ID for safe aftercare; the raw conversation is not stored.
- Carrier, warehouse, payment, and help-desk integrations are simulated or out of scope.
- `/api/reset` clears session memory and mock-only return receipts so the exact demo can be replayed. A production reset would never erase durable return records.

## Key decisions

### 1. Separate interpretation from execution

AI identifies intent and extracts details from natural language. The router also returns an explicit `contextAction`: continue the current context, start fresh, or request reuse of a verified order. Typed application code validates that transition, retrieves the order, evaluates return policy, interprets final confirmation through a small structural grammar, and constructs every operational commitment.

**Tradeoff:** This is less flexible than letting a model answer end to end, but it prevents invented statuses, dates, and return promises. The model can interpret a reference such as `return it`, while code permits reuse only after a completed verified lookup with no conflicting order or email.

### 2. Let the model write only inside a grounded knowledge boundary

The FAQ path uses deterministic retrieval over three approved passages. The OpenAI answerer receives only the customer question and retrieved passages. Its Structured Output must include a non-empty answer and citations that all belong to that retrieved set. No match, a provider failure, an empty answer, or an invalid citation produces a specialist handoff without displaying the proposed answer.

Mock mode exercises the same retrieval and citation guard but returns the approved passage text directly. It makes no external model request.

**Tradeoff:** Citation membership is an explicit, testable grounding guard, not proof of semantic entailment. The deliberately small knowledge base and specialist fallback keep that limitation honest.

### 3. Give operational workflows narrow, explicit interfaces

Order lookup, return evaluation, and return creation are separate operations with validated inputs and structured outputs. The model never receives tool access. An explicit workflow chooses each operation, and `createReturn` independently rechecks confirmation, identity, eligibility, and idempotency.

Existing-return status, refund, label, and QR-code problems have their own routing outcome and can never enter the new-return workflow. If the OpenAI provider is unavailable after a completed return, one conservative deterministic concept check may choose handoff. The offline mock router uses those same narrow concepts as its explicit deterministic classifier; this is not a runtime switch from OpenAI to mock mode.

**Tradeoff:** Explicit route and tool contracts add code, but they keep model interpretation separate from business execution and make failures reproducible.

### 4. Design every boundary for traceability and safe failure

The prototype exposes the selected route, context transition, retrieval result, tool outcome, guardrail outcome, and safe error category without logging raw messages, prompts, tool arguments, model answers, or private reasoning. Unknown or unavailable results produce a clear retry or human-handoff path, never a guess.

**Tradeoff:** Observability and explicit failure states take time beyond the happy path, but they make the solution supportable in a live customer environment.

## Non-goals

- A general-purpose support agent or broad knowledge base beyond the three approved passages.
- Real refunds, shipping changes, labels, payments, or carrier updates.
- A real help-desk case creation or live-agent transfer; the prototype states this limitation instead of pretending a handoff occurred.
- Production authentication, authorization, persistence, or third-party integrations.
- A complex multi-agent framework when three readable, explicit paths are sufficient.
- Pixel-perfect UI at the expense of correctness and explainability.

## First production change

Replace the prototype's email match with authenticated customer identity, then persist the existing idempotent command boundary and audit record. A repeated request must not create two returns, and every state change must be attributable to an authorized customer and policy version.

## Metrics

Initial acceptance targets:

- **Commitment correctness:** zero invented order facts or unsupported return promises in the evaluation set.
- **Workflow accuracy:** 100% correct order-status and eligibility decisions across deterministic fixture tests.
- **Grounding acceptance:** every displayed FAQ answer cites only passages returned by retrieval; unsupported questions display no generated answer.
- **Router conformance:** OpenAI and deterministic routers satisfy the same normalized intent, slot, and context-action cases.
- **Task success:** at least 95% of representative conversations reach the correct answer or safe handoff.
- **Reliability:** tool success rate, categorized failure rate, and retry rate are visible.
- **Speed:** p95 deterministic workflow latency under 500 ms locally, with model latency reported separately.
- **Customer outcome:** resolution rate, escalation rate, and time to resolution are tracked by workflow.
