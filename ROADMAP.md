# Obsidian Replacement Roadmap

## Цель

Собрать локальный open-source аналог Obsidian для внутреннего использования в компании, с упором не только на markdown-редактор, но и на knowledge-workflow в духе идеи Karpathy: raw sources -> wiki -> schema -> ingest/query/lint.

## Текущее состояние

- есть веб-интерфейс редактора и preview
- заметки хранятся как `.md` файлы в `vault/`
- есть локальный Node API
- есть базовый SDK-слой для работы с markdown vault
- есть wikilinks и базовый note management
- есть desktop-local workspace session и typed tabs contract v0
- есть connection-aware backend foundation для нескольких markdown roots

## Целевая архитектура

### 1. Storage Layer

Источник истины: обычные `.md` файлы в `vault/`.

Задачи:
- стабилизировать файловые операции
- добавить атомарные сохранения
- добавить защиту от потери данных
- подготовить optional index layer на `SQLite`, но не делать его primary storage

### 2. Workspace SDK

Это слой "оболочки редактора", аналог среды Obsidian.

Задачи:
- открыть workspace
- список заметок и папок
- создать, переименовать, удалить note
- active note / selection state
- layout state: sidebar, editor, preview, split
- workspace events
- API для UI и будущих расширений

### 2.5. External Workspace Connections

Это слой подключения внешних источников знаний и кода без установки самого приложения внутрь целевого репозитория.

Задачи:
- закрепить `WorkspaceConnection` как основной контракт подключения
- поддержать `code repo`, `markdown vault`, `docs-only folder`
- поддержать сценарий `codeRoot + отдельный notesRoot`
- хранить session state, tabs, connection registry локально в приложении, а не в подключённом repo
- сохранить markdown-файлы source of truth в подключённых папках
- ввести стабильный `NoteRef` / `FolderRef` поверх `connectionId`

Критерий готовности:
- приложение работает как отдельный desktop-layer и подключается к внешним repo/vaults без копирования собственного runtime в них

### 3. Wiki SDK

Это слой knowledge system поверх markdown-файлов.

Задачи:
- `[[wikilinks]]`
- backlinks
- graph relations
- `index.md`
- `log.md`
- schema rules
- wiki lint
- ingest/query workflows

### 4. UI Layer

Это отдельный web client, который потребляет `Workspace SDK` и `Wiki SDK`.

Задачи:
- стабильный editor UX
- inline validation
- status indicators: saved / unsaved / conflict
- note navigation
- backlink and link panels
- command palette
- search UI

## План разработки

### Этап 1. Stabilize Core

Цель: довести текущий прототип до состояния, где им можно пользоваться каждый день без потери заметок.

Задачи:
- исправить все кейсы несохранённых изменений
- добавить flush на закрытие вкладки и на переключение note
- показать явный save status
- нормализовать поведение пустых названий
- убрать оставшиеся UX-артефакты вокруг `Untitled`
- покрыть storage/API smoke tests

Критерий готовности:
- заметки не теряются при перезапуске
- пользователь всегда понимает, сохранена ли заметка

### Этап 2. Extract Workspace SDK

Цель: отделить редакторную оболочку от файлового хранилища и от wiki-логики.

Задачи:
- выделить `Workspace SDK` из текущего клиента и сервера
- оформить workspace operations как отдельный API
- ввести типы событий и state transitions
- отделить UI-specific код от domain logic

Критерий готовности:
- UI работает через `Workspace SDK`, а не напрямую через ad hoc API вызовы

### Этап 3. Extract Wiki SDK

Цель: превратить markdown vault в управляемую wiki-систему.

Задачи:
- единый link resolver
- backlinks
- broken links detection
- index rebuilding
- page metadata extraction
- wiki lint pipeline

Критерий готовности:
- можно отдельно запускать wiki-операции без участия UI

### Этап 4. Karpathy Mode

Цель: адаптировать продукт под workflow "LLM-maintained wiki".

Задачи:
- добавить папку `raw/`
- добавить `index.md`
- добавить `log.md`
- завести `SCHEMA.md` или `AGENTS.md`
- описать правила обновления wiki
- ввести команду ingest source

Критерий готовности:
- система поддерживает разделение raw sources и curated wiki

### Этап 5. Search and Navigation

Цель: сделать vault удобным для повседневной работы.

Задачи:
- полнотекстовый поиск
- быстрый переход по заметкам
- backlinks pane
- recent notes
- graph view
- filters by tag / status / type

Критерий готовности:
- заметки легко находить и связывать без ручного перебора

### Этап 6. Desktop Connections

Цель: превратить single-vault prototype в desktop workspace, который подключает внешние repo и markdown roots.

Задачи:
- завершить модель `WorkspaceConnection`
- развести `codeRoot` и `notesRoot` в typed contract
- поддержать существующие markdown vaults и docs folders как подключаемые sources
- поддержать code repo с markdown внутри и code repo с отдельной папкой заметок
- стабилизировать local persistence для connections и workspace session
- ввести aggregated listing/search поверх нескольких connections

Критерий готовности:
- пользователь может подключить внешний repo и/или соседнюю папку заметок, а приложение работает с ними как с единым workspace без размещения своего кода внутри этих папок

### Этап 7. Agent Integration

Цель: сделать продукт usable как knowledge/workspace surface для внешних AI-агентов и coding assistants.

Задачи:
- дать стабильный локальный typed API для note/folder/workspace операций
- подготовить agent-facing tool surface или MCP-слой
- поддержать `list/read/create/update/search` для markdown-notes по `connectionId`
- поддержать graph, backlinks, workspace tabs/session и revision state как agent tools
- сделать операции идемпотентными и безопасными для внешнего orchestrator-а
- зафиксировать сценарий, где агент имеет доступ и к codebase, и к Sourcery как knowledge server

Критерий готовности:
- внешний агент может подключиться к локальному продукту, читать и обновлять markdown knowledge base, не требуя размещения приложения внутри целевого repo

### Этап 8. Automation and LLM Integration

Цель: превратить wiki в рабочую память для LLM.

Задачи:
- ingest pipeline для raw sources
- query over wiki
- lint wiki на дубликаты, stale pages и конфликты
- summary/index rebuild jobs
- hooks для внешних LLM-агентов

Критерий готовности:
- LLM может безопасно поддерживать wiki как промежуточный артефакт

### Этап 9. Extension Model

Цель: сделать систему расширяемой без переписывания ядра.

Задачи:
- plugin API
- commands API
- workspace hooks
- wiki hooks
- ingest adapters

Критерий готовности:
- новые функции добавляются как extensions, а не как хаки в основном коде

## Приоритет на ближайшее время

Следующие шаги я бы делал в таком порядке:

1. Stabilize Core
2. Extract Workspace SDK
3. Extract Wiki SDK
4. Desktop Connections
5. Agent Integration
6. Add Karpathy structure: `raw/`, `index.md`, `log.md`, `SCHEMA.md`
7. Add search and backlinks

## Чего не делать сейчас

- не переносить source of truth в SQL
- не делать heavy desktop shell раньше времени
- не пытаться повторить весь Obsidian UI до появления устойчивого core
- не смешивать workspace-логику и wiki-логику в один модуль
- не встраивать runtime приложения в каждый целевой repo; repo и vault должны подключаться как внешние sources

## Ближайший практический milestone

Milestone A: reliable local markdown workspace.

Что должно войти:
- безошибочное сохранение
- явный save state
- корректное создание и rename note
- выделенный `Workspace SDK`
- минимальные тесты на storage и API

После этого уже можно переходить к knowledge-layer, а не чинить базовую редакторную механику на каждом шаге.

## Ближайший agent-facing milestone

Milestone B: desktop connections + agent-ready workspace API.

Что должно войти:
- `WorkspaceConnection` с `codeRoot` и optional `notesRoot`
- подключение внешнего repo без копирования туда Sourcery
- создание и обновление `.md` заметок в подключённой notes-папке
- typed `NoteRef` / `FolderRef`
- локальный agent-facing API или MCP surface для notes, search, graph, tabs

После этого продукт можно использовать как отдельный knowledge server для Codex, Claude Code и других tool-using агентов.
