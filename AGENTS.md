# AGENTS.md

This repository is prepared for AI coding assistants such as Codex, Claude Code, Cursor, and GitHub Copilot.

## Project Overview

**Sourcery** is a markdown-first web knowledge base inspired by Obsidian.
Notes are stored as plain `.md` files inside `vault/`.
There is no database. The graph layer (`[[wikilinks]]`, backlinks, hashtags) is derived from file content at runtime.

## Setup

```bash
npm install
npm run build
npm start
```

Open `http://127.0.0.1:4173`.

## Commands

```bash
npm install          # install dependencies
npm run build        # compile TypeScript to dist/
npm run watch        # TypeScript watch mode
npm start            # start local HTTP server on port 4173
npm test             # build and run all tests
```

Run a single compiled test file:

```bash
node --test dist/core/storage/markdown-vault.test.js
```

## Architecture

Dependency direction is strict:

```text
app.ts (browser UI)
  -> server.ts (HTTP transport)
  -> compat/obsidian/ (compatibility facade)
  -> core/workspace/ (workspace operations and revisions)
  -> core/wiki/ (wikilinks, tags, backlinks, graph queries)
  -> core/storage/ (file I/O against vault/)
  -> vault/ (source of truth)
```

Key rules:

- `vault/` is the only source of truth.
- UI must not depend on filesystem details.
- Transport must not contain domain logic.
- `compat/obsidian` is a facade, not the domain core.
- If storage/indexing expands later, markdown files remain primary storage.

## Working Rules

- Prefer TDD for `src/core/storage/*`, `src/core/workspace/*`, `src/core/wiki/*`, and HTTP API behavior.
- Add or update tests for any non-trivial domain or transport change.
- Keep modules small and responsibilities explicit.
- Preserve predictable save, rename, and conflict behavior.
- Update docs when contracts or development rules change.

## Important Paths

- `src/server.ts`: HTTP API and static serving
- `src/app.ts`: browser UI runtime
- `AGENT_INTEGRATION.md`: what Sourcery exposes to external coding agents over HTTP and MCP
- `src/core/storage/`: markdown file storage
- `src/core/workspace/`: workspace state and operations
- `src/core/wiki/`: tags, wikilinks, backlinks, graph logic
- `src/compat/obsidian/`: compatibility surface
- `README.md`: human-facing project overview
- `DEVELOPMENT_GUIDELINES.md`: engineering rules
- `ENGINEERING_LOG.md`: architectural decisions
- `CHANGELOG.md`: user-visible changes

## Assistant Workflow

When making changes:

1. Read `README.md` and this file first.
2. Inspect the relevant layer instead of patching blindly from the UI downward.
3. Run `npm test` after meaningful changes.
4. If behavior changes for users or contributors, update the relevant docs.
