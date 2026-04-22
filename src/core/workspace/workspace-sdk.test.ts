import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { MarkdownVault } from "../storage/markdown-vault.js";
import { WorkspaceSDK } from "./workspace-sdk.js";

async function createWorkspace(testContext: TestContextLike): Promise<{ workspace: WorkspaceSDK }> {
  const vaultDir = await mkdtemp(path.join(tmpdir(), "sourcery-workspace-"));
  testContext.after(async () => {
    await rm(vaultDir, { recursive: true, force: true });
  });

  return {
    workspace: new WorkspaceSDK(new MarkdownVault(vaultDir)),
  };
}

type TestContextLike = {
  after: (callback: () => Promise<void> | void) => void;
};

test("getSnapshot keeps preferred active note when it exists", async (t) => {
  const { workspace } = await createWorkspace(t);

  const first = await workspace.createNote({ title: "First", content: "" });
  const second = await workspace.createNote({ title: "Second", content: "" });

  const snapshot = await workspace.getSnapshot(first.id);

  assert.equal(snapshot.activeNoteId, first.id);
  assert.equal(snapshot.notes.length, 2);
  assert.deepEqual(
    snapshot.notes.map((note) => note.id),
    [second.id, first.id]
  );
});

test("getSnapshot falls back to the first available note when preferred note is missing", async (t) => {
  const { workspace } = await createWorkspace(t);

  const alpha = await workspace.createNote({ title: "Alpha", content: "" });
  const beta = await workspace.createNote({ title: "Beta", content: "" });

  const snapshot = await workspace.getSnapshot("Missing.md");

  assert.equal(snapshot.activeNoteId, snapshot.notes[0]?.id ?? null);
  assert.deepEqual(
    [...snapshot.notes.map((note) => note.id)].sort(),
    [alpha.id, beta.id].sort()
  );
});

test("workspace delegates create update and delete operations to storage", async (t) => {
  const { workspace } = await createWorkspace(t);

  const created = await workspace.createNote({ title: "Draft", content: "v1", folderPath: "docs" });
  const updated = await workspace.updateNote(created.id, {
    title: "Draft",
    content: "v2",
    folderPath: "archive",
  });

  assert.equal(updated.content, "v2");
  assert.equal(updated.folderPath, "archive");

  await workspace.deleteNote(updated.id);

  const snapshot = await workspace.getSnapshot();
  assert.equal(snapshot.activeNoteId, null);
  assert.deepEqual(snapshot.notes, []);
});

test("workspace lists and creates folders", async (t) => {
  const { workspace } = await createWorkspace(t);

  const folder = await workspace.createFolder({ path: "topics/llm" });
  assert.equal(folder.path, "topics/llm");

  const folders = await workspace.listFolders();
  assert.deepEqual(
    folders.map((item) => item.path),
    ["topics", "topics/llm"]
  );
});

test("workspace renames and deletes folders through storage", async (t) => {
  const { workspace } = await createWorkspace(t);

  await workspace.createFolder({ path: "topics/drafts" });
  const renamed = await workspace.renameFolder("topics/drafts", { nextPath: "topics/archive" });
  assert.equal(renamed.path, "topics/archive");

  await workspace.createFolder({ path: "scratch/empty" });
  await workspace.deleteFolder("scratch/empty");

  const folders = await workspace.listFolders();
  assert.deepEqual(
    folders.map((item) => item.path),
    ["scratch", "topics", "topics/archive"]
  );
});

test("workspace routes note and folder operations to a non-default connection", async (t) => {
  const defaultVaultDir = await mkdtemp(path.join(tmpdir(), "sourcery-workspace-default-"));
  const docsVaultDir = await mkdtemp(path.join(tmpdir(), "sourcery-workspace-docs-"));
  t.after(async () => {
    await rm(defaultVaultDir, { recursive: true, force: true });
    await rm(docsVaultDir, { recursive: true, force: true });
  });

  const workspace = new WorkspaceSDK(
    new MarkdownVault(defaultVaultDir),
    (connectionId) => {
      if (connectionId === "docs-repo") {
        return new MarkdownVault(docsVaultDir);
      }

      return undefined;
    }
  );

  await workspace.createFolder({ path: "docs/reference" }, { connectionId: "docs-repo" });
  await workspace.createNote(
    {
      title: "API",
      content: "# API",
      folderPath: "docs/reference",
    },
    { connectionId: "docs-repo" }
  );
  await workspace.createNote({ title: "Default", content: "# Default" });

  const defaultNotes = await workspace.listNotes();
  const repoNotes = await workspace.listNotes({ connectionId: "docs-repo" });
  const repoFolders = await workspace.listFolders({ connectionId: "docs-repo" });

  assert.deepEqual(defaultNotes.map((note) => note.id), ["Default.md"]);
  assert.deepEqual(repoNotes.map((note) => note.id), ["docs/reference/API.md"]);
  assert.deepEqual(repoFolders.map((folder) => folder.path), ["docs", "docs/reference"]);
});
