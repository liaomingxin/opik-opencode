/**
 * @liaomx/opik-opencode — OpenCode plugin for Opik observability.
 *
 * Traces LLM calls, tool executions, and multiagent (parent/child session)
 * lifecycles to the Opik platform for monitoring and evaluation.
 *
 * Architecture: Session lifecycle events (session.created, session.updated,
 * session.idle, message.updated, message.part.updated) are NOT direct hook
 * keys in the OpenCode Hooks interface. They are Event types that must be
 * captured via the `event` catch-all handler. Only chat.message,
 * tool.execute.before, and tool.execute.after are valid direct hook keys.
 *
 * Key adaptations for OpenCode v1.3.10+:
 *   - OpenCode fires `session.updated` (not `session.created`) for new sessions
 *   - `chat.message` may arrive before `session.updated` — lazy trace creation
 *   - `message.updated` fires multiple times per message — deduplicate by messageID
 *   - `message.part.updated` sends full `part.text` (not incremental deltas)
 *   - `server.instance.disposed` signals process exit — flush pending data
 *
 * Usage:
 *   1. Local plugin:  place in .opencode/plugins/ or reference in opencode.json
 *   2. npm plugin:    add "@liaomx/opik-opencode" to opencode.json plugins array
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
import { loadOpikConfigFile } from "./src/config-file.js"

/**
 * Extract readable text content from an AssistantMessage object.
 * Handles string content, array content blocks, and fallback to empty.
 */
function extractContentFromMessage(msg: any): string {
  if (typeof msg.content === "string") return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((c: any) => (typeof c === "string" ? c : c?.text ?? ""))
      .join("")
  }
  return ""
}

/**
 * Create the Opik OpenCode plugin with optional configuration.
 *
 * Configuration priority: explicit `config` param > opencode.json plugin
 * options (received as `pluginOptions`) > environment variables > defaults.
 */
// ── Debug event logger ────────────────────────────────────────────────────────
// Set OPIK_DEBUG=1 to enable full event timeline dump.
// Writes directly to /tmp/opik-debug.log via fs.appendFileSync to bypass
// OpenCode TUI's stderr capture.
import { appendFileSync } from "fs"

const DEBUG = process.env.OPIK_DEBUG === "1"
const DEBUG_LOG_PATH = process.env.OPIK_DEBUG_LOG ?? "/tmp/opik-debug.log"
let _debugSeq = 0

function debugLog(direction: "event" | "hook", type: string, payload: unknown): void {
  if (!DEBUG) return
  const seq = ++_debugSeq
  const ts = new Date().toISOString().slice(11, 23) // HH:MM:SS.mmm
  const prefix = `[opik-debug] #${String(seq).padStart(3, "0")} ${ts} ${direction}:${type}`

  let line: string
  if (type === "message.part.updated") {
    // High-volume — only print part type + text length to avoid noise
    const p = (payload as any)
    const partType = p?.part?.type ?? "?"
    const textLen = typeof p?.part?.text === "string" ? p.part.text.length : "?"
    line = `${prefix}  part.type=${partType} text.len=${textLen}\n`
  } else {
    let body: string
    try {
      body = JSON.stringify(payload, null, 2)
      if (body.length > 1200) body = body.slice(0, 1200) + "\n  ... (truncated)"
    } catch {
      body = String(payload)
    }
    line = `${prefix}\n${body}\n`
  }

  try {
    appendFileSync(DEBUG_LOG_PATH, line)
  } catch {
    // best-effort: if file write fails, silently ignore
  }
}

export function createOpikPlugin(config?: Partial<OpikPluginConfig>): Plugin {
  return async (_ctx, pluginOptions) => {
    // Merge: explicit config > opencode.json plugin options > config file > env vars > defaults
    const optionsFromConfig = (pluginOptions ?? {}) as Partial<OpikPluginConfig>
    const mergedConfig = { ...optionsFromConfig, ...config }

    // Load independent config file (project-level or user-level)
    const projectDir = (_ctx as any)?.directory as string | undefined
    const fileConfig = loadOpikConfigFile(projectDir)

    const service = new OpikService()
    await service.start(mergedConfig, fileConfig)

    if (DEBUG) {
      console.error("[opik-debug] Event timeline logging ENABLED (OPIK_DEBUG=1)")
    }

    return {
      // ── Event catch-all handler ──────────────────────────────────────
      // session.created/updated, session.idle, session.status,
      // message.updated, message.part.updated, and server.instance.disposed
      // are NOT valid Hooks keys — they must be caught via the generic
      // `event` handler.
      event: async (input: { event: any }) => {
        const { event } = input ?? {}
        if (!event?.type) return

        debugLog("event", event.type, event.properties)

        switch (event.type) {
          case "session.created":
          case "session.updated": {
            const session = event.properties?.info
            if (!session) return
            // session.updated fires multiple times (creation + title update + etc.)
            // Only create trace on first occurrence; update title on subsequent calls
            if (service.hasActiveTrace(session.id)) {
              if (session.title) {
                service.updateTraceTitle(session.id, session.title)
              }
              break
            }
            // Skip if this session was already finalized (idle already processed)
            if (service.wasFinalized(session.id)) break
            service.handleSessionCreated({
              sessionID: session.id,
              info: {
                id: session.id,
                projectID: session.projectID,
                directory: session.directory,
                parentID: session.parentID,
                title: session.title,
                version: session.version,
                time: session.time,
              },
            })
            break
          }

          case "session.idle": {
            const sessionID = event.properties?.sessionID
            if (!sessionID) return
            service.handleSessionIdle({ sessionID })
            break
          }

          case "session.status": {
            const props = event.properties
            if (!props?.sessionID || !props?.status) return
            service.handleSessionStatus({
              sessionID: props.sessionID,
              status: props.status,
            })
            break
          }

          case "message.updated": {
            const props = event.properties ?? {}
            const msg = props.info ?? props
            if (!msg || msg.role !== "assistant") return
            // message.updated fires multiple times per assistant message:
            //   1. creation (tokens=0/undefined, no finish) — skip
            //   2. with finish + tokens — PROCESS (first one with finish)
            //   3. duplicate with time.completed — skip (already processed)
            if (!msg.finish) return
            const tokOutput = msg.tokens?.output ?? 0
            const tokInput = msg.tokens?.input ?? 0
            if (tokOutput === 0 && tokInput === 0) return
            const sessionID = props.sessionID ?? msg.sessionID
            if (!sessionID) return
            // Deduplicate by messageID — only process each message once
            const messageID = msg.id ?? props.id
            if (messageID && service.hasProcessedMessage(messageID)) return
            if (messageID) service.markMessageProcessed(messageID)
            const content = extractContentFromMessage(msg)
            service.handleLlmOutput({
              sessionID,
              messageID,
              role: msg.role,
              modelID: msg.modelID,
              providerID: msg.providerID,
              content,
              tokens: msg.tokens,
              error: msg.error,
              finish: msg.finish,
            })
            break
          }

          case "server.instance.disposed": {
            // Process is about to exit — ensure all pending data is flushed.
            // Small delay for any pending queueMicrotask callbacks to complete.
            await new Promise(r => setTimeout(r, 100))
            await service.stop()
            break
          }

          case "message.part.updated": {
            const props = event.properties ?? {}
            const { part, delta } = props
            if (!part) return
            // sessionID can be at properties level, part level, or nested
            const sessionID = props.sessionID ?? part.sessionID ?? part.messageSessionID
            if (!sessionID) return
            service.handleMessagePartUpdated({
              sessionID,
              part,
              delta,
            })
            break
          }
        }
      },

      // ── Direct hook keys (valid Hooks interface keys) ────────────────

      "chat.message": async (
        input: {
          sessionID: string
          agent?: string
          model?: { providerID: string; modelID: string }
          messageID?: string
          variant?: string
        },
        output: { message?: unknown; parts?: unknown[] },
      ) => {
        debugLog("hook", "chat.message", {
          sessionID: input.sessionID,
          agent: input.agent,
          modelID: input.model?.modelID,
          messageID: input.messageID,
          message: output?.message,
          parts: output?.parts,
        })
        // Lazy trace creation: if chat.message arrives before session.created/updated,
        // create a minimal trace so the LLM span has somewhere to anchor.
        if (input.sessionID && !service.hasActiveTrace(input.sessionID)) {
          service.handleSessionCreated({
            sessionID: input.sessionID,
            info: {
              id: input.sessionID,
              title: input.sessionID,
            },
          })
        }

        service.handleLlmInput({
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          message: output?.message,
          parts: output?.parts,
        })
      },

      "tool.execute.before": async (
        input: { tool: string; sessionID: string; callID: string },
        output: { args: Record<string, unknown> },
      ) => {
        debugLog("hook", "tool.execute.before", {
          tool: input.tool,
          sessionID: input.sessionID,
          callID: input.callID,
        })
        service.handleToolBefore({
          tool: input.tool,
          sessionID: input.sessionID,
          callID: input.callID,
          args: output?.args ?? {},
        })
      },

      "tool.execute.after": async (
        input: {
          tool: string
          sessionID: string
          callID: string
          args?: Record<string, unknown>
        },
        output: {
          title?: string
          output?: string
          metadata?: Record<string, unknown>
        },
      ) => {
        debugLog("hook", "tool.execute.after", {
          tool: input.tool,
          sessionID: input.sessionID,
          callID: input.callID,
          title: output?.title,
          outputLen: typeof output?.output === "string" ? output.output.length : "?",
        })
        service.handleToolAfter({
          tool: input.tool,
          sessionID: input.sessionID,
          callID: input.callID,
          args: input.args,
          title: output?.title,
          output: output?.output ?? "",
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

// Re-export configure utilities for programmatic use
export {
  runOpikConfigure,
  showOpikStatus,
  getOpikPluginEntry,
  setOpikPluginEntry,
  type ConfigDeps,
} from "./src/configure.js"

// Re-export config file utilities for programmatic use
export {
  findOpikConfigPath,
  loadOpikConfigFile,
  writeOpikConfigFile,
  resolveOpikConfigWritePath,
  OPIK_CONFIG_FILENAME,
} from "./src/config-file.js"
