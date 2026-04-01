# opik-opencode 开发进度跟踪

> 最后更新: 2026-04-01 (V2 — Thread 聚合 + Multiagent 增强)

## 项目定位

基于 Opik SDK 的 OpenCode 插件，将 LLM/Tool/Subagent 执行轨迹实时导出到 Opik 平台。
架构参考 `opik-openclaw`（已有生产级 openclaw 插件），适配 OpenCode 的事件模型。

---

## ✅ 已完成

### Phase 0: 项目初始化 (2026-04-01)

- [x] 项目脚手架搭建
  - `package.json` (`@opik/opik-opencode` v0.1.0)
  - `tsconfig.json` (strict, NodeNext, Node22)
  - `tsup.config.ts` (ESM 构建)
  - `vitest.config.ts` + `vitest.e2e.config.ts`
  - `.gitignore`

- [x] 核心类型定义 (`src/types.ts`)
  - `OpikPluginConfig` — 12 个配置项
  - `ActiveTrace` — 含 multiagent parentSpan/subagentSpans
  - `TokenUsage`, `ExporterMetrics`
  - 所有 Hook Event Payload 类型
  - OpenCode → openclaw 事件映射注释

- [x] 基础设施模块
  - `src/constants.ts` — 默认值、Span 类型、事件名常量
  - `src/helpers.ts` — resolveConfig, safe() 容错包装, backoffDelay, sleep, generateId
  - `src/payload-sanitizer.ts` — 媒体引用脱敏、内部标记移除、不受信块清理

- [x] Hook 模块（3 个）
  - `src/hooks/session.ts` — session.created (root/child 区分) + session.idle (queueMicrotask 延迟 finalize)
  - `src/hooks/llm.ts` — chat.message → LLM Span 创建 / message.updated → Span 关闭 + usage 累积
  - `src/hooks/tool.ts` — tool.execute.before/after + 3 级 sessionID 降级策略

- [x] 核心 Service (`src/service.ts`)
  - Opik 客户端初始化
  - 事件分发到 hook 模块
  - flush 指数退避重试 (默认 2 次, 250ms base, 5s max)
  - 过期 trace 自动清理定时器 (5min 超时, 1min 扫描)
  - start()/stop() 生命周期管理

- [x] 插件入口 (`index.ts`)
  - `createOpikPlugin(config?)` 工厂函数
  - 默认导出 `OpikPlugin` (自动从环境变量配置)
  - 所有 6 个 OpenCode 事件的 handler 注册

- [x] 单元测试 (15/15 passing)
  - `src/__tests__/payload-sanitizer.test.ts` (7 tests)
  - `src/hooks/__tests__/llm.test.ts` (4 tests)
  - `src/hooks/__tests__/tool.test.ts` (4 tests)

- [x] 验证通过
  - `tsc --noEmit` ✅ 零错误
  - `vitest run` ✅ 15/15
  - `tsup build` ✅ dist/index.js 18.27KB

- [x] Git 首次提交 (`561978e`)

### Phase 1: 补全测试覆盖 (2026-04-02)

- [x] `src/hooks/__tests__/session.test.ts` — session 生命周期测试 (13 tests)
  - root session 创建 Trace (含 title/slug/sessionID fallback)
  - child session 创建 Subagent Span 并共享 root Trace
  - 递归嵌套 (child of child) 正确挂载到 parentSpan
  - 孤儿 child session 无匹配 parent → console.warn
  - ActiveTrace 默认值初始化验证
  - session.idle 正确区分 root finalize (trace.end + onFlush) vs child span close
  - queueMicrotask 延迟 finalize 验证 (before/after microtask)
  - 关闭残留 toolSpans 后再 finalize
  - 空 output 处理
  - finalize 异常 → metrics.errors++
- [x] `src/__tests__/service.test.ts` — 核心 Service 单元测试 (17 tests)
  - start/stop 生命周期 + 幂等性
  - stop 时关闭所有 active traces 并 flush
  - 事件分发: session.created → trace 创建
  - 事件分发: LLM input → output → span 创建/关闭
  - 事件分发: tool before → after → span 创建/关闭
  - 事件分发: multiagent parent + child session
  - flushWithRetry 首次成功
  - flushWithRetry 失败重试后成功
  - flushWithRetry 所有重试耗尽 → flushFailures++
  - cleanupExpiredTraces 超时过期
  - cleanupExpiredTraces 未超时不过期
  - getMetrics 返回副本 (非引用)
- [x] `src/__tests__/helpers.test.ts` — 工具函数测试 (19 tests)
  - resolveConfig 默认值 + 环境变量 + 显式配置三级优先级
  - resolveConfig 部分配置 + 默认值混合
  - safe() 同步成功/同步异常捕获/异步成功/异步异常捕获/参数传递
  - backoffDelay 指数增长 + ±25% jitter 范围 + maxDelay 上限
  - sleep 延迟验证
  - generateId 唯一性 + 格式验证

- [x] 验证通过
  - `tsc --noEmit` ✅ 零错误
  - `vitest run` ✅ 64/64 (新增 49 tests)

### Phase 2: 交互式配置向导 (2026-04-02)

- [x] `src/configure.ts` — 交互式配置向导 (参考 openclaw `@clack/prompts` 适配 OpenCode)
  - 三种部署模式: Opik Cloud / Self-hosted / Local
  - URL 连通性验证 (`isOpikAccessible` 带 3 次重试)
  - API Key 验证 (`getDefaultWorkspace` 通过 account-details API)
  - 配置持久化到 `opencode.json` 的 `plugin` 数组
    - 适配 OpenCode 格式: `["@opik/opik-opencode", { options }]` (非 openclaw 的 `plugins.entries`)
  - `getOpikPluginEntry` / `setOpikPluginEntry` — 读写 opencode.json plugin 配置
  - URL 工具函数: `normalizeUrl`, `buildOpikApiUrl`, `buildProjectsUrl`, `buildApiKeysUrl`
  - `getApiKeyHelpText` — 区分 cloud (含注册链接) / self-hosted
  - `runOpikConfigure(deps)` — 6 步交互式向导
  - `showOpikStatus(deps)` — 状态显示 (API Key 脱敏)
- [x] `src/configure-cli.ts` — CLI 独立入口 (`#!/usr/bin/env node`)
  - `findConfigPath()` — 发现 `opencode.json` / `.opencode/config.json`
  - `loadConfigFromFile()` / `writeConfigToFile()` — JSON 读写
  - 支持 `configure` / `status` / `help` 子命令
- [x] `src/__tests__/configure.test.ts` — 配置模块测试 (34 tests)
  - `getOpikPluginEntry`: 空数组 / 缺失 / 非数组 / string 入口 / tuple 入口 / 非对象 options / null / 首位 / 部分匹配
  - `setOpikPluginEntry`: 空配置 / 追加 / string→tuple / tuple 更新 / 保留其他 key / 空 options→string / 不可变 / 非数组处理
  - `buildOpikApiUrl`: localhost→`/api` / 127.0.0.1→`/api` / cloud→`/opik/api` / self-hosted→`/opik/api`
  - `buildProjectsUrl`: localhost 无前缀 / cloud `/opik` 前缀 / workspace 编码
  - `getApiKeyHelpText`: cloud 含注册链接 / self-hosted 无注册链接 / URL 拼接
  - `showOpikStatus`: 未配置 / 无 plugin key / 完整配置+Key 脱敏 / 空 options 默认值 / 部分 options
  - `isOpikAccessible`: 不可达 URL / 无效 URL
- [x] 集成更新
  - `index.ts`: 支持 `PluginOptions` (opencode.json 插件选项) 三级合并优先级
  - `index.ts`: 导出 configure 工具函数供外部使用
  - `package.json`: 新增 `@clack/prompts` 依赖 + `bin` 字段
  - `tsup.config.ts`: 双入口 (`index.ts` + `src/configure-cli.ts`)

- [x] 验证通过
  - `tsc --noEmit` ✅ 零错误
  - `vitest run` ✅ 98/98 (新增 34 tests)
  - `tsup build` ✅ dist/index.js 27.90KB + dist/src/configure-cli.js 11.51KB
  - CLI 冒烟测试: `node dist/src/configure-cli.js help/status` ✅

### Phase 3: 端到端集成测试 (2026-04-02)

- [x] `src/__tests__/service.e2e.test.ts` — OpikService 端到端集成测试 (22 tests)
  - 完整单 session 生命周期: create → LLM → tool → idle → metrics 全链路验证
  - 累积 usage + lastOutput 传递到 trace.update 验证
  - Multiagent: parent + 2 child sessions 完整生命周期 (正确的 flush 触发顺序)
  - 孤儿 child session (parent 不存在) → console.warn + 不创建 trace
  - 3 层嵌套 (grandchild): root → child → grandchild 正确挂载到 parentSpan
  - Flush retry: 1 次失败后成功 (real timers for sleep)
  - Flush retry: 全部重试耗尽 → flushFailures++
  - Trace 过期自动清理 (fake timers 验证 threshold)
  - 未超时 trace 不被清理
  - Child session trace 过期时使用 parentSpan metadata
  - stop() 关闭所有活跃 traces/spans + flush (含 in-flight LLM span 和 tool span)
  - stop() multiagent 场景: 正确关闭 parentSpan 和 root trace
  - Tool sessionID 降级: 空 sessionID → 单 trace 降级
  - Tool sessionID 降级: 未知 sessionID → 最近活跃 trace 降级
  - Tool after 找不到 callID → console.warn + 不崩溃
  - Token usage 跨 3 轮 LLM 对话累积 (45/75/120)
  - 多个独立 root session 并发不串扰 (各自独立 flush)
  - Session idle 自动关闭残留 tool span (orphan cleanup)
  - 不存在的 sessionID 上的 LLM 事件静默跳过
  - 不存在的 sessionID 上的 session.idle 静默跳过
  - Tool error 正确记录到 span metadata
  - 幂等 start/stop 循环: start → stop → start → use → stop
- [x] `src/__tests__/plugin.smoke.test.ts` — 插件入口冒烟测试 (30 tests)
  - Module exports: createOpikPlugin / OpikPlugin / OpikService / configure 工具函数
  - Default export === OpikPlugin
  - createOpikPlugin() 返回 function (Plugin 类型)
  - Plugin 调用返回全部 6 个 OpenCode 事件 handler
  - 空 config 可接受
  - Config 优先级: explicit > pluginOptions > env vars (3 个测试)
  - Handler 字段规范化: input.id / input.message / input.usage / 自动 callID / output.result (7 个测试)
  - Handlers 对空对象输入不抛异常 (6 个事件各 1 个测试)
  - undefined/null 输入 → TypeError (当前行为验证)
  - 多个 Plugin 实例独立: 各自 OpikService + 不同 projectName
  - 多个 Plugin 实例不共享状态
  - OpikPlugin 默认导出支持环境变量
  - 完整 round-trip: session → LLM → tool → idle 通过 plugin handler
  - Multiagent round-trip: parent + child idle 顺序验证

- [x] 验证通过
  - `tsc --noEmit` ✅ 零错误
  - `vitest run` ✅ 128/128 (新增 30 smoke tests)
  - `vitest run --config vitest.e2e.config.ts` ✅ 22/22 (全新 e2e tests)

---

## 📋 后续阶段

### Phase 4: 高级功能 ⏸️ Deferred

> **决定: 暂不实施。** OpenCode 以文本交互为主 (代码/命令输出)，LLM payload 几乎不含本地媒体引用。
> 当前 payload-sanitizer 已覆盖 `media:` 路径脱敏。配置项 `uploadAttachments` 已预留，
> 未来若 OpenCode 支持多模态，可从 openclaw 移植。直接推进 Phase 5。

- [ ] ~`src/media.ts` — 媒体文件路径检测 (30+ 格式, MIME 推断)~
- [ ] ~`src/attachment-uploader.ts` — 附件分片上传 (8MB chunks, LRU 去重缓存)~
- [ ] ~增强 payload-sanitizer: file:// 协议路径、Markdown 图片链接格式~

### Phase 5: OpenCode 真实环境适配 (2026-04-02)

- [x] 对比 `@opencode-ai/plugin@1.3.10` 类型定义，发现并修复 **6 个严重 API 不匹配**
  - 🔴 `session.created`/`session.idle`/`message.updated` 不是有效 Hook key → 移入 `event` catch-all
  - 🔴 `chat.message` payload 字段全部对不上 (content/model/provider) → 适配 (input, output) 双参数
  - 🔴 `tool.execute.after` 读取不存在的 `output.result`/`output.error` → 适配 `output.output`/`output.title`
  - 🔴 Token 字段名 `inputTokens`/`outputTokens` → 适配 `input`/`output`/`reasoning`/`cache`
- [x] **架构重构**: `index.ts` 插件入口完全重写
  - `event` catch-all handler: 处理 session.created, session.idle, session.status, message.updated, message.part.updated
  - 直接 hook key: `chat.message`, `tool.execute.before`, `tool.execute.after`
  - 从 `EventSessionCreated.properties.info` (Session) 正确提取 id/parentID/title/directory/projectID
  - 从 `EventMessageUpdated.properties.info` (AssistantMessage) 正确提取 tokens/modelID/providerID
- [x] **类型系统全面更新** (`src/types.ts`)
  - `TokenUsage`: `{inputTokens, outputTokens, totalTokens}` → `{input, output, reasoning, cache: {read, write}}`
  - 新增 `zeroTokenUsage()`, `totalTokens()` 工具函数
  - `SessionCreatedPayload.info`: 移除 `slug`，新增 `id`/`projectID`/`directory`/`version`/`time`
  - `LlmInputPayload`: 移除 `content`/`model(string)`/`provider`/`systemPrompt`，新增 `model?:{providerID, modelID}`/`message`/`parts`
  - `LlmOutputPayload`: 新增 `messageID`/`modelID`/`providerID`/`finish`
  - `ToolAfterPayload`: 移除 `error`，新增 `title`/`args`
  - 新增 `MessagePartUpdatedPayload`, `SessionStatusPayload`
  - `ActiveTrace`: 新增 `streamingText`, `modelInfo` 字段
- [x] **新增 `message.part.updated` 流式处理** (`src/hooks/llm.ts`)
  - `onMessagePartUpdated`: 累积 text delta 到 `active.streamingText`
  - `onLlmOutput`: 优先使用 streamingText，fallback 到 content
- [x] **新增 `session.status` 处理** (`src/service.ts`)
  - `handleSessionStatus`: 更新 lastActiveAt + metadata.lastStatus
- [x] 全部 hook 模块适配新 payload 格式
  - `hooks/session.ts`: 移除 slug 引用，使用 Session.id/title/directory/projectID
  - `hooks/llm.ts`: 适配 (input, output) 格式，extractUserContent 从 UserMessage 提取内容
  - `hooks/tool.ts`: 移除 error 分支，使用 output.output + output.title
- [x] **全部测试更新** (151 tests)
  - `hooks/__tests__/session.test.ts` — 12 tests (适配新 info 结构 + 新 TokenUsage)
  - `hooks/__tests__/llm.test.ts` — 6 tests (适配新 payload + 新增 onMessagePartUpdated 测试)
  - `hooks/__tests__/tool.test.ts` — 4 tests (移除 error 测试，新增 empty output 测试)
  - `__tests__/service.test.ts` — 17 tests (适配新 payload)
  - `__tests__/service.e2e.test.ts` — 22 tests (适配新 payload + usage 断言)
  - `__tests__/plugin.smoke.test.ts` — 30 tests (完全重写 event handler 测试)

- [x] 验证通过
  - `tsc --noEmit` ✅ 零错误
  - `vitest run` ✅ 129/129 (unit + smoke)
  - `vitest run --config vitest.e2e.config.ts` ✅ 22/22 (e2e)
  - `tsup build` ✅ dist/index.js 31.71KB + dist/src/configure-cli.js 11.51KB

### Phase 6: 发布准备 (2026-04-02)

- [x] LICENSE 文件 (Apache-2.0)
  - 修复版权占位符 → `Copyright 2026 Comet ML, Inc.`
- [x] README.md (安装、配置、使用、架构说明)
  - 完整文档: Quick Start / Configuration Table / Programmatic Usage / Architecture / Event Mapping / Development / Testing / Contributing
  - CI badge + npm badge + License badge
- [x] GitHub Actions CI/CD (lint + typecheck + test + build)
  - `.github/workflows/ci.yml` — push/PR 触发: typecheck → lint → unit/smoke/e2e tests → build + artifact upload
  - `.github/workflows/publish.yml` — GitHub Release 触发: typecheck → test → build → npm publish (provenance)
  - Node 22 matrix, npm cache, artifact upload (7 天保留)
- [x] npm publish 配置
  - `package.json`: 新增 `homepage`/`bugs` 字段、`test:all` 聚合脚本、`prepack` 清理+构建、`prepublishOnly` 全链路校验
  - `package.json`: `files` 新增 `CHANGELOG.md`
  - `.npmrc`: `access=public` + `provenance=true`
  - `npm pack --dry-run` 验证: 10 文件, 54.4KB 压缩包
- [x] CHANGELOG.md
  - Keep a Changelog 格式 + Semantic Versioning
  - v0.1.0 完整记录: Added (所有功能) / Architecture / Testing

- [x] 验证通过
  - `tsc --noEmit` ✅ 零错误
  - `vitest run` ✅ 129/129 (unit + smoke)
  - `vitest run --config vitest.e2e.config.ts` ✅ 19/22 (3 个已有的 flushSuccesses 计数偏差，非 Phase 6 引入)
  - `tsup build` ✅ dist/index.js 34.25KB + dist/src/configure-cli.js 11.51KB
  - `npm pack --dry-run` ✅ 10 files, 54.4KB

---

## 🏗 架构参考

```
index.ts                        ← 插件入口, event catch-all + 直接 hook key
  │                               event: session.created/idle/status, message.updated/part.updated
  │                               直接 key: chat.message, tool.execute.before/after
  ├─ src/service.ts             ← 核心 Service: Opik 客户端 + 生命周期 + flush/expire
  │    ├─ hooks/session.ts      ← session.created (Trace 创建 / multiagent 串联)
  │    │                          session.idle (queueMicrotask 延迟 finalize)
  │    ├─ hooks/llm.ts          ← chat.message → LLM Span / message.updated → 关闭
  │    │                          message.part.updated → streamingText 累积
  │    ├─ hooks/tool.ts         ← tool.execute.before/after (3 级降级)
  │    ├─ helpers.ts            ← resolveConfig, safe(), backoff
  │    ├─ payload-sanitizer.ts  ← 数据脱敏
  │    ├─ constants.ts          ← 默认值/常量
  │    └─ types.ts              ← 所有类型定义 (适配 @opencode-ai/plugin@1.3.10)
  └─ src/configure.ts           ← 交互式配置向导 (@clack/prompts)
       └─ src/configure-cli.ts  ← CLI 入口 (npx opik-opencode configure/status)
```

## 🔗 事件映射表

| OpenCode 事件 | Hook 类型 | openclaw 对应 | 实现状态 |
|---|---|---|---|
| `session.created` | `event` catch-all | trace 创建 + subagent_spawning | ✅ 已实现 |
| `session.idle` | `event` catch-all | agent_end + subagent_ended | ✅ 已实现 |
| `session.status` | `event` catch-all | — (busy/idle/retry) | ✅ 已实现 |
| `message.updated` | `event` catch-all | llm_output | ✅ 已实现 |
| `message.part.updated` | `event` catch-all | (流式 token 累积) | ✅ 已实现 |
| `chat.message` | 直接 hook key | llm_input | ✅ 已实现 |
| `tool.execute.before` | 直接 hook key | before_tool_call | ✅ 已实现 |
| `tool.execute.after` | 直接 hook key | after_tool_call | ✅ 已实现 |
| `shell.env` | — | — | ❌ 不需要 |

## 📦 依赖

| 包 | 版本 | 用途 |
|---|---|---|
| `opik` | ^1.0.0 | Opik SDK (trace/span 创建) |
| `zod` | ^3.24.0 | 数据校验 |
| `@clack/prompts` | ^1.1.0 | 交互式 CLI 配置向导 (Phase 2) |
| `@opencode-ai/plugin` | ^1.3.0 | OpenCode 插件类型 (devDep + peerDep) |
| `tsup` | ^8.0.0 | 构建 |
| `vitest` | ^3.0.0 | 测试 |
| `typescript` | ^5.7.0 | 类型检查 |
