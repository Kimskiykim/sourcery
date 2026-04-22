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
