# LibreModel MCP Server

A Model Context Protocol (MCP) server that bridges Claude Desktop/Claude Code with your local LLM instance running via llama-server.

## Features

- **Full conversation support** with local LLMs through Claude
- **Agent tool-calling** - delegate tasks to local LLM with tool execution loop
- **Complete parameter control** (temperature, max_tokens, top_p, top_k)
- **Health monitoring** and server status checks
- **Built-in testing tools** for different capabilities
- **Performance metrics** and token usage tracking
- **Easy configuration** via environment variables

## Installation

```bash
npm install @openconstruct/llama-mcp-server
```

Or clone and build from source:

```bash
git clone https://github.com/openconstruct/llama-mcp-server.git
cd llama-mcp-server
npm install
npm run build
```

## Quick Start

### 1. Start Your LLM Server

Make sure llama-server is running with your model:

```bash
./llama-server -m your-model.gguf -c 4096 --port 8080
```

### 2. Configure Claude

Add to your Claude configuration:

**Claude Desktop** (`~/.config/claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "llama-local": {
      "command": "node",
      "args": ["/path/to/llama-mcp-server/dist/index.js"],
      "env": {
        "LLAMA_SERVER_URL": "http://localhost:8080"
      }
    }
  }
}
```

**Claude Code** (`~/.claude.json`):
```json
{
  "mcpServers": {
    "llama-local": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/node_modules/@openconstruct/llama-mcp-server/dist/index.js"],
      "env": {
        "LLAMA_SERVER_URL": "http://192.168.0.165:8081"
      }
    }
  }
}
```

### 3. Restart Claude

Claude will now have access to your local LLM through MCP!

## Available Tools

| Tool | Description |
|------|-------------|
| `chat` | Simple conversation with the local model |
| `quick_test` | Run predefined capability tests (hello/math/creative/knowledge) |
| `health_check` | Check server health and status |
| `agent_chat` | **NEW** - Agentic conversations with tool-calling support |
| `list_conversations` | Debug tool to list active agent conversations |

## Agent Tool-Calling

The `agent_chat` tool enables agentic workflows where the local LLM can request tool calls that the orchestrating system (Claude) executes.

### How It Works

```
┌─────────────────────────────────────────────────────────┐
│                 Claude (Orchestrator)                   │
│                                                         │
│  1. Sends task + tool definitions to agent_chat         │
│  2. Receives tool_call request from local LLM           │
│  3. Executes the requested tool                         │
│  4. Sends result back via agent_chat (with conv ID)     │
│  5. Repeats until final_answer received                 │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Local LLM (via llama-server)               │
│                                                         │
│  • Receives task + available tools                      │
│  • Reasons about what tools to call                     │
│  • Returns structured tool call JSON                    │
│  • Processes tool results                               │
│  • Returns final answer when done                       │
└─────────────────────────────────────────────────────────┘
```

### Usage Example

**Starting an agent conversation:**

```typescript
// First call - start conversation with task and tools
agent_chat({
  task: "Find all Python files in the project and count lines of code",
  tools: [
    {
      name: "run_command",
      description: "Execute a shell command",
      parameters: {
        command: { type: "string", description: "Command to run", required: true }
      }
    },
    {
      name: "read_file",
      description: "Read contents of a file",
      parameters: {
        path: { type: "string", description: "File path", required: true }
      }
    }
  ],
  context: "Working directory: /home/user/project",
  temperature: 0.3
})
```

**Response (tool call requested):**

```json
{
  "type": "tool_call",
  "conversation_id": "conv_1234567890_abc123",
  "tool_call": {
    "name": "run_command",
    "arguments": {
      "command": "find . -name '*.py' | head -20"
    }
  },
  "tokens_used": 156
}
```

**Continuing with tool result:**

```typescript
// Second call - provide tool result
agent_chat({
  task: "",  // Empty when providing tool result
  conversation_id: "conv_1234567890_abc123",
  tool_result: {
    tool_name: "run_command",
    result: "./src/main.py\n./src/utils.py\n./tests/test_main.py"
  }
})
```

**Final response:**

```json
{
  "type": "final_answer",
  "conversation_id": "conv_1234567890_abc123",
  "content": "I found 3 Python files in the project...",
  "tokens_used": 89
}
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `task` | string | The task or message for the agent |
| `tools` | array | Tool definitions the agent can request |
| `context` | string | RAG context or background information |
| `conversation_id` | string | ID to resume an existing conversation |
| `tool_result` | object | Result from a previously requested tool |
| `temperature` | number | Sampling temperature (default: 0.3 for focused behavior) |
| `max_tokens` | number | Maximum tokens for response (default: 1024) |

### Tool Definition Format

```typescript
{
  name: "tool_name",
  description: "What the tool does",
  parameters: {
    param_name: {
      type: "string" | "number" | "boolean",
      description: "Parameter description",
      required: true | false
    }
  }
}
```

## Configuration

Set environment variables to customize behavior:

```bash
export LLAMA_SERVER_URL="http://localhost:8080"  # Default llama-server URL
```

## Architecture

```
Claude ←→ MCP Protocol ←→ llama-mcp-server ←→ llama-server API ←→ Local LLM
```

The MCP server acts as a bridge, translating MCP protocol messages into llama-server API calls and formatting responses.

## Troubleshooting

**"Cannot reach server"**
- Ensure llama-server is running on the configured port
- Check that the model is loaded and responding
- Verify firewall/network settings

**"Tool not found"**
- Restart Claude after configuration changes
- Check that the path to `index.js` is correct and absolute
- Verify the MCP server builds without errors

**Agent not using tools correctly**
- Lower temperature (0.1-0.3) for more deterministic behavior
- Ensure tool descriptions are clear and specific
- Check that the model supports instruction following

## Development

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Start the server directly
npm start
```

## License

CC0-1.0 - Public Domain. Use freely!

---

Built for open-source AI and local LLM infrastructure.
