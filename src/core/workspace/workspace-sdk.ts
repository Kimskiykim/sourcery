import type {
  CreateFolderInput,
  CreateNoteInput,
  RenameFolderInput,
  UpdateNoteInput,
  VaultFolder,
  VaultNote,
} from "../storage/types.js";
import { MarkdownVault } from "../storage/markdown-vault.js";
import type { WorkspaceRequestOptions, WorkspaceSnapshot } from "./types.js";

type WorkspaceStorageResolver = (connectionId: string) => MarkdownVault | undefined;

export class WorkspaceSDK {
  constructor(
    private readonly storage: MarkdownVault,
    private readonly resolveStorage?: WorkspaceStorageResolver,
    private readonly defaultConnectionId = "default"
  ) {}

  ensureSeeded(): Promise<void> {
    return this.storage.ensureSeeded();
  }

  listNotes(options: WorkspaceRequestOptions = {}): Promise<VaultNote[]> {
    return this.getStorage(options).listNotes();
  }

  listFolders(options: WorkspaceRequestOptions = {}): Promise<VaultFolder[]> {
    return this.getStorage(options).listFolders();
  }

  createNote(payload: CreateNoteInput, options: WorkspaceRequestOptions = {}): Promise<VaultNote> {
    return this.getStorage(options).createNote(payload);
  }

  updateNote(noteId: string, payload: UpdateNoteInput, options: WorkspaceRequestOptions = {}): Promise<VaultNote> {
    return this.getStorage(options).updateNote(noteId, payload);
  }

  deleteNote(noteId: string, options: WorkspaceRequestOptions = {}): Promise<void> {
    return this.getStorage(options).deleteNote(noteId);
  }

  createFolder(payload: CreateFolderInput, options: WorkspaceRequestOptions = {}): Promise<VaultFolder> {
    return this.getStorage(options).createFolder(payload);
  }

  renameFolder(
    folderPath: string,
    payload: RenameFolderInput,
    options: WorkspaceRequestOptions = {}
  ): Promise<VaultFolder> {
    return this.getStorage(options).renameFolder(folderPath, payload);
  }

  deleteFolder(folderPath: string, options: WorkspaceRequestOptions = {}): Promise<void> {
    return this.getStorage(options).deleteFolder(folderPath);
  }

  async getSnapshot(
    preferredNoteId: string | null = null,
    options: WorkspaceRequestOptions = {}
  ): Promise<WorkspaceSnapshot> {
    const notes = await this.listNotes(options);
    return {
      notes,
      activeNoteId: resolveSelection(preferredNoteId, notes),
      activeConnectionId: options.connectionId ?? this.defaultConnectionId,
    };
  }

  private getStorage(options: WorkspaceRequestOptions): MarkdownVault {
    const connectionId = options.connectionId?.trim();
    if (!connectionId || connectionId === this.defaultConnectionId) {
      return this.storage;
    }

    const resolved = this.resolveStorage?.(connectionId);
    if (!resolved) {
      throw new Error(`Unknown connection: ${connectionId}`);
    }

    return resolved;
  }
}

function resolveSelection(preferredNoteId: string | null, notes: VaultNote[]): string | null {
  if (preferredNoteId && notes.some((note) => note.id === preferredNoteId)) {
    return preferredNoteId;
  }

  return notes[0]?.id ?? null;
}
