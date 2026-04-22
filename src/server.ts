import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { promises as fs, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GraphSDK,
  WorkspaceTabsSessionStore,
} from "./core/graph/graph-sdk.js";
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
import { WorkspaceSDK } from "./core/workspace/workspace-sdk.js";
import { WikiSDK } from "./core/wiki/wiki-sdk.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRootDir = path.resolve(__dirname, "..");
const defaultDistDir = path.join(defaultRootDir, "dist");
const defaultVaultDir = path.join(defaultRootDir, "vault");
const defaultAppStateDir = path.join(defaultRootDir, ".obsidian-lite");
const defaultPort = Number(process.env.PORT ?? "4173");

export interface AppContext {
  rootDir: string;
  distDir: string;
  vaultDir: string;
  appStateDir: string;
  workspace: WorkspaceSDK;
  workspaceRevision: WorkspaceRevisionTracker;
  graph: GraphSDK;
  connections: WorkspaceConnectionsStore;
  tabsSession: WorkspaceTabsSessionStore;
  connectionWatcher?: WorkspaceConnectionWatcher;
}

export interface StartAppServerOptions {
  context?: AppContext;
  port?: number;
  watchVault?: boolean;
}

type WorkspaceConnectionWatcher = {
  watchers: FSWatcher[];
  refresh: () => void;
  close: () => void;
};

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
  };
}

export function createAppServer(context = createAppContext()): HttpServer {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

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

function createWorkspaceConnectionWatcher(
  context: Pick<AppContext, "connections" | "workspaceRevision">
): WorkspaceConnectionWatcher {
  const watchers: FSWatcher[] = [];
  const watcherByConnectionId = new Map<string, { rootPath: string; watcher: FSWatcher }>();

  const refresh = () => {
    const connections = context.connections.listConnections();
    const activeIds = new Set(connections.map((connection) => connection.id));

    [...watcherByConnectionId.entries()].forEach(([connectionId, entry]) => {
      const nextConnection = connections.find((connection) => connection.id === connectionId);
      if (nextConnection && nextConnection.rootPath === entry.rootPath) {
        return;
      }

      entry.watcher.close();
      watcherByConnectionId.delete(connectionId);
    });

    connections.forEach((connection) => {
      const existing = watcherByConnectionId.get(connection.id);
      if (existing && existing.rootPath === connection.rootPath) {
        return;
      }

      try {
        const watcher = watch(connection.rootPath, (_eventType, fileName) => {
          if (typeof fileName !== "string") {
            return;
          }

          context.workspaceRevision.bump(connection.id);
        });

        watcher.on("error", (error) => {
          console.error(`Workspace watcher error for ${connection.id}`, error);
        });

        watcherByConnectionId.set(connection.id, {
          rootPath: connection.rootPath,
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
  const shouldWatchVault = options.watchVault ?? true;

  await context.workspace.ensureSeeded();
  context.workspaceRevision.syncConnections(context.connections.listConnections().map((connection) => connection.id));

  const server = createAppServer(context);
  await new Promise<void>((resolve) => {
    server.listen(port, resolve);
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

    const cacheKey = `${connection.id}:${connection.rootPath}`;
    const existing = storageByKey.get(cacheKey);
    if (existing) {
      return existing;
    }

    const next = new MarkdownVault(connection.rootPath);
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

  if (url.pathname === "/api/workspace/state" && request.method === "GET") {
    sendJson(
      response,
      200,
      context.workspaceRevision.getState(queryConnectionId ?? context.connections.getDefaultConnection().id)
    );
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
    sendJson(response, 200, note);
    return;
  }

  if (url.pathname === "/api/workspace/notes/delete-by-ref" && request.method === "POST") {
    const payload = await readJsonBody<DeleteWorkspaceNoteByRefInput>(request);
    const noteRef = parseWorkspaceNoteRef(payload.noteRef);
    await context.workspace.deleteNote(noteRef.noteId, { connectionId: noteRef.connectionId });
    context.workspaceRevision.bump(noteRef.connectionId);
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
    sendJson(response, 200, folder);
    return;
  }

  if (url.pathname === "/api/workspace/folders/delete-by-ref" && request.method === "POST") {
    const payload = await readJsonBody<DeleteWorkspaceFolderByRefInput>(request);
    const folderRef = parseWorkspaceFolderRef(payload.folderRef);
    await context.workspace.deleteFolder(folderRef.folderPath, { connectionId: folderRef.connectionId });
    context.workspaceRevision.bump(folderRef.connectionId);
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
      sendJson(response, 200, folder);
      return;
    }

    if (request.method === "DELETE") {
      await context.workspace.deleteFolder(folderPath, { connectionId: queryConnectionId });
      context.workspaceRevision.bump(queryConnectionId ?? context.connections.getDefaultConnection().id);
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
      sendJson(response, 200, note);
      return;
    }

    if (request.method === "DELETE") {
      await context.workspace.deleteNote(noteId, { connectionId: queryConnectionId });
      context.workspaceRevision.bump(queryConnectionId ?? context.connections.getDefaultConnection().id);
      sendJson(response, 200, { ok: true });
      return;
    }
  }

  throw new MarkdownVaultError(404, "Not found");
}

function isNotesCollectionPath(pathname: string): boolean {
  return pathname === "/api/notes" || pathname === "/api/workspace/notes";
}

class WorkspaceConnectionWatchManager {
  readonly watchers: FSWatcher[] = [];
  private readonly watcherByConnectionId = new Map<string, { rootPath: string; watcher: FSWatcher }>();

  constructor(private readonly context: Pick<AppContext, "connections" | "workspaceRevision">) {}

  refresh(): void {
    const connections = this.context.connections.listConnections();
    const activeIds = new Set(connections.map((connection) => connection.id));

    [...this.watcherByConnectionId.entries()].forEach(([connectionId, entry]) => {
      const nextConnection = connections.find((connection) => connection.id === connectionId);
      if (nextConnection && nextConnection.rootPath === entry.rootPath) {
        return;
      }

      entry.watcher.close();
      this.watcherByConnectionId.delete(connectionId);
    });

    connections.forEach((connection) => {
      const existing = this.watcherByConnectionId.get(connection.id);
      if (existing && existing.rootPath === connection.rootPath) {
        return;
      }

      try {
        const watcher = watch(connection.rootPath, (_eventType, fileName) => {
          if (typeof fileName !== "string") {
            return;
          }

          this.context.workspaceRevision.bump(connection.id);
        });
        watcher.on("error", (error) => {
          console.error(`Workspace watcher error for ${connection.id}`, error);
        });
        this.watcherByConnectionId.set(connection.id, {
          rootPath: connection.rootPath,
          watcher,
        });
      } catch (error) {
        console.error(`Failed to watch workspace connection ${connection.id}`, error);
      }
    });

    this.watchers.splice(
      0,
      this.watchers.length,
      ...[...this.watcherByConnectionId.values()].map((entry) => entry.watcher)
    );

    [...this.watcherByConnectionId.keys()].forEach((connectionId) => {
      if (!activeIds.has(connectionId)) {
        const entry = this.watcherByConnectionId.get(connectionId);
        entry?.watcher.close();
        this.watcherByConnectionId.delete(connectionId);
      }
    });
  }

  close(): void {
    this.watcherByConnectionId.forEach((entry) => {
      entry.watcher.close();
    });
    this.watcherByConnectionId.clear();
    this.watchers.splice(0, this.watchers.length);
  }
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

function readRequiredBodyString(value: unknown, key: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new MarkdownVaultError(400, `${key} is required`);
  }

  return value.trim();
}

function readWorkspaceNoteRef(value: unknown): WorkspaceNoteRef {
  if (!value || typeof value !== "object") {
    throw new MarkdownVaultError(400, "noteRef is required");
  }

  const candidate = value as Partial<WorkspaceNoteRef>;
  return {
    connectionId: readRequiredBodyString(candidate.connectionId, "noteRef.connectionId"),
    noteId: readRequiredBodyString(candidate.noteId, "noteRef.noteId"),
  };
}

function readWorkspaceFolderRef(value: unknown): WorkspaceFolderRef {
  if (!value || typeof value !== "object") {
    throw new MarkdownVaultError(400, "folderRef is required");
  }

  const candidate = value as Partial<WorkspaceFolderRef>;
  return {
    connectionId: readRequiredBodyString(candidate.connectionId, "folderRef.connectionId"),
    folderPath: readRequiredBodyString(candidate.folderPath, "folderRef.folderPath"),
  };
}

async function getNoteByRef(context: AppContext, noteRef: WorkspaceNoteRef) {
  const notes = await context.workspace.listNotes({ connectionId: noteRef.connectionId });
  const note = notes.find((item) => item.id === noteRef.noteId);
  if (!note) {
    throw new MarkdownVaultError(404, "Note not found");
  }

  return note;
}

function runWorkspaceMutation<T>(action: () => T): T {
  try {
    return action();
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

  if (error.message.endsWith("is required")) {
    return new MarkdownVaultError(400, error.message);
  }

  if (error.message.startsWith("Connection id already exists:")
    || error.message.startsWith("Connection rootPath already exists:")) {
    return new MarkdownVaultError(409, error.message);
  }

  return error;
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

function handleError(response: ServerResponse, error: unknown): void {
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
      console.log(`Sourcery is running at http://127.0.0.1:${resolvedPort}`);
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
