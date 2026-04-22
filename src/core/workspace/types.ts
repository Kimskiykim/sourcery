import type {
  CreateFolderInput,
  CreateNoteInput,
  RenameFolderInput,
  UpdateNoteInput,
  VaultFolder,
  VaultNote,
} from "../storage/types.js";

export type WorkspaceNote = VaultNote;
export type WorkspaceFolder = VaultFolder;

export interface WorkspaceRequestOptions {
  connectionId?: string;
}

export interface WorkspaceSnapshot {
  notes: WorkspaceNote[];
  activeNoteId: string | null;
  activeConnectionId?: string | null;
}

export interface WorkspaceGateway {
  listNotes(options?: WorkspaceRequestOptions): Promise<WorkspaceNote[]>;
  listFolders(options?: WorkspaceRequestOptions): Promise<WorkspaceFolder[]>;
  createNote(payload: CreateNoteInput, options?: WorkspaceRequestOptions): Promise<WorkspaceNote>;
  updateNote(noteId: string, payload: UpdateNoteInput, options?: WorkspaceRequestOptions): Promise<WorkspaceNote>;
  deleteNote(noteId: string, options?: WorkspaceRequestOptions): Promise<void>;
  createFolder(payload: CreateFolderInput, options?: WorkspaceRequestOptions): Promise<WorkspaceFolder>;
  renameFolder(folderPath: string, payload: RenameFolderInput, options?: WorkspaceRequestOptions): Promise<WorkspaceFolder>;
  deleteFolder(folderPath: string, options?: WorkspaceRequestOptions): Promise<void>;
}
