# @liaomx/opik-opencode

[![CI](https://github.com/liaomingxin/opik-opencode/actions/workflows/ci.yml/badge.svg)](https://github.com/liaomingxin/opik-opencode/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@liaomx/opik-opencode.svg)](https://www.npmjs.com/package/@liaomx/opik-opencode)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)

[OpenCode](https://github.com/opencode-ai/opencode) plugin for [Opik](https://www.comet.com/site/products/opik/) observability — traces LLM calls, tool executions, and multiagent lifecycles to the Opik platform for monitoring and evaluation.

## Features

- **LLM Tracing** — Captures every `chat.message` ↔ `message.updated` round-trip as Opik spans with model, tokens, and content
- **Tool Execution** — Records `tool.execute.before` / `tool.execute.after` as tool spans with args, output, and duration
- **Multiagent Support** — Maps OpenCode parent/child sessions to Opik traces with nested subagent spans
- **Streaming Text** — Accumulates `message.part.updated` deltas for complete LLM output capture
- **Auto-Flush** — Exponential backoff retry on flush failures; expired trace auto-cleanup
- **Interactive Setup** — CLI wizard (`npx opik-opencode configure`) for guided Opik connection setup
- **Zero Config** — Works out of the box with environment variables; no code changes needed

## Requirements

- Node.js >= 22.12.0
- OpenCode with `@opencode-ai/plugin` >= 1.0.0
- Opik account (Cloud or self-hosted)

## Installation

```bash
npm install @liaomx/opik-opencode
```

## Quick Start

### 1. Set Environment Variables

```bash
export OPIK_API_KEY="your-opik-api-key"
export OPIK_API_URL="https://www.comet.com"    # or your self-hosted URL
export OPIK_PROJECT_NAME="opencode"             # optional, defaults to "opencode"
export OPIK_WORKSPACE_NAME="your-workspace"     # optional
```

### 2. Add to OpenCode Config

Add the plugin to your `opencode.json`:

```json
{
  "plugins": [
    ["@liaomx/opik-opencode", {
      "projectName": "my-project",
      "workspaceName": "my-workspace"
    }]
  ]
}
```

Or as a simple string entry (uses env vars for all config):

```json
{
  "plugins": ["@liaomx/opik-opencode"]
}
```

### 3. Interactive Setup (Alternative)

Run the CLI wizard to configure Opik connection interactively:

```bash
npx opik-opencode configure
```

Check current configuration status:

```bash
npx opik-opencode status
```

## Configuration

Configuration is resolved in order of priority: **explicit config** > **opencode.json plugin options** > **environment variables** > **defaults**.

| Option | Env Variable | Default | Description |
|---|---|---|---|
| `apiKey` | `OPIK_API_KEY` | — | Opik API key |
| `apiUrl` | `OPIK_API_URL` | — | Opik API URL |
| `projectName` | `OPIK_PROJECT_NAME` | `"opencode"` | Opik project name |
| `workspaceName` | `OPIK_WORKSPACE_NAME` | — | Opik workspace name |
| `flushRetries` | — | `2` | Number of flush retries on failure |
| `flushRetryBaseDelay` | — | `250` | Base delay (ms) for exponential backoff |
| `flushRetryMaxDelay` | — | `5000` | Max delay (ms) for exponential backoff |
| `traceExpireMinutes` | — | `5` | Minutes before inactive trace auto-expires |
| `expireScanInterval` | — | `60000` | Interval (ms) to scan for expired traces |
| `sanitizePayloads` | — | `true` | Sanitize payloads before sending |
| `uploadAttachments` | — | `false` | Upload media attachments (reserved) |

## Programmatic Usage

```typescript
import { createOpikPlugin } from "@liaomx/opik-opencode"

const plugin = createOpikPlugin({
  apiKey: "your-api-key",
  apiUrl: "https://www.comet.com",
  projectName: "my-project",
})
```

## Architecture

```
index.ts                        ← Plugin entry, event catch-all + direct hook keys
  │                               event: session.created/idle/status, message.updated/part.updated
  │                               direct: chat.message, tool.execute.before/after
  ├─ src/service.ts             ← Core Service: Opik client + lifecycle + flush/expire
  │    ├─ hooks/session.ts      ← session.created → Trace / multiagent subagent spans
  │    │                          session.idle → queueMicrotask deferred finalize
  │    ├─ hooks/llm.ts          ← chat.message → LLM Span / message.updated → close
  │    │                          message.part.updated → streaming text accumulation
  │    ├─ hooks/tool.ts         ← tool.execute.before/after (3-level fallback)
  │    ├─ helpers.ts            ← resolveConfig, safe(), backoff
  │    ├─ payload-sanitizer.ts  ← Data sanitization
  │    ├─ constants.ts          ← Defaults / constants
  │    └─ types.ts              ← All type definitions
  └─ src/configure.ts           ← Interactive config wizard (@clack/prompts)
       └─ src/configure-cli.ts  ← CLI entry (npx opik-opencode configure/status)
```

### Event Mapping

| OpenCode Event | Hook Type | Opik Mapping | Status |
|---|---|---|---|
| `session.created` | `event` catch-all | Trace creation + subagent spawning | Implemented |
| `session.idle` | `event` catch-all | agent_end + subagent_ended | Implemented |
| `session.status` | `event` catch-all | Metadata update (busy/idle/retry) | Implemented |
| `message.updated` | `event` catch-all | LLM output span close | Implemented |
| `message.part.updated` | `event` catch-all | Streaming text accumulation | Implemented |
| `chat.message` | Direct hook key | LLM input span creation | Implemented |
| `tool.execute.before` | Direct hook key | Tool span start | Implemented |
| `tool.execute.after` | Direct hook key | Tool span end | Implemented |

## Development

### Setup

```bash
git clone https://github.com/liaomingxin/opik-opencode.git
cd opik-opencode
npm install
```

### Scripts

```bash
npm run build        # Build with tsup (ESM + declarations)
npm run dev          # Watch mode build
npm run typecheck    # TypeScript type checking (tsc --noEmit)
npm run lint         # ESLint
npm test             # Unit + smoke tests (vitest)
npm run test:e2e     # End-to-end integration tests
npm run clean        # Remove dist/
```

### Test Suite

| Test | Count | Scope |
|---|---|---|
| Unit tests | ~65 | helpers, payload-sanitizer, session/llm/tool hooks, service, configure |
| Smoke tests | ~30 | Plugin API surface, config priority, handler resilience |
| E2E tests | ~22 | Full session lifecycle, multiagent, flush retry, expiry |
| **Total** | **~117+** | |

```bash
# Run all unit + smoke tests
npm test

# Run e2e tests (longer timeout)
npm run test:e2e

# Run with coverage
npx vitest run --coverage
```

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `opik` | ^1.0.0 | Opik SDK (trace/span creation) |
| `zod` | ^3.24.0 | Data validation |
| `@clack/prompts` | ^1.1.0 | Interactive CLI config wizard |

### Peer Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@opencode-ai/plugin` | >=1.0.0 | OpenCode plugin type definitions |

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes and add tests
4. Run the full test suite: `npm test && npm run test:e2e && npm run typecheck`
5. Submit a pull request

## License

[Apache-2.0](./LICENSE) — Copyright 2026 Comet ML, Inc.
