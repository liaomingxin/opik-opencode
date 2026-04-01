/**
 * Unit tests for OpikService — core service lifecycle, event dispatch,
 * flush retry, and expired trace cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { OpikService } from "../service.js"
import { createInitialMetrics } from "../types.js"

// ─── Mock opik SDK ──────────────────────────────────────────────────────────

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

const mockFlush = vi.fn().mockResolvedValue(undefined)
const mockOpikTrace = vi.fn(() => createMockTrace())

vi.mock("opik", () => ({
  Opik: vi.fn().mockImplementation(() => ({
    trace: mockOpikTrace,
    flush: mockFlush,
  })),
  disableLogger: vi.fn(),
}))

// ─── Service lifecycle ──────────────────────────────────────────────────────

describe("OpikService lifecycle", () => {
  let service: OpikService

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    service = new OpikService()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should not be started initially", () => {
    expect(service.isStarted()).toBe(false)
    expect(service.getActiveTraceCount()).toBe(0)
  })

  it("should start and set started flag", async () => {
    await service.start({ apiKey: "test-key", projectName: "test" })
    expect(service.isStarted()).toBe(true)
  })

  it("should be idempotent — calling start() twice does nothing", async () => {
    await service.start({ projectName: "test" })
    await service.start({ projectName: "test" }) // no-op
    expect(service.isStarted()).toBe(true)
  })

  it("should stop cleanly", async () => {
    await service.start({ projectName: "test" })
    await service.stop()
    expect(service.isStarted()).toBe(false)
  })

  it("should be idempotent — calling stop() when not started does nothing", async () => {
    await service.stop() // no-op, should not throw
    expect(service.isStarted()).toBe(false)
  })

  it("should finalize all active traces on stop()", async () => {
    await service.start({ projectName: "test" })

    // Create a root session to have an active trace
    service.handleSessionCreated({
      sessionID: "s1",
      info: { id: "s1", title: "Session 1" },
    })
    expect(service.getActiveTraceCount()).toBe(1)

    await service.stop()

    // After stop: all traces should be cleared
    expect(service.getActiveTraceCount()).toBe(0)
    // flush should have been called during stop
    expect(mockFlush).toHaveBeenCalled()
  })
})

// ─── Event dispatch ─────────────────────────────────────────────────────────

describe("OpikService event dispatch", () => {
  let service: OpikService

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    service = new OpikService()
    await service.start({ projectName: "test", sanitizePayloads: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should create an active trace on session.created", () => {
    service.handleSessionCreated({
      sessionID: "sess-1",
      info: { id: "sess-1", title: "Test Session" },
    })

    expect(service.getActiveTraceCount()).toBe(1)
    expect(mockOpikTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "opencode-Test Session",
      }),
    )
  })

  it("should handle LLM input → LLM output cycle", () => {
    service.handleSessionCreated({
      sessionID: "sess-2",
      info: { id: "sess-2", title: "LLM Test" },
    })

    service.handleLlmInput({
      sessionID: "sess-2",
      model: { providerID: "anthropic", modelID: "claude-4" },
      message: { content: "Hello world" },
    })

    const metrics = service.getMetrics()
    expect(metrics.spansCreated).toBeGreaterThanOrEqual(1)

    service.handleLlmOutput({
      sessionID: "sess-2",
      content: "Hi there!",
      modelID: "claude-4",
      tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
    })

    const metricsAfter = service.getMetrics()
    expect(metricsAfter.spansClosed).toBeGreaterThanOrEqual(1)
  })

  it("should handle tool before → tool after cycle", () => {
    service.handleSessionCreated({
      sessionID: "sess-3",
      info: { id: "sess-3", title: "Tool Test" },
    })

    service.handleToolBefore({
      tool: "bash",
      sessionID: "sess-3",
      callID: "call-1",
      args: { command: "ls" },
    })

    const metrics = service.getMetrics()
    expect(metrics.spansCreated).toBeGreaterThanOrEqual(1)

    service.handleToolAfter({
      tool: "bash",
      sessionID: "sess-3",
      callID: "call-1",
      output: "file.txt",
      title: "bash",
    })

    const metricsAfter = service.getMetrics()
    expect(metricsAfter.spansClosed).toBeGreaterThanOrEqual(1)
  })

  it("should handle multiagent parent + child session", () => {
    // Parent session
    service.handleSessionCreated({
      sessionID: "parent-1",
      info: { id: "parent-1", title: "Parent" },
    })
    expect(service.getActiveTraceCount()).toBe(1)

    // Child session
    service.handleSessionCreated({
      sessionID: "child-1",
      info: { id: "child-1", parentID: "parent-1", title: "Child" },
    })
    expect(service.getActiveTraceCount()).toBe(2)

    const metrics = service.getMetrics()
    expect(metrics.tracesCreated).toBe(1) // only root creates trace
    expect(metrics.spansCreated).toBe(1) // child creates subagent span
  })
})

// ─── flushWithRetry ─────────────────────────────────────────────────────────

describe("OpikService flushWithRetry", () => {
  let service: OpikService

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    service = new OpikService()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should succeed on first attempt and increment flushSuccesses", async () => {
    mockFlush.mockResolvedValue(undefined)
    await service.start({
      projectName: "test",
      flushRetries: 2,
      flushRetryBaseDelay: 10,
    })

    // Trigger flush through stop()
    service.handleSessionCreated({
      sessionID: "s1",
      info: { id: "s1", title: "Test" },
    })
    await service.stop()

    const metrics = service.getMetrics()
    expect(metrics.flushSuccesses).toBeGreaterThanOrEqual(1)
    expect(metrics.flushFailures).toBe(0)
  })

  it("should retry on flush failure and eventually succeed", async () => {
    // Fail once, then succeed
    mockFlush
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue(undefined)

    await service.start({
      projectName: "test",
      flushRetries: 2,
      flushRetryBaseDelay: 10,
      flushRetryMaxDelay: 100,
    })

    service.handleSessionCreated({
      sessionID: "s1",
      info: { id: "s1", title: "Test" },
    })

    // Use real timers for the flush to work with sleep
    vi.useRealTimers()
    await service.stop()

    const metrics = service.getMetrics()
    expect(metrics.flushSuccesses).toBeGreaterThanOrEqual(1)
    expect(metrics.flushFailures).toBe(0)
  })

  it("should record flushFailure after all retries exhausted", async () => {
    const flushError = new Error("persistent failure")
    mockFlush.mockRejectedValue(flushError)

    await service.start({
      projectName: "test",
      flushRetries: 1,
      flushRetryBaseDelay: 10,
      flushRetryMaxDelay: 50,
    })

    service.handleSessionCreated({
      sessionID: "s1",
      info: { id: "s1", title: "Test" },
    })

    vi.useRealTimers()
    await service.stop()

    const metrics = service.getMetrics()
    expect(metrics.flushFailures).toBeGreaterThanOrEqual(1)
  })
})

// ─── cleanupExpiredTraces ───────────────────────────────────────────────────

describe("OpikService cleanupExpiredTraces", () => {
  let service: OpikService

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    service = new OpikService()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should expire traces after traceExpireMinutes", async () => {
    await service.start({
      projectName: "test",
      traceExpireMinutes: 5,
      expireScanInterval: 1000, // 1s scan for test speed
    })

    service.handleSessionCreated({
      sessionID: "expire-me",
      info: { id: "expire-me", title: "Will Expire" },
    })

    expect(service.getActiveTraceCount()).toBe(1)

    // Advance time past the expiry threshold (5 minutes + scan interval)
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000)

    // After cleanup runs, the trace should be expired
    expect(service.getActiveTraceCount()).toBe(0)
    const metrics = service.getMetrics()
    expect(metrics.tracesExpired).toBe(1)
  })

  it("should NOT expire traces that are still active within threshold", async () => {
    await service.start({
      projectName: "test",
      traceExpireMinutes: 5,
      expireScanInterval: 1000,
    })

    service.handleSessionCreated({
      sessionID: "active-1",
      info: { id: "active-1", title: "Still Active" },
    })

    // Advance only 2 minutes (under 5-minute threshold)
    vi.advanceTimersByTime(2 * 60 * 1000 + 1000)

    expect(service.getActiveTraceCount()).toBe(1)
    expect(service.getMetrics().tracesExpired).toBe(0)
  })
})

// ─── getMetrics / accessors ─────────────────────────────────────────────────

describe("OpikService accessors", () => {
  it("should return a copy of metrics (not a reference)", async () => {
    vi.useFakeTimers()
    const service = new OpikService()
    await service.start({ projectName: "test" })

    const metrics1 = service.getMetrics()
    const metrics2 = service.getMetrics()
    expect(metrics1).toEqual(metrics2)
    expect(metrics1).not.toBe(metrics2) // different objects

    vi.useRealTimers()
  })

  it("should report initial metrics as all zeros", () => {
    const service = new OpikService()
    const metrics = service.getMetrics()
    expect(metrics).toEqual(createInitialMetrics())
  })
})
