# opencode 和 claudecode 的插件怎么开发呢  
  
可以，二者都能开发“插件”，但**思路不一样**：OpenCode 更像“代码里的运行时插件”，你直接写 JavaScript/TypeScript 模块、注册事件和自定义工具；Claude Code 更像“目录约定式插件”，通过 `plugin.json`、`skills/`、`agents/`、`hooks/`、`.mcp.json` 这些目录和文件组合扩展能力。[1][2]

## OpenCode

OpenCode 的插件是一个导出一个或多个插件函数的 JS/TS 模块；插件函数接收上下文对象，比如 `project`、`directory`、`worktree`、`client` 和 Bun 的 shell API `$`，然后返回 hooks 对象。[2]
本地插件放在 `.opencode/plugins/`（项目级）或 `~/.config/opencode/plugins/`（全局），启动时会自动加载；也可以通过配置文件引用 npm 包形式的插件，OpenCode 会在启动时用 Bun 自动安装并缓存依赖。[2]

一个最常见的开发方式是做两类扩展：  
- 监听事件，比如 `session.created`、`tool.execute.before`、`tool.execute.after`、`file.edited`、`permission.asked` 等。[2]
- 注册自定义工具，供 OpenCode 在运行时调用，工具通常包含 `description`、参数 schema 和 `execute` 函数。[2]

一个简化示例可以理解成这样：

```ts
import { Plugin, tool } from '@opencode-ai/plugin'

export const MyPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      myTool: tool({
        description: 'Custom tool',
        args: { input: tool.schema.string() },
        execute: async (args) => `Result: ${args.input}`,
      }),
    },
    event: async ({ event }) => {
      console.log(event.type)
    },
  }
}
```

这个例子体现了 OpenCode 的核心模式：在代码里直接声明工具、事件处理器，属于偏 SDK/编程式扩展。[2]

## Claude Code

Claude Code 插件必须有独立目录，核心清单文件是 `.claude-plugin/plugin.json`，里面至少定义 `name`、`description`、`version`，其中 `name` 还决定技能命名空间，比如 `/my-plugin:hello`。[1]
它支持的扩展组件包括 `commands/`、`agents/`、`skills/`、`hooks/`、`.mcp.json`、`.lsp.json` 和 `settings.json`，本质上是把 Claude Code 的各类能力打包成一个可共享、可分发的插件目录。[1]

最小可运行插件通常这样组织：

```text
my-first-plugin/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── hello/
        └── SKILL.md
```

其中 `plugin.json` 用来声明插件元数据，`skills/hello/SKILL.md` 用来定义一个技能；运行时可通过 `claude --plugin-dir ./my-first-plugin` 本地加载测试，然后在 Claude Code 中通过 `/my-first-plugin:hello` 调用。[1]

文档里的最小 manifest 示例是：

```json
{
  "name": "my-first-plugin",
  "description": "A greeting plugin to learn the basics",
  "version": "1.0.0",
  "author": {
    "name": "Your Name"
  }
}
```

而一个最小技能文件 `SKILL.md` 可以这样写：

```md
---
description: Greet the user with a friendly message
disable-model-invocation: true
---

Greet the user warmly and ask how you can help them today.
```

Claude Code 还支持在技能里用 `$ARGUMENTS` 接收命令参数，例如 `/my-first-plugin:hello Alex`，这样技能可以根据传入名字动态执行。[1]

## 主要区别

| 维度 | OpenCode | Claude Code |
|---|---|---|
| 扩展方式 | 写 JS/TS 模块，返回 hooks 和工具。[2] | 按目录规范组织插件文件。[1] |
| 入口形态 | 偏 SDK、偏编程式。[2][2] | 偏声明式、偏内容与配置组合。[1] |
| 自定义工具 | 原生支持，用代码定义 tool/schema/execute。[2][2] | 更常见是通过 skills、agents、hooks、MCP 组合实现能力扩展。[1] |
| 加载方式 | 插件目录自动加载，或从 npm 配置加载。[2] | 用 `--plugin-dir` 本地测试，安装后按插件命名空间调用。[1] |
| 适合场景 | 想深度拦截事件、改运行时行为、加程序化工具。[2] | 想把工作流、技能、代理、MCP 打包给团队共享。[1] |

简单说：如果你更想“写代码改宿主行为”，OpenCode 的插件模型更直接；如果你更想“封装一套可分发工作流能力”，Claude Code 的插件模型通常更顺手。[1][2]

## 开发步骤

如果你要开始做 OpenCode 插件，建议按这个顺序：  
1. 先在 `.opencode/plugins/` 新建一个 TS 文件作为本地插件入口。[2]
2. 在插件函数里先实现一个简单事件监听，比如记录 `tool.execute.after`。[2]
3. 再加一个最小自定义 tool，确认参数 schema 和 `execute` 能正常跑通。[2]
4. 如果用到第三方依赖，在配置目录补 `package.json`，让 OpenCode 启动时通过 Bun 安装依赖。[2]

如果你要开始做 Claude Code 插件，建议按这个顺序：  
1. 新建插件目录和 `.claude-plugin/plugin.json`。[1]
2. 先只做一个 `skills/<name>/SKILL.md`，验证最小插件能加载。[1]
3. 用 `claude --plugin-dir ./your-plugin` 本地测试，并用 `/reload-plugins` 热重载更新。[1]
4. 之后再逐步增加 `agents/`、`hooks/`、`.mcp.json` 或 `.lsp.json`，把插件扩成完整工作流包。[1]

## 选型建议

如果你现在的目标是“做一个能调用 API、读写上下文、拦截事件、加工具”的插件，优先看 OpenCode，因为它的插件 API 更像传统开发者 SDK。[2]
如果你的目标是“给团队做一套命令、技能、代理、MCP 集成，并且方便分享和版本化”，Claude Code 会更适合。[1]

你要不要我下一条直接给你各写一个“最小可运行示例”，分别是：
1. OpenCode 的 TS 插件模板  
2. Claude Code 的目录结构 + `plugin.json` + `SKILL.md` 模板  
  
# Citations:  
[1] [Plugins](https://opencode.ai/docs/plugins/)  
[2] [Opencode plugin development guide.md](https://gist.github.com/rstacruz/946d02757525c9a0f49b25e316fbe715)  
[3] [Opencode Plugins Tutorial: Build Custom AI Features](https://www.youtube.com/watch?v=Wu3G1QwM81M)  
[4] [Ecosystem - OpenCode](https://opencode.ai/docs/ecosystem/)  
[5] [Plugins - Extend OpenCode](https://open-code.ai/en/docs/plugins)  
[6] [Create plugins - Claude Code Docs](https://code.claude.com/docs/en/plugins)  
[7] [SDKs and Plugin System | sst/opencode | DeepWiki](https://deepwiki.com/sst/opencode/10-sdks-and-plugin-system)  
[8] [opencode-plugin-development | Skills...](https://lobehub.com/skills/fkxxyz-cclover-skills-opencode-plugin-development)  
[9] [How to Build Claude Code Plugins: A Step-by-Step Guide](https://www.datacamp.com/tutorial/how-to-build-claude-code-plugins)  
[10] [Intro | AI coding agent built for the terminal](https://opencode.ai/docs/)  
[11] [OpenCode Plugins Guide - GitHub Gist](https://gist.github.com/johnlindquist/0adf1032b4e84942f3e1050aba3c5e4a)  
[12] [Claude Code Plugins](https://github.com/anthropics/claude-code/blob/main/plugins/README.md)  
[13] [Plugin API - OpenCode - Mintlify](https://www.mintlify.com/anomalyco/opencode/sdk/plugin-api)  
[14] [Usage](https://docs.z.ai/devpack/tool/opencode)  
[15] [Improving your coding workflow with Claude Code Plugins - Composio](https://composio.dev/content/claude-code-plugin)  
---  


# 可以基于 opikSDK 实现一个 opencode 插件么，可以实现下述类似 openclaw 数据流获取一样，获取 opencode 的数据流么：

```markdown
好的，我已经完整阅读了项目的所有源码文件。以下是详细的项目分析总结：

---

# 📊 项目全面分析：`@opik/opik-openclaw`

## 一、项目概览

| 属性 | 详情 |
|------|------|
| **名称** | `@opik/opik-openclaw` |
| **版本** | `0.2.8` |
| **许可证** | Apache-2.0 |
| **仓库** | `github.com/comet-ml/opik-openclaw` |
| **定位** | OpenClaw 的官方 Opik 可观测性插件 |
| **语言** | TypeScript (ESM) |
| **运行时** | Node.js ≥ 22.12.0 |
| **源码行数** | ~2,653 行（不含测试），测试 ~3,465 行，总计 ~6,118 行 |

**一句话描述：** 这是一个运行在 OpenClaw Gateway 进程内的插件，将 LLM Agent 的执行轨迹（traces & spans）实时导出到 [Opik](https://github.com/comet-ml/opik) 平台，用于可观测性与监控。

---

## 二、技术栈

| 类别 | 技术 |
|------|------|
| **语言** | TypeScript 5.9+ (ES2022, NodeNext) |
| **包管理** | npm (lockfile v3) |
| **运行时** | Node.js 22.12+ |
| **核心依赖** | `opik` (Opik SDK)、`zod` (数据校验)、`@clack/prompts` (交互式CLI) |
| **测试框架** | Vitest 4.0 |
| **代码质量** | ESLint + Prettier + TypeScript strict mode (`noEmit`) |
| **CI/CD** | GitHub Actions + Dependabot |

---

## 三、项目架构

### 文件结构
```
opik-openclaw/
├── index.ts                          # 🔌 插件入口，注册 service + CLI
├── openclaw.plugin.json              # 📋 插件元数据 & 配置 schema
├── src/
│   ├── types.ts                      # 📝 核心类型定义 (OpikPluginConfig, ActiveTrace)
│   ├── configure.ts                  # 🧙 交互式配置向导 + CLI 命令
│   ├── service.ts                    # ⚙️ 核心 Service —— 管理 trace 生命周期
│   ├── openclaw-plugin-sdk.d.ts      # 类型声明
│   ├── service/
│   │   ├── constants.ts              # 常量定义
│   │   ├── helpers.ts                # 工具函数
│   │   ├── payload-sanitizer.ts      # 🔒 数据清洗（脱敏）
│   │   ├── media.ts                  # 📷 媒体文件路径检测
│   │   ├── attachment-uploader.ts    # ☁️ 附件分片上传
│   │   └── hooks/
│   │       ├── llm.ts                # 🤖 LLM 输入/输出钩子
│   │       ├── tool.ts               # 🔧 工具调用钩子
│   │       └── subagent.ts           # 🧑‍🤝‍🧑 子 Agent 生命周期钩子
│   ├── *.test.ts                     # 单元测试
│   └── *.e2e.test.ts                 # 端到端测试
```

### 分层架构图
```
┌─────────────────────────────────────────────────┐
│              OpenClaw Gateway                    │
│  ┌───────────────────────────────────────────┐  │
│  │          index.ts (Plugin Entry)          │  │
│  │    register → Service + CLI               │  │
│  └────────┬──────────────────┬───────────────┘  │
│           │                  │                   │
│  ┌────────▼────────┐  ┌─────▼──────────────┐   │
│  │  configure.ts   │  │   service.ts        │   │
│  │  (CLI Wizard)   │  │   (Core Service)    │   │
│  │  ‣ configure    │  │   ┌──────────────┐  │   │
│  │  ‣ status       │  │   │   Hooks       │  │   │
│  └─────────────────┘  │   │ ‣ llm.ts      │  │   │
│                        │   │ ‣ tool.ts     │  │   │
│                        │   │ ‣ subagent.ts │  │   │
│                        │   └──────────────┘  │   │
│                        │   ┌──────────────┐  │   │
│                        │   │ Infra         │  │   │
│                        │   │ ‣ sanitizer   │  │   │
│                        │   │ ‣ media       │  │   │
│                        │   │ ‣ uploader    │  │   │
│                        │   └──────────────┘  │   │
│                        └─────────┬───────────┘   │
└────────────────────────────────  │  ──────────────┘
                                   │
                          ┌────────▼────────┐
                          │   Opik Platform  │
                          │  (Cloud / Self)  │
                          └─────────────────┘
```

---

## 四、核心模块详解

### 1. 插件入口 (`index.ts`)
- 导出符合 OpenClaw 插件规范的 `plugin` 对象
- `register()` 中完成两件事：
  - 注册 **Service**（追踪服务）
  - 注册 **CLI** 命令（`openclaw opik configure/status`）
- 调用 `disableLogger()` 禁止 Opik SDK 的 tslog 控制台输出

### 2. 核心 Service (`src/service.ts`) — 最复杂的模块（~720 行）
这是整个插件的大脑，负责：

**状态管理：**
- `activeTraces: Map<sessionKey, ActiveTrace>` — 按会话 key 管理活跃 trace
- `subagentSpanHosts: Map` — 子 Agent span 的宿主映射
- `sessionByAgentId: Map` — agentId 到 sessionKey 的反向映射
- `exporterMetrics` — 运行时指标统计

**生命周期：**
- `start()` — 初始化 Opik 客户端，注册所有 hooks，启动过期清理定时器
- `stop()` — 关闭所有活跃 trace，flush 队列，清理资源

**关键机制：**
- **Flush 重试** — 指数退避策略（默认重试 2 次，基础延迟 250ms，上限 5s）
- **过期 Trace 清理** — 定时扫描不活跃 trace（默认 5 分钟超时，1 分钟扫描间隔）
- **延迟 Finalize** — `agent_end` 使用 `queueMicrotask()` 延迟 finalize，确保同步调用栈上的 `llm_output` 先执行
- **项目目标验证** — 启动时检查配置的 Opik 项目是否存在

### 3. Hook 系统 — 事件驱动的追踪引擎

#### LLM Hooks (`hooks/llm.ts`)
| 事件 | 行为 |
|------|------|
| `llm_input` | 创建新 Trace + LLM Span，记录 prompt/system prompt/model/provider |
| `llm_output` | 更新 LLM Span (output/usage/model)，关闭 span，累积 usage |

#### Tool Hooks (`hooks/tool.ts`)
| 事件 | 行为 |
|------|------|
| `before_tool_call` | 创建 Tool Span，支持 toolCallId 关联 |
| `after_tool_call` | 更新 Tool Span (output/error/duration)，关闭 span。有完善的 sessionKey 降级策略（agentId → 单活跃 trace → 最近活跃 session） |

#### Subagent Hooks (`hooks/subagent.ts`)
| 事件 | 行为 |
|------|------|
| `subagent_spawning` | 在请求方 trace 上创建子 Agent span |
| `subagent_spawned` | 更新 span 元数据（runId, mode 等） |
| `subagent_delivery_target` | 更新投递目标元数据 |
| `subagent_ended` | 记录结果/错误，关闭 span |

### 4. 数据清洗 (`payload-sanitizer.ts`)
**安全过滤策略：**
- 脱敏本地媒体引用：`media:/path/to/img.png` → `media:<image-ref>`
- 移除内部标记：`[[reply_to...]]`
- 移除不受信上下文块（Conversation info, Sender info, Untrusted context）
- 规范化换行符
- 递归清洗嵌套对象/数组

### 5. 媒体处理 (`media.ts`)
- 从载荷中检测本地媒体文件路径（支持 `media:`, `file://`, Markdown 链接格式）
- 支持 30+ 种媒体格式（图片/音频/视频）
- MIME 类型自动推断
- 安全限制：仅接受显式标记的路径，不扫描任意明文

### 6. 附件上传器 (`attachment-uploader.ts`)
- **分片上传**：支持 multipart upload（8MB 分片）
- **队列化**：串行执行上传任务，避免并发压力
- **去重缓存**：LRU 缓存（默认 2048 条）防止重复上传
- **本地/云双路径**：检测 `BEMinIO` magic ID 走本地存储路径

### 7. 配置向导 (`configure.ts`)
基于 `@clack/prompts` 的交互式 CLI 向导：
- 支持三种部署模式：Opik Cloud / Self-hosted / Local
- URL 连通性验证（带重试，最多 3 次）
- API Key 验证（通过获取默认 workspace）
- 自动构建 API URL（local 用 `/api`，cloud 用 `/opik/api`）
- 配置持久化到 OpenClaw 配置文件

---

## 五、数据流

```
用户发消息 → OpenClaw Gateway
       │
       ├─── llm_input 事件 ──→ 创建 Opik Trace + LLM Span
       │
       ├─── before_tool_call ──→ 创建 Tool Span
       │       │
       │       └─── after_tool_call ──→ 更新/关闭 Tool Span
       │
       ├─── subagent_spawning ──→ 创建 Subagent Span
       │       │
       │       ├─── subagent_spawned ──→ 更新 Span
       │       │
       │       └─── subagent_ended ──→ 关闭 Span
       │
       ├─── llm_output 事件 ──→ 更新/关闭 LLM Span (usage, output)
       │
       ├─── model.usage 诊断 ──→ 累积 cost/context 元数据
       │
       └─── agent_end 事件 ──→ 聚合所有元数据 → Finalize Trace → Flush 到 Opik
```

---

## 六、设计亮点

1. **高容错性** — 所有 Opik SDK 调用都包裹在 `safe*` 函数中，异常不会中断 Agent 执行
2. **延迟微任务 Finalize** — `queueMicrotask()` 解决了 `agent_end` 和 `llm_output` 在同一调用栈上的竞态问题
3. **优雅降级** — `after_tool_call` 缺失 sessionKey 时有 3 级降级策略
4. **数据安全** — 完善的载荷脱敏，不传递不受信元数据和本地路径
5. **资源管理** — 过期 trace 自动清理，附件上传去重与 LRU 缓存
6. **可配置性强** — 12 个配置项，同时支持配置文件和环境变量
7. **关注点分离** — Hook 按领域拆分（LLM/Tool/Subagent），通过依赖注入解耦

---

## 七、测试覆盖

| 测试文件 | 行数 | 类型 |
|----------|------|------|
| `service.test.ts` | 2,668 | 核心服务单元测试（最重） |
| `attachment-uploader.test.ts` | 291 | 附件上传测试 |
| `service.e2e.test.ts` | 219 | 端到端集成测试 |
| `configure.test.ts` | 137 | 配置向导测试 |
| `plugin.smoke.test.ts` | 68 | 冒烟测试 |
| `media.test.ts` | 48 | 媒体路径检测测试 |
| `payload-sanitizer.test.ts` | 34 | 数据清洗测试 |
| **总计** | **3,465** | 测试代码占总代码 56.6% |

---

## 八、总结

这是一个**生产级的 LLM 可观测性插件**，架构设计精良：
- 通过 OpenClaw 的事件钩子系统，**零侵入**地捕获 LLM/Tool/Subagent 的完整执行轨迹
- 将这些轨迹结构化为 Opik 的 Trace → Span 层级模型并异步上报
- 具备完善的容错、重试、资源清理和安全脱敏机制
- 代码量精简（~2,600 行源码），但测试覆盖充分（~3,500 行测试）

```  
  
完全可以！OpenCode 的插件系统与 openclaw 的钩子体系非常相近，下面给你一个完整的设计方案和核心代码框架。

***

## 可行性分析

OpenCode 提供的事件钩子和 openclaw 的事件模型高度对应，可以实现完全相同的 Trace → Span 数据流采集。[1]

| openclaw 事件 | OpenCode 对应钩子 | 说明 |
|---|---|---|
| `llm_input` | `chat.message` + `session.created` | LLM 输入拦截 [1] |
| `llm_output` | `message.part.updated` / `message.updated` | 流式输出采集 [1] |
| `before_tool_call` | `tool.execute.before` | 工具调用前 [1] |
| `after_tool_call` | `tool.execute.after` | 工具调用后 [1] |
| `agent_end` | `session.idle` / `session.status` | Session 结束，finalize trace [1] |

***

## 项目结构

参考 opik-openclaw 的分层架构，opencode 版本可以这样组织：

```text
opencode-opik/
├── index.ts                    # 插件入口
├── package.json
├── src/
│   ├── types.ts                # ActiveTrace, OpikPluginConfig
│   ├── service.ts              # 核心 Service，管理 trace 生命周期
│   └── hooks/
│       ├── llm.ts              # chat.message / message.updated
│       ├── tool.ts             # tool.execute.before/after
│       └── session.ts          # session.created / session.idle
```

***

## 核心代码框架

### 1. 插件入口 `index.ts`

```ts
import type { Plugin } from '@opencode-ai/plugin'
import { OpikService } from './src/service.ts'

export default (async (ctx) => {
  const service = new OpikService()
  await service.start(ctx)

  return {
    event: async ({ event }) => {
      // 全局事件分发给 service 处理
    },
    'chat.message': async ({}, { message }) => {
      await service.onLlmInput(message)
    },
    'message.updated': async ({ event }) => {
      await service.onMessageUpdated(event)
    },
    'tool.execute.before': async ({ tool, sessionID, callID }, { args }) => {
      await service.onToolBefore({ tool, sessionID, callID, args })
    },
    'tool.execute.after': async ({ tool, sessionID, callID }, { output, metadata }) => {
      await service.onToolAfter({ tool, sessionID, callID, output, metadata })
    },
  }
}) satisfies Plugin
```



### 2. 核心 Service `src/service.ts`

```ts
import Opik from 'opik'

export class OpikService {
  private client!: Opik
  // 按 sessionID 管理活跃 Trace
  private activeTraces = new Map<string, ActiveTrace>()

  async start(ctx: PluginInput) {
    this.client = new Opik({
      apiKey: process.env.OPIK_API_KEY,
      projectName: 'opencode',
    })
    // 监听 session.idle 事件，用于 finalize trace
    // 注意：OpenCode 事件里 session.idle 对应 agent_end
  }

  async onLlmInput(message: any) {
    const sessionID = message.sessionID
    // 1. 创建 Opik Trace
    const trace = this.client.trace({
      name: `opencode-session-${sessionID}`,
      input: { message: message.content },
    })
    // 2. 创建 LLM Span
    const span = trace.span({
      name: 'llm',
      type: 'llm',
      input: { messages: message.content },
    })
    this.activeTraces.set(sessionID, { trace, currentSpan: span })
  }

  async onToolBefore({ tool, sessionID, callID, args }) {
    const active = this.activeTraces.get(sessionID)
    if (!active) return
    const toolSpan = active.trace.span({
      name: tool,
      type: 'tool',
      input: args,
    })
    active.toolSpans.set(callID, toolSpan)
  }

  async onToolAfter({ tool, sessionID, callID, output }) {
    const active = this.activeTraces.get(sessionID)
    const span = active?.toolSpans.get(callID)
    if (!span) return
    span.update({ output })
    span.end()
  }

  async finalizeTrace(sessionID: string) {
    const active = this.activeTraces.get(sessionID)
    if (!active) return
    // 使用 queueMicrotask 延迟，确保 message.updated 先完成
    queueMicrotask(async () => {
      active.trace.end()
      await this.client.flush()
      this.activeTraces.delete(sessionID)
    })
  }
}
```

这里的 `queueMicrotask()` 延迟 finalize 策略和 openclaw 版本一样，解决 `session.idle` 与 `message.updated` 在同一调用栈的竞态问题。[1]

### 3. 类型定义 `src/types.ts`

```ts
import type Opik from 'opik'

export interface ActiveTrace {
  trace: Opik.Trace
  currentSpan: Opik.Span | null
  toolSpans: Map<string, Opik.Span>
  startedAt: number
  lastActiveAt: number
  usage: { inputTokens: number; outputTokens: number }
}

export interface OpikPluginConfig {
  apiKey?: string
  apiUrl?: string
  projectName?: string
  workspaceName?: string
  flushRetries?: number          // 默认 2
  traceExpireMinutes?: number    // 默认 5
}
```

***

## 数据流映射

```
用户在 OpenCode 发消息
     │
     ├── chat.message 触发 → 创建 Opik Trace + LLM Span
     │
     ├── tool.execute.before → 创建 Tool Span
     │        │
     │        └── tool.execute.after → 关闭 Tool Span
     │
     ├── message.updated (流式 token) → 累积 usage / output
     │
     └── session.idle → queueMicrotask → finalize Trace → flush → Opik
```

***

## 关键注意事项

OpenCode 事件系统与 openclaw 有几处需要特别处理的差异：[1]

- **session.idle vs agent_end**：OpenCode 用 `session.idle` 表示 session 进入空闲，需要结合 `session.status` 事件确认当前 session 真正结束，而不只是短暂等待。
- **message.updated 流式处理**：OpenCode 是流式 SSE 分发，`message.part.updated` 会持续触发，需要在 `session.idle` 之后才能拿到完整 output 和 usage。
- **toolSpans 的 sessionID 降级**：`tool.execute.after` 有时拿不到精确的 sessionID（如子工具调用），需要 3 级降级：精确匹配 → 单活跃 trace → 最近活跃 trace，和 openclaw 版本完全一样。[1]
- **LLM usage 统计**：OpenCode 的 usage 需要在 `message.updated` 事件里从 `message.tokens` 字段累积，而不像 openclaw 有专门的 `model.usage` 诊断事件。

***

## 开发步骤

1. 初始化项目并安装依赖：[1]
   ```bash
   mkdir opencode-opik && cd opencode-opik
   bun init
   bun add opik @opencode-ai/plugin zod
   ```

2. 按上面的结构创建文件，先只实现 `tool.execute.before/after` 两个钩子，确认 Span 能正常上报到 Opik。

3. 在 `opencode.json` 中加载本地插件：
   ```json
   {
     "plugin": ["file:///path/to/opencode-opik/index.ts"]
   }
   ```

4. 再逐步实现 `chat.message`、`message.updated`、`session.idle` 的 trace 生命周期。

5. 最后加数据脱敏、retry/flush、过期 trace 清理定时器，对齐 openclaw 版本的生产级能力。  
  
# Citations:  
[1] [Opencode plugin development guide.md](https://gist.github.com/rstacruz/946d02757525c9a0f49b25e316fbe715)  
---  


# 关于 opencode内部的 multiagent 呢，怎么跟踪串起来  
  
好，现在我们看到了 OpenCode 的真实源码。核心关键点是：**OpenCode 的 multiagent 实现是通过 `parentID` 字段将 child session 挂载到 parent session 上**，而不像 openclaw 那样有专门的 `subagent_spawning/spawned/ended` 事件。下面是完整的追踪串联方案。

***

## OpenCode Multiagent 的底层机制

从 [session/index.ts](https://github.com/anomalyco/opencode/blob/434d82bbe2b855650b7e82fcc3539b6e64e44ddf/packages/opencode/src/session/index.ts) 源码来看，OpenCode 的 multiagent 是这样运作的：

- 每个 session 有 `parentID?: SessionID` 字段，child session 通过此字段指向 parent，形成树状结构。
- `session.created` 事件的 payload 里包含 `info.parentID`，可以在这里捕获父子关系。
- `Session.children(parentID)` 可以主动查询某个 parent 下的所有 child session。
- `Session.create({ parentID })` 是 agent 在运行时派生子 agent 的入口。
- title 上也有明确区分：父 session 用 `"New session - "` 前缀，子 session 用 `"Child session - "` 前缀，可作为辅助标识。

***

## 追踪模型映射

将 OpenCode 的 parent/child session 模型映射到 Opik 的 Trace → Span 层级：

```
OpenCode Session 树                   Opik 追踪模型

parent session                   →   Trace (根)
  ├── messages (llm/tool)        →     ├── LLM Span / Tool Span
  │
  ├── child session A            →     ├── Subagent Span A
  │     ├── messages             →     │     └── 嵌套 LLM/Tool Spans
  │     └── child session A1    →     │           └── Subagent Span A1（递归）
  │
  └── child session B            →     └── Subagent Span B
        └── messages             →           └── 嵌套 LLM/Tool Spans
```

***

## 核心实现：如何串联

### 1. 在 `session.created` 时判断父子并建立 Span

```ts
// hooks/session.ts
export function onSessionCreated(
  event: { sessionID: string; info: Session.Info },
  activeTraces: Map<string, ActiveTrace>
) {
  const { sessionID, info } = event

  if (!info.parentID) {
    // Root session → 创建新 Opik Trace
    const trace = opikClient.trace({
      name: `opencode-${info.title}`,
      metadata: { sessionID, slug: info.slug },
    })
    activeTraces.set(sessionID, {
      trace,
      currentSpan: null,
      toolSpans: new Map(),
      subagentSpans: new Map(),
      startedAt: Date.now(),
    })
  } else {
    // Child session → 在 parent Trace 上创建 Subagent Span
    const parentActive = activeTraces.get(info.parentID)
    if (!parentActive) return

    const subagentSpan = parentActive.trace.span({
      name: `subagent:${info.title}`,
      type: 'agent',          // Opik span type
      metadata: {
        childSessionID: sessionID,
        parentSessionID: info.parentID,
        slug: info.slug,
      },
    })

    // 同时在 activeTraces 里为 child 也注册一条记录
    // 指向同一个 trace，但 currentSpan 是 subagentSpan
    activeTraces.set(sessionID, {
      trace: parentActive.trace,  // 共享同一个根 Trace ！
      currentSpan: subagentSpan,
      toolSpans: new Map(),
      subagentSpans: new Map(),
      startedAt: Date.now(),
      parentSpan: subagentSpan,   // 用于后续嵌套 span 的 parent 关联
    })

    // 反向索引：parent 记录自己的 child subagent span
    parentActive.subagentSpans.set(sessionID, subagentSpan)
  }
}
```

**关键设计**：child session 和 parent session 共享同一个 `Opik Trace` 对象，child 的所有 LLM/Tool Span 都作为 subagentSpan 的子 span 挂载，这样整棵树自然就串联在一起了。

### 2. child session 的 LLM/Tool Span 挂到 Subagent Span 下

```ts
// hooks/llm.ts — 针对 child session 的 LLM span
export function onLlmInput(
  { sessionID, message },
  activeTraces: Map<string, ActiveTrace>
) {
  const active = activeTraces.get(sessionID)
  if (!active) return

  // parentSpan 存在说明是 child session，span 要挂在 subagent span 下
  const llmSpan = (active.parentSpan ?? active.trace).span({
    name: 'llm',
    type: 'llm',
    input: { messages: message.content },
    metadata: { sessionID, model: message.model },
  })

  active.currentSpan = llmSpan
}
```

### 3. child session 结束时关闭 Subagent Span

```ts
// hooks/session.ts — session idle/deleted
export function onSessionFinalized(
  sessionID: string,
  activeTraces: Map<string, ActiveTrace>
) {
  const active = activeTraces.get(sessionID)
  if (!active) return

  // 先关闭所有未关闭的 tool spans
  for (const span of active.toolSpans.values()) span.end()

  // 如果是 child session，关闭 subagent span 而不关闭 trace
  if (active.parentSpan) {
    active.parentSpan.update({
      output: active.lastOutput,
      metadata: { usage: active.usage },
    })
    active.parentSpan.end()
    activeTraces.delete(sessionID)
    // trace 不关闭，由 root session 负责
    return
  }

  // root session：finalize 整个 trace
  queueMicrotask(async () => {
    active.trace.update({ output: active.lastOutput })
    active.trace.end()
    await opikClient.flush()
    activeTraces.delete(sessionID)
  })
}
```

***

## 完整数据流

```
用户发消息 → root session.created (无 parentID)
    │
    └─ 创建 Opik Trace ────────────────────────────────────────────┐
         │                                                         │
         ├── llm_input → LLM Span (root)                          │
         ├── tool.execute.before → Tool Span                      │
         ├── tool.execute.after → 关闭 Tool Span                  │
         │                                                         │
         ├── child session.created (有 parentID) ──────────────┐  │
         │     │                                               │  │
         │     │  ← 共享同一个 Trace，创建 Subagent Span       │  │
         │     │                                               │  │
         │     ├── child llm_input → LLM Span (挂在 Subagent 下) │
         │     ├── child tool.execute.* → Tool Span (挂在 Subagent 下)
         │     │                                               │  │
         │     └── child session idle → 关闭 Subagent Span ───┘  │
         │                                                         │
         └── root session idle → finalize Trace → flush → Opik ──┘
```

***

## 类型定义扩展

原来的 `ActiveTrace` 需要加两个字段：

```ts
export interface ActiveTrace {
  trace: Opik.Trace
  currentSpan: Opik.Span | null
  parentSpan: Opik.Span | null      // 新增：child session 的 subagent span
  toolSpans: Map<string, Opik.Span>
  subagentSpans: Map<string, Opik.Span>  // 新增：parent 记录子 agent spans
  startedAt: number
  lastActiveAt: number
  lastOutput?: string
  usage: { inputTokens: number; outputTokens: number }
}
```

***

## 递归嵌套的处理

OpenCode 支持 child 再生 child（三层甚至更深），实现上只需在 `session.created` 里：

```ts
// 查 parent 的 parentSpan，如果它自己也是 child，
// 则新 child 的 subagent span 挂在 parent 的 parentSpan 下
const parentActive = activeTraces.get(info.parentID)
const anchorSpan = parentActive.parentSpan ?? parentActive.trace
const subagentSpan = anchorSpan.span({ ... })
```

这样无论嵌套多深，所有 span 都正确挂在同一棵 Trace 树里，在 Opik UI 里就能看到完整的多层 agent 调用树。

***

## 与 openclaw 方案的核心差异

| 维度 | openclaw | OpenCode |
|---|---|---|
| 子 agent 识别 | 专用 `subagent_spawning` 事件 | `session.created` 中 `info.parentID` 非空  |
| 子 agent 结束 | 专用 `subagent_ended` 事件 | `session.idle` + `info.parentID` 判断  |
| Trace 共享 | 显式 runId 关联 | child 共享 parent 的 `Opik.Trace` 对象引用 |
| 深度嵌套 | 依赖 subagentSpanHosts Map | 递归查 `parentSpan` anchor，逻辑更简单 |  
  
# Citations:  
