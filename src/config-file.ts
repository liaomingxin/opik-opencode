/**
 * Independent config file discovery, reading, and writing for opik-opencode.
 *
 * Allows the plugin to load its configuration from a standalone JSON file
 * instead of (or in addition to) the opencode.json plugin tuple. This
 * improves compatibility with oh-my-opencode and other tools that expect
 * the `plugin` array to contain only bare strings.
 *
 * Search order (first found wins):
 *   1. Project-level: <projectDir>/.opencode/opik-opencode.json
 *   2. User-level:    ~/.config/opencode/opik-opencode.json
 *
 * @module
 */

import { existsSync, readFileSync, mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { homedir } from "node:os"
import type { OpikPluginConfig } from "./types.js"

// ─── Constants ─────────────────────────────────────────────────────────────

/** Config file name — matches the npm package short name. */
export const OPIK_CONFIG_FILENAME = "opik-opencode.json"

/** Project-level config subdirectory. */
const PROJECT_CONFIG_DIR = ".opencode"

/** User-level config directory (XDG-style). */
const USER_CONFIG_DIR = resolve(homedir(), ".config", "opencode")

// ─── Discovery ─────────────────────────────────────────────────────────────

/**
 * Build the list of candidate config file paths to search.
 *
 * @param projectDir - The project root directory (e.g. from `ctx.directory`).
 *                     When omitted, only the user-level path is searched.
 * @returns Array of absolute paths to check, in priority order.
 */
export function getConfigCandidates(projectDir?: string): string[] {
  const candidates: string[] = []
  if (projectDir) {
    candidates.push(resolve(projectDir, PROJECT_CONFIG_DIR, OPIK_CONFIG_FILENAME))
  }
  candidates.push(resolve(USER_CONFIG_DIR, OPIK_CONFIG_FILENAME))
  return candidates
}

/**
 * Find the first existing opik-opencode config file.
 *
 * @param projectDir - The project root directory.
 * @returns Absolute path to the config file, or `null` if none found.
 */
export function findOpikConfigPath(projectDir?: string): string | null {
  for (const candidate of getConfigCandidates(projectDir)) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

// ─── Reading ───────────────────────────────────────────────────────────────

/**
 * Load and parse the opik-opencode config file.
 *
 * Returns an empty object when no config file exists or when the file
 * contains invalid JSON — the plugin will fall back to environment
 * variables and defaults.
 *
 * @param projectDir - The project root directory.
 */
export function loadOpikConfigFile(
  projectDir?: string,
): Partial<OpikPluginConfig> {
  const configPath = findOpikConfigPath(projectDir)
  if (!configPath) return {}

  try {
    const raw = readFileSync(configPath, "utf-8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    return parsed as Partial<OpikPluginConfig>
  } catch {
    return {}
  }
}

// ─── Writing ───────────────────────────────────────────────────────────────

/**
 * Write config to the specified file path.
 * Creates parent directories if they don't exist.
 */
export async function writeOpikConfigFile(
  filePath: string,
  config: Record<string, unknown>,
): Promise<void> {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  await writeFile(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8")
}

/**
 * Determine the best path to write the opik config file.
 *
 * - If `<projectDir>/.opencode/` directory exists → project-level
 * - Otherwise → user-level `~/.config/opencode/`
 *
 * Use `--global` flag (via `forceGlobal`) to always write user-level.
 *
 * @param projectDir  - The project root directory.
 * @param forceGlobal - When true, always write to user-level config.
 */
export function resolveOpikConfigWritePath(
  projectDir?: string,
  forceGlobal = false,
): string {
  if (!forceGlobal && projectDir) {
    const projectConfigDir = resolve(projectDir, PROJECT_CONFIG_DIR)
    if (existsSync(projectConfigDir)) {
      return resolve(projectConfigDir, OPIK_CONFIG_FILENAME)
    }
  }
  return resolve(USER_CONFIG_DIR, OPIK_CONFIG_FILENAME)
}
