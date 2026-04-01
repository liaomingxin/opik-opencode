/**
 * Default configuration constants.
 */

export const DEFAULTS = {
  PROJECT_NAME: "opencode",
  FLUSH_RETRIES: 2,
  FLUSH_RETRY_BASE_DELAY: 250,
  FLUSH_RETRY_MAX_DELAY: 5000,
  TRACE_EXPIRE_MINUTES: 5,
  EXPIRE_SCAN_INTERVAL: 60_000,
} as const

/** Maximum number of subagent span host entries (FIFO eviction) */
export const SUBAGENT_SPAN_HOSTS_MAX = 1000

/** Span type identifiers used in Opik */
export const SPAN_TYPE = {
  LLM: "llm",
  TOOL: "tool",
  AGENT: "agent",
  GENERAL: "general",
} as const

/** OpenCode event names we subscribe to */
export const OPENCODE_EVENTS = {
  // Events only accessible via the `event` catch-all handler
  SESSION_CREATED: "session.created",
  SESSION_UPDATED: "session.updated",
  SESSION_IDLE: "session.idle",
  SESSION_STATUS: "session.status",
  MESSAGE_UPDATED: "message.updated",
  MESSAGE_PART_UPDATED: "message.part.updated",
  // Direct hook keys in the Hooks interface
  CHAT_MESSAGE: "chat.message",
  TOOL_EXECUTE_BEFORE: "tool.execute.before",
  TOOL_EXECUTE_AFTER: "tool.execute.after",
} as const
