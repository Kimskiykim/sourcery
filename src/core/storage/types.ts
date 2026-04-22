export interface VaultNote {
  id: string;
  title: string;
  folderPath: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNoteInput {
  title: string;
  content: string;
  folderPath?: string;
}

export interface UpdateNoteInput {
  title: string;
  content: string;
  folderPath?: string;
}

export interface VaultFolder {
  path: string;
  name: string;
  parentPath: string | null;
}

export interface CreateFolderInput {
  path: string;
}

export interface RenameFolderInput {
  nextPath: string;
}
