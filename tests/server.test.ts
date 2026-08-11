// Responsibility: Verify the reviewer-facing HTTP contract, static assets, validation, chat, and reset behavior.
// Boundary: Runs the app in process with deterministic mocks; it does not bind a public port or call OpenAI.

import request from "supertest";
import { describe, expect, it } from "vitest";
import { BooklyAgent } from "../src/agent/bookly-agent.js";
import { DeterministicIntentRouter } from "../src/agent/deterministic-intent-router.js";
import { createApp } from "../src/server.js";
import { MockBooklyTools } from "../src/tools/mock-bookly-tools.js";

function createTestApp() {
  const agent = new BooklyAgent(
    new DeterministicIntentRouter(),
    new MockBooklyTools(),
  );
  return createApp({ agent });
}

describe("Bookly HTTP API", () => {
  it("serves the reviewer-facing chat UI", async () => {
    const response = await request(createTestApp()).get("/");

    expect(response.status).toBe(200);
    expect(response.type).toMatch(/html/);
    expect(response.text).toContain("Bookly");
    expect(response.text).toContain("How long does shipping take?");
    expect(response.text).toMatch(/id="send-button"[^>]*disabled/);
    expect(response.text).toMatch(/id="trace-content"[\s\S]*?tabindex="0"/);
  });

  it("ships the demo-only support handoff control", async () => {
    const response = await request(createTestApp()).get("/app.js");

    expect(response.status).toBe(200);
    expect(response.type).toMatch(/javascript/);
    expect(response.text).toContain("Request support specialist");
    expect(response.text).toContain("Demo handoff queued");
    expect(response.text).toContain("Estimated wait time");
  });

  it("rejects an invalid chat request", async () => {
    const response = await request(createTestApp()).post("/api/chat").send({
      sessionId: "api-validation",
      message: "",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/non-empty message/i);
  });

  it("returns safe JSON for malformed JSON input", async () => {
    const response = await request(createTestApp())
      .post("/api/chat")
      .set("Content-Type", "application/json")
      .send("{not-json");

    expect(response.status).toBe(400);
    expect(response.type).toMatch(/json/);
    expect(response.body).toEqual({ error: "Send valid JSON." });
    expect(response.text).not.toMatch(/SyntaxError|node_modules|server\.ts/i);
  });

  it("returns 413 JSON for an oversized request", async () => {
    const response = await request(createTestApp())
      .post("/api/chat")
      .set("Content-Type", "application/json")
      .send(
        JSON.stringify({
          sessionId: "oversized-request",
          message: "x".repeat(17_000),
        }),
      );

    expect(response.status).toBe(413);
    expect(response.type).toMatch(/json/);
    expect(response.body).toEqual({ error: "Request body is too large." });
    expect(response.text).not.toMatch(/PayloadTooLargeError|node_modules/i);
  });

  it("returns one validated reply contract", async () => {
    const response = await request(createTestApp()).post("/api/chat").send({
      sessionId: "api-chat",
      message: "Where is my order?",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reply: {
        intent: "order_status",
        status: "needs_input",
      },
    });
    expect(response.body.trace).toBeUndefined();
    expect(response.body.reply.trace).toEqual(expect.any(Array));
  });

  it("resets the server-side session", async () => {
    const app = createTestApp();
    const sessionId = "api-reset";

    await request(app).post("/api/chat").send({
      sessionId,
      message: "Track BK-10421.",
    });
    const reset = await request(app).post("/api/reset").send({ sessionId });
    const afterReset = await request(app).post("/api/chat").send({
      sessionId,
      message: "maya.chen@example.com",
    });

    expect(reset.status).toBe(204);
    expect(afterReset.body.reply).toMatchObject({
      intent: "unknown",
      status: "needs_input",
    });
  });

  it("keeps duplicate returns blocked until reset, then replays the demo", async () => {
    const app = createTestApp();
    const sessionId = "api-repeatable-return";
    const returnRequest =
      "Return BK-10422 because it did not fit. My email is maya.chen@example.com.";

    const prepareFirst = await request(app).post("/api/chat").send({
      sessionId,
      message: returnRequest,
    });
    const createFirst = await request(app).post("/api/chat").send({
      sessionId,
      message: "yes",
    });

    expect(prepareFirst.body.reply.status).toBe("needs_confirmation");
    expect(createFirst.body.reply.message).toMatch(/RET-0001 is authorized/i);

    await request(app).post("/api/chat").send({
      sessionId,
      message: returnRequest,
    });
    const duplicate = await request(app).post("/api/chat").send({
      sessionId,
      message: "yes",
    });

    expect(duplicate.body.reply.message).toMatch(/return already exists/i);

    const reset = await request(app).post("/api/reset").send({ sessionId });
    const prepareAgain = await request(app).post("/api/chat").send({
      sessionId,
      message: returnRequest,
    });
    const createAgain = await request(app).post("/api/chat").send({
      sessionId,
      message: "yes",
    });

    expect(reset.status).toBe(204);
    expect(prepareAgain.body.reply.status).toBe("needs_confirmation");
    expect(createAgain.body.reply.message).toMatch(/RET-0001 is authorized/i);
  });
});
