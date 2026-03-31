/**
 * Unit tests for payload sanitizer.
 */

import { describe, it, expect } from "vitest"
import { sanitizeString, sanitizePayload } from "../payload-sanitizer.js"

describe("sanitizeString", () => {
  it("should redact local media references", () => {
    const input = "Check this image: media:/Users/foo/img.png please"
    const result = sanitizeString(input)
    expect(result).toContain("media:<redacted>")
    expect(result).not.toContain("/Users/foo")
  })

  it("should remove reply markers", () => {
    const input = "Hello [[reply_to:abc123]] world"
    const result = sanitizeString(input)
    expect(result).toBe("Hello  world")
  })

  it("should collapse multiple newlines", () => {
    const input = "line1\n\n\n\n\nline2"
    const result = sanitizeString(input)
    expect(result).toBe("line1\n\nline2")
  })

  it("should handle empty string", () => {
    expect(sanitizeString("")).toBe("")
  })
})

describe("sanitizePayload", () => {
  it("should recursively sanitize objects", () => {
    const input = {
      content: "media:/path/to/file.png",
      nested: {
        text: "[[reply_to:xyz]]",
      },
    }
    const result = sanitizePayload(input) as any
    expect(result.content).toContain("media:<redacted>")
    expect(result.nested.text).toBe("")
  })

  it("should sanitize arrays", () => {
    const input = ["media:/a.png", "normal text"]
    const result = sanitizePayload(input) as string[]
    expect(result[0]).toContain("media:<redacted>")
    expect(result[1]).toBe("normal text")
  })

  it("should pass through non-string primitives", () => {
    expect(sanitizePayload(42)).toBe(42)
    expect(sanitizePayload(null)).toBeNull()
    expect(sanitizePayload(true)).toBe(true)
  })
})
