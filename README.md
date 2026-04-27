# Sourcery

Sourcery — минимальный веб-клон Obsidian с TypeScript и хранением заметок в `.md` файлах.

Основные инженерные правила проекта описаны в `DEVELOPMENT_GUIDELINES.md`.
Продуктовый план развития описан в `PRODUCT_ROADMAP.md`.
Пользовательские изменения фиксируются в `CHANGELOG.md`.
Технические архитектурные решения фиксируются в `ENGINEERING_LOG.md`.

## Возможности

- список заметок и поиск
- папки и группировка vault по папкам
- markdown-редактор
- live preview
- wikilinks `[[Note]]`
- hashtags `#tag`
- backlinks panel
- локальный markdown vault в папке `vault/`
- вложенные markdown-файлы в подпапках `vault/`
- встроенный Node API для чтения и записи заметок
- автообновление при внешних изменениях markdown-файлов
- best-effort сохранение при закрытии вкладки
- отдельная `app memory` вне подключаемых `vault` и `notesRoot`
- переключение интерфейса между русским и английским языком
- исходники в `src/app.ts` и `src/server.ts`
- Obsidian-like compatibility layer для будущих плагинов и интеграций

## Запуск

```bash
npm install
npm run build
npm start
```

После этого откройте `http://127.0.0.1:4173`.
Язык интерфейса переключается кнопкой `RU/EN` в верхней панели.

## Tests

```bash
npm test
```

UI smoke test:

```bash
npm run smoke:ui
```

Full local verification:

```bash
npm run verify
```

Сейчас тестовый контур покрывает:

- `src/core/storage/*`
- `src/core/workspace/*`
- `src/core/wiki/*`
- browser smoke для загрузки UI, открытия заметки, editor/preview, search, Graph и Memory

## AI Assistants

Проект уже подготовлен для работы с кодовыми ассистентами:

- `AGENTS.md`:
  нейтральные инструкции для Codex, Claude Code, Cursor и других агентных инструментов
- `AGENT_INTEGRATION.md`:
  onboarding для внешних кодовых агентов и MCP/HTTP-интеграции с Sourcery
- `.github/copilot-instructions.md`:
  инструкции для GitHub Copilot
- `CLAUDE.md`:
  отдельный onboarding-файл для Claude Code

Быстрый workflow для ассистента:

```bash
npm install
npm test
npm start
```

Для безопасных изменений ассистенту стоит сначала читать `README.md`, `AGENTS.md` и `DEVELOPMENT_GUIDELINES.md`.

## Как это работает

- `src/server.ts` поднимает локальный HTTP-сервер
- заметки лежат в папке `vault/` как отдельные `.md` файлы
- память приложения хранится локально в `.obsidian-lite/memory/` и не смешивается с `vault`
- фронтенд работает через API `/api/notes`
- браузерный runtime собирается в `dist/app.js`

## Архитектура

- `src/core/storage/*`:
  markdown storage layer, source of truth в `.md` файлах
- `src/core/memory/*`:
  app-owned memory layer для global/workspace memory вне подключённых markdown roots
- `src/core/workspace/*`:
  workspace operations и transport-контракты
- `src/core/wiki/*`:
  wiki-логика поверх markdown-notes
- `src/compat/obsidian/*`:
  минимальный `Obsidian-like API v0`: `App`, `Vault`, `Workspace`, `MetadataCache`, `Plugin`
- `src/sdk/*`:
  временные compatibility re-exports для старого пути импорта

Смысл разделения такой:

- `App Memory` отвечает за локальную память самого приложения и пользователя вне knowledge graph
- `Workspace SDK` отвечает за рабочее окружение редактора
- `Wiki SDK` отвечает за knowledge-layer
- `compat/obsidian` даёт похожий на Obsidian surface API, не делая проект зависимым от их внутренних реализаций

## Development

- `DEVELOPMENT_GUIDELINES.md`:
  production-first режим разработки, TDD, KISS, SOLID и правила для архитектурных слоёв
- `PRODUCT_ROADMAP.md`:
  полный продуктовый roadmap для markdown-first Obsidian-alternative с graph view и git-friendly storage
- `CHANGELOG.md`:
  пользовательский журнал изменений
- `ENGINEERING_LOG.md`:
  технический журнал архитектурных решений и эволюции проекта

## Vault

Примеры заметок создаются в:

- `vault/Welcome.md`
- `vault/Ideas.md`
