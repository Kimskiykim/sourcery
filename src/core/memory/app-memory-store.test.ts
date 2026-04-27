import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { AppMemoryStore } from "./app-memory-store.js";

test("app memory store returns empty documents before anything is saved", async (t) => {
  const memoryDir = await mkdtemp(path.join(tmpdir(), "sourcery-memory-"));
  t.after(async () => {
    await rm(memoryDir, { recursive: true, force: true });
  });

  const store = new AppMemoryStore(memoryDir);

  const globalMemory = await store.readGlobalMemory();
  const workspaceMemory = await store.readWorkspaceMemory("default");

  assert.deepEqual(globalMemory, {
    scope: "global",
    connectionId: null,
    content: "",
    exists: false,
    createdAt: null,
    updatedAt: null,
  });
  assert.deepEqual(workspaceMemory, {
    scope: "workspace",
    connectionId: "default",
    content: "",
    exists: false,
    createdAt: null,
    updatedAt: null,
  });
});

test("app memory store persists global memory atomically", async (t) => {
  const memoryDir = await mkdtemp(path.join(tmpdir(), "sourcery-memory-"));
  t.after(async () => {
    await rm(memoryDir, { recursive: true, force: true });
  });

  const store = new AppMemoryStore(memoryDir);
  const saved = await store.writeGlobalMemory("# Preferences\nUse concise answers.");

  assert.equal(saved.scope, "global");
  assert.equal(saved.connectionId, null);
  assert.equal(saved.exists, true);
  assert.match(saved.createdAt ?? "", /\d{4}-\d{2}-\d{2}T/);
  assert.match(saved.updatedAt ?? "", /\d{4}-\d{2}-\d{2}T/);

  const fileContent = await readFile(path.join(memoryDir, "global.md"), "utf8");
  assert.equal(fileContent, "# Preferences\nUse concise answers.");

  const entries = await readdir(memoryDir);
  assert.deepEqual(entries, ["global.md"]);
});

test("app memory store keeps workspace documents isolated per connection", async (t) => {
  const memoryDir = await mkdtemp(path.join(tmpdir(), "sourcery-memory-"));
  t.after(async () => {
    await rm(memoryDir, { recursive: true, force: true });
  });

  const store = new AppMemoryStore(memoryDir);

  await store.writeWorkspaceMemory("default", "Default workspace memory");
  await store.writeWorkspaceMemory("repo-docs", "Repo docs memory");

  const defaultMemory = await store.readWorkspaceMemory("default");
  const repoMemory = await store.readWorkspaceMemory("repo-docs");

  assert.equal(defaultMemory.content, "Default workspace memory");
  assert.equal(repoMemory.content, "Repo docs memory");
  assert.equal(defaultMemory.exists, true);
  assert.equal(repoMemory.exists, true);
});

test("app memory store delete clears persisted documents without failing on missing files", async (t) => {
  const memoryDir = await mkdtemp(path.join(tmpdir(), "sourcery-memory-"));
  t.after(async () => {
    await rm(memoryDir, { recursive: true, force: true });
  });

  const store = new AppMemoryStore(memoryDir);
  await store.writeGlobalMemory("Keep this short");
  await store.writeWorkspaceMemory("default", "Workspace context");

  await store.deleteGlobalMemory();
  await store.deleteWorkspaceMemory("default");
  await store.deleteWorkspaceMemory("default");

  const globalMemory = await store.readGlobalMemory();
  const workspaceMemory = await store.readWorkspaceMemory("default");

  assert.equal(globalMemory.exists, false);
  assert.equal(globalMemory.content, "");
  assert.equal(workspaceMemory.exists, false);
  assert.equal(workspaceMemory.content, "");
});

test("app memory store validates workspace ids", async (t) => {
  const memoryDir = await mkdtemp(path.join(tmpdir(), "sourcery-memory-"));
  t.after(async () => {
    await rm(memoryDir, { recursive: true, force: true });
  });

  const store = new AppMemoryStore(memoryDir);

  await assert.rejects(
    () => store.readWorkspaceMemory(" "),
    /connectionId is required/
  );
});
