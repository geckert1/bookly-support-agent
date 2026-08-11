// Responsibility: render the chat, trace, and simulated specialist handoff.
// Boundary: this browser code displays API results; it owns no business policy
// and the support button intentionally makes no external help-desk request.
(() => {
  "use strict";

  const STORAGE_KEY = "bookly-session-id";
  const MAX_TRACE_EVENTS = 24;
  const MAX_FIELD_LENGTH = 180;
  const SUPPORT_WAIT_MINUTES = 6;

  // Only these primitive operational fields may enter the trace panel. This
  // deliberately excludes prompts, messages, content, rationale, and reasoning.
  const TRACE_FIELDS = new Map([
    ["category", "Category"],
    ["name", "Name"],
    ["status", "Status"],
    ["detail", "Detail"]
  ]);

  const TITLE_FIELDS = ["name"];
  const STATUS_FIELDS = ["status"];

  const elements = {
    form: document.querySelector("#composer-form"),
    input: document.querySelector("#composer-input"),
    sendButton: document.querySelector("#send-button"),
    resetButton: document.querySelector("#reset-button"),
    conversation: document.querySelector("#conversation"),
    starterPrompts: document.querySelector("#starter-prompts"),
    promptButtons: Array.from(document.querySelectorAll(".prompt-chip")),
    composerStatus: document.querySelector("#composer-status"),
    modeBadge: document.querySelector("#mode-badge"),
    modeLabel: document.querySelector("#mode-label"),
    traceContent: document.querySelector("#trace-content"),
    traceEmpty: document.querySelector("#trace-empty"),
    traceList: document.querySelector("#trace-list")
  };

  let sessionId = getOrCreateSessionId();
  let isBusy = false;
  let supportRequested = false;

  // A per-tab ID preserves multi-turn context without putting customer details
  // in browser storage. Reset rotates it so the next transcript is isolated.
  function createSessionId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }

    return `bookly-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function getOrCreateSessionId() {
    try {
      const existing = window.sessionStorage.getItem(STORAGE_KEY);
      if (existing) return existing;

      const next = createSessionId();
      window.sessionStorage.setItem(STORAGE_KEY, next);
      return next;
    } catch {
      return createSessionId();
    }
  }

  function replaceSessionId() {
    sessionId = createSessionId();
    try {
      window.sessionStorage.setItem(STORAGE_KEY, sessionId);
    } catch {
      // The in-memory session still works when storage is unavailable.
    }
  }

  function formatTime(date = new Date()) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  function createMessage(role, text, options = {}) {
    const article = document.createElement("article");
    article.className = `message message--${role}${options.error ? " message--error" : ""}`;

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = options.error ? "!" : role === "user" ? "YOU" : "B";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = text;

    if (options.supportAction) {
      const actionRow = document.createElement("div");
      actionRow.className = "message-action";

      const supportButton = document.createElement("button");
      supportButton.type = "button";
      supportButton.className = "support-action-button";
      supportButton.textContent = supportRequested
        ? "Support already requested"
        : "Request support specialist";
      supportButton.disabled = supportRequested;
      supportButton.addEventListener("click", requestSupportSpecialist);
      actionRow.append(supportButton);
      bubble.append(actionRow);
    }

    if (!options.hideTime) {
      const time = document.createElement("time");
      time.className = "message-time";
      time.dateTime = new Date().toISOString();
      time.textContent = formatTime();
      bubble.append(time);
    }

    article.append(avatar, bubble);
    return article;
  }

  function requestSupportSpecialist() {
    if (isBusy || supportRequested) return;

    // This is intentionally honest demo behavior: the button changes local UI
    // state only and never implies that a real help-desk ticket was created.
    supportRequested = true;
    document.querySelectorAll(".support-action-button").forEach((button) => {
      button.disabled = true;
      button.textContent = "Support requested";
    });
    appendMessage(
      "assistant",
      `Demo handoff queued. A Bookly support specialist will be with you shortly. Estimated wait time: ${SUPPORT_WAIT_MINUTES} minutes.`
    );
    elements.composerStatus.textContent = `Support requested · about ${SUPPORT_WAIT_MINUTES} min`;
  }

  function createLoadingMessage() {
    const article = createMessage("assistant", "", { hideTime: true });
    article.id = "loading-message";
    article.setAttribute("aria-label", "Bookly is working");

    const bubble = article.querySelector(".message-bubble");
    bubble.classList.add("typing-bubble");
    bubble.setAttribute("aria-hidden", "true");
    bubble.replaceChildren(
      document.createElement("span"),
      document.createElement("span"),
      document.createElement("span")
    );

    return article;
  }

  function appendMessage(role, text, options = {}) {
    const message = createMessage(role, text, options);
    elements.conversation.append(message);
    scrollConversation();
    return message;
  }

  function scrollConversation() {
    window.requestAnimationFrame(() => {
      elements.conversation.scrollTop = elements.conversation.scrollHeight;
    });
  }

  function renderWelcome() {
    elements.conversation.replaceChildren();
    appendMessage(
      "assistant",
      "Hi, I’m Bookly, the online bookstore support assistant. I can track an order, check return eligibility, start a return, or answer approved shipping and policy FAQs. For order-specific help, share your order number and email."
    );
    elements.starterPrompts.hidden = false;
  }

  function setBusy(busy, statusText = "Ready") {
    isBusy = busy;
    elements.input.disabled = busy;
    elements.resetButton.disabled = busy;
    elements.promptButtons.forEach((button) => {
      button.disabled = busy;
    });
    elements.form.setAttribute("aria-busy", String(busy));
    elements.composerStatus.textContent = statusText;
    updateComposerAvailability();
  }

  // Keeping one source of truth prevents an empty composer from looking
  // actionable after a request, reset, or failed response re-enables the UI.
  function updateComposerAvailability() {
    elements.sendButton.disabled = isBusy || !elements.input.value.trim();
  }

  function autoSizeComposer() {
    elements.input.style.height = "auto";
    elements.input.style.height = `${Math.min(elements.input.scrollHeight, 132)}px`;
  }

  function normalizeReply(reply) {
    if (typeof reply === "string" && reply.trim()) return reply.trim();

    if (
      reply &&
      typeof reply === "object" &&
      typeof reply.message === "string" &&
      reply.message.trim()
    ) {
      return reply.message.trim();
    }

    return "I completed the request, but didn’t receive a message to display.";
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });

    const rawBody = await response.text();
    let body = {};

    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        // An unreadable success response is a broken API contract; an unreadable
        // error response is replaced below with a safe status-based message.
        if (response.ok) throw new Error("The server returned an unreadable response.");
      }
    }

    if (!response.ok) {
      const message =
        typeof body.error === "string"
          ? body.error
          : typeof body.message === "string"
            ? body.message
            : `Request failed (${response.status}).`;
      throw new Error(message);
    }

    return body;
  }

  function operationalEvents(trace) {
    if (Array.isArray(trace)) return trace.slice(0, MAX_TRACE_EVENTS);
    if (!trace || typeof trace !== "object") return [];

    const events = [];
    const rootFields = approvedFields(trace);
    if (rootFields.length) events.push(trace);

    // Tolerating these three envelopes keeps the presentation adapter small;
    // approvedFields still enforces the same privacy allowlist for every shape.
    for (const key of ["events", "steps", "operations"]) {
      if (Array.isArray(trace[key])) events.push(...trace[key]);
    }

    return events.slice(0, MAX_TRACE_EVENTS);
  }

  function approvedFields(event) {
    if (!event || typeof event !== "object" || Array.isArray(event)) return [];

    const approved = [];
    for (const [key, label] of TRACE_FIELDS) {
      const value = event[key];
      const isPrimitive = ["string", "number", "boolean"].includes(typeof value);
      if (!isPrimitive || value === "") continue;

      approved.push({ key, label, value: displayValue(key, value) });
    }
    return approved;
  }

  function displayValue(key, value) {
    if ((key === "durationMs" || key === "latencyMs") && Number.isFinite(Number(value))) {
      return `${Number(value)} ms`;
    }

    if (key === "timestamp") {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return formatTime(date);
    }

    const text = String(value).replace(/\s+/g, " ").trim();
    return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH - 1)}…` : text;
  }

  function eventTitle(fields, index) {
    for (const titleKey of TITLE_FIELDS) {
      const field = fields.find(({ key }) => key === titleKey);
      if (field) return field.value.replace(/[_-]+/g, " ");
    }
    return `Operation ${index + 1}`;
  }

  function eventStatus(fields) {
    for (const statusKey of STATUS_FIELDS) {
      const field = fields.find(({ key }) => key === statusKey);
      if (field) return field.value;
    }
    return "recorded";
  }

  function statusClass(status) {
    const value = status.toLowerCase();
    if (/success|succeeded|complete|completed|ok|ready|available/.test(value)) {
      return "trace-status--success";
    }
    if (/blocked|error|fail|failed|timeout|unavailable/.test(value)) {
      return "trace-status--blocked";
    }
    return "";
  }

  function createTraceEvent(event, index) {
    const fields = approvedFields(event);
    if (!fields.length) return null;

    const title = eventTitle(fields, index);
    const status = eventStatus(fields);
    const titleKeys = new Set([...TITLE_FIELDS, ...STATUS_FIELDS]);
    const detailFields = fields.filter(({ key }) => !titleKeys.has(key));

    const item = document.createElement("li");
    item.className = "trace-event";

    const number = document.createElement("span");
    number.className = "trace-event-number";
    number.setAttribute("aria-hidden", "true");
    number.textContent = String(index + 1);

    const card = document.createElement("div");
    card.className = "trace-event-card";

    const heading = document.createElement("div");
    heading.className = "trace-event-title";

    const headingText = document.createElement("strong");
    headingText.textContent = title;

    const statusBadge = document.createElement("span");
    statusBadge.className = `trace-status ${statusClass(status)}`.trim();
    statusBadge.textContent = status;
    heading.append(headingText, statusBadge);
    card.append(heading);

    if (detailFields.length) {
      const details = document.createElement("dl");
      details.className = "trace-fields";

      detailFields.forEach(({ label, value }) => {
        const term = document.createElement("dt");
        term.textContent = label;
        const description = document.createElement("dd");
        description.textContent = value;
        details.append(term, description);
      });

      card.append(details);
    }

    item.append(number, card);
    return item;
  }

  function renderTrace(trace) {
    const safeItems = operationalEvents(trace)
      .map(createTraceEvent)
      .filter(Boolean);

    elements.traceList.replaceChildren(...safeItems);
    elements.traceEmpty.hidden = safeItems.length > 0;

    // The newest guardrail should be visible without hiding earlier events;
    // the focusable region remains scrollable for keyboard review.
    window.requestAnimationFrame(() => {
      elements.traceContent.scrollTop = elements.traceContent.scrollHeight;
    });
  }

  async function sendMessage(message) {
    const cleanMessage = message.trim();
    if (!cleanMessage || isBusy) return;

    elements.starterPrompts.hidden = true;
    appendMessage("user", cleanMessage);
    elements.input.value = "";
    autoSizeComposer();
    setBusy(true, "Bookly is working…");

    const loadingMessage = createLoadingMessage();
    elements.conversation.append(loadingMessage);
    scrollConversation();

    try {
      const data = await requestJson("/api/chat", {
        method: "POST",
        body: JSON.stringify({ sessionId, message: cleanMessage })
      });

      loadingMessage.remove();
      appendMessage("assistant", normalizeReply(data.reply), {
        // The server's terminal intent is the only entry condition for the
        // simulated handoff action; matching customer-facing prose is unsafe.
        supportAction: data.reply?.intent === "handoff"
      });
      renderTrace(data.trace ?? data.reply?.trace);
      setBusy(false, "Ready");
      elements.input.focus();
    } catch (error) {
      loadingMessage.remove();
      appendMessage(
        "assistant",
        error instanceof Error ? error.message : "Bookly couldn’t complete that request. Please try again.",
        { error: true }
      );
      setBusy(false, "Something went wrong");
      elements.input.focus();
    }
  }

  async function resetConversation() {
    if (isBusy) return;
    setBusy(true, "Resetting…");

    try {
      await requestJson("/api/reset", {
        method: "POST",
        body: JSON.stringify({ sessionId })
      });
      // Rotate only after the server confirms its mock state was cleared. This
      // prevents a failed reset from silently abandoning an active session.
      replaceSessionId();
      supportRequested = false;
      renderWelcome();
      renderTrace(null);
      elements.input.value = "";
      autoSizeComposer();
      setBusy(false, "New conversation");
      elements.input.focus();
    } catch (error) {
      setBusy(false, "Reset failed");
      appendMessage(
        "assistant",
        error instanceof Error ? error.message : "I couldn’t reset the conversation. Please try again.",
        { error: true }
      );
    }
  }

  function updateModeBadge({ mode, model, openaiConfigured } = {}) {
    const normalizedMode = typeof mode === "string" && mode.trim() ? mode.trim() : "Ready";
    elements.modeLabel.textContent = `${normalizedMode} mode`;
    elements.modeBadge.classList.remove("mode-badge--checking", "mode-badge--offline");

    const details = [];
    if (typeof model === "string" && model.trim()) details.push(`Model: ${model.trim()}`);
    if (typeof openaiConfigured === "boolean") {
      details.push(openaiConfigured ? "OpenAI configured" : "OpenAI not configured");
    }
    elements.modeBadge.title = details.join(" · ");
  }

  function showOfflineMode() {
    elements.modeBadge.classList.remove("mode-badge--checking");
    elements.modeBadge.classList.add("mode-badge--offline");
    elements.modeLabel.textContent = "Offline";
    elements.modeBadge.title = "Health check unavailable";
  }

  async function checkHealth() {
    try {
      const health = await requestJson("/api/health");
      updateModeBadge(health);
    } catch {
      // Health is presentation metadata. Its failure must not erase the chat or
      // claim that the configured agent changed modes at runtime.
      showOfflineMode();
    }
  }

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(elements.input.value);
  });

  elements.input.addEventListener("input", () => {
    autoSizeComposer();
    updateComposerAvailability();
  });
  elements.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      elements.form.requestSubmit();
    }
  });

  elements.promptButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const prompt = button.dataset.prompt || button.textContent;
      elements.input.value = prompt.trim();
      autoSizeComposer();
      elements.form.requestSubmit();
    });
  });

  elements.resetButton.addEventListener("click", resetConversation);

  renderWelcome();
  renderTrace(null);
  autoSizeComposer();
  updateComposerAvailability();
  checkHealth();
})();
