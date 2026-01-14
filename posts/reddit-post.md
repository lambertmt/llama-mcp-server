# Reddit Post: r/LocalLLaMA

## Title Options (pick one):
- "My implementation of local LLM delegation for Claude Code - with built-in SSH and real token measurements"
- "Local LLM + Claude Code for infrastructure debugging - 52,000 tokens saved in one session"
- "Added autonomous SSH execution to the local LLM delegation pattern - here's what I measured"

---

## Post Body:

**TL;DR:** I know this pattern exists (CC Token Saver, Ollama Claude, Rubber Duck, etc.), but I wanted an implementation focused on infrastructure/DevOps with built-in SSH execution. Here's what I built and the actual token savings I measured.

### Prior Art

This isn't new. Several projects do local LLM delegation for Claude:
- [CC Token Saver](https://github.com/csabakecskemeti/cc_token_saver_mcp) - Delegates simple tasks to local LLM
- [Ollama Claude](https://mcpmarket.com/server/ollama-claude) - Same pattern with Ollama
- [Rubber Duck MCP](https://www.reddit.com/r/ClaudeAI/comments/1n9vxfp/claude_mcp_rubber_duck_context_window_saver/) - Claims 93% savings (I got similar numbers)

### What's Different About Mine

I wanted something specifically for **infrastructure debugging** with:
1. **Built-in SSH execution** - Agent runs commands directly, not just LLM delegation
2. **Autonomous tool loop** - Agent decides what commands to run, executes them, analyzes results
3. **Raw data stays local** - 40K chars of logs never touch Claude's context

```
Claude: "Debug why Nextcloud Talk returns 400"
   ↓
Agent: [SSHs to server, checks logs, runs DB queries - all internally]
Agent: [Analyzes 40K chars locally]
   ↓
Claude: [Receives "SSL cert not trusted" - 800 tokens]
```

### Actual Measurements

I did systematic testing instead of just claiming savings:

| Task | Claude Direct | Claude w/ Agent | Local LLM | Savings |
|------|---------------|-----------------|-----------|---------|
| Debugging workflow (7 calls) | ~56,000 | ~4,100 | ~35,000 | **93%** |
| Security audit (44K chars) | ~11,800 | ~800 | ~11,000 | **93%** |
| Docker logs (40K chars) | ~10,500 | ~500 | ~10,000 | **95%** |
| Code gen (small input) | ~1,550 | ~1,600 | ~1,500 | **0%** |

The 0% case matters - when raw data is small, no benefit. This shines on **data-heavy tasks**.

### Real Debugging Session

Nextcloud Talk returning HTTP 400. Seven agent calls over 10 minutes:
1. Check signaling + logs → "Config OK"
2. Check rate limits + DB → "Permissions OK"
3. Enable debug, get stack trace → "SSL cert not trusted"
4. Add cert, verify fix → "HTTP 201 - working!"

Claude stayed strategic (what to check), agent did tactical work (SSH, parsing, queries).

### Setup

- **Local LLM**: llama.cpp server (I use 120B Q8 on Strix Halo, but 32B+ should work)
- **Context**: 32K minimum, 128K recommended for large logs
- **MCP Server**: Node.js

### Code

GitHub: https://github.com/lambertmt/llama-mcp-server
Branch: `feature/agent-tool-calling`

Key file: `src/index.ts` - the `agent_chat` handler runs the autonomous loop with internal SSH execution.

### When to Use This vs Other Options

| Use Case | Best Tool |
|----------|-----------|
| Simple code tasks | CC Token Saver, Ollama Claude |
| Research/docs | Rubber Duck |
| **Infrastructure debugging** | This (built-in SSH) |
| General delegation | Ultimate MCP Server |

### Limitations

- Doesn't help when output dominates (code gen from small inputs)
- Requires decent local LLM (7B struggles with complex analysis)
- SSH hosts need pre-configuration
- Linux/Mac only (uses sshpass)

---

**Questions welcome.** Especially interested if anyone has other infrastructure-focused use cases.

---

## Suggested Subreddits:
- **r/LocalLLaMA** (primary - focus on local LLM agent architecture)
- **r/ClaudeAI** (focus on Claude Code integration, mention prior art)
- **r/selfhosted** (focus on infrastructure monitoring use case)
- **r/homelab** (focus on the debugging workflow)

## Cross-post adjustments:
- r/ClaudeAI: Emphasize this builds on existing work (CC Token Saver etc.)
- r/selfhosted: Lead with the Nextcloud debugging story
- r/homelab: Focus on multi-server monitoring
