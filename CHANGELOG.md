# Changelog

All notable changes to `@liaomx/opik-opencode` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-04-01

### Added

- **Thread 聚合** — Trace 创建时自动设置 `threadId = sessionID`，Opik 后端可按 Thread 维度聚合同一会话的所有 Trace ([Task 1])
- **统一容器解析** — 新增 `resolveSessionSpanContainer()` 统一函数（`src/resolve.ts`），替代各 hook 中分散的 `anchor = parentSpan ?? trace` 逻辑 ([Task 2])
- **跨会话桥接层** — 新增 `subagentSpanHosts` Map，解决 Multiagent 场景下事件乱序导致子 agent 数据丢失的问题，FIFO 淘汰策略（最大 1000 条） ([Task 3])
- **LLM Span 多轮命名** — LLM span 名称包含模型名和轮次号，如 `claude-sonnet-4-5`（首轮）/ `claude-sonnet-4-5 #2`（后续） ([Task 4])
- `ActiveTrace` 新增 `llmTurnCount` 字段，追踪每个 session 的 LLM 调用轮次
- `SubagentSpanHost` 类型定义和 `SpanContainer` 返回类型
- `SUBAGENT_SPAN_HOSTS_MAX = 1000` 常量

### Changed

- `src/hooks/session.ts` — `onSessionCreated` 中 root session 的 `opikClient.trace()` 调用新增 `threadId` 参数；child session 注册桥接表
- `src/hooks/llm.ts` — 使用 `resolveSessionSpanContainer()` 替代硬编码 anchor；span 命名使用 `modelID + 轮次号`
- `src/hooks/tool.ts` — 使用 `resolveSessionSpanContainer()` 替代硬编码 anchor
- `src/service.ts` — 新增 `subagentSpanHosts` 状态管理、桥接注册/查询/清除方法

### Testing

- 所有 hook 测试更新以验证 `threadId`、桥接层、统一解析器、LLM 轮次命名
- `session.test.ts` — 验证 `trace()` 调用包含 `threadId`，桥接注册/清除
- `llm.test.ts` — 验证 span name 包含 model + 轮次号
- `tool.test.ts` — 验证通过 resolver 创建 span
- `service.e2e.test.ts` — 验证完整 round-trip 中 trace 携带 threadId，子 session 通过桥接正确挂载
- `plugin.smoke.test.ts` — multiagent 场景验证

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

[Unreleased]: https://github.com/liaomingxin/opik-opencode/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/liaomingxin/opik-opencode/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/liaomingxin/opik-opencode/releases/tag/v0.1.0
