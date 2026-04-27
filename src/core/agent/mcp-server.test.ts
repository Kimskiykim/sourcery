import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { GraphSDK, WorkspaceTabsSessionStore } from "../graph/graph-sdk.js";
import { MarkdownVault } from "../storage/markdown-vault.js";
import { WorkspaceConnectionsStore } from "../workspace/connections-store.js";
import { WorkspaceSDK } from "../workspace/workspace-sdk.js";
import { WikiSDK } from "../wiki/wiki-sdk.js";
import { AgentWorkspaceSDK } from "./agent-sdk.js";
import { McpMessageBuffer, SourceryMcpServer } from "./mcp-server.js";

async function createMcpServer(
  t: { after: (callback: () => Promise<void> | void) => void },
  options: { allowNoteWrites?: boolean } = {}
) {
  const vaultDir = await mkdtemp(path.join(tmpdir(), "sourcery-mcp-"));
  t.after(async () => {
    await rm(vaultDir, { recursive: true, force: true });
  });

  const workspace = new WorkspaceSDK(new MarkdownVault(vaultDir));
  const defaultConnection = {
    id: "default",
    name: "Vault",
    kind: "vault" as const,
    rootPath: vaultDir,
    notesRoot: vaultDir,
    isDefault: true,
  };
  const connections = new WorkspaceConnectionsStore({ defaultConnection });
  const wiki = new WikiSDK();
  const graph = new GraphSDK(wiki);
  const tabsSession = new WorkspaceTabsSessionStore({
    defaultConnection,
    resolveConnection: (connectionId) => connections.getConnection(connectionId) ?? undefined,
  });
  const agent = new AgentWorkspaceSDK({
    workspace,
    wiki,
    graph,
    connections,
    tabsSession,
    policy: { allowNoteWrites: options.allowNoteWrites === true },
  });

  return {
    server: new SourceryMcpServer(agent),
    workspace,
  };
}

test("mcp server handles initialize and tools/list", async (t) => {
  const { server } = await createMcpServer(t);

  const initialized = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  });
  assert.equal(initialized?.result && typeof initialized.result === "object", true);
  assert.deepEqual(
    initialized?.result,
    {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      serverInfo: {
        name: "sourcery",
        version: "0.0.0-local",
      },
    }
  );

  const listed = await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });
  const result = listed?.result as { tools: Array<{ name: string }> };
  assert.ok(result.tools.some((tool) => tool.name === "notes.search"));
  assert.ok(result.tools.some((tool) => tool.name === "tabs.open"));
  assert.ok(!result.tools.some((tool) => tool.name === "notes.create"));
  assert.ok(!result.tools.some((tool) => tool.name === "notes.update"));
});

test("mcp server exposes resources and prompts", async (t) => {
  const { server, workspace } = await createMcpServer(t);
  await workspace.createNote({
    title: "Bootstrap",
    content: "#backend",
  });

  await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  });

  const resources = await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "resources/list",
  });
  const listedResources = resources?.result as { resources: Array<{ uri: string }> };
  assert.ok(listedResources.resources.some((resource) => resource.uri === "sourcery://context/overview"));
  assert.ok(listedResources.resources.some((resource) => resource.uri === "sourcery://connections"));

  const templates = await server.handleMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "resources/templates/list",
  });
  const listedTemplates = templates?.result as { resourceTemplates: Array<{ uriTemplate: string }> };
  assert.ok(listedTemplates.resourceTemplates.some((template) => template.uriTemplate === "sourcery://context/{connectionId}"));
  assert.ok(listedTemplates.resourceTemplates.some((template) => template.uriTemplate === "sourcery://session/{connectionId}"));

  const readResource = await server.handleMessage({
    jsonrpc: "2.0",
    id: 4,
    method: "resources/read",
    params: {
      uri: "sourcery://context/overview",
    },
  });
  const resourceResult = readResource?.result as { contents: Array<{ text: string }> };
  assert.match(resourceResult.contents[0]?.text ?? "", /Bootstrap\.md/);

  const readTemplateResource = await server.handleMessage({
    jsonrpc: "2.0",
    id: 5,
    method: "resources/read",
    params: {
      uri: "sourcery://context/default",
    },
  });
  const templateResourceResult = readTemplateResource?.result as { contents: Array<{ text: string }> };
  assert.match(templateResourceResult.contents[0]?.text ?? "", /Bootstrap\.md/);

  const prompts = await server.handleMessage({
    jsonrpc: "2.0",
    id: 6,
    method: "prompts/list",
  });
  const listedPrompts = prompts?.result as { prompts: Array<{ name: string }> };
  assert.ok(listedPrompts.prompts.some((prompt) => prompt.name === "project-context-bootstrap"));
  assert.ok(listedPrompts.prompts.some((prompt) => prompt.name === "adr-bootstrap"));

  const prompt = await server.handleMessage({
    jsonrpc: "2.0",
    id: 7,
    method: "prompts/get",
    params: {
      name: "project-context-bootstrap",
      arguments: {
        task: "Investigate backend notes",
        query: "#backend",
        limit: "5",
      },
    },
  });
  const promptResult = prompt?.result as {
    messages: Array<{ content: { text: string } }>;
  };
  const promptText = promptResult.messages[0]?.content.text ?? "";
  assert.match(promptText, /Investigate backend notes/);
  assert.match(promptText, /sourcery:\/\/context\/overview/);
  assert.match(promptText, /Bootstrap\.md/);

  const adrPrompt = await server.handleMessage({
    jsonrpc: "2.0",
    id: 8,
    method: "prompts/get",
    params: {
      name: "adr-bootstrap",
      arguments: {
        connectionId: "default",
        decision: "Adopt Sourcery for docs memory",
        contextQuery: "#backend",
      },
    },
  });
  const adrPromptResult = adrPrompt?.result as {
    messages: Array<{ content: { text: string } }>;
  };
  const adrPromptText = adrPromptResult.messages[0]?.content.text ?? "";
  assert.match(adrPromptText, /Adopt Sourcery for docs memory/);
  assert.match(adrPromptText, /sourcery:\/\/context\/default/);
  assert.match(adrPromptText, /notesRoot/);
});

test("mcp server calls tools and returns structured content", async (t) => {
  const { server, workspace } = await createMcpServer(t);
  const alpha = await workspace.createNote({
    title: "Alpha",
    content: "# Alpha",
  });
  await workspace.createNote({
    title: "Beta",
    content: "See [[Alpha]] and #backend",
  });

  await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  });

  const searched = await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "notes.search",
      arguments: {
        query: "#backend",
      },
    },
  });
  const searchResult = searched?.result as {
    content: Array<{ type: string; text: string }>;
    structuredContent: { total: number; notes: Array<{ noteRef: { noteId: string } }> };
  };
  assert.equal(searchResult.structuredContent.total, 1);
  assert.equal(searchResult.structuredContent.notes[0]?.noteRef.noteId, "Beta.md");
  assert.equal(searchResult.content[0]?.type, "text");

  const opened = await server.handleMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "tabs.open",
      arguments: {
        noteRef: {
          connectionId: "default",
          noteId: alpha.id,
        },
      },
    },
  });
  const openResult = opened?.result as {
    structuredContent: {
      session: { activeTabId: string | null };
    };
  };
  assert.equal(openResult.structuredContent.session.activeTabId, alpha.id);

  const contextPack = await server.handleMessage({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "context.pack",
      arguments: {
        query: "#backend",
        limit: 5,
      },
    },
  });
  const contextResult = contextPack?.result as {
    structuredContent: {
      totalMatches: number;
      notes: Array<{ noteRef: { noteId: string } }>;
    };
  };
  assert.equal(contextResult.structuredContent.totalMatches, 1);
  assert.equal(contextResult.structuredContent.notes[0]?.noteRef.noteId, "Beta.md");

  const blockedCreate = await server.handleMessage({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "notes.create",
      arguments: {
        title: "Blocked",
        content: "# blocked",
      },
    },
  });
  const blockedResult = blockedCreate?.result as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  assert.equal(blockedResult.isError, true);
  assert.match(blockedResult.content[0]?.text ?? "", /Tool is disabled by policy: notes\.create/);
});

test("mcp message buffer decodes framed messages", () => {
  const buffer = new McpMessageBuffer();
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "ping",
  });
  const requestPayload = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
  const chunks = [
    Buffer.from(requestPayload.slice(0, 18), "utf8"),
    Buffer.from(requestPayload.slice(18), "utf8"),
  ];

  const first = buffer.push(chunks[0]);
  assert.deepEqual(first, []);

  const second = buffer.push(chunks[1]);
  assert.equal(second.length, 1);
  assert.equal(second[0]?.method, "ping");
});
