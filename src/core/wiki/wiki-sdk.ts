import type { WorkspaceNote } from "../workspace/types.js";

export interface WikiLink {
  link: string;
}

export interface WikiMetadata {
  links: WikiLink[];
  backlinks: string[];
  tags: string[];
}

const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/g;
const HASHTAG_PATTERN = /(^|[\s(])#([\p{L}\p{N}_/-]+)/gu;

export class WikiSDK {
  extractLinks(content: string): WikiLink[] {
    const links: WikiLink[] = [];

    for (const match of content.matchAll(WIKILINK_PATTERN)) {
      const link = match[1]?.trim();
      if (link) {
        links.push({ link });
      }
    }

    return links;
  }

  extractTags(content: string): string[] {
    const tags = new Set<string>();
    const frontmatterTags = extractFrontmatterTags(content);

    frontmatterTags.forEach((tag) => {
      tags.add(tag);
    });

    for (const match of content.matchAll(HASHTAG_PATTERN)) {
      const tag = match[2]?.trim().toLowerCase();
      if (tag) {
        tags.add(tag);
      }
    }

    return [...tags];
  }

  getBacklinks(target: WorkspaceNote, notes: WorkspaceNote[]): WorkspaceNote[] {
    return notes.filter((note) =>
      this.extractLinks(note.content).some((link) => link.link.toLowerCase() === target.title.toLowerCase())
    );
  }

  getMetadata(note: WorkspaceNote, notes: WorkspaceNote[]): WikiMetadata {
    return {
      links: this.extractLinks(note.content),
      backlinks: this.getBacklinks(note, notes).map((item) => item.id),
      tags: this.extractTags(note.content),
    };
  }

  buildResolvedLinks(notes: WorkspaceNote[]): Record<string, Record<string, number>> {
    const resolvedLinks: Record<string, Record<string, number>> = {};

    notes.forEach((note) => {
      const outgoing: Record<string, number> = {};
      this.extractLinks(note.content).forEach(({ link }) => {
        const target = notes.find((item) => item.title.toLowerCase() === link.toLowerCase());
        if (!target) {
          return;
        }

        outgoing[target.id] = (outgoing[target.id] ?? 0) + 1;
      });
      resolvedLinks[note.id] = outgoing;
    });

    return resolvedLinks;
  }
}

function extractFrontmatterTags(content: string): string[] {
  const frontmatter = extractFrontmatter(content);
  if (!frontmatter) {
    return [];
  }

  const lines = frontmatter.split(/\r?\n/);
  const tags = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line || !line.toLowerCase().startsWith("tags:")) {
      continue;
    }

    const inlineValue = line.slice(line.indexOf(":") + 1).trim();
    if (inlineValue.startsWith("[")) {
      parseInlineTagList(inlineValue).forEach((tag) => tags.add(tag));
      continue;
    }

    if (inlineValue) {
      normalizeFrontmatterTag(inlineValue).forEach((tag) => tags.add(tag));
      continue;
    }

    for (let offset = index + 1; offset < lines.length; offset += 1) {
      const item = lines[offset];
      if (!/^\s*-\s+/.test(item)) {
        break;
      }

      normalizeFrontmatterTag(item.replace(/^\s*-\s+/, "")).forEach((tag) => tags.add(tag));
      index = offset;
    }
  }

  return [...tags];
}

function extractFrontmatter(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match?.[1] ?? null;
}

function parseInlineTagList(rawValue: string): string[] {
  const inner = rawValue.trim().replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .flatMap((part) => normalizeFrontmatterTag(part));
}

function normalizeFrontmatterTag(rawValue: string): string[] {
  const cleaned = rawValue
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/^#/, "")
    .toLowerCase();

  if (!cleaned) {
    return [];
  }

  return cleaned.split(/\s+/).filter(Boolean);
}
