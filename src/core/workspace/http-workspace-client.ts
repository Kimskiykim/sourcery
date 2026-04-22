import type {
  CreateFolderInput,
  CreateNoteInput,
  RenameFolderInput,
  UpdateNoteInput,
} from "../storage/types.js";
import type { WorkspaceFolder, WorkspaceGateway, WorkspaceNote, WorkspaceRequestOptions } from "./types.js";
import type { WorkspaceRevisionState } from "./revision-tracker.js";

export class RequestError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export class HttpWorkspaceClient implements WorkspaceGateway {
  constructor(private readonly baseUrl = "/api/notes") {}

  listNotes(options: WorkspaceRequestOptions = {}): Promise<WorkspaceNote[]> {
    return this.requestJson<WorkspaceNote[]>(withConnectionId(this.baseUrl, options.connectionId));
  }

  listFolders(options: WorkspaceRequestOptions = {}): Promise<WorkspaceFolder[]> {
    return this.requestJson<WorkspaceFolder[]>("/api/folders" + toConnectionQuery(options.connectionId));
  }

  createNote(payload: CreateNoteInput, options: WorkspaceRequestOptions = {}): Promise<WorkspaceNote> {
    return this.requestJson<WorkspaceNote>(this.baseUrl, {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        connectionId: options.connectionId,
      }),
    });
  }

  updateNote(noteId: string, payload: UpdateNoteInput, options: WorkspaceRequestOptions = {}): Promise<WorkspaceNote> {
    return this.requestJson<WorkspaceNote>(withConnectionId(`${this.baseUrl}/${encodeURIComponent(noteId)}`, options.connectionId), {
      method: "PUT",
      body: JSON.stringify({
        ...payload,
        connectionId: options.connectionId,
      }),
    });
  }

  async deleteNote(noteId: string, options: WorkspaceRequestOptions = {}): Promise<void> {
    await this.requestJson<{ ok: true }>(withConnectionId(`${this.baseUrl}/${encodeURIComponent(noteId)}`, options.connectionId), {
      method: "DELETE",
    });
  }

  createFolder(payload: CreateFolderInput, options: WorkspaceRequestOptions = {}): Promise<WorkspaceFolder> {
    return this.requestJson<WorkspaceFolder>("/api/folders", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        connectionId: options.connectionId,
      }),
    });
  }

  renameFolder(
    folderPath: string,
    payload: RenameFolderInput,
    options: WorkspaceRequestOptions = {}
  ): Promise<WorkspaceFolder> {
    return this.requestJson<WorkspaceFolder>(withConnectionId(`/api/folders/${encodeURIComponent(folderPath)}`, options.connectionId), {
      method: "PUT",
      body: JSON.stringify({
        ...payload,
        connectionId: options.connectionId,
      }),
    });
  }

  async deleteFolder(folderPath: string, options: WorkspaceRequestOptions = {}): Promise<void> {
    await this.requestJson<{ ok: true }>(withConnectionId(`/api/folders/${encodeURIComponent(folderPath)}`, options.connectionId), {
      method: "DELETE",
    });
  }

  getWorkspaceState(): Promise<WorkspaceRevisionState> {
    return this.requestJson<WorkspaceRevisionState>("/api/workspace/state");
  }

  updateNoteKeepalive(noteId: string, payload: UpdateNoteInput): void {
    void fetch(`${this.baseUrl}/${encodeURIComponent(noteId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  }

  private async requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
      },
      ...init,
    });

    if (!response.ok) {
      const text = await response.text();
      let message = `Request failed with status ${response.status}`;

      try {
        const payload = JSON.parse(text) as { error?: unknown };
        if (typeof payload.error === "string" && payload.error.trim()) {
          message = payload.error;
        }
      } catch {
        if (text.trim()) {
          message = text.trim();
        }
      }

      throw new RequestError(response.status, message);
    }

    return response.json() as Promise<T>;
  }
}

function withConnectionId(url: string, connectionId: string | undefined): string {
  if (!connectionId?.trim()) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}connectionId=${encodeURIComponent(connectionId)}`;
}

function toConnectionQuery(connectionId: string | undefined): string {
  return connectionId?.trim() ? `?connectionId=${encodeURIComponent(connectionId)}` : "";
}
