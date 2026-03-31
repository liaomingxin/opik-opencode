/**
 * Core OpikService — manages the Opik client and trace lifecycle.
 *
 * Mirrors opik-openclaw's service.ts architecture:
 * - State management (activeTraces, metrics)
 * - Lifecycle (start/stop)
 * - Flush with exponential backoff retry
 * - Expired trace auto-cleanup
 */

import { Opik } from "opik"
import type {
  OpikPluginConfig,
  ActiveTrace,
  ExporterMetrics,
  SessionCreatedPayload,
  SessionIdlePayload,
  LlmInputPayload,
  LlmOutputPayload,
  ToolBeforePayload,
  ToolAfterPayload,
} from "./types.js"
import { createInitialMetrics } from "./types.js"
import { resolveConfig, backoffDelay, sleep } from "./helpers.js"
import { onSessionCreated, onSessionIdle } from "./hooks/session.js"
import { onLlmInput, onLlmOutput } from "./hooks/llm.js"
import { onToolBefore, onToolAfter } from "./hooks/tool.js"

export class OpikService {
  private client!: Opik
  private config!: Required<OpikPluginConfig>
  private activeTraces = new Map<string, ActiveTrace>()
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
    const clientOptions: Record<string, unknown> = {}
    if (this.config.apiKey) clientOptions.apiKey = this.config.apiKey
    if (this.config.apiUrl) clientOptions.host = this.config.apiUrl
    if (this.config.workspaceName)
      clientOptions.workspaceName = this.config.workspaceName
    if (this.config.projectName)
      clientOptions.projectName = this.config.projectName

    this.client = new Opik(clientOptions)

    // Start expired trace cleanup timer
    this.expireTimer = setInterval(
      () => this.cleanupExpiredTraces(),
      this.config.expireScanInterval,
    )

    this.started = true
    console.log(
      `[opik-opencode] Started. Project: ${this.config.projectName}`,
    )
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
      } catch (err) {
        console.error(
          `[opik-opencode] Error closing trace for session ${sessionID}:`,
          err,
        )
      }
    }

    // Final flush
    await this.flushWithRetry()
    this.activeTraces.clear()
    this.started = false
    console.log("[opik-opencode] Stopped.")
  }

  // ─── Event Handlers (delegated to hook modules) ─────────────────────────

  handleSessionCreated(payload: SessionCreatedPayload): void {
    onSessionCreated(payload, {
      opikClient: this.client,
      activeTraces: this.activeTraces,
      metrics: this.metrics,
      projectName: this.config.projectName,
      onFlush: () => this.flushWithRetry(),
    })
  }

  handleSessionIdle(payload: SessionIdlePayload): void {
    onSessionIdle(payload, {
      opikClient: this.client,
      activeTraces: this.activeTraces,
      metrics: this.metrics,
      projectName: this.config.projectName,
      onFlush: () => this.flushWithRetry(),
    })
  }

  handleLlmInput(payload: LlmInputPayload): void {
    onLlmInput(payload, {
      activeTraces: this.activeTraces,
      metrics: this.metrics,
      sanitize: this.config.sanitizePayloads,
    })
  }

  handleLlmOutput(payload: LlmOutputPayload): void {
    onLlmOutput(payload, {
      activeTraces: this.activeTraces,
      metrics: this.metrics,
      sanitize: this.config.sanitizePayloads,
    })
  }

  handleToolBefore(payload: ToolBeforePayload): void {
    onToolBefore(payload, {
      activeTraces: this.activeTraces,
      metrics: this.metrics,
      sanitize: this.config.sanitizePayloads,
    })
  }

  handleToolAfter(payload: ToolAfterPayload): void {
    onToolAfter(payload, {
      activeTraces: this.activeTraces,
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
          console.warn(
            `[opik-opencode] Flush attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms...`,
          )
          await sleep(delay)
        } else {
          console.error(
            `[opik-opencode] Flush failed after ${this.config.flushRetries + 1} attempts:`,
            err,
          )
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
        console.warn(
          `[opik-opencode] Expiring inactive trace for session ${sessionID}`,
        )
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
        } catch (err) {
          console.error(
            `[opik-opencode] Error expiring trace ${sessionID}:`,
            err,
          )
        }
        this.activeTraces.delete(sessionID)
        this.metrics.tracesExpired++
      }
    }
  }

  // ─── Accessors ──────────────────────────────────────────────────────────

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
