import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();

await runReadOnlySmoke();
await runWriteEnabledSmoke();

console.log("Agent MCP smoke passed");

async function runReadOnlySmoke() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sourcery-agent-smoke-read-"));
  const client = startMcpClient(tempRoot, { allowWrites: false });

  try {
    await client.initialize();
    await writeFile(path.join(tempRoot, "vault", "AGENTS.md"), "# Agent Instructions\nUse Sourcery.", "utf8");
    await writeFile(path.join(tempRoot, "vault", "README.md"), "# Project Readme", "utf8");

    const tools = await client.request("tools/list", {});
    const toolNames = tools.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes("connections.list"));
    assert.ok(toolNames.includes("notes.search"));
    assert.ok(toolNames.includes("notes.read"));
    assert.ok(toolNames.includes("context.pack"));
    assert.ok(toolNames.includes("tabs.open"));
    assert.equal(toolNames.includes("notes.create"), false);
    assert.equal(toolNames.includes("notes.update"), false);

    const connections = await client.callTool("connections.list", {});
    assert.equal(connections.defaultConnectionId, "default");
    assert.equal(connections.connections[0]?.id, "default");

    const search = await client.callTool("notes.search", {
      query: "Welcome",
      limit: 5,
    });
    assert.equal(search.connectionId, "default");
    assert.ok(search.notes.some((note) => note.noteRef.noteId === "Welcome.md"));

    const read = await client.callTool("notes.read", {
      noteRef: {
        connectionId: "default",
        noteId: "Welcome.md",
      },
    });
    assert.equal(read.note.title, "Welcome");
    assert.ok(read.metadata.links.some((link) => link.link === "Ideas"));

    const contextPack = await client.callTool("context.pack", {
      query: "Welcome",
      limit: 5,
    });
    assert.equal(contextPack.connections[0]?.connection.id, "default");
    assert.ok(contextPack.totalMatches >= 1);
    assert.ok(contextPack.bootstrapNotes.some((note) => note.noteRef.noteId === "AGENTS.md"));
    assert.ok(contextPack.bootstrapNotes.some((note) => note.noteRef.noteId === "README.md"));
    assert.ok(contextPack.notes.some((note) => note.noteRef.noteId === "Welcome.md"));

    const opened = await client.callTool("tabs.open", {
      noteRef: {
        connectionId: "default",
        noteId: "Welcome.md",
      },
    });
    assert.equal(opened.session.activeNoteId, "Welcome.md");

    const session = await client.callTool("session.get", {});
    assert.equal(session.session.activeNoteId, "Welcome.md");

    const graph = await client.callTool("graph.summary", {});
    assert.ok(graph.stats.noteCount >= 2);

    const resources = await client.request("resources/list", {});
    assert.ok(resources.resources.some((resource) => resource.uri === "sourcery://context/overview"));

    const overview = await client.request("resources/read", {
      uri: "sourcery://context/overview",
    });
    assert.match(overview.contents[0]?.text ?? "", /Welcome\.md/);

    const prompts = await client.request("prompts/list", {});
    assert.ok(prompts.prompts.some((prompt) => prompt.name === "project-context-bootstrap"));

    const blockedCreate = await client.callToolRaw("notes.create", {
      title: "Blocked",
      content: "# Blocked",
    });
    assert.equal(blockedCreate.isError, true);
    assert.match(blockedCreate.content[0]?.text ?? "", /disabled by policy/i);
  } finally {
    await client.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function runWriteEnabledSmoke() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sourcery-agent-smoke-write-"));
  const client = startMcpClient(tempRoot, { allowWrites: true });

  try {
    await client.initialize();

    const tools = await client.request("tools/list", {});
    const toolNames = tools.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes("notes.create"));
    assert.ok(toolNames.includes("notes.update"));

    const created = await client.callTool("notes.create", {
      title: "Agent Smoke",
      content: "# Agent Smoke\n#agent",
      folderPath: "agent",
    });
    assert.equal(created.noteRef.noteId, "agent/Agent Smoke.md");

    const vaultDir = path.join(tempRoot, "vault");
    assert.equal(
      await readFile(path.join(vaultDir, "agent", "Agent Smoke.md"), "utf8"),
      "# Agent Smoke\n#agent"
    );

    const updated = await client.callTool("notes.update", {
      noteRef: created.noteRef,
      title: "Agent Smoke Final",
      content: "# Agent Smoke Final\n#agent",
      folderPath: "agent/final",
    });
    assert.equal(updated.noteRef.noteId, "agent/final/Agent Smoke Final.md");
    assert.equal(
      await readFile(path.join(vaultDir, "agent", "final", "Agent Smoke Final.md"), "utf8"),
      "# Agent Smoke Final\n#agent"
    );

    const contextPack = await client.callTool("context.pack", {
      query: "#agent",
      limit: 10,
    });
    assert.ok(contextPack.notes.some((note) => note.noteRef.noteId === updated.noteRef.noteId));
  } finally {
    await client.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function startMcpClient(tempRoot, options) {
  const child = spawn(process.execPath, ["dist/mcp.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      SOURCERY_ROOT_DIR: rootDir,
      SOURCERY_VAULT_DIR: path.join(tempRoot, "vault"),
      SOURCERY_APP_STATE_DIR: path.join(tempRoot, ".obsidian-lite"),
      SOURCERY_AGENT_ALLOW_NOTE_WRITES: options.allowWrites ? "1" : "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pending = new Map();
  let nextId = 1;
  let stdoutBuffer = Buffer.alloc(0);
  let stderrText = "";

  child.stdout.on("data", (chunk) => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
    const messages = drainMcpMessages();
    messages.forEach((message) => {
      const resolver = pending.get(message.id);
      if (!resolver) {
        return;
      }

      pending.delete(message.id);
      if (message.error) {
        resolver.reject(new Error(message.error.message));
        return;
      }

      resolver.resolve(message.result);
    });
  });

  child.stderr.on("data", (chunk) => {
    stderrText += chunk.toString();
  });

  child.on("exit", (code, signal) => {
    const error = new Error(`MCP process exited with code ${code ?? "null"} signal ${signal ?? "null"}\n${stderrText}`);
    pending.forEach((resolver) => resolver.reject(error));
    pending.clear();
  });

  return {
    initialize() {
      return this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "sourcery-agent-smoke",
          version: "0.0.0",
        },
      });
    },
    request(method, params) {
      const id = nextId;
      nextId += 1;
      const payload = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };
      const body = JSON.stringify(payload);
      const framed = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;

      const promise = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      child.stdin.write(framed);
      return promise;
    },
    async callTool(name, args) {
      const result = await this.callToolRaw(name, args);
      assert.equal(result.isError, undefined, result.content?.[0]?.text ?? `${name} failed`);
      return result.structuredContent;
    },
    callToolRaw(name, args) {
      return this.request("tools/call", {
        name,
        arguments: args,
      });
    },
    async close() {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    },
  };

  function drainMcpMessages() {
    const messages = [];

    while (true) {
      const headerEnd = stdoutBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return messages;
      }

      const headerText = stdoutBuffer.subarray(0, headerEnd).toString("utf8");
      const contentLength = readContentLength(headerText);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (stdoutBuffer.length < bodyEnd) {
        return messages;
      }

      messages.push(JSON.parse(stdoutBuffer.subarray(bodyStart, bodyEnd).toString("utf8")));
      stdoutBuffer = stdoutBuffer.subarray(bodyEnd);
    }
  }
}

function readContentLength(headerText) {
  const line = headerText
    .split("\r\n")
    .find((item) => item.toLowerCase().startsWith("content-length:"));
  if (!line) {
    throw new Error(`Missing Content-Length header: ${headerText}`);
  }

  const value = Number(line.slice(line.indexOf(":") + 1).trim());
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid Content-Length header: ${line}`);
  }

  return value;
}
