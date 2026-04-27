import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  CreateWorkspaceConnectionInput,
  UpdateWorkspaceConnectionInput,
  WorkspaceConnection,
} from "./session-types.js";
import { getWorkspaceConnectionNotesRoot } from "./session-types.js";

interface PersistedConnectionsState {
  connections: WorkspaceConnection[];
}

type WorkspaceConnectionsStoreOptions = {
  filePath?: string;
  defaultConnection: WorkspaceConnection;
};

export class WorkspaceConnectionsStore {
  private state: PersistedConnectionsState;

  constructor(private readonly options: WorkspaceConnectionsStoreOptions) {
    this.state = this.loadState();
  }

  listConnections(): WorkspaceConnection[] {
    return this.state.connections.map(cloneConnection);
  }

  getConnection(connectionId: string): WorkspaceConnection | null {
    const connection = this.state.connections.find((item) => item.id === connectionId);
    return connection ? cloneConnection(connection) : null;
  }

  getDefaultConnection(): WorkspaceConnection {
    return cloneConnection(
      this.state.connections.find((connection) => connection.isDefault) ?? this.options.defaultConnection
    );
  }

  createConnection(input: CreateWorkspaceConnectionInput): WorkspaceConnection {
    const name = readRequiredTrimmedString(input.name, "name");
    const connectionId = normalizeConnectionId(input.id ?? name);
    const roots = resolveConnectionRoots(input);
    validateConnectionRoots(roots);

    if (this.state.connections.some((connection) => connection.id === connectionId)) {
      throw new Error(`Connection id already exists: ${connectionId}`);
    }

    if (this.state.connections.some((connection) => getWorkspaceConnectionNotesRoot(connection) === roots.notesRoot)) {
      throw new Error(`Connection rootPath already exists: ${roots.notesRoot}`);
    }

    const connection: WorkspaceConnection = {
      id: connectionId,
      name,
      kind: input.kind,
      rootPath: roots.notesRoot,
      notesRoot: roots.notesRoot,
      codeRoot: roots.codeRoot,
      isDefault: input.isDefault === true,
      includeGlobs: cloneStringList(input.includeGlobs),
      excludeGlobs: cloneStringList(input.excludeGlobs),
    };

    if (connection.isDefault) {
      this.state.connections = this.state.connections.map((item) => ({
        ...item,
        isDefault: false,
      }));
    }

    this.state.connections.push(connection);
    this.persist();
    return cloneConnection(connection);
  }

  updateConnection(connectionId: string, input: UpdateWorkspaceConnectionInput): WorkspaceConnection {
    const index = this.state.connections.findIndex((connection) => connection.id === connectionId);
    if (index === -1) {
      throw new Error(`Unknown connection: ${connectionId}`);
    }

    const previous = this.state.connections[index];
    const nextName = input.name === undefined ? previous.name : readRequiredTrimmedString(input.name, "name");
    const roots = resolveConnectionRoots(input, previous);
    validateConnectionRoots(roots);

    const duplicatePath = this.state.connections.find((connection) =>
      connection.id !== connectionId && getWorkspaceConnectionNotesRoot(connection) === roots.notesRoot
    );
    if (duplicatePath) {
      throw new Error(`Connection rootPath already exists: ${roots.notesRoot}`);
    }

    if (input.isDefault === true) {
      this.state.connections = this.state.connections.map((connection) => ({
        ...connection,
        isDefault: false,
      }));
    }

    const updated: WorkspaceConnection = {
      ...previous,
      name: nextName,
      kind: input.kind ?? previous.kind,
      rootPath: roots.notesRoot,
      notesRoot: roots.notesRoot,
      codeRoot: roots.codeRoot,
      isDefault: input.isDefault ?? previous.isDefault,
      includeGlobs: input.includeGlobs === undefined ? cloneStringList(previous.includeGlobs) : cloneStringList(input.includeGlobs),
      excludeGlobs: input.excludeGlobs === undefined ? cloneStringList(previous.excludeGlobs) : cloneStringList(input.excludeGlobs),
    };

    this.state.connections[index] = updated;
    this.persist();
    return cloneConnection(updated);
  }

  deleteConnection(connectionId: string): void {
    const connection = this.getConnection(connectionId);
    if (!connection) {
      throw new Error(`Unknown connection: ${connectionId}`);
    }

    if (connection.isDefault) {
      throw new Error("Default connection cannot be deleted");
    }

    this.state.connections = this.state.connections.filter((item) => item.id !== connectionId);
    this.persist();
  }

  private loadState(): PersistedConnectionsState {
    const filePath = this.options.filePath;
    if (!filePath || !existsSync(filePath)) {
      return this.createInitialState();
    }

    try {
      const payload = JSON.parse(readFileSync(filePath, "utf8")) as Partial<PersistedConnectionsState>;
      const connections = Array.isArray(payload.connections)
        ? payload.connections.filter(isWorkspaceConnection)
        : [];
      return normalizeConnectionsState(connections, this.options.defaultConnection);
    } catch {
      return this.createInitialState();
    }
  }

  private createInitialState(): PersistedConnectionsState {
    const state = normalizeConnectionsState([], this.options.defaultConnection);
    this.state = state;
    this.persist();
    return state;
  }

  private persist(): void {
    const filePath = this.options.filePath;
    if (!filePath) {
      return;
    }

    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(this.state, null, 2), "utf8");
  }
}

function normalizeConnectionsState(
  connections: WorkspaceConnection[],
  defaultConnection: WorkspaceConnection
): PersistedConnectionsState {
  const deduped = new Map<string, WorkspaceConnection>();
  connections.forEach((connection) => {
    const notesRoot = getWorkspaceConnectionNotesRoot(connection);
    deduped.set(connection.id, {
      ...connection,
      rootPath: notesRoot,
      notesRoot,
      codeRoot: cloneOptionalString(connection.codeRoot),
      includeGlobs: cloneStringList(connection.includeGlobs),
      excludeGlobs: cloneStringList(connection.excludeGlobs),
      isDefault: connection.id === defaultConnection.id ? true : connection.isDefault === true,
    });
  });

  const defaultNotesRoot = getWorkspaceConnectionNotesRoot(defaultConnection);
  deduped.set(defaultConnection.id, {
    ...defaultConnection,
    rootPath: defaultNotesRoot,
    notesRoot: defaultNotesRoot,
    codeRoot: cloneOptionalString(defaultConnection.codeRoot),
    isDefault: true,
    includeGlobs: cloneStringList(defaultConnection.includeGlobs),
    excludeGlobs: cloneStringList(defaultConnection.excludeGlobs),
  });

  const normalized = [...deduped.values()];
  const activeDefault = normalized.find((connection) => connection.isDefault)?.id ?? defaultConnection.id;

  return {
    connections: normalized.map((connection) => ({
      ...connection,
      notesRoot: getWorkspaceConnectionNotesRoot(connection),
      isDefault: connection.id === activeDefault,
    })),
  };
}

function cloneConnection(connection: WorkspaceConnection): WorkspaceConnection {
  return {
    ...connection,
    codeRoot: cloneOptionalString(connection.codeRoot),
    notesRoot: cloneOptionalString(connection.notesRoot) ?? getWorkspaceConnectionNotesRoot(connection),
    includeGlobs: cloneStringList(connection.includeGlobs),
    excludeGlobs: cloneStringList(connection.excludeGlobs),
  };
}

function cloneStringList(values: string[] | undefined): string[] | undefined {
  if (!values) {
    return undefined;
  }

  return values
    .map((value) => value.trim())
    .filter((value, index, items) => value.length > 0 && items.indexOf(value) === index);
}

function cloneOptionalString(value: string | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined;
}

function readRequiredTrimmedString(value: unknown, key: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }

  return value.trim();
}

function readOptionalTrimmedString(value: unknown, key: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readRequiredTrimmedString(value, key);
}

function resolveConnectionRoots(
  input: Pick<CreateWorkspaceConnectionInput, "rootPath" | "notesRoot" | "codeRoot">
    | Pick<UpdateWorkspaceConnectionInput, "rootPath" | "notesRoot" | "codeRoot">,
  previous?: WorkspaceConnection
): { notesRoot: string; codeRoot?: string } {
  const codeRoot = input.codeRoot === undefined
    ? cloneOptionalString(previous?.codeRoot)
    : readOptionalTrimmedString(input.codeRoot, "codeRoot");
  const explicitNotesRoot = input.notesRoot !== undefined
    ? readOptionalTrimmedString(input.notesRoot, "notesRoot")
    : input.rootPath !== undefined
      ? readOptionalTrimmedString(input.rootPath, "rootPath")
      : cloneOptionalString(previous?.notesRoot) ?? cloneOptionalString(previous?.rootPath);
  const notesRoot = explicitNotesRoot ?? getWorkspaceConnectionNotesRoot({
    rootPath: cloneOptionalString(previous?.rootPath),
    notesRoot: cloneOptionalString(previous?.notesRoot),
    codeRoot,
  });

  return {
    notesRoot,
    codeRoot,
  };
}

function normalizeConnectionId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new Error("id is required");
  }

  return normalized;
}

function validateConnectionRoots(roots: { notesRoot: string; codeRoot?: string }): void {
  validateConnectionPath(roots.notesRoot, "notesRoot");
  if (roots.codeRoot) {
    validateConnectionPath(roots.codeRoot, "codeRoot");
  }
}

function validateConnectionPath(targetPath: string, key: string): void {
  try {
    const stats = statSync(targetPath);
    if (!stats.isDirectory()) {
      throw new Error(`${key} must point to a directory`);
    }
    return;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      if (error instanceof Error && error.message === `${key} must point to a directory`) {
        throw error;
      }
      throw error;
    }
  }

  const parentPath = path.dirname(targetPath);
  try {
    const parentStats = statSync(parentPath);
    if (!parentStats.isDirectory()) {
      throw new Error(`${key} parent path is not a directory`);
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`${key} parent directory does not exist: ${parentPath}`);
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`${key} is invalid`);
  }
}

function isWorkspaceConnection(value: unknown): value is WorkspaceConnection {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkspaceConnection>;
  const hasAnyRoot = [candidate.rootPath, candidate.notesRoot, candidate.codeRoot]
    .some((item) => typeof item === "string" && item.trim().length > 0);
  return typeof candidate.id === "string"
    && typeof candidate.name === "string"
    && typeof candidate.kind === "string"
    && hasAnyRoot;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
