export type WorkspaceConnectionKind = "vault" | "repo_docs" | "code_repo" | "docs_folder";

export interface WorkspaceConnection {
  id: string;
  name: string;
  kind: WorkspaceConnectionKind;
  rootPath: string;
  codeRoot?: string;
  notesRoot?: string;
  isDefault?: boolean;
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

export interface WorkspaceNoteRef {
  connectionId: string;
  noteId: string;
}

export interface WorkspaceFolderRef {
  connectionId: string;
  folderPath: string;
}

export interface WorkspaceTab {
  id: string;
  noteId: string;
  title: string;
  folderPath: string;
  pinned: boolean;
  connectionId?: string;
  connectionName?: string;
}

export interface WorkspaceTabsSessionSnapshot {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  activeNoteId: string | null;
  activeConnectionId?: string | null;
  updatedAt: string;
}

export interface OpenWorkspaceTabInput {
  noteId: string;
  connectionId?: string;
  activate?: boolean;
  pinned?: boolean;
  replaceActive?: boolean;
  forceNew?: boolean;
}

export interface CloseWorkspaceTabInput {
  tabId: string;
}

export interface SetWorkspaceTabPinnedInput {
  tabId: string;
  pinned: boolean;
}

export interface ReorderWorkspaceTabsInput {
  tabIds: string[];
}

export interface ActivateWorkspaceTabInput {
  tabId: string;
}

export interface CreateWorkspaceConnectionInput {
  id?: string;
  name: string;
  kind: WorkspaceConnectionKind;
  rootPath?: string;
  codeRoot?: string;
  notesRoot?: string;
  isDefault?: boolean;
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

export interface UpdateWorkspaceConnectionInput {
  name?: string;
  kind?: WorkspaceConnectionKind;
  rootPath?: string;
  codeRoot?: string;
  notesRoot?: string;
  isDefault?: boolean;
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

export interface GetWorkspaceNoteByRefInput {
  noteRef: WorkspaceNoteRef;
}

export interface UpdateWorkspaceNoteByRefInput {
  noteRef: WorkspaceNoteRef;
  title: string;
  content: string;
  folderPath?: string;
}

export interface DeleteWorkspaceNoteByRefInput {
  noteRef: WorkspaceNoteRef;
}

export interface RenameWorkspaceFolderByRefInput {
  folderRef: WorkspaceFolderRef;
  nextPath: string;
}

export interface DeleteWorkspaceFolderByRefInput {
  folderRef: WorkspaceFolderRef;
}

type WorkspaceConnectionRootLike = {
  rootPath?: string;
  codeRoot?: string;
  notesRoot?: string;
};

export function getWorkspaceConnectionNotesRoot(connection: WorkspaceConnectionRootLike): string {
  const notesRoot = connection.notesRoot?.trim();
  if (notesRoot) {
    return notesRoot;
  }

  const rootPath = connection.rootPath?.trim();
  if (rootPath) {
    return rootPath;
  }

  const codeRoot = connection.codeRoot?.trim();
  if (codeRoot) {
    return codeRoot;
  }

  throw new Error("rootPath, notesRoot, or codeRoot is required");
}
