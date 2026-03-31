/**
 * Smoke tests for the plugin entry point (index.ts).
 *
 * Tests the public API surface — createOpikPlugin(), OpikPlugin default export,
 * handler shape, config priority, event handler extraction, and error resilience.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

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

const mockFlush = vi.fn().mockResolvedValue(undefined)
const mockOpikConstructor = vi.fn().mockImplementation(() => ({
  trace: vi.fn(() => createMockTrace()),
  flush: mockFlush,
}))

vi.mock("opik", () => ({
  Opik: mockOpikConstructor,
}))

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Flush microtasks + pending fake timers.
 *
 * session.idle uses queueMicrotask internally. With vi.useFakeTimers(),
 * we use advanceTimersByTimeAsync to process both microtasks and timers.
 */
async function flushMicrotasksWithFakeTimers(): Promise<void> {
  await vi.advanceTimersByTimeAsync(10)
}

/**
 * Invoke plugin and return handlers as `any` to access hook keys.
 */
async function getHandlers(
  createFn: Function,
  config?: Record<string, unknown>,
  pluginOptions?: Record<string, unknown>,
): Promise<any> {
  const plugin = createFn(config)
  return plugin({} as any, pluginOptions ?? {})
}

const ALL_HANDLER_KEYS = [
  "event",
  "chat.message",
  "tool.execute.before",
  "tool.execute.after",
] as const

// ─── Module import smoke tests ─────────────────────────────────────────────

describe("Smoke: Module exports", () => {
  it("should export createOpikPlugin as a function", async () => {
    const { createOpikPlugin } = await import("../../index.js")
    expect(typeof createOpikPlugin).toBe("function")
  })

  it("should export OpikPlugin as a function (Plugin type)", async () => {
    const { OpikPlugin } = await import("../../index.js")
    expect(typeof OpikPlugin).toBe("function")
  })

  it("should export OpikService class", async () => {
    const { OpikService } = await import("../../index.js")
    expect(OpikService).toBeDefined()
    expect(typeof OpikService).toBe("function") // class constructor
  })

  it("should export configure utilities", async () => {
    const mod = await import("../../index.js")
    expect(typeof mod.runOpikConfigure).toBe("function")
    expect(typeof mod.showOpikStatus).toBe("function")
    expect(typeof mod.getOpikPluginEntry).toBe("function")
    expect(typeof mod.setOpikPluginEntry).toBe("function")
  })

  it("should have default export equal to OpikPlugin", async () => {
    const mod = await import("../../index.js")
    expect(mod.default).toBe(mod.OpikPlugin)
  })
})

// ─── createOpikPlugin() returns valid Plugin ───────────────────────────────

describe("Smoke: createOpikPlugin() returns valid Plugin", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should return a function (Plugin)", async () => {
    const { createOpikPlugin } = await import("../../index.js")
    const plugin = createOpikPlugin({ projectName: "smoke-test" })
    expect(typeof plugin).toBe("function")
  })

  it("should return handlers for all 4 OpenCode handler keys when invoked", async () => {
    const { createOpikPlugin } = await import("../../index.js")
    const handlers = await getHandlers(createOpikPlugin, {
      projectName: "smoke-test",
    })

    for (const key of ALL_HANDLER_KEYS) {
      expect(typeof handlers[key]).toBe("function")
    }
  })

  it("should accept empty config", async () => {
    const { createOpikPlugin } = await import("../../index.js")
    const handlers = await getHandlers(createOpikPlugin)
    expect(handlers).toBeDefined()
    expect(typeof handlers.event).toBe("function")
  })
})

// ─── Config priority: explicit > pluginOptions > env > defaults ────────────

describe("Smoke: Config priority", () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    savedEnv.OPIK_PROJECT_NAME = process.env.OPIK_PROJECT_NAME
    savedEnv.OPIK_API_KEY = process.env.OPIK_API_KEY
    savedEnv.OPIK_API_URL = process.env.OPIK_API_URL
    savedEnv.OPIK_WORKSPACE_NAME = process.env.OPIK_WORKSPACE_NAME
  })

  afterEach(() => {
    vi.useRealTimers()
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = val
      }
    }
  })

  it("explicit config should override pluginOptions", async () => {
    const { createOpikPlugin } = await import("../../index.js")
    await getHandlers(
      createOpikPlugin,
      { projectName: "explicit-project" },
      { projectName: "options-project" },
    )

    const lastCall =
      mockOpikConstructor.mock.calls[
        mockOpikConstructor.mock.calls.length - 1
      ]![0]
    expect(lastCall.projectName).toBe("explicit-project")
  })

  it("pluginOptions should override env vars when no explicit config", async () => {
    process.env.OPIK_PROJECT_NAME = "env-project"
    const { createOpikPlugin } = await import("../../index.js")

    await getHandlers(createOpikPlugin, undefined, {
      projectName: "options-project",
    })

    const lastCall =
      mockOpikConstructor.mock.calls[
        mockOpikConstructor.mock.calls.length - 1
      ]![0]
    expect(lastCall.projectName).toBe("options-project")
  })

  it("env vars should be used as fallback when no explicit or pluginOptions", async () => {
    process.env.OPIK_PROJECT_NAME = "env-project"
    process.env.OPIK_API_KEY = "env-api-key"

    const { createOpikPlugin } = await import("../../index.js")
    await getHandlers(createOpikPlugin)

    const lastCall =
      mockOpikConstructor.mock.calls[
        mockOpikConstructor.mock.calls.length - 1
      ]![0]
    expect(lastCall.projectName).toBe("env-project")
    expect(lastCall.apiKey).toBe("env-api-key")
  })
})

// ─── Event handler extraction logic ───────────────────────────────────────

describe("Smoke: Event handler extraction logic", () => {
  let handlers: any

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    const { createOpikPlugin } = await import("../../index.js")
    handlers = await getHandlers(createOpikPlugin, {
      projectName: "extraction-test",
      flushRetries: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("event handler should correctly handle session.created event", async () => {
    await handlers.event({
      event: {
        type: "session.created",
        properties: {
          info: { id: "sess-1", title: "Test Session", parentID: undefined },
        },
      },
    })
  })

  it("event handler should correctly handle session.idle event", async () => {
    // First create a session so idle has something to flush
    await handlers.event({
      event: {
        type: "session.created",
        properties: {
          info: { id: "sess-idle", title: "Idle Test" },
        },
      },
    })
    await handlers.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "sess-idle" },
      },
    })
    await flushMicrotasksWithFakeTimers()
  })

  it("event handler should correctly handle message.updated with AssistantMessage", async () => {
    await handlers.event({
      event: {
        type: "session.created",
        properties: {
          info: { id: "sess-msg", title: "Message Test" },
        },
      },
    })
    await handlers["chat.message"](
      { sessionID: "sess-msg", model: { providerID: "anthropic", modelID: "claude-4" } },
      { message: { content: "Hello" }, parts: [] },
    )
    await handlers.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-1",
            sessionID: "sess-msg",
            role: "assistant",
            modelID: "claude-4",
            providerID: "anthropic",
            content: "Response text",
            tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        },
      },
    })
  })

  it("chat.message should correctly receive (input, output) format", async () => {
    await handlers.event({
      event: {
        type: "session.created",
        properties: {
          info: { id: "sess-chat", title: "Chat Test" },
        },
      },
    })
    await handlers["chat.message"](
      { sessionID: "sess-chat", model: { providerID: "anthropic", modelID: "claude-4" } },
      { message: { content: "Hello via chat.message" }, parts: [] },
    )
  })

  it("tool.execute.before should work with (input, output) format", async () => {
    await handlers.event({
      event: {
        type: "session.created",
        properties: {
          info: { id: "sess-tool-b", title: "Tool Before Test" },
        },
      },
    })
    await handlers["tool.execute.before"](
      { tool: "bash", sessionID: "sess-tool-b", callID: "call-1" },
      { args: { command: "ls" } },
    )
  })

  it("tool.execute.after should work with new output shape", async () => {
    await handlers.event({
      event: {
        type: "session.created",
        properties: {
          info: { id: "sess-tool-a", title: "Tool After Test" },
        },
      },
    })
    await handlers["tool.execute.before"](
      { tool: "bash", sessionID: "sess-tool-a", callID: "call-2" },
      { args: { command: "echo hi" } },
    )
    await handlers["tool.execute.after"](
      { tool: "bash", sessionID: "sess-tool-a", callID: "call-2", args: { command: "echo hi" } },
      { title: "bash", output: "hi", metadata: { exitCode: 0 } },
    )
  })
})

// ─── Handlers are resilient to malformed input ─────────────────────────────

describe("Smoke: Handlers are safe — no exceptions on malformed input", () => {
  let handlers: any

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    const { createOpikPlugin } = await import("../../index.js")
    handlers = await getHandlers(createOpikPlugin, {
      projectName: "resilience-test",
      flushRetries: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("event handler should not throw on empty object input", async () => {
    await expect(handlers.event({})).resolves.not.toThrow()
  })

  it("event handler should not throw on event with no type", async () => {
    await expect(handlers.event({ event: {} })).resolves.not.toThrow()
  })

  it("event handler should not throw on session.idle with empty properties", async () => {
    await expect(
      handlers.event({ event: { type: "session.idle", properties: {} } }),
    ).resolves.not.toThrow()
    await flushMicrotasksWithFakeTimers()
  })

  it("chat.message should not throw on empty (input, output)", async () => {
    await expect(handlers["chat.message"]({}, {})).resolves.not.toThrow()
  })

  it("event handler should not throw on message.updated with empty properties", async () => {
    await expect(
      handlers.event({ event: { type: "message.updated", properties: {} } }),
    ).resolves.not.toThrow()
  })

  it("tool.execute.before should not throw on empty object input", async () => {
    await expect(
      handlers["tool.execute.before"]({}, {}),
    ).resolves.not.toThrow()
  })

  it("tool.execute.after should not throw on empty object input", async () => {
    await expect(
      handlers["tool.execute.after"]({}, {}),
    ).resolves.not.toThrow()
  })

  it("event handler should not throw on undefined input (null guard)", async () => {
    // event handler has null guard: const { event } = input ?? {}
    await expect(handlers.event(undefined)).resolves.not.toThrow()
    await expect(handlers.event(null)).resolves.not.toThrow()
  })
})

// ─── Multiple plugin instances are independent ─────────────────────────────

describe("Smoke: Multiple plugin instances are independent", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should create separate OpikService instances per plugin", async () => {
    const { createOpikPlugin } = await import("../../index.js")

    const h1: any = await getHandlers(createOpikPlugin, {
      projectName: "project-1",
    })
    const h2: any = await getHandlers(createOpikPlugin, {
      projectName: "project-2",
    })

    expect(typeof h1.event).toBe("function")
    expect(typeof h2.event).toBe("function")
    expect(typeof h1["chat.message"]).toBe("function")
    expect(typeof h2["chat.message"]).toBe("function")

    expect(mockOpikConstructor).toHaveBeenCalledTimes(2)

    const calls = mockOpikConstructor.mock.calls
    expect(calls[0]![0].projectName).toBe("project-1")
    expect(calls[1]![0].projectName).toBe("project-2")
  })

  it("should not share state between instances", async () => {
    const { createOpikPlugin } = await import("../../index.js")

    const h1: any = await getHandlers(createOpikPlugin, {
      projectName: "iso-1",
      flushRetries: 0,
    })
    const h2: any = await getHandlers(createOpikPlugin, {
      projectName: "iso-2",
      flushRetries: 0,
    })

    // Create session in instance 1 only
    await h1.event({
      event: {
        type: "session.created",
        properties: {
          info: { id: "only-in-1", title: "Only In 1" },
        },
      },
    })

    // Instance 2 should not see it — idle should be a no-op
    await h2.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "only-in-1" },
      },
    })
    await flushMicrotasksWithFakeTimers()
  })
})

// ─── OpikPlugin default export ─────────────────────────────────────────────

describe("Smoke: OpikPlugin default export", () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    savedEnv.OPIK_PROJECT_NAME = process.env.OPIK_PROJECT_NAME
    savedEnv.OPIK_API_KEY = process.env.OPIK_API_KEY
  })

  afterEach(() => {
    vi.useRealTimers()
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = val
      }
    }
  })

  it("should work with environment variables", async () => {
    process.env.OPIK_PROJECT_NAME = "env-smoke"
    process.env.OPIK_API_KEY = "fake-key"

    const { OpikPlugin } = await import("../../index.js")
    const handlers: any = await OpikPlugin({} as any, {})

    expect(handlers).toBeDefined()
    for (const key of ALL_HANDLER_KEYS) {
      expect(typeof handlers[key]).toBe("function")
    }
  })
})

// ─── Full round-trip through plugin entry point ────────────────────────────

describe("Smoke: Full round-trip through plugin entry", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should handle a complete session lifecycle via plugin handlers", async () => {
    const { createOpikPlugin } = await import("../../index.js")
    const handlers: any = await getHandlers(createOpikPlugin, {
      projectName: "roundtrip",
      flushRetries: 0,
    })

    await handlers.event({
      event: {
        type: "session.created",
        properties: {
          info: { id: "rt-1", title: "Roundtrip" },
        },
      },
    })
    await handlers["chat.message"](
      { sessionID: "rt-1", model: { providerID: "anthropic", modelID: "claude-4" } },
      { message: { content: "Hello" }, parts: [] },
    )
    await handlers.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-rt-1",
            sessionID: "rt-1",
            role: "assistant",
            modelID: "claude-4",
            providerID: "anthropic",
            content: "Hi!",
            tokens: { input: 3, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        },
      },
    })
    await handlers["tool.execute.before"](
      { tool: "read", sessionID: "rt-1", callID: "r1" },
      { args: { path: "test.ts" } },
    )
    await handlers["tool.execute.after"](
      { tool: "read", sessionID: "rt-1", callID: "r1", args: { path: "test.ts" } },
      { title: "read", output: "file content", metadata: {} },
    )
    await handlers.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "rt-1" },
      },
    })
    await flushMicrotasksWithFakeTimers()

    expect(mockOpikConstructor).toHaveBeenCalled()
    expect(mockFlush).toHaveBeenCalled()
  })

  it("should handle multiagent via plugin handlers", async () => {
    const { createOpikPlugin } = await import("../../index.js")
    const handlers: any = await getHandlers(createOpikPlugin, {
      projectName: "multi-rt",
      flushRetries: 0,
    })

    await handlers.event({
      event: {
        type: "session.created",
        properties: {
          info: { id: "parent", title: "Parent" },
        },
      },
    })

    await handlers.event({
      event: {
        type: "session.created",
        properties: {
          info: { id: "child", parentID: "parent", title: "Child" },
        },
      },
    })

    await handlers.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "child" },
      },
    })
    await flushMicrotasksWithFakeTimers()

    await handlers.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "parent" },
      },
    })
    await flushMicrotasksWithFakeTimers()

    expect(mockFlush).toHaveBeenCalled()
  })
})
