export type AppMemoryScope = "global" | "workspace";

export interface AppMemoryDocument {
  scope: AppMemoryScope;
  connectionId: string | null;
  content: string;
  exists: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UpdateAppMemoryInput {
  content: string;
}
