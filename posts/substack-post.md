# Substack / Blog Post

## Title: Building on the Local LLM Delegation Pattern: An Infrastructure-Focused Implementation

### Subtitle: How I added autonomous SSH execution to save 52,000 tokens on a single debugging session

---

Every time you ask Claude to analyze server logs, parse configuration files, or debug a production issue, you're burning API tokens. A lot of them.

I just finished a debugging session where Claude helped me fix a Nextcloud Talk issue. If I'd done it the normal way - copying logs into Claude, asking questions, pasting more output - it would have cost me around **56,000 tokens**.

Instead, I spent **4,100 tokens**. A 93% reduction.

Before I explain how, let me be clear: **this pattern isn't new**.

---

## Prior Art: Others Have Done This

Several projects already delegate work from Claude to local LLMs:

- **[CC Token Saver](https://github.com/csabakecskemeti/cc_token_saver_mcp)** - Intelligently delegates simple tasks to your local LLM
- **[Ollama Claude](https://mcpmarket.com/server/ollama-claude)** - Offloads code generation and review to Ollama
- **[Rubber Duck MCP](https://www.reddit.com/r/ClaudeAI/comments/1n9vxfp/claude_mcp_rubber_duck_context_window_saver/)** - Delegates research to cheaper LLMs (claims 93% savings)
- **[Ultimate MCP Server](https://github.com/Dicklesworthstone/ultimate_mcp_server)** - Delegates from Claude to Gemini Flash

The core insight is the same across all of these: let Claude orchestrate while cheaper/free models do the grunt work.

**What I built is a variation focused on infrastructure debugging**, with built-in SSH execution and detailed token measurements. If you're doing DevOps work, this might be more useful than the general-purpose tools.

---

## The Problem With Raw Data

When Claude analyzes anything substantial - 200 lines of logs, disk usage across servers, a stack trace - every character of that output goes into Claude's context window. You pay for all of it.

Even if you're using an MCP server to connect Claude to external tools, the data still flows through:

```
You → Claude → MCP Server → Tool → MCP Server → Claude → You
```

Claude sees everything. Claude charges for everything.

## The Insight: Delegate the Grunt Work

What if Claude could delegate the data-heavy work to a local LLM that runs for free?

Not replace Claude - Claude is still better at reasoning, planning, and knowing what questions to ask. But let a local model handle the tactical execution:

- SSH into servers
- Parse verbose logs
- Run database queries
- Filter and summarize output

Then return just the summary to Claude.

## The Architecture

I modified an MCP server to run an **autonomous agent loop**. Here's how it works:

```
┌─────────────────┐                          ┌─────────────────┐
│   Claude Code   │  "Check server health"   │  Local LLM      │
│  (Orchestrator) │ ────────────────────────►│  (Agent)        │
│                 │                          │                 │
│  Decides what   │                          │  Executes SSH   │
│  to check next  │                          │  Parses output  │
│                 │◄─────────────────────────│  Summarizes     │
│                 │  "Memory at 92%, 10      │                 │
│                 │   containers healthy"    │                 │
└─────────────────┘                          └─────────────────┘
```

The key: **Claude never sees the raw SSH output**. That stays entirely within the local LLM's context.

## Real Numbers

I ran systematic tests across different task types:

| Task | Claude (Direct) | Claude (w/ Agent) | Local LLM | Savings |
|------|-----------------|-------------------|-----------|---------|
| Debugging workflow (7 calls) | ~56,000 | ~4,100 | ~35,000 | **93%** |
| Security audit | ~11,800 | ~800 | ~11,000 | **93%** |
| Docker logs analysis | ~10,500 | ~500 | ~10,000 | **95%** |
| System health check | ~5,500 | ~1,500 | ~4,000 | 73% |
| Log analysis | ~4,000 | ~800 | ~3,200 | 80% |
| Code generation (small input) | ~1,550 | ~1,600 | ~1,500 | **0%** |

Notice the last row. When raw data is small, there's no benefit - the output size dominates. This architecture shines when you're processing **large amounts of data**.

## A Real Debugging Session

Let me walk through an actual example.

Nextcloud Talk was returning HTTP 400 errors when sending messages. Here's how the debugging went:

**Call 1: Initial triage**
- Claude: "Check the Talk container logs and signaling configuration"
- Agent: SSHs to server, runs docker logs, parses 15K chars
- Returns to Claude: "Signaling configured correctly, no errors in logs"
- *Tokens saved: ~14,000*

**Call 2: Narrowing down**
- Claude: "Check rate limiting and user permissions in the database"
- Agent: Runs SQL queries, checks config
- Returns: "Rate limiting enabled, user has correct permissions"
- *Tokens saved: ~7,000*

**Call 3: The breakthrough**
- Claude: "Enable debug mode and capture the exact error"
- Agent: Modifies config, triggers error, parses 3KB stack trace
- Returns: "SSL certificate problem: self-signed certificate not trusted"
- *Tokens saved: ~8,000*

**Call 4: The fix**
- Claude: "Add the cert to the container's trust store and test"
- Agent: Runs update-ca-certificates, tests API
- Returns: "HTTP 201 - message sent successfully"
- *Tokens saved: ~4,000*

**Total: 52,000 tokens saved.** Ten minutes of debugging. Actual production issue resolved.

## The Orchestration Pattern

This works because Claude and the local LLM have complementary strengths:

**Claude (Orchestrator):**
- Knows Nextcloud architecture
- Decides what to investigate next
- Interprets findings in context
- Knows when the problem is solved

**Local LLM (Agent):**
- Executes SSH commands
- Parses verbose output
- Filters noise from signal
- Returns concise summaries

Claude stays strategic. The agent stays tactical.

## When This Doesn't Work

Transparency matters. This approach has limitations:

1. **Small input, large output**: Code generation from minimal context shows 0% savings - the generated code dominates token count either way.

2. **Complex reasoning required**: If the raw data requires Claude-level reasoning to interpret, the agent can't help.

3. **Local LLM quality**: A 7B model might struggle with nuanced log analysis. I use 32B-120B models.

4. **Setup overhead**: You need a local LLM running, hosts configured for SSH, the MCP server installed.

## The Setup

**Requirements:**
- llama.cpp server (or compatible) running your preferred model
- Claude Code or Claude Desktop with MCP support
- Node.js for the MCP server

**My setup:**
- AMD Strix Halo server (192.168.0.165)
- GPT-OSS 120B (Q8 quantization)
- 128K context window
- SSH access to infrastructure hosts

**Installation:**
```bash
git clone https://github.com/lambertmt/llama-mcp-server
cd llama-mcp-server
git checkout feature/agent-tool-calling
npm install && npm run build
```

**Claude Code config:**
```json
{
  "mcpServers": {
    "llama-local": {
      "command": "node",
      "args": ["/path/to/llama-mcp-server/dist/index.js"],
      "env": {
        "LLAMA_SERVER_URL": "http://your-server:8080"
      }
    }
  }
}
```

## The Code

The key addition is `agent_chat` - an MCP tool that runs an autonomous loop:

```typescript
// Simplified version
async function agentChat(task: string) {
  while (iterations < maxIterations) {
    // Ask local LLM what to do
    const response = await callLocalLLM(task, conversationHistory);

    // If it wants to run a command, execute internally
    if (response.type === "tool_call" && response.tool === "ssh_exec") {
      const result = await executeSSH(response.args);
      conversationHistory.push({ role: "tool", content: result });
      continue; // Loop - Claude never sees this
    }

    // Otherwise, return the final answer to Claude
    return response.content;
  }
}
```

The magic is the `continue` - when the agent executes a tool, the result stays in the agent's context and the loop continues. Only the final summary reaches Claude.

## Which Tool Should You Use?

| Your Use Case | Best Option |
|---------------|-------------|
| Simple code tasks (generation, review) | [CC Token Saver](https://github.com/csabakecskemeti/cc_token_saver_mcp), [Ollama Claude](https://mcpmarket.com/server/ollama-claude) |
| Research and document parsing | [Rubber Duck MCP](https://www.reddit.com/r/ClaudeAI/comments/1n9vxfp/claude_mcp_rubber_duck_context_window_saver/) |
| **Infrastructure debugging (logs, SSH)** | This implementation |
| Multi-model delegation | [Ultimate MCP Server](https://github.com/Dicklesworthstone/ultimate_mcp_server) |

This implementation makes sense if you:

- Run Claude Code for infrastructure/DevOps work
- Have a local LLM setup (or want to build one)
- Process large outputs regularly (logs, monitoring, debugging)
- Want built-in SSH execution without additional setup

It doesn't make sense if you:

- Only do small-context tasks (use CC Token Saver instead)
- Don't have infrastructure to run a local LLM
- Need every response to have Claude-level reasoning
- Just need code generation delegation (Ollama Claude is simpler)

## The Broader Ecosystem

The local LLM delegation pattern is maturing. What started as individual experiments is becoming a standard approach:

1. **Task classification** - Route simple tasks to cheap/free models
2. **Context isolation** - Keep verbose output away from expensive APIs
3. **Orchestration** - Let the best model coordinate

My contribution is a point solution for infrastructure work. The ecosystem has options for most use cases now.

## Code

The code is open source: [github.com/lambertmt/llama-mcp-server](https://github.com/lambertmt/llama-mcp-server) (branch: `feature/agent-tool-calling`)

---

*The pattern isn't new, but the measurements might be useful. If you've measured token savings with other implementations, I'd love to compare notes.*

---

## Publishing Notes

**Platforms:**
- Substack (if you have one)
- Dev.to (good for technical content)
- Medium (broader reach, but paywalled)
- Personal blog + Hacker News submission

**Hacker News title:**
"Show HN: Infrastructure-focused local LLM delegation for Claude Code - with real token measurements"

**Tags:**
#LLM #Claude #LocalAI #DevOps #OpenSource #MCP
