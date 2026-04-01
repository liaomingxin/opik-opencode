# Changelog

All notable changes to `@liaomx/opik-opencode` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-02

### Added

- **Core Plugin** — `createOpikPlugin()` factory and default `OpikPlugin` export
- **LLM Tracing** — `chat.message` → LLM span creation, `message.updated` → span close with token usage
- **Tool Tracing** — `tool.execute.before/after` → tool span lifecycle with 3-level sessionID fallback
- **Multiagent Support** — Parent/child session mapping to Opik traces with nested subagent spans
- **Streaming Text** — `message.part.updated` delta accumulation for complete LLM output capture
- **Session Status** — `session.status` event tracking (busy/idle/retry metadata updates)
- **Auto-Flush** — Exponential backoff retry (configurable retries, base/max delay)
- **Trace Expiry** — Automatic cleanup of inactive traces (configurable timeout and scan interval)
- **Payload Sanitization** — Media reference redaction, internal marker removal, untrusted block cleanup
- **Interactive CLI** — `npx opik-opencode configure` wizard with 3 deployment modes (Cloud/Self-hosted/Local)
- **Status Command** — `npx opik-opencode status` to display current config with API key masking
- **Configuration** — 3-level priority merge: explicit config > opencode.json plugin options > env vars > defaults
- **OpenCode v1.3.10 Adaptation** — Full compatibility with real OpenCode event model:
  - `event` catch-all handler for session/message lifecycle events
  - Direct hook keys for `chat.message`, `tool.execute.before/after`
  - Lazy trace creation when `chat.message` arrives before `session.created`
  - Message deduplication by messageID
  - `session.updated` handling for title updates
  - `server.instance.disposed` graceful shutdown

### Architecture

- Plugin entry (`index.ts`) with event catch-all + direct hook key handlers
- `OpikService` — Core service managing Opik client, trace lifecycle, flush retry, and expiry scanning
- Hook modules: `session.ts`, `llm.ts`, `tool.ts` — Event-specific logic
- `configure.ts` / `configure-cli.ts` — Interactive configuration wizard and CLI
- `payload-sanitizer.ts` — Data sanitization pipeline
- `helpers.ts` — Utility functions (resolveConfig, safe(), backoff, sleep, generateId)
- `types.ts` — Full TypeScript type definitions adapted from OpenCode SDK
- `constants.ts` — Default values and event name constants

### Testing

- 129 unit + smoke tests (vitest)
- 22 end-to-end integration tests
- Full test coverage for all hook modules, service lifecycle, config, helpers, and plugin API surface

[Unreleased]: https://github.com/liaomingxin/opik-opencode/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/liaomingxin/opik-opencode/releases/tag/v0.1.0
