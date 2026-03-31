/**
 * Interactive configuration wizard for the opik-opencode plugin.
 *
 * Adapted from opik-openclaw's configure.ts for OpenCode's plugin model:
 * - OpenCode stores plugin config in opencode.json `plugin` array
 *   as `"pkg"` (no options) or `["pkg", { ...options }]` (with options)
 * - No built-in CLI registration — runs as standalone `npx` command
 *
 * @module
 */

import * as p from "@clack/prompts"
// OpikPluginConfig defines the fields stored in opencode.json plugin options

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Dependencies injected into the configure wizard for testability.
 * Abstracts file I/O so the core logic can be tested without touching disk.
 */
export type ConfigDeps = {
  loadConfig: () => Record<string, unknown>
  writeConfig: (cfg: Record<string, unknown>) => Promise<void>
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Opik Cloud host (matches SDK's DEFAULT_HOST_URL). */
const OPIK_CLOUD_HOST = "https://www.comet.com/"
const OPIK_CLOUD_SIGNUP_URL =
  "https://www.comet.com/signup?from=llm&source=opencode"
/** Default local Opik URL (matches SDK's DEFAULT_LOCAL_URL). */
const DEFAULT_LOCAL_URL = "http://localhost:5173/"
/** Max URL validation retries (matches SDK's MAX_URL_VALIDATION_RETRIES). */
const MAX_URL_RETRIES = 3
/** Plugin identifier in opencode.json plugin array. */
export const OPIK_PLUGIN_ID = "@opik/opik-opencode"

// ─── Utility ────────────────────────────────────────────────────────────────

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

// ─── opencode.json Plugin Entry Helpers ─────────────────────────────────────

/**
 * Read Opik plugin options from an opencode.json config object.
 *
 * OpenCode stores plugins as:
 *   `"plugin": ["pkg-name"]`              — string, no options
 *   `"plugin": [["pkg-name", { ... }]]`   — tuple with options
 */
export function getOpikPluginEntry(cfg: Record<string, unknown>): {
  found: boolean
  index: number
  options: Record<string, unknown>
} {
  const plugins = Array.isArray(cfg.plugin) ? cfg.plugin : []
  for (let i = 0; i < plugins.length; i++) {
    const entry = plugins[i]
    if (entry === OPIK_PLUGIN_ID) {
      return { found: true, index: i, options: {} }
    }
    if (Array.isArray(entry) && entry[0] === OPIK_PLUGIN_ID) {
      return { found: true, index: i, options: asObject(entry[1]) }
    }
  }
  return { found: false, index: -1, options: {} }
}

/**
 * Write Opik plugin options into an opencode.json config object.
 * Creates or updates the plugin entry in the `plugin` array.
 *
 * When options is empty, stores as bare string `"@opik/opik-opencode"`.
 * Otherwise stores as tuple `["@opik/opik-opencode", { ...options }]`.
 */
export function setOpikPluginEntry(
  cfg: Record<string, unknown>,
  options: Record<string, unknown>,
): Record<string, unknown> {
  const plugins = Array.isArray(cfg.plugin) ? [...cfg.plugin] : []
  const entry = getOpikPluginEntry(cfg)
  const hasOptions = Object.keys(options).length > 0
  const newEntry = hasOptions
    ? [OPIK_PLUGIN_ID, options]
    : OPIK_PLUGIN_ID

  if (entry.found) {
    plugins[entry.index] = newEntry
  } else {
    plugins.push(newEntry)
  }

  return { ...cfg, plugin: plugins }
}

// ─── URL Helpers (mirrors Opik SDK api-helpers.ts / urls.ts) ────────────────

/** Ensure trailing slash on a URL. */
function normalizeUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`
}

/**
 * Build the Opik API URL from a host.
 * Local hosts use `/api`, cloud/self-hosted use `/opik/api`.
 * Mirrors `buildOpikApiUrl` in the Opik SDK.
 */
export function buildOpikApiUrl(host: string): string {
  const normalized = host.endsWith("/") ? host.slice(0, -1) : host
  const isLocal =
    normalized.includes("localhost") || normalized.includes("127.0.0.1")
  return `${normalized}${isLocal ? "/api" : "/opik/api"}`
}

/**
 * Build a browser URL pointing to the projects list in the Opik UI.
 * Cloud/self-hosted: `{host}/opik/{workspace}/projects`
 * Local:             `{host}/{workspace}/projects`
 */
export function buildProjectsUrl(
  host: string,
  workspaceName: string,
): string {
  const base = host.endsWith("/") ? host.slice(0, -1) : host
  const isLocal =
    base.includes("localhost") || base.includes("127.0.0.1")
  const prefix = isLocal ? "" : "/opik"
  return `${base}${prefix}/${encodeURIComponent(workspaceName)}/projects`
}

function buildApiKeysUrl(host: string): string {
  return new URL("account-settings/apiKeys", normalizeUrl(host)).toString()
}

export function getApiKeyHelpText(
  deployment: "cloud" | "self-hosted",
  host: string,
): string[] {
  const lines = [
    `You can find your Opik API key here:\n${buildApiKeysUrl(host)}`,
  ]

  if (deployment === "cloud") {
    lines.push(
      `No Opik Cloud account yet? Sign up for a free account:\n${OPIK_CLOUD_SIGNUP_URL}`,
    )
  }

  return lines
}

// ─── API Validation Helpers (mirrors Opik SDK api-helpers.ts) ───────────────

/**
 * Check if an Opik instance is accessible at the given URL.
 * Accepts 2xx-4xx as valid (even 404 means server is running).
 * Mirrors `isOpikAccessible` in the Opik SDK.
 */
export async function isOpikAccessible(
  url: string,
  timeoutMs = 5_000,
): Promise<boolean> {
  try {
    const healthUrl = new URL("health", normalizeUrl(url)).toString()
    const res = await fetch(healthUrl, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.status >= 200 && res.status < 500
  } catch {
    return false
  }
}

/**
 * Fetch the default workspace for an API key.
 * Mirrors `getDefaultWorkspace` in the Opik SDK.
 * @returns The default workspace name on success, throws on failure.
 */
async function getDefaultWorkspace(
  apiKey: string,
  baseUrl: string,
): Promise<string> {
  const accountDetailsUrl = new URL(
    "api/rest/v2/account-details",
    baseUrl,
  ).toString()
  const res = await fetch(accountDetailsUrl, {
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(5_000),
  })

  if (!res.ok) {
    throw new Error(
      `Failed to fetch account details (status ${res.status})`,
    )
  }

  const body = (await res.json()) as Record<string, unknown>
  if (
    typeof body.defaultWorkspaceName !== "string" ||
    !body.defaultWorkspaceName
  ) {
    throw new Error("defaultWorkspaceName not found in the response")
  }

  return body.defaultWorkspaceName
}

// ─── Deployment-specific URL Handlers ───────────────────────────────────────

/**
 * Handle local deployment URL config with auto-detection and retry.
 * Mirrors `handleLocalDeploymentConfig` in the Opik SDK.
 */
async function handleLocalDeploymentConfig(): Promise<string> {
  const isDefaultRunning = await isOpikAccessible(DEFAULT_LOCAL_URL, 3_000)
  if (isDefaultRunning) {
    p.log.success(`Local Opik instance detected at ${DEFAULT_LOCAL_URL}`)
    return normalizeUrl(DEFAULT_LOCAL_URL)
  }

  p.log.warn(`Local Opik instance not found at ${DEFAULT_LOCAL_URL}`)
  return promptAndValidateUrl("http://localhost:5173/")
}

/**
 * Handle self-hosted deployment URL config with retry.
 * Mirrors `handleSelfHostedDeploymentConfig` in the Opik SDK.
 */
async function handleSelfHostedDeploymentConfig(): Promise<string> {
  return promptAndValidateUrl("https://your-opik-instance.com/")
}

/**
 * Prompt the user for a URL and validate connectivity, retrying
 * up to MAX_URL_RETRIES times.
 * Returns the normalized URL on success, or calls p.cancel and throws.
 */
async function promptAndValidateUrl(placeholder: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_URL_RETRIES; attempt++) {
    const urlInput = await p.text({
      message: "Please enter your Opik instance URL:",
      placeholder,
      validate(value) {
        if (!value || !value.trim())
          return "URL cannot be empty. Please enter a valid URL..."
        try {
          new URL(value.trim())
        } catch {
          return "Invalid URL format. The URL should follow a format similar to http://localhost:5173/"
        }
      },
    })

    if (p.isCancel(urlInput)) {
      p.cancel("Setup cancelled.")
      throw new Error("cancelled")
    }

    const normalized = normalizeUrl((urlInput as string).trim())
    const spinner = p.spinner()
    spinner.start("Checking connectivity...")
    const accessible = await isOpikAccessible(normalized, 5_000)
    spinner.stop(accessible ? "Connected." : "Not reachable.")

    if (accessible) return normalized

    if (attempt + 1 < MAX_URL_RETRIES) {
      p.log.error(
        `Opik is not accessible at ${normalized}. Please try again. (Attempt ${attempt + 1}/${MAX_URL_RETRIES})`,
      )
    }
  }

  p.cancel(`Failed to connect to Opik after ${MAX_URL_RETRIES} attempts.`)
  throw new Error(
    `Failed to connect to Opik after ${MAX_URL_RETRIES} attempts`,
  )
}

// ─── Interactive Configure Wizard ───────────────────────────────────────────

/**
 * Run the interactive Opik configuration wizard.
 *
 * 6-step flow (mirrors opik-openclaw):
 * 1. Auto-detect local Opik instance
 * 2. Select deployment type: Cloud / Self-hosted / Local
 * 3. Resolve host URL (with connectivity validation + retry)
 * 4. API key input + validation (cloud/self-hosted only)
 * 5. Workspace name (pre-filled from API response)
 * 6. Project name (default: "opencode")
 *
 * Writes the resolved config into opencode.json plugin options.
 */
export async function runOpikConfigure(deps: ConfigDeps): Promise<void> {
  p.intro("Opik setup for OpenCode")

  // Step 1: Check if local Opik is already running (for hint in selector)
  const isLocalRunning = await isOpikAccessible(DEFAULT_LOCAL_URL, 3_000)

  // Step 2: Deployment type selection
  const deployment = await p.select({
    message: "Which Opik deployment do you want to log your traces to?",
    options: [
      {
        value: "cloud" as const,
        label: "Opik Cloud",
        hint: "https://www.comet.com",
      },
      {
        value: "self-hosted" as const,
        label: "Self-hosted Comet platform",
        hint: "Custom Opik instance",
      },
      {
        value: "local" as const,
        label: isLocalRunning
          ? `Local deployment (detected at ${DEFAULT_LOCAL_URL})`
          : "Local deployment",
        hint: isLocalRunning ? "Running" : "http://localhost:5173",
      },
    ],
    initialValue: isLocalRunning
      ? ("local" as const)
      : ("cloud" as const),
  })

  if (p.isCancel(deployment)) {
    p.cancel("Setup cancelled.")
    return
  }

  // Step 3: Resolve host URL based on deployment type
  let host: string
  try {
    if (deployment === "local") {
      host = await handleLocalDeploymentConfig()
    } else if (deployment === "self-hosted") {
      host = await handleSelfHostedDeploymentConfig()
    } else {
      host = OPIK_CLOUD_HOST
    }
  } catch {
    // User cancelled or max retries — already handled via p.cancel
    return
  }

  // Step 4: API key + workspace (only for cloud and self-hosted)
  let apiKey: string | undefined
  let workspaceName: string

  if (deployment === "local") {
    workspaceName = "default"
  } else {
    // Loop until we get a valid API key (mirrors SDK behavior)
    let defaultWorkspaceName: string | undefined
    let apiKeyValidated = false

    while (!apiKeyValidated) {
      for (const line of getApiKeyHelpText(deployment, host)) {
        p.log.info(line)
      }

      const keyInput = await p.password({
        message: "Enter your Opik API key:",
        validate(value) {
          if (!value || !value.trim()) return "API key is required"
        },
      })

      if (p.isCancel(keyInput)) {
        p.cancel("Setup cancelled.")
        return
      }

      apiKey = (keyInput as string).trim()

      // Validate by fetching default workspace
      const spinner = p.spinner()
      spinner.start("Validating API key...")
      try {
        defaultWorkspaceName = await getDefaultWorkspace(apiKey, host)
        apiKeyValidated = true
        spinner.stop("API key validated.")
      } catch {
        spinner.stop("Invalid API key.")
        p.log.error(
          "Invalid API key. Please check your API key and try again.",
        )
      }
    }

    // Ask for workspace name with default from API
    const workspaceInput = await p.text({
      message: defaultWorkspaceName
        ? `Enter your workspace name (press Enter to use: ${defaultWorkspaceName}):`
        : "Enter your workspace name:",
      placeholder: defaultWorkspaceName ?? "your-workspace-name",
      initialValue: defaultWorkspaceName,
      validate(value) {
        if ((!value || !value.trim()) && !defaultWorkspaceName) {
          return "Workspace name is required"
        }
      },
    })

    if (p.isCancel(workspaceInput)) {
      p.cancel("Setup cancelled.")
      return
    }

    workspaceName = (
      (workspaceInput as string) ||
      defaultWorkspaceName ||
      "default"
    ).trim()
  }

  // Step 5: Project name
  const projectInput = await p.text({
    message: "Enter your project name (optional):",
    placeholder: "opencode",
    initialValue: "opencode",
  })

  if (p.isCancel(projectInput)) {
    p.cancel("Setup cancelled.")
    return
  }

  const projectName = (projectInput as string).trim() || "opencode"

  // Step 6: Build API URL from host and write config
  const apiUrl = buildOpikApiUrl(host)
  const cfg = deps.loadConfig()
  const existing = getOpikPluginEntry(cfg).options

  const nextOptions: Record<string, unknown> = {
    ...existing,
    apiUrl,
    ...(apiKey ? { apiKey } : {}),
    workspaceName,
    projectName,
  }

  const nextCfg = setOpikPluginEntry(cfg, nextOptions)
  await deps.writeConfig(nextCfg)

  const projectsUrl = buildProjectsUrl(host, workspaceName)

  p.note(
    [
      `API URL:    ${apiUrl}`,
      `Workspace:  ${workspaceName}`,
      `Project:    ${projectName}`,
      `API key:    ${apiKey ? "***" : "(none)"}`,
      "",
      `View your projects: ${projectsUrl}`,
    ].join("\n"),
    "Opik configuration saved",
  )
  p.outro("Restart OpenCode to apply changes.")
}

// ─── Status Display ─────────────────────────────────────────────────────────

/**
 * Display current Opik configuration status.
 * API keys are masked for security.
 */
export function showOpikStatus(deps: ConfigDeps): void {
  const cfg = deps.loadConfig()
  const entry = getOpikPluginEntry(cfg)

  if (!entry.found) {
    console.log(
      "Opik is not configured. Run: npx @opik/opik-opencode configure",
    )
    return
  }

  const opik = entry.options
  const lines = [
    `  API URL:    ${(opik.apiUrl as string) ?? "(default)"}`,
    `  Workspace:  ${(opik.workspaceName as string) ?? "default"}`,
    `  Project:    ${(opik.projectName as string) ?? "opencode"}`,
    `  API key:    ${opik.apiKey ? "***" : "(not set)"}`,
  ]

  console.log("Opik status:\n")
  console.log(lines.join("\n"))
}
