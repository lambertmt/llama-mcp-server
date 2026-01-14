# LibreModel MCP Server

A Model Context Protocol (MCP) server that bridges Claude Desktop/Claude Code with your local LLM instance running via llama-server.

## Features

- **Autonomous agent execution** - local LLM executes tools directly, no Claude middleman
- **Massive Claude token savings** - up to 95% reduction on analysis tasks
- **Built-in SSH execution** - agent can run commands on remote servers
- **Full conversation support** with local LLMs through Claude
- **GPG-encrypted credentials** - secure SSH host configuration
- **Unlimited local tokens** - designed for large context models (128K+)

## Why This Matters: Claude Token Savings

When Claude analyzes large outputs (logs, disk usage, etc.), every character burns API tokens. This MCP server offloads that work to your **free local LLM**.

### How the Token Math Works

**Claude Direct** (no agent) - security audit example:
- Raw SSH output: ~44,000 chars ≈ 11,000 tokens
- Conversation overhead: ~800 tokens
- **Total Claude tokens: ~11,800**

**Claude w/ Agent** - same task:
- Task request to agent: ~100 tokens
- Agent's summary response: ~700 tokens
- **Total Claude tokens: ~800**

**Local LLM** (inside agent, FREE):
- Processes ~44,000 chars raw output: ~11,000 tokens
- Analysis and formatting: ~1,000 tokens
- **Total local tokens: ~12,000**

The tokens don't disappear - they move from Claude (paid) to your local LLM (free). The work gets done, you just don't pay for it.

### Actual Test Results

| Task | Claude (Direct) | Claude (w/ Agent) | Local LLM (free) | Savings |
|------|-----------------|-------------------|------------------|---------|
| **Debugging workflow (7 calls)** | **~56,000** | **~4,100** | **~35,000** | **93%** |
| **Security audit** | **~11,800** | **~800** | **~11,000** | **93%** |
| **Docker logs analysis** | **~10,500** | **~500** | **~10,000** | **95%** |
| System health check | ~5,500 | ~1,500 | ~4,000 | 73% |
| Log analysis (journalctl) | ~4,000 | ~800 | ~3,200 | 80% |
| Code gen (w/ exploration) | ~2,700 | ~1,700 | ~1,000 | 37% |
| Disk analysis | ~1,500 | ~500 | ~1,000 | 65% |
| Code gen (small input) | ~1,550 | ~1,600 | ~1,500 | 0% |
| Simple query (hostname) | ~500 | ~300 | ~200 | 40% |

**When it doesn't help:** Code generation with small inputs (0% savings) - the output dominates token count either way. The agent shines when raw data is large.

### Real-World Example: Debugging Nextcloud Talk

A complete debugging session - Nextcloud Talk returning HTTP 400 errors:

```
7 agent calls over ~10 minutes:
  1. Check signaling + parse logs     → "Config OK, no errors"
  2. Check rate limits + DB           → "Rate limiting on, perms OK"
  3. Enable debug, get stack trace    → "SSL cert not trusted"
  4. Add cert to trust store          → "HTTP 201 - fixed!"

Total Claude tokens (direct): ~56,000
Total Claude tokens (w/ agent): ~4,100
Tokens saved: ~52,000 (93%)
```

Claude stayed strategic (decided what to check), agent did tactical execution (SSH, log parsing, DB queries).

### Real Test: Security Audit

```
Task: "Analyze SSH logs, sudo usage, and check for suspicious activity on 192.168.0.165"

Agent internally executed:
  - ssh_exec: "journalctl -u sshd -n 200; journalctl _COMM=sudo -n 100; ss -tuln"
  - Raw output: 43,821 characters (Claude NEVER saw this)
  - Local LLM tokens: ~11,000 (free)

Claude received: Security summary with severity ratings (~800 tokens)
Savings: 93% reduction in Claude API tokens
```

## Installation

```bash
npm install @openconstruct/llama-mcp-server
```

Or clone and build from source:

```bash
git clone https://github.com/lambertmt/llama-mcp-server.git
cd llama-mcp-server
npm install
npm run build
```

## Quick Start

### 1. Start Your LLM Server

```bash
# Example with llama.cpp server (128K context for full analysis capability)
./llama-server -m your-model.gguf -c 131072 --port 8080
```

### 2. Configure Claude Code

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "llama-local": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/llama-mcp-server/dist/index.js"],
      "env": {
        "LLAMA_SERVER_URL": "http://localhost:8080",
        "GPG_PASSPHRASE": "your-gpg-passphrase"
      }
    }
  }
}
```

### 3. Configure SSH Hosts (Optional)

Create `~/.claude/credentials.json.gpg` with your SSH hosts:

```json
{
  "ssh_hosts": {
    "192.168.0.165": { "user": "admin", "password": "secret" },
    "192.168.0.13": { "user": "root" }
  }
}
```

Encrypt with: `gpg -c ~/.claude/credentials.json`

## Available Tools

| Tool | Description |
|------|-------------|
| `agent_chat` | **Autonomous agent** - executes tools internally, returns only final answer |
| `ssh_exec` | Execute commands on remote servers (also available as agent built-in) |
| `chat` | Simple conversation with the local model |
| `health_check` | Check llama-server status |
| `quick_test` | Run capability tests |

## Autonomous Agent (`agent_chat`)

The killer feature. One call to Claude, the local LLM handles everything internally.

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude (Orchestrator)                     │
│                                                              │
│  1. Sends task to agent_chat                                 │
│  2. Waits...                                                 │
│  3. Receives final_answer (only the analysis, not raw data)  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│           MCP Server (Autonomous Agent Loop)                 │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Local LLM reasons about task                        │    │
│  │         ↓                                            │    │
│  │  Requests tool: ssh_exec("df -h")                   │    │
│  │         ↓                                            │    │
│  │  MCP executes SSH internally (Claude never sees)    │    │
│  │         ↓                                            │    │
│  │  Local LLM analyzes 15KB of output                  │    │
│  │         ↓                                            │    │
│  │  Returns concise final answer                       │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Usage

```typescript
// One call - agent handles everything
agent_chat({
  task: "Check disk usage on 192.168.0.165 and report partitions over 50% full"
})
```

**Response:**
```json
{
  "type": "final_answer",
  "conversation_id": "conv_abc123",
  "content": "Partitions over 50%:\n- /boot: 53%\n- /mnt/nas-music: 67%\n- /mnt/nas-backup: 67%",
  "tokens_used": 253,
  "tools_executed": [
    {
      "tool": "ssh_exec",
      "args": { "host": "192.168.0.165", "command": "df -h" },
      "result_length": 1243
    }
  ]
}
```

Note: `result_length: 1243` - that's 1,243 characters Claude **never had to process**.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `task` | string | required | The task for the agent |
| `auto_execute` | boolean | `true` | Execute built-in tools internally |
| `max_iterations` | number | `10` | Max tool execution loops |
| `temperature` | number | `0.3` | Lower = more focused |
| `context` | string | `""` | Additional context/instructions |

### Strict Output Format

The agent follows strict formatting rules:
- **Tool calls**: Pure JSON only, no surrounding text
- **Final answers**: Plain text only, no JSON wrapping
- No "let me think" or "I'll analyze" preamble

## SSH Execution

Built-in SSH support for infrastructure management.

### Direct Usage

```typescript
ssh_exec({
  host: "192.168.0.165",
  command: "docker ps"
})
```

### As Agent Tool

The agent automatically has access to `ssh_exec` for configured hosts:

```typescript
agent_chat({
  task: "Check memory usage on all servers and identify any issues"
})
// Agent will autonomously SSH to hosts and analyze results
```

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `LLAMA_SERVER_URL` | llama-server endpoint (default: `http://localhost:8080`) |
| `GPG_PASSPHRASE` | Passphrase for encrypted credentials file |
| `DEBUG_MCP` | Set to `1` for detailed logging |

### Credentials File

SSH hosts can be configured via:
1. `~/.claude/credentials.json.gpg` (encrypted, recommended)
2. `~/.claude/credentials.json` (plaintext)
3. Environment variables: `SSH_HOST_192_168_0_165='{"user":"admin"}'`

## Architecture

```
Claude ←→ MCP Protocol ←→ llama-mcp-server ←→ llama-server ←→ Local LLM
                               │
                               └──→ SSH (internal execution)
```

## Performance Comparison

Tested with GPT-OSS 120B (Q8) on AMD Strix Halo, 128K context:

| Scenario | Time | Claude Tokens | Local Tokens |
|----------|------|---------------|--------------|
| Docker logs (Claude direct) | ~45s | ~10,500 | 0 |
| Docker logs (autonomous agent) | ~45s | ~500 | ~10,000 |
| Security audit (Claude direct) | ~60s | ~11,800 | 0 |
| Security audit (autonomous agent) | ~60s | ~800 | ~11,000 |

**Result**: Same speed, up to 95% Claude token reduction. The work shifts to your free local LLM.

## Troubleshooting

**"Cannot reach server"**
- Verify llama-server is running: `curl http://localhost:8080/health`
- Check firewall allows the port

**Agent not executing tools**
- Ensure `auto_execute: true` (default)
- Check SSH hosts are configured in credentials file
- Enable `DEBUG_MCP=1` for detailed logs

**Tool calls malformed**
- Lower temperature to 0.1-0.3
- Ensure model supports instruction following
- Check logs for JSON parsing errors

## Development

```bash
npm install
npm run build
DEBUG_MCP=1 npm start  # Run with logging
```

## License

CC0-1.0 - Public Domain. Use freely!

---

Built for open-source AI infrastructure. Reduce your Claude API costs by up to 95% on analysis tasks.
