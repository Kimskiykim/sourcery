# Changelog

Все заметные пользовательские изменения проекта фиксируются здесь.

## [Unreleased]

### Added

- автоматизированный `npm run smoke:ui` для browser smoke проверки UI на временном vault
- автоматизированный `npm run smoke:agent` для MCP stdio проверки agent-интеграции
- `npm run verify`, объединяющий unit/API тесты и UI smoke
- `context.pack` теперь отдельно возвращает bootstrap entrypoints проекта для кодовых агентов
- `npm run mcp:connect` для подключения MCP-клиентов к уже запущенному Sourcery HTTP server без запуска Sourcery runtime внутри агентского проекта
- graph view лучше масштабирует большие workspace-графы: dense layout, auto-fit и меньше визуального шума от labels
- веб-интерфейс для markdown vault с editor / preview / split
- хранение заметок в реальных `.md` файлах внутри `vault/`
- папки, вложенные markdown-файлы и группировка заметок по папкам
- создание папок из UI
- перенос заметок между папками и в `Root`
- сворачивание групп заметок по папкам
- `[[wikilinks]]`, backlinks и hashtags `#tag`
- metadata-first фильтрация по тегам
- auto-reload при внешних изменениях vault
- Obsidian-like compatibility layer для будущих плагинов
- agent-facing local API v0 для connections, note search/read/write, backlinks, graph summary и workspace session
- локальный MCP stdio adapter v0 поверх agent API для внешних tool-using ассистентов
- aggregated agent context pack по нескольким connections для быстрого загрузочного контекста
- MCP resources/prompts v0 с resource templates и prompts `project-context-bootstrap` / `adr-bootstrap`
- тестовый контур для `storage`, `workspace` и `wiki`
- отдельная `app memory`: global memory и workspace memory вне подключаемых `vault`/`notesRoot`
- переключатель языка интерфейса `RU/EN` с локализацией основных экранов и статусов

### Changed

- проект переведён с `localStorage` на файловое хранение через локальный Node API
- заголовок заметки сохраняется мягче: без агрессивного rename-loop на каждый символ
- конфликты названий больше не приводят к автоматическому добавлению `2`, вместо этого показывается ошибка
- backlinks в preview ужаты и перестроены в компактный контекстный блок
- список заметок больше не ограничен одной папкой, а строится как grouped view по всему vault
- память приложения вынесена в отдельный app-owned storage и больше не требует смешивать operational memory с пользовательскими markdown notes

### Fixed

- save status снова видим в UI и покрыт smoke-сценарием
- MCP entrypoint теперь уважает write policy при запуске с включёнными agent writes
- сохранение заметок сделано атомарным на уровне файлового storage
- добавлены best-effort save при закрытии вкладки и защита от потери несохранённых изменений
- исправлен конфликт между markdown heading и hashtags
- исправлен визуальный баг, из-за которого коллапс групп не срабатывал из-за CSS `display`
