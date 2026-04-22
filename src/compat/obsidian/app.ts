import type { CreateNoteInput, UpdateNoteInput } from "../../core/storage/types.js";
import { HttpWorkspaceClient, RequestError } from "../../core/workspace/http-workspace-client.js";
import type { WorkspaceGateway, WorkspaceNote, WorkspaceSnapshot } from "../../core/workspace/types.js";
import { WikiSDK } from "../../core/wiki/wiki-sdk.js";
import type { CachedMetadata, TFile } from "./types.js";

type VaultOperations = {
  getNotes: () => WorkspaceNote[];
  createNote: (payload: CreateNoteInput) => Promise<WorkspaceNote>;
  updateNote: (noteId: string, payload: UpdateNoteInput) => Promise<WorkspaceNote>;
  deleteNote: (noteId: string) => Promise<void>;
};

export class VaultCompat {
  constructor(private readonly operations: VaultOperations) {}

  getMarkdownFiles(): TFile[] {
    return this.operations.getNotes().map(toTFile);
  }

  getAbstractFileByPath(path: string): TFile | null {
    const note = this.operations.getNotes().find((item) => item.id === path);
    return note ? toTFile(note) : null;
  }

  async cachedRead(file: TFile): Promise<string> {
    const note = this.operations.getNotes().find((item) => item.id === file.path);
    if (!note) {
      throw new Error(`File not found: ${file.path}`);
    }

    return note.content;
  }

  async create(path: string, data: string): Promise<TFile> {
    const note = await this.operations.createNote({
      title: filePathToTitle(path),
      content: data,
    });
    return toTFile(note);
  }

  async modify(file: TFile, data: string): Promise<void> {
    const note = this.operations.getNotes().find((item) => item.id === file.path);
    if (!note) {
      throw new Error(`File not found: ${file.path}`);
    }

    await this.operations.updateNote(note.id, {
      title: note.title,
      content: data,
    });
  }

  async rename(file: TFile, newPath: string): Promise<TFile> {
    const note = this.operations.getNotes().find((item) => item.id === file.path);
    if (!note) {
      throw new Error(`File not found: ${file.path}`);
    }

    const renamed = await this.operations.updateNote(note.id, {
      title: filePathToTitle(newPath),
      content: note.content,
      folderPath: filePathToFolderPath(newPath),
    });
    return toTFile(renamed);
  }

  async delete(file: TFile): Promise<void> {
    await this.operations.deleteNote(file.path);
  }
}

export class WorkspaceCompat {
  constructor(
    private readonly getNotes: () => WorkspaceNote[],
    private readonly getActiveNoteId: () => string | null,
    private readonly setActiveNoteId: (noteId: string | null) => void
  ) {}

  getActiveFile(): TFile | null {
    const noteId = this.getActiveNoteId();
    const note = this.getNotes().find((item) => item.id === noteId);
    return note ? toTFile(note) : null;
  }

  openLinkText(linktext: string): TFile | null {
    const note = this.getNotes().find((item) => item.title.toLowerCase() === linktext.toLowerCase());
    if (!note) {
      return null;
    }

    this.setActiveNoteId(note.id);
    return toTFile(note);
  }

  setActiveFile(file: TFile | null): void {
    this.setActiveNoteId(file?.path ?? null);
  }
}

export class MetadataCacheCompat {
  constructor(
    private readonly getNotes: () => WorkspaceNote[],
    private readonly wiki: WikiSDK
  ) {}

  getFileCache(file: TFile): CachedMetadata | null {
    const note = this.getNotes().find((item) => item.id === file.path);
    if (!note) {
      return null;
    }

    return this.wiki.getMetadata(note, this.getNotes());
  }

  get resolvedLinks(): Record<string, Record<string, number>> {
    return this.wiki.buildResolvedLinks(this.getNotes());
  }
}

export class ObsidianAppClient {
  private notes: WorkspaceNote[] = [];
  private activeNoteId: string | null = null;

  readonly vault: VaultCompat;
  readonly workspace: WorkspaceCompat;
  readonly metadataCache: MetadataCacheCompat;

  constructor(
    private readonly workspaceGateway: WorkspaceGateway = new HttpWorkspaceClient(),
    private readonly wiki = new WikiSDK()
  ) {
    this.vault = new VaultCompat({
      getNotes: () => this.notes,
      createNote: (payload) => this.createNote(payload),
      updateNote: (noteId, payload) => this.updateNote(noteId, payload),
      deleteNote: (noteId) => this.deleteNote(noteId),
    });
    this.workspace = new WorkspaceCompat(
      () => this.notes,
      () => this.activeNoteId,
      (noteId) => {
        this.activeNoteId = noteId;
      }
    );
    this.metadataCache = new MetadataCacheCompat(() => this.notes, this.wiki);
  }

  async sync(preferredNoteId: string | null = this.activeNoteId): Promise<WorkspaceSnapshot> {
    this.notes = await this.workspaceGateway.listNotes();
    this.activeNoteId = resolveSelection(preferredNoteId, this.notes);
    return this.getSnapshot();
  }

  getSnapshot(): WorkspaceSnapshot {
    return {
      notes: [...this.notes],
      activeNoteId: this.activeNoteId,
    };
  }

  async createNote(payload: CreateNoteInput): Promise<WorkspaceNote> {
    const note = await this.workspaceGateway.createNote(payload);
    this.notes = [note, ...this.notes.filter((item) => item.id !== note.id)];
    this.activeNoteId = note.id;
    return note;
  }

  async updateNote(noteId: string, payload: UpdateNoteInput): Promise<WorkspaceNote> {
    const saved = await this.workspaceGateway.updateNote(noteId, payload);
    this.notes = this.notes.map((item) => (item.id === noteId ? saved : item));
    if (this.activeNoteId === noteId) {
      this.activeNoteId = saved.id;
    }
    return saved;
  }

  async deleteNote(noteId: string): Promise<void> {
    await this.workspaceGateway.deleteNote(noteId);
    this.notes = this.notes.filter((item) => item.id !== noteId);
    if (this.activeNoteId === noteId) {
      this.activeNoteId = resolveSelection(null, this.notes);
    }
  }

  setActiveNoteId(noteId: string | null): void {
    this.activeNoteId = resolveSelection(noteId, this.notes);
  }
}

function resolveSelection(preferredNoteId: string | null, notes: WorkspaceNote[]): string | null {
  if (preferredNoteId && notes.some((note) => note.id === preferredNoteId)) {
    return preferredNoteId;
  }

  return notes[0]?.id ?? null;
}

function toTFile(note: WorkspaceNote): TFile {
  return {
    path: note.id,
    name: note.id,
    basename: note.title,
    extension: "md",
    stat: {
      ctime: Date.parse(note.createdAt),
      mtime: Date.parse(note.updatedAt),
      size: new TextEncoder().encode(note.content).length,
    },
  };
}

function filePathToTitle(path: string): string {
  return path.replace(/\.md$/i, "").split("/").pop()?.trim() || "Untitled";
}

function filePathToFolderPath(path: string): string {
  const segments = path.replace(/\.md$/i, "").split("/");
  segments.pop();
  return segments.join("/");
}

export { RequestError };
