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

interface MarkdownVaultFileSystem {
  access(path: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readdir(path: string, options?: { withFileTypes?: false }): Promise<string[]>;
  readdir(path: string, options: { withFileTypes: true }): Promise<import("node:fs").Dirent[]>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rmdir(path: string): Promise<void>;
  stat(path: string): Promise<import("node:fs").Stats>;
  unlink(path: string): Promise<void>;
  writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;
}

export interface MarkdownVaultOptions {
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

type MarkdownVaultConstructorOptions =
  | MarkdownVaultFileSystem
  | MarkdownVaultOptions;

const DEFAULT_EXCLUDE_GLOBS = [
  "**/.git/**",
  "**/.hg/**",
  "**/.svn/**",
  "**/node_modules/**",
  "**/__pycache__/**",
  "**/.mypy_cache/**",
  "**/.pytest_cache/**",
  "**/.ruff_cache/**",
  "**/.venv/**",
  "**/venv/**",
  "**/.obsidian-lite/**",
];

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
  private readonly fileSystem: MarkdownVaultFileSystem;
  private readonly options: MarkdownVaultOptions;

  constructor(
    private readonly vaultDir: string,
    fileSystemOrOptions: MarkdownVaultConstructorOptions = fs,
    options: MarkdownVaultOptions = {}
  ) {
    if (isMarkdownVaultFileSystem(fileSystemOrOptions)) {
      this.fileSystem = fileSystemOrOptions;
      this.options = normalizeVaultOptions(options);
      return;
    }

    this.fileSystem = fs;
    this.options = normalizeVaultOptions(fileSystemOrOptions);
  }

  async ensureSeeded(seedNotes: SeedNote[] = DEFAULT_SEED_NOTES): Promise<void> {
    await this.fileSystem.mkdir(this.vaultDir, { recursive: true });

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

    if (targetNoteId === noteId) {
      await this.writeFileAtomically(targetPath, content);
      return this.readNote(targetNoteId);
    }

    await this.moveNoteAtomically(sourcePath, targetPath, content);
    return this.readNote(targetNoteId);
  }

  async deleteNote(noteId: string): Promise<void> {
    try {
      await this.fileSystem.unlink(this.resolveNotePath(noteId));
    } catch (error) {
      throw normalizeNoteError(error);
    }
  }

  async createFolder(payload: CreateFolderInput): Promise<VaultFolder> {
    const folderPath = this.normalizeFolderPath(payload.path);
    if (!folderPath) {
      throw new MarkdownVaultError(400, "Folder path is required");
    }

    await this.fileSystem.mkdir(this.resolveFolderPath(folderPath), { recursive: true });
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

    await this.fileSystem.mkdir(path.dirname(targetDirectory), { recursive: true });
    await this.fileSystem.rename(sourceDirectory, targetDirectory);
    return folderFromPath(targetFolderPath);
  }

  async deleteFolder(folderPath: string): Promise<void> {
    const normalizedFolderPath = this.normalizeFolderPath(folderPath);
    if (!normalizedFolderPath) {
      throw new MarkdownVaultError(400, "Folder path is required");
    }

    const directory = this.resolveFolderPath(normalizedFolderPath);
    await this.ensureFolderExists(directory);

    const entries = await this.fileSystem.readdir(directory);
    if (entries.length > 0) {
      throw new MarkdownVaultError(409, "Folder is not empty");
    }

    await this.fileSystem.rmdir(directory);
  }

  private async readNote(noteId: string): Promise<VaultNote> {
    const filePath = this.resolveNotePath(noteId);
    let content: string;
    let stats: import("node:fs").Stats;

    try {
      [content, stats] = await Promise.all([
        this.fileSystem.readFile(filePath, "utf8"),
        this.fileSystem.stat(filePath),
      ]);
    } catch (error) {
      throw normalizeNoteError(error);
    }

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
    const temporaryPath = await this.writeTemporaryFile(directory, path.basename(filePath), content);
    await this.fileSystem.rename(temporaryPath, filePath);
  }

  private async walkMarkdownFiles(relativeDirectory = ""): Promise<string[]> {
    const directory = this.resolveFolderPath(relativeDirectory);
    const entries = await this.readDirectoryEntries(directory);
    const files: string[] = [];

    for (const entry of entries) {
      const relativePath = joinRelativePath(relativeDirectory, entry.name);
      if (this.isExcluded(relativePath, entry.isDirectory())) {
        continue;
      }

      if (entry.isDirectory()) {
        files.push(...await this.walkMarkdownFiles(relativePath));
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".md") && this.isIncluded(relativePath)) {
        files.push(relativePath);
      }
    }

    return files;
  }

  private async walkFolders(relativeDirectory = ""): Promise<VaultFolder[]> {
    const directory = this.resolveFolderPath(relativeDirectory);
    const entries = await this.readDirectoryEntries(directory);
    const folders: VaultFolder[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const folderPath = joinRelativePath(relativeDirectory, entry.name);
      if (this.isExcluded(folderPath, true)) {
        continue;
      }

      folders.push(folderFromPath(folderPath));
      folders.push(...await this.walkFolders(folderPath));
    }

    return folders;
  }

  private async readMarkdownEntriesInFolder(folderPath: string): Promise<string[]> {
    const directory = this.resolveFolderPath(folderPath);

    try {
      const entries = await this.fileSystem.readdir(directory, { withFileTypes: true });
      return entries
        .filter((entry) => {
          if (!entry.isFile() || !entry.name.endsWith(".md")) {
            return false;
          }

          const relativePath = joinRelativePath(folderPath, entry.name);
          return !this.isExcluded(relativePath, false) && this.isIncluded(relativePath);
        })
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
      const stats = await this.fileSystem.stat(directory);
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

  private async moveNoteAtomically(
    sourcePath: string,
    targetPath: string,
    content: string
  ): Promise<void> {
    const targetDirectory = path.dirname(targetPath);
    const targetFileName = path.basename(targetPath);
    await this.fileSystem.mkdir(targetDirectory, { recursive: true });

    const temporaryTargetPath = await this.writeTemporaryFile(targetDirectory, targetFileName, content);
    const backupPath = createTemporaryPath(path.dirname(sourcePath), path.basename(sourcePath), "rename-backup");

    try {
      await this.fileSystem.rename(sourcePath, backupPath);
    } catch (error) {
      await this.cleanupTemporaryFile(temporaryTargetPath);
      throw normalizeNoteError(error);
    }

    try {
      await this.fileSystem.rename(temporaryTargetPath, targetPath);
    } catch (error) {
      await this.rollbackSourceRename(backupPath, sourcePath);
      await this.cleanupTemporaryFile(temporaryTargetPath);
      throw normalizeNoteError(error);
    }

    await this.cleanupTemporaryFile(backupPath);
  }

  private async writeTemporaryFile(
    directory: string,
    fileName: string,
    content: string
  ): Promise<string> {
    const temporaryPath = createTemporaryPath(directory, fileName, "tmp");
    await this.fileSystem.mkdir(directory, { recursive: true });
    await this.fileSystem.writeFile(temporaryPath, content, "utf8");
    return temporaryPath;
  }

  private async cleanupTemporaryFile(filePath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(filePath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
    }
  }

  private async rollbackSourceRename(backupPath: string, sourcePath: string): Promise<void> {
    try {
      await this.fileSystem.rename(backupPath, sourcePath);
    } catch {
      // Best effort rollback. Preserve the original write error as the user-facing cause.
    }
  }

  private async readDirectoryEntries(directory: string): Promise<import("node:fs").Dirent[]> {
    try {
      return await this.fileSystem.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  private isIncluded(relativePath: string): boolean {
    if (!this.options.includeGlobs || this.options.includeGlobs.length === 0) {
      return true;
    }

    return this.options.includeGlobs.some((pattern) => matchesGlob(relativePath, pattern));
  }

  private isExcluded(relativePath: string, isDirectory: boolean): boolean {
    const excludeGlobs = this.options.excludeGlobs;
    if (!excludeGlobs || excludeGlobs.length === 0) {
      return false;
    }

    const normalizedPath = normalizeGlobPath(relativePath);
    const pathWithDirectoryMarker = isDirectory ? `${normalizedPath}/.dir` : normalizedPath;
    return excludeGlobs.some((pattern) =>
      matchesGlob(pathWithDirectoryMarker, pattern) || matchesGlob(normalizedPath, pattern)
    );
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

function isMarkdownVaultFileSystem(value: MarkdownVaultConstructorOptions): value is MarkdownVaultFileSystem {
  return typeof value === "object"
    && value !== null
    && "readdir" in value
    && typeof value.readdir === "function";
}

function normalizeVaultOptions(options: MarkdownVaultOptions): MarkdownVaultOptions {
  return {
    includeGlobs: normalizeGlobList(options.includeGlobs),
    excludeGlobs: normalizeGlobList([
      ...DEFAULT_EXCLUDE_GLOBS,
      ...(options.excludeGlobs ?? []),
    ]),
  };
}

function normalizeGlobList(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  const normalized = values
    .map((value) => value.trim())
    .filter((value, index, items) => value.length > 0 && items.indexOf(value) === index);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeGlobPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
}

function matchesGlob(targetPath: string, pattern: string): boolean {
  const normalizedTarget = normalizeGlobPath(targetPath);
  const normalizedPattern = normalizeGlobPath(pattern);
  const regex = globToRegExp(normalizedPattern);
  return regex.test(normalizedTarget);
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const current = pattern[index];
    const next = pattern[index + 1];

    if (current === "*") {
      if (next === "*") {
        const nextNext = pattern[index + 2];
        if (nextNext === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
        continue;
      }

      source += "[^/]*";
      continue;
    }

    if (current === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(current);
  }

  source += "$";
  return new RegExp(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
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

function createTemporaryPath(directory: string, fileName: string, suffix: string): string {
  return path.join(
    directory,
    `.${fileName}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.${suffix}`
  );
}

function normalizeNoteError(error: unknown): Error {
  if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
    return new MarkdownVaultError(404, "Note not found");
  }

  return error instanceof Error ? error : new MarkdownVaultError(500, "Internal server error");
}
