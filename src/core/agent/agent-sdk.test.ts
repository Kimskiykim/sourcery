import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { GraphSDK, WorkspaceTabsSessionStore } from "../graph/graph-sdk.js";
import { MarkdownVault } from "../storage/markdown-vault.js";
import { WorkspaceConnectionsStore } from "../workspace/connections-store.js";
import { WorkspaceSDK } from "../workspace/workspace-sdk.js";
import { WikiSDK } from "../wiki/wiki-sdk.js";
import { AgentWorkspaceSDK } from "./agent-sdk.js";

test("agent sdk searches reads backlinks graph summary and session on the default connection", async (t) => {
  const vaultDir = await mkdtemp(path.join(tmpdir(), "sourcery-agent-default-"));
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
  });

  const alpha = await workspace.createNote({
    title: "Alpha",
    content: "# Alpha",
  });
  const beta = await workspace.createNote({
    title: "Beta",
    content: "See [[Alpha]] and #backend",
    folderPath: "docs",
  });

  const capabilities = agent.getCapabilities();
  assert.equal(capabilities.apiVersion, "v0");
  assert.ok(capabilities.tools.some((tool) => tool.name === "notes.search"));
  assert.ok(!capabilities.tools.some((tool) => tool.name === "notes.create"));
  assert.ok(!capabilities.tools.some((tool) => tool.name === "notes.update"));

  const search = await agent.searchNotes({ query: "#backend" });
  assert.equal(search.connectionId, "default");
  assert.equal(search.total, 1);
  assert.deepEqual(search.notes.map((note) => note.noteRef.noteId), [beta.id]);
  assert.equal(search.notes[0]?.backlinksCount, 0);

  const read = await agent.readNote({
    noteRef: {
      connectionId: "default",
      noteId: alpha.id,
    },
  });
  assert.equal(read.note.id, alpha.id);
  assert.deepEqual(read.metadata.backlinks, [beta.id]);

  const backlinks = await agent.getBacklinks({
    noteRef: {
      connectionId: "default",
      noteId: alpha.id,
    },
  });
  assert.deepEqual(backlinks.backlinks.map((item) => item.noteRef.noteId), [beta.id]);

  const graphSummary = await agent.getGraphSummary();
  assert.equal(graphSummary.connection.id, "default");
  assert.equal(graphSummary.stats.noteCount, 2);

  const opened = await agent.openTab({
    noteRef: {
      connectionId: "default",
      noteId: alpha.id,
    },
  });
  assert.equal(opened.session.activeTabId, alpha.id);

  const session = await agent.getSession();
  assert.equal(session.session.activeNoteId, alpha.id);
  assert.equal(session.session.activeConnectionId, "default");

  await assert.rejects(
    () => agent.createNote({
      title: "Blocked",
      content: "# blocked",
    }),
    /Agent note writes are disabled by policy/
  );
});

test("agent sdk writes markdown into notesRoot for a code_repo connection", async (t) => {
  const defaultVaultDir = await mkdtemp(path.join(tmpdir(), "sourcery-agent-default-"));
  const codeRoot = await mkdtemp(path.join(tmpdir(), "sourcery-agent-code-"));
  const notesRoot = await mkdtemp(path.join(tmpdir(), "sourcery-agent-notes-"));
  t.after(async () => {
    await rm(defaultVaultDir, { recursive: true, force: true });
    await rm(codeRoot, { recursive: true, force: true });
    await rm(notesRoot, { recursive: true, force: true });
  });

  const workspace = new WorkspaceSDK(
    new MarkdownVault(defaultVaultDir),
    (connectionId) => {
      if (connectionId === "project-a") {
        return new MarkdownVault(notesRoot);
      }

      return undefined;
    }
  );
  const defaultConnection = {
    id: "default",
    name: "Vault",
    kind: "vault" as const,
    rootPath: defaultVaultDir,
    notesRoot: defaultVaultDir,
    isDefault: true,
  };
  const connections = new WorkspaceConnectionsStore({ defaultConnection });
  const projectConnection = connections.createConnection({
    id: "project-a",
    name: "Project A",
    kind: "code_repo",
    codeRoot,
    notesRoot,
  });
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
    policy: { allowNoteWrites: true },
  });

  const created = await agent.createNote({
    connectionId: projectConnection.id,
    title: "ADR 001",
    content: "# Decision",
    folderPath: "adr",
  });
  assert.equal(created.noteRef.noteId, "adr/ADR 001.md");
  assert.equal(await readFile(path.join(notesRoot, "adr", "ADR 001.md"), "utf8"), "# Decision");
  assert.deepEqual(await readdir(codeRoot), []);

  const updated = await agent.updateNote({
    noteRef: created.noteRef,
    title: "ADR 001 Final",
    content: "# Final",
    folderPath: "adr/final",
  });
  assert.equal(updated.noteRef.noteId, "adr/final/ADR 001 Final.md");
  assert.equal(await readFile(path.join(notesRoot, "adr", "final", "ADR 001 Final.md"), "utf8"), "# Final");
});

test("agent sdk builds an aggregated context pack across multiple connections", async (t) => {
  const defaultVaultDir = await mkdtemp(path.join(tmpdir(), "sourcery-agent-default-"));
  const codeRoot = await mkdtemp(path.join(tmpdir(), "sourcery-agent-code-"));
  const notesRoot = await mkdtemp(path.join(tmpdir(), "sourcery-agent-notes-"));
  t.after(async () => {
    await rm(defaultVaultDir, { recursive: true, force: true });
    await rm(codeRoot, { recursive: true, force: true });
    await rm(notesRoot, { recursive: true, force: true });
  });

  const workspace = new WorkspaceSDK(
    new MarkdownVault(defaultVaultDir),
    (connectionId) => {
      if (connectionId === "project-a") {
        return new MarkdownVault(notesRoot);
      }

      return undefined;
    }
  );
  const defaultConnection = {
    id: "default",
    name: "Vault",
    kind: "vault" as const,
    rootPath: defaultVaultDir,
    notesRoot: defaultVaultDir,
    isDefault: true,
  };
  const connections = new WorkspaceConnectionsStore({ defaultConnection });
  connections.createConnection({
    id: "project-a",
    name: "Project A",
    kind: "code_repo",
    codeRoot,
    notesRoot,
  });
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
  });

  const defaultNote = await workspace.createNote({
    title: "Default ADR",
    content: "#backend [[Shared]]",
  });
  await workspace.createNote({
    title: "AGENTS",
    content: "# Agent onboarding",
  });
  const repoNote = await workspace.createNote({
    title: "Repo ADR",
    content: "#backend",
    folderPath: "adr",
  }, { connectionId: "project-a" });
  await workspace.createNote({
    title: "README",
    content: "# Project A",
  }, { connectionId: "project-a" });
  await workspace.createNote({
    title: "FRAMEWORK",
    content: "# Framework",
    folderPath: "agents_md",
  }, { connectionId: "project-a" });
  await agent.openTab({
    noteRef: {
      connectionId: "project-a",
      noteId: repoNote.id,
    },
  });

  const contextPack = await agent.getContextPack({
    query: "#backend",
    connectionIds: ["default", "project-a"],
    limit: 10,
  });

  assert.equal(contextPack.totalMatches, 2);
  assert.deepEqual(
    contextPack.bootstrapNotes.map((item) => `${item.noteRef.connectionId}:${item.noteRef.noteId}`),
    [
      "default:AGENTS.md",
      "project-a:README.md",
      "project-a:agents_md/FRAMEWORK.md",
    ]
  );
  assert.deepEqual(
    contextPack.notes.map((item) => `${item.noteRef.connectionId}:${item.noteRef.noteId}`).sort(),
    [`default:${defaultNote.id}`, `project-a:${repoNote.id}`].sort()
  );
  assert.ok(contextPack.notes.every((item) => item.connectionName));
  assert.deepEqual(
    contextPack.connections.map((item) => ({
      id: item.connection.id,
      matchCount: item.matchCount,
      openTabCount: item.session.openTabCount,
    })),
    [
      { id: "default", matchCount: 1, openTabCount: 0 },
      { id: "project-a", matchCount: 1, openTabCount: 1 },
    ]
  );
});
