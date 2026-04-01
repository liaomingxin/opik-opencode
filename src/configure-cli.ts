#!/usr/bin/env node

/**
 * CLI entry point for the opik-opencode configuration tool.
 *
 * Usage:
 *   npx @liaomx/opik-opencode configure   — Interactive setup wizard
 *   npx @liaomx/opik-opencode status      — Show current config
 *   npx @liaomx/opik-opencode help        — Show usage
 *
 * Locates the nearest opencode.json config file, provides read/write
 * deps, and delegates to the configure wizard or status display.
 *
 * @module
 */

import { readFileSync, existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { runOpikConfigure, showOpikStatus } from "./configure.js"
import type { ConfigDeps } from "./configure.js"

// ─── Config File Discovery ──────────────────────────────────────────────────

/** Candidate config file paths, checked in order. */
const CONFIG_FILENAMES = ["opencode.json", ".opencode/config.json"]

/**
 * Find the nearest opencode config file starting from `cwd`.
 * Falls back to `opencode.json` in `cwd` if none exists (will be created).
 */
export function findConfigPath(cwd: string): string {
  for (const name of CONFIG_FILENAMES) {
    const candidate = resolve(cwd, name)
    if (existsSync(candidate)) return candidate
  }
  // Default: will create opencode.json in cwd
  return resolve(cwd, "opencode.json")
}

/**
 * Synchronously load and parse a JSON config file.
 * Returns empty object `{}` if file does not exist or is invalid.
 */
export function loadConfigFromFile(
  configPath: string,
): Record<string, unknown> {
  try {
    if (!existsSync(configPath)) return {}
    const raw = readFileSync(configPath, "utf-8")
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed && !Array.isArray(parsed)
      ? parsed
      : {}
  } catch {
    return {}
  }
}

/**
 * Write a config object as formatted JSON to disk.
 */
export async function writeConfigToFile(
  configPath: string,
  cfg: Record<string, unknown>,
): Promise<void> {
  await writeFile(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8")
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  const configPath = findConfigPath(process.cwd())

  const deps: ConfigDeps = {
    loadConfig: () => loadConfigFromFile(configPath),
    writeConfig: (cfg) => writeConfigToFile(configPath, cfg),
  }

  switch (command) {
    case "configure":
    case "config":
    case "setup":
      console.log(`Config file: ${configPath}\n`)
      await runOpikConfigure(deps)
      break

    case "status":
      console.log(`Config file: ${configPath}\n`)
      showOpikStatus(deps)
      break

    default:
      console.log("@liaomx/opik-opencode — Opik trace export for OpenCode\n")
      console.log("Usage: opik-opencode <command>\n")
      console.log("Commands:")
      console.log("  configure  Interactive setup for Opik trace export")
      console.log("  status     Show current Opik configuration")
      console.log("  help       Show this help message")
      process.exitCode = command && command !== "help" ? 1 : 0
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exitCode = 1
})
