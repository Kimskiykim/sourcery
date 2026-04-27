import type { WorkspaceTabsSessionSnapshot as TabsSessionSnapshot } from "../core/graph/types.js";
import type { AppMemoryDocument } from "../core/memory/types.js";
import type {
  WorkspaceConnection,
  WorkspaceConnectionKind,
} from "../core/workspace/session-types.js";
import { HttpWorkspaceClient, RequestError } from "../core/workspace/http-workspace-client.js";
import type { WorkspaceFolder, WorkspaceNote } from "../core/workspace/types.js";

type ApiClientOptions = {
  getActiveConnectionId: () => string | undefined;
};

export class SourceryApiClient {
  private readonly workspaceClient = new HttpWorkspaceClient();

  constructor(private readonly options: ApiClientOptions) {}

  listWorkspaceConnections(): Promise<WorkspaceConnection[]> {
    return requestJson<WorkspaceConnection[]>("/api/workspace/connections");
  }

  listNotes(): Promise<WorkspaceNote[]> {
    return this.workspaceClient.listNotes({
      connectionId: this.options.getActiveConnectionId(),
    });
  }

  listFolders(): Promise<WorkspaceFolder[]> {
    return this.workspaceClient.listFolders({
      connectionId: this.options.getActiveConnectionId(),
    });
  }

  getGlobalMemory(): Promise<AppMemoryDocument> {
    return requestJson<AppMemoryDocument>("/api/memory/global");
  }

  updateGlobalMemory(content: string): Promise<AppMemoryDocument> {
    return requestJson<AppMemoryDocument>("/api/memory/global", {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
  }

  async deleteGlobalMemory(): Promise<void> {
    await requestJson<{ ok: true }>("/api/memory/global", { method: "DELETE" });
  }

  getWorkspaceMemory(connectionId: string): Promise<AppMemoryDocument & { connectionName?: string }> {
    return requestJson<AppMemoryDocument & { connectionName?: string }>(
      `/api/memory/workspace?connectionId=${encodeURIComponent(connectionId)}`
    );
  }

  updateWorkspaceMemory(
    connectionId: string,
    content: string
  ): Promise<AppMemoryDocument & { connectionName?: string }> {
    return requestJson<AppMemoryDocument & { connectionName?: string }>(
      `/api/memory/workspace?connectionId=${encodeURIComponent(connectionId)}`,
      {
        method: "PUT",
        body: JSON.stringify({ content }),
      }
    );
  }

  async deleteWorkspaceMemory(connectionId: string): Promise<void> {
    await requestJson<{ ok: true }>(
      `/api/memory/workspace?connectionId=${encodeURIComponent(connectionId)}`,
      { method: "DELETE" }
    );
  }

  createWorkspaceConnection(payload: {
    name: string;
    kind: WorkspaceConnectionKind;
    rootPath?: string;
    codeRoot?: string;
    notesRoot?: string;
    isDefault: boolean;
  }): Promise<WorkspaceConnection> {
    return requestJson<WorkspaceConnection>("/api/workspace/connections", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  updateWorkspaceConnection(
    connectionId: string,
    payload: {
      name: string;
      kind: WorkspaceConnectionKind;
      rootPath?: string;
      codeRoot?: string;
      notesRoot?: string;
      isDefault: boolean;
    }
  ): Promise<WorkspaceConnection> {
    return requestJson<WorkspaceConnection>(
      `/api/workspace/connections/${encodeURIComponent(connectionId)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      }
    );
  }

  async deleteWorkspaceConnection(connectionId: string): Promise<void> {
    await requestJson<{ ok: true }>(
      `/api/workspace/connections/${encodeURIComponent(connectionId)}`,
      { method: "DELETE" }
    );
  }

  async pickDirectory(payload: { title?: string; defaultPath?: string }): Promise<string | null> {
    const response = await requestJson<{ path: string | null }>("/api/system/pick-directory", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return response.path;
  }

  createNote(payload: { title: string; content: string; folderPath?: string }): Promise<WorkspaceNote> {
    return this.workspaceClient.createNote(payload, {
      connectionId: this.options.getActiveConnectionId(),
    });
  }

  updateNote(
    noteId: string,
    payload: { title: string; content: string; folderPath?: string }
  ): Promise<WorkspaceNote> {
    return this.workspaceClient.updateNote(noteId, payload, {
      connectionId: this.options.getActiveConnectionId(),
    });
  }

  async deleteNote(noteId: string): Promise<void> {
    await this.workspaceClient.deleteNote(noteId, {
      connectionId: this.options.getActiveConnectionId(),
    });
  }

  createFolder(path: string): Promise<WorkspaceFolder> {
    return this.workspaceClient.createFolder(
      { path },
      { connectionId: this.options.getActiveConnectionId() }
    );
  }

  renameFolder(folderPath: string, nextPath: string): Promise<WorkspaceFolder> {
    return this.workspaceClient.renameFolder(
      folderPath,
      { nextPath },
      { connectionId: this.options.getActiveConnectionId() }
    );
  }

  async deleteFolder(folderPath: string): Promise<void> {
    await this.workspaceClient.deleteFolder(folderPath, {
      connectionId: this.options.getActiveConnectionId(),
    });
  }

  getWorkspaceTabs(): Promise<TabsSessionSnapshot> {
    return requestJson<TabsSessionSnapshot>("/api/workspace/tabs");
  }

  openWorkspaceTab(
    noteId: string,
    options: { replaceActive?: boolean; forceNew?: boolean } = {}
  ): Promise<TabsSessionSnapshot> {
    return requestJson<TabsSessionSnapshot>("/api/workspace/tabs/open", {
      method: "POST",
      body: JSON.stringify({
        noteId,
        connectionId: this.options.getActiveConnectionId(),
        replaceActive: options.replaceActive,
        forceNew: options.forceNew,
      }),
    });
  }

  closeWorkspaceTab(tabId: string): Promise<TabsSessionSnapshot> {
    return requestJson<TabsSessionSnapshot>("/api/workspace/tabs/close", {
      method: "POST",
      body: JSON.stringify({ tabId }),
    });
  }

  setWorkspaceTabPinned(tabId: string, pinned: boolean): Promise<TabsSessionSnapshot> {
    return requestJson<TabsSessionSnapshot>(
      pinned ? "/api/workspace/tabs/pin" : "/api/workspace/tabs/unpin",
      {
        method: "POST",
        body: JSON.stringify({ tabId }),
      }
    );
  }

  reorderWorkspaceTabs(tabIds: string[]): Promise<TabsSessionSnapshot> {
    return requestJson<TabsSessionSnapshot>("/api/workspace/tabs/reorder", {
      method: "POST",
      body: JSON.stringify({ tabIds }),
    });
  }

  activateWorkspaceTab(tabId: string): Promise<TabsSessionSnapshot> {
    return requestJson<TabsSessionSnapshot>("/api/workspace/tabs/activate", {
      method: "POST",
      body: JSON.stringify({ tabId }),
    });
  }

  async getWorkspaceState(connectionId: string | undefined): Promise<{
    revision: number;
    changedAt: string;
  }> {
    const suffix = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : "";
    const snapshot = await requestJson<{
      revision: number;
      changedAt: string;
      connections?: Array<{ connectionId: string; revision: number; changedAt: string }>;
    }>(`/api/workspace/state${suffix}`);
    const connectionState = snapshot.connections?.find((item) => item.connectionId === connectionId);
    return {
      revision: connectionState?.revision ?? snapshot.revision,
      changedAt: connectionState?.changedAt ?? snapshot.changedAt,
    };
  }
}

export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text.trim() || `Request failed: ${response.status}`;

    try {
      const payload = JSON.parse(text) as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) {
        message = payload.error;
      }
    } catch {
      // Keep the plain-text fallback.
    }

    throw new RequestError(response.status, message);
  }

  return response.json() as Promise<T>;
}
