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

/** Span type identifiers used in Opik */
export const SPAN_TYPE = {
  LLM: "llm",
  TOOL: "tool",
  AGENT: "agent",
  GENERAL: "general",
} as const

/** OpenCode event names we subscribe to */
export const OPENCODE_EVENTS = {
  SESSION_CREATED: "session.created",
  SESSION_IDLE: "session.idle",
  CHAT_MESSAGE: "chat.message",
  MESSAGE_UPDATED: "message.updated",
  TOOL_EXECUTE_BEFORE: "tool.execute.before",
  TOOL_EXECUTE_AFTER: "tool.execute.after",
} as const
