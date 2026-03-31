以下是 opencode 命令行发消息的完整命令列表，涵盖单轮对话、多轮对话和多 agent 任务执行三个场景。

## 单轮对话（一次性发消息）

使用 `opencode run` 命令发送单条消息，执行完后即结束，不保留上下文 ：[1]

```bash
# 直接在参数中传入消息
opencode run "帮我写一个 Python 排序函数"

# 通过管道（stdin）传入消息
echo "解释这段代码" | opencode run

# 指定特定模型
opencode run "优化这段 SQL" --model anthropic/claude-opus-4-5

# 附带文件
opencode run "review 这个文件" --file ./main.go

# 指定 agent（如只读的 plan agent）
opencode run "分析项目结构" --agent plan

# 输出为 JSON 格式（适合脚本处理）
opencode run "列举 bug" --format json
```

## 多轮对话（保持会话上下文）

通过 `--continue` 或 `--session` 标志在多个命令之间延续同一上下文 ：[2][3]

```bash
# 第一轮：开始新会话
opencode run "帮我设计一个用户登录系统"

# 第二轮：继续上一次会话（-c 是 --continue 的简写）
opencode run -c "现在加上 JWT token 验证"

# 第三轮：继续，并指定标题
opencode run -c "再加上 refresh token 机制" --title "登录系统设计"

# 通过 session ID 精确指定会话（ID 可从 --format json 输出中获取）
opencode run --session <session-id> "上一版本有什么问题？"

# Fork 当前会话（创建分支副本，不影响原会话）
opencode run -c --fork "换一种方案实现"
```

## 多 Agent 并行执行任务

opencode 内置 Primary Agent（`build`、`plan`）和 Subagent（`general`、`explore`），支持主 agent 自动调度子 agent 并行工作 ：[4]

```bash
# 使用 build agent（默认，全权限）执行开发任务
# 主 agent 会自动调用 general/explore 等子 agent
opencode run "重构整个 src/ 目录，先分析结构再逐个优化"

# 使用 plan agent（只读、无副作用）做规划分析
opencode run --agent plan "分析代码库，给出重构方案"

# 在消息中 @mention 手动调用特定子 agent
opencode run "请 @explore 搜索所有用了 deprecated API 的文件"

# 并行任务：指定 general subagent，适合多步骤并行工作
opencode run --agent general "同时检查安全漏洞、性能瓶颈和文档覆盖率"

# 创建自定义 agent（交互式）
opencode agent create
```

内置 agent 的功能分工如下 ：[4]

| Agent | 类型 | 权限 | 适用场景 |
|---|---|---|---|
| `build` | primary | 全部工具 | 编码、文件修改、执行命令 |
| `plan` | primary | 只读（修改需确认） | 规划分析、不想改动代码时 |
| `general` | subagent | 全部工具（除 todo） | 多步骤并行任务 |
| `explore` | subagent | 只读 | 快速搜索代码库 |

子 agent 在 TUI 中创建父子 session 树，可用 `<Leader>+Down` 进入子 session，`Left/Right` 切换，`Up` 返回父 session 。[4]

Citations:
[1] [CLI Commands Reference | sst/opencode | DeepWiki](https://deepwiki.com/sst/opencode/7.1-cli-commands-reference)  
[2] [CLI](https://opencode.ai/docs/cli/)  
[3] [命令行(CLI) - OpenCode 中文文档](https://www.opencodecn.com/docs/cli)  
[4] [Agents - OpenCode](https://opencode.ai/docs/agents/)  
[5] [Intro | AI coding agent built for the terminal](https://opencode.ai/docs/)  
[6] [opencode/README.md at main · opencode-ai/opencode](https://github.com/opencode-ai/opencode/blob/main/README.md)  
[7] [I built an OpenCode plugin for multi-agent workflows (fork sessions, agent handoffs, compression). Feedback welcome.](https://www.reddit.com/r/opencodeCLI/comments/1ojlu01/i_built_an_opencode_plugin_for_multiagent/)  
[8] [CLI 命令参考- AI 编程助手实战指南 - OpenCode 中文教程](https://learnopencode.com/appendix/cli)  
[9] [Building Agent Teams in OpenCode: Architecture of Multi- ...](https://dev.to/uenyioha/porting-claude-codes-agent-teams-to-opencode-4hol)  
[10] [OpenCode CLI: Run Prompts, Agents, Sessions, and Automation](https://open-code.ai/en/docs/cli)  
[11] [Agents and subagents using multiple models](https://www.reddit.com/r/opencodeCLI/comments/1qoru7y/agents_and_subagents_using_multiple_models/)  
[12] [命令行(CLI) | OpenCode 中文文档](https://opencodeguide.com/zh/docs/cli)  
[13] [OpenCode config - shamelessly lifted from the Discord server · GitHub](https://gist.github.com/thoroc/1dafddebede4a2577876c844923862aa)  
[14] [Built a multi-agent orchestrator plugin for OpenCode after struggling with GLM-4.7](https://www.reddit.com/r/opencodeCLI/comments/1qfzaju/built_a_multiagent_orchestrator_plugin_for/)  
[15] [mirrors/opencode: AI coding agent, built for the terminal. - Forgejo ...](https://git.joshthomas.dev/mirrors/opencode/src/commit/a3a04d8a549f7e2f8387c027c5fcde17c8440406)