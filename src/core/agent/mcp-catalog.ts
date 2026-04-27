import type { AgentRuntime } from "./agent-runtime.js";

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

export interface McpPromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface McpResourceTemplateArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType?: string;
  arguments?: McpResourceTemplateArgument[];
}

export interface McpPrompt {
  name: string;
  description: string;
  arguments?: McpPromptArgument[];
}

export interface McpReadResourceResult {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text: string;
  }>;
}

export interface McpPromptResult {
  description?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: {
      type: "text";
      text: string;
    };
  }>;
}

const MCP_JSON_MIME = "application/json";

const MCP_RESOURCES: McpResource[] = [
  {
    uri: "sourcery://capabilities",
    name: "Sourcery Capabilities",
    description: "Agent-facing Sourcery tool capabilities and default connection metadata.",
    mimeType: MCP_JSON_MIME,
  },
  {
    uri: "sourcery://connections",
    name: "Sourcery Connections",
    description: "Configured workspace connections and default connection id.",
    mimeType: MCP_JSON_MIME,
  },
  {
    uri: "sourcery://context/overview",
    name: "Sourcery Context Overview",
    description: "Aggregated cross-connection context pack without a search query.",
    mimeType: MCP_JSON_MIME,
  },
  {
    uri: "sourcery://session/default",
    name: "Sourcery Default Session",
    description: "Workspace tab session snapshot for the default connection.",
    mimeType: MCP_JSON_MIME,
  },
];

const MCP_RESOURCE_TEMPLATES: McpResourceTemplate[] = [
  {
    uriTemplate: "sourcery://context/{connectionId}",
    name: "Sourcery Connection Context",
    description: "Aggregated context pack for a single connection.",
    mimeType: MCP_JSON_MIME,
    arguments: [
      {
        name: "connectionId",
        description: "Workspace connection id.",
        required: true,
      },
    ],
  },
  {
    uriTemplate: "sourcery://session/{connectionId}",
    name: "Sourcery Connection Session",
    description: "Workspace tab session snapshot scoped to a single connection.",
    mimeType: MCP_JSON_MIME,
    arguments: [
      {
        name: "connectionId",
        description: "Workspace connection id.",
        required: true,
      },
    ],
  },
];

const MCP_PROMPTS: McpPrompt[] = [
  {
    name: "project-context-bootstrap",
    description: "Bootstrap an external agent with current Sourcery workspace context for a task.",
    arguments: [
      {
        name: "task",
        description: "Short description of the current coding or research task.",
        required: false,
      },
      {
        name: "query",
        description: "Optional plain text or #tag query to focus the initial context pack.",
        required: false,
      },
      {
        name: "connectionIds",
        description: "Optional comma-separated list of Sourcery connection ids to include.",
        required: false,
      },
      {
        name: "limit",
        description: "Optional maximum number of matching notes to include.",
        required: false,
      },
    ],
  },
  {
    name: "adr-bootstrap",
    description: "Generate a disciplined ADR-writing bootstrap prompt for a specific connection.",
    arguments: [
      {
        name: "connectionId",
        description: "Target Sourcery connection id for the ADR.",
        required: true,
      },
      {
        name: "decision",
        description: "Short statement of the decision being recorded.",
        required: true,
      },
      {
        name: "contextQuery",
        description: "Optional plain text or #tag query to gather relevant context.",
        required: false,
      },
      {
        name: "limit",
        description: "Optional maximum number of context notes to include.",
        required: false,
      },
    ],
  },
];

export function listMcpResources(): McpResource[] {
  return MCP_RESOURCES.map((resource) => ({ ...resource }));
}

export function listMcpResourceTemplates(): McpResourceTemplate[] {
  return MCP_RESOURCE_TEMPLATES.map((template) => ({
    ...template,
    arguments: template.arguments?.map((argument) => ({ ...argument })),
  }));
}

export async function readMcpResource(
  agent: AgentRuntime,
  uri: string
): Promise<McpReadResourceResult> {
  const payload = await readResourcePayload(agent, uri);
  return {
    contents: [
      {
        uri,
        mimeType: MCP_JSON_MIME,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function listMcpPrompts(): McpPrompt[] {
  return MCP_PROMPTS.map((prompt) => ({
    ...prompt,
    arguments: prompt.arguments?.map((argument) => ({ ...argument })),
  }));
}

export async function getMcpPrompt(
  agent: AgentRuntime,
  name: string,
  args: Record<string, unknown>
): Promise<McpPromptResult> {
  switch (name) {
    case "project-context-bootstrap":
      return buildProjectContextBootstrapPrompt(agent, args);
    case "adr-bootstrap":
      return buildAdrBootstrapPrompt(agent, args);
    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}

async function readResourcePayload(agent: AgentRuntime, uri: string): Promise<unknown> {
  switch (uri) {
    case "sourcery://capabilities":
      return agent.getCapabilities();
    case "sourcery://connections":
      return await agent.listConnections();
    case "sourcery://context/overview":
      return agent.getContextPack({ limit: 20 });
    case "sourcery://session/default":
      return agent.getSession();
  }

  const dynamicContextConnectionId = matchTemplateUri(uri, "sourcery://context/");
  if (dynamicContextConnectionId) {
    return agent.getContextPack({
      connectionIds: [dynamicContextConnectionId],
      limit: 20,
    });
  }

  const dynamicSessionConnectionId = matchTemplateUri(uri, "sourcery://session/");
  if (dynamicSessionConnectionId) {
    return agent.getSession(dynamicSessionConnectionId);
  }

  throw new Error(`Unknown resource: ${uri}`);
}

async function buildProjectContextBootstrapPrompt(
  agent: AgentRuntime,
  args: Record<string, unknown>
): Promise<McpPromptResult> {
  const task = readOptionalString(args.task, "task");
  const query = readOptionalString(args.query, "query");
  const connectionIds = readOptionalStringList(args.connectionIds, "connectionIds");
  const limit = readOptionalInteger(args.limit, "limit");
  const capabilities = agent.getCapabilities();
  const connections = await agent.listConnections();
  const canWriteNotes = hasAvailableTool(capabilities, "notes.create")
    && hasAvailableTool(capabilities, "notes.update");
  const contextPack = await agent.getContextPack({
    query,
    connectionIds,
    limit,
  });

  const lines = [
    "You are attached to the Sourcery MCP server for a desktop-local markdown workspace.",
    "",
    `Default connection: ${capabilities.defaultConnectionId}`,
    `Available connections: ${connections.connections.map((connection) => connection.id).join(", ") || "(none)"}`,
    "",
    "Static MCP resources you can read immediately:",
    "- sourcery://capabilities",
    "- sourcery://connections",
    "- sourcery://context/overview",
    "- sourcery://session/default",
    "",
    "Connection-scoped resource templates:",
    "- sourcery://context/{connectionId}",
    "- sourcery://session/{connectionId}",
    "",
    "Preferred workflow:",
    "1. Read the context pack below.",
    "2. Use notes.read on the most relevant noteRefs before writing code or docs.",
    "3. Narrow with notes.search or context.pack if the current query is too broad.",
    canWriteNotes
      ? "4. Use notes.create / notes.update for markdown knowledge artifacts."
      : "4. Sourcery note write tools are disabled; use Sourcery as a read/context layer.",
    "5. Keep markdown in connection notesRoot when note write tools are available; do not treat codeRoot as the docs destination unless the connection is configured that way.",
    "",
  ];

  if (task) {
    lines.push(`Current task: ${task}`, "");
  }

  if (query) {
    lines.push(`Bootstrap query: ${query}`, "");
  }

  if (connectionIds && connectionIds.length > 0) {
    lines.push(`Scoped connections: ${connectionIds.join(", ")}`, "");
  }

  lines.push(
    "Context pack:",
    JSON.stringify(contextPack, null, 2)
  );

  return {
    description: "Bootstrap prompt for Sourcery project context.",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: lines.join("\n"),
        },
      },
    ],
  };
}

async function buildAdrBootstrapPrompt(
  agent: AgentRuntime,
  args: Record<string, unknown>
): Promise<McpPromptResult> {
  const connectionId = readRequiredString(args.connectionId, "connectionId");
  const decision = readRequiredString(args.decision, "decision");
  const contextQuery = readOptionalString(args.contextQuery, "contextQuery");
  const limit = readOptionalInteger(args.limit, "limit");
  const capabilities = agent.getCapabilities();
  const canWriteNotes = hasAvailableTool(capabilities, "notes.create")
    && hasAvailableTool(capabilities, "notes.update");
  const connections = await agent.listConnections();
  const connection = connections.connections.find((item) => item.id === connectionId);
  if (!connection) {
    throw new Error(`Unknown connection: ${connectionId}`);
  }

  const contextPack = await agent.getContextPack({
    query: contextQuery,
    connectionIds: [connectionId],
    limit,
  });

  const lines = [
    `Prepare an ADR in Sourcery for connection \`${connectionId}\`.`,
    `Decision summary: ${decision}`,
    "",
    "Constraints:",
    canWriteNotes
      ? "- Write markdown into the connection notesRoot, not into codeRoot unless they are the same path."
      : "- Sourcery note write tools are disabled; draft the ADR content and ask before writing through another channel.",
    canWriteNotes
      ? "- Prefer creating a new ADR note rather than overwriting an unrelated note."
      : "- Do not assume notes.create or notes.update is available in this session.",
    "- Read the most relevant noteRefs from the context pack before writing.",
    "- Use a stable ADR structure: Title, Status, Context, Decision, Consequences, References.",
    "",
    "Suggested workflow:",
    "1. Inspect the context pack below.",
    "2. Read the most relevant noteRefs with notes.read.",
    canWriteNotes
      ? "3. Create a new ADR note with notes.create."
      : "3. Draft the ADR in your response or in the repository only if the user asked for that.",
    canWriteNotes
      ? "4. If you revise it after review, use notes.update on that ADR noteRef."
      : "4. Ask for write-enabled Sourcery only if the user wants the ADR persisted through MCP.",
    "",
  ];

  if (contextQuery) {
    lines.push(`Context query: ${contextQuery}`, "");
  }

  lines.push(
    `Connection resource: sourcery://context/${connectionId}`,
    `Session resource: sourcery://session/${connectionId}`,
    "",
    "Connection context pack:",
    JSON.stringify(contextPack, null, 2)
  );

  return {
    description: `ADR bootstrap prompt for connection ${connectionId}.`,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: lines.join("\n"),
        },
      },
    ],
  };
}

function hasAvailableTool(
  capabilities: { tools: Array<{ name: string }> },
  toolName: string
): boolean {
  return capabilities.tools.some((tool) => tool.name === toolName);
}

function matchTemplateUri(uri: string, prefix: string): string | null {
  if (!uri.startsWith(prefix)) {
    return null;
  }

  const suffix = uri.slice(prefix.length).trim();
  if (!suffix) {
    return null;
  }

  return decodeURIComponent(suffix);
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

function readOptionalInteger(value: unknown, key: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = typeof value === "string"
    ? Number.parseInt(value, 10)
    : typeof value === "number"
      ? value
      : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${key} must be a positive integer`);
  }

  return parsed;
}

function readOptionalStringList(value: unknown, key: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (!Array.isArray(value)) {
    throw new Error(`${key} must be a string or an array of strings`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${key}[${index}] is required`);
    }

    return item.trim();
  });
}
