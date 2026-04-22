import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { WorkspaceTabsSessionSnapshot } from "./core/graph/types.js";
import { MarkdownVaultError } from "./core/storage/markdown-vault.js";
import { WorkspaceSDK } from "./core/workspace/workspace-sdk.js";
import { createAppContext, handleApi, type AppContext } from "./server.js";

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
  const vaultDir = await mkdtemp(path.join(tmpdir(), "sourcery-server-"));
  const appStateDir = await mkdtemp(path.join(tmpdir(), "sourcery-app-state-"));

  testContext.after(async () => {
    await rm(appStateDir, { recursive: true, force: true });
    await rm(vaultDir, { recursive: true, force: true });
  });

  const context = createAppContext({
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

  const initialConnections = readJson<Array<{ id: string; rootPath: string; isDefault?: boolean }>>(
    await callApi(context, "/api/workspace/connections")
  );
  assert.equal(initialConnections.length, 1);
  assert.equal(initialConnections[0]?.id, "default");
  assert.equal(initialConnections[0]?.isDefault, true);

  const created = readJson<{ id: string; name: string; rootPath: string }>(
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

  const updated = readJson<{ name: string; rootPath: string }>(
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
