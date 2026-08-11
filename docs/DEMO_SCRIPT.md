# Two-Minute Demo

## Demo fixtures

- Customer: `maya.chen@example.com`
- In-transit order: `BK-10421`
- Return-eligible order: `BK-10422`
- Return-ineligible order: `BK-10423`
- Grounded FAQ: shipping time

## Demo flow

### 0:00-0:15 - Set the frame

“This is a small customer-support assistant for three focused areas: order status, returns, and approved FAQs. The design principle is simple: use AI for ambiguity and code for commitments.”

### 0:15-0:35 - Grounded FAQ

Enter:

> How long does shipping take?

After the response, point to `KnowledgeRetrieval` and `GroundedAnswer` in the trace:

“This is where the model writes customer-facing text, but it does not answer from memory. Code retrieves an approved shipping passage first. The model sees the question and only that retrieved passage, and the application rejects the answer unless its citations point back to what was retrieved. With no matching passage, Bookly hands off instead of guessing.”

Reset the conversation.

### 0:35-1:00 - Order status

Start without enough information:

> Where is my order?

After Bookly asks for the missing identifier, enter:

> BK-10421

After it asks for the customer match, enter:

> maya.chen@example.com

After the response:

“The customer can ask naturally, but the assistant does not invent a status or delivery date. It identifies the request, calls the order-status workflow, and presents only validated fixture data.”

Ask a contextual follow-up:

> Is it still on the way?

“The follow-up works without making the customer repeat the order number. The router returns a context action, and code validates whether stored order context can continue.”

### 1:00-1:35 - Return request

Enter:

> I need to return order BK-10422 because it did not fit. My email is maya.chen@example.com.

When Bookly explains eligibility and asks for confirmation, enter:

> Sure, go ahead.

After the response:

“The natural confirmation works, but the model does not authorize this write. A deterministic confirmation policy accepts only an unambiguous approval at the pending-confirmation step. The `createReturn` boundary still rechecks confirmation, identity, eligibility, and duplicate protection.”

### 1:35-1:52 - Post-action recovery

Enter:

> I didn't get the label yet.

“Bookly keeps the verified return ID, but it does not restart the return or invent label capabilities. Existing-return help is a separate route that can never enter the new-return workflow. If the provider is unavailable, a narrow deterministic check can still choose this safe handoff.”

### 1:52-2:00 - Close

“The result is intentionally compact: model-driven where language is ambiguous, grounded when the model writes, deterministic where the business makes a commitment, and easy to trace, test, and extend.”

## Optional guardrail if there is extra time

Reset, then enter:

> I need to return order BK-10423 because I changed my mind. My email is maya.chen@example.com.

“Bookly stays empathetic, but it does not override the 30-day policy or claim a return was created. It gives the verified reason and the safe escalation path.”

Reset once more if needed. In this prototype, reset clears conversation state and the mock-only return receipt so the exact demo can be replayed. It does not change the duplicate-return guarantee within a conversation, and production records would remain durable.
