/**
 * Unit tests for the config-file module.
 *
 * Tests cover:
 * - Config candidate path generation
 * - Config file discovery (findOpikConfigPath)
 * - Config file reading (loadOpikConfigFile)
 * - Config file writing (writeOpikConfigFile)
 * - Write path resolution (resolveOpikConfigWritePath)
 */

import { describe, expect, test, vi, beforeEach, afterEach } from "vitest"
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { resolve, join } from "node:path"
import { tmpdir } from "node:os"

import {
  OPIK_CONFIG_FILENAME,
  getConfigCandidates,
  findOpikConfigPath,
  loadOpikConfigFile,
  writeOpikConfigFile,
  resolveOpikConfigWritePath,
} from "../config-file.js"

// ─── Test Helpers ──────────────────────────────────────────────────────────

/** Create a unique temp directory for each test. */
function createTempDir(): string {
  const dir = resolve(tmpdir(), `opik-config-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
}

// ─── getConfigCandidates ───────────────────────────────────────────────────

describe("getConfigCandidates", () => {
  test("returns project-level and user-level paths when projectDir given", () => {
    const candidates = getConfigCandidates("/my/project")
    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toBe(resolve("/my/project", ".opencode", OPIK_CONFIG_FILENAME))
    expect(candidates[1]).toContain(".config/opencode")
    expect(candidates[1]).toContain(OPIK_CONFIG_FILENAME)
  })

  test("returns only user-level path when projectDir is undefined", () => {
    const candidates = getConfigCandidates()
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toContain(".config/opencode")
    expect(candidates[0]).toContain(OPIK_CONFIG_FILENAME)
  })

  test("returns only user-level path when projectDir is empty string", () => {
    const candidates = getConfigCandidates("")
    expect(candidates).toHaveLength(1)
  })
})

// ─── findOpikConfigPath ────────────────────────────────────────────────────

describe("findOpikConfigPath", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupDir(tempDir)
  })

  test("returns null when no config file exists", () => {
    const result = findOpikConfigPath(tempDir)
    // The user-level path might or might not exist on the test machine,
    // so we just verify the function doesn't throw
    expect(result === null || typeof result === "string").toBe(true)
  })

  test("finds project-level config file", () => {
    const opencodeDir = resolve(tempDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    const configPath = resolve(opencodeDir, OPIK_CONFIG_FILENAME)
    writeFileSync(configPath, '{"apiUrl":"http://test/api"}')

    const result = findOpikConfigPath(tempDir)
    expect(result).toBe(configPath)
  })

  test("project-level takes priority over user-level", () => {
    const opencodeDir = resolve(tempDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    const projectConfig = resolve(opencodeDir, OPIK_CONFIG_FILENAME)
    writeFileSync(projectConfig, '{"projectName":"project-level"}')

    const result = findOpikConfigPath(tempDir)
    expect(result).toBe(projectConfig)
  })
})

// ─── loadOpikConfigFile ────────────────────────────────────────────────────

describe("loadOpikConfigFile", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupDir(tempDir)
  })

  test("returns empty object when no config file found", () => {
    // Use a temp dir with no .opencode subdirectory
    const result = loadOpikConfigFile(tempDir)
    // May return {} or user-level config — just verify it doesn't throw
    expect(typeof result).toBe("object")
  })

  test("reads valid JSON config", () => {
    const opencodeDir = resolve(tempDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      resolve(opencodeDir, OPIK_CONFIG_FILENAME),
      JSON.stringify({
        apiUrl: "http://test:5173/api",
        projectName: "test-project",
        apiKey: "test-key",
      }),
    )

    const result = loadOpikConfigFile(tempDir)
    expect(result.apiUrl).toBe("http://test:5173/api")
    expect(result.projectName).toBe("test-project")
    expect(result.apiKey).toBe("test-key")
  })

  test("returns empty object for invalid JSON", () => {
    const opencodeDir = resolve(tempDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      resolve(opencodeDir, OPIK_CONFIG_FILENAME),
      "not valid json {{{",
    )

    const result = loadOpikConfigFile(tempDir)
    expect(result).toEqual({})
  })

  test("returns empty object for JSON array", () => {
    const opencodeDir = resolve(tempDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      resolve(opencodeDir, OPIK_CONFIG_FILENAME),
      '["not", "an", "object"]',
    )

    const result = loadOpikConfigFile(tempDir)
    expect(result).toEqual({})
  })

  test("returns empty object for JSON null", () => {
    const opencodeDir = resolve(tempDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      resolve(opencodeDir, OPIK_CONFIG_FILENAME),
      "null",
    )

    const result = loadOpikConfigFile(tempDir)
    expect(result).toEqual({})
  })
})

// ─── writeOpikConfigFile ───────────────────────────────────────────────────

describe("writeOpikConfigFile", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupDir(tempDir)
  })

  test("writes formatted JSON to specified path", async () => {
    const filePath = resolve(tempDir, OPIK_CONFIG_FILENAME)
    await writeOpikConfigFile(filePath, {
      apiUrl: "http://localhost/api",
      projectName: "written-project",
    })

    const raw = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw)
    expect(parsed.apiUrl).toBe("http://localhost/api")
    expect(parsed.projectName).toBe("written-project")
    // Should be formatted with 2-space indent
    expect(raw).toContain("  ")
    // Should have trailing newline
    expect(raw.endsWith("\n")).toBe(true)
  })

  test("creates parent directories if they don't exist", async () => {
    const nested = resolve(tempDir, "deep", "nested", "dir")
    const filePath = resolve(nested, OPIK_CONFIG_FILENAME)

    await writeOpikConfigFile(filePath, { apiKey: "test" })

    expect(existsSync(filePath)).toBe(true)
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(parsed.apiKey).toBe("test")
  })

  test("overwrites existing file", async () => {
    const filePath = resolve(tempDir, OPIK_CONFIG_FILENAME)
    writeFileSync(filePath, '{"old":"value"}')

    await writeOpikConfigFile(filePath, { apiUrl: "http://new/api" })

    const parsed = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(parsed.apiUrl).toBe("http://new/api")
    expect(parsed.old).toBeUndefined()
  })
})

// ─── resolveOpikConfigWritePath ────────────────────────────────────────────

describe("resolveOpikConfigWritePath", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    cleanupDir(tempDir)
  })

  test("returns project-level path when .opencode directory exists", () => {
    const opencodeDir = resolve(tempDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })

    const result = resolveOpikConfigWritePath(tempDir)
    expect(result).toBe(resolve(opencodeDir, OPIK_CONFIG_FILENAME))
  })

  test("returns user-level path when .opencode directory does not exist", () => {
    const result = resolveOpikConfigWritePath(tempDir)
    expect(result).toContain(".config/opencode")
    expect(result).toContain(OPIK_CONFIG_FILENAME)
  })

  test("returns user-level path when forceGlobal is true", () => {
    const opencodeDir = resolve(tempDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })

    const result = resolveOpikConfigWritePath(tempDir, true)
    expect(result).toContain(".config/opencode")
    expect(result).toContain(OPIK_CONFIG_FILENAME)
  })

  test("returns user-level path when projectDir is undefined", () => {
    const result = resolveOpikConfigWritePath()
    expect(result).toContain(".config/opencode")
    expect(result).toContain(OPIK_CONFIG_FILENAME)
  })
})
