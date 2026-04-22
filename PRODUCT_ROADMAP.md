# Product Roadmap

## Vision

Собрать open-source аналог Obsidian для локальной работы с markdown-файлами, который:

- хранит заметки как обычные `.md` файлы
- позволяет работать с vault как с обычной git-репой
- показывает заметки как graph знаний
- остаётся человеко-читаемым вне приложения
- допускает дальнейшую автоматизацию и LLM-oriented workflows

## Product Principles

### 1. Markdown First

Source of truth для знаний:
- только `.md` файлы

Правила:
- заметки должны быть читаемы без приложения
- git diff должен оставаться понятным
- никаких проприетарных форматов как обязательной части системы

### 2. Git-Friendly By Design

Vault должен храниться как обычный кодовый репозиторий.

Правила:
- понятная структура каталогов
- детерминированные имена файлов
- минимум служебного шума в коммитах
- кэш и индексы не являются частью source of truth
- после `git clone` граф и индекс должны восстанавливаться из файлов

### 3. Graph Is Derived, Not Primary

Graph не является основной базой данных.

Правила:
- граф строится из markdown content и metadata
- links, tags, backlinks и relations выводятся из файлов
- индекс может ускорять работу, но не должен становиться источником истины

### 4. Human + Machine Friendly

Система должна быть удобна:
- человеку, который пишет и читает заметки
- разработчику, который хранит их в git
- LLM-агенту, который может анализировать и поддерживать wiki

## Target Repository Layout

```text
repo/
  vault/
    index.md
    projects/
      alpha.md
      beta.md
    people/
      karpathy.md
    topics/
      llm-memory.md
    daily/
      2026-04-21.md
  raw/
    meeting-notes/
    exports/
    transcripts/
  attachments/
    images/
    pdfs/
  .app/
    cache/
    index/
  README.md
  AGENTS.md
  SCHEMA.md
```

### Назначение директорий

- `vault/`: curated markdown knowledge base
- `raw/`: сырые источники для ingest-процессов
- `attachments/`: вложения и бинарные файлы
- `.app/`: локальный кэш, индекс, служебные артефакты

### Git Rules

В git должны нормально жить:
- `vault/`
- `raw/`
- `attachments/`
- `README.md`
- `AGENTS.md`
- `SCHEMA.md`

В git не обязаны жить:
- локальный search index
- derived graph cache
- временные runtime артефакты

## Markdown Model

Поддержка как обязательный минимум:

- headings `# Heading`
- `[[wikilinks]]`
- `#hashtags`
- стандартные markdown links
- checklists
- code fences
- blockquotes
- списки
- optional frontmatter

### Semantics

- `# Heading` в начале строки и с пробелом после `#` это heading
- `#tag` без пробела это hashtag
- `[[Note Name]]` это wiki-link на другую заметку
- tags, links и backlinks должны вычисляться детерминированно

## Product Architecture

### Storage Layer

Отвечает за:
- read/write note files
- create/rename/delete
- atomic saves
- attachment handling
- file watching
- conflict detection

### Workspace SDK

Отвечает за:
- list/open/select notes
- active note state
- panes/tabs/layout state
- create/delete/rename actions
- workspace events
- command dispatch hooks

### Wiki SDK

Отвечает за:
- wikilinks
- backlinks
- tags
- metadata extraction
- broken link detection
- note identity
- index rebuilding
- lint

### Graph Engine

Отвечает за:
- nodes and edges
- local graph
- global graph
- filters
- graph queries
- derived graph model

### Compat Layer

Отвечает за:
- `App`
- `Vault`
- `Workspace`
- `MetadataCache`
- `Plugin`
- `PluginHost`

### UI Layer

Отвечает за:
- note list
- editor
- preview
- search
- backlinks/tags panels
- graph view
- command palette

## Roadmap

## Phase 1. Production Core

### Goal

Сделать надёжное markdown-first ядро без потери заметок.

### Scope

- test infrastructure
- unit tests for storage
- unit tests for workspace
- save guarantees
- atomic file writes
- rename and duplicate-title rules
- deterministic error model

### Definition of Done

- заметки не теряются при перезапуске
- все базовые file operations покрыты тестами
- save flow предсказуем

## Phase 2. Daily-Usable Workspace

### Goal

Сделать приложение пригодным для ежедневной работы как markdown editor.

### Scope

- note list
- note search
- split/editor/preview
- create/delete/rename
- unsaved changes handling
- file watcher and reload
- stable save status

### Definition of Done

- пользователь может вести vault каждый день без ручных обходов багов

## Phase 3. Wiki Layer

### Goal

Превратить набор markdown-файлов в связанную wiki.

### Scope

- wikilinks
- backlinks
- hashtags
- metadata extraction
- broken links
- reference resolution
- metadata-first filtering

### Definition of Done

- каждая заметка существует и как markdown file, и как wiki entity

## Phase 4. Graph

### Goal

Дать полноценный graph view на основе markdown-связей.

### Scope

- graph model
- local graph
- global graph
- node sizing
- edge rendering
- filters by tag/folder/type
- click-through navigation from graph to note

### Definition of Done

- vault можно исследовать как сеть знаний, а не только как список файлов

## Phase 5. Git-Friendly Repository Workflow

### Goal

Сделать систему естественной для git-based knowledge work.

### Scope

- deterministic naming
- diff-friendly saves
- `.gitignore` for caches
- clean repo conventions
- import/export rules
- recovery from fresh clone

### Definition of Done

- vault удобно коммитить, ревьюить, бэкапить и переносить между машинами

## Phase 6. Search and Indexing

### Goal

Обеспечить быстрый поиск по большому vault.

### Scope

- full-text search
- title search
- tag search
- backlinks search
- folder/path filters
- optional local SQLite index as cache

### Definition of Done

- большой vault остаётся быстрым без ломки markdown-first модели

## Phase 7. Plugin and Extension Model

### Goal

Сделать систему расширяемой без деградации core.

### Scope

- plugin manifest
- lifecycle
- commands API
- workspace hooks
- wiki hooks
- graph hooks

### Definition of Done

- новые возможности могут добавляться как расширения, а не как хаки в ядре

## Phase 8. Karpathy Mode

### Goal

Поддержать workflow `raw -> wiki -> schema -> ingest/query/lint`.

### Scope

- `raw/`
- `index.md`
- `log.md`
- `SCHEMA.md`
- `AGENTS.md`
- ingest flow
- query flow
- lint flow
- stale/contradiction detection

### Definition of Done

- система годится как persistent curated memory layer для человека и LLM

## Milestones

## v0.1

Фокус:
- production core
- tests
- stable save flow
- markdown workspace

Результат:
- usable локальный markdown editor на файловой системе

## v0.2

Фокус:
- wiki semantics
- tags
- backlinks
- metadata filters

Результат:
- usable local wiki на markdown-файлах

## v0.3

Фокус:
- graph engine
- local/global graph
- git workflow polish

Результат:
- git-friendly graph knowledge workspace

## v0.4

Фокус:
- fast search
- optional indexing
- plugin host foundation

Результат:
- расширяемая рабочая среда для больших vault

## v1.0

Фокус:
- stable graph workspace
- mature plugin model
- Karpathy mode
- reliable knowledge workflows

Результат:
- production-grade open alternative to Obsidian for markdown repositories

## Priority Order

Делать в таком порядке:

1. test infrastructure
2. storage/workspace hardening
3. save guarantees
4. wiki metadata correctness
5. graph model
6. graph UI
7. git workflow polish
8. plugin model
9. Karpathy mode

## Explicit Non-Goals For Now

- не делать SQL primary storage
- не делать desktop shell раньше стабильного core
- не обещать полную совместимость со всеми Obsidian plugins
- не строить graph на отдельной закрытой базе
- не смешивать UI state и domain logic
