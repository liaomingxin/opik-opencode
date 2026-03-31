/**
 * Session lifecycle hooks.
 *
 * Handles session.created and session.idle events.
 * Manages Opik Trace creation/finalization and multiagent parent/child linking.
 */

import type {
  ActiveTrace,
  SessionCreatedPayload,
  SessionIdlePayload,
  ExporterMetrics,
} from "../types.js"
import { SPAN_TYPE } from "../constants.js"
import { safe } from "../helpers.js"

export interface SessionHookDeps {
  opikClient: any
  activeTraces: Map<string, ActiveTrace>
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
  const { opikClient, activeTraces, metrics, projectName } = deps

  if (!info.parentID) {
    // ── Root session → new Trace ──────────────────────────────────────
    const trace = opikClient.trace({
      name: `opencode-${info.title ?? info.slug ?? sessionID}`,
      input: {},
      metadata: {
        sessionID,
        slug: info.slug,
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
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      metadata: { sessionID, slug: info.slug },
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
      name: `subagent:${info.title ?? info.slug ?? sessionID}`,
      type: SPAN_TYPE.AGENT,
      metadata: {
        childSessionID: sessionID,
        parentSessionID: info.parentID,
        slug: info.slug,
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
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      metadata: {
        sessionID,
        parentSessionID: info.parentID,
        slug: info.slug,
      },
    })

    // Parent tracks its children
    parentActive.subagentSpans.set(sessionID, subagentSpan)

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
  const { activeTraces, metrics, onFlush } = deps

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

      if (active.parentSpan) {
        // ── Child session: close subagent span only ───────────────────
        active.parentSpan.update({
          output: active.lastOutput ? { response: active.lastOutput } : {},
          metadata: { usage: active.usage },
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
