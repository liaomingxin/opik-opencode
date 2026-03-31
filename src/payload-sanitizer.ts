/**
 * Payload sanitizer - cleans data before sending to Opik.
 *
 * Mirrors opik-openclaw's sanitization strategy:
 * - Redacts local media file references
 * - Removes internal markers
 * - Removes untrusted context blocks
 * - Normalizes whitespace
 */

/** Pattern to match local media references like media:/path/to/img.png */
const MEDIA_REF_PATTERN = /media:[^\s]+/g

/** Pattern to match internal reply markers [[reply_to...]] */
const REPLY_MARKER_PATTERN = /\[\[reply_to[^\]]*\]\]/g

/** Patterns for untrusted context blocks */
const UNTRUSTED_BLOCK_PATTERNS = [
  /<!-- Conversation info -->[\s\S]*?<!-- \/Conversation info -->/g,
  /<!-- Sender info -->[\s\S]*?<!-- \/Sender info -->/g,
  /<!-- Untrusted context -->[\s\S]*?<!-- \/Untrusted context -->/g,
]

/**
 * Sanitize a string payload by removing sensitive/internal content.
 */
export function sanitizeString(input: string): string {
  let result = input

  // Redact local media references
  result = result.replace(MEDIA_REF_PATTERN, "media:<redacted>")

  // Remove internal reply markers
  result = result.replace(REPLY_MARKER_PATTERN, "")

  // Remove untrusted context blocks
  for (const pattern of UNTRUSTED_BLOCK_PATTERNS) {
    result = result.replace(pattern, "")
  }

  // Normalize whitespace (collapse multiple newlines)
  result = result.replace(/\n{3,}/g, "\n\n")

  return result.trim()
}

/**
 * Recursively sanitize an object/array payload.
 */
export function sanitizePayload(input: unknown): unknown {
  if (typeof input === "string") {
    return sanitizeString(input)
  }

  if (Array.isArray(input)) {
    return input.map(sanitizePayload)
  }

  if (input !== null && typeof input === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input)) {
      result[key] = sanitizePayload(value)
    }
    return result
  }

  return input
}
