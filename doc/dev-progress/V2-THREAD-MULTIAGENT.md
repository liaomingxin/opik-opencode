# V2: Thread 聚合 + Multiagent 数据串联增强

> 状态: 待实施
> 前置: Phase 6 已完成 (v0.1.0)
> 参考实现: `/Users/liaomx/lmx/github/newopik/fork/opik-openclaw/src/service.ts`

---

## 背景

### 问题

v0.1.0 的 opik-opencode 插件可以正确创建 Trace 和 Span，但存在两个关键缺陷：

1. **没有设置 `threadId`** — Trace 创建时（`session.ts:42`）没有传 `threadId` 参数，导致 Opik 后端无法将同一用户的多次对话归入同一线程进行聚合查看。

2. **Multiagent 数据串联不够健壮** — 当前依赖 `session.created` 事件的 `parentID` 做即时关联，如果事件乱序或缺失 `parentID`，子 agent 的数据会丢失。

### 目标

对齐 opik-openclaw 的数据串联模型：
- 同一会话 session 内的所有信息（LLM 调用、Tool 调用、Subagent 调用）通过 `threadId` 聚合到 Opik 的同一 Thread 下
- Multiagent 场景下，Primary Agent 和多个 Subagent 的 trace/span 可以完整串联

### 两个插件的架构差异（已分析确认）

| 维度 | openclaw | opencode (v0.1.0) |
|---|---|---|
| **threadId** | `threadId = sessionKey`，每个 Trace 都有 | **缺失** |
| **Trace 创建时机** | lazy — 首次 `llm_input` 才建 | eager — `session.created` 就建 |
| **Subagent 归属** | `subagentSpanHosts` Map 做跨 session 桥接 | 通过 `parentID` 直接查 `activeTraces` |
| **Tool span 容器解析** | `resolveSessionSpanContainer()` 统一返回 Trace 或 subagent Span | `anchor = parentSpan ?? trace` 硬编码 |
| **LLM 多轮命名** | `"gpt-4o #2"` 含轮次号 + model 名 | 固定 `"llm"` |
| **Finalization** | 两阶段：`agent_end` + `llm_output` 都 ready 才关 | `session.idle` 直接关 |
| **Tool key** | `"session:<sk>:toolcall:<id>"` 复合 key + spanSeq 兜底 | 简单 `callID` |

---

## 任务清单

### Task 1: 添加 `threadId` 支持 [P0 - 必须]

**目标**: Trace 创建时设置 `threadId`，使 Opik 可以按 Thread 聚合 Trace。

**改动文件**: `src/hooks/session.ts`

**具体改动**:

```typescript
// src/hooks/session.ts:42 — 创建 Trace 时加入 threadId
const trace = opikClient.trace({
  name: `opencode-${info.title ?? sessionID}`,
  threadId: sessionID,   // ← 新增这一行
  input: {},
  metadata: { ... },
  projectName,
})
```

**原理**:
- `sessionID` 是 OpenCode runtime 分配的会话标识，root session 和 child session 各有不同的 `sessionID`
- 但 child session 已经通过 `parentID` 共享父 Trace（`session.ts:91`），不会创建新 Trace
- 所以只有 root session 会走到 `opikClient.trace()` 这行，其 `sessionID` 就是整个 multiagent 会话的唯一标识
- 这与 openclaw 的 `threadId = sessionKey` 模式完全对齐

**注意事项**:
- 确认 Opik SDK `client.trace()` 支持 `threadId` 参数（参考 openclaw 用法：`service/hooks/llm.ts:108`）
- 子 session 不创建 Trace，所以不需要额外处理

**测试更新**:
- `hooks/__tests__/session.test.ts` — 验证 `opikClient.trace()` 被调用时包含 `threadId: sessionID`
- `__tests__/service.e2e.test.ts` — 验证完整 round-trip 中 trace 携带 threadId

---

### Task 2: 添加 `resolveSessionSpanContainer` 统一解析 [P1]

**目标**: 对齐 openclaw 的容器解析模式，用统一函数替代各 hook 中分散的 `anchor = parentSpan ?? trace` 逻辑。

**改动文件**: `src/service.ts` (新增方法), `src/hooks/llm.ts`, `src/hooks/tool.ts`, `src/hooks/session.ts`

**当前代码** (分散在 3 个 hook 文件中):
```typescript
// hooks/llm.ts:80, hooks/tool.ts:80, hooks/session.ts:79
const anchor = active.parentSpan ?? active.trace
```

**改为** (参考 openclaw `service.ts:241-259`):
```typescript
// src/service.ts 新增方法
function resolveSessionSpanContainer(
  sessionID: string,
  activeTraces: Map<string, ActiveTrace>,
): { sessionID: string; active: ActiveTrace; parent: Trace | Span } | undefined {
  const active = activeTraces.get(sessionID)
  if (!active) return undefined
  return {
    sessionID,
    active,
    parent: active.parentSpan ?? active.trace,
  }
}
```

**价值**: 集中管理容器解析逻辑，为 Task 3 的 `subagentSpanHosts` 桥接层预留扩展点。

---

### Task 3: 添加 `subagentSpanHosts` 跨会话桥接层 [P2]

**目标**: 解决事件乱序场景下子 agent 数据丢失的问题，对齐 openclaw 的桥接机制。

**参考实现**: openclaw `service.ts:54-57, 124-155`

**改动文件**: `src/service.ts`, `src/types.ts`

**新增数据结构**:
```typescript
// src/service.ts
private subagentSpanHosts = new Map<
  string,   // childSessionID
  { hostSessionID: string; active: ActiveTrace; span: Span }
>()
```

**工作原理**:
1. 子 session 创建时，在 `subagentSpanHosts` 中注册 `childSessionID → 父 trace 信息`
2. 当子 session 的 tool/LLM 事件到来时，通过 `resolveSessionSpanContainer` 查 `subagentSpanHosts` 找到父 trace
3. 子 session 结束时，从 `subagentSpanHosts` 中清除

**openclaw 的容量管理**:
- 最大 1000 条记录（`SUBAGENT_SPAN_HOSTS_MAX`）
- FIFO 淘汰策略，淘汰时关闭对应 span

**改动点**:
- `src/service.ts`: 新增 `subagentSpanHosts` Map + `rememberSubagentSpanHost` / `getSubagentSpanHost` / `forgetSubagentSpanHost` 方法
- `src/hooks/session.ts`: `onSessionCreated` 中注册桥接
- `src/hooks/session.ts`: `onSessionIdle` 中清除桥接
- `resolveSessionSpanContainer`: 先查 `subagentSpanHosts`，再查 `activeTraces`
- `src/constants.ts`: 新增 `SUBAGENT_SPAN_HOSTS_MAX = 1000`

**更新 `resolveSessionSpanContainer`**:
```typescript
function resolveSessionSpanContainer(sessionID: string) {
  // 1. 先查桥接表（子 session 关联）
  const spanHost = subagentSpanHosts.get(sessionID)
  if (spanHost) {
    return {
      sessionID: spanHost.hostSessionID,
      active: spanHost.active,
      parent: spanHost.span,  // 子 session 的事件挂在 subagent span 下
    }
  }
  // 2. 再查 activeTraces（root session 或直接关联）
  const active = activeTraces.get(sessionID)
  if (active) {
    return { sessionID, active, parent: active.parentSpan ?? active.trace }
  }
  return undefined
}
```

---

### Task 4: LLM Span 多轮命名优化 [P2]

**目标**: 让 LLM span 名称包含 model 名和轮次号，方便在 Opik UI 中区分。

**改动文件**: `src/types.ts`, `src/hooks/llm.ts`

**当前**: 所有 LLM span 统一命名 `"llm"`
**改为**: `"claude-sonnet-4-5"` (首轮) / `"claude-sonnet-4-5 #2"` (后续)

**改动点**:
- `src/types.ts` — `ActiveTrace` 新增 `llmTurnCount: number` 字段
- `src/hooks/session.ts` — 初始化 `llmTurnCount: 0`
- `src/hooks/llm.ts` — `onLlmInput` 中 `active.llmTurnCount++`，span name 用 `model?.modelID ?? "llm"` + 轮次后缀

```typescript
active.llmTurnCount += 1
const modelName = model?.modelID ?? "llm"
const spanName = active.llmTurnCount === 1
  ? modelName
  : `${modelName} #${active.llmTurnCount}`
```

---

### Task 5: 测试更新 [P0 - 随 Task 1-4 同步进行]

每个 Task 完成后需同步更新对应测试：

| Task | 需要更新的测试文件 | 验证点 |
|---|---|---|
| Task 1 | `hooks/__tests__/session.test.ts` | `trace()` 调用包含 `threadId` |
| Task 1 | `__tests__/service.e2e.test.ts` | 完整 round-trip trace 携带 threadId |
| Task 2 | `hooks/__tests__/llm.test.ts`, `tool.test.ts` | 通过 resolver 创建 span |
| Task 3 | `__tests__/service.e2e.test.ts` | 子 session 通过桥接正确挂载 |
| Task 3 | `__tests__/plugin.smoke.test.ts` | multiagent 场景验证 |
| Task 4 | `hooks/__tests__/llm.test.ts` | span name 包含 model + 轮次号 |

---

### Task 6: 文档更新 [P1]

- `README.md` — 新增 Thread 聚合说明 + Multiagent 架构图
- `CHANGELOG.md` — v0.2.0 更新记录
- `doc/dev-progress/STATUS.md` — 新增 V2 Phase 完成记录

---

## 实施顺序

```
Task 1 (threadId)     ← 最高优先级，1 行核心改动 + 测试
  ↓
Task 4 (LLM 命名)     ← 独立，可并行
  ↓
Task 2 (resolver 重构) ← Task 3 的前置
  ↓
Task 3 (桥接层)        ← 依赖 Task 2
  ↓
Task 5 (测试收尾)      ← 贯穿全程，每个 Task 完成后立即更新
  ↓
Task 6 (文档)          ← 最后
```

## 验收标准

- [ ] `tsc --noEmit` 零错误
- [ ] `vitest run` 全部通过
- [ ] `vitest run --config vitest.e2e.config.ts` 全部通过
- [ ] Opik UI 中可以看到按 threadId 聚合的 Trace
- [ ] Multiagent 场景下 Primary + Subagent 的 span 正确嵌套
- [ ] LLM span 名称包含 model 名和轮次号

## 关键文件速查

| 文件 | 作用 | V2 改动 |
|---|---|---|
| `src/hooks/session.ts:42` | Trace 创建 | 加 `threadId` |
| `src/hooks/session.ts:79` | 子 session anchor | 改用 resolver |
| `src/hooks/llm.ts:80` | LLM span anchor | 改用 resolver + 命名优化 |
| `src/hooks/tool.ts:80` | Tool span anchor | 改用 resolver |
| `src/service.ts:34` | activeTraces Map | 新增 subagentSpanHosts |
| `src/types.ts:60` | ActiveTrace 类型 | 新增 llmTurnCount |
| `src/constants.ts` | 常量 | 新增 SUBAGENT_SPAN_HOSTS_MAX |

## 参考文件（openclaw 实现）

| 功能 | openclaw 文件 | 行号 |
|---|---|---|
| threadId 设置 | `src/service/hooks/llm.ts` | 106-121 |
| subagentSpanHosts 定义 | `src/service.ts` | 54-57 |
| rememberSubagentSpanHost | `src/service.ts` | 124-145 |
| resolveSessionSpanContainer | `src/service.ts` | 241-259 |
| resolveSubagentSpanContainer | `src/service.ts` | 261-282 |
| subagent_spawning hook | `src/service/hooks/subagent.ts` | 37-87 |
| subagent_ended hook | `src/service/hooks/subagent.ts` | 222-302 |
| ActiveTrace 类型 | `src/types.ts` | 71-126 |
| SUBAGENT_SPAN_HOSTS_MAX | `src/service/constants.ts` | 13 |
