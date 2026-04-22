import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  CreateWorkspaceConnectionInput,
  UpdateWorkspaceConnectionInput,
  WorkspaceConnection,
} from "./session-types.js";

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
    return this.state.connections.map((connection) => ({ ...connection }));
  }

  getConnection(connectionId: string): WorkspaceConnection | null {
    return this.state.connections.find((connection) => connection.id === connectionId) ?? null;
  }

  getDefaultConnection(): WorkspaceConnection {
    return this.state.connections.find((connection) => connection.isDefault) ?? this.options.defaultConnection;
  }

  createConnection(input: CreateWorkspaceConnectionInput): WorkspaceConnection {
    const name = readRequiredTrimmedString(input.name, "name");
    const rootPath = readRequiredTrimmedString(input.rootPath, "rootPath");
    const connectionId = normalizeConnectionId(input.id ?? name);

    if (this.state.connections.some((connection) => connection.id === connectionId)) {
      throw new Error(`Connection id already exists: ${connectionId}`);
    }

    if (this.state.connections.some((connection) => connection.rootPath === rootPath)) {
      throw new Error(`Connection rootPath already exists: ${rootPath}`);
    }

    const connection: WorkspaceConnection = {
      id: connectionId,
      name,
      kind: input.kind,
      rootPath,
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
    return { ...connection };
  }

  updateConnection(connectionId: string, input: UpdateWorkspaceConnectionInput): WorkspaceConnection {
    const index = this.state.connections.findIndex((connection) => connection.id === connectionId);
    if (index === -1) {
      throw new Error(`Unknown connection: ${connectionId}`);
    }

    const previous = this.state.connections[index];
    const nextRootPath = input.rootPath === undefined ? previous.rootPath : readRequiredTrimmedString(input.rootPath, "rootPath");
    const nextName = input.name === undefined ? previous.name : readRequiredTrimmedString(input.name, "name");

    const duplicatePath = this.state.connections.find((connection) =>
      connection.id !== connectionId && connection.rootPath === nextRootPath
    );
    if (duplicatePath) {
      throw new Error(`Connection rootPath already exists: ${nextRootPath}`);
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
      rootPath: nextRootPath,
      isDefault: input.isDefault ?? previous.isDefault,
      includeGlobs: input.includeGlobs === undefined ? cloneStringList(previous.includeGlobs) : cloneStringList(input.includeGlobs),
      excludeGlobs: input.excludeGlobs === undefined ? cloneStringList(previous.excludeGlobs) : cloneStringList(input.excludeGlobs),
    };

    this.state.connections[index] = updated;
    this.persist();
    return { ...updated };
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
    deduped.set(connection.id, {
      ...connection,
      includeGlobs: cloneStringList(connection.includeGlobs),
      excludeGlobs: cloneStringList(connection.excludeGlobs),
      isDefault: connection.id === defaultConnection.id ? true : connection.isDefault === true,
    });
  });

  deduped.set(defaultConnection.id, {
    ...defaultConnection,
    isDefault: true,
    includeGlobs: cloneStringList(defaultConnection.includeGlobs),
    excludeGlobs: cloneStringList(defaultConnection.excludeGlobs),
  });

  const normalized = [...deduped.values()];
  const activeDefault = normalized.find((connection) => connection.isDefault)?.id ?? defaultConnection.id;

  return {
    connections: normalized.map((connection) => ({
      ...connection,
      isDefault: connection.id === activeDefault,
    })),
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

function readRequiredTrimmedString(value: unknown, key: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }

  return value.trim();
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

function isWorkspaceConnection(value: unknown): value is WorkspaceConnection {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkspaceConnection>;
  return typeof candidate.id === "string"
    && typeof candidate.name === "string"
    && typeof candidate.kind === "string"
    && typeof candidate.rootPath === "string";
}
