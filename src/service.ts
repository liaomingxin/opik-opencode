/**
 * Core OpikService — manages the Opik client and trace lifecycle.
 *
 * Mirrors opik-openclaw's service.ts architecture:
 * - State management (activeTraces, metrics)
 * - Lifecycle (start/stop)
 * - Flush with exponential backoff retry
 * - Expired trace auto-cleanup
 */

import { Opik, disableLogger } from "opik"
import type {
  OpikPluginConfig,
  ActiveTrace,
  SubagentSpanHost,
  ExporterMetrics,
  SessionCreatedPayload,
  SessionIdlePayload,
  LlmInputPayload,
  LlmOutputPayload,
  MessagePartUpdatedPayload,
  SessionStatusPayload,
  ToolBeforePayload,
  ToolAfterPayload,
} from "./types.js"
import { createInitialMetrics } from "./types.js"
import { resolveConfig, backoffDelay, sleep } from "./helpers.js"
import { onSessionCreated, onSessionIdle } from "./hooks/session.js"
import { onLlmInput, onLlmOutput, onMessagePartUpdated } from "./hooks/llm.js"
import { onToolBefore, onToolAfter } from "./hooks/tool.js"

export class OpikService {
  private client!: Opik
  private config!: Required<OpikPluginConfig>
  private activeTraces = new Map<string, ActiveTrace>()
  private subagentSpanHosts = new Map<string, SubagentSpanHost>()
  private finalizedSessions = new Set<string>()
  private processedMessages = new Set<string>()
  private metrics: ExporterMetrics = createInitialMetrics()
  private expireTimer: ReturnType<typeof setInterval> | null = null
  private started = false

  /**
   * Initialize the Opik client and start background tasks.
   */
  async start(pluginConfig?: Partial<OpikPluginConfig>): Promise<void> {
    if (this.started) return

    this.config = resolveConfig(pluginConfig)

    // Initialize Opik client
    // SDK expects: { apiKey, apiUrl, projectName, workspaceName }
    const clientOptions: Record<string, unknown> = {}
    if (this.config.apiKey) clientOptions.apiKey = this.config.apiKey
    if (this.config.apiUrl) clientOptions.apiUrl = this.config.apiUrl
    if (this.config.workspaceName)
      clientOptions.workspaceName = this.config.workspaceName
    if (this.config.projectName)
      clientOptions.projectName = this.config.projectName

    // Suppress Opik SDK internal INFO/WARN logs that would leak into
    // OpenCode's TUI via stderr.
    disableLogger()

    this.client = new Opik(clientOptions)

    // Start expired trace cleanup timer
    this.expireTimer = setInterval(
      () => this.cleanupExpiredTraces(),
      this.config.expireScanInterval,
    )

    this.started = true
  }

  /**
   * Gracefully stop: finalize all active traces, flush, and cleanup.
   */
  async stop(): Promise<void> {
    if (!this.started) return

    // Stop expire timer
    if (this.expireTimer) {
      clearInterval(this.expireTimer)
      this.expireTimer = null
    }

    // Finalize all remaining active traces
    for (const [sessionID, active] of this.activeTraces) {
      try {
        for (const span of active.toolSpans.values()) span.end()
        if (active.currentSpan) active.currentSpan.end()
        if (active.parentSpan) {
          active.parentSpan.end()
        } else {
          active.trace.end()
        }
      } catch {
        // best-effort: silently ignore close errors
      }
    }

    // Final flush
    await this.flushWithRetry()
    this.activeTraces.clear()
    this.subagentSpanHosts.clear()
    this.started = false
  }

  // ─── Event Handlers (delegated to hook modules) ─────────────────────────

  handleSessionCreated(payload: SessionCreatedPayload): void {
    onSessionCreated(payload, {
      opikClient: this.client,
      activeTraces: this.activeTraces,
      subagentSpanHosts: this.subagentSpanHosts,
      metrics: this.metrics,
      projectName: this.config.projectName,
      onFlush: () => this.flushWithRetry(),
    })
  }

  handleSessionIdle(payload: SessionIdlePayload): void {
    // Mark session as finalized to prevent re-creation from late session.updated events
    this.finalizedSessions.add(payload.sessionID)
    onSessionIdle(payload, {
      opikClient: this.client,
      activeTraces: this.activeTraces,
      subagentSpanHosts: this.subagentSpanHosts,
      metrics: this.metrics,
      projectName: this.config.projectName,
      onFlush: () => this.flushWithRetry(),
    })
  }

  handleLlmInput(payload: LlmInputPayload): void {
    onLlmInput(payload, {
      activeTraces: this.activeTraces,
      subagentSpanHosts: this.subagentSpanHosts,
      metrics: this.metrics,
      sanitize: this.config.sanitizePayloads,
    })
  }

  handleLlmOutput(payload: LlmOutputPayload): void {
    onLlmOutput(payload, {
      activeTraces: this.activeTraces,
      subagentSpanHosts: this.subagentSpanHosts,
      metrics: this.metrics,
      sanitize: this.config.sanitizePayloads,
    })
    // Eagerly flush after LLM output to ensure span data is persisted
    // before process exit in short-lived opencode run scenarios.
    this.flushWithRetry().catch(() => {})
  }

  handleMessagePartUpdated(payload: MessagePartUpdatedPayload): void {
    onMessagePartUpdated(payload, {
      activeTraces: this.activeTraces,
      subagentSpanHosts: this.subagentSpanHosts,
      metrics: this.metrics,
      sanitize: this.config.sanitizePayloads,
    })
  }

  handleSessionStatus(payload: SessionStatusPayload): void {
    const active = this.activeTraces.get(payload.sessionID)
    if (active) {
      active.lastActiveAt = Date.now()
      active.metadata.lastStatus = payload.status.type
    }
  }

  handleToolBefore(payload: ToolBeforePayload): void {
    onToolBefore(payload, {
      activeTraces: this.activeTraces,
      subagentSpanHosts: this.subagentSpanHosts,
      metrics: this.metrics,
      sanitize: this.config.sanitizePayloads,
    })
  }

  handleToolAfter(payload: ToolAfterPayload): void {
    onToolAfter(payload, {
      activeTraces: this.activeTraces,
      subagentSpanHosts: this.subagentSpanHosts,
      metrics: this.metrics,
      sanitize: this.config.sanitizePayloads,
    })
  }

  // ─── Flush with Retry ───────────────────────────────────────────────────

  private async flushWithRetry(): Promise<void> {
    for (let attempt = 0; attempt <= this.config.flushRetries; attempt++) {
      try {
        await this.client.flush()
        this.metrics.flushSuccesses++
        return
      } catch (err) {
        if (attempt < this.config.flushRetries) {
          const delay = backoffDelay(
            attempt,
            this.config.flushRetryBaseDelay,
            this.config.flushRetryMaxDelay,
          )
          await sleep(delay)
        } else {
          this.metrics.flushFailures++
        }
      }
    }
  }

  // ─── Expired Trace Cleanup ──────────────────────────────────────────────

  private cleanupExpiredTraces(): void {
    const expireThreshold =
      Date.now() - this.config.traceExpireMinutes * 60 * 1000

    for (const [sessionID, active] of this.activeTraces) {
      if (active.lastActiveAt < expireThreshold) {
        try {
          for (const span of active.toolSpans.values()) span.end()
          if (active.currentSpan) active.currentSpan.end()
          if (active.parentSpan) {
            active.parentSpan.update({
              metadata: { expired: true },
            })
            active.parentSpan.end()
          } else {
            active.trace.update({
              metadata: { expired: true, usage: active.usage },
            })
            active.trace.end()
          }
        } catch {
          // best-effort
        }
        this.activeTraces.delete(sessionID)
        this.metrics.tracesExpired++
      }
    }
  }

  // ─── Accessors ──────────────────────────────────────────────────────────

  hasActiveTrace(sessionID: string): boolean {
    return this.activeTraces.has(sessionID)
  }

  wasFinalized(sessionID: string): boolean {
    return this.finalizedSessions.has(sessionID)
  }

  hasProcessedMessage(messageID: string): boolean {
    return this.processedMessages.has(messageID)
  }

  markMessageProcessed(messageID: string): void {
    this.processedMessages.add(messageID)
  }

  updateTraceTitle(sessionID: string, title: string): void {
    const active = this.activeTraces.get(sessionID)
    if (!active) return
    try {
      active.trace.update({ name: `opencode-${title}` })
    } catch {
      // Best-effort title update
    }
  }

  getMetrics(): Readonly<ExporterMetrics> {
    return { ...this.metrics }
  }

  getActiveTraceCount(): number {
    return this.activeTraces.size
  }

  isStarted(): boolean {
    return this.started
  }
}
