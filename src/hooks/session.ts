/**
 * Session lifecycle hooks.
 *
 * Handles session.created and session.idle events.
 * These events are received via the `event` catch-all handler (not direct hook keys).
 * Manages Opik Trace creation/finalization and multiagent parent/child linking.
 */

import type {
  ActiveTrace,
  SubagentSpanHost,
  SessionCreatedPayload,
  SessionIdlePayload,
  ExporterMetrics,
} from "../types.js"
import { zeroTokenUsage, totalTokens } from "../types.js"
import { SPAN_TYPE, SUBAGENT_SPAN_HOSTS_MAX } from "../constants.js"
import { safe } from "../helpers.js"

export interface SessionHookDeps {
  opikClient: any
  activeTraces: Map<string, ActiveTrace>
  subagentSpanHosts: Map<string, SubagentSpanHost>
  metrics: ExporterMetrics
  projectName: string
  onFlush: () => Promise<void>
}

/**
 * Handle session.created event.
 *
 * - Root session (no parentID) → create a new Opik Trace
 * - Child session (has parentID) → create a Subagent Span under parent's Trace
 */
export const onSessionCreated = safe(function onSessionCreated(
  payload: SessionCreatedPayload,
  deps: SessionHookDeps,
): void {
  const { sessionID, info } = payload
  const { opikClient, activeTraces, subagentSpanHosts, metrics, projectName } = deps

  if (!info.parentID) {
    // ── Root session → new Trace ──────────────────────────────────────
    const trace = opikClient.trace({
      name: `opencode-${info.title ?? sessionID}`,
      threadId: sessionID,
      input: {},
      metadata: {
        sessionID,
        projectID: info.projectID,
        directory: info.directory,
        source: "opik-opencode",
      },
      projectName,
    })

    activeTraces.set(sessionID, {
      trace,
      currentSpan: null,
      parentSpan: null,
      toolSpans: new Map(),
      subagentSpans: new Map(),
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
      usage: zeroTokenUsage(),
      metadata: { sessionID, directory: info.directory },
      streamingText: "",
      llmTurnCount: 0,
    })

    metrics.tracesCreated++
  } else {
    // ── Child session → Subagent Span on parent Trace ─────────────────
    const parentActive = activeTraces.get(info.parentID)
    if (!parentActive) {
      console.warn(
        `[opik-opencode] Child session ${sessionID} has parentID ${info.parentID} but no active parent trace found.`,
      )
      return
    }

    // Anchor: if parent is itself a child, nest under parent's subagent span
    const anchorSpan = parentActive.parentSpan ?? parentActive.trace

    const subagentSpan = anchorSpan.span({
      name: `subagent:${info.title ?? sessionID}`,
      type: SPAN_TYPE.AGENT,
      metadata: {
        childSessionID: sessionID,
        parentSessionID: info.parentID,
      },
    })

    // Register child as its own ActiveTrace entry, sharing parent's root Trace
    activeTraces.set(sessionID, {
      trace: parentActive.trace, // shared root trace
      currentSpan: null,
      parentSpan: subagentSpan, // this child's anchor span
      toolSpans: new Map(),
      subagentSpans: new Map(),
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
      usage: zeroTokenUsage(),
      metadata: {
        sessionID,
        parentSessionID: info.parentID,
      },
      streamingText: "",
      llmTurnCount: 0,
    })

    // Parent tracks its children
    parentActive.subagentSpans.set(sessionID, subagentSpan)

    // Register cross-session bridge for event reordering resilience
    if (subagentSpanHosts.size >= SUBAGENT_SPAN_HOSTS_MAX) {
      // FIFO eviction: remove oldest entry and close its span
      const firstKey = subagentSpanHosts.keys().next().value!
      const evicted = subagentSpanHosts.get(firstKey)
      if (evicted) {
        try { evicted.span.end() } catch { /* best-effort */ }
      }
      subagentSpanHosts.delete(firstKey)
    }
    subagentSpanHosts.set(sessionID, {
      hostSessionID: info.parentID,
      active: parentActive,
      span: subagentSpan,
    })

    metrics.spansCreated++
  }
},
"onSessionCreated")

/**
 * Handle session.idle event — finalize the trace or subagent span.
 *
 * Uses queueMicrotask to delay finalization, ensuring any concurrent
 * message.updated events in the same call stack complete first.
 */
export const onSessionIdle = safe(function onSessionIdle(
  payload: SessionIdlePayload,
  deps: SessionHookDeps,
): void {
  const { sessionID } = payload
  const { activeTraces, subagentSpanHosts, metrics, onFlush } = deps

  const active = activeTraces.get(sessionID)
  if (!active) return

  queueMicrotask(async () => {
    try {
      // Close any remaining open tool spans
      for (const span of active.toolSpans.values()) {
        span.end()
        metrics.spansClosed++
      }
      active.toolSpans.clear()

      // Clean up bridge entry regardless of root/child
      subagentSpanHosts.delete(sessionID)

      if (active.parentSpan) {
        // ── Child session: close subagent span only ───────────────────
        active.parentSpan.update({
          output: active.lastOutput ? { response: active.lastOutput } : {},
          metadata: {
            usage: active.usage,
            totalTokens: totalTokens(active.usage),
          },
        })
        active.parentSpan.end()
        metrics.spansClosed++
        activeTraces.delete(sessionID)
        // Do NOT close the root trace — parent session is responsible
      } else {
        // ── Root session: finalize the entire Trace ───────────────────
        active.trace.update({
          output: active.lastOutput ? { response: active.lastOutput } : {},
          metadata: {
            usage: active.usage,
            totalTokens: totalTokens(active.usage),
            ...active.metadata,
          },
        })
        active.trace.end()
        metrics.tracesFinalized++
        activeTraces.delete(sessionID)
        await onFlush()
      }
    } catch (err) {
      console.error(
        `[opik-opencode] Error finalizing session ${sessionID}:`,
        err,
      )
      metrics.errors++
    }
  })
},
"onSessionIdle")
