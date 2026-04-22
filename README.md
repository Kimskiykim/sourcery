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
- исходники в `src/app.ts` и `src/server.ts`
- Obsidian-like compatibility layer для будущих плагинов и интеграций

## Запуск

```bash
npm install
npm run build
npm start
```

После этого откройте `http://127.0.0.1:4173`.

## Tests

```bash
npm test
```

Сейчас тестовый контур покрывает:

- `src/core/storage/*`
- `src/core/workspace/*`
- `src/core/wiki/*`

## Как это работает

- `src/server.ts` поднимает локальный HTTP-сервер
- заметки лежат в папке `vault/` как отдельные `.md` файлы
- фронтенд работает через API `/api/notes`
- браузерный runtime собирается в `dist/app.js`

## Архитектура

- `src/core/storage/*`:
  markdown storage layer, source of truth в `.md` файлах
- `src/core/workspace/*`:
  workspace operations и transport-контракты
- `src/core/wiki/*`:
  wiki-логика поверх markdown-notes
- `src/compat/obsidian/*`:
  минимальный `Obsidian-like API v0`: `App`, `Vault`, `Workspace`, `MetadataCache`, `Plugin`
- `src/sdk/*`:
  временные compatibility re-exports для старого пути импорта

Смысл разделения такой:

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
