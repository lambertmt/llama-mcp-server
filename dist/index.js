#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
class LibreModelMCPServer {
    server;
    config;
    conversations = new Map();
    CONVERSATION_TTL = 30 * 60 * 1000; // 30 minutes
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
    cleanupConversations() {
        const now = Date.now();
        for (const [id, conv] of this.conversations) {
            if (now - conv.createdAt > this.CONVERSATION_TTL) {
                this.conversations.delete(id);
            }
        }
    }
    generateConversationId() {
        return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    buildToolsPrompt(tools) {
        if (tools.length === 0)
            return "";
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
            const exampleArgs = {};
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
    buildAgentPrompt(conversation) {
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
            }
            else if (msg.role === "assistant") {
                prompt += `Assistant: ${msg.content}\n\n`;
            }
            else if (msg.role === "tool") {
                prompt += `Tool (${msg.tool_name}) result:\n${msg.content}\n\n`;
            }
        }
        prompt += "Assistant:";
        return prompt;
    }
    parseToolCall(content) {
        // Strategy 1: Look for JSON in code block
        const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonBlockMatch) {
            const parsed = this.tryParseToolJson(jsonBlockMatch[1]);
            if (parsed)
                return parsed;
        }
        // Strategy 2: Look for inline JSON object with "tool" key
        const inlineMatches = content.match(/\{[^{}]*"tool"[^{}]*\}/g);
        if (inlineMatches) {
            for (const match of inlineMatches) {
                const parsed = this.tryParseToolJson(match);
                if (parsed)
                    return parsed;
            }
        }
        // Strategy 3: Look for JSON object anywhere in content (more permissive)
        const anyJsonMatch = content.match(/\{[\s\S]*?"tool"[\s\S]*?\}/);
        if (anyJsonMatch) {
            const parsed = this.tryParseToolJson(anyJsonMatch[0]);
            if (parsed)
                return parsed;
        }
        return null;
    }
    tryParseToolJson(jsonStr) {
        try {
            // Clean up common issues
            const cleaned = jsonStr
                .replace(/,\s*}/g, '}') // Remove trailing commas
                .replace(/'/g, '"'); // Replace single quotes
            const parsed = JSON.parse(cleaned);
            if (parsed.tool && typeof parsed.tool === "string") {
                return {
                    name: parsed.tool,
                    arguments: parsed.arguments || {}
                };
            }
        }
        catch (e) {
            // Not valid JSON
        }
        return null;
    }
    setupTools() {
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
            }
            catch (error) {
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
            const testPrompt = testPrompts[args.test_type] || testPrompts.hello;
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
            }
            catch (error) {
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
                }
                catch (e) {
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
            }
            catch (error) {
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
                let conversation;
                // Resume or create conversation
                if (args.conversation_id && this.conversations.has(args.conversation_id)) {
                    conversation = this.conversations.get(args.conversation_id);
                    // Add tool result if provided
                    if (args.tool_result) {
                        conversation.messages.push({
                            role: "tool",
                            content: args.tool_result.result,
                            tool_name: args.tool_result.tool_name
                        });
                    }
                    else if (args.task) {
                        // Add new user message
                        conversation.messages.push({
                            role: "user",
                            content: args.task
                        });
                    }
                }
                else {
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
                const requestBody = {
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
                const data = await response.json();
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
                    const agentResponse = {
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
                }
                else {
                    // Final answer - no tool call
                    const agentResponse = {
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
            }
            catch (error) {
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
    setupResources() {
        // Server configuration resource
        this.server.registerResource("config", "libremodel://config", {
            title: "LibreModel MCP Server Configuration",
            description: "Current server configuration and settings",
            mimeType: "application/json"
        }, async () => ({
            contents: [
                {
                    uri: "libremodel://config",
                    text: JSON.stringify(this.config, null, 2),
                    mimeType: "application/json"
                }
            ]
        }));
        // Usage instructions resource
        this.server.registerResource("instructions", "libremodel://instructions", {
            title: "LibreModel MCP Usage Instructions",
            description: "How to use this MCP server with LibreModel",
            mimeType: "text/markdown"
        }, async () => ({
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
        }));
    }
    async callLlamaServer(params) {
        const prompt = params.system_prompt
            ? `${params.system_prompt}\n\nHuman: ${params.message}\n\nAssistant:`
            : `Human: ${params.message}\n\nAssistant:`;
        const requestBody = {
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
        const data = await response.json();
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
//# sourceMappingURL=index.js.map