/**
 * Core type definitions for the opik-opencode plugin.
 *
 * Mirrors the architecture of opik-openclaw but adapted for OpenCode's
 * session/parentID-based multiagent model.
 */

import type { Opik } from "opik"

// ─── Plugin Configuration ────────────────────────────────────────────────────

export interface OpikPluginConfig {
  /** Opik API key (also reads from OPIK_API_KEY env) */
  apiKey?: string
  /** Opik API URL (also reads from OPIK_API_URL env) */
  apiUrl?: string
  /** Opik project name (default: "opencode") */
  projectName?: string
  /** Opik workspace name */
  workspaceName?: string
  /** Number of flush retries on failure (default: 2) */
  flushRetries?: number
  /** Base delay in ms for exponential backoff (default: 250) */
  flushRetryBaseDelay?: number
  /** Max delay in ms for exponential backoff (default: 5000) */
  flushRetryMaxDelay?: number
  /** Minutes before an inactive trace is auto-expired (default: 5) */
  traceExpireMinutes?: number
  /** Interval in ms to scan for expired traces (default: 60000) */
  expireScanInterval?: number
  /** Whether to sanitize payloads before sending (default: true) */
  sanitizePayloads?: boolean
  /** Whether to upload media attachments (default: false) */
  uploadAttachments?: boolean
}

// ─── Active Trace State ──────────────────────────────────────────────────────

export interface ActiveTrace {
  /** The root Opik Trace object */
  trace: any // Opik.Trace — loosely typed until SDK types stabilize
  /** Current LLM span (if any) */
  currentSpan: any | null
  /** Subagent span (non-null if this is a child session) */
  parentSpan: any | null
  /** Tool call spans, keyed by callID */
  toolSpans: Map<string, any>
  /** Child subagent spans, keyed by child sessionID */
  subagentSpans: Map<string, any>
  /** Timestamp when trace was created */
  startedAt: number
  /** Timestamp of last activity (for expiry detection) */
  lastActiveAt: number
  /** Last captured output text */
  lastOutput?: string
  /** Accumulated token usage */
  usage: TokenUsage
  /** Session metadata */
  metadata: Record<string, unknown>
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

// ─── Hook Event Payloads ─────────────────────────────────────────────────────

/**
 * Mapped OpenCode events → openclaw equivalents:
 *
 * | OpenCode Event        | openclaw Equivalent   |
 * |-----------------------|-----------------------|
 * | session.created       | (trace creation)      |
 * | chat.message          | llm_input             |
 * | message.updated       | llm_output            |
 * | tool.execute.before   | before_tool_call      |
 * | tool.execute.after    | after_tool_call       |
 * | session.idle          | agent_end             |
 */

export interface SessionCreatedPayload {
  sessionID: string
  info: {
    parentID?: string
    title?: string
    slug?: string
  }
}

export interface LlmInputPayload {
  sessionID: string
  content: string
  model?: string
  provider?: string
  systemPrompt?: string
}

export interface LlmOutputPayload {
  sessionID: string
  content: string
  model?: string
  tokens?: TokenUsage
}

export interface ToolBeforePayload {
  tool: string
  sessionID: string
  callID: string
  args: Record<string, unknown>
}

export interface ToolAfterPayload {
  tool: string
  sessionID: string
  callID: string
  output: unknown
  error?: string
  metadata?: Record<string, unknown>
}

export interface SessionIdlePayload {
  sessionID: string
}

// ─── Exporter Metrics ────────────────────────────────────────────────────────

export interface ExporterMetrics {
  tracesCreated: number
  tracesFinalized: number
  tracesExpired: number
  spansCreated: number
  spansClosed: number
  flushSuccesses: number
  flushFailures: number
  errors: number
}

export function createInitialMetrics(): ExporterMetrics {
  return {
    tracesCreated: 0,
    tracesFinalized: 0,
    tracesExpired: 0,
    spansCreated: 0,
    spansClosed: 0,
    flushSuccesses: 0,
    flushFailures: 0,
    errors: 0,
  }
}
