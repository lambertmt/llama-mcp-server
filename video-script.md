# Video Script: Slash Your Claude API Costs by 95% with Local LLM Agents

**Target Length**: 4-6 minutes
**Tone**: Technical but accessible, enthusiastic
**Audience**: Claude Code users, AI developers, home lab enthusiasts

---

## INTRO (0:00 - 0:30)

**[HOOK - Text on screen or talking head]**

"What if I told you that you could cut your Claude API token usage by up to 95% on analysis tasks... using your own local LLM?"

**[Pause for effect]**

"I'm not talking about replacing Claude. I'm talking about making Claude smarter by letting it delegate the heavy lifting to a local model running on your own hardware."

"Let me show you exactly how this works, with real numbers from actual tests."

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
| **Security audit** | **~11,800** | **~800** | **~11,000** | **93%** |
| **Docker logs analysis** | **~10,500** | **~500** | **~10,000** | **95%** |
| System health check | ~5,500 | ~1,500 | ~4,000 | 73% |
| Log analysis (journalctl) | ~4,000 | ~800 | ~3,200 | 80% |
| Code gen (w/ exploration) | ~2,700 | ~1,700 | ~1,000 | 37% |
| Disk analysis | ~1,500 | ~500 | ~1,000 | 65% |
| Simple query | ~500 | ~300 | ~200 | 40% |
| Code gen (small input) | ~1,550 | ~1,600 | ~1,500 | 0% |

"See the pattern? The tokens don't disappear - they move from Claude to your local LLM. Security audit: 11,000 tokens shift from paid to free. Docker logs: 10,000 tokens. The work gets done, you just don't pay for it."

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

## HOW IT WORKS (3:30 - 4:30)

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

## KEY FEATURES (4:30 - 5:00)

**[Bullet points appearing on screen]**

"Some key features of this implementation:"

- "**Autonomous execution** - the agentic loop runs inside the MCP server"
- "**Built-in SSH** - agent can run commands on your infrastructure"
- "**GPG-encrypted credentials** - secure storage for SSH passwords"
- "**Strict output formatting** - the agent follows rules for clean JSON tool calls and plain text answers"
- "**Unlimited local tokens** - no artificial limits, use your full context window"
- "**Debug logging** - set DEBUG_MCP=1 to see exactly what's happening"

---

## CALL TO ACTION (5:00 - 5:30)

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

Option A: "95% LESS" with Claude logo and downward arrow
Option B: Split image - pile of tokens vs single token
Option C: "Claude + Local LLM = $$$" with savings visualization

---

## DESCRIPTION / METADATA

**Title Options:**
- "Cut Claude API Costs by 95% with Local LLM Agents"
- "Autonomous Agents: How I Reduced Claude Token Usage by 95%"
- "The Claude Token Hack: Let Local LLMs Do the Heavy Lifting"

**Description:**
```
I built an autonomous agent that lets your local LLM execute tools directly,
without Claude ever seeing the raw output. The result? Up to 95% reduction in
Claude API token usage on analysis tasks.

This video shows real test results and explains how to set it up.

GitHub: https://github.com/lambertmt/llama-mcp-server
Branch: feature/agent-tool-calling

Tested with:
- Claude Code (Opus 4.5)
- GPT-OSS 120B (Q8) via llama.cpp
- AMD Strix Halo server with 128K context

#ClaudeAI #LocalLLM #MCP #AIAgents #OpenSource
```

**Tags:**
claude, claude code, anthropic, local llm, llama.cpp, mcp, model context protocol,
ai agents, autonomous agents, token optimization, api costs, open source ai
