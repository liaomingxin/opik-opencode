# @liaomx/opik-opencode

[![npm version](https://img.shields.io/npm/v/@liaomx/opik-opencode.svg)](https://www.npmjs.com/package/@liaomx/opik-opencode)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)

[OpenCode](https://github.com/opencode-ai/opencode) 的 [Opik](https://www.comet.com/site/products/opik/) 可观测性插件。

安装后，你在 OpenCode 中的**每一次对话**都会自动记录到 Opik 平台——包括 LLM 调用、工具执行、多智能体协作的完整轨迹，无需修改任何代码。

**v0.2.0 新增**: 支持 Thread 聚合，同一会话内的所有 Trace 自动归入同一 Thread；LLM Span 包含模型名称和轮次号，便于快速定位。

---

## 目录

- [它能帮你做什么](#它能帮你做什么)
- [前置条件](#前置条件)
- [第一步：准备 Opik 账号](#第一步准备-opik-账号)
- [第二步：安装插件](#第二步安装插件)
- [第三步：配置插件](#第三步配置插件)
- [第四步：启动 OpenCode 并使用](#第四步启动-opencode-并使用)
- [第五步：在 Opik 上查看 Trace 数据](#第五步在-opik-上查看-trace-数据)
- [Thread 聚合与 Multiagent 架构](#thread-聚合与-multiagent-架构)
- [配置参考](#配置参考)
- [常见问题](#常见问题)
- [License](#license)

---

## 它能帮你做什么

当你在 OpenCode 里和 AI 对话时，插件会**自动**在后台记录：

| 你在 OpenCode 里做的事 | Opik 上看到的内容 |
|---|---|
| 发送一条消息给 AI | 一条 **Trace**（完整对话轨迹），自动归入 **Thread** |
| AI 思考并回复 | **LLM Span** — 模型名称 + 轮次号（如 `claude-sonnet-4-5 #2`）、输入/输出文本、Token 用量 |
| AI 调用工具（读文件、执行命令等） | **Tool Span** — 工具名、参数、输出、耗时 |
| AI 委派子智能体工作 | **Subagent Span** — 嵌套在父级 Trace 下的子任务链路，通过跨会话桥接完整串联 |

所有数据实时同步到 Opik，你可以随时在 Opik 仪表盘上回溯、分析、评估。

---

## 前置条件

| 项目 | 要求 |
|---|---|
| Node.js | >= 22.12.0 |
| OpenCode | 已安装并可正常使用（`opencode` 命令可运行） |
| Opik 账号 | Cloud（免费注册）或 本地自部署 |

---

## 第一步：准备 Opik 账号

你有三种选择，**任选其一**：

### 方式 A：Opik Cloud（推荐，最快上手）

1. 打开 [https://www.comet.com/signup](https://www.comet.com/signup)，注册一个免费账号
2. 登录后进入 Opik 仪表盘
3. 点击左下角头像 → **API Keys** → **Create API Key**
4. 复制你的 API Key（形如 `abcdef1234567890...`）
5. 记下你的 **Workspace 名称**（页面左上角显示）

> 你需要的信息：
> - **API Key**: `你刚才复制的 Key`
> - **API URL**: `https://www.comet.com`
> - **Workspace**: `你的 Workspace 名称`

### 方式 B：本地部署（无需注册，数据全在本地）

```bash
# 克隆 Opik 仓库并启动
git clone https://github.com/comet-ml/opik.git
cd opik
./opik.sh
```

等待启动完成后，打开浏览器访问 `http://localhost:5173` 即可看到 Opik 本地仪表盘。

> 你需要的信息：
> - **API Key**: 不需要
> - **API URL**: `http://localhost:5173`
> - **Workspace**: 不需要

### 方式 C：团队自建的 Opik 服务器

向你的运维/管理员获取以下信息：
- **API URL**（如 `https://opik.yourcompany.com`）
- **API Key**（如有）
- **Workspace 名称**（如有）

---

## 第二步：安装插件

在你的 OpenCode 项目目录下运行：

```bash
npm install @liaomx/opik-opencode
```

---

## 第三步：配置插件

有两种配置方式，**任选其一**：

### 方式 A：环境变量（推荐）

将以下内容添加到你的 `~/.bashrc`、`~/.zshrc` 或项目的 `.env` 文件中：

```bash
# 必填（Cloud 和自建服务器需要，本地部署不需要）
export OPIK_API_KEY="你的 API Key"

# 必填
export OPIK_API_URL="https://www.comet.com"     # Cloud 用户
# export OPIK_API_URL="http://localhost:5173"    # 本地部署用户

# 可选
export OPIK_WORKSPACE_NAME="你的 Workspace"      # Cloud 用户填写
export OPIK_PROJECT_NAME="opencode"               # 项目名称，默认 "opencode"
```

然后在 `opencode.json` 中添加插件（无需重复写配置）：

```json
{
  "plugins": ["@liaomx/opik-opencode"]
}
```

### 方式 B：直接写在 opencode.json 中

将所有配置写在 `opencode.json` 的 plugins 数组里：

```json
{
  "plugins": [
    ["@liaomx/opik-opencode", {
      "apiKey": "你的 API Key",
      "apiUrl": "https://www.comet.com",
      "workspaceName": "你的 Workspace",
      "projectName": "my-project"
    }]
  ]
}
```

> **找不到 opencode.json？**
>
> 该文件通常在你的项目根目录下。如果没有，手动创建一个即可。
> OpenCode 也支持 `.opencode/config.json` 路径。

---

## 第四步：启动 OpenCode 并使用

```bash
opencode
```

正常使用 OpenCode 即可。如果配置正确，你会在终端看到一行启动日志：

```
[opik-opencode] Started. Project: opencode
```

看到这行表示插件已成功连接 Opik，**后续所有操作都会自动记录**。

现在你可以像平常一样和 AI 对话、让它读文件、写代码、执行命令——一切照常，不需要做任何额外操作。

---

## 第五步：在 Opik 上查看 Trace 数据

### Cloud 用户

1. 打开 [https://www.comet.com/opik](https://www.comet.com/opik) 并登录
2. 在左侧导航栏点击 **Projects**
3. 找到你的项目（默认名称 `opencode`）并点击进入
4. 你会看到 **Traces 列表**——每一行对应 OpenCode 中的一次对话

### 本地部署用户

1. 打开 `http://localhost:5173`
2. 同样进入 Projects → 找到 `opencode` 项目 → 查看 Traces

### 如何看懂 Trace 数据

点击任意一条 Trace，你会看到类似这样的结构：

```
🧵 Thread: abc123-session-id         ← Thread（按 sessionID 聚合）
│
📦 opencode-Fix login bug            ← Trace（整次对话，threadId = sessionID）
│
├─ 🤖 claude-sonnet-4-5              ← 第 1 轮 AI 思考（自动命名为模型名）
│   ├─ Input: "帮我修复登录页面的 bug"
│   ├─ Output: "我来看一下代码..."
│   └─ Tokens: input=150, output=280
│
├─ 🔧 tool:read_file                 ← AI 读取文件
│   ├─ Args: { path: "src/login.ts" }
│   └─ Output: "import React from..."
│
├─ 🤖 claude-sonnet-4-5 #2           ← 第 2 轮（自动添加轮次号）
│   ├─ Input: [文件内容 + 上下文]
│   ├─ Output: "我发现了问题，需要修改..."
│   └─ Tokens: input=820, output=450
│
├─ 🔧 tool:write_file                ← AI 写入修复
│   ├─ Args: { path: "src/login.ts", content: "..." }
│   └─ Output: "File written"
│
└─ 🤖 claude-sonnet-4-5 #3           ← 第 3 轮 AI 总结
    ├─ Output: "已修复！问题是..."
    └─ Tokens: input=900, output=120
    
    📊 Total Tokens: 2720
```

**多智能体场景**下，你还会看到嵌套结构：

```
🧵 Thread: session-xyz               ← Thread 聚合
│
📦 opencode-Complex Task             ← 父 Trace (threadId = session-xyz)
├─ 🤖 claude-sonnet-4-5 (主智能体)
├─ 👤 subagent:Research Agent         ← 子智能体 1（通过桥接层串联）
│   ├─ 🤖 claude-sonnet-4-5
│   └─ 🔧 tool:web_search
└─ 👤 subagent:Code Agent             ← 子智能体 2（通过桥接层串联）
    ├─ 🤖 claude-sonnet-4-5
    └─ 🔧 tool:write_file
```

---

## Thread 聚合与 Multiagent 架构

### Thread 聚合

插件会自动为每个 OpenCode 会话设置 `threadId`，使同一会话内的所有 Trace 在 Opik 中归入同一 **Thread**。你可以在 Opik 仪表盘中按 Thread 维度聚合查看，快速回溯一个完整任务的所有对话轮次。

- **threadId** = OpenCode 的 `sessionID`（root session 级别）
- 子 agent 共享父 Trace，不会产生额外 Thread

### Multiagent 数据串联架构

在多智能体场景下，插件通过 **跨会话桥接层** (`subagentSpanHosts`) 确保子 agent 的所有数据（LLM 调用、Tool 调用）都能正确挂载到父 Trace 的 Subagent Span 下，即使事件乱序也不会丢失数据。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Opik Thread (threadId = sessionID)           │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Trace: opencode-Fix login bug                            │  │
│  │                                                           │  │
│  │  ├─ LLM Span: claude-sonnet-4-5                           │  │
│  │  │   (第 1 轮: 分析问题)                                  │  │
│  │  │                                                        │  │
│  │  ├─ Tool Span: tool:read_file                             │  │
│  │  │   (读取源码)                                           │  │
│  │  │                                                        │  │
│  │  ├─ LLM Span: claude-sonnet-4-5 #2                        │  │
│  │  │   (第 2 轮: 制定方案)                                  │  │
│  │  │                                                        │  │
│  │  ├─ Subagent Span: subagent:Research Agent  ← 桥接层管理  │  │
│  │  │   ├─ LLM Span: claude-sonnet-4-5                       │  │
│  │  │   └─ Tool Span: tool:web_search                        │  │
│  │  │                                                        │  │
│  │  ├─ Subagent Span: subagent:Code Agent      ← 桥接层管理  │  │
│  │  │   ├─ LLM Span: claude-sonnet-4-5                       │  │
│  │  │   └─ Tool Span: tool:write_file                        │  │
│  │  │                                                        │  │
│  │  └─ LLM Span: claude-sonnet-4-5 #3                        │  │
│  │      (第 3 轮: 汇总结果)                                  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 核心组件说明

| 组件 | 作用 |
|---|---|
| **threadId** | 将同一 OpenCode 会话的所有 Trace 聚合到 Opik 的同一 Thread |
| **resolveSessionSpanContainer** | 统一的容器解析函数，自动查找每个事件应该挂载的父级 Trace 或 Span |
| **subagentSpanHosts** | 跨会话桥接 Map，解决子 agent 事件到达时父 session 信息的查找问题 |
| **LLM 轮次命名** | 自动为 LLM Span 添加模型名 + 轮次号（如 `claude-sonnet-4-5 #2`），便于区分多轮对话 |

### 桥接层工作原理

1. 子 session 创建时，在 `subagentSpanHosts` 中注册 `childSessionID → 父 trace 信息`
2. 当子 session 的 tool/LLM 事件到来时，通过 `resolveSessionSpanContainer` 先查桥接表找到父 trace
3. 子 session 结束时，自动清除桥接记录
4. 桥接表最大容量 1000 条，超出时 FIFO 淘汰最早的记录

---

## 配置参考

### 基础配置

| 配置项 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `apiKey` | `OPIK_API_KEY` | — | Opik API 密钥 |
| `apiUrl` | `OPIK_API_URL` | — | Opik 服务地址 |
| `projectName` | `OPIK_PROJECT_NAME` | `"opencode"` | Opik 项目名称 |
| `workspaceName` | `OPIK_WORKSPACE_NAME` | — | Opik 工作区名称（Cloud 用户需要） |

### 高级配置（通常无需修改）

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `flushRetries` | `2` | 数据上传失败时的重试次数 |
| `flushRetryBaseDelay` | `250` | 重试基础延迟（毫秒） |
| `flushRetryMaxDelay` | `5000` | 重试最大延迟（毫秒） |
| `traceExpireMinutes` | `5` | 非活跃 Trace 自动过期时间（分钟） |
| `sanitizePayloads` | `true` | 是否在上传前脱敏数据 |

### 配置优先级

当多处都有配置时，按以下优先级合并：

```
opencode.json 中的 plugin options  >  环境变量  >  默认值
```

---

## 常见问题

### 没有看到 `[opik-opencode] Started` 日志

- 检查 `opencode.json` 中的 `plugins` 是否正确配置了包名
- 确认 `node_modules/@liaomx/opik-opencode` 目录存在（即 `npm install` 成功）

### Trace 数据没有出现在 Opik 上

- 检查 `OPIK_API_KEY` 和 `OPIK_API_URL` 是否正确
- Cloud 用户确认 `OPIK_WORKSPACE_NAME` 已设置
- 本地部署确认 `http://localhost:5173` 可以在浏览器打开
- 检查终端有无 `[opik-opencode] Flush failed` 报错

### 多个项目想分开记录

给不同项目设置不同的 `projectName`：

```json
{
  "plugins": [
    ["@liaomx/opik-opencode", {
      "projectName": "project-a"
    }]
  ]
}
```

在 Opik 仪表盘上会看到独立的项目入口。

### 想在现有会话结束后再安装，需要重启 OpenCode 吗？

是的。插件在 OpenCode 启动时加载，需要重新运行 `opencode` 命令。

### 数据安全 / 脱敏

插件默认开启数据脱敏（`sanitizePayloads: true`），会自动处理：
- 媒体文件路径引用（`media:` 开头）
- 内部标记（`[[reply_to...]]` 等）
- 不可信内容块

API Key 等敏感信息**不会**出现在 Trace 数据中。

---

## License

[Apache-2.0](./LICENSE)
