/**
 * Unit tests for the configure module.
 *
 * Tests cover:
 * - Plugin entry read/write helpers (opencode.json `plugin` array format)
 * - URL builder helpers (API URL, projects URL, API keys URL)
 * - API key help text generation
 * - Status display (masks API key, shows defaults)
 * - isOpikAccessible (unreachable URL returns false)
 */

import { describe, expect, test, vi } from "vitest"
import {
  getOpikPluginEntry,
  setOpikPluginEntry,
  getApiKeyHelpText,
  showOpikStatus,
  isOpikAccessible,
  buildOpikApiUrl,
  buildProjectsUrl,
  OPIK_PLUGIN_ID,
} from "../configure.js"

// ─── getOpikPluginEntry ─────────────────────────────────────────────────────

describe("getOpikPluginEntry", () => {
  test("returns found=false when plugin array is empty", () => {
    const result = getOpikPluginEntry({ plugin: [] })
    expect(result.found).toBe(false)
    expect(result.index).toBe(-1)
    expect(result.options).toEqual({})
  })

  test("returns found=false when plugin key is missing", () => {
    const result = getOpikPluginEntry({})
    expect(result.found).toBe(false)
    expect(result.index).toBe(-1)
  })

  test("returns found=false when plugin is not an array", () => {
    const result = getOpikPluginEntry({ plugin: "not-an-array" })
    expect(result.found).toBe(false)
  })

  test("finds string-only plugin entry (no options)", () => {
    const result = getOpikPluginEntry({
      plugin: ["other-plugin", OPIK_PLUGIN_ID],
    })
    expect(result.found).toBe(true)
    expect(result.index).toBe(1)
    expect(result.options).toEqual({})
  })

  test("finds tuple plugin entry with options", () => {
    const result = getOpikPluginEntry({
      plugin: [
        "other-plugin",
        [
          OPIK_PLUGIN_ID,
          { apiKey: "test-key", projectName: "my-project" },
        ],
      ],
    })
    expect(result.found).toBe(true)
    expect(result.index).toBe(1)
    expect(result.options).toEqual({
      apiKey: "test-key",
      projectName: "my-project",
    })
  })

  test("handles non-object options in tuple gracefully", () => {
    const result = getOpikPluginEntry({
      plugin: [[OPIK_PLUGIN_ID, "not-an-object"]],
    })
    expect(result.found).toBe(true)
    expect(result.options).toEqual({})
  })

  test("handles null options in tuple gracefully", () => {
    const result = getOpikPluginEntry({
      plugin: [[OPIK_PLUGIN_ID, null]],
    })
    expect(result.found).toBe(true)
    expect(result.options).toEqual({})
  })

  test("finds plugin at first position", () => {
    const result = getOpikPluginEntry({
      plugin: [OPIK_PLUGIN_ID, "other-plugin"],
    })
    expect(result.found).toBe(true)
    expect(result.index).toBe(0)
  })

  test("does not match partial plugin names", () => {
    const result = getOpikPluginEntry({
      plugin: ["@opik/opik-opencode-extra", "opik-opencode"],
    })
    expect(result.found).toBe(false)
  })
})

// ─── setOpikPluginEntry ─────────────────────────────────────────────────────

describe("setOpikPluginEntry", () => {
  test("adds plugin entry to empty config", () => {
    const result = setOpikPluginEntry(
      {},
      { apiUrl: "http://localhost/api", projectName: "test" },
    )
    expect(result.plugin).toEqual([
      [
        OPIK_PLUGIN_ID,
        { apiUrl: "http://localhost/api", projectName: "test" },
      ],
    ])
  })

  test("adds plugin entry alongside existing plugins", () => {
    const result = setOpikPluginEntry(
      { plugin: ["other-plugin"] },
      { apiKey: "key" },
    )
    expect(result.plugin).toEqual([
      "other-plugin",
      [OPIK_PLUGIN_ID, { apiKey: "key" }],
    ])
  })

  test("updates existing string entry to tuple with options", () => {
    const result = setOpikPluginEntry(
      { plugin: [OPIK_PLUGIN_ID] },
      { projectName: "updated" },
    )
    expect(result.plugin).toEqual([
      [OPIK_PLUGIN_ID, { projectName: "updated" }],
    ])
  })

  test("updates existing tuple entry options", () => {
    const result = setOpikPluginEntry(
      { plugin: [[OPIK_PLUGIN_ID, { apiKey: "old" }]] },
      { apiKey: "new", projectName: "proj" },
    )
    expect(result.plugin).toEqual([
      [OPIK_PLUGIN_ID, { apiKey: "new", projectName: "proj" }],
    ])
  })

  test("preserves other config keys", () => {
    const result = setOpikPluginEntry(
      { model: "gpt-4", plugin: ["other"], theme: "dark" },
      { apiKey: "k" },
    )
    expect(result.model).toBe("gpt-4")
    expect(result.theme).toBe("dark")
    expect((result.plugin as unknown[]).length).toBe(2)
  })

  test("writes bare string when options are empty", () => {
    const result = setOpikPluginEntry({}, {})
    expect(result.plugin).toEqual([OPIK_PLUGIN_ID])
  })

  test("does not mutate the original config", () => {
    const original = { plugin: [OPIK_PLUGIN_ID] }
    const originalPlugins = [...original.plugin]
    setOpikPluginEntry(original, { apiKey: "k" })
    expect(original.plugin).toEqual(originalPlugins)
  })

  test("handles non-array plugin value in existing config", () => {
    const result = setOpikPluginEntry(
      { plugin: "invalid" as unknown },
      { apiKey: "k" },
    )
    expect(result.plugin).toEqual([[OPIK_PLUGIN_ID, { apiKey: "k" }]])
  })
})

// ─── URL Helpers ────────────────────────────────────────────────────────────

describe("buildOpikApiUrl", () => {
  test("returns URL as-is (trailing slash stripped)", () => {
    expect(buildOpikApiUrl("http://localhost:5173/")).toBe(
      "http://localhost:5173",
    )
  })

  test("returns URL as-is when no trailing slash", () => {
    expect(buildOpikApiUrl("http://127.0.0.1:5173")).toBe(
      "http://127.0.0.1:5173",
    )
  })

  test("cloud host returned as-is", () => {
    expect(buildOpikApiUrl("https://www.comet.com/opik/api")).toBe(
      "https://www.comet.com/opik/api",
    )
  })

  test("self-hosted returned as-is", () => {
    expect(buildOpikApiUrl("https://opik.example.com/opik/api")).toBe(
      "https://opik.example.com/opik/api",
    )
  })
})

describe("buildProjectsUrl", () => {
  test("localhost builds projects URL", () => {
    expect(buildProjectsUrl("http://localhost:5173/", "default")).toBe(
      "http://localhost:5173/default/projects",
    )
  })

  test("cloud builds projects URL without extra prefix", () => {
    expect(
      buildProjectsUrl("https://www.comet.com/", "my-workspace"),
    ).toBe("https://www.comet.com/my-workspace/projects")
  })

  test("encodes workspace name", () => {
    expect(
      buildProjectsUrl("https://www.comet.com/", "my workspace"),
    ).toBe("https://www.comet.com/my%20workspace/projects")
  })
})

// ─── getApiKeyHelpText ──────────────────────────────────────────────────────

describe("getApiKeyHelpText", () => {
  test("includes signup URL for cloud deployment", () => {
    const lines = getApiKeyHelpText("cloud", "https://www.comet.com/")
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain("account-settings/apiKeys")
    expect(lines[1]).toContain("signup")
    expect(lines[1]).toContain("opencode")
  })

  test("omits signup URL for self-hosted deployment", () => {
    const lines = getApiKeyHelpText(
      "self-hosted",
      "https://opik.example.com/",
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(
      "opik.example.com/account-settings/apiKeys",
    )
  })

  test("constructs correct API keys URL with trailing slash", () => {
    const lines = getApiKeyHelpText(
      "self-hosted",
      "https://opik.example.com",
    )
    expect(lines[0]).toContain(
      "https://opik.example.com/account-settings/apiKeys",
    )
  })
})

// ─── showOpikStatus ─────────────────────────────────────────────────────────

describe("showOpikStatus", () => {
  /** Create a ConfigDeps fixture with the new opik config file fields. */
  function makeDeps(overrides: {
    loadConfig: () => Record<string, unknown>
    loadOpikConfig?: () => Record<string, unknown>
  }): Parameters<typeof showOpikStatus>[0] {
    return {
      loadConfig: overrides.loadConfig,
      writeConfig: async () => undefined,
      loadOpikConfig: overrides.loadOpikConfig ?? (() => ({})),
      writeOpikConfig: async () => undefined,
      opikConfigPath: "/mock/opik-opencode.json",
    }
  }

  function captureOutput(fn: () => void): string {
    const logSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined)
    fn()
    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n")
    logSpy.mockRestore()
    return output
  }

  test("displays not configured when plugin not found and no config file", () => {
    const output = captureOutput(() =>
      showOpikStatus(makeDeps({
        loadConfig: () => ({ plugin: [] }),
      })),
    )
    expect(output).toContain("not configured")
    expect(output).toContain("npx")
  })

  test("displays not configured when no plugin key and no config file", () => {
    const output = captureOutput(() =>
      showOpikStatus(makeDeps({
        loadConfig: () => ({}),
      })),
    )
    expect(output).toContain("not configured")
  })

  test("displays config and masks API key (from tuple options)", () => {
    const output = captureOutput(() =>
      showOpikStatus(makeDeps({
        loadConfig: () => ({
          plugin: [
            [
              OPIK_PLUGIN_ID,
              {
                apiUrl: "https://opik.example.com/api",
                workspaceName: "my-ws",
                projectName: "my-proj",
                apiKey: "super-secret-key-12345",
              },
            ],
          ],
        }),
      })),
    )
    expect(output).toContain("API URL:    https://opik.example.com/api")
    expect(output).toContain("Workspace:  my-ws")
    expect(output).toContain("Project:    my-proj")
    expect(output).toContain("API key:    ***")
    expect(output).not.toContain("super-secret-key-12345")
  })

  test("shows defaults when options are empty (string entry)", () => {
    const output = captureOutput(() =>
      showOpikStatus(makeDeps({
        loadConfig: () => ({ plugin: [OPIK_PLUGIN_ID] }),
      })),
    )
    expect(output).toContain("(default)")
    expect(output).toContain("API key:    (not set)")
  })

  test("shows workspace default when not set", () => {
    const output = captureOutput(() =>
      showOpikStatus(makeDeps({
        loadConfig: () => ({
          plugin: [[OPIK_PLUGIN_ID, { projectName: "test" }]],
        }),
      })),
    )
    expect(output).toContain("Workspace:  default")
    expect(output).toContain("Project:    test")
  })

  test("reads from independent config file when plugin is bare string", () => {
    const output = captureOutput(() =>
      showOpikStatus(makeDeps({
        loadConfig: () => ({ plugin: [OPIK_PLUGIN_ID] }),
        loadOpikConfig: () => ({
          apiUrl: "http://localhost:5173/api",
          projectName: "file-project",
          workspaceName: "file-ws",
        }),
      })),
    )
    expect(output).toContain("API URL:    http://localhost:5173/api")
    expect(output).toContain("Project:    file-project")
    expect(output).toContain("Workspace:  file-ws")
  })

  test("tuple options override independent config file values", () => {
    const output = captureOutput(() =>
      showOpikStatus(makeDeps({
        loadConfig: () => ({
          plugin: [[OPIK_PLUGIN_ID, { projectName: "tuple-wins" }]],
        }),
        loadOpikConfig: () => ({
          projectName: "file-loses",
          apiUrl: "http://from-file/api",
        }),
      })),
    )
    expect(output).toContain("Project:    tuple-wins")
    expect(output).toContain("API URL:    http://from-file/api")
  })

  test("shows configured status from config file even without plugin entry", () => {
    const output = captureOutput(() =>
      showOpikStatus(makeDeps({
        loadConfig: () => ({ plugin: [] }),
        loadOpikConfig: () => ({
          apiUrl: "http://standalone/api",
          projectName: "standalone",
        }),
      })),
    )
    expect(output).toContain("API URL:    http://standalone/api")
    expect(output).toContain("Project:    standalone")
    expect(output).not.toContain("not configured")
  })
})

// ─── isOpikAccessible ───────────────────────────────────────────────────────

describe("isOpikAccessible", () => {
  test("returns false for unreachable URL", async () => {
    const result = await isOpikAccessible(
      "http://127.0.0.1:19999",
      500,
    )
    expect(result).toBe(false)
  })

  test("returns false for invalid URL", async () => {
    const result = await isOpikAccessible("not-a-url", 500)
    expect(result).toBe(false)
  })
})
