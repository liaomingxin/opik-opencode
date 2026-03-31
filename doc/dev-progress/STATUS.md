# opik-opencode 开发进度跟踪

> 最后更新: 2026-04-01

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

---

## 📋 后续开发计划

### Phase 1: 补全测试覆盖 (优先级: 高)

- [ ] `src/hooks/__tests__/session.test.ts` — session 生命周期测试
  - root session 创建 Trace
  - child session 创建 Subagent Span 并共享 root Trace
  - 递归嵌套 (child of child) 正确挂载
  - session.idle 正确区分 root finalize vs child span close
  - queueMicrotask 延迟 finalize 验证
- [ ] `src/__tests__/service.test.ts` — 核心 Service 单元测试
  - start/stop 生命周期
  - 事件分发到正确 handler
  - flushWithRetry 指数退避逻辑
  - cleanupExpiredTraces 过期清理
- [ ] `src/__tests__/helpers.test.ts` — 工具函数测试
  - resolveConfig 默认值 + 环境变量 + 显式配置优先级
  - safe() 错误捕获 (同步 + 异步)
  - backoffDelay 计算 + jitter 范围

### Phase 2: 交互式配置向导 (优先级: 高)

- [ ] `src/configure.ts` — CLI 配置命令 (参考 openclaw 的 `@clack/prompts` 实现)
  - 三种部署模式: Opik Cloud / Self-hosted / Local
  - URL 连通性验证 (带重试)
  - API Key 验证
  - 配置持久化到 opencode 配置文件
- [ ] `src/__tests__/configure.test.ts`

### Phase 3: 端到端集成测试 (优先级: 中)

- [ ] `src/__tests__/service.e2e.test.ts`
  - 模拟完整 session 生命周期 → 验证 Opik API 调用序列
  - multiagent 场景: parent + 2 child sessions
  - 异常场景: flush 失败重试、trace 过期清理
- [ ] `src/__tests__/plugin.smoke.test.ts` — 冒烟测试
  - 插件导入正常
  - createOpikPlugin() 返回合法 Plugin 函数
  - 环境变量配置读取

### Phase 4: 高级功能 (优先级: 中)

- [ ] `src/media.ts` — 媒体文件路径检测 (30+ 格式, MIME 推断)
- [ ] `src/attachment-uploader.ts` — 附件分片上传 (8MB chunks, LRU 去重缓存)
- [ ] 增强 payload-sanitizer: file:// 协议路径、Markdown 图片链接格式

### Phase 5: OpenCode 真实环境适配 (优先级: 高)

- [ ] 在 OpenCode 中实际加载插件测试 (`opencode.json` plugin 配置)
- [ ] 验证各事件 payload 的真实数据结构 (可能需要调整 handler 中的字段映射)
- [ ] 处理 OpenCode 流式 SSE `message.part.updated` 事件 (逐 token 累积)
- [ ] 验证 `session.idle` 是否真正代表 session 结束 (可能需要结合 `session.status`)
- [ ] 验证 multiagent `parentID` 字段的真实路径

### Phase 6: 发布准备 (优先级: 低)

- [ ] LICENSE 文件 (Apache-2.0)
- [ ] README.md (安装、配置、使用、架构说明)
- [ ] GitHub Actions CI/CD (lint + typecheck + test + build)
- [ ] npm publish 配置
- [ ] CHANGELOG.md

---

## 🏗 架构参考

```
index.ts                    ← 插件入口, 注册所有 OpenCode 事件 handler
  └─ src/service.ts         ← 核心 Service: Opik 客户端 + 生命周期 + flush/expire
       ├─ hooks/session.ts  ← session.created (Trace 创建 / multiagent 串联)
       │                      session.idle (queueMicrotask 延迟 finalize)
       ├─ hooks/llm.ts      ← chat.message → LLM Span / message.updated → 关闭
       ├─ hooks/tool.ts     ← tool.execute.before/after (3 级降级)
       ├─ helpers.ts        ← resolveConfig, safe(), backoff
       ├─ payload-sanitizer ← 数据脱敏
       ├─ constants.ts      ← 默认值/常量
       └─ types.ts          ← 所有类型定义
```

## 🔗 事件映射表

| OpenCode 事件 | openclaw 对应 | 实现状态 |
|---|---|---|
| `session.created` | trace 创建 + subagent_spawning | ✅ 已实现 |
| `session.idle` | agent_end + subagent_ended | ✅ 已实现 |
| `chat.message` | llm_input | ✅ 已实现 |
| `message.updated` | llm_output | ✅ 已实现 |
| `tool.execute.before` | before_tool_call | ✅ 已实现 |
| `tool.execute.after` | after_tool_call | ✅ 已实现 |
| `message.part.updated` | (流式 token) | ❌ 待实现 (Phase 5) |
| `shell.env` | — | ❌ 不需要 |

## 📦 依赖

| 包 | 版本 | 用途 |
|---|---|---|
| `opik` | ^1.0.0 | Opik SDK (trace/span 创建) |
| `zod` | ^3.24.0 | 数据校验 |
| `@opencode-ai/plugin` | ^1.3.0 | OpenCode 插件类型 (devDep + peerDep) |
| `tsup` | ^8.0.0 | 构建 |
| `vitest` | ^3.0.0 | 测试 |
| `typescript` | ^5.7.0 | 类型检查 |
