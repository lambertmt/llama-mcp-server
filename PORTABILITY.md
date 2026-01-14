# Portability Guide: Can Others Use This?

## TL;DR

**Core functionality (chat, agent_chat)**: ✅ Fully portable
**SSH execution**: ⚠️ Requires configuration per user
**95% savings claims**: ⚠️ Depends on use case and local LLM quality

---

## What's Portable Out of the Box

### 1. Basic Chat with Local LLM
Anyone with a llama.cpp server can use:
```javascript
mcp__llama-local__chat({ message: "Hello" })
```
**Requirements:** Just `LLAMA_SERVER_URL` environment variable.

### 2. Agent Chat (Autonomous Loop)
The core agent architecture works for anyone:
```javascript
mcp__llama-local__agent_chat({ task: "Analyze this data..." })
```
**Requirements:** Same as above.

### 3. Health Check
```javascript
mcp__llama-local__health_check()
```
**Requirements:** None beyond basic setup.

---

## What Requires Configuration

### SSH Execution

The `ssh_exec` tool requires users to configure their own hosts.

**Option 1: GPG-encrypted credentials (recommended)**
```bash
# Create ~/.claude/credentials.json
{
  "ssh_hosts": {
    "192.168.1.100": { "user": "admin", "password": "secret" },
    "myserver.local": { "user": "root" }
  }
}

# Encrypt it
gpg -c ~/.claude/credentials.json
rm ~/.claude/credentials.json
```

**Option 2: Environment variables**
```bash
export SSH_HOST_192_168_1_100='{"user":"admin","password":"secret"}'
```

**Option 3: SSH keys (no password needed)**
If user has SSH keys configured, just specify the user:
```json
{ "192.168.1.100": { "user": "admin" } }
```

---

## Minimum Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **Node.js** | 18+ | 20+ |
| **llama.cpp server** | Any version | Recent (for performance) |
| **Local LLM** | 7B (basic tasks) | 32B+ (complex analysis) |
| **Context window** | 8K | 32K-128K |
| **RAM** | 8GB (7B Q4) | 64GB+ (70B+ models) |
| **Claude Code/Desktop** | Any with MCP | Latest |

---

## What Won't Transfer

### 1. Specific Host Configurations
My SSH hosts (192.168.0.165, etc.) won't work for others. They need to configure their own.

### 2. Token Savings Numbers
The 95% savings depend on:
- Task type (data-heavy = more savings)
- Local LLM quality (better model = better summaries)
- Use patterns (lots of log analysis = high ROI)

Others may see 50-95% depending on their use case.

### 3. Specific Prompting Patterns
The prompts that work well for my infrastructure debugging may need adjustment for different domains.

---

## Quick Start for New Users

```bash
# 1. Clone and build
git clone https://github.com/lambertmt/llama-mcp-server
cd llama-mcp-server
git checkout feature/agent-tool-calling
npm install && npm run build

# 2. Configure Claude Code (~/.claude/config.json)
{
  "mcpServers": {
    "llama-local": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "LLAMA_SERVER_URL": "http://localhost:8080"
      }
    }
  }
}

# 3. Start your llama.cpp server
./llama-server -m your-model.gguf -c 32768 --port 8080

# 4. (Optional) Configure SSH hosts
# Create ~/.claude/credentials.json with your hosts
# Then: gpg -c ~/.claude/credentials.json && rm ~/.claude/credentials.json

# 5. Test
# In Claude Code: "Use llama-local to check if the server is healthy"
```

---

## Artifacts Others Can Use Directly

| Artifact | Location | Portable? |
|----------|----------|-----------|
| MCP Server code | `/src/index.ts` | ✅ Yes |
| Agent loop implementation | `agent_chat` handler | ✅ Yes |
| JSON parsing utilities | `parseToolCall`, etc. | ✅ Yes |
| Health check script | `/test-scripts/health_check.sh` | ⚠️ Adapt paths |
| Video script template | `/video-script.md` | ✅ Yes (as template) |
| Reddit/blog posts | `/posts/` | ✅ Yes (as templates) |

---

## Recommended Model Sizes by Task

| Task | Minimum Model | Notes |
|------|---------------|-------|
| Simple commands | 7B | Basic SSH + summary |
| Log analysis | 13B-32B | Needs pattern recognition |
| Security audit | 32B+ | Complex reasoning |
| Multi-step debugging | 70B+ | Best results |

---

## Known Issues for Portability

1. **Windows**: SSH execution uses `sshpass` which is Linux/Mac. Windows users need WSL or alternative.

2. **Firewalls**: SSH hosts must be reachable from where the MCP server runs.

3. **Model quality**: Smaller models may not follow the strict output format, causing parsing failures.

4. **Token counting**: The `tokens_used` in responses is from the local LLM's tokenizer, not Claude's. Comparisons are approximate.

---

## Contributing

If you adapt this for a different use case (Kubernetes, cloud providers, databases), PRs welcome!
