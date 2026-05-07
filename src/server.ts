import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { execFile } from "node:child_process";
import { promises as fs, watch, type FSWatcher } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AgentAccessPolicy,
  AgentCreateNoteInput,
  AgentContextPackInput,
  AgentGetBacklinksInput,
  AgentGraphSummaryInput,
  AgentOpenTabInput,
  AgentReadNoteInput,
  AgentSearchNotesInput,
  AgentUpdateNoteInput,
} from "./core/agent/types.js";
import { AgentWorkspaceSDK, AGENT_NOTE_WRITE_DISABLED_ERROR } from "./core/agent/agent-sdk.js";
import { SourceryMcpServer, type JsonRpcRequest } from "./core/agent/mcp-server.js";
import {
  GraphSDK,
  WorkspaceTabsSessionStore,
} from "./core/graph/graph-sdk.js";
import { AppMemoryStore } from "./core/memory/app-memory-store.js";
import type { AppMemoryDocument, UpdateAppMemoryInput } from "./core/memory/types.js";
import type {
  ActivateWorkspaceTabInput,
  CloseWorkspaceTabInput,
  CreateWorkspaceConnectionInput,
  DeleteWorkspaceFolderByRefInput,
  DeleteWorkspaceNoteByRefInput,
  GetWorkspaceNoteByRefInput,
  OpenWorkspaceTabInput,
  RenameWorkspaceFolderByRefInput,
  ReorderWorkspaceTabsInput,
  SetWorkspaceTabPinnedInput,
  UpdateWorkspaceNoteByRefInput,
  UpdateWorkspaceConnectionInput,
  WorkspaceConnection,
  WorkspaceFolderRef,
  WorkspaceNoteRef,
} from "./core/graph/types.js";
import { MarkdownVault, MarkdownVaultError } from "./core/storage/markdown-vault.js";
import type {
  CreateFolderInput,
  CreateNoteInput,
  RenameFolderInput,
  UpdateNoteInput,
} from "./core/storage/types.js";
import { WorkspaceConnectionsStore } from "./core/workspace/connections-store.js";
import { WorkspaceRevisionTracker } from "./core/workspace/revision-tracker.js";
import { getWorkspaceConnectionNotesRoot } from "./core/workspace/session-types.js";
import { WorkspaceSDK } from "./core/workspace/workspace-sdk.js";
import { WikiSDK } from "./core/wiki/wiki-sdk.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRootDir = path.resolve(__dirname, "..");
const defaultDistDir = path.join(defaultRootDir, "dist");
const defaultVaultDir = path.join(defaultRootDir, "vault");
const defaultAppStateDir = path.join(defaultRootDir, ".obsidian-lite");
const defaultPort = Number(process.env.PORT ?? "4173");
const defaultHost = process.env.HOST?.trim() || "127.0.0.1";

export interface AppContext {
  rootDir: string;
  distDir: string;
  vaultDir: string;
  appStateDir: string;
  memory: AppMemoryStore;
  workspace: WorkspaceSDK;
  workspaceRevision: WorkspaceRevisionTracker;
  graph: GraphSDK;
  connections: WorkspaceConnectionsStore;
  tabsSession: WorkspaceTabsSessionStore;
  agentPolicy: AgentAccessPolicy;
  connectionWatcher?: WorkspaceConnectionWatcher;
  systemDirectoryPicker?: SystemDirectoryPicker;
}

export interface StartAppServerOptions {
  context?: AppContext;
  port?: number;
  host?: string;
  watchVault?: boolean;
}

type WorkspaceConnectionWatcher = {
  watchers: FSWatcher[];
  refresh: () => void;
  close: () => void;
};

type PickDirectoryOptions = {
  title?: string;
  defaultPath?: string;
};

type SystemDirectoryPicker = (options: PickDirectoryOptions) => Promise<string | null>;

type WatchFunction = (
  pathToWatch: string,
  options: { recursive?: boolean },
  listener: (eventType: string, fileName: string | Buffer | null) => void
) => FSWatcher;

export function createAppContext(overrides: Partial<AppContext> = {}): AppContext {
  const rootDir = overrides.rootDir ?? defaultRootDir;
  const distDir = overrides.distDir ?? path.join(rootDir, "dist");
  const vaultDir = overrides.vaultDir ?? path.join(rootDir, "vault");
  const appStateDir = overrides.appStateDir ?? defaultAppStateDir;
  const defaultConnection = createDefaultWorkspaceConnection(vaultDir);
  const connections = overrides.connections ?? new WorkspaceConnectionsStore({
    filePath: path.join(appStateDir, "workspace-connections.json"),
    defaultConnection,
  });

  return {
    rootDir,
    distDir,
    vaultDir,
    appStateDir,
    memory: overrides.memory ?? new AppMemoryStore(path.join(appStateDir, "memory")),
    workspace: overrides.workspace ?? new WorkspaceSDK(
      new MarkdownVault(vaultDir),
      createWorkspaceStorageResolver(connections, defaultConnection.id),
      defaultConnection.id
    ),
    workspaceRevision: overrides.workspaceRevision ?? new WorkspaceRevisionTracker(),
    graph: overrides.graph ?? new GraphSDK(new WikiSDK()),
    connections,
    tabsSession: overrides.tabsSession ?? new WorkspaceTabsSessionStore({
      stateFilePath: path.join(appStateDir, "workspace-tabs-session.json"),
      defaultConnection: connections.getDefaultConnection(),
      resolveConnection: (connectionId) => connections.getConnection(connectionId) ?? undefined,
    }),
    agentPolicy: overrides.agentPolicy ?? { allowNoteWrites: false },
    systemDirectoryPicker: overrides.systemDirectoryPicker ?? createSystemDirectoryPicker(),
  };
}

export function createAppServer(context = createAppContext()): HttpServer {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

      if (url.pathname === "/mcp") {
        await handleMcpHttp(request, response, context);
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url, context);
        return;
      }

      await serveStatic(response, url.pathname, context);
    } catch (error) {
      handleError(response, error);
    }
  });
}

export function createWorkspaceConnectionWatcher(
  context: Pick<AppContext, "connections" | "workspaceRevision">,
  createWatcher: WatchFunction = (pathToWatch, options, listener) =>
    watch(pathToWatch, options, listener)
): WorkspaceConnectionWatcher {
  const watchers: FSWatcher[] = [];
  const watcherByConnectionId = new Map<string, { rootPath: string; watcher: FSWatcher }>();

  const refresh = () => {
    const connections = context.connections.listConnections();
    const activeIds = new Set(connections.map((connection) => connection.id));

    [...watcherByConnectionId.entries()].forEach(([connectionId, entry]) => {
      const nextConnection = connections.find((connection) => connection.id === connectionId);
      if (nextConnection && getWorkspaceConnectionNotesRoot(nextConnection) === entry.rootPath) {
        return;
      }

      entry.watcher.close();
      watcherByConnectionId.delete(connectionId);
    });

    connections.forEach((connection) => {
      const notesRoot = getWorkspaceConnectionNotesRoot(connection);
      const existing = watcherByConnectionId.get(connection.id);
      if (existing && existing.rootPath === notesRoot) {
        return;
      }

      try {
        const watcher = createWatcher(notesRoot, { recursive: true }, (_eventType, fileName) => {
          if (typeof fileName !== "string") {
            return;
          }

          context.workspaceRevision.bump(connection.id);
        });

        watcher.on("error", (error) => {
          console.error(`Workspace watcher error for ${connection.id}`, error);
        });

        watcherByConnectionId.set(connection.id, {
          rootPath: notesRoot,
          watcher,
        });
      } catch (error) {
        console.error(`Failed to watch workspace connection ${connection.id}`, error);
      }
    });

    [...watcherByConnectionId.keys()].forEach((connectionId) => {
      if (activeIds.has(connectionId)) {
        return;
      }

      const entry = watcherByConnectionId.get(connectionId);
      entry?.watcher.close();
      watcherByConnectionId.delete(connectionId);
    });

    watchers.splice(
      0,
      watchers.length,
      ...Array.from(watcherByConnectionId.values(), (entry) => entry.watcher)
    );
  };

  const close = () => {
    watcherByConnectionId.forEach((entry) => {
      entry.watcher.close();
    });
    watcherByConnectionId.clear();
    watchers.splice(0, watchers.length);
  };

  return {
    watchers,
    refresh,
    close,
  };
}

export async function startAppServer(
  options: StartAppServerOptions = {}
): Promise<{ server: HttpServer; watcher: FSWatcher | null }> {
  const context = options.context ?? createAppContext();
  const port = options.port ?? defaultPort;
  const host = options.host?.trim() || defaultHost;
  const shouldWatchVault = options.watchVault ?? true;

  await context.workspace.ensureSeeded();
  context.workspaceRevision.syncConnections(context.connections.listConnections().map((connection) => connection.id));

  const server = createAppServer(context);
  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });

  const watcherManager = shouldWatchVault ? createWorkspaceConnectionWatcher(context) : null;
  watcherManager?.refresh();
  context.connectionWatcher = watcherManager ?? undefined;

  return { server, watcher: watcherManager?.watchers[0] ?? null };
}

function createDefaultWorkspaceConnection(vaultDir: string): WorkspaceConnection {
  const rootName = path.basename(vaultDir) || "Vault";
  return {
    id: "default",
    name: rootName,
    kind: "vault",
    rootPath: vaultDir,
    notesRoot: vaultDir,
    isDefault: true,
  };
}

function createWorkspaceStorageResolver(
  connections: WorkspaceConnectionsStore,
  defaultConnectionId: string
): (connectionId: string) => MarkdownVault | undefined {
  const storageByKey = new Map<string, MarkdownVault>();

  return (connectionId: string) => {
    if (connectionId === defaultConnectionId) {
      return undefined;
    }

    const connection = connections.getConnection(connectionId);
    if (!connection) {
      return undefined;
    }

    const notesRoot = getWorkspaceConnectionNotesRoot(connection);
    const cacheKey = `${connection.id}:${notesRoot}`;
    const existing = storageByKey.get(cacheKey);
    if (existing) {
      return existing;
    }

    const next = new MarkdownVault(notesRoot, {
      includeGlobs: connection.includeGlobs,
      excludeGlobs: connection.excludeGlobs,
    });
    storageByKey.set(cacheKey, next);
    return next;
  };
}

function parseWorkspaceNoteRef(value: unknown): WorkspaceNoteRef {
  if (!value || typeof value !== "object") {
    throw new MarkdownVaultError(400, "noteRef is required");
  }

  const candidate = value as Partial<WorkspaceNoteRef>;
  return {
    connectionId: readRequiredBodyString(candidate.connectionId, "noteRef.connectionId"),
    noteId: readRequiredBodyString(candidate.noteId, "noteRef.noteId"),
  };
}

function parseWorkspaceFolderRef(value: unknown): WorkspaceFolderRef {
  if (!value || typeof value !== "object") {
    throw new MarkdownVaultError(400, "folderRef is required");
  }

  const candidate = value as Partial<WorkspaceFolderRef>;
  return {
    connectionId: readRequiredBodyString(candidate.connectionId, "folderRef.connectionId"),
    folderPath: readRequiredBodyString(candidate.folderPath, "folderRef.folderPath"),
  };
}

async function loadNoteByRef(context: AppContext, noteRef: WorkspaceNoteRef) {
  const notes = await context.workspace.listNotes({ connectionId: noteRef.connectionId });
  const note = notes.find((item) => item.id === noteRef.noteId);
  if (!note) {
    throw new MarkdownVaultError(404, "Note not found");
  }

  return note;
}

export async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: AppContext
): Promise<void> {
  const queryConnectionId = readOptionalQueryString(url, "connectionId");
  context.workspaceRevision.syncConnections(context.connections.listConnections().map((connection) => connection.id));
  const agent = createAgentRuntime(context);

  if (url.pathname === "/api/workspace/state" && request.method === "GET") {
    sendJson(
      response,
      200,
      context.workspaceRevision.getState(queryConnectionId ?? context.connections.getDefaultConnection().id)
    );
    return;
  }

  if (url.pathname === "/api/memory/global" && request.method === "GET") {
    sendJson(response, 200, await context.memory.readGlobalMemory());
    return;
  }

  if (url.pathname === "/api/memory/global" && request.method === "PUT") {
    const payload = await readJsonBody<UpdateAppMemoryInput>(request);
    sendJson(response, 200, await context.memory.writeGlobalMemory(readRequiredBodyString(payload.content, "content")));
    return;
  }

  if (url.pathname === "/api/memory/global" && request.method === "DELETE") {
    await context.memory.deleteGlobalMemory();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/memory/workspace" && request.method === "GET") {
    const memory = await readWorkspaceMemoryDocument(context, queryConnectionId);
    sendJson(response, 200, memory);
    return;
  }

  if (url.pathname === "/api/memory/workspace" && request.method === "PUT") {
    const payload = await readJsonBody<UpdateAppMemoryInput>(request);
    const connection = requireWorkspaceConnection(context, queryConnectionId);
    const memory = await context.memory.writeWorkspaceMemory(
      connection.id,
      readRequiredBodyString(payload.content, "content")
    );
    sendJson(response, 200, withMemoryConnectionName(memory, connection.name));
    return;
  }

  if (url.pathname === "/api/memory/workspace" && request.method === "DELETE") {
    const connection = requireWorkspaceConnection(context, queryConnectionId);
    await context.memory.deleteWorkspaceMemory(connection.id);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/agent/capabilities" && request.method === "GET") {
    sendJson(response, 200, agent.getCapabilities());
    return;
  }

  if (url.pathname === "/api/agent/connections" && request.method === "GET") {
    sendJson(response, 200, agent.listConnections());
    return;
  }

  if (url.pathname === "/api/agent/notes" && request.method === "GET") {
    const result = await agent.searchNotes({
      connectionId: queryConnectionId,
      query: readOptionalQueryString(url, "query"),
      limit: readOptionalNumericQuery(url, "limit"),
    });
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/agent/notes/read" && request.method === "POST") {
    const payload = await readJsonBody<AgentReadNoteInput>(request);
    const result = await agent.readNote({
      noteRef: parseWorkspaceNoteRef(payload.noteRef),
    });
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/agent/notes/create" && request.method === "POST") {
    const payload = await readJsonBody<AgentCreateNoteInput>(request);
    const result = await runAgentAction(() => agent.createNote({
      connectionId: payload.connectionId,
      title: readRequiredBodyString(payload.title, "title"),
      content: readRequiredBodyString(payload.content, "content"),
      folderPath: payload.folderPath,
    }));
    context.workspaceRevision.bump(result.connection.id);
    context.connectionWatcher?.refresh();
    sendJson(response, 201, result);
    return;
  }

  if (url.pathname === "/api/agent/notes/update" && request.method === "POST") {
    const payload = await readJsonBody<AgentUpdateNoteInput>(request);
    const result = await runAgentAction(() => agent.updateNote({
      noteRef: parseWorkspaceNoteRef(payload.noteRef),
      title: readRequiredBodyString(payload.title, "title"),
      content: readRequiredBodyString(payload.content, "content"),
      folderPath: payload.folderPath,
    }));
    context.workspaceRevision.bump(result.connection.id);
    context.connectionWatcher?.refresh();
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/agent/backlinks" && request.method === "GET") {
    const noteId = readOptionalQueryString(url, "noteId");
    if (!noteId) {
      throw new MarkdownVaultError(400, "noteId is required");
    }

    const result = await agent.getBacklinks({
      noteRef: {
        connectionId: queryConnectionId ?? context.connections.getDefaultConnection().id,
        noteId,
      },
    } satisfies AgentGetBacklinksInput);
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/agent/graph/summary" && request.method === "GET") {
    const result = await agent.getGraphSummary({
      connectionId: queryConnectionId,
    } satisfies AgentGraphSummaryInput);
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/agent/session" && request.method === "GET") {
    const result = await agent.getSession(queryConnectionId);
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/agent/context" && request.method === "POST") {
    const payload = await readJsonBody<AgentContextPackInput>(request);
    const result = await agent.getContextPack({
      query: payload.query,
      connectionIds: payload.connectionIds,
      limit: payload.limit,
    });
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/agent/tabs/open" && request.method === "POST") {
    const payload = await readJsonBody<AgentOpenTabInput>(request);
    const result = await agent.openTab({
      noteRef: parseWorkspaceNoteRef(payload.noteRef),
      activate: payload.activate,
      pinned: payload.pinned,
    });
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/workspace/connections" && request.method === "GET") {
    sendJson(response, 200, context.connections.listConnections());
    return;
  }

  if (url.pathname === "/api/workspace/connections" && request.method === "POST") {
    const payload = await readJsonBody<CreateWorkspaceConnectionInput>(request);
    const connection = runWorkspaceMutation(() => context.connections.createConnection(payload));
    context.workspaceRevision.syncConnections(context.connections.listConnections().map((item) => item.id));
    context.workspaceRevision.bump(connection.id);
    context.connectionWatcher?.refresh();
    sendJson(response, 201, connection);
    return;
  }

  if (url.pathname === "/api/system/pick-directory" && request.method === "POST") {
    const payload = await readJsonBody<{ title?: unknown; defaultPath?: unknown }>(request);
    const selectedPath = await pickSystemDirectory(context, {
      title: readOptionalBodyString(payload.title, "title"),
      defaultPath: readOptionalBodyString(payload.defaultPath, "defaultPath"),
    });
    sendJson(response, 200, { path: selectedPath });
    return;
  }

  const pathConnectionId = getConnectionIdFromPath(url.pathname);
  if (pathConnectionId) {
    if (request.method === "PUT") {
      const payload = await readJsonBody<UpdateWorkspaceConnectionInput>(request);
      const connection = runWorkspaceMutation(() =>
        context.connections.updateConnection(pathConnectionId, payload)
      );
      context.workspaceRevision.syncConnections(context.connections.listConnections().map((item) => item.id));
      context.workspaceRevision.bump(connection.id);
      context.connectionWatcher?.refresh();
      sendJson(response, 200, connection);
      return;
    }

    if (request.method === "DELETE") {
      runWorkspaceMutation(() => {
        context.connections.deleteConnection(pathConnectionId);
        context.tabsSession.removeConnection(pathConnectionId);
      });
      context.workspaceRevision.forgetConnection(pathConnectionId);
      context.workspaceRevision.bump();
      context.workspaceRevision.syncConnections(context.connections.listConnections().map((item) => item.id));
      context.connectionWatcher?.refresh();
      sendJson(response, 200, { ok: true });
      return;
    }
  }

  if (url.pathname === "/api/workspace/notes/by-ref" && request.method === "POST") {
    const payload = await readJsonBody<GetWorkspaceNoteByRefInput>(request);
    const noteRef = parseWorkspaceNoteRef(payload.noteRef);
    const note = await loadNoteByRef(context, noteRef);
    sendJson(response, 200, note);
    return;
  }

  if (url.pathname === "/api/workspace/notes/update-by-ref" && request.method === "POST") {
    const payload = await readJsonBody<UpdateWorkspaceNoteByRefInput>(request);
    const noteRef = parseWorkspaceNoteRef(payload.noteRef);
    const note = await context.workspace.updateNote(
      noteRef.noteId,
      {
        title: payload.title,
        content: payload.content,
        folderPath: payload.folderPath,
      },
      { connectionId: noteRef.connectionId }
    );
    context.workspaceRevision.bump(noteRef.connectionId);
    context.connectionWatcher?.refresh();
    sendJson(response, 200, note);
    return;
  }

  if (url.pathname === "/api/workspace/notes/delete-by-ref" && request.method === "POST") {
    const payload = await readJsonBody<DeleteWorkspaceNoteByRefInput>(request);
    const noteRef = parseWorkspaceNoteRef(payload.noteRef);
    await context.workspace.deleteNote(noteRef.noteId, { connectionId: noteRef.connectionId });
    context.workspaceRevision.bump(noteRef.connectionId);
    context.connectionWatcher?.refresh();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/workspace/folders/rename-by-ref" && request.method === "POST") {
    const payload = await readJsonBody<RenameWorkspaceFolderByRefInput>(request);
    const folderRef = parseWorkspaceFolderRef(payload.folderRef);
    const folder = await context.workspace.renameFolder(
      folderRef.folderPath,
      { nextPath: readRequiredBodyString(payload.nextPath, "nextPath") },
      { connectionId: folderRef.connectionId }
    );
    context.workspaceRevision.bump(folderRef.connectionId);
    context.connectionWatcher?.refresh();
    sendJson(response, 200, folder);
    return;
  }

  if (url.pathname === "/api/workspace/folders/delete-by-ref" && request.method === "POST") {
    const payload = await readJsonBody<DeleteWorkspaceFolderByRefInput>(request);
    const folderRef = parseWorkspaceFolderRef(payload.folderRef);
    await context.workspace.deleteFolder(folderRef.folderPath, { connectionId: folderRef.connectionId });
    context.workspaceRevision.bump(folderRef.connectionId);
    context.connectionWatcher?.refresh();
    sendJson(response, 200, { ok: true });
    return;
  }

  if ((url.pathname === "/api/workspace/tabs" || url.pathname === "/api/workspace/session") && request.method === "GET") {
    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    sendJson(
      response,
      200,
      context.tabsSession.getSnapshot(notes, queryConnectionId ?? context.connections.getDefaultConnection().id)
    );
    return;
  }

  if (url.pathname === "/api/workspace/tabs/open" && request.method === "POST") {
    const payload = await readJsonBody<OpenWorkspaceTabInput>(request);
    const noteId = readRequiredBodyString(payload.noteId, "noteId");
    const effectiveConnectionId = payload.connectionId ?? queryConnectionId;
    const notes = await context.workspace.listNotes({ connectionId: effectiveConnectionId });
    const snapshot = runWorkspaceMutation(() =>
      context.tabsSession.openNote(notes, {
        noteId,
        connectionId: effectiveConnectionId,
        activate: payload.activate,
        pinned: payload.pinned,
        replaceActive: payload.replaceActive,
        forceNew: payload.forceNew,
      })
    );
    sendJson(response, 200, snapshot);
    return;
  }

  if (url.pathname === "/api/workspace/tabs/close" && request.method === "POST") {
    const payload = await readJsonBody<CloseWorkspaceTabInput>(request);
    const tabId = readRequiredBodyString(payload.tabId, "tabId");
    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    const snapshot = runWorkspaceMutation(() => context.tabsSession.closeTab(notes, { tabId }));
    sendJson(response, 200, snapshot);
    return;
  }

  if (url.pathname === "/api/workspace/tabs/pin" && request.method === "POST") {
    const payload = await readJsonBody<SetWorkspaceTabPinnedInput>(request);
    const tabId = readRequiredBodyString(payload.tabId, "tabId");
    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    const snapshot = runWorkspaceMutation(() =>
      context.tabsSession.setPinned(notes, {
        tabId,
        pinned: true,
      })
    );
    sendJson(response, 200, snapshot);
    return;
  }

  if (url.pathname === "/api/workspace/tabs/unpin" && request.method === "POST") {
    const payload = await readJsonBody<SetWorkspaceTabPinnedInput>(request);
    const tabId = readRequiredBodyString(payload.tabId, "tabId");
    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    const snapshot = runWorkspaceMutation(() =>
      context.tabsSession.setPinned(notes, {
        tabId,
        pinned: false,
      })
    );
    sendJson(response, 200, snapshot);
    return;
  }

  if (url.pathname === "/api/workspace/tabs/reorder" && request.method === "POST") {
    const payload = await readJsonBody<ReorderWorkspaceTabsInput>(request);
    if (!Array.isArray(payload.tabIds)) {
      throw new MarkdownVaultError(400, "tabIds must be an array");
    }

    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    const snapshot = runWorkspaceMutation(() =>
      context.tabsSession.reorderTabs(notes, {
        tabIds: payload.tabIds.map((tabId) => readRequiredBodyString(tabId, "tabIds")),
      })
    );
    sendJson(response, 200, snapshot);
    return;
  }

  if (url.pathname === "/api/workspace/tabs/activate" && request.method === "POST") {
    const payload = await readJsonBody<ActivateWorkspaceTabInput>(request);
    const tabId = readRequiredBodyString(payload.tabId, "tabId");
    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    const snapshot = runWorkspaceMutation(() => context.tabsSession.activateTab(notes, { tabId }));
    sendJson(response, 200, snapshot);
    return;
  }

  if (url.pathname === "/api/graph" && request.method === "GET") {
    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    const snapshot = context.graph.buildGlobalGraph(notes, {
      folderPath: readOptionalQueryString(url, "folderPath"),
      tag: readOptionalQueryString(url, "tag"),
      includeTags: readBooleanQuery(url, "includeTags", true),
      includeDangling: readBooleanQuery(url, "includeDangling", true),
      includeOrphans: readBooleanQuery(url, "includeOrphans", true),
      existingFilesOnly: readBooleanQuery(url, "existingFilesOnly", false),
    });
    sendJson(response, 200, snapshot);
    return;
  }

  if (url.pathname === "/api/graph/local" && request.method === "GET") {
    const noteId = readOptionalQueryString(url, "noteId");
    if (!noteId) {
      throw new MarkdownVaultError(400, "noteId is required");
    }

    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    const snapshot = context.graph.buildLocalGraph(notes, noteId, {
      depth: readNumericQuery(url, "depth", 1),
      includeTags: readBooleanQuery(url, "includeTags", true),
      includeDangling: readBooleanQuery(url, "includeDangling", true),
      includeOrphans: readBooleanQuery(url, "includeOrphans", true),
      existingFilesOnly: readBooleanQuery(url, "existingFilesOnly", false),
    });
    sendJson(response, 200, snapshot);
    return;
  }

  if (url.pathname === "/api/graph/orphans" && request.method === "GET") {
    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    const orphans = context.graph.getOrphans(notes, {
      folderPath: readOptionalQueryString(url, "folderPath"),
      tag: readOptionalQueryString(url, "tag"),
    });
    sendJson(response, 200, orphans);
    return;
  }

  if (url.pathname === "/api/graph/broken-links" && request.method === "GET") {
    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    const brokenLinks = context.graph.getBrokenLinks(notes, {
      folderPath: readOptionalQueryString(url, "folderPath"),
      tag: readOptionalQueryString(url, "tag"),
    });
    sendJson(response, 200, brokenLinks);
    return;
  }

  if (url.pathname === "/api/graph/neighbors" && request.method === "GET") {
    const noteId = readOptionalQueryString(url, "noteId");
    if (!noteId) {
      throw new MarkdownVaultError(400, "noteId is required");
    }

    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    const neighbors = context.graph.getNeighbors(notes, noteId, {
      folderPath: readOptionalQueryString(url, "folderPath"),
      tag: readOptionalQueryString(url, "tag"),
    });
    sendJson(response, 200, neighbors);
    return;
  }

  if (url.pathname === "/api/graph/path" && request.method === "GET") {
    const fromNoteId = readOptionalQueryString(url, "fromNoteId");
    const toNoteId = readOptionalQueryString(url, "toNoteId");
    if (!fromNoteId || !toNoteId) {
      throw new MarkdownVaultError(400, "fromNoteId and toNoteId are required");
    }

    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    const result = context.graph.getShortestPath(notes, fromNoteId, toNoteId, {
      folderPath: readOptionalQueryString(url, "folderPath"),
      tag: readOptionalQueryString(url, "tag"),
    });
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/graph/clusters" && request.method === "GET") {
    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    const clusters = context.graph.getClusters(notes, {
      folderPath: readOptionalQueryString(url, "folderPath"),
      tag: readOptionalQueryString(url, "tag"),
    });
    sendJson(response, 200, clusters);
    return;
  }

  if (url.pathname === "/api/graph/top-linked" && request.method === "GET") {
    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    const ranked = context.graph.getTopLinkedNotes(
      notes,
      {
        folderPath: readOptionalQueryString(url, "folderPath"),
        tag: readOptionalQueryString(url, "tag"),
      },
      readNumericQuery(url, "limit", 10)
    );
    sendJson(response, 200, ranked);
    return;
  }

  if (url.pathname === "/api/graph/hubs" && request.method === "GET") {
    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    const ranked = context.graph.getHubNotes(
      notes,
      {
        folderPath: readOptionalQueryString(url, "folderPath"),
        tag: readOptionalQueryString(url, "tag"),
      },
      readNumericQuery(url, "limit", 10)
    );
    sendJson(response, 200, ranked);
    return;
  }

  if (url.pathname === "/api/graph/bridges" && request.method === "GET") {
    const notes = await context.workspace.listNotes({ connectionId: queryConnectionId });
    const ranked = context.graph.getBridgeNotes(
      notes,
      {
        folderPath: readOptionalQueryString(url, "folderPath"),
        tag: readOptionalQueryString(url, "tag"),
      },
      readNumericQuery(url, "limit", 10)
    );
    sendJson(response, 200, ranked);
    return;
  }

  if (url.pathname === "/api/folders" && request.method === "GET") {
    sendJson(response, 200, await context.workspace.listFolders({ connectionId: queryConnectionId }));
    return;
  }

  if (url.pathname === "/api/folders" && request.method === "POST") {
    const payload = await readJsonBody<CreateFolderInput & { connectionId?: string }>(request);
    const folder = await context.workspace.createFolder(
      { path: payload.path },
      { connectionId: payload.connectionId ?? queryConnectionId }
    );
    context.workspaceRevision.bump(payload.connectionId ?? queryConnectionId ?? context.connections.getDefaultConnection().id);
    context.connectionWatcher?.refresh();
    sendJson(response, 201, folder);
    return;
  }

  const folderPath = getFolderPathFromPath(url.pathname);
  if (folderPath) {
    if (request.method === "PUT") {
      const payload = await readJsonBody<RenameFolderInput & { connectionId?: string }>(request);
      const folder = await context.workspace.renameFolder(
        folderPath,
        { nextPath: payload.nextPath },
        { connectionId: payload.connectionId ?? queryConnectionId }
      );
      context.workspaceRevision.bump(payload.connectionId ?? queryConnectionId ?? context.connections.getDefaultConnection().id);
      context.connectionWatcher?.refresh();
      sendJson(response, 200, folder);
      return;
    }

    if (request.method === "DELETE") {
      await context.workspace.deleteFolder(folderPath, { connectionId: queryConnectionId });
      context.workspaceRevision.bump(queryConnectionId ?? context.connections.getDefaultConnection().id);
      context.connectionWatcher?.refresh();
      sendJson(response, 200, { ok: true });
      return;
    }
  }

  if (isNotesCollectionPath(url.pathname) && request.method === "GET") {
    sendJson(response, 200, await context.workspace.listNotes({ connectionId: queryConnectionId }));
    return;
  }

  if (isNotesCollectionPath(url.pathname) && request.method === "POST") {
    const payload = await readJsonBody<CreateNoteInput & { connectionId?: string }>(request);
    const note = await context.workspace.createNote(
      {
        title: payload.title,
        content: payload.content,
        folderPath: payload.folderPath,
      },
      { connectionId: payload.connectionId ?? queryConnectionId }
    );
    context.workspaceRevision.bump(payload.connectionId ?? queryConnectionId ?? context.connections.getDefaultConnection().id);
    context.connectionWatcher?.refresh();
    sendJson(response, 201, note);
    return;
  }

  const noteId = getNoteIdFromPath(url.pathname);
  if (noteId) {
    if (request.method === "PUT") {
      const payload = await readJsonBody<UpdateNoteInput & { connectionId?: string }>(request);
      const note = await context.workspace.updateNote(
        noteId,
        {
          title: payload.title,
          content: payload.content,
          folderPath: payload.folderPath,
        },
        { connectionId: payload.connectionId ?? queryConnectionId }
      );
      context.workspaceRevision.bump(payload.connectionId ?? queryConnectionId ?? context.connections.getDefaultConnection().id);
      context.connectionWatcher?.refresh();
      sendJson(response, 200, note);
      return;
    }

    if (request.method === "DELETE") {
      await context.workspace.deleteNote(noteId, { connectionId: queryConnectionId });
      context.workspaceRevision.bump(queryConnectionId ?? context.connections.getDefaultConnection().id);
      context.connectionWatcher?.refresh();
      sendJson(response, 200, { ok: true });
      return;
    }
  }

  throw new MarkdownVaultError(404, "Not found");
}

export async function handleMcpHttp(
  request: IncomingMessage,
  response: ServerResponse,
  context: AppContext
): Promise<void> {
  if (request.method === "OPTIONS") {
    sendMcpNoContent(response);
    return;
  }

  if (request.method !== "POST") {
    sendMcpJson(response, 405, { error: "Method not allowed" });
    return;
  }

  context.workspaceRevision.syncConnections(context.connections.listConnections().map((connection) => connection.id));
  const payload = await readJsonBody<JsonRpcRequest | JsonRpcRequest[]>(request);
  const mcp = new SourceryMcpServer(createAgentRuntime(context), {
    requireInitialize: false,
  });

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      sendMcpJson(response, 400, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Invalid Request",
        },
      });
      return;
    }

    const results = await Promise.all(payload.map((message) => mcp.handleMessage(message)));
    const responses = results.filter((result): result is NonNullable<typeof result> => result !== null);
    if (responses.length === 0) {
      sendMcpNoContent(response);
      return;
    }

    sendMcpJson(response, 200, responses);
    return;
  }

  const result = await mcp.handleMessage(payload);
  if (!result) {
    sendMcpNoContent(response);
    return;
  }

  sendMcpJson(response, 200, result);
}

function createAgentRuntime(context: AppContext): AgentWorkspaceSDK {
  return new AgentWorkspaceSDK({
    workspace: context.workspace,
    wiki: new WikiSDK(),
    graph: context.graph,
    connections: context.connections,
    tabsSession: context.tabsSession,
    policy: context.agentPolicy,
  });
}

function isNotesCollectionPath(pathname: string): boolean {
  return pathname === "/api/notes" || pathname === "/api/workspace/notes";
}

function getNoteIdFromPath(pathname: string): string | null {
  const prefixes = ["/api/notes/", "/api/workspace/notes/"];

  for (const prefix of prefixes) {
    if (pathname.startsWith(prefix)) {
      return decodeURIComponent(pathname.slice(prefix.length));
    }
  }

  return null;
}

function getFolderPathFromPath(pathname: string): string | null {
  const prefix = "/api/folders/";
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  return decodeURIComponent(pathname.slice(prefix.length));
}

function getConnectionIdFromPath(pathname: string): string | null {
  const prefix = "/api/workspace/connections/";
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  return decodeURIComponent(pathname.slice(prefix.length));
}

function readOptionalQueryString(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key)?.trim();
  return value ? value : undefined;
}

function readBooleanQuery(url: URL, key: string, fallback: boolean): boolean {
  const value = url.searchParams.get(key);
  if (value === null) {
    return fallback;
  }

  return value !== "0" && value.toLowerCase() !== "false";
}

function readNumericQuery(url: URL, key: string, fallback: number): number {
  const value = url.searchParams.get(key);
  if (value === null || !value.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new MarkdownVaultError(400, `Invalid ${key}`);
  }

  return parsed;
}

function readOptionalNumericQuery(url: URL, key: string): number | undefined {
  const value = url.searchParams.get(key);
  if (value === null || !value.trim()) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new MarkdownVaultError(400, `Invalid ${key}`);
  }

  return parsed;
}

function readRequiredBodyString(value: unknown, key: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new MarkdownVaultError(400, `${key} is required`);
  }

  return value.trim();
}

function readOptionalBodyString(value: unknown, key: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readRequiredBodyString(value, key);
}

function runWorkspaceMutation<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    throw normalizeWorkspaceError(error);
  }
}

async function runAgentAction<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw normalizeWorkspaceError(error);
  }
}

function normalizeWorkspaceError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new MarkdownVaultError(500, "Internal server error");
  }

  if (error.message.startsWith("Unknown connection:")) {
    return new MarkdownVaultError(404, "Connection not found");
  }

  if (error.message.startsWith("Unknown note:")) {
    return new MarkdownVaultError(404, "Note not found");
  }

  if (error.message.startsWith("Unknown tab:")) {
    return new MarkdownVaultError(404, "Tab not found");
  }

  if (error.message === "tabIds must include every open tab exactly once") {
    return new MarkdownVaultError(400, error.message);
  }

  if (error.message === "Default connection cannot be deleted") {
    return new MarkdownVaultError(400, error.message);
  }

  if (error.message === AGENT_NOTE_WRITE_DISABLED_ERROR) {
    return new MarkdownVaultError(403, error.message);
  }

  if (error.message.endsWith("is required")) {
    return new MarkdownVaultError(400, error.message);
  }

  if (error.message === "rootPath, notesRoot, or codeRoot is required") {
    return new MarkdownVaultError(400, error.message);
  }

  if (error.message === "limit must be a positive integer") {
    return new MarkdownVaultError(400, error.message);
  }

  if (error.message === "connectionIds must be an array of strings") {
    return new MarkdownVaultError(400, error.message);
  }

  if (
    error.message.endsWith("must point to a directory")
    || error.message.endsWith("parent path is not a directory")
    || error.message.includes("parent directory does not exist:")
  ) {
    return new MarkdownVaultError(400, error.message);
  }

  if (error.message.startsWith("Connection id already exists:")
    || error.message.startsWith("Connection rootPath already exists:")) {
    return new MarkdownVaultError(409, error.message);
  }

  return error;
}

async function pickSystemDirectory(
  context: Pick<AppContext, "systemDirectoryPicker">,
  options: PickDirectoryOptions
): Promise<string | null> {
  const picker = context.systemDirectoryPicker;
  if (!picker) {
    throw new MarkdownVaultError(501, "System folder picker is not available");
  }

  try {
    return await picker(options);
  } catch (error) {
    throw normalizeSystemPickerError(error);
  }
}

async function readWorkspaceMemoryDocument(
  context: Pick<AppContext, "connections" | "memory">,
  connectionId: string | undefined
): Promise<AppMemoryDocument & { connectionName: string }> {
  const connection = requireWorkspaceConnection(context, connectionId);
  const memory = await context.memory.readWorkspaceMemory(connection.id);
  return withMemoryConnectionName(memory, connection.name);
}

function requireWorkspaceConnection(
  context: Pick<AppContext, "connections">,
  connectionId: string | undefined
): WorkspaceConnection {
  const resolvedConnectionId = connectionId ?? context.connections.getDefaultConnection().id;
  const connection = context.connections.getConnection(resolvedConnectionId);
  if (!connection) {
    throw new MarkdownVaultError(404, "Connection not found");
  }

  return connection;
}

function withMemoryConnectionName<T extends AppMemoryDocument>(
  memory: T,
  connectionName: string
): T & { connectionName: string } {
  return {
    ...memory,
    connectionName,
  };
}

function createSystemDirectoryPicker(): SystemDirectoryPicker {
  const platform = os.platform();

  if (platform === "darwin") {
    return pickDirectoryWithAppleScript;
  }

  if (platform === "win32") {
    return pickDirectoryWithPowerShell;
  }

  if (platform === "linux") {
    return pickDirectoryWithZenity;
  }

  return async () => {
    throw new Error(`System folder picker is not supported on ${platform}`);
  };
}

async function pickDirectoryWithAppleScript(options: PickDirectoryOptions): Promise<string | null> {
  const scriptLines = [
    `set chosenFolder to choose folder with prompt ${toAppleScriptString(options.title ?? "Choose workspace folder")}${buildAppleScriptDefaultLocation(options.defaultPath)}`,
    "POSIX path of chosenFolder",
  ];

  try {
    const output = await execFileText("osascript", scriptLines.flatMap((line) => ["-e", line]));
    const trimmed = output.trim();
    return trimmed ? trimmed.replace(/[\\/]+$/, "") : null;
  } catch (error) {
    if (isPickerCancellation(error)) {
      return null;
    }

    throw error;
  }
}

async function pickDirectoryWithPowerShell(options: PickDirectoryOptions): Promise<string | null> {
  const prompt = toPowerShellSingleQuoted(options.title ?? "Choose workspace folder");
  const defaultPath = options.defaultPath?.trim();
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    `$dialog.Description = '${prompt}'`,
    "$dialog.ShowNewFolderButton = $true",
    ...(defaultPath ? [`$dialog.SelectedPath = '${toPowerShellSingleQuoted(defaultPath)}'`] : []),
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  [Console]::Out.Write($dialog.SelectedPath)",
    "}",
  ].join("\n");

  const output = await execFileText("powershell", ["-NoProfile", "-Command", script]);
  const trimmed = output.trim();
  return trimmed ? trimmed.replace(/[\\/]+$/, "") : null;
}

async function pickDirectoryWithZenity(options: PickDirectoryOptions): Promise<string | null> {
  const args = [
    "--file-selection",
    "--directory",
    "--title",
    options.title?.trim() || "Choose workspace folder",
  ];

  const defaultPath = options.defaultPath?.trim();
  if (defaultPath) {
    args.push("--filename", ensureTrailingSlash(defaultPath));
  }

  try {
    const output = await execFileText("zenity", args);
    const trimmed = output.trim();
    return trimmed ? trimmed.replace(/[\\/]+$/, "") : null;
  } catch (error) {
    if (isPickerCancellation(error)) {
      return null;
    }

    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error("System folder picker requires zenity on Linux");
    }

    throw error;
  }
}

function buildAppleScriptDefaultLocation(defaultPath: string | undefined): string {
  const normalized = defaultPath?.trim();
  if (!normalized) {
    return "";
  }

  return ` default location POSIX file ${toAppleScriptString(normalized)}`;
}

function toAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function toPowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

function ensureTrailingSlash(value: string): string {
  return /[\\/]$/.test(value) ? value : `${value}/`;
}

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        if (stderr) {
          const enhancedError = error as NodeJS.ErrnoException & { stderr?: string };
          enhancedError.stderr = stderr;
        }
        reject(error);
        return;
      }

      resolve(stdout);
    });
  });
}

function isPickerCancellation(error: unknown): boolean {
  if (!isNodeError(error)) {
    return false;
  }

  const stderrValue = (error as { stderr?: unknown }).stderr;
  const stderr = typeof stderrValue === "string"
    ? stderrValue
    : "";
  return error.code === "1"
    || stderr.includes("User canceled")
    || stderr.includes("(-128)")
    || stderr.includes("execution error: User canceled");
}

function normalizeSystemPickerError(error: unknown): Error {
  if (error instanceof MarkdownVaultError) {
    return error;
  }

  if (isNodeError(error) && error.code === "ENOENT") {
    return new MarkdownVaultError(501, "System folder picker is not available on this machine");
  }

  if (error instanceof Error) {
    if (error.message.startsWith("System folder picker is not supported")) {
      return new MarkdownVaultError(501, error.message);
    }

    if (error.message === "System folder picker requires zenity on Linux") {
      return new MarkdownVaultError(501, error.message);
    }
  }

  return normalizeWorkspaceError(error);
}

async function serveStatic(
  response: ServerResponse,
  pathname: string,
  context: Pick<AppContext, "rootDir" | "distDir">
): Promise<void> {
  const target = pathname === "/"
    ? path.join(context.rootDir, "index.html")
    : pathname === "/styles.css"
      ? path.join(context.rootDir, "styles.css")
      : pathname === "/image.png"
        ? path.join(context.rootDir, "image.png")
      : pathname === "/favicon.png"
        ? path.join(context.rootDir, "favicon.png")
      : pathname.startsWith("/dist/")
        ? path.join(context.distDir, pathname.slice("/dist/".length))
        : null;

  if (!target) {
    throw new MarkdownVaultError(404, "Not found");
  }

  const content = await fs.readFile(target);
  const extension = path.extname(target);
  response.writeHead(200, {
    "Content-Type": getContentType(extension),
    "Cache-Control": "no-cache",
  });
  response.end(content);
}

function getContentType(extension: string): string {
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    default:
      return "text/plain; charset=utf-8";
  }
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new MarkdownVaultError(400, "Invalid JSON");
  }
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  response.end(JSON.stringify(payload));
}

function sendMcpJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  response.end(JSON.stringify(payload));
}

function sendMcpNoContent(response: ServerResponse): void {
  response.writeHead(204, {
    "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  response.end();
}

function handleError(response: ServerResponse, error: unknown): void {
  const normalized = normalizeWorkspaceError(error);
  if (normalized instanceof MarkdownVaultError) {
    sendJson(response, normalized.statusCode, { error: normalized.message });
    return;
  }

  if (error instanceof MarkdownVaultError) {
    sendJson(response, error.statusCode, { error: error.message });
    return;
  }

  if (isNodeError(error) && error.code === "ENOENT") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  console.error(error);
  sendJson(response, 500, { error: "Internal server error" });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

if (isMainModule()) {
  startAppServer()
    .then(({ server }) => {
      const address = server.address();
      const resolvedPort =
        typeof address === "object" && address !== null ? address.port : defaultPort;
      const resolvedHost =
        typeof address === "object" && address !== null && typeof address.address === "string"
          ? address.address
          : defaultHost;
      console.log(`Sourcery is running at http://${resolvedHost}:${resolvedPort}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return typeof entry === "string" && path.resolve(entry) === __filename;
}
