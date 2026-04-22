# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Sourcery** — a web-based markdown-first knowledge base. Notes are stored as plain `.md` files in `vault/`, making them git-friendly and readable outside the app. The knowledge graph (wikilinks, backlinks, hashtags) is derived at runtime from file content — there is no database.

## Commands

```bash
npm install          # install dependencies
npm run build        # compile TypeScript → dist/
npm run watch        # TypeScript watch mode
npm start            # start HTTP server on port 4173 (override with PORT env var)
npm test             # build then run all tests
```

Run a single test file:
```bash
node --test dist/core/storage/markdown-vault.test.js
```

## Architecture

Strict layer hierarchy — dependencies flow downward only:

```
app.ts (browser UI)
    ↓
server.ts (HTTP transport, port 4173)
    ↓
compat/obsidian/ (Obsidian-like surface API — not the domain core)
    ↓
core/workspace/ (workspace abstraction, revision tracking)
    ↓
core/wiki/ (wikilink/hashtag extraction, backlink computation)
    ↓
core/storage/ (atomic file I/O against vault/)
    ↓
vault/ (source of truth — plain .md files)
```

**Key constraint:** `vault/` is the only source of truth. If SQLite is ever added, it must be a cache/index only.

### Module responsibilities

| Module | Role |
|--------|------|
| `src/core/storage/markdown-vault.ts` | Atomic read/write of `.md` files; temp-file-then-rename pattern |
| `src/core/workspace/workspace-sdk.ts` | CRUD abstraction over vault; snapshot and revision tracking |
| `src/core/wiki/wiki-sdk.ts` | Extracts `[[wikilinks]]` and `#hashtags`; computes backlinks |
| `src/core/workspace/http-workspace-client.ts` | Browser-side HTTP client implementing `WorkspaceGateway` |
| `src/server.ts` | Routes `/api/*` REST endpoints; serves static files; watches vault for external changes |
| `src/compat/obsidian/` | Thin Obsidian-compatible facade — wraps workspace + wiki; **not** a faithful clone |
| `src/app.ts` | DOM state, markdown rendering, save debouncing (350ms content / 900ms title), polling every 2s |

### API surface (server.ts)

`GET/POST /api/notes`, `PUT/DELETE /api/notes/{noteId}`, `GET/POST /api/folders`, `GET /api/workspace/state`

## Engineering Rules

These come from `DEVELOPMENT_GUIDELINES.md` and must be followed:

- **TDD is mandatory** for `core/storage`, `core/workspace`, `core/wiki`, HTTP API, and save/rename/conflict flows. New features without tests are only allowed for trivial UI-only changes with no domain logic.
- **Layer separation is strict:** UI must not know filesystem details; transport must not contain domain logic; compat layer must not become the domain core.
- **Save guarantees:** any change to note lifecycle must account for flush-before-close, predictable rename behavior, no silent data loss, and explicit save status.
- **Error model:** domain errors must have clear contracts; HTTP errors must map deterministically.
- **Obsidian compat policy:** we replicate only the useful surface API — do not build core logic around accidental compat-layer constraints.

## Testing

Tests use Node.js native test runner (`node --test`). Test files live alongside source as `*.test.ts`, compiled to `dist/**/*.test.js`.

Coverage is required for: `core/storage`, `core/workspace`, `core/wiki`, and HTTP API transport behavior.
