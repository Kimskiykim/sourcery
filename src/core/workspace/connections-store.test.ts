import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceConnectionsStore } from "./connections-store.js";

test("connections store treats notesRoot as canonical markdown root and preserves codeRoot", async (t) => {
  const stateDir = await mkdtemp(path.join(tmpdir(), "sourcery-connections-store-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  const store = new WorkspaceConnectionsStore({
    filePath: path.join(stateDir, "connections.json"),
    defaultConnection: {
      id: "default",
      name: "Vault",
      kind: "vault",
      rootPath: "/tmp/default-vault",
      notesRoot: "/tmp/default-vault",
      isDefault: true,
    },
  });

  const created = store.createConnection({
    name: "Project A",
    kind: "code_repo",
    codeRoot: "/tmp/project-a",
    notesRoot: "/tmp/project-a-notes",
  });

  assert.equal(created.codeRoot, "/tmp/project-a");
  assert.equal(created.notesRoot, "/tmp/project-a-notes");
  assert.equal(created.rootPath, "/tmp/project-a-notes");

  const listed = store.getConnection(created.id);
  assert.equal(listed?.codeRoot, "/tmp/project-a");
  assert.equal(listed?.notesRoot, "/tmp/project-a-notes");
  assert.equal(listed?.rootPath, "/tmp/project-a-notes");
});

test("connections store falls back to codeRoot when notesRoot is omitted", async (t) => {
  const stateDir = await mkdtemp(path.join(tmpdir(), "sourcery-connections-store-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  const store = new WorkspaceConnectionsStore({
    filePath: path.join(stateDir, "connections.json"),
    defaultConnection: {
      id: "default",
      name: "Vault",
      kind: "vault",
      rootPath: "/tmp/default-vault",
      notesRoot: "/tmp/default-vault",
      isDefault: true,
    },
  });

  const created = store.createConnection({
    name: "Repo Docs",
    kind: "code_repo",
    codeRoot: "/tmp/repo-with-docs",
  });

  assert.equal(created.codeRoot, "/tmp/repo-with-docs");
  assert.equal(created.notesRoot, "/tmp/repo-with-docs");
  assert.equal(created.rootPath, "/tmp/repo-with-docs");
});

test("connections store rejects roots whose parent directory does not exist", async (t) => {
  const stateDir = await mkdtemp(path.join(tmpdir(), "sourcery-connections-store-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  const store = new WorkspaceConnectionsStore({
    filePath: path.join(stateDir, "connections.json"),
    defaultConnection: {
      id: "default",
      name: "Vault",
      kind: "vault",
      rootPath: "/tmp/default-vault",
      notesRoot: "/tmp/default-vault",
      isDefault: true,
    },
  });

  const missingNotesRoot = path.join(stateDir, "missing-parent", "notes");

  assert.throws(
    () => store.createConnection({
      name: "Broken",
      kind: "docs_folder",
      rootPath: missingNotesRoot,
    }),
    /notesRoot parent directory does not exist:/
  );
});
