/**
 * Unit tests for Tool hooks (tool.execute.before / tool.execute.after).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { onToolBefore, onToolAfter, type ToolHookDeps } from "../tool.js"
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
    metadata: {},
    streamingText: "",
    llmTurnCount: 0,
    ...overrides,
  }
}

describe("onToolBefore", () => {
  let deps: ToolHookDeps
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

  it("should create a tool span", () => {
    const active = createMockActiveTrace()
    deps.activeTraces.set("session-1", active)

    onToolBefore(
      {
        tool: "bash",
        sessionID: "session-1",
        callID: "call-1",
        args: { command: "ls" },
      },
      deps,
    )

    expect(active.trace.span).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "tool:bash",
        type: "tool",
      }),
    )
    expect(active.toolSpans.has("call-1")).toBe(true)
    expect(metrics.spansCreated).toBe(1)
  })

  it("should fall back to single active trace when sessionID is missing", () => {
    const active = createMockActiveTrace()
    deps.activeTraces.set("session-1", active)

    onToolBefore(
      {
        tool: "read",
        sessionID: "", // empty
        callID: "call-2",
        args: { filePath: "/foo" },
      },
      deps,
    )

    expect(active.toolSpans.has("call-2")).toBe(true)
  })
})

describe("onToolAfter", () => {
  let deps: ToolHookDeps
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

  it("should update and close the tool span", () => {
    const toolSpan = createMockSpan()
    const active = createMockActiveTrace()
    active.toolSpans.set("call-1", toolSpan)
    deps.activeTraces.set("session-1", active)

    onToolAfter(
      {
        tool: "bash",
        sessionID: "session-1",
        callID: "call-1",
        args: { command: "ls" },
        title: "bash",
        output: "file1.txt\nfile2.txt",
      },
      deps,
    )

    expect(toolSpan.update).toHaveBeenCalled()
    expect(toolSpan.end).toHaveBeenCalled()
    expect(active.toolSpans.has("call-1")).toBe(false)
    expect(metrics.spansClosed).toBe(1)
  })

  it("should store output as result even when empty", () => {
    const toolSpan = createMockSpan()
    const active = createMockActiveTrace()
    active.toolSpans.set("call-empty", toolSpan)
    deps.activeTraces.set("session-1", active)

    onToolAfter(
      {
        tool: "bash",
        sessionID: "session-1",
        callID: "call-empty",
        output: "",
      },
      deps,
    )

    expect(toolSpan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        output: { result: "" },
      }),
    )
  })
})
