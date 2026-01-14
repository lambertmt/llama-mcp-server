# Video Script: Local LLM Delegation for Infrastructure Debugging - Real Token Measurements

**Target Length**: 5-7 minutes
**Tone**: Technical, honest, practical
**Audience**: Claude Code users, AI developers, home lab enthusiasts

---

## INTRO (0:00 - 0:45)

**[HOOK - Text on screen or talking head]**

"I saved 52,000 Claude tokens on a single debugging session by delegating work to my local LLM."

**[Pause]**

"Now, this pattern isn't new. Projects like CC Token Saver, Ollama Claude, and Rubber Duck MCP have been doing local LLM delegation for a while."

**[Show logos/links of prior art]**

"What I built is an implementation focused on infrastructure debugging - with built-in SSH execution and detailed token measurements. If you're doing DevOps work with Claude Code, this might be useful."

"Let me show you the actual numbers."

---

## THE PROBLEM (0:30 - 1:30)

**[Show diagram: Claude processing large log file]**

"Here's the problem. When you ask Claude to analyze something big - like 200 lines of server logs, or disk usage across multiple systems - every single character of that output gets loaded into Claude's context."

**[Show token counter animation: 0 → 15,000]**

"That's 15,000 tokens just to look at some logs. And you're paying for every one of them."

**[Show typical workflow diagram]**

"Even if you're using an MCP server to connect Claude to a local LLM, the data still flows through Claude's context. You ask Claude, Claude asks the local LLM, the local LLM responds, Claude processes the response, Claude gives you an answer."

"The raw data touches Claude's context twice. That's expensive."

---

## THE SOLUTION (1:30 - 2:30)

**[Show new architecture diagram]**

"What if the local LLM could execute tools directly, without Claude ever seeing the raw output?"

**[Animated diagram showing autonomous agent loop]**

"Here's what I built. An autonomous agent that runs entirely inside the MCP server."

"Step 1: Claude sends a task to the agent - 'check the server health'"

"Step 2: The local LLM decides what tools to call - in this case, SSH to run some commands"

"Step 3: The MCP server executes those commands internally. Claude never sees the 15,000 characters of output."

"Step 4: The local LLM analyzes the results and produces a concise summary"

"Step 5: Only that summary goes back to Claude"

**[Show comparison: 11,800 tokens vs 800 tokens]**

"That's a 93% reduction in Claude tokens. The other 11,000 tokens? They run on your local LLM - completely free."

---

## REAL TEST RESULTS (2:30 - 3:30)

**[Show terminal or results table]**

"Let me show you the actual token math from my testing."

**[Show bullet breakdown - animate each line]**

"Here's how a security audit breaks down:"

**Claude Direct** (no agent):
- Raw SSH output: ~44,000 chars ≈ 11,000 tokens
- Conversation overhead: ~800 tokens
- **Total Claude tokens: ~11,800**

**Claude with Agent**:
- Task request to agent: ~100 tokens
- Agent's summary response: ~700 tokens
- **Total Claude tokens: ~800**

**Local LLM** (inside agent - FREE):
- Processes ~44,000 chars raw output: ~11,000 tokens
- Analysis and formatting: ~1,000 tokens
- **Total local tokens: ~12,000**

"The tokens don't disappear - they shift from paid to free. 11,000 tokens move to your local LLM."

**[Table appears on screen - sorted by Claude Direct tokens, highest first]**

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
| Simple query | ~500 | ~300 | ~200 | 40% |

"See the pattern? The tokens shift from Claude to your local LLM. Big raw data = big savings. But notice code gen with small inputs - zero savings. The output size dominates, so no benefit there. This works best when you're processing large amounts of data."

**[Show actual agent response]**

"Here's a real response from the security audit. I asked it to analyze SSH logs, sudo usage, and check for suspicious activity."

**[Show JSON response with tools_executed]**

```json
{
  "type": "final_answer",
  "content": "Security Audit Summary... No failed logins,
    direct root SSH from internal IP (Medium severity),
    repeated sudo auth failures (Medium)...",
  "tokens_used": 1115,
  "tools_executed": [{
    "tool": "ssh_exec",
    "result_length": 43821
  }]
}
```

"43,821 characters of security logs. Claude never saw any of it. I just got a severity-rated summary with recommendations."

---

## REAL-WORLD DEBUGGING (3:30 - 4:30)

**[Show Nextcloud Talk error message]**

"But here's where it gets really powerful. Let me show you a real debugging session."

"Nextcloud Talk was returning HTTP 400 errors. Instead of me manually SSHing around and copying logs into Claude, I used the agent."

**[Show orchestration diagram]**

```
Claude Code (Orchestrator)          Local LLM Agent (Executor)
        │                                    │
        │  "Check signaling + logs"          │
        ├───────────────────────────────────►│ SSH, parse 15K chars
        │◄───────────────────────────────────┤ "Signaling OK, no errors"
        │                                    │
        │  "Check rate limits + permissions" │
        ├───────────────────────────────────►│ SSH, DB query
        │◄───────────────────────────────────┤ "Rate limiting on, perms OK"
        │                                    │
        │  "Enable debug, get exact error"   │
        ├───────────────────────────────────►│ SSH, parse stack trace
        │◄───────────────────────────────────┤ "SSL cert not trusted"
        │                                    │
        │  "Add cert, test API"              │
        ├───────────────────────────────────►│ SSH, apply fix
        │◄───────────────────────────────────┤ "HTTP 201 - fixed!"
```

"Seven agent calls. Each one focused on a specific question. Claude decided what to check next, the agent did the grunt work."

**[Show token breakdown table]**

| Debugging Phase | CC Direct | CC w/ Agent | Saved |
|-----------------|-----------|-------------|-------|
| Signaling + log analysis | ~15,000 | ~800 | 95% |
| Config checks | ~8,000 | ~600 | 92% |
| Rate limit investigation | ~6,000 | ~500 | 92% |
| Permissions diagnosis | ~10,000 | ~600 | 94% |
| Debug + stack trace | ~8,000 | ~700 | 91% |
| CA cert investigation | ~5,000 | ~500 | 90% |
| Apply + verify fix | ~4,000 | ~400 | 90% |
| **Total** | **~56,000** | **~4,100** | **93%** |

"56,000 tokens if I'd done this manually with Claude. 4,100 with the agent. That's 52,000 tokens saved on one debugging session."

"And the issue? Self-signed SSL cert wasn't in the container's trust store. Ten minutes, problem solved."

---

## HOW IT WORKS (4:30 - 5:30)

**[Show code or configuration]**

"Setting this up is straightforward."

"First, you need a local LLM running via llama-server. I'm using a 120B parameter model with 128K context, but smaller models work too."

**[Show config snippet]**

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

"Then you just call agent_chat with your task. One call. The agent handles everything."

**[Show usage example]**

```
agent_chat({
  task: "Analyze the last 200 journal lines and identify any errors"
})
```

"The agent automatically has access to SSH for your configured hosts. It figures out what commands to run, executes them, analyzes the results, and gives you a clean summary."

---

## KEY FEATURES (5:30 - 6:00)

**[Bullet points appearing on screen]**

"Some key features of this implementation:"

- "**Autonomous execution** - the agentic loop runs inside the MCP server"
- "**Built-in SSH** - agent can run commands on your infrastructure"
- "**GPG-encrypted credentials** - secure storage for SSH passwords"
- "**Strict output formatting** - the agent follows rules for clean JSON tool calls and plain text answers"
- "**Unlimited local tokens** - no artificial limits, use your full context window"
- "**Debug logging** - set DEBUG_MCP=1 to see exactly what's happening"

---

## CALL TO ACTION (6:00 - 6:30)

**[Show GitHub link]**

"The code is open source. Link in the description."

"github.com/lambertmt/llama-mcp-server - branch: feature/agent-tool-calling"

"If you're running Claude Code with a local LLM setup, try this out. The token savings are real, and it makes Claude way more useful for infrastructure tasks."

**[Closing]**

"If you found this useful, let me know in the comments. And if you're using this for something cool, I'd love to hear about it."

"Thanks for watching."

---

## B-ROLL / VISUAL SUGGESTIONS

1. **Terminal recordings**: Show actual agent_chat calls and responses
2. **Architecture diagrams**: Animate the flow of data (tools like Excalidraw or Mermaid)
3. **Token counter**: Animated number going up (Claude direct) vs staying low (autonomous agent)
4. **Split screen**: Claude direct on left (lots of text scrolling) vs agent on right (clean summary)
5. **Code highlights**: Zoom into key parts of the config and usage examples

---

## THUMBNAIL SUGGESTIONS

Option A: "52K tokens saved" with debugging terminal screenshot
Option B: Split image - Claude Direct vs Agent (token counters)
Option C: "Infrastructure + Local LLM" with server icons

---

## DESCRIPTION / METADATA

**Title Options:**
- "Local LLM Delegation for Infrastructure Debugging - Real Token Measurements"
- "52,000 Tokens Saved: Infrastructure Debugging with Local LLM Agents"
- "Building on CC Token Saver: SSH Execution for Claude Code"

**Description:**
```
I implemented local LLM delegation for infrastructure debugging with built-in
SSH execution. Here are my actual token measurements.

This pattern isn't new - CC Token Saver, Ollama Claude, and Rubber Duck MCP
do similar things. My implementation focuses on DevOps use cases with
autonomous SSH execution.

Real results from a Nextcloud debugging session:
- Claude Direct: ~56,000 tokens
- With Agent: ~4,100 tokens
- Savings: 93%

Prior Art:
- CC Token Saver: https://github.com/csabakecskemeti/cc_token_saver_mcp
- Ollama Claude: https://mcpmarket.com/server/ollama-claude
- Rubber Duck: https://reddit.com/r/ClaudeAI/comments/1n9vxfp/

My Implementation:
GitHub: https://github.com/lambertmt/llama-mcp-server
Branch: feature/agent-tool-calling

Tested with:
- Claude Code (Opus 4.5)
- GPT-OSS 120B (Q8) via llama.cpp
- AMD Strix Halo server with 128K context

#ClaudeAI #LocalLLM #MCP #DevOps #OpenSource
```

**Tags:**
claude, claude code, anthropic, local llm, llama.cpp, mcp, model context protocol,
ai agents, autonomous agents, token optimization, api costs, open source ai
