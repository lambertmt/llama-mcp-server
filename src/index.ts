#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

interface LlamaServerConfig {
  url: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
  defaultTopP: number;
  defaultTopK: number;
  stopSequences: string[];
}

// SSH configuration for infrastructure access
// Configure via:
//   1. CREDENTIALS_FILE env var (JSON with ssh_hosts key) - default: ~/.claude/credentials.json
//      Supports GPG-encrypted files (.gpg extension) - requires GPG_PASSPHRASE env var
//   2. SSH_HOSTS_FILE env var (JSON with flat host mapping)
//   3. SSH_HOST_<IP> env vars: SSH_HOST_192_168_0_165='{"user":"admin","password":"secret"}'
interface SSHHost {
  user: string;
  password?: string;  // Optional - if not provided, uses key-based auth
  port?: number;      // Optional - defaults to 22
  description?: string;
}

function decryptGPGFile(filePath: string): string | null {
  const passphrase = process.env.GPG_PASSPHRASE;

  if (!passphrase) {
    console.error("GPG_PASSPHRASE env var required to decrypt", filePath);
    return null;
  }

  try {
    // Use gpg with passphrase from env var (--batch for non-interactive)
    const result = execSync(
      `gpg --batch --yes --passphrase-fd 0 --decrypt "${filePath}"`,
      {
        input: passphrase,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    return result;
  } catch (e) {
    console.error(`Failed to decrypt ${filePath}:`, e);
    return null;
  }
}

function loadCredentialsFile(filePath: string): any | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    let content: string;

    if (filePath.endsWith(".gpg")) {
      // Decrypt GPG-encrypted file
      const decrypted = decryptGPGFile(filePath);
      if (!decrypted) return null;
      content = decrypted;
      console.error(`Decrypted credentials from ${filePath}`);
    } else {
      // Plain JSON file
      content = fs.readFileSync(filePath, "utf-8");
    }

    return JSON.parse(content);
  } catch (e) {
    console.error(`Failed to load credentials from ${filePath}:`, e);
    return null;
  }
}

function loadSSHHosts(): Record<string, SSHHost> {
  const hosts: Record<string, SSHHost> = {};

  // Try loading from credentials file (check for .gpg first, then plain)
  const baseCredentialsFile = process.env.CREDENTIALS_FILE || path.join(os.homedir(), ".claude", "credentials.json");
  const gpgFile = baseCredentialsFile.endsWith(".gpg") ? baseCredentialsFile : baseCredentialsFile + ".gpg";

  let credentialsFile = baseCredentialsFile;
  if (fs.existsSync(gpgFile) && process.env.GPG_PASSPHRASE) {
    credentialsFile = gpgFile;  // Prefer encrypted if available and passphrase set
  }

  const parsed = loadCredentialsFile(credentialsFile);
  if (parsed?.ssh_hosts) {
    Object.assign(hosts, parsed.ssh_hosts);
    console.error(`Loaded ${Object.keys(parsed.ssh_hosts).length} SSH hosts from ${credentialsFile}`);
  }

  // Try loading from SSH_HOSTS_FILE (flat format)
  const hostsFile = process.env.SSH_HOSTS_FILE;
  if (hostsFile) {
    const hostsParsed = loadCredentialsFile(hostsFile);
    if (hostsParsed) {
      Object.assign(hosts, hostsParsed);
    }
  }

  // Load from individual env vars (SSH_HOST_192_168_0_165, etc.)
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("SSH_HOST_") && value) {
      try {
        const ip = key.replace("SSH_HOST_", "").replace(/_/g, ".");
        const parsed = JSON.parse(value);
        hosts[ip] = parsed;
      } catch (e) {
        console.error(`Warning: Could not parse ${key}:`, e);
      }
    }
  }

  return hosts;
}

const SSH_HOSTS = loadSSHHosts();

// Agent tool-calling interfaces
interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, {
    type: string;
    description?: string;
    required?: boolean;
  }>;
}

interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

interface AgentMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_call?: ToolCall;
  tool_name?: string;
}

interface AgentConversation {
  id: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  context: string;
  createdAt: number;
}

interface AgentResponse {
  type: "tool_call" | "final_answer";
  conversation_id: string;
  content?: string;
  tool_call?: ToolCall;
  tokens_used?: number;
}

interface LlamaCompletionRequest {
  prompt: string;
  temperature: number;
  n_predict: number;
  top_p: number;
  top_k: number;
  stop: string[];
  stream: boolean;
}

interface LlamaCompletionResponse {
  content: string;
  stop: boolean;
  model: string;
  tokens_predicted: number;
  tokens_evaluated: number;
  generation_settings: any;
  prompt: string;
  truncated: boolean;
  stopped_eos: boolean;
  stopped_word: boolean;
  stopped_limit: boolean;
  stopping_word: string;
  tokens_cached: number;
  timings: any;
}

class LibreModelMCPServer {
  private server: McpServer;
  private config: LlamaServerConfig;
  private conversations: Map<string, AgentConversation> = new Map();
  private readonly CONVERSATION_TTL = 30 * 60 * 1000; // 30 minutes

  constructor() {
    this.server = new McpServer({
      name: "libremodel-mcp-server",
      version: "1.1.0"
    });

    this.config = {
      url: process.env.LLAMA_SERVER_URL || "http://localhost:8080",
      defaultTemperature: 0.7,
      defaultMaxTokens: 512,
      defaultTopP: 0.95,
      defaultTopK: 40,
      stopSequences: ["Human:", "\nHuman:", "User:", "\nUser:", "<|user|>"]
    };

    this.setupTools();
    this.setupResources();

    // Cleanup old conversations periodically
    setInterval(() => this.cleanupConversations(), 5 * 60 * 1000);
  }

  private cleanupConversations() {
    const now = Date.now();
    for (const [id, conv] of this.conversations) {
      if (now - conv.createdAt > this.CONVERSATION_TTL) {
        this.conversations.delete(id);
      }
    }
  }

  private generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private buildToolsPrompt(tools: ToolDefinition[]): string {
    if (tools.length === 0) return "";

    // Build tool list in compact format
    let toolList = "Tools: ";
    toolList += tools.map(tool => {
      if (tool.parameters && Object.keys(tool.parameters).length > 0) {
        const params = Object.keys(tool.parameters).join(", ");
        return `${tool.name}(${params})`;
      }
      return `${tool.name}()`;
    }).join(", ");

    // Build few-shot example using first tool
    const exampleTool = tools[0];
    let example = "";
    if (exampleTool) {
      const exampleArgs: Record<string, string> = {};
      if (exampleTool.parameters) {
        for (const [name, param] of Object.entries(exampleTool.parameters)) {
          exampleArgs[name] = param.type === "number" ? "123" : `example_${name}`;
        }
      }
      example = `\n\nExample:\nQ: Use ${exampleTool.name}\nA: {"tool": "${exampleTool.name}", "arguments": ${JSON.stringify(exampleArgs)}}`;
    }

    // Build tool descriptions
    let descriptions = "\n\nTool descriptions:\n";
    for (const tool of tools) {
      descriptions += `- ${tool.name}: ${tool.description}\n`;
    }

    return `${toolList}${example}${descriptions}\nTo use a tool, output ONLY JSON. For final answer, respond normally.\n`;
  }

  private buildAgentPrompt(conversation: AgentConversation): string {
    let prompt = "";

    // System section with context and tools
    if (conversation.context) {
      prompt += `## Context\n${conversation.context}\n`;
    }
    prompt += this.buildToolsPrompt(conversation.tools);
    prompt += "\n---\n\n";

    // Conversation history
    for (const msg of conversation.messages) {
      if (msg.role === "user") {
        prompt += `Human: ${msg.content}\n\n`;
      } else if (msg.role === "assistant") {
        prompt += `Assistant: ${msg.content}\n\n`;
      } else if (msg.role === "tool") {
        prompt += `Tool (${msg.tool_name}) result:\n${msg.content}\n\n`;
      }
    }

    prompt += "Assistant:";
    return prompt;
  }

  private parseToolCall(content: string): ToolCall | null {
    // Strategy 1: Look for JSON in code block
    const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
      const parsed = this.tryParseToolJson(jsonBlockMatch[1]);
      if (parsed) return parsed;
    }

    // Strategy 2: Extract all balanced JSON objects and check for tool calls
    const jsonObjects = this.extractJsonObjects(content);
    for (const jsonStr of jsonObjects) {
      if (jsonStr.includes('"tool"')) {
        const parsed = this.tryParseToolJson(jsonStr);
        if (parsed) return parsed;
      }
    }

    return null;
  }

  private extractJsonObjects(content: string): string[] {
    const results: string[] = [];
    let i = 0;

    while (i < content.length) {
      if (content[i] === '{') {
        const jsonStr = this.extractBalancedJson(content, i);
        if (jsonStr) {
          results.push(jsonStr);
          i += jsonStr.length;
        } else {
          i++;
        }
      } else {
        i++;
      }
    }

    return results;
  }

  private extractBalancedJson(content: string, startIdx: number): string | null {
    if (content[startIdx] !== '{') return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIdx; i < content.length; i++) {
      const char = content[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\' && inString) {
        escape = true;
        continue;
      }

      if (char === '"' && !escape) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
          if (depth === 0) {
            return content.slice(startIdx, i + 1);
          }
        }
      }
    }

    return null; // Unbalanced
  }

  private tryParseToolJson(jsonStr: string): ToolCall | null {
    try {
      // Clean up common issues
      const cleaned = jsonStr
        .replace(/,\s*}/g, '}')  // Remove trailing commas
        .replace(/'/g, '"');     // Replace single quotes

      const parsed = JSON.parse(cleaned);
      if (parsed.tool && typeof parsed.tool === "string") {
        return {
          name: parsed.tool,
          arguments: parsed.arguments || {}
        };
      }
    } catch (e) {
      // Not valid JSON
    }
    return null;
  }

  private setupTools() {
    // Main chat tool
    this.server.registerTool("chat", {
      title: "Chat with LibreModel",
      description: "Have a conversation with LibreModel (Gigi)",
      inputSchema: {
        message: z.string().describe("Your message to LibreModel"),
        temperature: z.number().min(0.0).max(2.0).default(this.config.defaultTemperature).describe("Sampling temperature (0.0-2.0)"),
        max_tokens: z.number().min(1).max(2048).default(this.config.defaultMaxTokens).describe("Maximum tokens to generate"),
        top_p: z.number().min(0.0).max(1.0).default(this.config.defaultTopP).describe("Nucleus sampling parameter"),
        top_k: z.number().min(1).default(this.config.defaultTopK).describe("Top-k sampling parameter"),
        system_prompt: z.string().default("").describe("Optional system prompt to prefix the conversation")
      }
    }, async (args) => {
      try {
        const response = await this.callLlamaServer({
          message: args.message,
          temperature: args.temperature || this.config.defaultTemperature,
          max_tokens: args.max_tokens || this.config.defaultMaxTokens,
          top_p: args.top_p || this.config.defaultTopP,
          top_k: args.top_k || this.config.defaultTopK,
          system_prompt: args.system_prompt || ""
        });

        return {
          content: [
            {
              type: "text",
              text: `**LibreModel (Gigi) responds:**\n\n${response.content}\n\n---\n*Tokens: ${response.tokens_predicted} | Model: ${response.model || "LibreModel"}*`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text", 
              text: `**Error communicating with LibreModel:**\n${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        };
      }
    });

    // Quick test tool
    this.server.registerTool("quick_test", {
      title: "Quick LibreModel Test",
      description: "Run a quick test to see if LibreModel is responding",
      inputSchema: {
        test_type: z.enum(["hello", "math", "creative", "knowledge"]).default("hello").describe("Type of test to run")
      }
    }, async (args) => {
      const testPrompts = {
        hello: "Hello! Can you introduce yourself?",
        math: "What is 15 + 27?",
        creative: "Write a short haiku about artificial intelligence.",
        knowledge: "What is the capital of France?"
      };

      const testPrompt = testPrompts[args.test_type as keyof typeof testPrompts] || testPrompts.hello;

      try {
        const response = await this.callLlamaServer({
          message: testPrompt,
          temperature: 0.7,
          max_tokens: 256,
          top_p: 0.95,
          top_k: 40,
          system_prompt: ""
        });

        return {
          content: [
            {
              type: "text",
              text: `**${args.test_type} test result:**\n\n**Prompt:** ${testPrompt}\n\n**LibreModel Response:**\n${response.content}\n\n**Performance:**\n- Tokens generated: ${response.tokens_predicted}\n- Tokens evaluated: ${response.tokens_evaluated}\n- Success: ✅`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `**${args.test_type} test failed:**\n${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        };
      }
    });

    // Server health check
    this.server.registerTool("health_check", {
      title: "Check LibreModel Server Health",
      description: "Check if the llama-server is running and responsive",
      inputSchema: {}
    }, async () => {
      try {
        // Create abort controller for timeout
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 5000);

        const healthResponse = await fetch(`${this.config.url}/health`, {
          method: "GET",
          signal: abortController.signal
        });
        
        clearTimeout(timeoutId);

        const isHealthy = healthResponse.ok;
        const status = healthResponse.status;

        // Try to get server props if available
        let serverInfo = "No additional info available";
        try {
          const propsResponse = await fetch(`${this.config.url}/props`);
          if (propsResponse.ok) {
            const props = await propsResponse.json();
            serverInfo = JSON.stringify(props, null, 2);
          }
        } catch (e) {
          // Props endpoint might not exist, that's OK
        }

        return {
          content: [
            {
              type: "text",
              text: `**LibreModel Server Health Check:**\n\n**Status:** ${isHealthy ? "✅ Healthy" : "❌ Unhealthy"}\n**HTTP Status:** ${status}\n**Server URL:** ${this.config.url}\n\n**Server Information:**\n\`\`\`json\n${serverInfo}\n\`\`\``
            }
          ]
        };
      } catch (error) {
        const errorMessage = error instanceof Error && error.name === 'AbortError' 
          ? 'Request timed out after 5 seconds'
          : error instanceof Error ? error.message : String(error);
          
        return {
          content: [
            {
              type: "text",
              text: `**Health check failed:**\n❌ Cannot reach LibreModel server at ${this.config.url}\n\n**Error:** ${errorMessage}\n\n**Troubleshooting:**\n- Is llama-server running?\n- Is it listening on ${this.config.url}?\n- Check firewall/network settings`
            }
          ],
          isError: true
        };
      }
    });

    // SSH execution tool for infrastructure access
    this.server.registerTool("ssh_exec", {
      title: "Execute SSH Command",
      description: "Execute a shell command on a remote server via SSH. Supports primary (.165), secondary (.13), HA (.148), Pi-hole (.239), and Proxmox (.75).",
      inputSchema: {
        host: z.string().describe("Server IP address (e.g., 192.168.0.165)"),
        command: z.string().describe("Shell command to execute"),
        timeout: z.number().min(1000).max(60000).default(30000).describe("Command timeout in ms (default: 30000)")
      }
    }, async (args) => {
      try {
        const hostConfig = SSH_HOSTS[args.host];
        if (!hostConfig) {
          const knownHosts = Object.keys(SSH_HOSTS);
          const helpText = knownHosts.length > 0
            ? `Configured hosts: ${knownHosts.join(", ")}`
            : "No hosts configured. Set SSH_HOSTS_FILE or SSH_HOST_<IP> env vars.";
          return {
            content: [{
              type: "text",
              text: `**SSH Error:** Unknown host ${args.host}\n\n${helpText}\n\nConfigure via:\n- SSH_HOSTS_FILE=/path/to/hosts.json\n- SSH_HOST_192_168_0_1='{"user":"admin","password":"secret"}'`
            }],
            isError: true
          };
        }

        const port = hostConfig.port || 22;
        const portArg = port !== 22 ? `-p ${port}` : "";
        const escapedCommand = args.command.replace(/"/g, '\\"');

        let sshCommand: string;
        if (hostConfig.password) {
          // Use sshpass for password auth
          sshCommand = `sshpass -p '${hostConfig.password}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${portArg} '${hostConfig.user}'@${args.host} "${escapedCommand}"`;
        } else {
          // Key-based auth
          sshCommand = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${portArg} '${hostConfig.user}'@${args.host} "${escapedCommand}"`;
        }

        const { stdout, stderr } = await execAsync(sshCommand, {
          timeout: args.timeout || 30000,
          maxBuffer: 1024 * 1024  // 1MB buffer
        });

        const output = stdout || stderr || "(no output)";
        return {
          content: [{
            type: "text",
            text: `**SSH to ${args.host}:**\n\`\`\`\n$ ${args.command}\n${output.trim()}\n\`\`\``
          }]
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `**SSH Error on ${args.host}:**\n${errorMsg}`
          }],
          isError: true
        };
      }
    });

    // Agent chat tool with tool-calling support
    this.server.registerTool("agent_chat", {
      title: "Agent Chat with Tool Calling",
      description: "Start or continue an agent conversation where the model can request tool calls. The orchestrating system (e.g., Claude) executes tools and feeds results back.",
      inputSchema: {
        task: z.string().describe("The task or message for the agent"),
        tools: z.array(z.object({
          name: z.string(),
          description: z.string(),
          parameters: z.record(z.object({
            type: z.string(),
            description: z.string().optional(),
            required: z.boolean().optional()
          })).optional()
        })).default([]).describe("Tool definitions the agent can request"),
        context: z.string().default("").describe("RAG context or background information"),
        conversation_id: z.string().optional().describe("ID to resume an existing conversation"),
        tool_result: z.object({
          tool_name: z.string(),
          result: z.string()
        }).optional().describe("Result from a previously requested tool call"),
        temperature: z.number().min(0.0).max(2.0).default(0.3).describe("Lower temperature for more focused agent behavior"),
        max_tokens: z.number().min(1).max(4096).default(1024).describe("Max tokens for agent response")
      }
    }, async (args) => {
      try {
        let conversation: AgentConversation;

        // Resume or create conversation
        if (args.conversation_id && this.conversations.has(args.conversation_id)) {
          conversation = this.conversations.get(args.conversation_id)!;

          // Add tool result if provided
          if (args.tool_result) {
            conversation.messages.push({
              role: "tool",
              content: args.tool_result.result,
              tool_name: args.tool_result.tool_name
            });
          } else if (args.task) {
            // Add new user message
            conversation.messages.push({
              role: "user",
              content: args.task
            });
          }
        } else {
          // Create new conversation
          const id = args.conversation_id || this.generateConversationId();
          conversation = {
            id,
            messages: [{ role: "user", content: args.task }],
            tools: args.tools || [],
            context: args.context || "",
            createdAt: Date.now()
          };
          this.conversations.set(id, conversation);
        }

        // Build prompt and call model
        const prompt = this.buildAgentPrompt(conversation);

        const requestBody: LlamaCompletionRequest = {
          prompt,
          temperature: args.temperature || 0.3,
          n_predict: args.max_tokens || 1024,
          top_p: 0.95,
          top_k: 40,
          stop: ["Human:", "\nHuman:", "User:", "\nUser:"],
          stream: false
        };

        const response = await fetch(`${this.config.url}/completion`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as LlamaCompletionResponse;
        const content = data.content?.trim() || "";

        // Add assistant response to conversation
        conversation.messages.push({
          role: "assistant",
          content
        });

        // Check if model requested a tool call
        const toolCall = this.parseToolCall(content);

        if (toolCall) {
          // Validate tool exists
          const toolExists = conversation.tools.some(t => t.name === toolCall.name);

          const agentResponse: AgentResponse = {
            type: "tool_call",
            conversation_id: conversation.id,
            tool_call: toolCall,
            tokens_used: data.tokens_predicted
          };

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(agentResponse, null, 2)
              }
            ]
          };
        } else {
          // Final answer - no tool call
          const agentResponse: AgentResponse = {
            type: "final_answer",
            conversation_id: conversation.id,
            content,
            tokens_used: data.tokens_predicted
          };

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(agentResponse, null, 2)
              }
            ]
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                type: "error",
                error: error instanceof Error ? error.message : String(error)
              }, null, 2)
            }
          ],
          isError: true
        };
      }
    });

    // List active conversations (for debugging)
    this.server.registerTool("list_conversations", {
      title: "List Agent Conversations",
      description: "List all active agent conversations (for debugging)",
      inputSchema: {}
    }, async () => {
      const convs = Array.from(this.conversations.values()).map(c => ({
        id: c.id,
        message_count: c.messages.length,
        tools_count: c.tools.length,
        age_seconds: Math.round((Date.now() - c.createdAt) / 1000)
      }));

      return {
        content: [
          {
            type: "text",
            text: `**Active Conversations:** ${convs.length}\n\n\`\`\`json\n${JSON.stringify(convs, null, 2)}\n\`\`\``
          }
        ]
      };
    });
  }

  private setupResources() {
    // Server configuration resource
    this.server.registerResource(
      "config",
      "libremodel://config",
      {
        title: "LibreModel MCP Server Configuration",
        description: "Current server configuration and settings",
        mimeType: "application/json"
      },
      async () => ({
        contents: [
          {
            uri: "libremodel://config", 
            text: JSON.stringify(this.config, null, 2),
            mimeType: "application/json"
          }
        ]
      })
    );

    // Usage instructions resource
    this.server.registerResource(
      "instructions",
      "libremodel://instructions",
      {
        title: "LibreModel MCP Usage Instructions",
        description: "How to use this MCP server with LibreModel",
        mimeType: "text/markdown"
      },
      async () => ({
        contents: [
          {
            uri: "libremodel://instructions",
            text: `# LibreModel MCP Server

This MCP server provides a bridge between Claude Desktop and your local LibreModel (Gigi) instance running via llama-server.

## Available Tools

### \`chat\`
Main tool for conversing with LibreModel. Supports full parameter control.

**Parameters:**
- \`message\` (required): Your message to LibreModel
- \`temperature\`: Sampling temperature (0.0-2.0, default: 0.7)
- \`max_tokens\`: Maximum tokens to generate (1-2048, default: 512)
- \`top_p\`: Nucleus sampling (0.0-1.0, default: 0.95)
- \`top_k\`: Top-k sampling (default: 40)
- \`system_prompt\`: Optional system prompt prefix

### \`quick_test\`
Run predefined tests to check LibreModel's capabilities.

**Test types:** hello, math, creative, knowledge

### \`health_check\`
Check if your llama-server is running and responsive.

## Setup

1. Make sure llama-server is running: \`./llama-server -m your_model.gguf -c 2048 --port 8080\`
2. Configure Claude Desktop to use this MCP server
3. Start chatting with LibreModel through Claude!

## Current Configuration

- Server URL: ${this.config.url}
- Default Temperature: ${this.config.defaultTemperature}
- Default Max Tokens: ${this.config.defaultMaxTokens}

Made with ❤️ for open-source AI!`,
            mimeType: "text/markdown"
          }
        ]
      })
    );
  }

  private async callLlamaServer(params: {
    message: string;
    temperature: number;
    max_tokens: number;
    top_p: number;
    top_k: number;
    system_prompt: string;
  }): Promise<LlamaCompletionResponse> {
    const prompt = params.system_prompt 
      ? `${params.system_prompt}\n\nHuman: ${params.message}\n\nAssistant:`
      : `Human: ${params.message}\n\nAssistant:`;

    const requestBody: LlamaCompletionRequest = {
      prompt,
      temperature: params.temperature,
      n_predict: params.max_tokens,
      top_p: params.top_p,
      top_k: params.top_k,
      stop: this.config.stopSequences,
      stream: false
    };

    const response = await fetch(`${this.config.url}/completion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as LlamaCompletionResponse;
    
    if (!data.content) {
      throw new Error("No content in response from llama-server");
    }

    return data;
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    console.error("🚀 LibreModel MCP Server started successfully!");
    console.error(`📡 Connected to llama-server at: ${this.config.url}`);
    console.error("💬 Ready to bridge Claude Desktop ↔ LibreModel!");
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('\n🛑 Shutting down LibreModel MCP Server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('\n🛑 Shutting down LibreModel MCP Server...');
  process.exit(0);
});

// Start the server
const server = new LibreModelMCPServer();
server.start().catch(error => {
  console.error('💥 Failed to start LibreModel MCP Server:', error);
  process.exit(1);
});
