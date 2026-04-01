/**
 * Core type definitions for the opik-opencode plugin.
 *
 * Adapted from OpenCode @opencode-ai/plugin@1.3.10 real API types.
 * Session lifecycle events (session.created, session.idle, message.updated,
 * message.part.updated) are accessed via the `event` catch-all hook, NOT
 * as direct hook keys.
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

// ─── Token Usage (matches AssistantMessage.tokens from OpenCode SDK) ────────

export interface TokenUsage {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

/** Create a zero-valued TokenUsage */
export function zeroTokenUsage(): TokenUsage {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
}

/** Compute total tokens from the TokenUsage shape */
export function totalTokens(t: TokenUsage): number {
  return t.input + t.output + t.reasoning + t.cache.read + t.cache.write
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
  /** Accumulated streaming text from message.part.updated deltas */
  streamingText: string
  /** Model info captured from chat.message for span metadata */
  modelInfo?: { providerID: string; modelID: string }
  /** LLM turn counter for multi-turn span naming (e.g. "claude-sonnet-4-5 #2") */
  llmTurnCount: number
}

// ─── Subagent Span Host (cross-session bridging) ────────────────────────────

export interface SubagentSpanHost {
  /** The session ID of the host (parent) session */
  hostSessionID: string
  /** The host session's ActiveTrace */
  active: ActiveTrace
  /** The subagent Span that child events should nest under */
  span: any // Opik Span
}

/** Result of resolveSessionSpanContainer */
export interface SpanContainer {
  /** The resolved session ID (may differ from input if bridged) */
  sessionID: string
  /** The ActiveTrace associated with this session */
  active: ActiveTrace
  /** The parent Trace or Span to nest new spans under */
  parent: any // Opik Trace | Span
}

// ─── Hook Event Payloads ─────────────────────────────────────────────────────

/**
 * Mapped OpenCode events → hook mechanism:
 *
 * | OpenCode Event          | Hook Type          | Source                           |
 * |-------------------------|--------------------|----------------------------------|
 * | session.created         | event catch-all    | EventSessionCreated              |
 * | session.idle            | event catch-all    | EventSessionIdle                 |
 * | session.status          | event catch-all    | EventSessionStatus               |
 * | message.updated         | event catch-all    | EventMessageUpdated              |
 * | message.part.updated    | event catch-all    | EventMessagePartUpdated          |
 * | chat.message            | direct hook key    | Hooks["chat.message"]            |
 * | tool.execute.before     | direct hook key    | Hooks["tool.execute.before"]     |
 * | tool.execute.after      | direct hook key    | Hooks["tool.execute.after"]      |
 */

/** Payload for session.created — derived from EventSessionCreated.properties.info (Session) */
export interface SessionCreatedPayload {
  sessionID: string
  info: {
    id: string
    projectID?: string
    directory?: string
    parentID?: string
    title?: string
    version?: number
    time?: { created?: number; updated?: number }
  }
}

/**
 * Payload for chat.message — derived from Hooks["chat.message"] signature.
 * hook: (input: {sessionID, agent?, model?}, output: {message: UserMessage, parts: Part[]})
 */
export interface LlmInputPayload {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  messageID?: string
  message?: unknown    // UserMessage from output.message
  parts?: unknown[]    // Part[] from output.parts
}

/**
 * Payload for message.updated — derived from EventMessageUpdated.properties.info (AssistantMessage).
 */
export interface LlmOutputPayload {
  sessionID: string
  messageID?: string
  role?: string
  modelID?: string
  providerID?: string
  content?: string       // extracted from message for convenience
  tokens?: TokenUsage
  error?: unknown
  finish?: string
}

/** Payload for message.part.updated — streaming deltas */
export interface MessagePartUpdatedPayload {
  sessionID: string
  part: {
    type: string
    text?: string
    [key: string]: unknown
  }
  delta?: string
}

/** Payload for session.status — busy/idle/retry transitions */
export interface SessionStatusPayload {
  sessionID: string
  status: { type: string; attempt?: number; message?: string; next?: number }
}

export interface ToolBeforePayload {
  tool: string
  sessionID: string
  callID: string
  args: Record<string, unknown>
}

/** Payload for tool.execute.after — matches Hooks["tool.execute.after"] output */
export interface ToolAfterPayload {
  tool: string
  sessionID: string
  callID: string
  args?: Record<string, unknown>  // input.args available in after
  title?: string                  // output.title
  output: unknown                 // output.output (string)
  metadata?: Record<string, unknown>  // output.metadata
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
