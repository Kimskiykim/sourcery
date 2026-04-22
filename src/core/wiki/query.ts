import type { WorkspaceNote } from "../workspace/types.js";
import type { WikiMetadata } from "./wiki-sdk.js";

export function matchesNoteQuery(
  note: WorkspaceNote,
  metadata: WikiMetadata,
  rawQuery: string
): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return true;
  }

  if (query.startsWith("#") && !query.includes(" ")) {
    const tag = query.slice(1);
    return metadata.tags.includes(tag);
  }

  const haystack = `${note.title}\n${note.content}`.toLowerCase();
  return haystack.includes(query);
}
