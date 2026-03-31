/**
 * @opik/opik-opencode — OpenCode plugin for Opik observability.
 *
 * Traces LLM calls, tool executions, and multiagent (parent/child session)
 * lifecycles to the Opik platform for monitoring and evaluation.
 *
 * Usage:
 *   1. Local plugin:  place in .opencode/plugins/ or reference in opencode.json
 *   2. npm plugin:    add "@opik/opik-opencode" to opencode.json plugins array
 *
 * Configuration (env vars or opencode.json):
 *   OPIK_API_KEY        — Opik API key
 *   OPIK_API_URL        — Opik API URL
 *   OPIK_PROJECT_NAME   — Opik project name (default: "opencode")
 *   OPIK_WORKSPACE_NAME — Opik workspace name
 */

import type { Plugin } from "@opencode-ai/plugin"
import { OpikService } from "./src/service.js"
import type { OpikPluginConfig } from "./src/types.js"

/**
 * Create the Opik OpenCode plugin with optional configuration.
 */
export function createOpikPlugin(config?: Partial<OpikPluginConfig>): Plugin {
  return async (ctx) => {
    const service = new OpikService()
    await service.start(config)

    return {
      // ── Session lifecycle ─────────────────────────────────────────
      "session.created": async (input: any) => {
        service.handleSessionCreated({
          sessionID: input.sessionID ?? input.id,
          info: {
            parentID: input.info?.parentID ?? input.parentID,
            title: input.info?.title ?? input.title,
            slug: input.info?.slug ?? input.slug,
          },
        })
      },

      "session.idle": async (input: any) => {
        service.handleSessionIdle({
          sessionID: input.sessionID ?? input.id,
        })
      },

      // ── LLM input/output ─────────────────────────────────────────
      "chat.message": async (input: any) => {
        service.handleLlmInput({
          sessionID: input.sessionID,
          content: input.content ?? input.message,
          model: input.model,
          provider: input.provider,
          systemPrompt: input.systemPrompt,
        })
      },

      "message.updated": async (input: any) => {
        service.handleLlmOutput({
          sessionID: input.sessionID,
          content: input.content ?? input.message,
          model: input.model,
          tokens: input.tokens ?? input.usage,
        })
      },

      // ── Tool execution ────────────────────────────────────────────
      "tool.execute.before": async (input: any, output: any) => {
        service.handleToolBefore({
          tool: input.tool,
          sessionID: input.sessionID,
          callID: input.callID ?? `${input.tool}-${Date.now()}`,
          args: output?.args ?? input.args ?? {},
        })
      },

      "tool.execute.after": async (input: any, output: any) => {
        service.handleToolAfter({
          tool: input.tool,
          sessionID: input.sessionID,
          callID: input.callID ?? `${input.tool}-${Date.now()}`,
          output: output?.result ?? output,
          error: output?.error,
          metadata: output?.metadata,
        })
      },
    }
  }
}

/**
 * Default export — plugin with auto-configuration from environment variables.
 */
export const OpikPlugin: Plugin = createOpikPlugin()

export default OpikPlugin

// Re-export types for consumers
export type { OpikPluginConfig } from "./src/types.js"
export { OpikService } from "./src/service.js"
