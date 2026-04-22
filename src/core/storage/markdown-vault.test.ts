import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { MarkdownVault, MarkdownVaultError } from "./markdown-vault.js";

async function createTestVault(testContext: TestContextLike): Promise<{ vault: MarkdownVault; vaultDir: string }> {
  const vaultDir = await mkdtemp(path.join(tmpdir(), "sourcery-vault-"));
  testContext.after(async () => {
    await rm(vaultDir, { recursive: true, force: true });
  });

  return {
    vault: new MarkdownVault(vaultDir),
    vaultDir,
  };
}

type TestContextLike = {
  after: (callback: () => Promise<void> | void) => void;
};

test("createNote persists markdown file and returns note metadata", async (t) => {
  const { vault, vaultDir } = await createTestVault(t);

  const created = await vault.createNote({
    title: "Alpha Note",
    content: "# Alpha\nBody",
    folderPath: "projects",
  });

  assert.equal(created.id, "projects/Alpha Note.md");
  assert.equal(created.title, "Alpha Note");
  assert.equal(created.folderPath, "projects");
  assert.equal(created.content, "# Alpha\nBody");

  const fileContent = await readFile(path.join(vaultDir, "projects", "Alpha Note.md"), "utf8");
  assert.equal(fileContent, "# Alpha\nBody");
});

test("createNote uses unique Untitled names for blank titles", async (t) => {
  const { vault } = await createTestVault(t);

  const first = await vault.createNote({ title: "", content: "" });
  const second = await vault.createNote({ title: "   ", content: "" });

  assert.equal(first.id, "Untitled.md");
  assert.equal(second.id, "Untitled 2.md");
});

test("createNote rejects duplicate explicit titles", async (t) => {
  const { vault } = await createTestVault(t);

  await vault.createNote({ title: "Roadmap", content: "", folderPath: "docs" });

  await assert.rejects(
    () => vault.createNote({ title: "Roadmap", content: "", folderPath: "docs" }),
    (error: unknown) =>
      error instanceof MarkdownVaultError &&
      error.statusCode === 409 &&
      error.message === "A note with this title already exists"
  );
});

test("updateNote renames file and persists new content", async (t) => {
  const { vault, vaultDir } = await createTestVault(t);

  const created = await vault.createNote({
    title: "Draft",
    content: "before",
    folderPath: "topics",
  });

  const updated = await vault.updateNote(created.id, {
    title: "Final Name",
    content: "after",
  });

  assert.equal(updated.id, "topics/Final Name.md");
  assert.equal(updated.title, "Final Name");
  assert.equal(updated.folderPath, "topics");
  assert.equal(updated.content, "after");

  const entries = await readdir(path.join(vaultDir, "topics"));
  assert.deepEqual(entries.filter((entry) => entry.endsWith(".md")).sort(), ["Final Name.md"]);

  const fileContent = await readFile(path.join(vaultDir, "topics", "Final Name.md"), "utf8");
  assert.equal(fileContent, "after");
});

test("updateNote moves note between folders and root", async (t) => {
  const { vault, vaultDir } = await createTestVault(t);

  const created = await vault.createNote({
    title: "Movable",
    content: "body",
    folderPath: "topics/drafts",
  });

  const movedToRoot = await vault.updateNote(created.id, {
    title: "Movable",
    content: "body",
    folderPath: "",
  });
  assert.equal(movedToRoot.id, "Movable.md");
  assert.equal(movedToRoot.folderPath, "");

  const movedToFolder = await vault.updateNote(movedToRoot.id, {
    title: "Movable",
    content: "body",
    folderPath: "archive/2026",
  });
  assert.equal(movedToFolder.id, "archive/2026/Movable.md");
  assert.equal(movedToFolder.folderPath, "archive/2026");

  const rootEntries = (await readdir(vaultDir)).filter((entry) => entry.endsWith(".md"));
  assert.deepEqual(rootEntries, []);

  const fileContent = await readFile(path.join(vaultDir, "archive", "2026", "Movable.md"), "utf8");
  assert.equal(fileContent, "body");
});

test("updateNote rejects rename to an existing title", async (t) => {
  const { vault } = await createTestVault(t);

  const alpha = await vault.createNote({ title: "Alpha", content: "", folderPath: "docs" });
  await vault.createNote({ title: "Beta", content: "", folderPath: "docs" });

  await assert.rejects(
    () =>
      vault.updateNote(alpha.id, {
        title: "Beta",
        content: "collision",
      }),
    (error: unknown) =>
      error instanceof MarkdownVaultError &&
      error.statusCode === 409 &&
      error.message === "A note with this title already exists"
  );
});

test("deleteNote removes file from disk", async (t) => {
  const { vault, vaultDir } = await createTestVault(t);

  const created = await vault.createNote({ title: "Disposable", content: "temp", folderPath: "scratch" });
  await vault.deleteNote(created.id);

  const entries = await readdir(path.join(vaultDir, "scratch"));
  assert.deepEqual(entries.filter((entry) => entry.endsWith(".md")), []);
});

test("ensureSeeded creates seed notes only for an empty vault", async (t) => {
  const { vault, vaultDir } = await createTestVault(t);

  await vault.ensureSeeded();
  const seededEntries = (await readdir(vaultDir)).filter((entry) => entry.endsWith(".md")).sort();
  assert.deepEqual(seededEntries, ["Ideas.md", "Welcome.md"]);

  const custom = await vault.createNote({ title: "Custom", content: "keep me" });
  const beforeUpdate = await stat(path.join(vaultDir, custom.id));
  await vault.ensureSeeded();
  const afterUpdate = await stat(path.join(vaultDir, custom.id));

  assert.equal(beforeUpdate.mtimeMs, afterUpdate.mtimeMs);
});

test("listNotes returns notes from nested folders with folderPath metadata", async (t) => {
  const { vault } = await createTestVault(t);

  await vault.createNote({ title: "Alpha", content: "", folderPath: "projects/alpha" });
  await vault.createNote({ title: "Beta", content: "", folderPath: "projects/beta" });

  const notes = await vault.listNotes();
  assert.deepEqual(
    notes.map((note) => ({ id: note.id, folderPath: note.folderPath })).sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "projects/alpha/Alpha.md", folderPath: "projects/alpha" },
      { id: "projects/beta/Beta.md", folderPath: "projects/beta" },
    ]
  );
});

test("createFolder creates nested folders and listFolders returns them", async (t) => {
  const { vault, vaultDir } = await createTestVault(t);

  const folder = await vault.createFolder({ path: "projects/client-a" });
  assert.deepEqual(folder, {
    path: "projects/client-a",
    name: "client-a",
    parentPath: "projects",
  });

  const folders = await vault.listFolders();
  assert.deepEqual(
    folders.map((item) => item.path),
    ["projects", "projects/client-a"]
  );

  const entries = await readdir(path.join(vaultDir, "projects"));
  assert.ok(entries.includes("client-a"));
});

test("renameFolder moves nested folder tree and keeps markdown files accessible", async (t) => {
  const { vault, vaultDir } = await createTestVault(t);

  await vault.createNote({ title: "Alpha", content: "body", folderPath: "projects/client-a" });

  const renamed = await vault.renameFolder("projects/client-a", { nextPath: "projects/client-b" });
  assert.deepEqual(renamed, {
    path: "projects/client-b",
    name: "client-b",
    parentPath: "projects",
  });

  const folders = await vault.listFolders();
  assert.deepEqual(
    folders.map((item) => item.path),
    ["projects", "projects/client-b"]
  );

  const notes = await vault.listNotes();
  assert.deepEqual(
    notes.map((note) => note.id),
    ["projects/client-b/Alpha.md"]
  );

  const fileContent = await readFile(path.join(vaultDir, "projects", "client-b", "Alpha.md"), "utf8");
  assert.equal(fileContent, "body");
});

test("renameFolder rejects moving folder into itself", async (t) => {
  const { vault } = await createTestVault(t);

  await vault.createFolder({ path: "projects/client-a" });

  await assert.rejects(
    () => vault.renameFolder("projects", { nextPath: "projects/archive" }),
    (error: unknown) =>
      error instanceof MarkdownVaultError &&
      error.statusCode === 400 &&
      error.message === "Cannot move a folder into itself"
  );
});

test("deleteFolder removes an empty folder and rejects non-empty folders", async (t) => {
  const { vault, vaultDir } = await createTestVault(t);

  await vault.createFolder({ path: "archive/empty" });
  await vault.createNote({ title: "Keep", content: "", folderPath: "archive/filled" });

  await vault.deleteFolder("archive/empty");

  const archiveEntries = await readdir(path.join(vaultDir, "archive"));
  assert.deepEqual(archiveEntries.sort(), ["filled"]);

  await assert.rejects(
    () => vault.deleteFolder("archive"),
    (error: unknown) =>
      error instanceof MarkdownVaultError &&
      error.statusCode === 409 &&
      error.message === "Folder is not empty"
  );
});
