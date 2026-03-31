/**
 * Unit tests for helper utilities (resolveConfig, safe, backoffDelay, sleep, generateId).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  resolveConfig,
  safe,
  backoffDelay,
  sleep,
  generateId,
} from "../helpers.js"
import { DEFAULTS } from "../constants.js"

// ─── resolveConfig ──────────────────────────────────────────────────────────

describe("resolveConfig", () => {
  const originalEnv = process.env

  beforeEach(() => {
    // Clone env so we can safely mutate it per test
    process.env = { ...originalEnv }
    delete process.env.OPIK_API_KEY
    delete process.env.OPIK_API_URL
    delete process.env.OPIK_PROJECT_NAME
    delete process.env.OPIK_WORKSPACE_NAME
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("should return all defaults when no config and no env vars", () => {
    const config = resolveConfig()
    expect(config.apiKey).toBe("")
    expect(config.apiUrl).toBe("")
    expect(config.projectName).toBe(DEFAULTS.PROJECT_NAME)
    expect(config.workspaceName).toBe("")
    expect(config.flushRetries).toBe(DEFAULTS.FLUSH_RETRIES)
    expect(config.flushRetryBaseDelay).toBe(DEFAULTS.FLUSH_RETRY_BASE_DELAY)
    expect(config.flushRetryMaxDelay).toBe(DEFAULTS.FLUSH_RETRY_MAX_DELAY)
    expect(config.traceExpireMinutes).toBe(DEFAULTS.TRACE_EXPIRE_MINUTES)
    expect(config.expireScanInterval).toBe(DEFAULTS.EXPIRE_SCAN_INTERVAL)
    expect(config.sanitizePayloads).toBe(true)
    expect(config.uploadAttachments).toBe(false)
  })

  it("should read from environment variables when no explicit config", () => {
    process.env.OPIK_API_KEY = "env-key-123"
    process.env.OPIK_API_URL = "https://env.example.com"
    process.env.OPIK_PROJECT_NAME = "env-project"
    process.env.OPIK_WORKSPACE_NAME = "env-workspace"

    const config = resolveConfig()
    expect(config.apiKey).toBe("env-key-123")
    expect(config.apiUrl).toBe("https://env.example.com")
    expect(config.projectName).toBe("env-project")
    expect(config.workspaceName).toBe("env-workspace")
  })

  it("should prioritize explicit config over environment variables", () => {
    process.env.OPIK_API_KEY = "env-key"
    process.env.OPIK_API_URL = "https://env.example.com"
    process.env.OPIK_PROJECT_NAME = "env-project"

    const config = resolveConfig({
      apiKey: "explicit-key",
      apiUrl: "https://explicit.example.com",
      projectName: "explicit-project",
    })

    expect(config.apiKey).toBe("explicit-key")
    expect(config.apiUrl).toBe("https://explicit.example.com")
    expect(config.projectName).toBe("explicit-project")
  })

  it("should prioritize explicit config over defaults for numeric/boolean fields", () => {
    const config = resolveConfig({
      flushRetries: 5,
      flushRetryBaseDelay: 500,
      flushRetryMaxDelay: 10000,
      traceExpireMinutes: 10,
      expireScanInterval: 120000,
      sanitizePayloads: false,
      uploadAttachments: true,
    })

    expect(config.flushRetries).toBe(5)
    expect(config.flushRetryBaseDelay).toBe(500)
    expect(config.flushRetryMaxDelay).toBe(10000)
    expect(config.traceExpireMinutes).toBe(10)
    expect(config.expireScanInterval).toBe(120000)
    expect(config.sanitizePayloads).toBe(false)
    expect(config.uploadAttachments).toBe(true)
  })

  it("should handle partial config (mix of explicit and defaults)", () => {
    const config = resolveConfig({ apiKey: "my-key" })
    expect(config.apiKey).toBe("my-key")
    expect(config.projectName).toBe(DEFAULTS.PROJECT_NAME) // default
    expect(config.flushRetries).toBe(DEFAULTS.FLUSH_RETRIES) // default
  })
})

// ─── safe() ─────────────────────────────────────────────────────────────────

describe("safe", () => {
  it("should return the function result on success", () => {
    const fn = (a: number, b: number) => a + b
    const wrapped = safe(fn, "add")
    expect(wrapped(2, 3)).toBe(5)
  })

  it("should catch synchronous errors and return undefined", () => {
    const fn = () => {
      throw new Error("sync boom")
    }
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const wrapped = safe(fn, "syncFail")

    const result = wrapped()
    expect(result).toBeUndefined()
    expect(consoleSpy).toHaveBeenCalledWith(
      "[opik-opencode] syncFail error:",
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })

  it("should catch async errors and return undefined", async () => {
    const fn = async () => {
      throw new Error("async boom")
    }
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const wrapped = safe(fn, "asyncFail")

    const result = await wrapped()
    expect(result).toBeUndefined()
    expect(consoleSpy).toHaveBeenCalledWith(
      "[opik-opencode] asyncFail error:",
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })

  it("should resolve async functions correctly on success", async () => {
    const fn = async (x: number) => x * 2
    const wrapped = safe(fn, "asyncOk")
    const result = await wrapped(5)
    expect(result).toBe(10)
  })

  it("should preserve function arguments", () => {
    const fn = vi.fn((a: string, b: number) => `${a}-${b}`)
    const wrapped = safe(fn, "args")
    wrapped("hello", 42)
    expect(fn).toHaveBeenCalledWith("hello", 42)
  })
})

// ─── backoffDelay ───────────────────────────────────────────────────────────

describe("backoffDelay", () => {
  it("should return base delay (±25% jitter) on attempt 0", () => {
    // Attempt 0: delay = baseDelay * 2^0 = baseDelay
    // With jitter: delay ± 25%, so range is [base*0.75, base*1.25]
    const base = 250
    const max = 5000
    // Run multiple times to confirm range
    for (let i = 0; i < 50; i++) {
      const result = backoffDelay(0, base, max)
      expect(result).toBeGreaterThanOrEqual(base * 0.75)
      expect(result).toBeLessThanOrEqual(base * 1.25)
    }
  })

  it("should double the base delay per attempt", () => {
    // Attempt 1: delay = 250 * 2^1 = 500 → range [375, 625]
    const base = 250
    const max = 5000
    for (let i = 0; i < 50; i++) {
      const result = backoffDelay(1, base, max)
      expect(result).toBeGreaterThanOrEqual(500 * 0.75)
      expect(result).toBeLessThanOrEqual(500 * 1.25)
    }
  })

  it("should cap at maxDelay", () => {
    const base = 1000
    const max = 2000
    // Attempt 5: delay = 1000 * 2^5 = 32000 → capped to 2000
    for (let i = 0; i < 50; i++) {
      const result = backoffDelay(5, base, max)
      expect(result).toBeLessThanOrEqual(max)
    }
  })

  it("should return a number", () => {
    expect(typeof backoffDelay(0, 100, 1000)).toBe("number")
  })
})

// ─── sleep ──────────────────────────────────────────────────────────────────

describe("sleep", () => {
  it("should resolve after the specified duration", async () => {
    const start = Date.now()
    await sleep(50)
    const elapsed = Date.now() - start
    // Allow some tolerance for timer precision
    expect(elapsed).toBeGreaterThanOrEqual(40)
  })

  it("should return a promise", () => {
    const result = sleep(1)
    expect(result).toBeInstanceOf(Promise)
  })
})

// ─── generateId ─────────────────────────────────────────────────────────────

describe("generateId", () => {
  it("should return a non-empty string", () => {
    const id = generateId()
    expect(typeof id).toBe("string")
    expect(id.length).toBeGreaterThan(0)
  })

  it("should generate unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()))
    expect(ids.size).toBe(100)
  })

  it("should contain a timestamp component and a random component", () => {
    const id = generateId()
    expect(id).toContain("-")
    const [timestamp, random] = id.split("-")
    expect(Number(timestamp)).toBeGreaterThan(0)
    expect(random.length).toBeGreaterThan(0)
  })
})
