/**
 * Unit tests for Session hooks (session.created / session.idle).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  onSessionCreated,
  onSessionIdle,
  type SessionHookDeps,
} from "../session.js"
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

function createMockOpikClient() {
  return {
    trace: vi.fn(() => createMockTrace()),
    flush: vi.fn(),
  }
}

function createMockActiveTrace(
  overrides?: Partial<ActiveTrace>,
): ActiveTrace {
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
    metadata: {},
    streamingText: "",
    llmTurnCount: 0,
    ...overrides,
  }
}

// Helper: flush microtask queue so queueMicrotask callbacks execute
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ─── onSessionCreated ───────────────────────────────────────────────────────

describe("onSessionCreated", () => {
  let deps: SessionHookDeps
  let metrics: ExporterMetrics
  let opikClient: ReturnType<typeof createMockOpikClient>

  beforeEach(() => {
    metrics = createInitialMetrics()
    opikClient = createMockOpikClient()
    deps = {
      opikClient,
      activeTraces: new Map(),
      subagentSpanHosts: new Map(),
      metrics,
      projectName: "test-project",
      onFlush: vi.fn().mockResolvedValue(undefined),
    }
  })

  it("should create a root Trace for a session without parentID", () => {
    onSessionCreated(
      {
        sessionID: "root-1",
        info: { id: "session-id", title: "My Session" },
      },
      deps,
    )

    expect(opikClient.trace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "opencode-My Session",
        threadId: "root-1",
        projectName: "test-project",
        metadata: expect.objectContaining({
          sessionID: "root-1",
          source: "opik-opencode",
        }),
      }),
    )
    expect(deps.activeTraces.has("root-1")).toBe(true)
    expect(deps.activeTraces.get("root-1")!.parentSpan).toBeNull()
    expect(metrics.tracesCreated).toBe(1)
  })

  it("should fall back to sessionID when title is not provided", () => {
    onSessionCreated(
      {
        sessionID: "root-3",
        info: { id: "session-id" },
      },
      deps,
    )

    expect(opikClient.trace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "opencode-root-3",
      }),
    )
  })

  it("should create a Subagent Span for a child session with parentID", () => {
    // First, create a root session
    const parentTrace = createMockTrace()
    const parentActive = createMockActiveTrace({
      trace: parentTrace,
    })
    deps.activeTraces.set("parent-1", parentActive)

    // Now create a child session
    onSessionCreated(
      {
        sessionID: "child-1",
        info: { id: "child-1", parentID: "parent-1", title: "Child Agent" },
      },
      deps,
    )

    // Should have created a subagent span on the parent's trace
    expect(parentTrace.span).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "subagent:Child Agent",
        type: "general",
        startTime: expect.any(Date),
        metadata: expect.objectContaining({
          childSessionID: "child-1",
          parentSessionID: "parent-1",
          spanRole: "agent",
        }),
      }),
    )

    // Child should share the parent's root trace
    const childActive = deps.activeTraces.get("child-1")!
    expect(childActive).toBeDefined()
    expect(childActive.trace).toBe(parentTrace) // shared reference
    expect(childActive.parentSpan).not.toBeNull()

    // Parent should track the child
    expect(parentActive.subagentSpans.has("child-1")).toBe(true)

    // Counts: spansCreated (not tracesCreated) for child
    expect(metrics.spansCreated).toBe(1)
    expect(metrics.tracesCreated).toBe(0)
  })

  it("should nest child under parentSpan when parent is itself a child", () => {
    // Simulate a grandparent → parent → child chain
    const rootTrace = createMockTrace()
    const parentSubagentSpan = createMockSpan()

    // Parent is already a child session with its own parentSpan
    const parentActive = createMockActiveTrace({
      trace: rootTrace,
      parentSpan: parentSubagentSpan, // parent is a child
    })
    deps.activeTraces.set("parent-child", parentActive)

    onSessionCreated(
      {
        sessionID: "grandchild-1",
        info: { id: "grandchild-1", parentID: "parent-child", title: "Grandchild Agent" },
      },
      deps,
    )

    // Should anchor on parentSubagentSpan (not rootTrace)
    expect(parentSubagentSpan.span).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "subagent:Grandchild Agent",
        type: "general",
        startTime: expect.any(Date),
      }),
    )
    expect(rootTrace.span).not.toHaveBeenCalled()
  })

  it("should warn and return when parentID has no matching active trace", () => {
    const consoleSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {})

    onSessionCreated(
      {
        sessionID: "orphan-1",
        info: { id: "orphan-1", parentID: "nonexistent-parent" },
      },
      deps,
    )

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("no active parent trace found"),
    )
    expect(deps.activeTraces.has("orphan-1")).toBe(false)
    expect(metrics.tracesCreated).toBe(0)
    expect(metrics.spansCreated).toBe(0)

    consoleSpy.mockRestore()
  })

  it("should register child session in subagentSpanHosts bridge", () => {
    const parentTrace = createMockTrace()
    const parentActive = createMockActiveTrace({ trace: parentTrace })
    deps.activeTraces.set("parent-1", parentActive)

    onSessionCreated(
      {
        sessionID: "child-bridge",
        info: { id: "child-bridge", parentID: "parent-1", title: "Bridged Child" },
      },
      deps,
    )

    expect(deps.subagentSpanHosts.has("child-bridge")).toBe(true)
    const host = deps.subagentSpanHosts.get("child-bridge")!
    expect(host.hostSessionID).toBe("parent-1")
    // After the fix, subagentSpanHosts stores the CHILD's ActiveTrace (not parent's)
    const childActive = deps.activeTraces.get("child-bridge")!
    expect(host.active).toBe(childActive)
  })

  it("should initialize ActiveTrace with correct default values", () => {
    onSessionCreated(
      {
        sessionID: "root-init",
        info: { id: "session-id", title: "Init Test" },
      },
      deps,
    )

    const active = deps.activeTraces.get("root-init")!
    expect(active.currentSpan).toBeNull()
    expect(active.parentSpan).toBeNull()
    expect(active.toolSpans.size).toBe(0)
    expect(active.subagentSpans.size).toBe(0)
    expect(active.usage).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    })
    expect(active.llmTurnCount).toBe(0)
    expect(active.metadata).toEqual(
      expect.objectContaining({ sessionID: "root-init" }),
    )
  })
})

// ─── onSessionIdle ──────────────────────────────────────────────────────────

describe("onSessionIdle", () => {
  let deps: SessionHookDeps
  let metrics: ExporterMetrics
  let opikClient: ReturnType<typeof createMockOpikClient>

  beforeEach(() => {
    metrics = createInitialMetrics()
    opikClient = createMockOpikClient()
    deps = {
      opikClient,
      activeTraces: new Map(),
      subagentSpanHosts: new Map(),
      metrics,
      projectName: "test-project",
      onFlush: vi.fn().mockResolvedValue(undefined),
    }
  })

  it("should do nothing if no active trace exists for sessionID", async () => {
    onSessionIdle({ sessionID: "unknown" }, deps)
    await flushMicrotasks()
    expect(metrics.tracesFinalized).toBe(0)
    expect(metrics.spansClosed).toBe(0)
  })

  it("should finalize root session trace via queueMicrotask", async () => {
    const trace = createMockTrace()
    const active = createMockActiveTrace({
      trace,
      lastOutput: "Final response",
      usage: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      metadata: { sessionID: "root-1" },
    })
    deps.activeTraces.set("root-1", active)

    onSessionIdle({ sessionID: "root-1" }, deps)

    // Before microtask runs, trace should still be active
    expect(deps.activeTraces.has("root-1")).toBe(true)

    await flushMicrotasks()

    // After microtask: trace should be updated, ended, flushed, and removed
    expect(trace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        output: { response: "Final response" },
        metadata: expect.objectContaining({
          usage: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          totalTokens: 150,
        }),
      }),
    )
    expect(trace.end).toHaveBeenCalled()
    expect(deps.onFlush).toHaveBeenCalled()
    expect(deps.activeTraces.has("root-1")).toBe(false)
    expect(metrics.tracesFinalized).toBe(1)
  })

  it("should close child session subagent span without closing root trace", async () => {
    const rootTrace = createMockTrace()
    const parentSpan = createMockSpan()
    const childActive = createMockActiveTrace({
      trace: rootTrace,
      parentSpan,
      lastOutput: "Child output",
      usage: { input: 20, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    deps.activeTraces.set("child-1", childActive)

    onSessionIdle({ sessionID: "child-1" }, deps)
    await flushMicrotasks()

    // parentSpan should be updated and ended
    expect(parentSpan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        output: { response: "Child output" },
        metadata: {
          usage: { input: 20, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
          totalTokens: 30,
        },
      }),
    )
    expect(parentSpan.end).toHaveBeenCalled()

    // Root trace should NOT be closed (parent is responsible)
    expect(rootTrace.update).not.toHaveBeenCalled()
    expect(rootTrace.end).not.toHaveBeenCalled()

    // Child should be removed, onFlush should NOT be called for child
    expect(deps.activeTraces.has("child-1")).toBe(false)
    expect(deps.onFlush).not.toHaveBeenCalled()
    expect(metrics.spansClosed).toBe(1)
  })

  it("should close remaining open tool spans before finalization", async () => {
    const toolSpan1 = createMockSpan()
    const toolSpan2 = createMockSpan()
    const trace = createMockTrace()
    const active = createMockActiveTrace({ trace })
    active.toolSpans.set("call-1", toolSpan1)
    active.toolSpans.set("call-2", toolSpan2)
    deps.activeTraces.set("root-2", active)

    onSessionIdle({ sessionID: "root-2" }, deps)
    await flushMicrotasks()

    expect(toolSpan1.end).toHaveBeenCalled()
    expect(toolSpan2.end).toHaveBeenCalled()
    expect(active.toolSpans.size).toBe(0)
    // 2 tool spans + (root trace finalize doesn't increment spansClosed, it uses tracesFinalized)
    expect(metrics.spansClosed).toBe(2)
    expect(metrics.tracesFinalized).toBe(1)
  })

  it("should handle empty output gracefully", async () => {
    const trace = createMockTrace()
    const active = createMockActiveTrace({
      trace,
      lastOutput: undefined,
    })
    deps.activeTraces.set("root-empty", active)

    onSessionIdle({ sessionID: "root-empty" }, deps)
    await flushMicrotasks()

    expect(trace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        output: {}, // no lastOutput → empty object
      }),
    )
    expect(trace.end).toHaveBeenCalled()
  })

  it("should clean up subagentSpanHosts bridge on session idle", async () => {
    const rootTrace = createMockTrace()
    const parentSpan = createMockSpan()
    const childActive = createMockActiveTrace({
      trace: rootTrace,
      parentSpan,
    })
    deps.activeTraces.set("child-bridge", childActive)
    deps.subagentSpanHosts.set("child-bridge", {
      hostSessionID: "parent-1",
      active: createMockActiveTrace(),
      span: parentSpan,
    })

    onSessionIdle({ sessionID: "child-bridge" }, deps)
    await flushMicrotasks()

    expect(deps.subagentSpanHosts.has("child-bridge")).toBe(false)
  })

  it("should increment metrics.errors on finalization failure", async () => {
    const trace = createMockTrace()
    trace.end.mockImplementation(() => {
      throw new Error("end failed")
    })
    const active = createMockActiveTrace({ trace })
    deps.activeTraces.set("root-err", active)

    onSessionIdle({ sessionID: "root-err" }, deps)
    await flushMicrotasks()

    expect(metrics.errors).toBe(1)
  })
})
