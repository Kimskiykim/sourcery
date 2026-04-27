import type { WorkspaceNote } from "../workspace/types.js";

export interface WikiLink {
  link: string;
}

export interface WikiMetadata {
  links: WikiLink[];
  backlinks: string[];
  tags: string[];
}

export interface WikiLinkIndex {
  byTitle: Map<string, WorkspaceNote[]>;
  byQualifiedPath: Map<string, WorkspaceNote>;
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

  buildLinkIndex(notes: WorkspaceNote[]): WikiLinkIndex {
    const byTitle = new Map<string, WorkspaceNote[]>();
    const byQualifiedPath = new Map<string, WorkspaceNote>();

    notes.forEach((note) => {
      const titleKey = note.title.toLowerCase();
      const titleMatches = byTitle.get(titleKey) ?? [];
      titleMatches.push(note);
      byTitle.set(titleKey, titleMatches);

      byQualifiedPath.set(getQualifiedLinkKey(note.id), note);
    });

    byTitle.forEach((matches) => {
      matches.sort((left, right) => left.id.localeCompare(right.id, "en"));
    });

    return {
      byTitle,
      byQualifiedPath,
    };
  }

  resolveLinkTarget(link: string, linkIndex: WikiLinkIndex): WorkspaceNote | null {
    const normalizedLink = normalizeWikiLinkTarget(link);
    if (!normalizedLink) {
      return null;
    }

    if (normalizedLink.includes("/")) {
      return linkIndex.byQualifiedPath.get(normalizedLink.toLowerCase()) ?? null;
    }

    const matches = linkIndex.byTitle.get(normalizedLink.toLowerCase()) ?? [];
    return matches.length === 1 ? matches[0] ?? null : null;
  }

  getBacklinks(target: WorkspaceNote, notes: WorkspaceNote[]): WorkspaceNote[] {
    const linkIndex = this.buildLinkIndex(notes);
    return notes.filter((note) =>
      this.extractLinks(note.content).some((link) =>
        this.resolveLinkTarget(link.link, linkIndex)?.id === target.id
      )
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
    const linkIndex = this.buildLinkIndex(notes);

    notes.forEach((note) => {
      const outgoing: Record<string, number> = {};
      this.extractLinks(note.content).forEach(({ link }) => {
        const target = this.resolveLinkTarget(link, linkIndex);
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

function normalizeWikiLinkTarget(link: string): string {
  return link
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\.md$/i, "");
}

function getQualifiedLinkKey(noteId: string): string {
  return normalizeSlashPath(noteId).replace(/\.md$/i, "").toLowerCase();
}

function normalizeSlashPath(value: string): string {
  const normalized = value
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .reduce<string[]>((segments, segment) => {
      if (segment === "..") {
        segments.pop();
        return segments;
      }

      segments.push(segment);
      return segments;
    }, [])
    .join("/");

  return normalized;
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
