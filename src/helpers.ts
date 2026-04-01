/**
 * Utility helpers for the opik-opencode plugin.
 */

import { type OpikPluginConfig } from "./types.js"
import { DEFAULTS } from "./constants.js"

/**
 * Resolve plugin config from explicit config + environment variables.
 * Environment variables take precedence over defaults but not explicit config.
 */
export function resolveConfig(
  config: Partial<OpikPluginConfig> = {},
): Required<OpikPluginConfig> {
  return {
    apiKey: config.apiKey ?? process.env.OPIK_API_KEY ?? "",
    apiUrl: config.apiUrl ?? process.env.OPIK_API_URL ?? "",
    projectName:
      config.projectName ??
      process.env.OPIK_PROJECT_NAME ??
      DEFAULTS.PROJECT_NAME,
    workspaceName:
      config.workspaceName ?? process.env.OPIK_WORKSPACE_NAME ?? "",
    flushRetries: config.flushRetries ?? DEFAULTS.FLUSH_RETRIES,
    flushRetryBaseDelay:
      config.flushRetryBaseDelay ?? DEFAULTS.FLUSH_RETRY_BASE_DELAY,
    flushRetryMaxDelay:
      config.flushRetryMaxDelay ?? DEFAULTS.FLUSH_RETRY_MAX_DELAY,
    traceExpireMinutes:
      config.traceExpireMinutes ?? DEFAULTS.TRACE_EXPIRE_MINUTES,
    expireScanInterval:
      config.expireScanInterval ?? DEFAULTS.EXPIRE_SCAN_INTERVAL,
    sanitizePayloads: config.sanitizePayloads ?? true,
    uploadAttachments: config.uploadAttachments ?? false,
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
