import { promises as fs } from "node:fs";
import path from "node:path";

import type { AppMemoryDocument } from "./types.js";

interface AppMemoryFileSystem {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  rename(oldPath: string, newPath: string): Promise<void>;
  stat(path: string): Promise<import("node:fs").Stats>;
  unlink(path: string): Promise<void>;
  writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;
}

export class AppMemoryStore {
  constructor(
    private readonly memoryDir: string,
    private readonly fileSystem: AppMemoryFileSystem = fs
  ) {}

  async readGlobalMemory(): Promise<AppMemoryDocument> {
    return this.readDocument("global", null);
  }

  async writeGlobalMemory(content: string): Promise<AppMemoryDocument> {
    return this.writeDocument("global", null, content);
  }

  async deleteGlobalMemory(): Promise<void> {
    await this.deleteDocument(this.resolveDocumentPath("global", null));
  }

  async readWorkspaceMemory(connectionId: string): Promise<AppMemoryDocument> {
    return this.readDocument("workspace", connectionId);
  }

  async writeWorkspaceMemory(connectionId: string, content: string): Promise<AppMemoryDocument> {
    return this.writeDocument("workspace", connectionId, content);
  }

  async deleteWorkspaceMemory(connectionId: string): Promise<void> {
    await this.deleteDocument(this.resolveDocumentPath("workspace", connectionId));
  }

  private async readDocument(
    scope: AppMemoryDocument["scope"],
    connectionId: string | null
  ): Promise<AppMemoryDocument> {
    const filePath = this.resolveDocumentPath(scope, connectionId);

    try {
      const [content, stats] = await Promise.all([
        this.fileSystem.readFile(filePath, "utf8"),
        this.fileSystem.stat(filePath),
      ]);

      return {
        scope,
        connectionId,
        content,
        exists: true,
        createdAt: stats.birthtime.toISOString(),
        updatedAt: stats.mtime.toISOString(),
      };
    } catch (error) {
      if (isMissingFileError(error)) {
        return {
          scope,
          connectionId,
          content: "",
          exists: false,
          createdAt: null,
          updatedAt: null,
        };
      }

      throw error;
    }
  }

  private async writeDocument(
    scope: AppMemoryDocument["scope"],
    connectionId: string | null,
    content: string
  ): Promise<AppMemoryDocument> {
    const filePath = this.resolveDocumentPath(scope, connectionId);
    await this.fileSystem.mkdir(path.dirname(filePath), { recursive: true });
    await this.writeFileAtomically(filePath, content);
    return this.readDocument(scope, connectionId);
  }

  private async deleteDocument(filePath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(filePath);
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }

      throw error;
    }
  }

  private async writeFileAtomically(filePath: string, content: string): Promise<void> {
    const directory = path.dirname(filePath);
    const baseName = path.basename(filePath);
    const tempPath = path.join(directory, `.${baseName}.${process.pid}.${Date.now()}.tmp`);
    await this.fileSystem.writeFile(tempPath, content, "utf8");
    await this.fileSystem.rename(tempPath, filePath);
  }

  private resolveDocumentPath(scope: AppMemoryDocument["scope"], connectionId: string | null): string {
    if (scope === "global") {
      return path.join(this.memoryDir, "global.md");
    }

    return path.join(this.memoryDir, "workspaces", `${encodeWorkspaceId(connectionId)}.md`);
  }
}

function encodeWorkspaceId(connectionId: string | null): string {
  if (typeof connectionId !== "string" || !connectionId.trim()) {
    throw new Error("connectionId is required");
  }

  return encodeURIComponent(connectionId.trim());
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
