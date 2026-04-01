**可以的，OpenCode 完全支持你描述的这种"主 Agent 委托多个 Subagent 并行产出"的工作流。** 下面详细说明如何配置。

***

## OpenCode 的 Agent 架构

OpenCode 有两类 Agent ：[1]

- **Primary Agent（主代理）**：负责主对话和总体协调，用户直接交互的入口
- **Subagent（子代理）**：由 Primary Agent 通过 `Task` 工具调用，或用户用 `@` 手动触发，执行具体子任务

你描述的 PMT Agent 作为主会话入口、三个 Subagent 分别生产技术方案/UI 稿/测试方案，正是 OpenCode 的设计目标场景 。[2]

***

## 实现方案：配置你的 PMTagent

### 1. 创建主 Agent（PMTagent）

在项目根目录 `.opencode/agents/pmtagent.md` 中创建：

```markdown
---
description: PM 总协调 Agent，负责分解需求并委托子 Agent 并行生产技术方案、UI 稿和测试方案
mode: primary
model: anthropic/claude-opus-4-5
permission:
  task:
    - allow: "tech-agent"
    - allow: "ui-agent"
    - allow: "test-agent"
---

你是一个 PM 协调 Agent。收到需求后，你需要：
1. 分析需求，分别为技术方案、UI 稿、测试方案各生成一份详细 prompt
2. 同时委托 @tech-agent、@ui-agent、@test-agent 并行执行
3. 收到三份产物后，整合并呈现最终结果
```

### 2. 创建三个 Subagent

`.opencode/agents/tech-agent.md`：
```markdown
---
description: 生成技术架构方案，输出技术选型、模块设计、接口定义
mode: subagent
model: anthropic/claude-sonnet-4-5
---
你是一个资深架构师，负责根据需求生成完整的技术方案文档...
```

`.opencode/agents/ui-agent.md`：
```markdown
---
description: 生成 UI 设计稿描述和交互规范文档
mode: subagent
model: anthropic/claude-opus-4-5
---
你是一个 UI 设计专家，负责根据需求输出界面布局、组件规范和交互说明...
```

`.opencode/agents/test-agent.md`：
```markdown
---
description: 生成测试方案，包括单测、集成测试和验收标准
mode: subagent
model: openai/gpt-5.1-codex
---
你是一个 QA 工程师，负责输出完整的测试策略和测试用例...
```

***

## 并行委托的关键机制

OpenCode 通过 **Task 工具**实现并行委托 ：[3]

- Primary Agent 可以同时启动多个 Subagent，每个都运行在独立的子 session 中
- 你可以通过 `<Leader>+Down` 进入子 session 实时观察每个 Subagent 的执行过程
- Subagent 完成后自动发送 report 回主 session，主 Agent 汇总所有产物[3]
- 不同 Subagent 可以使用**不同的模型**（Claude/GPT/Gemini 混用）[4]

***

## 更高阶：Agent Teams（2026 年 2 月新特性）

OpenCode 在 2026 年 2 月还实现了完整的 **Agent Teams** 功能 ，支持：[5]

| 特性 | 说明 |
|---|---|
| 并行协调 | Lead Agent 同时 spawn 多个 teammate |
| 跨模型支持 | 同一 team 内可混用 Claude / GPT / Gemini |
| 点对点消息 | Subagent 之间可以直接互相通信，不必经过主 Agent 中转 |
| 任务认领 | 共享任务列表，Subagent 原子性地认领任务，避免重复 |

这比你描述的场景还要强大——三个 Subagent 不仅能各自生产产物，还能互相交叉审核（比如 `test-agent` 直接消费 `tech-agent` 输出的接口定义来生成测试用例）。

总结来说，你的 PMTagent 场景是 OpenCode 的核心设计用例，通过 Markdown 配置文件即可快速落地，无需任何额外编程 。[6]

Citations:
[1] [Agents](https://opencode.ai/docs/agents/)  
[2] [15 Minutes to Fix Your AI Dev Workflow with OpenCode](https://www.youtube.com/watch?v=EOIzFMdmox8)  
[3] [OpenCode — Composable AI Agents for Real Coding Workflows](https://productsway.com/posts/power-up-3-opencode-composable-ai-agents-for-real-coding-workflows)  
[4] [OpenCode Multi-Agent Setup: 3 Specialized AI Agents That 10x ...](https://amirteymoori.com/opencode-multi-agent-setup-specialized-ai-coding-agents/)  
[5] [Building Agent Teams in OpenCode: Architecture of Multi- ...](https://dev.to/uenyioha/porting-claude-codes-agent-teams-to-opencode-4hol)  
[6] [Coding With Opencode // Didactic Musings](https://blog.mikesahari.com/posts/coding-with-opencode/)  
[7] [Agents and subagents using multiple models](https://www.reddit.com/r/opencodeCLI/comments/1qoru7y/agents_and_subagents_using_multiple_models/)  
[8] [OpenCode Agent/Subagent/Command best practices](https://www.reddit.com/r/opencodeCLI/comments/1oyp9bi/opencode_agentsubagentcommand_best_practices/)  
[9] [I built an OpenCode plugin for multi-agent workflows (fork sessions, agent handoffs, compression). Feedback welcome.](https://www.reddit.com/r/opencodeCLI/comments/1ojlu01/i_built_an_opencode_plugin_for_multiagent/)  
[10] [OpenCode | The open source AI coding agent](https://opencode.ai)  
[11] [darrenhinde/OpenAgents: AI agent framework for plan-first ... - GitHub](https://github.com/darrenhinde/OpenAgents)  
[12] [opencode-ai/opencode: A powerful AI coding agent. Built ... - GitHub](https://github.com/opencode-ai/opencode)  
[13] [OpenCode setup: Beginner’s Crash course](https://www.youtube.com/watch?v=8toBNmRDO90)  
[14] [OpenCode CRASH Course | OPEN SOURCE AI CODING AGENT](https://www.youtube.com/watch?v=WXffHkvfRpM)  
[15] [joelhooks/opencode-config](https://github.com/joelhooks/opencode-config)