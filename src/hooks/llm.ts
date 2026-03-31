/**
 * LLM hooks — handle chat.message (input) and message.updated (output).
 *
 * Maps to openclaw's llm_input / llm_output events.
 */

import type {
  ActiveTrace,
  LlmInputPayload,
  LlmOutputPayload,
  ExporterMetrics,
} from "../types.js"
import { SPAN_TYPE } from "../constants.js"
import { safe } from "../helpers.js"
import { sanitizePayload } from "../payload-sanitizer.js"

export interface LlmHookDeps {
  activeTraces: Map<string, ActiveTrace>
  metrics: ExporterMetrics
  sanitize: boolean
}

/**
 * Handle chat.message — LLM input.
 *
 * Creates a new LLM Span under the session's trace (or subagent span).
 */
export const onLlmInput = safe(function onLlmInput(
  payload: LlmInputPayload,
  deps: LlmHookDeps,
): void {
  const { sessionID, content, model, provider, systemPrompt } = payload
  const { activeTraces, metrics, sanitize } = deps

  const active = activeTraces.get(sessionID)
  if (!active) return

  const inputData = sanitize
    ? sanitizePayload({ messages: content, systemPrompt })
    : { messages: content, systemPrompt }

  // Anchor span: if child session, nest under parentSpan; else under trace
  const anchor = active.parentSpan ?? active.trace

  const llmSpan = anchor.span({
    name: "llm",
    type: SPAN_TYPE.LLM,
    input: inputData,
    metadata: {
      sessionID,
      model,
      provider,
    },
  })

  active.currentSpan = llmSpan
  active.lastActiveAt = Date.now()
  metrics.spansCreated++
},
"onLlmInput")

/**
 * Handle message.updated — LLM output (streaming completion).
 *
 * Updates the current LLM Span with output and usage, then closes it.
 */
export const onLlmOutput = safe(function onLlmOutput(
  payload: LlmOutputPayload,
  deps: LlmHookDeps,
): void {
  const { sessionID, content, model, tokens } = payload
  const { activeTraces, metrics, sanitize } = deps

  const active = activeTraces.get(sessionID)
  if (!active || !active.currentSpan) return

  const outputData = sanitize
    ? sanitizePayload({ response: content })
    : { response: content }

  active.currentSpan.update({
    output: outputData,
    metadata: { model },
    usage: tokens
      ? {
          prompt_tokens: tokens.inputTokens,
          completion_tokens: tokens.outputTokens,
          total_tokens: tokens.totalTokens,
        }
      : undefined,
  })

  active.currentSpan.end()
  metrics.spansClosed++

  // Accumulate usage on the trace level
  if (tokens) {
    active.usage.inputTokens += tokens.inputTokens
    active.usage.outputTokens += tokens.outputTokens
    active.usage.totalTokens += tokens.totalTokens
  }

  // Track last output for trace finalization
  if (content) {
    active.lastOutput = typeof content === "string" ? content : String(content)
  }

  active.currentSpan = null
  active.lastActiveAt = Date.now()
},
"onLlmOutput")
