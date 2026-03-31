/**
 * Tool execution hooks — handle tool.execute.before and tool.execute.after.
 *
 * Maps to openclaw's before_tool_call / after_tool_call events.
 */

import type {
  ActiveTrace,
  ToolBeforePayload,
  ToolAfterPayload,
  ExporterMetrics,
} from "../types.js"
import { SPAN_TYPE } from "../constants.js"
import { safe } from "../helpers.js"
import { sanitizePayload } from "../payload-sanitizer.js"

export interface ToolHookDeps {
  activeTraces: Map<string, ActiveTrace>
  metrics: ExporterMetrics
  sanitize: boolean
}

/**
 * Resolve the ActiveTrace for a given sessionID with 3-level fallback.
 *
 * 1. Exact match by sessionID
 * 2. If only one active trace exists, use it
 * 3. Use the most recently active trace
 *
 * This mirrors opik-openclaw's degradation strategy for tool.execute.after.
 */
function resolveActiveTrace(
  sessionID: string | undefined,
  activeTraces: Map<string, ActiveTrace>,
): ActiveTrace | undefined {
  // Level 1: exact match
  if (sessionID) {
    const exact = activeTraces.get(sessionID)
    if (exact) return exact
  }

  // Level 2: single active trace
  if (activeTraces.size === 1) {
    return activeTraces.values().next().value
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
    return mostRecent
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
  const { activeTraces, metrics, sanitize } = deps

  const active = resolveActiveTrace(sessionID, activeTraces)
  if (!active) return

  const inputData = sanitize ? sanitizePayload(args) : args

  // Anchor: if child session, nest tool span under subagent span
  const anchor = active.parentSpan ?? active.trace

  const toolSpan = anchor.span({
    name: `tool:${tool}`,
    type: SPAN_TYPE.TOOL,
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
 */
export const onToolAfter = safe(function onToolAfter(
  payload: ToolAfterPayload,
  deps: ToolHookDeps,
): void {
  const { tool, sessionID, callID, output, error, metadata } = payload
  const { activeTraces, metrics, sanitize } = deps

  const active = resolveActiveTrace(sessionID, activeTraces)
  if (!active) return

  const span = active.toolSpans.get(callID)
  if (!span) {
    console.warn(
      `[opik-opencode] No tool span found for callID=${callID} tool=${tool}`,
    )
    return
  }

  const outputData = sanitize ? sanitizePayload(output) : output

  span.update({
    output: error ? { error } : { result: outputData },
    metadata: {
      ...metadata,
      toolName: tool,
      ...(error ? { error: true } : {}),
    },
  })

  span.end()
  active.toolSpans.delete(callID)
  active.lastActiveAt = Date.now()
  metrics.spansClosed++
},
"onToolAfter")
