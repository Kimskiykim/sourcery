export type MemorySaveScope = "global" | "workspace";

const ALL_MEMORY_SAVE_SCOPES: MemorySaveScope[] = ["global", "workspace"];

export function resolveMemorySaveScopes(scopes?: MemorySaveScope[]): MemorySaveScope[] {
  return scopes ?? ALL_MEMORY_SAVE_SCOPES;
}

export function didEverySaveSucceed(results: boolean[]): boolean {
  return results.every(Boolean);
}

export function shouldSkipMemorySave(input: {
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  requiresConnection: boolean;
  hasConnection: boolean;
}): boolean {
  if (input.isLoading || input.isSaving) {
    return true;
  }

  if (input.requiresConnection && !input.hasConnection) {
    return true;
  }

  return !input.isDirty;
}
