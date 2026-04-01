/**
 * Unified session-to-span-container resolver.
 *
 * Checks subagentSpanHosts (cross-session bridge) first, then activeTraces.
 * This ensures child session events find their parent even under event reordering.
 */

import type { ActiveTrace, SubagentSpanHost, SpanContainer } from "./types.js"

/**
 * Resolve the span container (parent Trace or Span) for a given sessionID.
 *
 * 1. Check subagentSpanHosts — child sessions bridged to a host session
 * 2. Check activeTraces — direct lookup, anchor is parentSpan ?? trace
 */
export function resolveSessionSpanContainer(
  sessionID: string,
  activeTraces: Map<string, ActiveTrace>,
  subagentSpanHosts: Map<string, SubagentSpanHost>,
): SpanContainer | undefined {
  // 1. Bridge lookup (child session → host session's subagent span)
  const spanHost = subagentSpanHosts.get(sessionID)
  if (spanHost) {
    return {
      sessionID: spanHost.hostSessionID,
      active: spanHost.active,
      parent: spanHost.span,
    }
  }

  // 2. Direct lookup
  const active = activeTraces.get(sessionID)
  if (active) {
    return {
      sessionID,
      active,
      parent: active.parentSpan ?? active.trace,
    }
  }

  return undefined
}
