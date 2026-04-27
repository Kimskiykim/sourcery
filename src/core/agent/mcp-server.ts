import type { AgentRuntime } from "./agent-runtime.js";
import {
  getMcpPrompt,
  listMcpPrompts,
  listMcpResources,
  listMcpResourceTemplates,
  readMcpResource,
} from "./mcp-catalog.js";

type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const MCP_PROTOCOL_VERSION = "2024-11-05";
const JSON_RPC_VERSION = "2.0" as const;

export class SourceryMcpServer {
  private initialized = false;

  constructor(private readonly agent: AgentRuntime) {}

  async handleMessage(message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (message.jsonrpc !== JSON_RPC_VERSION || typeof message.method !== "string") {
      return createJsonRpcError(message.id ?? null, -32600, "Invalid Request");
    }

    if (message.method === "notifications/initialized") {
      this.initialized = true;
      return null;
    }

    if (message.method === "initialize") {
      this.initialized = true;
      return {
        jsonrpc: JSON_RPC_VERSION,
        id: message.id ?? null,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
          serverInfo: {
            name: "sourcery",
            version: "0.0.0-local",
          },
        },
      };
    }

    if (!this.initialized) {
      return createJsonRpcError(message.id ?? null, -32002, "Server not initialized");
    }

    if (message.method === "ping") {
      return {
        jsonrpc: JSON_RPC_VERSION,
        id: message.id ?? null,
        result: {},
      };
    }

    if (message.method === "tools/list") {
      return {
        jsonrpc: JSON_RPC_VERSION,
        id: message.id ?? null,
        result: {
          tools: listMcpTools(this.agent),
        },
      };
    }

    if (message.method === "resources/list") {
      return {
        jsonrpc: JSON_RPC_VERSION,
        id: message.id ?? null,
        result: {
          resources: listMcpResources(),
        },
      };
    }

    if (message.method === "resources/templates/list") {
      return {
        jsonrpc: JSON_RPC_VERSION,
        id: message.id ?? null,
        result: {
          resourceTemplates: listMcpResourceTemplates(),
        },
      };
    }

    if (message.method === "resources/read") {
      const params = asObject(message.params);
      try {
        const result = await readMcpResource(
          this.agent,
          readRequiredString(params?.uri, "uri")
        );
        return {
          jsonrpc: JSON_RPC_VERSION,
          id: message.id ?? null,
          result,
        };
      } catch (error) {
        return createJsonRpcError(
          message.id ?? null,
          -32000,
          error instanceof Error ? error.message : "Resource read failed"
        );
      }
    }

    if (message.method === "prompts/list") {
      return {
        jsonrpc: JSON_RPC_VERSION,
        id: message.id ?? null,
        result: {
          prompts: listMcpPrompts(),
        },
      };
    }

    if (message.method === "prompts/get") {
      const params = asObject(message.params);
      try {
        const result = await getMcpPrompt(
          this.agent,
          readRequiredString(params?.name, "name"),
          asObject(params?.arguments) ?? {}
        );
        return {
          jsonrpc: JSON_RPC_VERSION,
          id: message.id ?? null,
          result,
        };
      } catch (error) {
        return createJsonRpcError(
          message.id ?? null,
          -32000,
          error instanceof Error ? error.message : "Prompt get failed"
        );
      }
    }

    if (message.method === "tools/call") {
      const params = asObject(message.params);
      const toolName = typeof params?.name === "string" ? params.name : "";
      const args = asObject(params?.arguments) ?? {};

      const result = await this.callTool(toolName, args);
      return {
        jsonrpc: JSON_RPC_VERSION,
        id: message.id ?? null,
        result,
      };
    }

    return createJsonRpcError(message.id ?? null, -32601, "Method not found");
  }

  private async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent?: unknown; isError?: boolean }> {
    if (this.agent.hasTool(toolName) && !this.agent.isToolAllowed(toolName)) {
      return {
        content: [{ type: "text", text: `Tool is disabled by policy: ${toolName}` }],
        isError: true,
      };
    }

    try {
      const payload = await dispatchToolCall(this.agent, toolName, args);
      return toToolResult(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool call failed";
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  }
}

export function listMcpTools(agent: AgentRuntime): McpTool[] {
  return [
    {
      name: "connections.list",
      description: "List workspace connections and the default connection.",
      inputSchema: objectSchema({}),
    },
    {
      name: "notes.search",
      description: "Search notes in a connection by plain text or #tag query.",
      inputSchema: objectSchema({
        connectionId: stringSchema("Optional connection id; defaults to the default connection."),
        query: stringSchema("Plain text or #tag query."),
        limit: integerSchema("Maximum number of matching notes to return."),
      }),
    },
    {
      name: "notes.read",
      description: "Read a note by WorkspaceNoteRef with metadata and backlinks.",
      inputSchema: objectSchema({
        noteRef: workspaceNoteRefSchema(),
      }, ["noteRef"]),
    },
    {
      name: "notes.create",
      description: "Create a markdown note in the selected connection notes root.",
      inputSchema: objectSchema({
        connectionId: stringSchema("Optional connection id; defaults to the default connection."),
        title: stringSchema("Note title."),
        content: stringSchema("Markdown content."),
        folderPath: stringSchema("Optional relative folder path."),
      }, ["title", "content"]),
    },
    {
      name: "notes.update",
      description: "Update or move a markdown note by WorkspaceNoteRef.",
      inputSchema: objectSchema({
        noteRef: workspaceNoteRefSchema(),
        title: stringSchema("New note title."),
        content: stringSchema("New markdown content."),
        folderPath: stringSchema("Optional target folder path."),
      }, ["noteRef", "title", "content"]),
    },
    {
      name: "notes.backlinks",
      description: "List notes that link to the target note.",
      inputSchema: objectSchema({
        noteRef: workspaceNoteRefSchema(),
      }, ["noteRef"]),
    },
    {
      name: "graph.summary",
      description: "Return graph summary statistics for a connection.",
      inputSchema: objectSchema({
        connectionId: stringSchema("Optional connection id; defaults to the default connection."),
      }),
    },
    {
      name: "session.get",
      description: "Return the current workspace tab session snapshot.",
      inputSchema: objectSchema({
        connectionId: stringSchema("Optional connection id; defaults to the default connection."),
      }),
    },
    {
      name: "tabs.open",
      description: "Open a note in the workspace tab session.",
      inputSchema: objectSchema({
        noteRef: workspaceNoteRefSchema(),
        activate: booleanSchema("Whether to activate the tab after opening."),
        pinned: booleanSchema("Whether to pin the tab."),
      }, ["noteRef"]),
    },
    {
      name: "context.pack",
      description: "Build an aggregated context pack across one or more workspace connections.",
      inputSchema: objectSchema({
        query: stringSchema("Optional plain text or #tag query."),
        connectionIds: {
          type: "array",
          description: "Optional list of connection ids to include.",
          items: stringSchema("Workspace connection id."),
        },
        limit: integerSchema("Maximum number of note matches to return."),
      }),
    },
  ].filter((tool) => agent.isToolAllowed(tool.name));
}

export function encodeMcpMessage(message: JsonRpcResponse): string {
  const payload = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`;
}

export class McpMessageBuffer {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): JsonRpcRequest[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: JsonRpcRequest[] = [];

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        break;
      }

      const headerText = this.buffer.subarray(0, headerEnd).toString("utf8");
      const contentLength = readContentLength(headerText);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.length < bodyEnd) {
        break;
      }

      const bodyText = this.buffer.subarray(bodyStart, bodyEnd).toString("utf8");
      const parsed = JSON.parse(bodyText) as JsonRpcRequest;
      messages.push(parsed);
      this.buffer = this.buffer.subarray(bodyEnd);
    }

    return messages;
  }
}

async function dispatchToolCall(
  agent: AgentRuntime,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case "connections.list":
      return agent.listConnections();
    case "notes.search":
      return agent.searchNotes({
        connectionId: readOptionalString(args.connectionId, "connectionId"),
        query: readOptionalString(args.query, "query"),
        limit: readOptionalInteger(args.limit, "limit"),
      });
    case "notes.read":
      return agent.readNote({
        noteRef: readWorkspaceNoteRef(args.noteRef),
      });
    case "notes.create":
      return agent.createNote({
        connectionId: readOptionalString(args.connectionId, "connectionId"),
        title: readRequiredString(args.title, "title"),
        content: readRequiredString(args.content, "content"),
        folderPath: readOptionalString(args.folderPath, "folderPath"),
      });
    case "notes.update":
      return agent.updateNote({
        noteRef: readWorkspaceNoteRef(args.noteRef),
        title: readRequiredString(args.title, "title"),
        content: readRequiredString(args.content, "content"),
        folderPath: readOptionalString(args.folderPath, "folderPath"),
      });
    case "notes.backlinks":
      return agent.getBacklinks({
        noteRef: readWorkspaceNoteRef(args.noteRef),
      });
    case "graph.summary":
      return agent.getGraphSummary({
        connectionId: readOptionalString(args.connectionId, "connectionId"),
      });
    case "session.get":
      return agent.getSession(readOptionalString(args.connectionId, "connectionId"));
    case "tabs.open":
      return agent.openTab({
        noteRef: readWorkspaceNoteRef(args.noteRef),
        activate: readOptionalBoolean(args.activate, "activate"),
        pinned: readOptionalBoolean(args.pinned, "pinned"),
      });
    case "context.pack":
      return agent.getContextPack({
        query: readOptionalString(args.query, "query"),
        connectionIds: readOptionalStringList(args.connectionIds, "connectionIds"),
        limit: readOptionalInteger(args.limit, "limit"),
      });
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

function toToolResult(payload: unknown): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: unknown;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function createJsonRpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: {
      code,
      message,
    },
  };
}

function readContentLength(headerText: string): number {
  const lines = headerText.split("\r\n");
  const contentLengthLine = lines.find((line) => line.toLowerCase().startsWith("content-length:"));
  if (!contentLengthLine) {
    throw new Error("Missing Content-Length header");
  }

  const rawValue = contentLengthLine.slice(contentLengthLine.indexOf(":") + 1).trim();
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Invalid Content-Length header");
  }

  return parsed;
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function workspaceNoteRefSchema(): Record<string, unknown> {
  return objectSchema({
    connectionId: stringSchema("Workspace connection id."),
    noteId: stringSchema("Relative note id, e.g. docs/Guide.md."),
  }, ["connectionId", "noteId"]);
}

function stringSchema(description: string): Record<string, unknown> {
  return {
    type: "string",
    description,
  };
}

function integerSchema(description: string): Record<string, unknown> {
  return {
    type: "integer",
    description,
    minimum: 1,
  };
}

function booleanSchema(description: string): Record<string, unknown> {
  return {
    type: "boolean",
    description,
  };
}

function readWorkspaceNoteRef(value: unknown): { connectionId: string; noteId: string } {
  const params = asObject(value);
  return {
    connectionId: readRequiredString(params?.connectionId, "noteRef.connectionId"),
    noteId: readRequiredString(params?.noteId, "noteRef.noteId"),
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown, key: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }

  return value.trim();
}

function readOptionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readRequiredString(value, key);
}

function readOptionalBoolean(value: unknown, key: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }

  return value;
}

function readOptionalInteger(value: unknown, key: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${key} must be a positive integer`);
  }

  return value as number;
}

function readOptionalStringList(value: unknown, key: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array of strings`);
  }

  return value.map((item, index) => readRequiredString(item, `${key}[${index}]`));
}
