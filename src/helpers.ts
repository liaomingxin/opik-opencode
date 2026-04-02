/**
 * Utility helpers for the opik-opencode plugin.
 */

import { type OpikPluginConfig } from "./types.js"
import { DEFAULTS } from "./constants.js"

/**
 * Resolve plugin config from explicit config + independent file + environment variables.
 *
 * Priority chain (highest → lowest):
 *   explicit config (createOpikPlugin arg + pluginOptions)
 *   > independent config file (~/.config/opencode/opik-opencode.json or .opencode/opik-opencode.json)
 *   > environment variables
 *   > hardcoded defaults
 *
 * @param config     - Merged explicit config (createOpikPlugin arg + pluginOptions from opencode.json tuple).
 * @param fileConfig - Config loaded from the independent opik-opencode.json file.
 */
export function resolveConfig(
  config: Partial<OpikPluginConfig> = {},
  fileConfig: Partial<OpikPluginConfig> = {},
): Required<OpikPluginConfig> {
  return {
    apiKey: config.apiKey ?? fileConfig.apiKey ?? process.env.OPIK_API_KEY ?? "",
    apiUrl: config.apiUrl ?? fileConfig.apiUrl ?? process.env.OPIK_API_URL ?? "",
    projectName:
      config.projectName ??
      fileConfig.projectName ??
      process.env.OPIK_PROJECT_NAME ??
      DEFAULTS.PROJECT_NAME,
    workspaceName:
      config.workspaceName ?? fileConfig.workspaceName ?? process.env.OPIK_WORKSPACE_NAME ?? "",
    flushRetries: config.flushRetries ?? fileConfig.flushRetries ?? DEFAULTS.FLUSH_RETRIES,
    flushRetryBaseDelay:
      config.flushRetryBaseDelay ?? fileConfig.flushRetryBaseDelay ?? DEFAULTS.FLUSH_RETRY_BASE_DELAY,
    flushRetryMaxDelay:
      config.flushRetryMaxDelay ?? fileConfig.flushRetryMaxDelay ?? DEFAULTS.FLUSH_RETRY_MAX_DELAY,
    traceExpireMinutes:
      config.traceExpireMinutes ?? fileConfig.traceExpireMinutes ?? DEFAULTS.TRACE_EXPIRE_MINUTES,
    expireScanInterval:
      config.expireScanInterval ?? fileConfig.expireScanInterval ?? DEFAULTS.EXPIRE_SCAN_INTERVAL,
    sanitizePayloads: config.sanitizePayloads ?? fileConfig.sanitizePayloads ?? true,
    uploadAttachments: config.uploadAttachments ?? fileConfig.uploadAttachments ?? false,
  }
}

/**
 * Safe wrapper that catches and logs errors without crashing the host.
 * Mirrors the `safe*` pattern from opik-openclaw.
 */
export function safe<T extends (...args: any[]) => any>(
  fn: T,
  label: string,
): (...args: Parameters<T>) => ReturnType<T> | undefined {
  return ((...args: Parameters<T>) => {
    try {
      const result = fn(...args)
      // Handle async functions
      if (result && typeof result.catch === "function") {
        return result.catch(() => undefined)
      }
      return result
    } catch {
      return undefined
    }
  }) as any
}

/**
 * Exponential backoff delay calculator.
 */
export function backoffDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
): number {
  const delay = baseDelay * Math.pow(2, attempt)
  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1)
  return Math.min(delay + jitter, maxDelay)
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generate a unique ID for internal tracking.
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
