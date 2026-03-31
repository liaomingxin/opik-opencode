/**
 * LLM hooks — handle chat.message (input), message.updated (output),
 * and message.part.updated (streaming deltas).
 *
 * chat.message is a direct hook key in the Hooks interface.
 * message.updated and message.part.updated are Events via the catch-all handler.
 */

import type {
  ActiveTrace,
  LlmInputPayload,
  LlmOutputPayload,
  MessagePartUpdatedPayload,
  ExporterMetrics,
} from "../types.js"
import { totalTokens } from "../types.js"
import { SPAN_TYPE } from "../constants.js"
import { safe } from "../helpers.js"
import { sanitizePayload } from "../payload-sanitizer.js"

export interface LlmHookDeps {
  activeTraces: Map<string, ActiveTrace>
  metrics: ExporterMetrics
  sanitize: boolean
}

/**
 * Extract readable content string from a UserMessage + parts.
 */
function extractUserContent(
  message: unknown,
  parts: unknown[] | undefined,
): string {
  // UserMessage has content field (string or array of content blocks)
  if (message && typeof message === "object") {
    const msg = message as Record<string, unknown>
    if (typeof msg.content === "string") return msg.content
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((c: any) => (typeof c === "string" ? c : c?.text ?? ""))
        .join("\n")
    }
  }
  // Fallback: try to serialize parts
  if (parts && parts.length > 0) {
    return parts
      .map((p: any) => p?.text ?? "")
      .filter(Boolean)
      .join("\n")
  }
  return ""
}

/**
 * Handle chat.message — LLM input.
 *
 * Creates a new LLM Span under the session's trace (or subagent span).
 *
 * Real hook signature:
 *   (input: {sessionID, agent?, model?: {providerID, modelID}},
 *    output: {message: UserMessage, parts: Part[]})
 */
export const onLlmInput = safe(function onLlmInput(
  payload: LlmInputPayload,
  deps: LlmHookDeps,
): void {
  const { sessionID, model, agent, message, parts } = payload
  const { activeTraces, metrics, sanitize } = deps

  const active = activeTraces.get(sessionID)
  if (!active) return

  // Extract user content from message/parts for span input
  const userContent = extractUserContent(message, parts)
  const inputData = sanitize
    ? sanitizePayload({ messages: userContent })
    : { messages: userContent }

  // Anchor span: if child session, nest under parentSpan; else under trace
  const anchor = active.parentSpan ?? active.trace

  const llmSpan = anchor.span({
    name: "llm",
    type: SPAN_TYPE.LLM,
    input: inputData,
    metadata: {
      sessionID,
      agent,
      modelID: model?.modelID,
      providerID: model?.providerID,
    },
  })

  active.currentSpan = llmSpan
  active.modelInfo = model
    ? { providerID: model.providerID, modelID: model.modelID }
    : undefined
  active.streamingText = "" // reset for new LLM turn
  active.lastActiveAt = Date.now()
  metrics.spansCreated++
},
"onLlmInput")

/**
 * Handle message.updated — LLM output (via event catch-all).
 *
 * Updates the current LLM Span with output and usage, then closes it.
 * Uses accumulated streamingText from message.part.updated if available.
 */
export const onLlmOutput = safe(function onLlmOutput(
  payload: LlmOutputPayload,
  deps: LlmHookDeps,
): void {
  const { sessionID, content, modelID, providerID, tokens, error } = payload
  const { activeTraces, metrics, sanitize } = deps

  const active = activeTraces.get(sessionID)
  if (!active) return

  // If no currentSpan exists (chat.message only fires once, but message.updated
  // fires for each LLM turn including after tool-calls), create a new LLM span.
  if (!active.currentSpan) {
    const anchor = active.parentSpan ?? active.trace
    active.currentSpan = anchor.span({
      name: "llm",
      type: SPAN_TYPE.LLM,
      input: {},
      metadata: {
        sessionID,
        modelID: modelID ?? active.modelInfo?.modelID,
        providerID: providerID ?? active.modelInfo?.providerID,
      },
    })
    metrics.spansCreated++
  }

  // Use accumulated streaming text if available, fall back to content
  const outputText = active.streamingText || content || ""
  const outputData = sanitize
    ? sanitizePayload({ response: outputText })
    : { response: outputText }

  active.currentSpan.update({
    output: outputData,
    metadata: {
      modelID: modelID ?? active.modelInfo?.modelID,
      providerID: providerID ?? active.modelInfo?.providerID,
      ...(error ? { error } : {}),
    },
    usage: tokens
      ? {
          prompt_tokens: tokens.input,
          completion_tokens: tokens.output,
          total_tokens: totalTokens(tokens),
        }
      : undefined,
  })

  active.currentSpan.end()
  metrics.spansClosed++

  // Accumulate usage on the trace level
  if (tokens) {
    active.usage.input += tokens.input
    active.usage.output += tokens.output
    active.usage.reasoning += tokens.reasoning
    active.usage.cache.read += tokens.cache.read
    active.usage.cache.write += tokens.cache.write
  }

  // Track last output for trace finalization
  if (outputText) {
    active.lastOutput =
      typeof outputText === "string" ? outputText : String(outputText)
  }

  active.currentSpan = null
  active.streamingText = "" // reset after span closes
  active.lastActiveAt = Date.now()
},
"onLlmOutput")

/**
 * Handle message.part.updated — accumulate streaming text deltas.
 *
 * Called via the event catch-all handler for incremental token streaming.
 */
export const onMessagePartUpdated = safe(function onMessagePartUpdated(
  payload: MessagePartUpdatedPayload,
  deps: LlmHookDeps,
): void {
  const { sessionID, part, delta } = payload
  const { activeTraces } = deps

  const active = activeTraces.get(sessionID)
  if (!active) return

  // OpenCode sends full part.text (not incremental deltas).
  // For type=text parts, replace streamingText with the latest full text.
  if (part?.type === "text" && typeof part.text === "string") {
    active.streamingText = part.text
  } else if (delta) {
    // Fallback: accumulate deltas if provided
    active.streamingText += delta
  }

  active.lastActiveAt = Date.now()
},
"onMessagePartUpdated")
