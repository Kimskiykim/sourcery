import assert from "node:assert/strict";
import * as nodeFs from "node:fs/promises";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { WorkspaceTabsSessionSnapshot } from "./core/graph/types.js";
import { MarkdownVaultError } from "./core/storage/markdown-vault.js";
import { WorkspaceSDK } from "./core/workspace/workspace-sdk.js";
import { createAppContext, createWorkspaceConnectionWatcher, handleApi, type AppContext } from "./server.js";

type TestContextLike = {
  after: (callback: () => Promise<void> | void) => void;
};

type MockResponse = {
  statusCode: number;
  headers: Record<string, string>;
  payload: string;
};

async function createTestContext(testContext: TestContextLike): Promise<{
  context: AppContext;
  workspace: WorkspaceSDK;
}> {
  return createTestContextWithOverrides(testContext, {});
}

async function createTestContextWithOverrides(
  testContext: TestContextLike,
  overrides: Partial<AppContext>
): Promise<{
  context: AppContext;
  workspace: WorkspaceSDK;
}> {
  const vaultDir = await mkdtemp(path.join(tmpdir(), "sourcery-server-"));
  const appStateDir = await mkdtemp(path.join(tmpdir(), "sourcery-app-state-"));

  testContext.after(async () => {
    await rm(appStateDir, { recursive: true, force: true });
    await rm(vaultDir, { recursive: true, force: true });
  });

  const context = createAppContext({
    ...overrides,
    vaultDir,
    appStateDir,
  });

  return {
    context,
    workspace: context.workspace,
  };
}

async function callApi(
  context: AppContext,
  pathname: string,
  options: {
    method?: string;
    body?: unknown;
  } = {}
): Promise<MockResponse> {
  const body = options.body === undefined ? "" : JSON.stringify(options.body);
  const request = {
    method: options.method ?? "GET",
    headers: {
      host: "127.0.0.1",
    },
    async *[Symbol.asyncIterator]() {
      if (body) {
        yield Buffer.from(body, "utf8");
      }
    },
  } as AsyncIterable<Buffer> & {
    method: string;
    headers: Record<string, string>;
  };

  let statusCode = 200;
  let payload = "";
  const headers: Record<string, string> = {};
  const response = {
    writeHead(nextStatusCode: number, nextHeaders: Record<string, string>) {
      statusCode = nextStatusCode;
      Object.assign(headers, nextHeaders);
      return this;
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        payload += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      }
    },
  } as {
    writeHead: (statusCode: number, headers: Record<string, string>) => unknown;
    end: (chunk?: string | Buffer) => void;
  };

  try {
    await handleApi(
      request as never,
      response as never,
      new URL(pathname, "http://127.0.0.1"),
      context
    );
  } catch (error) {
    if (error instanceof MarkdownVaultError) {
      statusCode = error.statusCode;
      payload = JSON.stringify({ error: error.message });
    } else {
      throw error;
    }
  }

  return {
    statusCode,
    headers,
    payload,
  };
}

function readJson<T>(response: MockResponse): T {
  return JSON.parse(response.payload) as T;
}

test("workspace tabs endpoints expose session snapshot and tab mutations", async (t) => {
  const { context, workspace } = await createTestContext(t);
  const alpha = await workspace.createNote({ title: "Alpha", content: "" });
  const beta = await workspace.createNote({ title: "Beta", content: "" });
  const gamma = await workspace.createNote({ title: "Gamma", content: "", folderPath: "docs" });

  const emptySnapshot = readJson<WorkspaceTabsSessionSnapshot>(
    await callApi(context, "/api/workspace/tabs")
  );
  assert.deepEqual(emptySnapshot, {
    tabs: [],
    activeTabId: null,
    activeNoteId: null,
    activeConnectionId: null,
    updatedAt: emptySnapshot.updatedAt,
  });

  await callApi(context, "/api/workspace/tabs/open", {
    method: "POST",
    body: { noteId: alpha.id },
  });
  await callApi(context, "/api/workspace/tabs/open", {
    method: "POST",
    body: { noteId: beta.id },
  });
  await callApi(context, "/api/workspace/tabs/open", {
    method: "POST",
    body: { noteId: gamma.id },
  });

  const pinned = readJson<WorkspaceTabsSessionSnapshot>(
    await callApi(context, "/api/workspace/tabs/pin", {
      method: "POST",
      body: { tabId: alpha.id },
    })
  );
  assert.equal(pinned.tabs.find((tab) => tab.id === alpha.id)?.pinned, true);

  const unpinned = readJson<WorkspaceTabsSessionSnapshot>(
    await callApi(context, "/api/workspace/tabs/unpin", {
      method: "POST",
      body: { tabId: alpha.id },
    })
  );
  assert.equal(unpinned.tabs.find((tab) => tab.id === alpha.id)?.pinned, false);

  const reordered = readJson<WorkspaceTabsSessionSnapshot>(
    await callApi(context, "/api/workspace/tabs/reorder", {
      method: "POST",
      body: { tabIds: [gamma.id, alpha.id, beta.id] },
    })
  );
  assert.deepEqual(
    reordered.tabs.map((tab) => tab.id),
    [gamma.id, alpha.id, beta.id]
  );

  const activated = readJson<WorkspaceTabsSessionSnapshot>(
    await callApi(context, "/api/workspace/tabs/activate", {
      method: "POST",
      body: { tabId: alpha.id },
    })
  );
  assert.equal(activated.activeTabId, alpha.id);
  assert.equal(activated.activeNoteId, alpha.id);
  assert.equal(activated.activeConnectionId, "default");

  const closed = readJson<WorkspaceTabsSessionSnapshot>(
    await callApi(context, "/api/workspace/tabs/close", {
      method: "POST",
      body: { tabId: alpha.id },
    })
  );
  assert.deepEqual(
    closed.tabs.map((tab) => tab.id),
    [gamma.id, beta.id]
  );
  assert.equal(closed.activeTabId, beta.id);
  assert.equal(closed.activeNoteId, beta.id);

  const aliasedSnapshot = readJson<WorkspaceTabsSessionSnapshot>(
    await callApi(context, "/api/workspace/session")
  );
  assert.deepEqual(aliasedSnapshot, {
    tabs: [
      {
        id: gamma.id,
        noteId: gamma.id,
        title: "Gamma",
        folderPath: "docs",
        pinned: false,
        connectionId: "default",
        connectionName: path.basename(context.vaultDir),
      },
      {
        id: beta.id,
        noteId: beta.id,
        title: "Beta",
        folderPath: "",
        pinned: false,
        connectionId: "default",
        connectionName: path.basename(context.vaultDir),
      },
    ],
    activeTabId: beta.id,
    activeNoteId: beta.id,
    activeConnectionId: "default",
    updatedAt: aliasedSnapshot.updatedAt,
  });
});

test("workspace tabs endpoints validate missing notes and invalid reorder payloads", async (t) => {
  const { context, workspace } = await createTestContext(t);
  const alpha = await workspace.createNote({ title: "Alpha", content: "" });

  const openMissing = await callApi(context, "/api/workspace/tabs/open", {
    method: "POST",
    body: { noteId: "missing/Note.md" },
  });
  assert.equal(openMissing.statusCode, 404);
  assert.deepEqual(readJson(openMissing), { error: "Note not found" });

  await callApi(context, "/api/workspace/tabs/open", {
    method: "POST",
    body: { noteId: alpha.id },
  });

  const invalidReorder = await callApi(context, "/api/workspace/tabs/reorder", {
    method: "POST",
    body: { tabIds: [] },
  });
  assert.equal(invalidReorder.statusCode, 400);
  assert.deepEqual(
    readJson(invalidReorder),
    { error: "tabIds must include every open tab exactly once" }
  );
});

test("app memory endpoints persist global and workspace memory outside the vault", async (t) => {
  const { context } = await createTestContext(t);

  const initialGlobal = readJson<{
    scope: string;
    exists: boolean;
    content: string;
  }>(await callApi(context, "/api/memory/global"));
  assert.equal(initialGlobal.scope, "global");
  assert.equal(initialGlobal.exists, false);
  assert.equal(initialGlobal.content, "");

  const savedGlobal = readJson<{ exists: boolean; content: string }>(
    await callApi(context, "/api/memory/global", {
      method: "PUT",
      body: {
        content: "# Global Memory\n- Prefer concise summaries",
      },
    })
  );
  assert.equal(savedGlobal.exists, true);
  assert.equal(savedGlobal.content, "# Global Memory\n- Prefer concise summaries");

  const globalFileContent = await readFile(path.join(context.appStateDir, "memory", "global.md"), "utf8");
  assert.equal(globalFileContent, "# Global Memory\n- Prefer concise summaries");

  const createdConnection = readJson<{ id: string; name: string }>(
    await callApi(context, "/api/workspace/connections", {
      method: "POST",
      body: {
        name: "Repo Docs",
        kind: "repo_docs",
        rootPath: path.join(context.appStateDir, "repo-docs"),
      },
    })
  );

  const savedWorkspace = readJson<{
    scope: string;
    connectionId: string;
    connectionName: string;
    exists: boolean;
    content: string;
  }>(
    await callApi(context, `/api/memory/workspace?connectionId=${encodeURIComponent(createdConnection.id)}`, {
      method: "PUT",
      body: {
        content: "# Repo Memory\nKeep deployment notes here.",
      },
    })
  );
  assert.equal(savedWorkspace.scope, "workspace");
  assert.equal(savedWorkspace.connectionId, createdConnection.id);
  assert.equal(savedWorkspace.connectionName, createdConnection.name);
  assert.equal(savedWorkspace.exists, true);
  assert.equal(savedWorkspace.content, "# Repo Memory\nKeep deployment notes here.");

  const workspaceRead = readJson<{ connectionId: string; connectionName: string; content: string }>(
    await callApi(context, `/api/memory/workspace?connectionId=${encodeURIComponent(createdConnection.id)}`)
  );
  assert.equal(workspaceRead.connectionId, createdConnection.id);
  assert.equal(workspaceRead.connectionName, createdConnection.name);
  assert.equal(workspaceRead.content, "# Repo Memory\nKeep deployment notes here.");

  const defaultWorkspace = readJson<{ connectionId: string; connectionName: string; exists: boolean; content: string }>(
    await callApi(context, "/api/memory/workspace")
  );
  assert.equal(defaultWorkspace.connectionId, "default");
  assert.equal(defaultWorkspace.connectionName, path.basename(context.vaultDir));
  assert.equal(defaultWorkspace.exists, false);
  assert.equal(defaultWorkspace.content, "");
});

test("app memory endpoints clear documents and validate workspace connection ids", async (t) => {
  const { context } = await createTestContext(t);

  await callApi(context, "/api/memory/global", {
    method: "PUT",
    body: {
      content: "Temporary global memory",
    },
  });

  const deletedGlobal = await callApi(context, "/api/memory/global", {
    method: "DELETE",
  });
  assert.equal(deletedGlobal.statusCode, 200);
  assert.deepEqual(readJson(deletedGlobal), { ok: true });

  const afterDeleteGlobal = readJson<{ exists: boolean; content: string }>(await callApi(context, "/api/memory/global"));
  assert.equal(afterDeleteGlobal.exists, false);
  assert.equal(afterDeleteGlobal.content, "");

  const missingConnection = await callApi(context, "/api/memory/workspace?connectionId=missing", {
    method: "GET",
  });
  assert.equal(missingConnection.statusCode, 404);
  assert.deepEqual(readJson(missingConnection), { error: "Connection not found" });
});

test("workspace tabs close returns an empty session after the last tab is closed", async (t) => {
  const { context, workspace } = await createTestContext(t);
  const alpha = await workspace.createNote({ title: "Alpha", content: "" });

  await callApi(context, "/api/workspace/tabs/open", {
    method: "POST",
    body: { noteId: alpha.id },
  });

  const closed = readJson<WorkspaceTabsSessionSnapshot>(
    await callApi(context, "/api/workspace/tabs/close", {
      method: "POST",
      body: { tabId: alpha.id },
    })
  );

  assert.deepEqual(closed, {
    tabs: [],
    activeTabId: null,
    activeNoteId: null,
    activeConnectionId: null,
    updatedAt: closed.updatedAt,
  });
});

test("workspace connections endpoints manage desktop connection registry", async (t) => {
  const { context } = await createTestContext(t);

  const initialConnections = readJson<Array<{ id: string; rootPath: string; notesRoot?: string; isDefault?: boolean }>>(
    await callApi(context, "/api/workspace/connections")
  );
  assert.equal(initialConnections.length, 1);
  assert.equal(initialConnections[0]?.id, "default");
  assert.equal(initialConnections[0]?.isDefault, true);
  assert.equal(initialConnections[0]?.notesRoot, context.vaultDir);

  const created = readJson<{ id: string; name: string; rootPath: string; notesRoot?: string; codeRoot?: string }>(
    await callApi(context, "/api/workspace/connections", {
      method: "POST",
      body: {
        name: "Docs Repo",
        kind: "repo_docs",
        rootPath: "/tmp/docs-repo",
        includeGlobs: ["docs/**/*.md"],
      },
    })
  );
  assert.equal(created.id, "docs-repo");
  assert.equal(created.notesRoot, "/tmp/docs-repo");
  assert.equal(created.codeRoot, undefined);

  const updated = readJson<{ name: string; rootPath: string; notesRoot?: string }>(
    await callApi(context, `/api/workspace/connections/${created.id}`, {
      method: "PUT",
      body: {
        name: "Docs Repo Renamed",
        rootPath: "/tmp/docs-repo-renamed",
      },
    })
  );
  assert.equal(updated.name, "Docs Repo Renamed");
  assert.equal(updated.rootPath, "/tmp/docs-repo-renamed");
  assert.equal(updated.notesRoot, "/tmp/docs-repo-renamed");

  const deleted = await callApi(context, `/api/workspace/connections/${created.id}`, {
    method: "DELETE",
  });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(readJson(deleted), { ok: true });

  const deleteDefault = await callApi(context, "/api/workspace/connections/default", {
    method: "DELETE",
  });
  assert.equal(deleteDefault.statusCode, 400);
  assert.deepEqual(readJson(deleteDefault), { error: "Default connection cannot be deleted" });
});

test("workspace connections support separate codeRoot and notesRoot without writing into the code repo", async (t) => {
  const { context } = await createTestContext(t);
  const codeRoot = await mkdtemp(path.join(tmpdir(), "sourcery-code-root-"));
  const notesRoot = await mkdtemp(path.join(tmpdir(), "sourcery-notes-root-"));
  t.after(async () => {
    await rm(codeRoot, { recursive: true, force: true });
    await rm(notesRoot, { recursive: true, force: true });
  });

  const created = readJson<{
    id: string;
    kind: string;
    rootPath: string;
    codeRoot?: string;
    notesRoot?: string;
  }>(await callApi(context, "/api/workspace/connections", {
    method: "POST",
    body: {
      name: "Project A",
      kind: "code_repo",
      codeRoot,
      notesRoot,
    },
  }));

  assert.equal(created.kind, "code_repo");
  assert.equal(created.codeRoot, codeRoot);
  assert.equal(created.notesRoot, notesRoot);
  assert.equal(created.rootPath, notesRoot);

  const createdNote = readJson<{ id: string }>(await callApi(context, "/api/notes", {
    method: "POST",
    body: {
      title: "ADR 001",
      content: "# ADR",
      folderPath: "adr",
      connectionId: created.id,
    },
  }));
  assert.equal(createdNote.id, "adr/ADR 001.md");

  assert.deepEqual(await readdir(codeRoot), []);
  assert.equal(await readFile(path.join(notesRoot, "adr", "ADR 001.md"), "utf8"), "# ADR");

  const notes = readJson<Array<{ id: string }>>(
    await callApi(context, `/api/notes?connectionId=${encodeURIComponent(created.id)}`)
  );
  assert.deepEqual(notes.map((note) => note.id), ["adr/ADR 001.md"]);
});

test("workspace connection notes routes respect default and custom exclude globs", async (t) => {
  const { context } = await createTestContext(t);
  const notesRoot = await mkdtemp(path.join(tmpdir(), "sourcery-ignore-notes-root-"));
  t.after(async () => {
    await rm(notesRoot, { recursive: true, force: true });
  });

  await nodeFs.mkdir(path.join(notesRoot, "__pycache__"), { recursive: true });
  await nodeFs.mkdir(path.join(notesRoot, "docs", "drafts"), { recursive: true });
  await nodeFs.mkdir(path.join(notesRoot, "docs", "published"), { recursive: true });
  await nodeFs.writeFile(path.join(notesRoot, "__pycache__", "Ignored.md"), "ignored", "utf8");
  await nodeFs.writeFile(path.join(notesRoot, "docs", "drafts", "Skip.md"), "skip", "utf8");
  await nodeFs.writeFile(path.join(notesRoot, "docs", "published", "Keep.md"), "keep", "utf8");

  const created = readJson<{ id: string }>(await callApi(context, "/api/workspace/connections", {
    method: "POST",
    body: {
      name: "Filtered Docs",
      kind: "docs_folder",
      rootPath: notesRoot,
      excludeGlobs: ["**/drafts/**"],
    },
  }));

  const notes = readJson<Array<{ id: string }>>(
    await callApi(context, `/api/notes?connectionId=${encodeURIComponent(created.id)}`)
  );
  const folders = readJson<Array<{ path: string }>>(
    await callApi(context, `/api/folders?connectionId=${encodeURIComponent(created.id)}`)
  );

  assert.deepEqual(notes.map((note) => note.id), ["docs/published/Keep.md"]);
  assert.deepEqual(folders.map((folder) => folder.path), ["docs", "docs/published"]);
});

test("workspace connections endpoint rejects roots whose parent directory is missing", async (t) => {
  const { context } = await createTestContext(t);
  const missingRoot = path.join(context.appStateDir, "missing-parent", "notes");

  const response = await callApi(context, "/api/workspace/connections", {
    method: "POST",
    body: {
      name: "Broken",
      kind: "docs_folder",
      rootPath: missingRoot,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(readJson(response), {
    error: `notesRoot parent directory does not exist: ${path.dirname(missingRoot)}`,
  });
});

test("workspace connections can point at a notes root that will be created later", async (t) => {
  const { context } = await createTestContext(t);
  const futureNotesRoot = path.join(context.appStateDir, "future-notes-root");

  const created = readJson<{ id: string }>(await callApi(context, "/api/workspace/connections", {
    method: "POST",
    body: {
      name: "Future Notes",
      kind: "docs_folder",
      rootPath: futureNotesRoot,
    },
  }));

  const notes = readJson<Array<{ id: string }>>(
    await callApi(context, `/api/notes?connectionId=${encodeURIComponent(created.id)}`)
  );
  const folders = readJson<Array<{ path: string }>>(
    await callApi(context, `/api/folders?connectionId=${encodeURIComponent(created.id)}`)
  );

  assert.deepEqual(notes, []);
  assert.deepEqual(folders, []);
});

test("system folder picker endpoint returns selected path or null on cancel", async (t) => {
  const { context } = await createTestContext(t);
  const selectedPath = path.join(context.appStateDir, "picked-folder");
  const calls: Array<{ title?: string; defaultPath?: string }> = [];

  context.systemDirectoryPicker = async (options) => {
    calls.push(options);
    return calls.length === 1 ? selectedPath : null;
  };

  const picked = readJson<{ path: string | null }>(await callApi(context, "/api/system/pick-directory", {
    method: "POST",
    body: {
      title: "Choose docs root",
      defaultPath: context.appStateDir,
    },
  }));
  assert.equal(picked.path, selectedPath);
  assert.deepEqual(calls[0], {
    title: "Choose docs root",
    defaultPath: context.appStateDir,
  });

  const cancelled = readJson<{ path: string | null }>(await callApi(context, "/api/system/pick-directory", {
    method: "POST",
    body: {},
  }));
  assert.equal(cancelled.path, null);
});

test("system folder picker endpoint returns 501 when picker is unavailable", async (t) => {
  const { context } = await createTestContext(t);
  context.systemDirectoryPicker = undefined;

  const response = await callApi(context, "/api/system/pick-directory", {
    method: "POST",
    body: {},
  });

  assert.equal(response.statusCode, 501);
  assert.deepEqual(readJson(response), {
    error: "System folder picker is not available",
  });
});

test("workspace connection watcher watches notesRoot recursively", async (t) => {
  const { context } = await createTestContext(t);
  const codeRoot = await mkdtemp(path.join(tmpdir(), "sourcery-watch-code-root-"));
  const notesRoot = await mkdtemp(path.join(tmpdir(), "sourcery-watch-notes-root-"));
  t.after(async () => {
    await rm(codeRoot, { recursive: true, force: true });
    await rm(notesRoot, { recursive: true, force: true });
  });

  context.connections.createConnection({
    name: "Project Watch",
    kind: "code_repo",
    codeRoot,
    notesRoot,
  });

  const watched: Array<{ targetPath: string; recursive: boolean | undefined }> = [];
  const fakeWatcher = {
    close() {},
    on() {
      return this;
    },
  };
  const watcher = createWorkspaceConnectionWatcher(
    {
      connections: context.connections,
      workspaceRevision: context.workspaceRevision,
    },
    ((targetPath: string, options: { recursive?: boolean }) => {
      watched.push({
        targetPath,
        recursive: options.recursive,
      });
      return fakeWatcher as never;
    }) as never
  );

  watcher.refresh();
  watcher.close();

  assert.deepEqual(
    watched.map((entry) => entry.targetPath).sort(),
    [context.vaultDir, notesRoot].sort()
  );
  assert.ok(watched.every((entry) => entry.recursive === true));
});

test("agent endpoints expose capabilities search read backlinks graph and tab workflows", async (t) => {
  const { context, workspace } = await createTestContext(t);
  const alpha = await workspace.createNote({
    title: "Alpha",
    content: "# Alpha",
  });
  const beta = await workspace.createNote({
    title: "Beta",
    content: "See [[Alpha]] and #backend",
    folderPath: "docs",
  });

  const capabilities = readJson<{
    apiVersion: string;
    defaultConnectionId: string;
    tools: Array<{ name: string }>;
  }>(await callApi(context, "/api/agent/capabilities"));
  assert.equal(capabilities.apiVersion, "v0");
  assert.equal(capabilities.defaultConnectionId, "default");
  assert.ok(capabilities.tools.some((tool) => tool.name === "notes.search"));
  assert.ok(!capabilities.tools.some((tool) => tool.name === "notes.create"));
  assert.ok(!capabilities.tools.some((tool) => tool.name === "notes.update"));

  const search = readJson<{
    connectionId: string;
    query: string;
    total: number;
    notes: Array<{ noteRef: { noteId: string }; tags: string[] }>;
  }>(await callApi(context, `/api/agent/notes?query=${encodeURIComponent("#backend")}`));
  assert.equal(search.connectionId, "default");
  assert.equal(search.total, 1);
  assert.deepEqual(search.notes.map((note) => note.noteRef.noteId), [beta.id]);
  assert.deepEqual(search.notes[0]?.tags, ["backend"]);

  const read = readJson<{
    noteRef: { connectionId: string; noteId: string };
    metadata: { backlinks: string[] };
    connection: { id: string };
  }>(await callApi(context, "/api/agent/notes/read", {
    method: "POST",
    body: {
      noteRef: {
        connectionId: "default",
        noteId: alpha.id,
      },
    },
  }));
  assert.equal(read.connection.id, "default");
  assert.equal(read.noteRef.noteId, alpha.id);
  assert.deepEqual(read.metadata.backlinks, [beta.id]);

  const backlinks = readJson<{
    backlinks: Array<{ noteRef: { noteId: string } }>;
  }>(await callApi(context, `/api/agent/backlinks?connectionId=default&noteId=${encodeURIComponent(alpha.id)}`));
  assert.deepEqual(backlinks.backlinks.map((item) => item.noteRef.noteId), [beta.id]);

  const graphSummary = readJson<{
    connection: { id: string };
    stats: { noteCount: number };
  }>(await callApi(context, "/api/agent/graph/summary"));
  assert.equal(graphSummary.connection.id, "default");
  assert.equal(graphSummary.stats.noteCount, 2);

  const opened = readJson<{
    session: { activeTabId: string | null; activeConnectionId?: string | null };
  }>(await callApi(context, "/api/agent/tabs/open", {
    method: "POST",
    body: {
      noteRef: {
        connectionId: "default",
        noteId: alpha.id,
      },
    },
  }));
  assert.equal(opened.session.activeTabId, alpha.id);
  assert.equal(opened.session.activeConnectionId, "default");

  const session = readJson<{
    connection: { id: string };
    session: { activeNoteId: string | null };
  }>(await callApi(context, "/api/agent/session"));
  assert.equal(session.connection.id, "default");
  assert.equal(session.session.activeNoteId, alpha.id);

  const forbiddenCreate = await callApi(context, "/api/agent/notes/create", {
    method: "POST",
    body: {
      connectionId: "default",
      title: "Blocked",
      content: "# blocked",
    },
  });
  assert.equal(forbiddenCreate.statusCode, 403);
  assert.deepEqual(readJson(forbiddenCreate), {
    error: "Agent note writes are disabled by policy",
  });

  const forbiddenUpdate = await callApi(context, "/api/agent/notes/update", {
    method: "POST",
    body: {
      noteRef: {
        connectionId: "default",
        noteId: alpha.id,
      },
      title: "Alpha updated",
      content: "# Alpha updated",
    },
  });
  assert.equal(forbiddenUpdate.statusCode, 403);
  assert.deepEqual(readJson(forbiddenUpdate), {
    error: "Agent note writes are disabled by policy",
  });
});

test("agent endpoints create and update notes inside a connection notesRoot", async (t) => {
  const { context } = await createTestContextWithOverrides(t, {
    agentPolicy: { allowNoteWrites: true },
  });
  const codeRoot = await mkdtemp(path.join(tmpdir(), "sourcery-agent-code-root-"));
  const notesRoot = await mkdtemp(path.join(tmpdir(), "sourcery-agent-notes-root-"));
  t.after(async () => {
    await rm(codeRoot, { recursive: true, force: true });
    await rm(notesRoot, { recursive: true, force: true });
  });

  const connection = readJson<{ id: string }>(await callApi(context, "/api/workspace/connections", {
    method: "POST",
    body: {
      name: "Project B",
      kind: "code_repo",
      codeRoot,
      notesRoot,
    },
  }));

  const created = readJson<{
    noteRef: { connectionId: string; noteId: string };
  }>(await callApi(context, "/api/agent/notes/create", {
    method: "POST",
    body: {
      connectionId: connection.id,
      title: "ADR 002",
      content: "# Draft",
      folderPath: "adr",
    },
  }));
  assert.equal(created.noteRef.connectionId, connection.id);
  assert.equal(created.noteRef.noteId, "adr/ADR 002.md");
  assert.equal(await readFile(path.join(notesRoot, "adr", "ADR 002.md"), "utf8"), "# Draft");
  assert.deepEqual(await readdir(codeRoot), []);

  const updated = readJson<{
    noteRef: { noteId: string };
  }>(await callApi(context, "/api/agent/notes/update", {
    method: "POST",
    body: {
      noteRef: created.noteRef,
      title: "ADR 002 Final",
      content: "# Final",
      folderPath: "adr/final",
    },
  }));
  assert.equal(updated.noteRef.noteId, "adr/final/ADR 002 Final.md");
  assert.equal(await readFile(path.join(notesRoot, "adr", "final", "ADR 002 Final.md"), "utf8"), "# Final");
});

test("agent context endpoint returns aggregated cross-connection context", async (t) => {
  const { context, workspace } = await createTestContext(t);
  const codeRoot = await mkdtemp(path.join(tmpdir(), "sourcery-context-code-root-"));
  const notesRoot = await mkdtemp(path.join(tmpdir(), "sourcery-context-notes-root-"));
  t.after(async () => {
    await rm(codeRoot, { recursive: true, force: true });
    await rm(notesRoot, { recursive: true, force: true });
  });

  const connection = readJson<{ id: string }>(await callApi(context, "/api/workspace/connections", {
    method: "POST",
    body: {
      name: "Project C",
      kind: "code_repo",
      codeRoot,
      notesRoot,
    },
  }));

  const defaultNote = await workspace.createNote({
    title: "Default Backend",
    content: "#backend",
  });
  const repoNote = await context.workspace.createNote({
    title: "Repo Backend",
    content: "#backend",
    folderPath: "docs",
  }, { connectionId: connection.id });
  await callApi(context, "/api/agent/tabs/open", {
    method: "POST",
    body: {
      noteRef: {
        connectionId: connection.id,
        noteId: repoNote.id,
      },
    },
  });

  const contextPack = readJson<{
    query: string;
    totalMatches: number;
    connections: Array<{
      connection: { id: string };
      matchCount: number;
      session: { openTabCount: number };
    }>;
    notes: Array<{ noteRef: { connectionId: string; noteId: string }; connectionName?: string }>;
  }>(await callApi(context, "/api/agent/context", {
    method: "POST",
    body: {
      query: "#backend",
      connectionIds: ["default", connection.id],
      limit: 10,
    },
  }));

  assert.equal(contextPack.query, "#backend");
  assert.equal(contextPack.totalMatches, 2);
  assert.deepEqual(
    contextPack.notes.map((item) => `${item.noteRef.connectionId}:${item.noteRef.noteId}`).sort(),
    [`default:${defaultNote.id}`, `${connection.id}:${repoNote.id}`].sort()
  );
  assert.ok(contextPack.notes.every((item) => item.connectionName));
  assert.deepEqual(
    contextPack.connections.map((item) => ({
      id: item.connection.id,
      matchCount: item.matchCount,
      openTabCount: item.session.openTabCount,
    })),
    [
      { id: connection.id, matchCount: 1, openTabCount: 1 },
      { id: "default", matchCount: 1, openTabCount: 0 },
    ].sort((left, right) => left.id.localeCompare(right.id, "en"))
  );
});

test("notes and folders routes support connectionId for non-default markdown roots", async (t) => {
  const { context } = await createTestContext(t);
  const repoRootPath = path.join(tmpdir(), `repo-docs-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const createdConnection = readJson<{ id: string }>(
    await callApi(context, "/api/workspace/connections", {
      method: "POST",
      body: {
        name: "Repo Docs",
        kind: "repo_docs",
        rootPath: repoRootPath,
      },
    })
  );
  t.after(async () => {
    await rm(repoRootPath, { recursive: true, force: true });
  });

  const createdFolder = readJson<{ path: string }>(
    await callApi(context, "/api/folders", {
      method: "POST",
      body: {
        path: "docs/guides",
        connectionId: createdConnection.id,
      },
    })
  );
  assert.equal(createdFolder.path, "docs/guides");

  const createdNote = readJson<{ id: string; folderPath: string }>(
    await callApi(context, "/api/notes", {
      method: "POST",
      body: {
        title: "Getting Started",
        content: "# Start",
        folderPath: "docs/guides",
        connectionId: createdConnection.id,
      },
    })
  );
  assert.equal(createdNote.id, "docs/guides/Getting Started.md");
  assert.equal(createdNote.folderPath, "docs/guides");

  const repoNotes = readJson<Array<{ id: string }>>(
    await callApi(context, `/api/notes?connectionId=${encodeURIComponent(createdConnection.id)}`)
  );
  const repoFolders = readJson<Array<{ path: string }>>(
    await callApi(context, `/api/folders?connectionId=${encodeURIComponent(createdConnection.id)}`)
  );
  await callApi(context, "/api/workspace/tabs/open", {
    method: "POST",
    body: {
      noteId: createdNote.id,
      connectionId: createdConnection.id,
    },
  });
  const repoTabs = readJson<WorkspaceTabsSessionSnapshot>(
    await callApi(context, `/api/workspace/tabs?connectionId=${encodeURIComponent(createdConnection.id)}`)
  );
  const defaultNotes = readJson<Array<{ id: string }>>(await callApi(context, "/api/notes"));

  assert.deepEqual(repoNotes.map((note) => note.id), ["docs/guides/Getting Started.md"]);
  assert.deepEqual(repoFolders.map((folder) => folder.path), ["docs", "docs/guides"]);
  assert.deepEqual(repoTabs.tabs.map((tab) => ({
    id: tab.id,
    noteId: tab.noteId,
    connectionId: tab.connectionId,
  })), [
    {
      id: `${createdConnection.id}:docs/guides/Getting Started.md`,
      noteId: "docs/guides/Getting Started.md",
      connectionId: createdConnection.id,
    },
  ]);
  assert.equal(repoTabs.activeConnectionId, createdConnection.id);
  assert.deepEqual(defaultNotes, []);
});

test("workspace ref endpoints resolve mutate and delete notes and folders by ref", async (t) => {
  const { context } = await createTestContext(t);
  const repoRootPath = path.join(tmpdir(), `repo-ref-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  t.after(async () => {
    await rm(repoRootPath, { recursive: true, force: true });
  });

  const connection = readJson<{ id: string }>(
    await callApi(context, "/api/workspace/connections", {
      method: "POST",
      body: {
        name: "Ref Repo",
        kind: "repo_docs",
        rootPath: repoRootPath,
      },
    })
  );

  await callApi(context, "/api/folders", {
    method: "POST",
    body: {
      path: "guides/drafts",
      connectionId: connection.id,
    },
  });
  await callApi(context, "/api/notes", {
    method: "POST",
    body: {
      title: "Guide",
      content: "# Draft",
      folderPath: "guides/drafts",
      connectionId: connection.id,
    },
  });

  const resolved = readJson<{ id: string; folderPath: string; content: string }>(
    await callApi(context, "/api/workspace/notes/by-ref", {
      method: "POST",
      body: {
        noteRef: {
          connectionId: connection.id,
          noteId: "guides/drafts/Guide.md",
        },
      },
    })
  );
  assert.equal(resolved.id, "guides/drafts/Guide.md");
  assert.equal(resolved.content, "# Draft");

  const updated = readJson<{ id: string; folderPath: string; content: string }>(
    await callApi(context, "/api/workspace/notes/update-by-ref", {
      method: "POST",
      body: {
        noteRef: {
          connectionId: connection.id,
          noteId: "guides/drafts/Guide.md",
        },
        title: "Guide Final",
        content: "# Final",
        folderPath: "guides/final",
      },
    })
  );
  assert.equal(updated.id, "guides/final/Guide Final.md");
  assert.equal(updated.folderPath, "guides/final");

  const renamedFolder = readJson<{ path: string }>(
    await callApi(context, "/api/workspace/folders/rename-by-ref", {
      method: "POST",
      body: {
        folderRef: {
          connectionId: connection.id,
          folderPath: "guides/final",
        },
        nextPath: "guides/published",
      },
    })
  );
  assert.equal(renamedFolder.path, "guides/published");

  const deletedNote = await callApi(context, "/api/workspace/notes/delete-by-ref", {
    method: "POST",
    body: {
      noteRef: {
        connectionId: connection.id,
        noteId: "guides/published/Guide Final.md",
      },
    },
  });
  assert.equal(deletedNote.statusCode, 200);

  const deletedFolder = await callApi(context, "/api/workspace/folders/delete-by-ref", {
    method: "POST",
    body: {
      folderRef: {
        connectionId: connection.id,
        folderPath: "guides/published",
      },
    },
  });
  assert.equal(deletedFolder.statusCode, 200);

  const state = readJson<{
    revision: number;
    activeConnectionId: string | null;
    connections?: Array<{ connectionId: string; revision: number }>;
  }>(await callApi(context, `/api/workspace/state?connectionId=${encodeURIComponent(connection.id)}`));
  assert.equal(state.activeConnectionId, connection.id);
  assert.ok((state.connections ?? []).some((item) => item.connectionId === connection.id && item.revision >= 2));
});
