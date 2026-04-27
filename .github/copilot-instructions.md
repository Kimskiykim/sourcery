# GitHub Copilot Instructions

## Project Summary

Sourcery is a markdown-first web knowledge base inspired by Obsidian.
Notes live as plain `.md` files in `vault/`, which is the single source of truth.
The app derives wikilinks, backlinks, tags, and graph data from markdown content at runtime.

## Commands

```bash
npm install
npm run build
npm run watch
npm start
npm test
```

Server default URL: `http://127.0.0.1:4173`

## Architecture Rules

- Respect the layer order:
  `app.ts` -> `server.ts` -> `compat/obsidian` -> `core/workspace` -> `core/wiki` -> `core/storage` -> `vault/`
- Do not move domain logic into UI or transport.
- Do not treat compat code as the core domain model.
- Keep markdown files in `vault/` as primary storage.

## Engineering Expectations

- Prefer TDD for storage, workspace, wiki, and HTTP API behavior.
- Add tests for non-trivial behavior changes.
- Keep save, rename, and conflict handling deterministic.
- Update documentation if contracts or workflows change.
