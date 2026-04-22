import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  CreateFolderInput,
  CreateNoteInput,
  RenameFolderInput,
  UpdateNoteInput,
  VaultFolder,
  VaultNote,
} from "./types.js";

interface SeedNote {
  fileName: string;
  content: string;
}

export class MarkdownVaultError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export const DEFAULT_SEED_NOTES: SeedNote[] = [
  {
    fileName: "Welcome.md",
    content: `# Sourcery

Это markdown vault Sourcery на локальной файловой системе.

- каждая заметка хранится как отдельный .md файл
- веб-интерфейс читает и пишет файлы через локальный API
- wikilinks работают как [[Ideas]]
`,
  },
  {
    fileName: "Ideas.md",
    content: `# Ideas

- [ ] Добавить backlinks
- [ ] Добавить graph view
- [x] Перенести хранение в markdown-файлы

Ссылка обратно: [[Welcome]]
`,
  },
];

export class MarkdownVault {
  constructor(private readonly vaultDir: string) {}

  async ensureSeeded(seedNotes: SeedNote[] = DEFAULT_SEED_NOTES): Promise<void> {
    await fs.mkdir(this.vaultDir, { recursive: true });

    const notes = await this.listNotes();
    if (notes.length > 0) {
      return;
    }

    await Promise.all(
      seedNotes.map((note) =>
        this.writeFileAtomically(path.join(this.vaultDir, note.fileName), note.content)
      )
    );
  }

  async listNotes(): Promise<VaultNote[]> {
    const fileNames = await this.walkMarkdownFiles();
    const notes = await Promise.all(fileNames.map((fileName) => this.readNote(fileName)));

    return notes.sort(compareNotes);
  }

  async listFolders(): Promise<VaultFolder[]> {
    const folders = await this.walkFolders();
    return folders.sort((left, right) => left.path.localeCompare(right.path, "en"));
  }

  async createNote(payload: CreateNoteInput): Promise<VaultNote> {
    const rawTitle = payload.title.trim();
    const title = this.normalizeTitle(payload.title);
    const content = payload.content;
    const folderPath = this.normalizeFolderPath(payload.folderPath);
    const fileName = rawTitle
      ? await this.getStrictFileName(title, folderPath)
      : await this.getUniqueFileName(title, folderPath);
    const noteId = joinRelativePath(folderPath, fileName);
    const filePath = this.resolveNotePath(noteId);

    await this.writeFileAtomically(filePath, content);
    return this.readNote(noteId);
  }

  async updateNote(noteId: string, payload: UpdateNoteInput): Promise<VaultNote> {
    const sourcePath = this.resolveNotePath(noteId);
    const title = this.normalizeTitle(payload.title);
    const content = payload.content;
    const currentFolderPath = dirnameOfRelativePath(noteId);
    const folderPath = this.normalizeFolderPath(payload.folderPath ?? currentFolderPath);
    const currentFileName = basenameOfRelativePath(noteId);
    const targetFileName = await this.getStrictFileName(title, folderPath, currentFileName);
    const targetNoteId = joinRelativePath(folderPath, targetFileName);
    const targetPath = this.resolveNotePath(targetNoteId);

    if (targetNoteId !== noteId) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.rename(sourcePath, targetPath);
    }

    await this.writeFileAtomically(targetPath, content);
    return this.readNote(targetNoteId);
  }

  async deleteNote(noteId: string): Promise<void> {
    await fs.unlink(this.resolveNotePath(noteId));
  }

  async createFolder(payload: CreateFolderInput): Promise<VaultFolder> {
    const folderPath = this.normalizeFolderPath(payload.path);
    if (!folderPath) {
      throw new MarkdownVaultError(400, "Folder path is required");
    }

    await fs.mkdir(this.resolveFolderPath(folderPath), { recursive: true });
    return folderFromPath(folderPath);
  }

  async renameFolder(folderPath: string, payload: RenameFolderInput): Promise<VaultFolder> {
    const sourceFolderPath = this.normalizeFolderPath(folderPath);
    const targetFolderPath = this.normalizeFolderPath(payload.nextPath);
    if (!sourceFolderPath) {
      throw new MarkdownVaultError(400, "Folder path is required");
    }

    if (!targetFolderPath) {
      throw new MarkdownVaultError(400, "Target folder path is required");
    }

    if (sourceFolderPath === targetFolderPath) {
      return folderFromPath(targetFolderPath);
    }

    if (targetFolderPath.startsWith(`${sourceFolderPath}/`)) {
      throw new MarkdownVaultError(400, "Cannot move a folder into itself");
    }

    const sourceDirectory = this.resolveFolderPath(sourceFolderPath);
    const targetDirectory = this.resolveFolderPath(targetFolderPath);

    await this.ensureFolderExists(sourceDirectory);
    if (await pathExists(targetDirectory)) {
      throw new MarkdownVaultError(409, "A folder with this path already exists");
    }

    await fs.mkdir(path.dirname(targetDirectory), { recursive: true });
    await fs.rename(sourceDirectory, targetDirectory);
    return folderFromPath(targetFolderPath);
  }

  async deleteFolder(folderPath: string): Promise<void> {
    const normalizedFolderPath = this.normalizeFolderPath(folderPath);
    if (!normalizedFolderPath) {
      throw new MarkdownVaultError(400, "Folder path is required");
    }

    const directory = this.resolveFolderPath(normalizedFolderPath);
    await this.ensureFolderExists(directory);

    const entries = await fs.readdir(directory);
    if (entries.length > 0) {
      throw new MarkdownVaultError(409, "Folder is not empty");
    }

    await fs.rmdir(directory);
  }

  private async readNote(noteId: string): Promise<VaultNote> {
    const filePath = this.resolveNotePath(noteId);
    const [content, stats] = await Promise.all([
      fs.readFile(filePath, "utf8"),
      fs.stat(filePath),
    ]);

    return {
      id: noteId,
      title: path.posix.basename(noteId, ".md"),
      folderPath: dirnameOfRelativePath(noteId),
      content,
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString(),
    };
  }

  private resolveNotePath(noteId: string): string {
    const normalized = normalizeRelativePath(noteId);
    if (!normalized.endsWith(".md")) {
      throw new MarkdownVaultError(400, "Invalid note id");
    }

    return path.join(this.vaultDir, normalized);
  }

  private resolveFolderPath(folderPath: string): string {
    const normalized = this.normalizeFolderPath(folderPath);
    return normalized ? path.join(this.vaultDir, normalized) : this.vaultDir;
  }

  private async getUniqueFileName(
    title: string,
    folderPath: string,
    currentFileName?: string
  ): Promise<string> {
    const baseName = this.sanitizeFileStem(title);
    const entries = await this.readMarkdownEntriesInFolder(folderPath);
    const existing = new Set(
      entries
        .filter((entry) => entry.toLowerCase() !== currentFileName?.toLowerCase())
        .map((entry) => entry.toLowerCase())
    );

    let candidate = `${baseName}.md`;
    let counter = 2;

    while (existing.has(candidate.toLowerCase())) {
      candidate = `${baseName} ${counter}.md`;
      counter += 1;
    }

    return candidate;
  }

  private async getStrictFileName(
    title: string,
    folderPath: string,
    currentFileName?: string
  ): Promise<string> {
    const candidate = `${this.sanitizeFileStem(title)}.md`;
    const entries = await this.readMarkdownEntriesInFolder(folderPath);
    const hasConflict = entries
      .some((entry) =>
        entry.toLowerCase() === candidate.toLowerCase() &&
        entry.toLowerCase() !== currentFileName?.toLowerCase()
      );

    if (hasConflict) {
      throw new MarkdownVaultError(409, "A note with this title already exists");
    }

    return candidate;
  }

  private normalizeFolderPath(rawFolderPath: string | undefined): string {
    if (!rawFolderPath?.trim()) {
      return "";
    }

    const normalized = normalizeRelativePath(rawFolderPath);
    return normalized
      .split("/")
      .filter(Boolean)
      .map((segment) => this.sanitizeFileStem(segment))
      .join("/");
  }

  private normalizeTitle(rawTitle: string): string {
    if (!rawTitle.trim()) {
      return "Untitled";
    }

    return rawTitle.trim();
  }

  private sanitizeFileStem(title: string): string {
    const cleaned = title
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return cleaned || "Untitled";
  }

  private async writeFileAtomically(filePath: string, content: string): Promise<void> {
    const directory = path.dirname(filePath);
    const temporaryFileName = `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`;
    const temporaryPath = path.join(directory, temporaryFileName);

    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temporaryPath, content, "utf8");
    await fs.rename(temporaryPath, filePath);
  }

  private async walkMarkdownFiles(relativeDirectory = ""): Promise<string[]> {
    const directory = this.resolveFolderPath(relativeDirectory);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const relativePath = joinRelativePath(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        files.push(...await this.walkMarkdownFiles(relativePath));
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(relativePath);
      }
    }

    return files;
  }

  private async walkFolders(relativeDirectory = ""): Promise<VaultFolder[]> {
    const directory = this.resolveFolderPath(relativeDirectory);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const folders: VaultFolder[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const folderPath = joinRelativePath(relativeDirectory, entry.name);
      folders.push(folderFromPath(folderPath));
      folders.push(...await this.walkFolders(folderPath));
    }

    return folders;
  }

  private async readMarkdownEntriesInFolder(folderPath: string): Promise<string[]> {
    const directory = this.resolveFolderPath(folderPath);

    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  private async ensureFolderExists(directory: string): Promise<void> {
    try {
      const stats = await fs.stat(directory);
      if (!stats.isDirectory()) {
        throw new MarkdownVaultError(404, "Folder not found");
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new MarkdownVaultError(404, "Folder not found");
      }

      throw error;
    }
  }
}

function compareNotes(left: VaultNote, right: VaultNote): number {
  const updatedAtOrder = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedAtOrder !== 0) {
    return updatedAtOrder;
  }

  const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
  if (createdAtOrder !== 0) {
    return createdAtOrder;
  }

  return left.title.localeCompare(right.title, "en");
}

function normalizeRelativePath(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/").trim());
  if (
    normalized === "." ||
    normalized === "" ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new MarkdownVaultError(400, "Invalid path");
  }

  return normalized.replace(/^\.\/+/, "");
}

function joinRelativePath(folderPath: string, leaf: string): string {
  return folderPath ? `${folderPath}/${leaf}` : leaf;
}

function dirnameOfRelativePath(relativePath: string): string {
  const directory = path.posix.dirname(relativePath);
  return directory === "." ? "" : directory;
}

function basenameOfRelativePath(relativePath: string): string {
  return path.posix.basename(relativePath);
}

function folderFromPath(folderPath: string): VaultFolder {
  return {
    path: folderPath,
    name: path.posix.basename(folderPath),
    parentPath: dirnameOfRelativePath(folderPath) || null,
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}
