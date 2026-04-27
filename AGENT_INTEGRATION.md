# Agent Integration Guide

Этот файл описывает Sourcery как среду для внешнего кодового или knowledge-агента: что проект ему даёт, как к нему подключаться и какие ограничения важно учитывать.

## Что Такое Sourcery Для Агента

Sourcery — локальная markdown-first knowledge base.

Для агента это не "ещё одна база данных", а thin runtime над папкой с `.md` файлами:

- source of truth — markdown-файлы в `vault/` или в подключённом `notesRoot`
- wikilinks `[[...]]`, hashtags `#...`, backlinks и graph derived at runtime
- есть локальный HTTP API для чтения и управления workspace
- есть MCP server по `stdio` для агентных клиентов
- есть workspace connections: агент может работать не только с одним vault, а с несколькими подключёнными markdown roots
- есть session/tabs model: агент может видеть, какие заметки открыты в UI, и открывать нужные заметки в табах
- есть app memory вне vault: отдельное хранилище для памяти приложения, не смешанное с knowledge graph

Проект рассчитан на local-first сценарий. В текущем виде это localhost/runtime integration, а не multi-tenant SaaS API.

## Для Чего Агенту Подходит Sourcery

Sourcery полезен, если агенту нужно:

- искать заметки по тексту и `#tag`
- читать markdown-заметки вместе с метаданными wiki-слоя
- получать backlinks по заметке
- получать graph summary по knowledge base
- собирать context pack по нескольким workspace connections
- ориентироваться в текущей UI session через tabs/open notes
- работать напрямую с markdown source of truth, а не с opaque database

Практически это удобно для:

- research-агентов
- coding-агентов, которым нужен проектовый knowledge layer
- документационных агентов
- ADR/decision-log workflow
- personal/company wiki copilots

## Что Агент Не Должен Предполагать

- Sourcery не использует database как primary storage.
- `compat/obsidian` не означает полную бинарную или plugin-совместимость с Obsidian.
- UI не является authority для прав записи.
- Встроенный agent API по умолчанию read-first: запись заметок отключена policy.

Если агент уже имеет filesystem-доступ к разрешённой markdown-папке, он может менять `.md` напрямую. Sourcery должен подхватить изменения через watcher/revision-механизм.

## Быстрый Старт

### 1. Запуск UI + HTTP API

```bash
npm install
npm run build
npm start
```

По умолчанию сервер поднимается на:

```text
http://127.0.0.1:4173
```

После этого агент может ходить в HTTP API.

### 2. Запуск MCP Server

```bash
npm install
npm run build
npm run mcp
```

`npm run mcp` запускает MCP transport через `stdio`.
Это основной способ подключать Sourcery к внешнему агенту как MCP server.

## Способы Подключения

### Вариант 1. HTTP API

Подходит, если агент умеет вызывать локальные HTTP endpoints.

Основные agent endpoints:

- `GET /api/agent/capabilities`
- `GET /api/agent/connections`
- `GET /api/agent/notes?query=...&connectionId=...&limit=...`
- `POST /api/agent/notes/read`
- `POST /api/agent/context`
- `GET /api/agent/backlinks?noteId=...&connectionId=...`
- `GET /api/agent/graph/summary?connectionId=...`
- `GET /api/agent/session?connectionId=...`
- `POST /api/agent/tabs/open`

Примеры:

```bash
curl http://127.0.0.1:4173/api/agent/capabilities
```

```bash
curl "http://127.0.0.1:4173/api/agent/notes?query=%23backend&limit=10"
```

```bash
curl -X POST http://127.0.0.1:4173/api/agent/notes/read \
  -H "Content-Type: application/json" \
  -d '{"noteRef":{"connectionId":"default","noteId":"Welcome.md"}}'
```

```bash
curl -X POST http://127.0.0.1:4173/api/agent/context \
  -H "Content-Type: application/json" \
  -d '{"query":"#backend","limit":10}'
```

### Вариант 2. MCP

Подходит, если агентный клиент умеет MCP и предпочитает tools/resources/prompts вместо ручной работы с HTTP.

После сборки MCP server можно подключать как stdio command. Типовой конфиг:

```json
{
  "mcpServers": {
    "sourcery": {
      "command": "node",
      "args": ["dist/mcp.js"],
      "cwd": "/absolute/path/to/obsidian_md_custom"
    }
  }
}
```

Если клиент сам умеет выполнять npm scripts, можно использовать и `npm run mcp`, но `node dist/mcp.js` обычно проще и стабильнее.

### MCP Runtime Environment

Для тестового или embedded запуска MCP entrypoint можно переопределить локальные пути:

```bash
SOURCERY_ROOT_DIR=/absolute/path/to/obsidian_md_custom \
SOURCERY_VAULT_DIR=/absolute/path/to/vault \
SOURCERY_APP_STATE_DIR=/absolute/path/to/.obsidian-lite \
node dist/mcp.js
```

По умолчанию MCP запускается в read-only agent mode. Чтобы явно включить agent write tools:

```bash
SOURCERY_AGENT_ALLOW_NOTE_WRITES=1 node dist/mcp.js
```

Проверить end-to-end MCP готовность можно командой:

```bash
npm run smoke:agent
```

## Что Проект Предоставляет Через MCP

### Tools

Sourcery MCP server сейчас предоставляет такие tools:

- `connections.list`
- `notes.search`
- `notes.read`
- `notes.backlinks`
- `graph.summary`
- `session.get`
- `tabs.open`
- `context.pack`

Интерфейсы записи тоже существуют:

- `notes.create`
- `notes.update`

Но в стандартной конфигурации они отключены policy и не будут доступны, пока embedding не включит `allowNoteWrites`.
Для stdio MCP entrypoint это соответствует `SOURCERY_AGENT_ALLOW_NOTE_WRITES=1`.

### Resources

MCP resources полезны для bootstrap и быстрого чтения общей картины:

- `sourcery://capabilities`
- `sourcery://connections`
- `sourcery://context/overview`
- `sourcery://session/default`

Есть и template resources:

- `sourcery://context/{connectionId}`
- `sourcery://session/{connectionId}`

### Prompts

Встроенные MCP prompts:

- `project-context-bootstrap`
- `adr-bootstrap`

Их цель — быстро передать внешнему агенту рабочий контекст без ручной сборки note list.

## Базовая Модель Данных Для Агента

### Workspace Connection

Connection описывает отдельный markdown-root, с которым может работать агент.

Ключевые поля:

- `id`
- `name`
- `kind`
- `rootPath`
- `notesRoot`
- `codeRoot`
- `includeGlobs`
- `excludeGlobs`

Если `connectionId` не указан, обычно используется default connection.

### Note Reference

Идентификатор заметки передаётся как:

```json
{
  "connectionId": "default",
  "noteId": "Welcome.md"
}
```

`noteId` — это workspace-relative markdown id, а не database UUID.

## Практический Порядок Работы Для Агента

Рекомендуемый bootstrap:

1. Прочитать capabilities или вызвать `connections.list`.
2. Получить `context.pack` без query или с целевым `#tag`/текстом.
3. При необходимости дочитать конкретные заметки через `notes.read`.
4. Использовать `backlinks` и `graph.summary`, если важна навигация по knowledge graph.
5. Использовать `tabs.open`, если агент должен синхронизировать контекст с UI пользователя.

Если агенту нужен polling на внешние изменения, можно читать:

- `GET /api/workspace/state`

Это удобно для lightweight sync-loop поверх локального knowledge base.

## Политика Записи

Важно: в дефолтном `createAppContext()` agent writes выключены:

- `allowNoteWrites: false`

Это значит:

- `notes.create` и `notes.update` недоступны по policy
- стандартный HTTP/MCP runtime безопасен как read-first integration

Если вы встраиваете Sourcery в свой runtime и хотите разрешить запись заметок агенту, policy нужно включить явно.

Минимальный пример для собственного старта HTTP server после сборки:

```js
import { createAppContext, startAppServer } from "./dist/server.js";

const context = createAppContext({
  agentPolicy: { allowNoteWrites: true },
});

await startAppServer({ context, host: "127.0.0.1", port: 4173 });
```

В таком режиме агент сможет использовать `notes.create` и `notes.update`.

## Дополнительно: Память Приложения

У Sourcery есть отдельная app-owned memory вне vault:

- `GET/PUT/DELETE /api/memory/global`
- `GET/PUT/DELETE /api/memory/workspace?connectionId=...`

Это полезно, если агенту нужен рабочий state, который не должен становиться частью knowledge graph или пользовательских markdown notes.

## Ограничения И Ожидания

- Это локальный сервер без встроенной auth-модели для внешней сети.
- Основной сценарий — localhost или controlled runtime.
- При интеграции агент не должен считать transport слоем доменной логики.
- Для сложных изменений в core/storage, core/workspace, core/wiki и HTTP API проект ожидает тесты.

## Что Читать Агенту Сначала

Если агент собирается не только использовать Sourcery как API, но и менять кодовую базу, стартовый набор такой:

1. `README.md`
2. `AGENTS.md`
3. `DEVELOPMENT_GUIDELINES.md`
4. `src/server.ts`
5. `src/core/agent/*`

Если нужна именно внешняя интеграция, а не разработка внутри репозитория, достаточно начать с этого файла и потом перейти к:

- `src/mcp.ts`
- `src/server.ts`
- `src/core/agent/agent-sdk.ts`
- `src/core/agent/mcp-server.ts`
