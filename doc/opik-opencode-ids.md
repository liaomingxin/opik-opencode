## 项目 ID 体系分析

经过对全部核心代码文件的深入分析，以下是完整的 ID 体系总结：

---

### 一、三种核心 ID 的来源

| ID | 谁生成          | 格式                               | 用途                                   |
| ---- | ----------------- | ------------------------------------ | ---------------------------------------- |
| **Thread ID**   | 插件设置，值 = `sessionKey` | OpenClaw 传入的不透明字符串（如 `"e2e-<uuid>"`） | Opik 中按对话线程分组 trace            |
| **Trace ID**   | **Opik SDK** 内部自动生成   | UUID                               | 标识一次完整的 agent 会话追踪          |
| **Span ID**   | **Opik SDK** 内部自动生成   | UUID                               | 标识 trace 下的 LLM/Tool/Subagent 调用 |

> **关键发现：插件本身不生成任何 trace ID 或 span ID**，它们全部由 `opik` SDK 在调用 `client.trace()` 和 `trace.span()` / `span.span()` 时内部分配。

---

### 二、`sessionKey` — 整个系统的关联枢纽

`sessionKey` 是 **OpenClaw 运行时**传入的不透明字符串，是所有 ID 关联的核心：

```
sessionKey  ──→  activeTraces Map 的 key（查找 trace）
            ──→  threadId（Opik trace 的线程分组字段）
            ──→  subagentSpanHosts Map 的 key（子 agent 跨会话关联）
```

在 trace 创建时，`threadId` 直接等于 `sessionKey`：

```ts
trace = client.trace({
  threadId: sessionKey,   // ← sessionKey 就是 threadId
  name: `${event.model} · ${channelId}`,
  ...
});
```

---

### 三、ID 关联的层级结构

```
activeTraces Map<sessionKey → ActiveTrace>
  │
  ├── trace (Opik Trace，ID 由 SDK 生成，threadId = sessionKey)
  │     │
  │     ├── llmSpan (type="llm"，parent=trace)
  │     │     name: "gpt-4o" 或 "gpt-4o #2"（第N轮）
  │     │
  │     ├── toolSpans Map<spanKey → Span> (type="tool")
  │     │     spanKey: "session:<sk>:toolcall:<toolCallId>"
  │     │           或 "session:<sk>:<toolName>:<seq>"
  │     │     parent: trace 或 subagent span
  │     │
  │     └── subagentSpans Map<childSessionKey → Span>
  │           parent: trace（或上层 subagent span）
  │           name: "subagent:<agentId>"
  │
  └── 终结时 → activeTraces.delete(sessionKey)
```

---

### 四、子 Agent 的跨会话关联机制

子 agent 有自己独立的 `childSessionKey`，但其事件需要挂到**父 trace** 下。这通过 `subagentSpanHosts` Map 实现：

```ts
subagentSpanHosts Map<childSessionKey → { hostSessionKey, active, span }>
```

当子 agent 会话中的 tool/LLM 事件到来时，`resolveSessionSpanContainer` 会：

1. 先查 `subagentSpanHosts`（用 `childSessionKey` 查）→ 找到父会话的 trace 和对应的 subagent span
2. 将子 agent 的 tool span 挂在父 trace 的 subagent span 下面

---

### 五、`after_tool_call` 的 sessionKey 回退链

`after_tool_call` 事件有时缺少 `sessionKey`，插件设计了三级回退：

```
1. agentId → sessionByAgentId Map → sessionKey
2. 如果 activeTraces 中只有一个 entry → 直接用它
3. lastActiveSessionKey（最后活跃的会话）
```

---

### 六、Tool Span 的 Map Key 构造

Tool span 的内部查找 key（**不是 span ID**，span ID 由 SDK 管理）：

- **有** **`toolCallId`**: `"session:<sessionKey>:toolcall:<toolCallId>"` — 支持精确去重匹配
- **无** **`toolCallId`**: `"session:<sessionKey>:<toolName>:<seq>"` — 用单调递增计数器 `spanSeq` 保证唯一

---

### 七、总结

| 设计要点 | 说明                                                                         |
| ---------- | ------------------------------------------------------------------------------ |
| **插件不生成 ID**         | Trace ID、Span ID 全部由 Opik SDK 自动分配（UUID）                           |
| **`sessionKey`**  **=**  **`threadId`**       | OpenClaw 的会话概念直接映射为 Opik 的线程分组                                |
| **一个 sessionKey = 一个 Trace**         | 首次 `llm_input` 创建 trace，后续同 session 复用                                        |
| **Span 的 parent 关系**         | LLM/Tool span → trace（根级），或 Tool span → subagent span（子 agent 内） |
| **跨会话桥接**         | `subagentSpanHosts` 将子 session 事件重定向到父 trace 的 subagent span 下                       |
| **唯一自生成值**         | 仅 `spanSeq`（单调计数器），用于 tool span 内部 Map key 去重                          |