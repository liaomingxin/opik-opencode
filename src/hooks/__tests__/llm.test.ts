/**
 * Unit tests for LLM hooks (chat.message / message.updated).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { onLlmInput, onLlmOutput, type LlmHookDeps } from "../llm.js"
import type { ActiveTrace, ExporterMetrics } from "../../types.js"
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
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    metadata: {},
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
      metrics,
      sanitize: false,
    }
  })

  it("should create an LLM span for a root session", () => {
    const active = createMockActiveTrace()
    deps.activeTraces.set("session-1", active)

    onLlmInput(
      {
        sessionID: "session-1",
        content: "Hello world",
        model: "claude-4",
        provider: "anthropic",
      },
      deps,
    )

    expect(active.trace.span).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "llm",
        type: "llm",
      }),
    )
    expect(active.currentSpan).not.toBeNull()
    expect(metrics.spansCreated).toBe(1)
  })

  it("should do nothing if no active trace exists", () => {
    onLlmInput(
      { sessionID: "unknown", content: "Hello" },
      deps,
    )
    expect(metrics.spansCreated).toBe(0)
  })

  it("should nest LLM span under parentSpan for child sessions", () => {
    const parentSpan = createMockSpan()
    const active = createMockActiveTrace({ parentSpan })
    deps.activeTraces.set("child-1", active)

    onLlmInput(
      { sessionID: "child-1", content: "Hello from child" },
      deps,
    )

    expect(parentSpan.span).toHaveBeenCalled()
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
      metrics,
      sanitize: false,
    }
  })

  it("should update and close the current LLM span", () => {
    const currentSpan = createMockSpan()
    const active = createMockActiveTrace({ currentSpan })
    deps.activeTraces.set("session-1", active)

    onLlmOutput(
      {
        sessionID: "session-1",
        content: "Response text",
        model: "claude-4",
        tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      },
      deps,
    )

    expect(currentSpan.update).toHaveBeenCalled()
    expect(currentSpan.end).toHaveBeenCalled()
    expect(active.currentSpan).toBeNull()
    expect(active.usage.inputTokens).toBe(100)
    expect(active.usage.outputTokens).toBe(50)
    expect(active.lastOutput).toBe("Response text")
    expect(metrics.spansClosed).toBe(1)
  })
})
