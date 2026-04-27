# Engineering Log

Технический журнал проекта: архитектурные решения, важные повороты и инженерные договорённости.

## 2026-04-21

### Storage

- source of truth закреплён в обычных markdown-файлах внутри `vault/`
- `SQL` сознательно не используется как primary storage; если появится позже, то только как индекс или кэш
- запись файлов сделана атомарной через временный файл и rename

### Architecture

- проект разложен на слои `core/storage`, `core/workspace`, `core/wiki`, `compat/obsidian`
- `compat/obsidian` выбран как compatibility facade, а не попытка копировать внутренности Obsidian
- `Workspace SDK` отделён по смыслу от `Wiki SDK`: первое про editor shell, второе про knowledge graph semantics

### Product Direction

- целевая модель проекта: markdown-first и git-friendly аналог Obsidian
- Karpathy-like memory workflow рассматривается как отдельный слой поверх markdown workspace, а не как замена ядру
- графы, плагины и ingest-пайплайн идут после стабилизации core и folder UX

### Engineering Process

- принят production-first режим разработки
- дальнейшая разработка идёт под `TDD`, `KISS`, `SOLID`
- новые фичи должны сопровождаться тестами в чувствительных доменных областях
- ключевые пользовательские изменения фиксируются в `CHANGELOG.md`

### Recent Milestones

- прототип на `localStorage` заменён на файловый vault
- добавлены tags, backlinks и metadata extraction
- добавлены папки, nested notes, move между папками и `Root`
- добавлено сворачивание групп по папкам

## 2026-04-22

### Desktop Connections

- продуктовая модель закреплена как `desktop-local app + external workspace connections`, а не как приложение, встраиваемое в каждый целевой repo
- подключаемые источники должны описываться через typed `WorkspaceConnection`
- connection может указывать на `markdown vault`, `docs-only folder`, `code repo` или сценарий `codeRoot + отдельный notesRoot`
- source of truth для knowledge-layer остаётся в markdown-файлах подключённых папок, а session/tabs/registry живут локально в состоянии приложения

### Agent Integration

- внешний AI-агент рассматривается как tool-using client поверх локального backend/API, а не как код внутри самого продукта
- целевая интеграция: агент имеет независимый доступ к codebase и к Sourcery как к knowledge/workspace server
- приложение не должно копировать свой runtime в проектный repo ради работы агента
- следующий интеграционный слой должен дать agent-facing API или MCP surface для notes, search, graph, backlinks и workspace session

### App Memory

- operational/user memory приложения вынесена в отдельный app-owned слой, а не в `vault`
- global memory и workspace memory живут в `.obsidian-lite/memory/`
- app memory не попадает в graph, backlinks или обычный notes search по умолчанию
- app memory остаётся markdown-first, но отделена от knowledge source of truth подключённых workspace roots

## 2026-04-23

### Agent Write Model

- на текущем этапе Sourcery рассматривается как `navigation/context layer` поверх markdown workspace, а не как authority по правам доступа к файловой системе
- source of truth для knowledge-layer остаются `.md` файлы внутри подключённого `vault` или `notesRoot`
- если внешний агент уже запущен внутри разрешённой markdown-папки и имеет filesystem access, он может создавать, редактировать и удалять `.md` напрямую без отдельного write API от Sourcery
- backend и UI должны подхватывать такие внешние изменения через watcher + revision polling; отдельный rebuild knowledge base не нужен
- политика записи для агента пока не выносится в отдельную permission system внутри Sourcery; ограничение write scope должно обеспечиваться runtime sandbox или внешней системой прав
- внешний write access за пределы локально разрешённой markdown-папки откладывается как отдельная, более сложная задача
- agent-facing backend surface по умолчанию переведён в `read-only`: `notes.create` и `notes.update` скрываются из capabilities/MCP и возвращают `403`, если write policy явно не включена
