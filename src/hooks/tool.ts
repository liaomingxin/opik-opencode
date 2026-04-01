/**
 * Tool execution hooks — handle tool.execute.before and tool.execute.after.
 *
 * These are direct hook keys in the Hooks interface.
 * Maps to openclaw's before_tool_call / after_tool_call events.
 */

import type {
  ActiveTrace,
  SubagentSpanHost,
  ToolBeforePayload,
  ToolAfterPayload,
  ExporterMetrics,
} from "../types.js"
import { SPAN_TYPE } from "../constants.js"
import { safe } from "../helpers.js"
import { sanitizePayload } from "../payload-sanitizer.js"
import { resolveSessionSpanContainer } from "../resolve.js"

export interface ToolHookDeps {
  activeTraces: Map<string, ActiveTrace>
  subagentSpanHosts: Map<string, SubagentSpanHost>
  metrics: ExporterMetrics
  sanitize: boolean
}

/**
 * Resolve the ActiveTrace for a given sessionID with 3-level fallback.
 *
 * 1. Exact match by sessionID (via resolveSessionSpanContainer)
 * 2. If only one active trace exists, use it
 * 3. Use the most recently active trace
 *
 * This mirrors opik-openclaw's degradation strategy for tool.execute.after.
 */
function resolveActiveTraceWithFallback(
  sessionID: string | undefined,
  activeTraces: Map<string, ActiveTrace>,
  subagentSpanHosts: Map<string, SubagentSpanHost>,
): { active: ActiveTrace; anchor: any } | undefined {
  // Level 1: exact match via resolver (includes bridge lookup)
  if (sessionID) {
    const container = resolveSessionSpanContainer(sessionID, activeTraces, subagentSpanHosts)
    if (container) return { active: container.active, anchor: container.parent }
  }

  // Level 2: single active trace
  if (activeTraces.size === 1) {
    const active = activeTraces.values().next().value!
    return { active, anchor: active.parentSpan ?? active.trace }
  }

  // Level 3: most recently active
  if (activeTraces.size > 0) {
    let mostRecent: ActiveTrace | undefined
    let maxTime = 0
    for (const trace of activeTraces.values()) {
      if (trace.lastActiveAt > maxTime) {
        maxTime = trace.lastActiveAt
        mostRecent = trace
      }
    }
    if (mostRecent) {
      return { active: mostRecent, anchor: mostRecent.parentSpan ?? mostRecent.trace }
    }
  }

  return undefined
}

/**
 * Handle tool.execute.before — create a Tool Span.
 */
export const onToolBefore = safe(function onToolBefore(
  payload: ToolBeforePayload,
  deps: ToolHookDeps,
): void {
  const { tool, sessionID, callID, args } = payload
  const { activeTraces, subagentSpanHosts, metrics, sanitize } = deps

  const resolved = resolveActiveTraceWithFallback(sessionID, activeTraces, subagentSpanHosts)
  if (!resolved) return
  const { active, anchor } = resolved

  const inputData = sanitize ? sanitizePayload(args) : args

  const toolSpan = anchor.span({
    name: `tool:${tool}`,
    type: SPAN_TYPE.TOOL,
    startTime: new Date(),
    input: inputData,
    metadata: {
      toolName: tool,
      callID,
      sessionID,
    },
  })

  active.toolSpans.set(callID, toolSpan)
  active.lastActiveAt = Date.now()
  metrics.spansCreated++
},
"onToolBefore")

/**
 * Handle tool.execute.after — update and close the Tool Span.
 *
 * Real hook signature:
 *   (input: {tool, sessionID, callID, args},
 *    output: {title, output: string, metadata})
 *
 * Note: there is no `error` field in the real API output.
 */
export const onToolAfter = safe(function onToolAfter(
  payload: ToolAfterPayload,
  deps: ToolHookDeps,
): void {
  const { tool, sessionID, callID, title, output, metadata } = payload
  const { activeTraces, subagentSpanHosts, metrics, sanitize } = deps

  const resolved = resolveActiveTraceWithFallback(sessionID, activeTraces, subagentSpanHosts)
  if (!resolved) return
  const { active } = resolved

  const span = active.toolSpans.get(callID)
  if (!span) return

  const outputData = sanitize ? sanitizePayload(output) : output

  span.update({
    output: { result: outputData },
    metadata: {
      ...metadata,
      toolName: tool,
      ...(title ? { title } : {}),
    },
  })

  span.end()
  active.toolSpans.delete(callID)
  active.lastActiveAt = Date.now()
  metrics.spansClosed++
},
"onToolAfter")
