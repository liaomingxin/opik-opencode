# opik-opencode 真实环境集成测试指南

> 前提: 本地已有 Docker 部署的 Opik + 本地安装的 OpenCode

---

## 一、环境准备

### 1.1 确认 Opik 服务运行

```bash
# 确认 Opik 后端在运行 (默认 5173 端口)
curl -s http://localhost:5173/api/health
# 预期: 返回 200 或类似 {"status":"ok"}

# 也可以检查 UI 是否可访问
open http://localhost:5173
```

### 1.2 构建插件

```bash
cd /Users/liaomx/lmx/github/newopik/fork/opik-opencode

# 安装依赖 (如果需要)
npm install

# 构建
npm run build

# 确认产物
ls -la dist/index.js dist/index.d.ts
```

### 1.3 配置 OpenCode 加载插件

在你的 OpenCode 项目目录（你平时执行 `opencode` 的目录）下编辑 `opencode.json`：

```jsonc
{
  // ... 你的其他 OpenCode 配置 ...
  "plugin": [
    // 方式 A: 本地路径引用 (推荐开发阶段)
    ["/Users/liaomx/lmx/github/newopik/fork/opik-opencode/dist/index.js", {
      "apiUrl": "http://localhost:5173/api",
      "projectName": "opencode-real-test"
    }]

    // 方式 B: npm link (发布后)
    // ["@opik/opik-opencode", {
    //   "apiUrl": "http://localhost:5173/api",
    //   "projectName": "opencode-real-test"
    // }]
  ]
}
```

> **注意**: Opik SDK 接受的 `apiUrl` 格式是含 `/api` 后缀的完整路径。
> 本地 Docker 部署默认是 `http://localhost:5173/api`。

**或者用环境变量** (不改 opencode.json)：

```bash
export OPIK_API_URL="http://localhost:5173/api"
export OPIK_PROJECT_NAME="opencode-real-test"
# export OPIK_API_KEY=""  # 本地部署通常不需要
# export OPIK_WORKSPACE_NAME=""  # 本地部署通常不需要
```

### 1.4 插件加载验证

```bash
# 启动 OpenCode
opencode

# 观察启动日志，应该看到:
# [opik-opencode] Started. Project: opencode-real-test
```

**如果没有看到这行日志**，说明插件未被加载，检查：
- opencode.json 的 plugin 路径是否正确
- dist/index.js 是否存在
- OpenCode 版本是否支持 plugin 配置

---

## 二、诊断模式 (首次运行必做)

首次在真实环境测试前，建议先开启诊断日志。在 `index.ts` 的 `event` handler 开头临时添加：

```typescript
event: async (input: { event: any }) => {
  const { event } = input ?? {}
  // ====== 临时诊断 START ======
  if (event?.type) {
    const props = JSON.stringify(event.properties ?? {}, null, 2)
    console.log(`[opik-debug] EVENT: ${event.type}`)
    console.log(`[opik-debug] PROPS: ${props.slice(0, 1000)}`)
  }
  // ====== 临时诊断 END ======
  if (!event?.type) return
  // ... 正式逻辑 ...
```

对 `chat.message`, `tool.execute.before`, `tool.execute.after` 也加类似日志：

```typescript
"chat.message": async (input, output) => {
  console.log(`[opik-debug] chat.message INPUT:`, JSON.stringify(input, null, 2)?.slice(0, 500))
  console.log(`[opik-debug] chat.message OUTPUT:`, JSON.stringify(output, null, 2)?.slice(0, 500))
  // ... 正式逻辑 ...
```

重新构建 (`npm run build`) 后启动 OpenCode，发送一条简单消息，观察日志输出。

### 需要确认的关键信息

| 检查项 | 对应日志 | 关注点 |
|--------|---------|--------|
| `event` handler 是否被调用 | `[opik-debug] EVENT: session.created` | 如果没有，说明 OpenCode 不通过 `event` 分发 |
| Session 的 `id` 字段 | `properties.info.id` | 确认用什么做 sessionID |
| `parentID` 位置 | `properties.info.parentID` | multiagent 时有值 |
| `chat.message` 调用格式 | 两个参数 input, output | 确认 output.message 结构 |
| `message.updated` 触发时机 | EVENT 出现次数 | 是每个 token 一次还是完成时一次 |
| `message.part.updated` | EVENT + delta 内容 | 是否有 sessionID 字段 |
| `tool.execute.after` output | output 参数结构 | 确认是 `{title, output, metadata}` |
| Token 字段 | AssistantMessage.tokens | `{input, output, reasoning, cache}` 还是其他格式 |

**确认日志符合预期后，移除诊断代码，重新 build，进入正式测试。**

---

## 三、测试用例

### 测试 1: 最简单的一轮对话

**目的**: 验证基本链路 session → LLM → idle → Opik 落库

**操作**:
```
你: 1+1等于几
AI: 2
```

**验证**:
1. 打开 Opik UI: `http://localhost:5173`
2. 进入项目 `opencode-real-test`
3. 应该看到 **1 个 Trace**
4. Trace 名称应为 `opencode-<session title>`
5. Trace 下应有 **1 个 LLM Span**:
   - `name: "llm"`, `type: "llm"`
   - `input` 含用户提问内容
   - `output` 含 AI 回答内容
   - `usage` 有 `prompt_tokens`, `completion_tokens`, `total_tokens`
6. Trace 的 `output` 应有 `response: "2"` (最后一次 LLM 输出)
7. Trace 的 `metadata` 应有 `usage` 汇总

**记录**: 截图 Trace 详情页，标注各字段是否符合预期。

---

### 测试 2: 多轮对话

**目的**: 验证 token 累积 + lastOutput 追踪

**操作**:
```
你: 帮我解释什么是递归
AI: (解释递归)
你: 用 Python 给个例子
AI: (给出代码示例)
你: 改成计算阶乘的
AI: (给出阶乘代码)
```

**验证**:
1. 仍然是 **1 个 Trace** (同一个 session)
2. Trace 下应有 **3 个 LLM Span** (每轮一个)
3. 每个 Span 有独立的 `usage` (该轮的 token 数)
4. Trace 的 metadata `usage` 是三轮的 **累加总和**
5. Trace 的 `output.response` 是 **最后一轮** 的 AI 回答

---

### 测试 3: 工具调用

**目的**: 验证 tool span 创建/关闭

**操作**:
```
你: 读取当前目录的 package.json 文件内容
AI: (调用 read 工具，返回文件内容)
```

**验证**:
1. Trace 下应有 **1 个 LLM Span** + **1 个 Tool Span**
2. Tool Span:
   - `name: "tool:<tool名>"` (如 `tool:read`)
   - `type: "tool"`
   - `input` 含工具参数 (如 `{path: "package.json"}`)
   - `output.result` 含工具执行结果 (文件内容)
   - `metadata.toolName` 和 `metadata.callID` 存在

---

### 测试 4: 多工具调用

**目的**: 验证多个 tool span 并发不串扰

**操作**:
```
你: 列出当前目录的文件，然后读取 tsconfig.json 的内容
AI: (先调用 ls 工具，再调用 read 工具)
```

**验证**:
1. 应有 **多个 Tool Span**，每个有独立的 `callID`
2. 每个 Tool Span 正确关闭 (有 `output`)
3. Tool Span 的 `callID` 互不相同

---

### 测试 5: 长对话 (10+ 轮)

**目的**: 验证长时间运行不泄漏、usage 累积正确

**操作**:
```
你: 帮我写一个 TODO 应用
AI: (开始写)
你: 加上删除功能
AI: (修改)
你: 加上编辑功能
AI: (修改)
... (持续 10 轮以上，中间穿插工具调用)
你: 总结一下你做了什么
AI: (总结)
```

**验证**:
1. 整个过程是 **1 个 Trace**
2. LLM Span 数量 = 对话轮数
3. Tool Span 数量 = 实际工具调用次数
4. Trace 的 `metadata.usage` 是所有轮次的 token 总和
5. Trace 的 `metadata.totalTokens` 是一个合理的大数字
6. **性能**: 无明显卡顿或内存增长
7. 最终 Trace 应被正确 finalize (非 expired)

---

### 测试 6: 新 Session (Trace 分离)

**目的**: 验证不同 session 产生独立的 Trace

**操作**:
1. 在 OpenCode 中开始第一个对话，进行 2-3 轮
2. 创建一个新 session (如果 OpenCode 支持，或者重新启动 OpenCode)
3. 在新 session 中进行另一个对话

**验证**:
1. Opik 中应有 **2 个独立的 Trace**
2. 每个 Trace 有自己的 session ID
3. Token 使用量互相独立不串扰

---

### 测试 7: Subagent / Multiagent (如果 OpenCode 支持)

**目的**: 验证 parentID 链接 + subagent span

**操作**:
触发 OpenCode 的 subagent 功能 (如果有的话 — 需要确认 OpenCode 是否会发出带 `parentID` 的 `session.created` 事件)。

**验证**:
1. 应有 **1 个 Root Trace** + **N 个 Subagent Span** (type: "agent")
2. Subagent Span 嵌套在 Root Trace 下
3. Child session 的 LLM/Tool span 嵌套在对应的 Subagent Span 下
4. Child session idle 时只关闭 Subagent Span，不关闭 Root Trace
5. Parent session idle 时关闭 Root Trace + flush

> 如果 OpenCode 不支持 subagent，此测试可以跳过，但需要在诊断阶段确认。

---

### 测试 8: 流式 Token 累积

**目的**: 验证 `message.part.updated` 流式文本是否正确累积到 LLM Span

**操作**:
```
你: 写一篇 500 字的短文
AI: (流式输出一篇长文)
```

**验证**:
1. LLM Span 的 `output.response` 应包含 **完整文本** (不是截断的)
2. 如果诊断日志显示 `message.part.updated` 事件被触发，那么流式累积在工作
3. 如果只有 `message.updated` (不含 `message.part.updated`)，也没关系 — `content` 字段会作为 fallback

---

### 测试 9: 异常恢复

**目的**: 验证插件不会 crash OpenCode

**操作**:
1. 正常对话几轮后，**停止 Opik Docker 容器**
2. 继续在 OpenCode 中对话
3. 预期：OpenCode 正常工作，控制台看到 flush 失败日志
4. **重新启动 Opik Docker 容器**
5. 再进行一轮对话
6. 等待 session idle

**验证**:
1. OpenCode 始终正常，不因 Opik 不可用而中断
2. 控制台显示 `[opik-opencode] Flush attempt X failed, retrying...`
3. Opik 恢复后，新的 trace 能正常落库
4. 旧的 trace 可能丢失 (flush 失败)，这是预期行为

---

### 测试 10: Trace 过期

**目的**: 验证不正常结束的 session 会被自动清理

**操作**:
1. 开始一个对话
2. **不等 session idle，直接关闭 OpenCode terminal** (强制退出)
3. 等待 5 分钟以上 (默认 trace 过期时间)

**验证**:
> 这个测试需要观察，因为 OpenCode 关闭时插件的 `stop()` 可能会或可能不会被调用。
> 如果 stop() 被正确调用，所有 trace 会被 finalize。
> 如果 stop() 没被调用，trace 会在下次启动时丢失 (进程级状态)。

---

## 四、Opik UI 数据核验清单

对每个测试用例，在 Opik UI 中检查以下项：

### Trace 级别

| 字段 | 检查 |
|------|------|
| `name` | 是否以 `opencode-` 开头 |
| `projectName` | 是否等于配置的 `opencode-real-test` |
| `input` | 是否存在 (可能为空 `{}`) |
| `output.response` | 是否等于最后一轮 AI 回答 |
| `metadata.sessionID` | 是否是有效的 session ID |
| `metadata.usage.input` | 是否等于所有 LLM 轮次的 input token 之和 |
| `metadata.usage.output` | 是否等于所有 LLM 轮次的 output token 之和 |
| `metadata.totalTokens` | 是否等于 input + output + reasoning + cache |
| `metadata.source` | 应为 `"opik-opencode"` |
| `startTime` / `endTime` | 都应存在且合理 |

### LLM Span 级别

| 字段 | 检查 |
|------|------|
| `name` | `"llm"` |
| `type` | `"llm"` |
| `input.messages` | 含用户发送的文本 |
| `output.response` | 含 AI 回答文本 |
| `usage.prompt_tokens` | 大于 0 |
| `usage.completion_tokens` | 大于 0 |
| `usage.total_tokens` | = prompt + completion |
| `metadata.modelID` | 如 `"claude-sonnet-4-20250514"` |
| `metadata.providerID` | 如 `"anthropic"` |
| `metadata.sessionID` | 与 Trace 的 sessionID 一致 |

### Tool Span 级别

| 字段 | 检查 |
|------|------|
| `name` | `"tool:<工具名>"` |
| `type` | `"tool"` |
| `input` | 工具参数 |
| `output.result` | 工具执行结果 |
| `metadata.toolName` | 工具名 |
| `metadata.callID` | 唯一标识 |
| `metadata.title` | 显示名称 (如果有) |

---

## 五、常见问题排查

### 插件加载失败
```
# 没有看到 [opik-opencode] Started 日志
```
- 检查 opencode.json 的 plugin 路径
- 确认 `dist/index.js` 存在: `ls -la /path/to/opik-opencode/dist/index.js`
- 确认 OpenCode 版本支持 plugin
- 试试 npm link 方式

### 事件没有触发
```
# 没有看到 [opik-debug] EVENT 日志
```
- 可能 OpenCode 版本不支持 `event` catch-all
- 检查 `@opencode-ai/plugin` 版本是否 >= 1.3.0
- 试试加一个 `chat.message` 诊断日志看是否直接 hook 被调用

### Trace 创建了但数据不完整
- 检查 `message.updated` 事件是否触发 (用诊断日志)
- 检查 AssistantMessage 的 tokens 字段结构
- 可能 `role` 不是 `"assistant"`，event handler 中有 `if (msg.role !== "assistant") return` 过滤

### Opik 中看不到数据
- 确认 apiUrl 正确: `http://localhost:5173/api`
- 运行连通性检查: `curl http://localhost:5173/api/health`
- 检查有没有 flush 错误: `[opik-opencode] Flush failed`
- 确认项目名匹配: 在 Opik UI 搜索 `opencode-real-test`

### Token 数据为 0 或缺失
- `message.updated` 事件可能不含 `tokens` 字段
- 需要确认 AssistantMessage 的 `tokens` 实际结构
- 可能需要从 `message.part.updated` 的最后一帧获取

---

## 六、测试结果记录模板

每个测试用例记录：

```
## 测试 X: <名称>
- 日期:
- OpenCode 版本:
- Opik 版本:
- 结果: PASS / FAIL / PARTIAL

### 事件触发情况
- [ ] session.created 触发
- [ ] chat.message 触发
- [ ] message.updated 触发
- [ ] message.part.updated 触发
- [ ] tool.execute.before 触发
- [ ] tool.execute.after 触发
- [ ] session.idle 触发
- [ ] session.status 触发

### Opik 数据落库
- [ ] Trace 创建成功
- [ ] Trace 名称正确
- [ ] LLM Span 数量正确: 预期 ___ 实际 ___
- [ ] Tool Span 数量正确: 预期 ___ 实际 ___
- [ ] input/output 内容正确
- [ ] usage token 数据完整
- [ ] metadata 字段完整

### 发现的问题
1. ...
2. ...

### 需要的代码调整
1. ...
2. ...
```

---

## 七、测试后清理

```bash
# 移除诊断日志后重新构建
npm run build

# 如果使用了环境变量，清理
unset OPIK_API_URL OPIK_PROJECT_NAME OPIK_API_KEY OPIK_WORKSPACE_NAME

# 在 Opik UI 中可以删除测试项目数据
```
