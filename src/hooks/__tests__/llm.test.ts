/**
 * Unit tests for LLM hooks (chat.message / message.updated).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { onLlmInput, onLlmOutput, onMessagePartUpdated, type LlmHookDeps } from "../llm.js"
import type { ActiveTrace, SubagentSpanHost, ExporterMetrics } from "../../types.js"
import { createInitialMetrics } from "../../types.js"

function createMockSpan() {
  return {
    update: vi.fn(),
    end: vi.fn(),
    span: vi.fn(() => createMockSpan()),
  }
}

function createMockTrace() {
  return {
    ...createMockSpan(),
    trace: vi.fn(),
  }
}

function createMockActiveTrace(overrides?: Partial<ActiveTrace>): ActiveTrace {
  return {
    trace: createMockTrace(),
    currentSpan: null,
    parentSpan: null,
    toolSpans: new Map(),
    subagentSpans: new Map(),
    startedAt: Date.now(),
    lastActiveAt: Date.now(),
    lastOutput: undefined,
    usage: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    streamingText: "",
    metadata: {},
    llmTurnCount: 0,
    ...overrides,
  }
}

describe("onLlmInput", () => {
  let deps: LlmHookDeps
  let metrics: ExporterMetrics

  beforeEach(() => {
    metrics = createInitialMetrics()
    deps = {
      activeTraces: new Map(),
      subagentSpanHosts: new Map(),
      metrics,
      sanitize: false,
    }
  })

  it("should create an LLM span with model name for first turn", () => {
    const active = createMockActiveTrace()
    deps.activeTraces.set("session-1", active)

    onLlmInput(
      {
        sessionID: "session-1",
        model: { providerID: "anthropic", modelID: "claude-4" },
        message: { content: "Hello world" },
        parts: [],
      },
      deps,
    )

    expect(active.trace.span).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "claude-4",
        type: "llm",
      }),
    )
    expect(active.currentSpan).not.toBeNull()
    expect(active.llmTurnCount).toBe(1)
    expect(metrics.spansCreated).toBe(1)
  })

  it("should include turn number in span name for subsequent turns", () => {
    const active = createMockActiveTrace()
    deps.activeTraces.set("session-1", active)

    // Turn 1
    onLlmInput(
      {
        sessionID: "session-1",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
        message: { content: "First" },
      },
      deps,
    )
    expect(active.trace.span).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "claude-sonnet-4-5" }),
    )

    // Turn 2
    onLlmInput(
      {
        sessionID: "session-1",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
        message: { content: "Second" },
      },
      deps,
    )
    expect(active.trace.span).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "claude-sonnet-4-5 #2" }),
    )
    expect(active.llmTurnCount).toBe(2)
  })

  it("should fall back to 'llm' when model is not provided", () => {
    const active = createMockActiveTrace()
    deps.activeTraces.set("session-1", active)

    onLlmInput(
      {
        sessionID: "session-1",
        message: { content: "Hello" },
      },
      deps,
    )

    expect(active.trace.span).toHaveBeenCalledWith(
      expect.objectContaining({ name: "llm" }),
    )
  })

  it("should do nothing if no active trace exists", () => {
    onLlmInput(
      { sessionID: "unknown", message: { content: "Hello" } },
      deps,
    )
    expect(metrics.spansCreated).toBe(0)
  })

  it("should nest LLM span under parentSpan for child sessions", () => {
    const parentSpan = createMockSpan()
    const active = createMockActiveTrace({ parentSpan })
    deps.activeTraces.set("child-1", active)

    onLlmInput(
      { sessionID: "child-1", message: { content: "Hello from child" } },
      deps,
    )

    expect(parentSpan.span).toHaveBeenCalledWith(
      expect.objectContaining({ name: "llm" }), // no model → "llm"
    )
    expect(active.trace.span).not.toHaveBeenCalled()
  })
})

describe("onLlmOutput", () => {
  let deps: LlmHookDeps
  let metrics: ExporterMetrics

  beforeEach(() => {
    metrics = createInitialMetrics()
    deps = {
      activeTraces: new Map(),
      subagentSpanHosts: new Map(),
      metrics,
      sanitize: false,
    }
  })

  it("should create fallback span with model name and turn count when no currentSpan", () => {
    const active = createMockActiveTrace({ llmTurnCount: 1 }) // already had one turn
    deps.activeTraces.set("session-1", active)

    onLlmOutput(
      {
        sessionID: "session-1",
        content: "Response",
        modelID: "claude-4",
        providerID: "anthropic",
        messageID: "msg-1",
      },
      deps,
    )

    // Should create span named "claude-4 #2" (second turn)
    expect(active.trace.span).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "claude-4 #2",
        type: "llm",
      }),
    )
    expect(active.llmTurnCount).toBe(2)
  })

  it("should update and close the current LLM span", () => {
    const currentSpan = createMockSpan()
    const active = createMockActiveTrace({ currentSpan })
    deps.activeTraces.set("session-1", active)

    onLlmOutput(
      {
        sessionID: "session-1",
        content: "Response text",
        modelID: "claude-4",
        providerID: "anthropic",
        messageID: "msg-1",
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      deps,
    )

    expect(currentSpan.update).toHaveBeenCalled()
    expect(currentSpan.end).toHaveBeenCalled()
    expect(active.currentSpan).toBeNull()
    expect(active.usage.input).toBe(100)
    expect(active.usage.output).toBe(50)
    expect(active.lastOutput).toBe("Response text")
    expect(metrics.spansClosed).toBe(1)
  })
})

describe("onMessagePartUpdated", () => {
  let deps: LlmHookDeps
  let metrics: ExporterMetrics

  beforeEach(() => {
    metrics = createInitialMetrics()
    deps = {
      activeTraces: new Map(),
      subagentSpanHosts: new Map(),
      metrics,
      sanitize: false,
    }
  })

  it("should accumulate deltas into streamingText", () => {
    const currentSpan = createMockSpan()
    const active = createMockActiveTrace({ currentSpan })
    deps.activeTraces.set("session-1", active)

    onMessagePartUpdated(
      { sessionID: "session-1", part: { type: "text", text: "Hello" }, delta: "Hello" },
      deps,
    )
    onMessagePartUpdated(
      { sessionID: "session-1", part: { type: "text", text: "Hello world" }, delta: " world" },
      deps,
    )

    expect(active.streamingText).toBe("Hello world")
  })

  it("should do nothing if no active trace exists", () => {
    onMessagePartUpdated(
      { sessionID: "unknown", part: { type: "text" }, delta: "Hello" },
      deps,
    )
    // No error thrown, metrics unchanged
    expect(metrics.spansCreated).toBe(0)
  })
})
