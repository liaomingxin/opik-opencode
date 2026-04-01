/**
 * End-to-end integration tests for OpikService.
 *
 * Unlike unit tests that test each hook in isolation, these verify the
 * complete chain: event → service dispatch → hook → Opik mock calls.
 * Simulates real OpenCode session lifecycles through the public API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { OpikService } from "../service.js"

// ─── Mock opik SDK ──────────────────────────────────────────────────────────

function createMockSpan() {
  const span: any = {
    update: vi.fn(),
    end: vi.fn(),
    span: vi.fn(() => createMockSpan()),
  }
  return span
}

function createMockTrace() {
  return {
    ...createMockSpan(),
    trace: vi.fn(),
  }
}

const mockFlush = vi.fn()
const mockOpikTrace = vi.fn(() => createMockTrace())

vi.mock("opik", () => ({
  Opik: vi.fn().mockImplementation(() => ({
    trace: mockOpikTrace,
    flush: mockFlush,
  })),
  disableLogger: vi.fn(),
}))

/**
 * Reset all mocks AND restore mockFlush's default behavior.
 * vi.clearAllMocks() resets call history but does NOT clear
 * mockRejectedValue/mockResolvedValue implementations.
 * mockReset() clears everything including implementation.
 */
function resetMocks(): void {
  vi.clearAllMocks()
  mockFlush.mockReset()
  mockFlush.mockResolvedValue(undefined)
  mockOpikTrace.mockImplementation(() => createMockTrace())
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Flush queueMicrotask + pending fake timers.
 *
 * session.idle uses queueMicrotask internally. With vi.useFakeTimers(),
 * we use advanceTimersByTimeAsync to process both microtasks and timers.
 */
async function flushMicrotasks(): Promise<void> {
  await vi.advanceTimersByTimeAsync(10)
}

// ─── Complete single-session lifecycle ──────────────────────────────────────

describe("E2E: Complete single-session lifecycle", () => {
  let service: OpikService

  beforeEach(async () => {
    vi.useFakeTimers()
    resetMocks()
    service = new OpikService()
    await service.start({
      projectName: "e2e-test",
      sanitizePayloads: false,
      flushRetries: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should trace a full session: create → LLM → tool → idle → metrics", async () => {
    // 1. Session created → Trace
    service.handleSessionCreated({
      sessionID: "sess-1",
      info: { id: "sess-1", title: "E2E Session" },
    })
    expect(service.getActiveTraceCount()).toBe(1)
    expect(mockOpikTrace).toHaveBeenCalledTimes(1)
    expect(mockOpikTrace).toHaveBeenCalledWith(
      expect.objectContaining({ name: "opencode-E2E Session" }),
    )

    // 2. LLM input → LLM Span created
    service.handleLlmInput({
      sessionID: "sess-1",
      model: { providerID: "anthropic", modelID: "claude-4" },
      message: { content: "Hello, how are you?" },
    })
    expect(service.getMetrics().spansCreated).toBe(1)

    // 3. LLM output → LLM Span closed + usage accumulated
    service.handleLlmOutput({
      sessionID: "sess-1",
      content: "I am doing well, thanks!",
      modelID: "claude-4",
      tokens: { input: 10, output: 8, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    expect(service.getMetrics().spansClosed).toBe(1)

    // 4. Tool before → Tool Span created
    service.handleToolBefore({
      tool: "bash",
      sessionID: "sess-1",
      callID: "call-1",
      args: { command: "ls -la" },
    })
    expect(service.getMetrics().spansCreated).toBe(2)

    // 5. Tool after → Tool Span closed
    service.handleToolAfter({
      tool: "bash",
      sessionID: "sess-1",
      callID: "call-1",
      output: "file1.txt\nfile2.ts",
      title: "bash",
    })
    expect(service.getMetrics().spansClosed).toBe(2)

    // 6. Session idle → Trace finalized via queueMicrotask
    service.handleSessionIdle({ sessionID: "sess-1" })

    // Before microtask: trace still exists (queueMicrotask hasn't run yet)
    // After microtask: trace finalized
    await flushMicrotasks()

    expect(service.getActiveTraceCount()).toBe(0)

    // 7. Verify final metrics
    const metrics = service.getMetrics()
    expect(metrics.tracesCreated).toBe(1)
    expect(metrics.tracesFinalized).toBe(1)
    expect(metrics.spansCreated).toBe(2) // 1 LLM + 1 tool
    expect(metrics.spansClosed).toBe(2) // both closed normally
    expect(metrics.flushSuccesses).toBe(2) // 1 eager flush (LLM output) + 1 root idle → flush
    expect(metrics.flushFailures).toBe(0)
    expect(metrics.errors).toBe(0)
  })

  it("should pass accumulated usage and lastOutput to trace.update on finalize", async () => {
    service.handleSessionCreated({
      sessionID: "sess-out",
      info: { id: "sess-out", title: "Output Test" },
    })

    service.handleLlmInput({
      sessionID: "sess-out",
      model: { providerID: "anthropic", modelID: "claude-4" },
      message: { content: "Question" },
    })

    service.handleLlmOutput({
      sessionID: "sess-out",
      content: "Final answer here",
      modelID: "claude-4",
      tokens: { input: 5, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    })

    service.handleSessionIdle({ sessionID: "sess-out" })
    await flushMicrotasks()

    // Get the trace mock that was created
    const traceMock = mockOpikTrace.mock.results[0]!.value
    expect(traceMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        output: { response: "Final answer here" },
        metadata: expect.objectContaining({
          usage: { input: 5, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
          totalTokens: 15,
        }),
      }),
    )
    expect(traceMock.end).toHaveBeenCalled()
  })
})

// ─── Multiagent: parent + 2 child sessions ─────────────────────────────────

describe("E2E: Multiagent parent + 2 child sessions", () => {
  let service: OpikService

  beforeEach(async () => {
    vi.useFakeTimers()
    resetMocks()
    service = new OpikService()
    await service.start({
      projectName: "e2e-multiagent",
      sanitizePayloads: false,
      flushRetries: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should manage full multiagent lifecycle: parent + 2 children with proper nesting", async () => {
    // Parent session → creates Trace
    service.handleSessionCreated({
      sessionID: "parent",
      info: { id: "parent", title: "Parent Agent" },
    })
    expect(service.getActiveTraceCount()).toBe(1)

    // Child 1 → creates subagent Span on parent's Trace
    service.handleSessionCreated({
      sessionID: "child-1",
      info: { id: "child-1", parentID: "parent", title: "Research Agent" },
    })
    expect(service.getActiveTraceCount()).toBe(2)

    // Child 2 → creates another subagent Span on parent's Trace
    service.handleSessionCreated({
      sessionID: "child-2",
      info: { id: "child-2", parentID: "parent", title: "Code Agent" },
    })
    expect(service.getActiveTraceCount()).toBe(3)

    // Verify: only 1 trace created, 2 subagent spans
    expect(service.getMetrics().tracesCreated).toBe(1)
    expect(service.getMetrics().spansCreated).toBe(2)

    // Child 1 does LLM work
    service.handleLlmInput({
      sessionID: "child-1",
      model: { providerID: "anthropic", modelID: "claude-4" },
      message: { content: "Research this topic" },
    })
    service.handleLlmOutput({
      sessionID: "child-1",
      content: "Research results...",
      tokens: { input: 20, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
    })

    // Child 2 does tool work
    service.handleToolBefore({
      tool: "write",
      sessionID: "child-2",
      callID: "write-1",
      args: { path: "src/main.ts", content: "code..." },
    })
    service.handleToolAfter({
      tool: "write",
      sessionID: "child-2",
      callID: "write-1",
      output: "File written",
      title: "write",
    })

    // Child 1 finishes (idle) → closes subagent span, no flush
    service.handleSessionIdle({ sessionID: "child-1" })
    await flushMicrotasks()
    expect(service.getActiveTraceCount()).toBe(2) // parent + child-2 remain
    expect(service.getMetrics().flushSuccesses).toBe(1) // 1 eager flush from child-1's LLM output

    // Child 2 finishes (idle) → closes subagent span, no flush
    service.handleSessionIdle({ sessionID: "child-2" })
    await flushMicrotasks()
    expect(service.getActiveTraceCount()).toBe(1) // only parent remains
    expect(service.getMetrics().flushSuccesses).toBe(1) // still just the eager flush

    // Parent finishes (idle) → finalizes trace + flush
    service.handleSessionIdle({ sessionID: "parent" })
    await flushMicrotasks()
    expect(service.getActiveTraceCount()).toBe(0)

    // Final metrics check
    const m = service.getMetrics()
    expect(m.tracesCreated).toBe(1)
    expect(m.tracesFinalized).toBe(1)
    // spansCreated: 2 subagent + 1 LLM + 1 tool = 4
    expect(m.spansCreated).toBe(4)
    // spansClosed: 1 LLM + 1 tool + 2 subagent on child idle = 4
    expect(m.spansClosed).toBe(4)
    expect(m.flushSuccesses).toBe(2) // 1 eager flush (child-1 LLM output) + 1 parent idle flush
    expect(m.errors).toBe(0)
  })

  it("should handle orphan child session (parent not found)", () => {
    service.handleSessionCreated({
      sessionID: "orphan-child",
      info: { id: "orphan-child", parentID: "nonexistent-parent", title: "Orphan" },
    })

    expect(service.getActiveTraceCount()).toBe(0)
    expect(service.getMetrics().tracesCreated).toBe(0)
    expect(service.getMetrics().spansCreated).toBe(0)
  })
})

// ─── Grandchild (3-level nesting) ──────────────────────────────────────────

describe("E2E: Grandchild 3-level nesting", () => {
  let service: OpikService

  beforeEach(async () => {
    vi.useFakeTimers()
    resetMocks()
    service = new OpikService()
    await service.start({
      projectName: "e2e-nesting",
      sanitizePayloads: false,
      flushRetries: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should nest grandchild under child's parentSpan, not root trace", async () => {
    // Root → Trace
    service.handleSessionCreated({
      sessionID: "root",
      info: { id: "root", title: "Root" },
    })

    // Child → subagent span on root trace
    service.handleSessionCreated({
      sessionID: "child",
      info: { id: "child", parentID: "root", title: "Child" },
    })

    // Grandchild → subagent span on child's parentSpan (not root trace)
    service.handleSessionCreated({
      sessionID: "grandchild",
      info: { id: "grandchild", parentID: "child", title: "Grandchild" },
    })

    expect(service.getActiveTraceCount()).toBe(3)
    expect(service.getMetrics().tracesCreated).toBe(1) // only root
    expect(service.getMetrics().spansCreated).toBe(2) // child + grandchild subagent spans

    // Grandchild does LLM work
    service.handleLlmInput({
      sessionID: "grandchild",
      model: { providerID: "anthropic", modelID: "claude-4" },
      message: { content: "Deep nested question" },
    })
    service.handleLlmOutput({
      sessionID: "grandchild",
      content: "Deep answer",
      tokens: { input: 5, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
    })

    // Unwind from deepest to shallowest
    service.handleSessionIdle({ sessionID: "grandchild" })
    await flushMicrotasks()
    expect(service.getActiveTraceCount()).toBe(2)

    service.handleSessionIdle({ sessionID: "child" })
    await flushMicrotasks()
    expect(service.getActiveTraceCount()).toBe(1)

    service.handleSessionIdle({ sessionID: "root" })
    await flushMicrotasks()
    expect(service.getActiveTraceCount()).toBe(0)

    const m = service.getMetrics()
    expect(m.tracesCreated).toBe(1)
    expect(m.tracesFinalized).toBe(1)
    // spansCreated: 2 subagent + 1 LLM = 3
    expect(m.spansCreated).toBe(3)
    // spansClosed: 1 LLM + 2 subagent (on child idle events) = 3
    expect(m.spansClosed).toBe(3)
  })
})

// ─── Flush retry scenarios ─────────────────────────────────────────────────

describe("E2E: Flush retry scenarios", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("should retry flush once and succeed", async () => {
    resetMocks()
    // Fail once, then succeed
    mockFlush
      .mockRejectedValueOnce(new Error("transient network error"))
      .mockResolvedValue(undefined)

    const service = new OpikService()
    vi.useFakeTimers()
    await service.start({
      projectName: "e2e-retry",
      flushRetries: 2,
      flushRetryBaseDelay: 1, // minimal delay for test speed
      flushRetryMaxDelay: 10,
    })

    service.handleSessionCreated({
      sessionID: "retry-sess",
      info: { id: "retry-sess", title: "Retry Test" },
    })

    service.handleSessionIdle({ sessionID: "retry-sess" })

    // Switch to real timers so sleep() in flushWithRetry works,
    // then use real setTimeout to flush the microtask + wait for retry
    vi.useRealTimers()
    await new Promise((resolve) => setTimeout(resolve, 200))

    const m = service.getMetrics()
    expect(m.flushSuccesses).toBe(1)
    expect(m.flushFailures).toBe(0)
    expect(m.tracesFinalized).toBe(1)
  })

  it("should record flushFailure when all retries are exhausted", async () => {
    resetMocks()
    mockFlush.mockRejectedValue(new Error("persistent failure"))

    const service = new OpikService()
    vi.useFakeTimers()
    await service.start({
      projectName: "e2e-fail",
      flushRetries: 1, // 2 total attempts
      flushRetryBaseDelay: 1,
      flushRetryMaxDelay: 10,
    })

    service.handleSessionCreated({
      sessionID: "fail-sess",
      info: { id: "fail-sess", title: "Fail Test" },
    })

    service.handleSessionIdle({ sessionID: "fail-sess" })

    // Switch to real timers so sleep() in flushWithRetry works
    vi.useRealTimers()
    await new Promise((resolve) => setTimeout(resolve, 300))

    const m = service.getMetrics()
    expect(m.flushFailures).toBe(1)
    expect(m.flushSuccesses).toBe(0)
    expect(m.tracesFinalized).toBe(1) // trace was finalized, flush failed
  })
})

// ─── Trace expiry via timer ────────────────────────────────────────────────

describe("E2E: Trace expiry via cleanup timer", () => {
  let service: OpikService

  beforeEach(async () => {
    vi.useFakeTimers()
    resetMocks()
    service = new OpikService()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should auto-expire inactive traces after threshold", async () => {
    await service.start({
      projectName: "e2e-expire",
      traceExpireMinutes: 1, // 1 minute for faster test
      expireScanInterval: 500, // scan every 500ms
    })

    service.handleSessionCreated({
      sessionID: "will-expire",
      info: { id: "will-expire", title: "Expirable" },
    })
    expect(service.getActiveTraceCount()).toBe(1)

    // Advance past expiry threshold (1 minute) + scan interval
    vi.advanceTimersByTime(1 * 60 * 1000 + 600)

    expect(service.getActiveTraceCount()).toBe(0)
    expect(service.getMetrics().tracesExpired).toBe(1)

    // Verify trace.update was called with expired metadata
    const traceMock = mockOpikTrace.mock.results[0]!.value
    expect(traceMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ expired: true }),
      }),
    )
    expect(traceMock.end).toHaveBeenCalled()
  })

  it("should NOT expire traces within threshold", async () => {
    await service.start({
      projectName: "e2e-active",
      traceExpireMinutes: 5,
      expireScanInterval: 500,
    })

    service.handleSessionCreated({
      sessionID: "still-active",
      info: { id: "still-active", title: "Active" },
    })

    // Advance only 2 minutes (under 5-minute threshold)
    vi.advanceTimersByTime(2 * 60 * 1000 + 600)

    expect(service.getActiveTraceCount()).toBe(1)
    expect(service.getMetrics().tracesExpired).toBe(0)
  })

  it("should expire child session trace with parentSpan metadata", async () => {
    await service.start({
      projectName: "e2e-expire-child",
      traceExpireMinutes: 1,
      expireScanInterval: 500,
    })

    // Create parent + child
    service.handleSessionCreated({
      sessionID: "parent-exp",
      info: { id: "parent-exp", title: "Parent" },
    })
    service.handleSessionCreated({
      sessionID: "child-exp",
      info: { id: "child-exp", parentID: "parent-exp", title: "Child" },
    })
    expect(service.getActiveTraceCount()).toBe(2)

    // Advance past expiry
    vi.advanceTimersByTime(1 * 60 * 1000 + 600)

    // Both should be expired
    expect(service.getActiveTraceCount()).toBe(0)
    expect(service.getMetrics().tracesExpired).toBe(2)
  })
})

// ─── stop() finalizes all in-flight traces ─────────────────────────────────

describe("E2E: stop() finalizes all in-flight traces", () => {
  let service: OpikService

  beforeEach(async () => {
    vi.useFakeTimers()
    resetMocks()
    service = new OpikService()
    await service.start({ projectName: "e2e-stop", flushRetries: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should close all active traces, spans, and flush on stop()", async () => {
    // Create 3 independent root sessions
    service.handleSessionCreated({
      sessionID: "stop-1",
      info: { id: "stop-1", title: "Session 1" },
    })
    service.handleSessionCreated({
      sessionID: "stop-2",
      info: { id: "stop-2", title: "Session 2" },
    })
    service.handleSessionCreated({
      sessionID: "stop-3",
      info: { id: "stop-3", title: "Session 3" },
    })
    expect(service.getActiveTraceCount()).toBe(3)

    // One has an active LLM span (not yet closed)
    service.handleLlmInput({
      sessionID: "stop-1",
      model: { providerID: "anthropic", modelID: "claude-4" },
      message: { content: "In-progress question" },
    })

    // One has an active tool span
    service.handleToolBefore({
      tool: "read",
      sessionID: "stop-2",
      callID: "read-1",
      args: { path: "file.ts" },
    })

    // Force stop
    await service.stop()

    expect(service.getActiveTraceCount()).toBe(0)
    expect(service.isStarted()).toBe(false)
    expect(mockFlush).toHaveBeenCalled()

    // Each trace should have had .end() called
    for (const result of mockOpikTrace.mock.results) {
      expect(result.value.end).toHaveBeenCalled()
    }
  })

  it("should handle stop() with multiagent sessions — closes parent spans and root trace", async () => {
    service.handleSessionCreated({
      sessionID: "parent-stop",
      info: { id: "parent-stop", title: "Parent" },
    })
    service.handleSessionCreated({
      sessionID: "child-stop",
      info: { id: "child-stop", parentID: "parent-stop", title: "Child" },
    })
    expect(service.getActiveTraceCount()).toBe(2)

    await service.stop()
    expect(service.getActiveTraceCount()).toBe(0)
    expect(mockFlush).toHaveBeenCalled()
  })
})

// ─── Tool sessionID fallback ───────────────────────────────────────────────

describe("E2E: Tool sessionID fallback", () => {
  let service: OpikService

  beforeEach(async () => {
    vi.useFakeTimers()
    resetMocks()
    service = new OpikService()
    await service.start({
      projectName: "e2e-fallback",
      sanitizePayloads: false,
      flushRetries: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should fall back to single active trace when sessionID is empty", () => {
    service.handleSessionCreated({
      sessionID: "session-x",
      info: { id: "session-x", title: "Fallback Session" },
    })

    // Tool events with empty sessionID → falls back to single active trace
    service.handleToolBefore({
      tool: "read",
      sessionID: "",
      callID: "c1",
      args: { path: "test.ts" },
    })

    expect(service.getMetrics().spansCreated).toBe(1)

    service.handleToolAfter({
      tool: "read",
      sessionID: "",
      callID: "c1",
      output: "file content",
      title: "read",
    })

    expect(service.getMetrics().spansClosed).toBe(1)
  })

  it("should fall back to most recently active trace when multiple active", () => {
    service.handleSessionCreated({
      sessionID: "old-sess",
      info: { id: "old-sess", title: "Old" },
    })
    service.handleSessionCreated({
      sessionID: "new-sess",
      info: { id: "new-sess", title: "New" },
    })

    // Touch "new-sess" more recently via LLM
    service.handleLlmInput({
      sessionID: "new-sess",
      model: { providerID: "anthropic", modelID: "claude-4" },
      message: { content: "Hello" },
    })

    // Tool with unknown sessionID → should resolve to most recently active
    service.handleToolBefore({
      tool: "bash",
      sessionID: "unknown-session",
      callID: "fallback-call",
      args: { command: "echo hi" },
    })

    // If we got here without error, the fallback worked
    // spansCreated: 2 (LLM on new-sess + tool via fallback)
    expect(service.getMetrics().spansCreated).toBe(2)
  })

  it("should skip when no tool span found for callID on after", () => {
    service.handleSessionCreated({
      sessionID: "sess-y",
      info: { id: "sess-y", title: "Warn Test" },
    })

    // tool.after without matching tool.before
    service.handleToolAfter({
      tool: "bash",
      sessionID: "sess-y",
      callID: "nonexistent-call-id",
      output: "result",
      title: "bash",
    })

    expect(service.getMetrics().spansClosed).toBe(0) // no span was closed
  })
})

// ─── Token usage accumulation ──────────────────────────────────────────────

describe("E2E: Token usage accumulation across multiple LLM turns", () => {
  let service: OpikService

  beforeEach(async () => {
    vi.useFakeTimers()
    resetMocks()
    service = new OpikService()
    await service.start({
      projectName: "e2e-tokens",
      sanitizePayloads: false,
      flushRetries: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should aggregate token usage across 3 LLM turns and report on trace finalize", async () => {
    service.handleSessionCreated({
      sessionID: "multi-llm",
      info: { id: "multi-llm", title: "Multi-turn" },
    })

    // Turn 1
    service.handleLlmInput({
      sessionID: "multi-llm",
      model: { providerID: "anthropic", modelID: "claude-4" },
      message: { content: "First question" },
    })
    service.handleLlmOutput({
      sessionID: "multi-llm",
      content: "First answer",
      tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
    })

    // Turn 2
    service.handleLlmInput({
      sessionID: "multi-llm",
      model: { providerID: "anthropic", modelID: "claude-4" },
      message: { content: "Second question" },
    })
    service.handleLlmOutput({
      sessionID: "multi-llm",
      content: "Second answer",
      tokens: { input: 15, output: 25, reasoning: 0, cache: { read: 0, write: 0 } },
    })

    // Turn 3
    service.handleLlmInput({
      sessionID: "multi-llm",
      model: { providerID: "anthropic", modelID: "claude-4" },
      message: { content: "Third question" },
    })
    service.handleLlmOutput({
      sessionID: "multi-llm",
      content: "Third answer — the final one",
      tokens: { input: 20, output: 30, reasoning: 0, cache: { read: 0, write: 0 } },
    })

    // Finalize
    service.handleSessionIdle({ sessionID: "multi-llm" })
    await flushMicrotasks()

    // Verify aggregated usage: 10+15+20=45 input, 20+25+30=75 output, total=120
    const traceMock = mockOpikTrace.mock.results[0]!.value
    expect(traceMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        output: { response: "Third answer — the final one" },
        metadata: expect.objectContaining({
          usage: { input: 45, output: 75, reasoning: 0, cache: { read: 0, write: 0 } },
          totalTokens: 120,
        }),
      }),
    )

    const m = service.getMetrics()
    expect(m.spansCreated).toBe(3) // 3 LLM spans
    expect(m.spansClosed).toBe(3) // all 3 closed
    expect(m.tracesCreated).toBe(1)
    expect(m.tracesFinalized).toBe(1)
  })
})

// ─── Multiple concurrent independent sessions ─────────────────────────────

describe("E2E: Multiple concurrent independent root sessions", () => {
  let service: OpikService

  beforeEach(async () => {
    vi.useFakeTimers()
    resetMocks()
    service = new OpikService()
    await service.start({
      projectName: "e2e-concurrent",
      sanitizePayloads: false,
      flushRetries: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should manage multiple independent sessions without cross-contamination", async () => {
    // Create 2 independent root sessions
    service.handleSessionCreated({
      sessionID: "alpha",
      info: { id: "alpha", title: "Alpha Session" },
    })
    service.handleSessionCreated({
      sessionID: "beta",
      info: { id: "beta", title: "Beta Session" },
    })
    expect(service.getActiveTraceCount()).toBe(2)
    expect(service.getMetrics().tracesCreated).toBe(2)

    // Alpha does LLM
    service.handleLlmInput({
      sessionID: "alpha",
      model: { providerID: "anthropic", modelID: "claude-4" },
      message: { content: "Alpha question" },
    })
    service.handleLlmOutput({
      sessionID: "alpha",
      content: "Alpha answer",
      tokens: { input: 5, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    })

    // Beta does tool
    service.handleToolBefore({
      tool: "search",
      sessionID: "beta",
      callID: "search-1",
      args: { query: "test" },
    })
    service.handleToolAfter({
      tool: "search",
      sessionID: "beta",
      callID: "search-1",
      output: ["result1", "result2"],
      title: "search",
    })

    // Alpha finishes first
    service.handleSessionIdle({ sessionID: "alpha" })
    await flushMicrotasks()
    expect(service.getActiveTraceCount()).toBe(1) // only beta remains

    // Beta finishes
    service.handleSessionIdle({ sessionID: "beta" })
    await flushMicrotasks()
    expect(service.getActiveTraceCount()).toBe(0)

    const m = service.getMetrics()
    expect(m.tracesCreated).toBe(2)
    expect(m.tracesFinalized).toBe(2)
    expect(m.spansCreated).toBe(2) // 1 LLM + 1 tool
    expect(m.spansClosed).toBe(2)
    expect(m.flushSuccesses).toBe(3) // 1 eager flush (alpha LLM output) + 2 root idle flushes
  })
})

// ─── Session idle closes remaining tool spans ──────────────────────────────

describe("E2E: Session idle closes remaining open tool spans", () => {
  let service: OpikService

  beforeEach(async () => {
    vi.useFakeTimers()
    resetMocks()
    service = new OpikService()
    await service.start({
      projectName: "e2e-cleanup",
      sanitizePayloads: false,
      flushRetries: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should close orphaned tool spans when session goes idle", async () => {
    service.handleSessionCreated({
      sessionID: "leaky",
      info: { id: "leaky", title: "Leaky Session" },
    })

    // Start 2 tool spans, but only close 1
    service.handleToolBefore({
      tool: "read",
      sessionID: "leaky",
      callID: "read-1",
      args: { path: "a.ts" },
    })
    service.handleToolBefore({
      tool: "write",
      sessionID: "leaky",
      callID: "write-1",
      args: { path: "b.ts" },
    })
    expect(service.getMetrics().spansCreated).toBe(2)

    // Only close the first one normally
    service.handleToolAfter({
      tool: "read",
      sessionID: "leaky",
      callID: "read-1",
      output: "content",
      title: "read",
    })
    expect(service.getMetrics().spansClosed).toBe(1)

    // Session idle → should close the remaining orphaned write span
    service.handleSessionIdle({ sessionID: "leaky" })
    await flushMicrotasks()

    // spansClosed: 1 (normal close) + 1 (orphan cleanup in idle) = 2
    // plus the trace itself gets tracesFinalized++
    expect(service.getMetrics().spansClosed).toBe(2)
    expect(service.getMetrics().tracesFinalized).toBe(1)
    expect(service.getActiveTraceCount()).toBe(0)
  })
})

// ─── Events on non-existent sessions ───────────────────────────────────────

describe("E2E: Events on non-existent sessions", () => {
  let service: OpikService

  beforeEach(async () => {
    vi.useFakeTimers()
    resetMocks()
    service = new OpikService()
    await service.start({
      projectName: "e2e-ghost",
      sanitizePayloads: false,
      flushRetries: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should silently skip LLM events for unknown sessionID", () => {
    service.handleLlmInput({
      sessionID: "ghost",
      message: { content: "Hello?" },
    })
    service.handleLlmOutput({
      sessionID: "ghost",
      content: "Nobody home",
    })

    // No spans created, no errors
    const m = service.getMetrics()
    expect(m.spansCreated).toBe(0)
    expect(m.spansClosed).toBe(0)
    expect(m.errors).toBe(0)
  })

  it("should silently skip session.idle for unknown sessionID", async () => {
    service.handleSessionIdle({ sessionID: "ghost-idle" })
    await flushMicrotasks()

    expect(service.getMetrics().tracesFinalized).toBe(0)
    expect(service.getMetrics().errors).toBe(0)
  })
})

// ─── Tool error handling ───────────────────────────────────────────────────

describe("E2E: Tool error output", () => {
  let service: OpikService

  beforeEach(async () => {
    vi.useFakeTimers()
    resetMocks()
    service = new OpikService()
    await service.start({
      projectName: "e2e-tool-error",
      sanitizePayloads: false,
      flushRetries: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should record tool error in span metadata", () => {
    service.handleSessionCreated({
      sessionID: "err-sess",
      info: { id: "err-sess", title: "Error Test" },
    })

    service.handleToolBefore({
      tool: "bash",
      sessionID: "err-sess",
      callID: "err-call",
      args: { command: "rm -rf /" },
    })

    service.handleToolAfter({
      tool: "bash",
      sessionID: "err-sess",
      callID: "err-call",
      output: "Permission denied",
      title: "bash",
      metadata: { exitCode: 1 },
    })

    expect(service.getMetrics().spansCreated).toBe(1)
    expect(service.getMetrics().spansClosed).toBe(1)
  })
})

// ─── Idempotent start/stop ─────────────────────────────────────────────────

describe("E2E: Idempotent lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("should handle rapid start/stop/start/stop cycles", async () => {
    vi.useFakeTimers()
    resetMocks()

    const service = new OpikService()
    await service.start({ projectName: "cycle-1", flushRetries: 0 })
    expect(service.isStarted()).toBe(true)
    await service.stop()
    expect(service.isStarted()).toBe(false)

    // Restart
    await service.start({ projectName: "cycle-2", flushRetries: 0 })
    expect(service.isStarted()).toBe(true)

    // Use it
    service.handleSessionCreated({
      sessionID: "cycle-sess",
      info: { id: "cycle-sess", title: "Cycle" },
    })
    expect(service.getActiveTraceCount()).toBe(1)

    await service.stop()
    expect(service.getActiveTraceCount()).toBe(0)
    expect(service.isStarted()).toBe(false)
  })
})
