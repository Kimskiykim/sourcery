import { RequestError } from "./compat/obsidian/app.js";
import { SourceryApiClient, requestJson as fetchJson } from "./frontend/api-client.js";
import {
  didEverySaveSucceed,
  resolveMemorySaveScopes,
  shouldSkipMemorySave,
  type MemorySaveScope,
} from "./frontend/save-coordinator.js";
import type {
  GraphBrokenLink,
  GraphBridgeNote,
  GraphCluster,
  GraphNode,
  GraphPathResult,
  GraphRankedNote,
  GraphSnapshot,
  WorkspaceTabsSessionSnapshot as TabsSessionSnapshot,
} from "./core/graph/types.js";
import type { AppMemoryDocument } from "./core/memory/types.js";
import type { WorkspaceConnection, WorkspaceConnectionKind } from "./core/workspace/session-types.js";
import type { WorkspaceFolder, WorkspaceNote } from "./core/workspace/types.js";
import { matchesNoteQuery } from "./core/wiki/query.js";
import { WikiSDK } from "./core/wiki/wiki-sdk.js";

type ViewMode = "split" | "editor" | "preview" | "graph" | "memory";
type NoteViewMode = Exclude<ViewMode, "graph" | "memory">;
type FolderVisibilityMode = "all" | "selected";
type GraphMode = "global" | "local";
type GraphColorMode = "none" | "folder" | "tag" | "cluster";
type ConnectionPathField = "rootPath" | "codeRoot" | "notesRoot";
type Locale = "ru" | "en";

interface WikilinkSuggestionItem {
  noteId: string;
  title: string;
  folderPath: string;
  insertion: string;
  meta: string;
}

interface NavigationEntry {
  view: ViewMode;
  selectedNoteId: string | null;
  selectedFolderPath: string;
  activeTabId: string | null;
  connectionId: string | null;
  graph: {
    mode: GraphMode;
    folderScoped: boolean;
    existingFilesOnly: boolean;
    colorMode: GraphColorMode;
    sidebarCollapsed: boolean;
    selectedNodeId: string | null;
    panX: number;
    panY: number;
    zoom: number;
  };
}

interface Note extends WorkspaceNote {
  draftTitle?: string;
}

interface WorkspaceTab {
  id: string;
  noteId: string;
  title?: string;
  folderPath?: string;
  pinned: boolean;
  connectionId?: string;
  connectionName?: string;
}

interface WorkspaceTabSessionState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  initialized: boolean;
}

interface Vault {
  selectedNoteId: string | null;
  selectedNoteIds: string[];
  selectionAnchorNoteId: string | null;
  notes: Note[];
  folders: WorkspaceFolder[];
  selectedFolderPath: string;
  collapsedFolderPaths: string[];
  folderVisibilityMode: FolderVisibilityMode;
}

interface WorkspaceConnectionDraft {
  name: string;
  kind: WorkspaceConnectionKind;
  rootPath: string;
  codeRoot: string;
  notesRoot: string;
  isDefault: boolean;
  activateOnSave: boolean;
}

interface WorkspaceConnectionManagerState {
  open: boolean;
  mode: "create" | "edit";
  selectedConnectionId: string | null;
  draft: WorkspaceConnectionDraft;
  saving: boolean;
  error: string | null;
}

interface MemoryDocumentState extends AppMemoryDocument {
  connectionName: string | null;
  savedContent: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

interface State {
  locale: Locale;
  workspace: {
    connections: WorkspaceConnection[];
    activeConnectionId: string | null;
    switcherOpen: boolean;
    manager: WorkspaceConnectionManagerState;
  };
  vault: Vault;
  memory: {
    initialized: boolean;
    global: MemoryDocumentState;
    workspace: MemoryDocumentState;
  };
  tabs: WorkspaceTabSessionState;
  shell: {
    explorerCollapsed: boolean;
    explorerWidth: number;
    lastNoteView: NoteViewMode;
  };
  graph: {
    contextMenuNoteId: string | null;
    contextMenuX: number;
    contextMenuY: number;
    selectedNodeId: string | null;
    mode: GraphMode;
    folderScoped: boolean;
    existingFilesOnly: boolean;
    colorMode: GraphColorMode;
    sidebarCollapsed: boolean;
    snapshot: GraphSnapshot | null;
    clusters: GraphCluster[];
    topLinked: GraphRankedNote[];
    hubs: GraphRankedNote[];
    bridges: GraphBridgeNote[];
    brokenLinks: GraphBrokenLink[];
    orphans: Note[];
    path: GraphPathResult | null;
    pathRequestKey: string;
    pathFromNoteId: string | null;
    pathToNoteId: string | null;
    pathLoading: boolean;
    pathError: string | null;
    loading: boolean;
    requestKey: string;
    error: string | null;
    panX: number;
    panY: number;
    zoom: number;
  };
  editor: {
    wikilink: {
      query: string;
      replaceStart: number;
      replaceEnd: number;
      activeIndex: number;
      items: WikilinkSuggestionItem[];
    };
  };
  navigation: {
    backStack: NavigationEntry[];
  };
  query: string;
  view: ViewMode;
  workspaceRevision: number;
  hasExternalChanges: boolean;
}

interface Elements {
  appShell: HTMLElement;
  sidebar: HTMLElement;
  sidebarResizer: HTMLButtonElement;
  toggleExplorerButton: HTMLButtonElement;
  toggleExplorerGlyph: HTMLElement;
  graphNodeMenu: HTMLElement;
  explorerContextMenu: HTMLElement;
  languageToggleButton: HTMLButtonElement;
  memoryLayout: HTMLElement;
  memoryGlobalEditor: HTMLTextAreaElement;
  memoryWorkspaceEditor: HTMLTextAreaElement;
  memoryGlobalState: HTMLElement;
  memoryWorkspaceState: HTMLElement;
  memoryGlobalUpdated: HTMLElement;
  memoryWorkspaceUpdated: HTMLElement;
  memoryWorkspaceConnection: HTMLElement;
  memoryReloadAllButton: HTMLButtonElement;
  memoryGlobalSaveButton: HTMLButtonElement;
  memoryGlobalReloadButton: HTMLButtonElement;
  memoryGlobalClearButton: HTMLButtonElement;
  memoryWorkspaceSaveButton: HTMLButtonElement;
  memoryWorkspaceReloadButton: HTMLButtonElement;
  memoryWorkspaceClearButton: HTMLButtonElement;
  sidebarVaultTitle: HTMLElement;
  sidebarVaultSwitcher: HTMLButtonElement;
  sidebarVaultMenu: HTMLElement;
  workspaceConnectionsButton: HTMLButtonElement;
  workspaceTabList: HTMLElement;
  workspaceNewTabButton: HTMLButtonElement;
  workspaceActiveTabState: HTMLElement;
  workspaceViewBadge: HTMLElement;
  workspaceBackButton: HTMLButtonElement;
  folderList: HTMLUListElement;
  folderCount: HTMLElement;
  noteList: HTMLUListElement;
  noteCount: HTMLElement;
  noteTitle: HTMLInputElement;
  noteFolderSelect: HTMLSelectElement;
  notePathBadge: HTMLElement;
  noteMoveButton: HTMLButtonElement;
  titleHint: HTMLElement;
  noteTags: HTMLElement;
  noteContext: HTMLElement;
  noteBacklinks: HTMLElement;
  noteEditor: HTMLTextAreaElement;
  wikilinkSuggestions: HTMLElement;
  notePreview: HTMLDivElement;
  noteMeta: HTMLElement;
  graphPane: HTMLElement;
  graphCanvas: SVGSVGElement;
  graphStats: HTMLElement;
  graphLegend: HTMLElement;
  graphEmptyState: HTMLElement;
  graphTopLinked: HTMLElement;
  graphHubs: HTMLElement;
  graphBridges: HTMLElement;
  graphBrokenLinks: HTMLElement;
  graphOrphans: HTMLElement;
  graphPathFrom: HTMLSelectElement;
  graphPathTo: HTMLSelectElement;
  graphPathResult: HTMLElement;
  graphGlobalButton: HTMLButtonElement;
  graphLocalButton: HTMLButtonElement;
  graphColorModeButton: HTMLButtonElement;
  graphFolderScopeButton: HTMLButtonElement;
  graphExistingOnlyButton: HTMLButtonElement;
  graphCenterViewButton: HTMLButtonElement;
  graphResetViewButton: HTMLButtonElement;
  graphToggleSidebarButton: HTMLButtonElement;
  graphPathCurrentButton: HTMLButtonElement;
  graphPathSwapButton: HTMLButtonElement;
  graphPathFindButton: HTMLButtonElement;
  searchInput: HTMLInputElement;
  newFolderButton: HTMLButtonElement;
  renameFolderButton: HTMLButtonElement;
  deleteFolderButton: HTMLButtonElement;
  showAllFoldersButton: HTMLButtonElement;
  showSelectedFolderButton: HTMLButtonElement;
  folderSelectionPath: HTMLElement;
  newNoteButton: HTMLButtonElement;
  deleteButton: HTMLButtonElement;
  refreshButton: HTMLButtonElement;
  saveState: HTMLElement;
  editorLayout: HTMLElement;
  emptyNoteTemplate: HTMLTemplateElement;
  connectionManager: HTMLElement;
  connectionManagerBackdrop: HTMLElement;
  connectionManagerClose: HTMLButtonElement;
  connectionManagerList: HTMLElement;
  connectionManagerEmpty: HTMLElement;
  connectionManagerForm: HTMLFormElement;
  connectionManagerTitle: HTMLElement;
  connectionManagerDescription: HTMLElement;
  connectionManagerKindHint: HTMLElement;
  connectionManagerRootField: HTMLElement;
  connectionManagerRootLabel: HTMLElement;
  connectionManagerRootHint: HTMLElement;
  connectionManagerNameInput: HTMLInputElement;
  connectionManagerKindSelect: HTMLSelectElement;
  connectionManagerRootPathInput: HTMLInputElement;
  connectionManagerCodeRootField: HTMLElement;
  connectionManagerCodeRootInput: HTMLInputElement;
  connectionManagerNotesRootField: HTMLElement;
  connectionManagerNotesRootInput: HTMLInputElement;
  connectionManagerDefaultCheckbox: HTMLInputElement;
  connectionManagerActivateCheckbox: HTMLInputElement;
  connectionManagerError: HTMLElement;
  connectionManagerDeleteButton: HTMLButtonElement;
  connectionManagerUseButton: HTMLButtonElement;
  connectionManagerResetButton: HTMLButtonElement;
  connectionManagerSubmitButton: HTMLButtonElement;
  connectionManagerCreateButton: HTMLButtonElement;
  confirmDialog: HTMLElement;
  confirmDialogBackdrop: HTMLElement;
  confirmDialogTitle: HTMLElement;
  confirmDialogDescription: HTMLElement;
  confirmDialogCancel: HTMLButtonElement;
  confirmDialogConfirm: HTMLButtonElement;
  viewButtons: HTMLButtonElement[];
}

const DEFAULT_STATUS = "Markdown vault";
const ROOT_FOLDER_KEY = "__root__";
const SAVE_DEBOUNCE_MS = 350;
const TITLE_SAVE_DEBOUNCE_MS = 900;
const WORKSPACE_POLL_MS = 2000;
const GRAPH_VIEWBOX_WIDTH = 1000;
const GRAPH_VIEWBOX_HEIGHT = 680;
const GRAPH_VIEWBOX_CENTER_X = GRAPH_VIEWBOX_WIDTH / 2;
const GRAPH_VIEWBOX_CENTER_Y = GRAPH_VIEWBOX_HEIGHT / 2;
const DENSE_GRAPH_NODE_THRESHOLD = 90;
const DENSE_GRAPH_ORPHAN_THRESHOLD = 48;
const DEFAULT_EXPLORER_WIDTH = 292;
const MIN_EXPLORER_WIDTH = 248;
const MAX_EXPLORER_WIDTH = 420;
const EXPLORER_WIDTH_STORAGE_KEY = "sourcery:explorer-width";
const EXPLORER_COLLAPSED_STORAGE_KEY = "sourcery:explorer-collapsed";
const LOCALE_STORAGE_KEY = "sourcery:locale";
const ACTIVE_CONNECTION_STORAGE_KEY = "sourcery:active-connection";
const apiClient = new SourceryApiClient({ getActiveConnectionId });
const wiki = new WikiSDK();

type GraphPoint = { x: number; y: number };
type GraphLayoutBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};
type GraphLayoutResult = {
  positions: Map<string, GraphPoint>;
  bounds: GraphLayoutBounds;
  dense: boolean;
};

let graphLayoutCache: {
  key: string;
  result: GraphLayoutResult;
} | null = null;
const TRANSLATIONS: Record<Locale, Record<string, string>> = {
  ru: {
    "app.title": "Sourcery",
    "app.status": "Markdown vault",
    "app.language.toggle": "EN",
    "app.language.switch": "Switch to English",
    "activity.primaryNavigation": "Основная навигация",
    "activity.graph": "Граф",
    "activity.memory": "Память",
    "activity.explorer": "Проводник",
    "activity.collapseExplorer": "Свернуть проводник",
    "activity.expandExplorer": "Развернуть проводник",
    "sidebar.explorer": "Проводник",
    "sidebar.vault": "Хранилище",
    "sidebar.search": "Поиск",
    "sidebar.searchPlaceholder": "Название или текст",
    "sidebar.refresh": "Обновить",
    "sidebar.newFolder": "Новая папка",
    "sidebar.newNote": "Новая заметка",
    "folders.title": "Папки",
    "folders.showAll": "Все",
    "folders.showSelectedOnly": "Только выбранная",
    "folders.rename": "Переименовать",
    "folders.deleteEmpty": "Удалить пустую",
    "notes.title": "Документы",
    "workspace.eyebrow": "База знаний",
    "workspace.connection": "Workspace",
    "workspace.manage": "Источники",
    "workspace.tabs": "Табы workspace",
    "workspace.emptyTabsTitle": "Пока нет табов",
    "workspace.emptyTabsCopy": "Откройте текущую заметку, чтобы закрепить ее в полосе workspace.",
    "workspace.newTab": "Новая вкладка",
    "workspace.back": "Назад",
    "workspace.noActiveNote": "Нет активной заметки",
    "workspace.currentNote": "Текущая заметка",
    "workspace.edit": "Редактировать workspace",
    "workspace.updateDescription": "Обновите корни, тип и поведение подключения по умолчанию.",
    "workspace.tabPin": "Закрепить таб",
    "workspace.tabUnpin": "Открепить таб",
    "workspace.tabClose": "Закрыть таб",
    "workspace.view": "Вид workspace",
    "view.split": "Разделено",
    "view.editor": "Редактор",
    "view.preview": "Превью",
    "view.graph": "Граф",
    "view.memory": "Память",
    "note.titlePlaceholder": "Название документа",
    "note.move": "Переместить",
    "note.delete": "Удалить",
    "note.editorPlaceholder": "# Начните писать...",
    "editor.noLinkMatches": "Нет подходящих заметок",
    "note.backlinks": "Обратные ссылки",
    "common.root": "Корень",
    "common.copy": "Копировать",
    "common.close": "Закрыть",
    "common.connecting": "Подключение...",
    "common.open": "Открыть",
    "common.active": "Активно",
    "common.default": "По умолчанию",
    "common.notSet": "Не задано",
    "common.rename": "Переименовать",
    "common.delete": "Удалить",
    "common.cancel": "Отмена",
    "common.reload": "Обновить",
    "common.save": "Сохранить",
    "common.clear": "Очистить",
    "common.current": "Текущая",
    "common.swap": "Поменять",
    "common.findPath": "Найти путь",
    "common.color": "Цвет",
    "common.from": "От",
    "common.to": "До",
    "common.loading": "Загрузка",
    "common.error": "Ошибка",
    "common.ready": "Готово",
    "common.empty": "Пусто",
    "common.draft": "Черновик",
    "graph.titleEyebrow": "Граф знаний",
    "graph.title": "Просмотр графа",
    "graph.global": "Глобальный",
    "graph.local": "Локальный",
    "graph.scopeFolder": "Ограничить папкой",
    "graph.existingOnly": "Только существующие",
    "graph.center": "Центрировать",
    "graph.resetView": "Сбросить вид",
    "graph.hidePanel": "Скрыть панель",
    "graph.showPanel": "Показать панель",
    "graph.pathFinder": "Поиск пути",
    "graph.topLinked": "Топ ссылок",
    "graph.hubs": "Хабы",
    "graph.bridges": "Мосты",
    "graph.brokenLinks": "Битые ссылки",
    "graph.orphans": "Сироты",
    "graph.color.none": "Без цвета",
    "graph.color.folder": "Папка",
    "graph.color.tag": "Тег",
    "graph.color.cluster": "Кластер",
    "graph.loading": "Загрузка графа…",
    "graph.loadingNotStarted": "Загрузка графа не начата",
    "graph.loadError": "Ошибка загрузки graph view",
    "graph.noData": "Нет данных графа для текущего scope",
    "graph.chooseLocal": "Выберите заметку для локального графа",
    "graph.noRankedNotes": "Нет заметок с рангом",
    "graph.noHubNotes": "Нет hub-заметок",
    "graph.noBridgeNotes": "Нет bridge-заметок",
    "graph.noBrokenLinks": "Нет битых ссылок",
    "graph.noOrphans": "Нет заметок-сирот",
    "graph.revealInList": "Показать в списке",
    "graph.copyWikilink": "Скопировать wikilink",
    "graph.findingPath": "Поиск пути…",
    "graph.chooseTwoNotes": "Выберите две заметки для анализа пути",
    "graph.noPath": "Путь в текущем scope графа не найден",
    "graph.pathError": "Ошибка поиска пути",
    "graph.selectNote": "Выберите заметку",
    "graph.distance": "Дистанция {distance}",
    "graph.score": "оценка {score}",
    "graph.step": "шаг {step}",
    "graph.noNoteForLink": "Нет заметки для [[{label}]]",
    "graph.noNoteLinks": "Нет note-to-note ссылок",
    "graph.rootScope": "Scope корня",
    "graph.wholeVault": "Весь vault",
    "graph.globalGraph": "Глобальный граф",
    "graph.localGraph": "Локальный граф",
    "graph.notes": "{count} заметок",
    "graph.edges": "{count} связей",
    "graph.tags": "{count} тегов",
    "graph.dangling": "{count} висячих",
    "graph.orphansCount": "{count} сирот",
    "graph.bridgeMeta": "{cuts} разрезов · {neighbors} соседей",
    "graph.hubMeta": "{inbound} вход. · {outbound} выход. · {neighbors} соседей",
    "graph.unresolvedLinks": "{count} неразреш. ссылок",
    "graph.untagged": "Без тегов",
    "graph.clusterLabel": "Кластер {size}",
    "graph.unclustered": "Вне кластеров",
    "memory.titleEyebrow": "Память приложения",
    "memory.title": "Постоянная память вне подключенных vault",
    "memory.copy": "Global memory живет вместе с Sourcery. Workspace memory следует за активным connection и не смешивается с графом, backlinks или поиском по vault.",
    "memory.reloadAll": "Обновить память",
    "memory.global": "Глобальная",
    "memory.globalTitle": "Общая память приложения",
    "memory.workspace": "Workspace",
    "memory.notSavedYet": "Еще не сохранено",
    "memory.noWorkspace": "Нет активного workspace",
    "memory.globalPlaceholder": "Пользовательские предпочтения, стиль письма, правила по умолчанию и долгоживущий контекст.",
    "memory.workspacePlaceholder": "Конвенции проекта, повторяющиеся решения, локальные workflow и контекст вне подключенного notes root.",
    "memory.saved": "Память сохранена",
    "memory.synced": "Память синхронизирована",
    "memory.clearedGlobal": "Global memory очищена",
    "memory.clearedWorkspace": "Workspace memory очищена",
    "memory.meta": "Global {globalWords} слов · {workspaceLabel} {workspaceWords} слов",
    "memory.clearGlobalTitle": "Очистить global memory",
    "memory.clearWorkspaceTitle": "Очистить workspace memory",
    "memory.clearDescription": "Содержимое memory будет удалено из локального app state.",
    "memory.state.loading": "Загрузка",
    "memory.state.saving": "Сохранение",
    "memory.state.error": "Ошибка",
    "memory.state.draft": "Черновик",
    "memory.state.ready": "Готово",
    "memory.state.empty": "Пусто",
    "emptyVault.eyebrow": "Vault пуст",
    "emptyVault.title": "Создайте первую заметку",
    "emptyVault.copy": "Новая заметка будет сохранена как отдельный markdown-файл в папке vault.",
    "connection.titleEyebrow": "Подключения workspace",
    "connection.title": "Подключить workspace",
    "connection.description": "Добавьте новое подключение для заметок, docs или кода.",
    "connection.close": "Закрыть",
    "connection.connected": "Подключенные workspace",
    "connection.list": "Список",
    "connection.new": "Новый",
    "connection.emptyTitle": "Пока нет подключений",
    "connection.emptyCopy": "Создайте подключение для vault, repo docs или docs folder.",
    "connection.quickConnect": "Быстрое подключение",
    "connection.chooseShape": "Выберите форму workspace",
    "connection.connectVault": "Подключить vault",
    "connection.connectVaultCopy": "Один корень markdown vault.",
    "connection.connectDocsFolder": "Подключить docs folder",
    "connection.connectDocsFolderCopy": "Отдельная директория docs.",
    "connection.connectRepoDocs": "Подключить repo docs",
    "connection.connectRepoDocsCopy": "Поддерево docs репозитория как notes root.",
    "connection.connectCodeRepo": "Подключить code repo",
    "connection.connectCodeRepoCopy": "Отдельные code root и notes root.",
    "connection.name": "Имя",
    "connection.type": "Тип",
    "connection.kindHint.vault": "Один markdown vault с единым notes root.",
    "connection.kindHint.repo_docs": "Workspace документации репозитория с единым docs path.",
    "connection.kindHint.code_repo": "Репозиторий кода с отдельным notes/docs root.",
    "connection.kindHint.docs_folder": "Отдельная директория docs вне code repository.",
    "connection.vaultRoot": "Корень vault",
    "connection.docsRoot": "Корень docs",
    "connection.folderRoot": "Корень папки",
    "connection.vaultRootHint": "Директория с markdown-заметками для этого workspace.",
    "connection.repoDocsRootHint": "Директория документации внутри репозитория.",
    "connection.folderRootHint": "Директория, которая должна индексироваться как notes root.",
    "connection.pathHelp": "Вставьте абсолютный путь или перетащите папку в поле пути. Поддерживаются URL вида `file://`.",
    "connection.default": "Сделать это подключение workspace по умолчанию",
    "connection.activate": "Переключиться на этот workspace после сохранения",
    "connection.useNow": "Использовать сейчас",
    "connection.reset": "Сбросить",
    "connection.create": "Создать подключение",
    "connection.save": "Сохранить изменения",
    "connection.codeRoot": "Корень кода",
    "connection.codeLabel": "Код",
    "connection.notesRoot": "Корень заметок",
    "connection.notesLabel": "Заметки",
    "connection.rootLabel": "Корень",
    "connection.kindSuffix.codeRepo": "code repo",
    "connection.kindSuffix.docs": "docs",
    "connection.kindSuffix.repoDocs": "repo docs",
    "connection.mainRepoRoot": "Основной корень репозитория для навигации по коду.",
    "connection.notesRootHint": "Markdown notes или docs root, связанный с code repo.",
    "connection.browse": "Выбрать",
    "connection.paste": "Вставить",
    "connection.clear": "Очистить",
    "dialog.confirmation": "Подтверждение",
    "dialog.cannotUndo": "Это действие нельзя отменить.",
    "status.loadingVault": "Загрузка vault...",
    "status.refreshingVault": "Обновление vault...",
    "status.synced": "Синхронизировано",
    "status.pathApplied": "Путь применен",
    "status.pathPasted": "Путь вставлен",
    "status.folderChosen": "Папка выбрана",
    "status.workspaceConnected": "Workspace подключён",
    "status.workspaceUpdated": "Workspace обновлён",
    "status.connectionDeleted": "Подключение удалено",
    "status.loadError": "Ошибка загрузки",
    "status.switchingWorkspace": "Переключение workspace...",
    "status.noteCreated": "Создан markdown-файл",
    "status.folderCreated": "Папка создана: {path}",
    "status.folderRenamed": "Папка переименована: {path}",
    "status.folderDeleted": "Папка удалена: {path}",
    "status.onlyEmptyFolders": "Удаляются только пустые папки",
    "status.moving": "Перемещение...",
    "status.movedTo": "Перемещено в {path}",
    "status.movedToRoot": "Перемещено в Корень",
    "status.fileDeleted": "Файл удалён",
    "status.shownInList": "Показано в списке: {title}",
    "status.copyFailed": "Не удалось скопировать wikilink",
    "status.unsavedChanges": "Есть несохранённые изменения",
    "status.saved": "Сохранено",
    "status.saving": "Сохранение...",
    "status.savedInVault": "Сохранено в vault",
    "status.externalChanges": "Есть внешние изменения",
    "status.externalReloading": "Внешние изменения, обновление...",
    "status.externalApplied": "Внешние изменения применены",
    "status.applyingExternal": "Применение внешних изменений...",
    "status.vaultUpdated": "Vault обновлён с диска",
    "status.memoryReloading": "Обновление memory...",
    "status.memorySaved": "Память сохранена",
    "status.memoryLoadError": "Ошибка загрузки memory",
    "status.noConnections": "Нет подключённых workspace",
    "status.copyFolder": "Скопировано: {value}",
    "status.copyWikilink": "Скопировано: [[{title}]]",
    "status.filterTag": "Фильтр по #{tag}",
    "prompt.newFolder": "Путь новой папки",
    "prompt.renameFolder": "Новый путь папки",
    "prompt.moveNote": "Куда переместить заметку",
    "prompt.renameNote": "Новое название заметки",
    "confirm.deleteFolderTitle": "Удалить папку?",
    "confirm.deleteFolderDescription": "Папка \"{path}\" будет удалена. Это действие нельзя отменить.",
    "confirm.deleteNoteTitle": "Удалить заметку?",
    "confirm.deleteNoteDescription": "Заметка \"{title}\" будет удалена из vault. Это действие нельзя отменить.",
    "confirm.deleteConnectionTitle": "Удалить workspace {name}?",
    "confirm.deleteConnectionDescription": "Табы этой connection будут закрыты. Это действие нельзя отменить.",
    "confirm.deleteConnectionDefault": "Default connection удалить нельзя.",
    "error.create": "Ошибка создания",
    "error.createFolder": "Ошибка создания папки",
    "error.renameFolder": "Ошибка переименования папки",
    "error.deleteFolder": "Ошибка удаления папки",
    "error.move": "Ошибка перемещения",
    "error.delete": "Ошибка удаления",
    "error.save": "Ошибка сохранения",
    "error.memorySave": "Ошибка сохранения memory",
    "error.memoryWorkspaceLoad": "Ошибка загрузки workspace memory",
    "error.memoryGlobalLoad": "Ошибка загрузки global memory",
    "error.memoryClear": "Ошибка очистки memory",
    "error.invalidClipboardPath": "Буфер обмена не содержит абсолютный путь или file:// URL.",
    "error.readClipboard": "Не удалось прочитать clipboard. Вставьте путь вручную.",
    "error.pickDirectory": "Не удалось открыть выбор папки",
    "error.workspaceNameRequired": "Название workspace обязательно.",
    "error.codeRootRequired": "Для code repo укажите code root.",
    "error.notesRootRequired": "Для code repo укажите notes root.",
    "error.rootPathRequired": "Укажите root path для workspace.",
    "error.connectionMissing": "Подключение не найдено.",
    "error.connectionSave": "Не удалось сохранить подключение",
    "error.connectionDelete": "Не удалось удалить подключение",
    "error.titleTaken": "Название уже занято",
    "folder.rootCannotDelete": "Корень удалить нельзя",
    "folder.rootCannotRename": "Корень переименовать нельзя",
    "folder.deleteSelected": "Удалить пустую папку {path}",
    "folder.deleteOnlyEmpty": "Удаляются только пустые папки без вложенных папок и заметок",
    "folder.renameSelected": "Переименовать {path}",
    "folder.expand": "Развернуть папку",
    "folder.collapse": "Свернуть папку",
    "note.none": "Нет заметок",
    "note.noneCopy": "Создайте markdown-заметку, и она появится здесь.",
    "note.emptyExcerpt": "Пустая заметка",
    "note.wordsMeta": "{count} слов",
    "note.charactersMeta": "{count} символов",
  },
  en: {
    "app.title": "Sourcery",
    "app.status": "Markdown vault",
    "app.language.toggle": "RU",
    "app.language.switch": "Switch to Russian",
    "activity.primaryNavigation": "Primary navigation",
    "activity.graph": "Graph",
    "activity.memory": "Memory",
    "activity.explorer": "Explorer",
    "activity.collapseExplorer": "Collapse explorer",
    "activity.expandExplorer": "Expand explorer",
    "sidebar.explorer": "Explorer",
    "sidebar.vault": "Vault",
    "sidebar.search": "Search",
    "sidebar.searchPlaceholder": "Name or text",
    "sidebar.refresh": "Refresh",
    "sidebar.newFolder": "New folder",
    "sidebar.newNote": "New note",
    "folders.title": "Folders",
    "folders.showAll": "Show all",
    "folders.showSelectedOnly": "Selected only",
    "folders.rename": "Rename",
    "folders.deleteEmpty": "Delete empty",
    "notes.title": "Documents",
    "workspace.eyebrow": "Knowledge Workspace",
    "workspace.connection": "Workspace",
    "workspace.manage": "Sources",
    "workspace.tabs": "Workspace tabs",
    "workspace.emptyTabsTitle": "No tabs yet",
    "workspace.emptyTabsCopy": "Open the current note to keep it in the workspace strip.",
    "workspace.newTab": "New tab",
    "workspace.back": "Back",
    "workspace.noActiveNote": "No active note",
    "workspace.currentNote": "Current note",
    "workspace.edit": "Edit workspace",
    "workspace.updateDescription": "Update connection roots, type, and default behavior.",
    "workspace.tabPin": "Pin tab",
    "workspace.tabUnpin": "Unpin tab",
    "workspace.tabClose": "Close tab",
    "workspace.view": "Workspace view",
    "view.split": "Split",
    "view.editor": "Editor",
    "view.preview": "Preview",
    "view.graph": "Graph",
    "view.memory": "Memory",
    "note.titlePlaceholder": "Document title",
    "note.move": "Move",
    "note.delete": "Delete",
    "note.editorPlaceholder": "# Start writing...",
    "editor.noLinkMatches": "No matching notes",
    "note.backlinks": "Backlinks",
    "common.root": "Root",
    "common.copy": "Copy",
    "common.close": "Close",
    "common.connecting": "Connecting...",
    "common.open": "Open",
    "common.active": "Active",
    "common.default": "Default",
    "common.notSet": "Not set",
    "common.rename": "Rename",
    "common.delete": "Delete",
    "common.cancel": "Cancel",
    "common.reload": "Reload",
    "common.save": "Save",
    "common.clear": "Clear",
    "common.current": "Current",
    "common.swap": "Swap",
    "common.findPath": "Find path",
    "common.color": "Color",
    "common.from": "From",
    "common.to": "To",
    "common.loading": "Loading",
    "common.error": "Error",
    "common.ready": "Ready",
    "common.empty": "Empty",
    "common.draft": "Draft",
    "graph.titleEyebrow": "Knowledge Graph",
    "graph.title": "Graph View",
    "graph.global": "Global",
    "graph.local": "Local",
    "graph.scopeFolder": "Scope folder",
    "graph.existingOnly": "Existing only",
    "graph.center": "Center",
    "graph.resetView": "Reset view",
    "graph.hidePanel": "Hide panel",
    "graph.showPanel": "Show panel",
    "graph.pathFinder": "Path finder",
    "graph.topLinked": "Top linked",
    "graph.hubs": "Hubs",
    "graph.bridges": "Bridges",
    "graph.brokenLinks": "Broken links",
    "graph.orphans": "Orphans",
    "graph.color.none": "None",
    "graph.color.folder": "Folder",
    "graph.color.tag": "Tag",
    "graph.color.cluster": "Cluster",
    "graph.loading": "Loading graph…",
    "graph.loadingNotStarted": "Graph loading not started",
    "graph.loadError": "Failed to load graph view",
    "graph.noData": "No graph data for the current scope",
    "graph.chooseLocal": "Select a note for local graph",
    "graph.noRankedNotes": "No ranked notes",
    "graph.noHubNotes": "No hub notes",
    "graph.noBridgeNotes": "No bridge notes",
    "graph.noBrokenLinks": "No broken links",
    "graph.noOrphans": "No orphan notes",
    "graph.revealInList": "Reveal in list",
    "graph.copyWikilink": "Copy wikilink",
    "graph.findingPath": "Finding path…",
    "graph.chooseTwoNotes": "Choose two notes to inspect graph path",
    "graph.noPath": "No path found in the current graph scope",
    "graph.pathError": "Path search failed",
    "graph.selectNote": "Select note",
    "graph.distance": "Distance {distance}",
    "graph.score": "score {score}",
    "graph.step": "step {step}",
    "graph.noNoteForLink": "No note for [[{label}]]",
    "graph.noNoteLinks": "No note-to-note links",
    "graph.rootScope": "Root scope",
    "graph.wholeVault": "Whole vault",
    "graph.globalGraph": "Global graph",
    "graph.localGraph": "Local graph",
    "graph.notes": "{count} notes",
    "graph.edges": "{count} edges",
    "graph.tags": "{count} tags",
    "graph.dangling": "{count} dangling",
    "graph.orphansCount": "{count} orphans",
    "graph.bridgeMeta": "{cuts} cuts · {neighbors} neighbors",
    "graph.hubMeta": "{inbound} in · {outbound} out · {neighbors} neighbors",
    "graph.unresolvedLinks": "{count} unresolved links",
    "graph.untagged": "Untagged",
    "graph.clusterLabel": "Cluster {size}",
    "graph.unclustered": "Unclustered",
    "memory.titleEyebrow": "App Memory",
    "memory.title": "Persistent memory outside connected vaults",
    "memory.copy": "Global memory stays with Sourcery. Workspace memory follows the active connection and is not mixed into graph, backlinks, or vault search.",
    "memory.reloadAll": "Reload memory",
    "memory.global": "Global",
    "memory.globalTitle": "Shared app memory",
    "memory.workspace": "Workspace",
    "memory.notSavedYet": "Not saved yet",
    "memory.noWorkspace": "No active workspace",
    "memory.globalPlaceholder": "User preferences, writing style, default rules, and long-lived context.",
    "memory.workspacePlaceholder": "Project conventions, recurring decisions, local workflows, and context that should live outside the connected notes root.",
    "memory.saved": "Memory saved",
    "memory.synced": "Memory synced",
    "memory.clearedGlobal": "Global memory cleared",
    "memory.clearedWorkspace": "Workspace memory cleared",
    "memory.meta": "Global {globalWords} words · {workspaceLabel} {workspaceWords} words",
    "memory.clearGlobalTitle": "Clear global memory",
    "memory.clearWorkspaceTitle": "Clear workspace memory",
    "memory.clearDescription": "Memory content will be removed from the local app state.",
    "memory.state.loading": "Loading",
    "memory.state.saving": "Saving",
    "memory.state.error": "Error",
    "memory.state.draft": "Draft",
    "memory.state.ready": "Ready",
    "memory.state.empty": "Empty",
    "emptyVault.eyebrow": "Vault is empty",
    "emptyVault.title": "Create the first note",
    "emptyVault.copy": "The new note will be saved as a separate markdown file inside the vault folder.",
    "connection.titleEyebrow": "Workspace Connections",
    "connection.title": "Connect workspace",
    "connection.description": "Add a new workspace connection for notes, docs, or code.",
    "connection.close": "Close",
    "connection.connected": "Connected workspaces",
    "connection.list": "List",
    "connection.new": "New",
    "connection.emptyTitle": "No connections yet",
    "connection.emptyCopy": "Create a connection to attach a vault, repo docs, or docs folder.",
    "connection.quickConnect": "Quick connect",
    "connection.chooseShape": "Choose a workspace shape",
    "connection.connectVault": "Connect vault",
    "connection.connectVaultCopy": "Single markdown vault root.",
    "connection.connectDocsFolder": "Connect docs folder",
    "connection.connectDocsFolderCopy": "Standalone docs directory.",
    "connection.connectRepoDocs": "Connect repo docs",
    "connection.connectRepoDocsCopy": "Repository docs subtree as notes root.",
    "connection.connectCodeRepo": "Connect code repo",
    "connection.connectCodeRepoCopy": "Separate code root and notes root.",
    "connection.name": "Name",
    "connection.type": "Type",
    "connection.kindHint.vault": "Single markdown vault with one notes root.",
    "connection.kindHint.repo_docs": "Repository documentation workspace rooted in one docs path.",
    "connection.kindHint.code_repo": "Code repository with a separate notes/docs root.",
    "connection.kindHint.docs_folder": "Standalone docs directory outside a code repository.",
    "connection.vaultRoot": "Vault root",
    "connection.docsRoot": "Docs root",
    "connection.folderRoot": "Folder root",
    "connection.vaultRootHint": "Directory with markdown notes for this workspace.",
    "connection.repoDocsRootHint": "Documentation directory inside the repository.",
    "connection.folderRootHint": "Directory that should be indexed as the notes root.",
    "connection.pathHelp": "Paste an absolute path or drag a folder into a path field. `file://` URLs are supported.",
    "connection.default": "Make this the default workspace connection",
    "connection.activate": "Switch to this workspace after save",
    "connection.useNow": "Use now",
    "connection.reset": "Reset",
    "connection.create": "Create connection",
    "connection.save": "Save changes",
    "connection.codeRoot": "Code root",
    "connection.codeLabel": "Code",
    "connection.notesRoot": "Notes root",
    "connection.notesLabel": "Notes",
    "connection.rootLabel": "Root",
    "connection.kindSuffix.codeRepo": "code repo",
    "connection.kindSuffix.docs": "docs",
    "connection.kindSuffix.repoDocs": "repo docs",
    "connection.mainRepoRoot": "Main repository root for code browsing.",
    "connection.notesRootHint": "Markdown notes or docs root linked to the code repo.",
    "connection.browse": "Browse",
    "connection.paste": "Paste",
    "connection.clear": "Clear",
    "dialog.confirmation": "Confirmation",
    "dialog.cannotUndo": "This action cannot be undone.",
    "status.loadingVault": "Loading vault...",
    "status.refreshingVault": "Refreshing vault...",
    "status.synced": "Synced",
    "status.pathApplied": "Path applied",
    "status.pathPasted": "Path pasted",
    "status.folderChosen": "Folder chosen",
    "status.workspaceConnected": "Workspace connected",
    "status.workspaceUpdated": "Workspace updated",
    "status.connectionDeleted": "Connection deleted",
    "status.loadError": "Load error",
    "status.switchingWorkspace": "Switching workspace...",
    "status.noteCreated": "Markdown file created",
    "status.folderCreated": "Folder created: {path}",
    "status.folderRenamed": "Folder renamed: {path}",
    "status.folderDeleted": "Folder deleted: {path}",
    "status.onlyEmptyFolders": "Only empty folders can be deleted",
    "status.moving": "Moving...",
    "status.movedTo": "Moved to {path}",
    "status.movedToRoot": "Moved to Root",
    "status.fileDeleted": "File deleted",
    "status.shownInList": "Shown in list: {title}",
    "status.copyFailed": "Failed to copy wikilink",
    "status.unsavedChanges": "Unsaved changes",
    "status.saved": "Saved",
    "status.saving": "Saving...",
    "status.savedInVault": "Saved to vault",
    "status.externalChanges": "External changes detected",
    "status.externalReloading": "External changes detected, reloading...",
    "status.externalApplied": "External changes applied",
    "status.applyingExternal": "Applying external changes...",
    "status.vaultUpdated": "Vault updated from disk",
    "status.memoryReloading": "Refreshing memory...",
    "status.memorySaved": "Memory saved",
    "status.memoryLoadError": "Memory load error",
    "status.noConnections": "No workspace connections",
    "status.copyFolder": "Copied: {value}",
    "status.copyWikilink": "Copied: [[{title}]]",
    "status.filterTag": "Filtered by #{tag}",
    "prompt.newFolder": "New folder path",
    "prompt.renameFolder": "New folder path",
    "prompt.moveNote": "Move note to",
    "prompt.renameNote": "New note title",
    "confirm.deleteFolderTitle": "Delete folder?",
    "confirm.deleteFolderDescription": "Folder \"{path}\" will be deleted. This action cannot be undone.",
    "confirm.deleteNoteTitle": "Delete note?",
    "confirm.deleteNoteDescription": "Note \"{title}\" will be deleted from the vault. This action cannot be undone.",
    "confirm.deleteConnectionTitle": "Delete workspace {name}?",
    "confirm.deleteConnectionDescription": "Tabs for this connection will be closed. This action cannot be undone.",
    "confirm.deleteConnectionDefault": "The default connection cannot be deleted.",
    "error.create": "Create failed",
    "error.createFolder": "Folder creation failed",
    "error.renameFolder": "Folder rename failed",
    "error.deleteFolder": "Folder deletion failed",
    "error.move": "Move failed",
    "error.delete": "Delete failed",
    "error.save": "Save failed",
    "error.memorySave": "Memory save failed",
    "error.memoryWorkspaceLoad": "Workspace memory load failed",
    "error.memoryGlobalLoad": "Global memory load failed",
    "error.memoryClear": "Memory clear failed",
    "error.invalidClipboardPath": "Clipboard does not contain an absolute path or file:// URL.",
    "error.readClipboard": "Failed to read the clipboard. Paste the path manually.",
    "error.pickDirectory": "Failed to open the folder picker",
    "error.workspaceNameRequired": "Workspace name is required.",
    "error.codeRootRequired": "Code root is required for a code repo.",
    "error.notesRootRequired": "Notes root is required for a code repo.",
    "error.rootPathRequired": "Root path is required for the workspace.",
    "error.connectionMissing": "Connection not found.",
    "error.connectionSave": "Failed to save connection",
    "error.connectionDelete": "Failed to delete connection",
    "error.titleTaken": "Title is already in use",
    "folder.rootCannotDelete": "Root cannot be deleted",
    "folder.rootCannotRename": "Root cannot be renamed",
    "folder.deleteSelected": "Delete empty folder {path}",
    "folder.deleteOnlyEmpty": "Only empty folders without child folders or notes can be deleted",
    "folder.renameSelected": "Rename {path}",
    "folder.expand": "Expand folder",
    "folder.collapse": "Collapse folder",
    "note.none": "No notes",
    "note.noneCopy": "Create a markdown note and it will appear here.",
    "note.emptyExcerpt": "Empty note",
    "note.wordsMeta": "{count} words",
    "note.charactersMeta": "{count} characters",
  },
};

const state: State = {
  locale: resolveInitialLocale(),
  workspace: {
    connections: [],
    activeConnectionId: null,
    switcherOpen: false,
    manager: {
      open: false,
      mode: "edit",
      selectedConnectionId: null,
      draft: createEmptyConnectionDraft(),
      saving: false,
      error: null,
    },
  },
  vault: {
    selectedNoteId: null,
    selectedNoteIds: [],
    selectionAnchorNoteId: null,
    notes: [],
    folders: [],
    selectedFolderPath: "",
    collapsedFolderPaths: [],
    folderVisibilityMode: "all",
  },
  memory: {
    initialized: false,
    global: createEmptyMemoryDocument("global"),
    workspace: createEmptyMemoryDocument("workspace"),
  },
  tabs: {
    tabs: [],
    activeTabId: null,
    initialized: false,
  },
  shell: {
    explorerCollapsed: false,
    explorerWidth: DEFAULT_EXPLORER_WIDTH,
    lastNoteView: "split",
  },
  graph: {
    contextMenuNoteId: null,
    contextMenuX: 0,
    contextMenuY: 0,
    selectedNodeId: null,
    mode: "global",
    folderScoped: false,
    existingFilesOnly: false,
    colorMode: "none",
    sidebarCollapsed: true,
    snapshot: null,
    clusters: [],
    topLinked: [],
    hubs: [],
    bridges: [],
    brokenLinks: [],
    orphans: [],
    path: null,
    pathRequestKey: "",
    pathFromNoteId: null,
    pathToNoteId: null,
    pathLoading: false,
    pathError: null,
    loading: false,
    requestKey: "",
    error: null,
    panX: 0,
    panY: 0,
    zoom: 1,
  },
  editor: {
    wikilink: {
      query: "",
      replaceStart: 0,
      replaceEnd: 0,
      activeIndex: 0,
      items: [],
    },
  },
  navigation: {
    backStack: [],
  },
  query: "",
  view: "split",
  workspaceRevision: 0,
  hasExternalChanges: false,
};

const elements: Elements = {
  appShell: query<HTMLElement>("#app-shell"),
  sidebar: query<HTMLElement>("#sidebar"),
  sidebarResizer: query<HTMLButtonElement>("#sidebar-resizer"),
  toggleExplorerButton: query<HTMLButtonElement>("#toggle-explorer-button"),
  toggleExplorerGlyph: query<HTMLElement>("#toggle-explorer-glyph"),
  graphNodeMenu: query<HTMLElement>("#graph-node-menu"),
  explorerContextMenu: query<HTMLElement>("#explorer-context-menu"),
  languageToggleButton: query<HTMLButtonElement>("#language-toggle-button"),
  memoryLayout: query<HTMLElement>("#memory-layout"),
  memoryGlobalEditor: query<HTMLTextAreaElement>("#memory-global-editor"),
  memoryWorkspaceEditor: query<HTMLTextAreaElement>("#memory-workspace-editor"),
  memoryGlobalState: query<HTMLElement>("#memory-global-state"),
  memoryWorkspaceState: query<HTMLElement>("#memory-workspace-state"),
  memoryGlobalUpdated: query<HTMLElement>("#memory-global-updated"),
  memoryWorkspaceUpdated: query<HTMLElement>("#memory-workspace-updated"),
  memoryWorkspaceConnection: query<HTMLElement>("#memory-workspace-connection"),
  memoryReloadAllButton: query<HTMLButtonElement>("#memory-reload-all-button"),
  memoryGlobalSaveButton: query<HTMLButtonElement>("#memory-global-save-button"),
  memoryGlobalReloadButton: query<HTMLButtonElement>("#memory-global-reload-button"),
  memoryGlobalClearButton: query<HTMLButtonElement>("#memory-global-clear-button"),
  memoryWorkspaceSaveButton: query<HTMLButtonElement>("#memory-workspace-save-button"),
  memoryWorkspaceReloadButton: query<HTMLButtonElement>("#memory-workspace-reload-button"),
  memoryWorkspaceClearButton: query<HTMLButtonElement>("#memory-workspace-clear-button"),
  sidebarVaultTitle: query<HTMLElement>("#sidebar-vault-title"),
  sidebarVaultSwitcher: query<HTMLButtonElement>("#sidebar-vault-switcher"),
  sidebarVaultMenu: query<HTMLElement>("#sidebar-vault-menu"),
  workspaceConnectionsButton: query<HTMLButtonElement>("#workspace-connections-button"),
  workspaceTabList: query<HTMLElement>("#workspace-tab-list"),
  workspaceNewTabButton: query<HTMLButtonElement>("#workspace-new-tab-button"),
  workspaceActiveTabState: query<HTMLElement>("#workspace-active-tab-state"),
  workspaceViewBadge: query<HTMLElement>("#workspace-view-badge"),
  workspaceBackButton: query<HTMLButtonElement>("#workspace-back-button"),
  folderList: query<HTMLUListElement>("#folder-list"),
  folderCount: query<HTMLElement>("#folder-count"),
  noteList: query<HTMLUListElement>("#note-list"),
  noteCount: query<HTMLElement>("#note-count"),
  noteTitle: query<HTMLInputElement>("#note-title"),
  noteFolderSelect: query<HTMLSelectElement>("#note-folder-select"),
  notePathBadge: query<HTMLElement>("#note-path-badge"),
  noteMoveButton: query<HTMLButtonElement>("#note-move-button"),
  titleHint: query<HTMLElement>("#title-hint"),
  noteTags: query<HTMLElement>("#note-tags"),
  noteContext: query<HTMLElement>("#note-context"),
  noteBacklinks: query<HTMLElement>("#note-backlinks"),
  noteEditor: query<HTMLTextAreaElement>("#note-editor"),
  wikilinkSuggestions: query<HTMLElement>("#wikilink-suggestions"),
  notePreview: query<HTMLDivElement>("#note-preview"),
  noteMeta: query<HTMLElement>("#note-meta"),
  graphPane: query<HTMLElement>("#graph-pane"),
  graphCanvas: query<SVGSVGElement>("#graph-canvas"),
  graphStats: query<HTMLElement>("#graph-stats"),
  graphLegend: query<HTMLElement>("#graph-legend"),
  graphEmptyState: query<HTMLElement>("#graph-empty-state"),
  graphTopLinked: query<HTMLElement>("#graph-top-linked"),
  graphHubs: query<HTMLElement>("#graph-hubs"),
  graphBridges: query<HTMLElement>("#graph-bridges"),
  graphBrokenLinks: query<HTMLElement>("#graph-broken-links"),
  graphOrphans: query<HTMLElement>("#graph-orphans"),
  graphPathFrom: query<HTMLSelectElement>("#graph-path-from"),
  graphPathTo: query<HTMLSelectElement>("#graph-path-to"),
  graphPathResult: query<HTMLElement>("#graph-path-result"),
  graphGlobalButton: query<HTMLButtonElement>("#graph-global-button"),
  graphLocalButton: query<HTMLButtonElement>("#graph-local-button"),
  graphColorModeButton: query<HTMLButtonElement>("#graph-color-mode-button"),
  graphFolderScopeButton: query<HTMLButtonElement>("#graph-folder-scope-button"),
  graphExistingOnlyButton: query<HTMLButtonElement>("#graph-existing-only-button"),
  graphCenterViewButton: query<HTMLButtonElement>("#graph-center-view-button"),
  graphResetViewButton: query<HTMLButtonElement>("#graph-reset-view-button"),
  graphToggleSidebarButton: query<HTMLButtonElement>("#graph-toggle-sidebar-button"),
  graphPathCurrentButton: query<HTMLButtonElement>("#graph-path-current-button"),
  graphPathSwapButton: query<HTMLButtonElement>("#graph-path-swap-button"),
  graphPathFindButton: query<HTMLButtonElement>("#graph-path-find-button"),
  searchInput: query<HTMLInputElement>("#search-input"),
  newFolderButton: query<HTMLButtonElement>("#new-folder-button"),
  renameFolderButton: query<HTMLButtonElement>("#rename-folder-button"),
  deleteFolderButton: query<HTMLButtonElement>("#delete-folder-button"),
  showAllFoldersButton: query<HTMLButtonElement>("#show-all-folders-button"),
  showSelectedFolderButton: query<HTMLButtonElement>("#show-selected-folder-button"),
  folderSelectionPath: query<HTMLElement>("#folder-selection-path"),
  newNoteButton: query<HTMLButtonElement>("#new-note-button"),
  deleteButton: query<HTMLButtonElement>("#delete-button"),
  refreshButton: query<HTMLButtonElement>("#refresh-button"),
  saveState: query<HTMLElement>("#save-state"),
  editorLayout: query<HTMLElement>("#editor-layout"),
  emptyNoteTemplate: query<HTMLTemplateElement>("#empty-note-template"),
  connectionManager: query<HTMLElement>("#connection-manager"),
  connectionManagerBackdrop: query<HTMLElement>("#connection-manager-backdrop"),
  connectionManagerClose: query<HTMLButtonElement>("#connection-manager-close"),
  connectionManagerList: query<HTMLElement>("#connection-manager-list"),
  connectionManagerEmpty: query<HTMLElement>("#connection-manager-empty"),
  connectionManagerForm: query<HTMLFormElement>("#connection-manager-form"),
  connectionManagerTitle: query<HTMLElement>("#connection-manager-title"),
  connectionManagerDescription: query<HTMLElement>("#connection-manager-description"),
  connectionManagerKindHint: query<HTMLElement>("#connection-manager-kind-hint"),
  connectionManagerRootField: query<HTMLElement>("#connection-manager-root-field"),
  connectionManagerRootLabel: query<HTMLElement>("#connection-manager-root-label"),
  connectionManagerRootHint: query<HTMLElement>("#connection-manager-root-hint"),
  connectionManagerNameInput: query<HTMLInputElement>("#connection-manager-name"),
  connectionManagerKindSelect: query<HTMLSelectElement>("#connection-manager-kind"),
  connectionManagerRootPathInput: query<HTMLInputElement>("#connection-manager-root-path"),
  connectionManagerCodeRootField: query<HTMLElement>("#connection-manager-code-root-field"),
  connectionManagerCodeRootInput: query<HTMLInputElement>("#connection-manager-code-root"),
  connectionManagerNotesRootField: query<HTMLElement>("#connection-manager-notes-root-field"),
  connectionManagerNotesRootInput: query<HTMLInputElement>("#connection-manager-notes-root"),
  connectionManagerDefaultCheckbox: query<HTMLInputElement>("#connection-manager-default"),
  connectionManagerActivateCheckbox: query<HTMLInputElement>("#connection-manager-activate"),
  connectionManagerError: query<HTMLElement>("#connection-manager-error"),
  connectionManagerDeleteButton: query<HTMLButtonElement>("#connection-manager-delete"),
  connectionManagerUseButton: query<HTMLButtonElement>("#connection-manager-use"),
  connectionManagerResetButton: query<HTMLButtonElement>("#connection-manager-reset"),
  connectionManagerSubmitButton: query<HTMLButtonElement>("#connection-manager-submit"),
  connectionManagerCreateButton: query<HTMLButtonElement>("#connection-manager-create"),
  confirmDialog: query<HTMLElement>("#confirm-dialog"),
  confirmDialogBackdrop: query<HTMLElement>("#confirm-dialog-backdrop"),
  confirmDialogTitle: query<HTMLElement>("#confirm-dialog-title"),
  confirmDialogDescription: query<HTMLElement>("#confirm-dialog-description"),
  confirmDialogCancel: query<HTMLButtonElement>("#confirm-dialog-cancel"),
  confirmDialogConfirm: query<HTMLButtonElement>("#confirm-dialog-confirm"),
  viewButtons: Array.from(document.querySelectorAll<HTMLButtonElement>("[data-view]")),
};

let saveStateTimeout: number | null = null;
let saveTimer: number | null = null;
let pendingSaveNoteId: string | null = null;
let globalMemorySaveTimer: number | null = null;
let workspaceMemorySaveTimer: number | null = null;
let saveSequence: Promise<boolean> = Promise.resolve(true);
let workspacePollTimer: number | null = null;
let saveInFlight = false;
let graphRequestSequence = 0;
let graphPathRequestSequence = 0;
let isGraphDragging = false;
let graphDragPointerId: number | null = null;
let graphLastPointer = { x: 0, y: 0 };
let draggedWorkspaceTabId: string | null = null;
let isSidebarResizing = false;
let sidebarResizePointerId: number | null = null;
let sidebarResizeStartX = 0;
let sidebarResizeStartWidth = DEFAULT_EXPLORER_WIDTH;
let confirmDialogResolver: ((confirmed: boolean) => void) | null = null;
let isRestoringNavigation = false;
let explorerContextMenuTarget:
  | { type: "note"; noteId: string }
  | { type: "folder"; folderPath: string }
  | null = null;

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

function resolveInitialLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "ru" || stored === "en") {
      return stored;
    }
  } catch {
    // Ignore localStorage access issues and fall back to browser hints.
  }

  const documentLocale = document.documentElement.lang?.trim().toLowerCase();
  if (documentLocale === "ru" || documentLocale === "en") {
    return documentLocale;
  }

  return navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

function t(
  key: string,
  variables: Record<string, string | number> = {}
): string {
  const template = TRANSLATIONS[state.locale][key] ?? TRANSLATIONS.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_match, token) => String(variables[token] ?? ""));
}

function persistLocalePreference(): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, state.locale);
  } catch {
    // Ignore persistence errors and keep locale in memory.
  }
}

function resolveStoredActiveConnectionId(): string | null {
  try {
    const stored = window.localStorage.getItem(ACTIVE_CONNECTION_STORAGE_KEY)?.trim();
    return stored ? stored : null;
  } catch {
    return null;
  }
}

function persistActiveConnectionPreference(connectionId: string | null): void {
  try {
    if (!connectionId) {
      window.localStorage.removeItem(ACTIVE_CONNECTION_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(ACTIVE_CONNECTION_STORAGE_KEY, connectionId);
  } catch {
    // Ignore storage failures; connection state still works for the current session.
  }
}

function setLocale(locale: Locale): void {
  if (state.locale === locale) {
    return;
  }

  state.locale = locale;
  persistLocalePreference();
  render();
}

function toggleLocale(): void {
  setLocale(state.locale === "ru" ? "en" : "ru");
}

function applyTranslations(): void {
  document.documentElement.lang = state.locale;
  document.title = t("app.title");

  elements.languageToggleButton.textContent = t("app.language.toggle");
  elements.languageToggleButton.title = t("app.language.switch");
  elements.languageToggleButton.setAttribute("aria-label", t("app.language.switch"));

  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (!key) {
      return;
    }

    element.textContent = t(key);
  });

  document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((element) => {
    const key = element.dataset.i18nPlaceholder;
    if (!key || !("placeholder" in element)) {
      return;
    }

    (element as HTMLInputElement | HTMLTextAreaElement).placeholder = t(key);
  });

  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((element) => {
    const key = element.dataset.i18nTitle;
    if (!key) {
      return;
    }

    element.title = t(key);
  });

  document.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((element) => {
    const key = element.dataset.i18nAriaLabel;
    if (!key) {
      return;
    }

    element.setAttribute("aria-label", t(key));
  });
}

function getRootLabel(): string {
  return t("common.root");
}

function captureNavigationEntry(): NavigationEntry {
  return {
    view: state.view,
    selectedNoteId: state.vault.selectedNoteId,
    selectedFolderPath: state.vault.selectedFolderPath,
    activeTabId: state.tabs.activeTabId,
    connectionId: getActiveConnectionId() ?? null,
    graph: {
      mode: state.graph.mode,
      folderScoped: state.graph.folderScoped,
      existingFilesOnly: state.graph.existingFilesOnly,
      colorMode: state.graph.colorMode,
      sidebarCollapsed: state.graph.sidebarCollapsed,
      selectedNodeId: state.graph.selectedNodeId,
      panX: state.graph.panX,
      panY: state.graph.panY,
      zoom: state.graph.zoom,
    },
  };
}

function areNavigationEntriesEqual(left: NavigationEntry, right: NavigationEntry): boolean {
  return left.view === right.view
    && left.selectedNoteId === right.selectedNoteId
    && left.selectedFolderPath === right.selectedFolderPath
    && left.activeTabId === right.activeTabId
    && left.connectionId === right.connectionId
    && left.graph.mode === right.graph.mode
    && left.graph.folderScoped === right.graph.folderScoped
    && left.graph.existingFilesOnly === right.graph.existingFilesOnly
    && left.graph.colorMode === right.graph.colorMode
    && left.graph.sidebarCollapsed === right.graph.sidebarCollapsed
    && left.graph.selectedNodeId === right.graph.selectedNodeId
    && left.graph.panX === right.graph.panX
    && left.graph.panY === right.graph.panY
    && left.graph.zoom === right.graph.zoom;
}

function pushNavigationEntry(entry: NavigationEntry): void {
  const lastEntry = state.navigation.backStack[state.navigation.backStack.length - 1];
  if (lastEntry && areNavigationEntriesEqual(lastEntry, entry)) {
    return;
  }

  state.navigation.backStack = [...state.navigation.backStack, entry].slice(-50);
}

function renderNavigationControls(): void {
  elements.workspaceBackButton.disabled = state.navigation.backStack.length === 0;
  elements.workspaceBackButton.title = t("workspace.back");
  elements.workspaceBackButton.setAttribute("aria-label", t("workspace.back"));
}

async function bootstrap(): Promise<void> {
  hydrateShellPreferences();
  applyTranslations();
  bindEvents();
  applyShellLayout();
  setStatus(t("status.loadingVault"));
  await reloadVault(null, { preferredConnectionId: resolveStoredActiveConnectionId() });
  await ensureMemoryLoaded();
  startWorkspacePolling();
}

async function navigateBack(): Promise<void> {
  const target = state.navigation.backStack[state.navigation.backStack.length - 1];
  if (!target || isRestoringNavigation) {
    return;
  }

  commitCurrentTitleDraft();
  const saved = await flushAllPendingSaves();
  if (!saved) {
    return;
  }

  state.navigation.backStack = state.navigation.backStack.slice(0, -1);
  isRestoringNavigation = true;
  try {
    await restoreNavigationEntry(target);
  } finally {
    isRestoringNavigation = false;
    renderNavigationControls();
  }
}

async function restoreNavigationEntry(entry: NavigationEntry): Promise<void> {
  if (entry.connectionId && entry.connectionId !== getActiveConnectionId()) {
    state.workspace.activeConnectionId = entry.connectionId;
    await reloadVault(entry.selectedNoteId, { preferredConnectionId: entry.connectionId });
  }

  state.graph.mode = entry.graph.mode;
  state.graph.folderScoped = entry.graph.folderScoped;
  state.graph.existingFilesOnly = entry.graph.existingFilesOnly;
  state.graph.colorMode = entry.graph.colorMode;
  state.graph.sidebarCollapsed = entry.graph.sidebarCollapsed;
  state.graph.selectedNodeId = entry.graph.selectedNodeId;
  state.graph.panX = entry.graph.panX;
  state.graph.panY = entry.graph.panY;
  state.graph.zoom = entry.graph.zoom;

  const selectedNoteId = resolveSelection(entry.selectedNoteId, state.vault.notes);
  state.vault.selectedNoteId = selectedNoteId;
  state.vault.selectedFolderPath = entry.selectedFolderPath;

  if (entry.view === "graph" || entry.view === "memory") {
    state.view = entry.view;
    if (entry.view !== "memory") {
      rememberNoteView(entry.view);
    }
    render();
    if (entry.view === "graph") {
      void ensureGraphData();
    }
    return;
  }

  if (selectedNoteId) {
    await openNote(selectedNoteId, {
      nextView: entry.view,
      historyMode: "skip",
    });
    return;
  }

  state.view = entry.view;
  rememberNoteView(entry.view);
  render();
}

async function navigateToView(
  mode: ViewMode,
  options: { historyMode?: "push" | "skip" } = {}
): Promise<void> {
  if (mode === state.view) {
    return;
  }

  if (options.historyMode !== "skip" && !isRestoringNavigation) {
    pushNavigationEntry(captureNavigationEntry());
  }

  state.view = mode;
  rememberNoteView(mode);
  render();
  if (state.view === "graph") {
    void ensureGraphData(true);
  }
}

function bindEvents(): void {
  elements.languageToggleButton.addEventListener("click", () => {
    toggleLocale();
  });

  elements.toggleExplorerButton.addEventListener("click", () => {
    toggleExplorer();
  });

  elements.sidebarResizer.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0 || state.shell.explorerCollapsed) {
      return;
    }

    isSidebarResizing = true;
    sidebarResizePointerId = event.pointerId;
    sidebarResizeStartX = event.clientX;
    sidebarResizeStartWidth = state.shell.explorerWidth;
    elements.sidebarResizer.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing-sidebar");
    event.preventDefault();
  });

  window.addEventListener("pointermove", (event: PointerEvent) => {
    if (!isSidebarResizing || sidebarResizePointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - sidebarResizeStartX;
    state.shell.explorerWidth = clampExplorerWidth(sidebarResizeStartWidth + deltaX);
    applyShellLayout();
  });

  const finishSidebarResize = (event: PointerEvent) => {
    if (!isSidebarResizing || sidebarResizePointerId !== event.pointerId) {
      return;
    }

    if (elements.sidebarResizer.hasPointerCapture(event.pointerId)) {
      elements.sidebarResizer.releasePointerCapture(event.pointerId);
    }

    isSidebarResizing = false;
    sidebarResizePointerId = null;
    document.body.classList.remove("is-resizing-sidebar");
    persistShellPreferences();
  };

  window.addEventListener("pointerup", finishSidebarResize);
  window.addEventListener("pointercancel", finishSidebarResize);
  window.addEventListener("resize", () => {
    state.shell.explorerWidth = clampExplorerWidth(state.shell.explorerWidth);
    applyShellLayout();
    closeGraphNodeMenu();
  });

  elements.newNoteButton.addEventListener("click", () => {
    void handleCreateNote();
  });

  elements.workspaceConnectionsButton.addEventListener("click", () => {
    if (state.workspace.manager.open) {
      closeConnectionManager();
      return;
    }

    openConnectionManager();
  });

  elements.sidebarVaultSwitcher.addEventListener("click", () => {
    state.workspace.switcherOpen = !state.workspace.switcherOpen;
    renderWorkspaceConnections();
  });

  elements.newFolderButton.addEventListener("click", () => {
    void handleCreateFolder();
  });

  elements.renameFolderButton.addEventListener("click", () => {
    void handleRenameSelectedFolder();
  });

  elements.deleteFolderButton.addEventListener("click", () => {
    void handleDeleteSelectedFolder();
  });

  elements.showAllFoldersButton.addEventListener("click", () => {
    setFolderVisibilityMode("all");
  });

  elements.showSelectedFolderButton.addEventListener("click", () => {
    setFolderVisibilityMode("selected");
  });

  elements.graphGlobalButton.addEventListener("click", () => {
    setGraphMode("global");
  });

  elements.graphLocalButton.addEventListener("click", () => {
    setGraphMode("local");
  });

  elements.graphColorModeButton.addEventListener("click", () => {
    state.graph.colorMode = getNextGraphColorMode(state.graph.colorMode);
    renderGraphView();
  });

  elements.graphFolderScopeButton.addEventListener("click", () => {
    state.graph.folderScoped = !state.graph.folderScoped;
    renderGraphView();
    void ensureGraphData();
  });

  elements.graphExistingOnlyButton.addEventListener("click", () => {
    state.graph.existingFilesOnly = !state.graph.existingFilesOnly;
    renderGraphView();
    void ensureGraphData();
  });

  elements.graphCenterViewButton.addEventListener("click", () => {
    centerGraphViewport();
    renderGraphCanvas();
  });

  elements.graphResetViewButton.addEventListener("click", () => {
    resetGraphViewport();
    renderGraphCanvas();
  });

  elements.graphToggleSidebarButton.addEventListener("click", () => {
    state.graph.sidebarCollapsed = !state.graph.sidebarCollapsed;
    renderGraphView();
  });

  elements.graphPathCurrentButton.addEventListener("click", () => {
    if (!state.vault.selectedNoteId) {
      return;
    }

    state.graph.pathFromNoteId = state.vault.selectedNoteId;
    syncGraphPathSelection();
    renderGraphView();
  });

  elements.graphPathSwapButton.addEventListener("click", () => {
    const nextFrom = state.graph.pathToNoteId;
    const nextTo = state.graph.pathFromNoteId;
    state.graph.pathFromNoteId = nextFrom;
    state.graph.pathToNoteId = nextTo;
    syncGraphPathSelection();
    renderGraphView();
  });

  elements.graphPathFindButton.addEventListener("click", () => {
    void ensureGraphPathData(true);
  });

  elements.graphPathFrom.addEventListener("change", () => {
    state.graph.pathFromNoteId = elements.graphPathFrom.value || null;
    state.graph.path = null;
    state.graph.pathError = null;
    renderGraphView();
  });

  elements.graphPathTo.addEventListener("change", () => {
    state.graph.pathToNoteId = elements.graphPathTo.value || null;
    state.graph.path = null;
    state.graph.pathError = null;
    renderGraphView();
  });

  elements.deleteButton.addEventListener("click", () => {
    void handleDeleteNote();
  });

  elements.refreshButton.addEventListener("click", () => {
    void handleRefreshVault();
  });

  elements.memoryReloadAllButton.addEventListener("click", () => {
    void handleReloadMemory(true);
  });

  elements.memoryGlobalEditor.addEventListener("input", () => {
    updateMemoryContent("global", elements.memoryGlobalEditor.value);
  });

  elements.memoryWorkspaceEditor.addEventListener("input", () => {
    updateMemoryContent("workspace", elements.memoryWorkspaceEditor.value);
  });

  elements.memoryGlobalSaveButton.addEventListener("click", () => {
    void flushPendingMemorySaves({ scopes: ["global"], flash: true });
  });

  elements.memoryGlobalReloadButton.addEventListener("click", () => {
    void reloadMemoryScope("global", { force: true });
  });

  elements.memoryGlobalClearButton.addEventListener("click", () => {
    void clearMemoryDocument("global");
  });

  elements.memoryWorkspaceSaveButton.addEventListener("click", () => {
    void flushPendingMemorySaves({ scopes: ["workspace"], flash: true });
  });

  elements.memoryWorkspaceReloadButton.addEventListener("click", () => {
    void reloadMemoryScope("workspace", { force: true });
  });

  elements.memoryWorkspaceClearButton.addEventListener("click", () => {
    void clearMemoryDocument("workspace");
  });

  elements.connectionManagerBackdrop.addEventListener("click", () => {
    closeConnectionManager();
  });

  elements.connectionManagerClose.addEventListener("click", () => {
    closeConnectionManager();
  });

  elements.connectionManagerCreateButton.addEventListener("click", () => {
    startCreatingWorkspaceConnection();
  });

  elements.connectionManagerList.addEventListener("click", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const connectionId = target.closest<HTMLElement>("[data-connection-manager-id]")?.dataset.connectionManagerId?.trim();
    if (!connectionId) {
      return;
    }

    selectWorkspaceConnectionForEditing(connectionId);
  });

  elements.connectionManagerKindSelect.addEventListener("change", () => {
    if (!isWorkspaceConnectionKind(elements.connectionManagerKindSelect.value)) {
      return;
    }

    updateConnectionManagerKind(elements.connectionManagerKindSelect.value);
  });

  elements.connectionManagerNameInput.addEventListener("input", () => {
    updateConnectionManagerDraft({ name: elements.connectionManagerNameInput.value });
  });

  elements.connectionManagerRootPathInput.addEventListener("input", () => {
    updateConnectionManagerDraft({ rootPath: elements.connectionManagerRootPathInput.value });
  });

  elements.connectionManagerCodeRootInput.addEventListener("input", () => {
    updateConnectionManagerDraft({ codeRoot: elements.connectionManagerCodeRootInput.value });
  });

  elements.connectionManagerNotesRootInput.addEventListener("input", () => {
    updateConnectionManagerDraft({ notesRoot: elements.connectionManagerNotesRootInput.value });
  });

  elements.connectionManagerDefaultCheckbox.addEventListener("change", () => {
    updateConnectionManagerDraft({ isDefault: elements.connectionManagerDefaultCheckbox.checked });
  });

  elements.connectionManagerActivateCheckbox.addEventListener("change", () => {
    updateConnectionManagerDraft({ activateOnSave: elements.connectionManagerActivateCheckbox.checked });
  });

  elements.connectionManagerResetButton.addEventListener("click", () => {
    resetConnectionManagerDraft();
  });

  elements.connectionManagerUseButton.addEventListener("click", () => {
    void activateConnectionFromManager();
  });

  elements.connectionManagerDeleteButton.addEventListener("click", () => {
    void deleteConnectionFromManager();
  });

  elements.connectionManagerForm.addEventListener("submit", (event: SubmitEvent) => {
    event.preventDefault();
    void saveConnectionFromManager();
  });

  elements.connectionManagerForm.addEventListener("click", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const presetKind = target.closest<HTMLElement>("[data-connection-preset]")?.dataset.connectionPreset;
    if (isWorkspaceConnectionKind(presetKind)) {
      startCreatingWorkspaceConnection(presetKind);
      return;
    }

    const browseField = target.closest<HTMLElement>("[data-connection-path-browse]")?.dataset.connectionPathBrowse;
    if (isConnectionPathField(browseField)) {
      void browseConnectionPathField(browseField);
      return;
    }

    const pasteField = target.closest<HTMLElement>("[data-connection-path-paste]")?.dataset.connectionPathPaste;
    if (isConnectionPathField(pasteField)) {
      void pasteConnectionPathField(pasteField);
      return;
    }

    const clearField = target.closest<HTMLElement>("[data-connection-path-clear]")?.dataset.connectionPathClear;
    if (isConnectionPathField(clearField)) {
      clearConnectionPathField(clearField);
    }
  });

  elements.connectionManagerForm.addEventListener("dragover", (event: DragEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const field = target.closest<HTMLElement>("[data-connection-path-field]");
    if (!field) {
      return;
    }

    event.preventDefault();
    field.classList.add("is-drop-target");
  });

  elements.connectionManagerForm.addEventListener("dragleave", (event: DragEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const field = target.closest<HTMLElement>("[data-connection-path-field]");
    if (!field) {
      return;
    }

    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && field.contains(nextTarget)) {
      return;
    }

    field.classList.remove("is-drop-target");
  });

  elements.connectionManagerForm.addEventListener("drop", (event: DragEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const fieldContainer = target.closest<HTMLElement>("[data-connection-path-field]");
    const field = fieldContainer?.dataset.connectionPathField;
    if (!fieldContainer || !isConnectionPathField(field)) {
      return;
    }

    event.preventDefault();
    fieldContainer.classList.remove("is-drop-target");
    const droppedPath = extractDroppedConnectionPath(event.dataTransfer);
    if (!droppedPath) {
      state.workspace.manager.error = t("connection.pathHelp");
      renderConnectionManager();
      return;
    }

    applyConnectionPathField(field, droppedPath);
    flashStatus(t("status.pathApplied"));
  });

  elements.confirmDialogCancel.addEventListener("click", () => {
    resolveConfirmDialog(false);
  });

  elements.confirmDialogConfirm.addEventListener("click", () => {
    resolveConfirmDialog(true);
  });

  elements.confirmDialogBackdrop.addEventListener("click", () => {
    resolveConfirmDialog(false);
  });

  elements.noteTitle.addEventListener("input", () => {
    updateNoteTitle(elements.noteTitle.value);
  });

  elements.noteFolderSelect.addEventListener("change", () => {
    void handleMoveSelectedNote(elements.noteFolderSelect.value);
  });

  elements.noteMoveButton.addEventListener("click", () => {
    void handlePromptMoveSelectedNote();
  });

  elements.noteTitle.addEventListener("blur", () => {
    commitCurrentTitleDraft({ delayMs: TITLE_SAVE_DEBOUNCE_MS });
    renderNoteList();
    renderWorkspace(false);
  });

  elements.noteTitle.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      elements.noteTitle.blur();
    }
  });

  elements.noteEditor.addEventListener("input", () => {
    updateNoteContent(elements.noteEditor.value);
    updateWikilinkSuggestions();
  });

  elements.noteEditor.addEventListener("click", () => {
    updateWikilinkSuggestions();
  });

  elements.noteEditor.addEventListener("keyup", (event: KeyboardEvent) => {
    if (event.key.startsWith("Arrow") || event.key === "Enter" || event.key === "Tab" || event.key === "Escape") {
      return;
    }

    updateWikilinkSuggestions();
  });

  elements.noteEditor.addEventListener("blur", () => {
    closeWikilinkSuggestions();
  });

  elements.noteEditor.addEventListener("keydown", (event: KeyboardEvent) => {
    if (!state.editor.wikilink.items.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.editor.wikilink.activeIndex = (state.editor.wikilink.activeIndex + 1) % state.editor.wikilink.items.length;
      renderWikilinkSuggestions();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.editor.wikilink.activeIndex = (state.editor.wikilink.activeIndex - 1 + state.editor.wikilink.items.length)
        % state.editor.wikilink.items.length;
      renderWikilinkSuggestions();
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      applyActiveWikilinkSuggestion();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeWikilinkSuggestions();
    }
  });

  elements.wikilinkSuggestions.addEventListener("mousedown", (event: MouseEvent) => {
    event.preventDefault();
  });

  elements.wikilinkSuggestions.addEventListener("click", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const noteId = target.closest<HTMLElement>("[data-wikilink-note-id]")?.dataset.wikilinkNoteId?.trim();
    if (!noteId) {
      return;
    }

    const index = state.editor.wikilink.items.findIndex((item) => item.noteId === noteId);
    if (index === -1) {
      return;
    }

    state.editor.wikilink.activeIndex = index;
    applyActiveWikilinkSuggestion();
  });

  elements.searchInput.addEventListener("input", () => {
    state.query = elements.searchInput.value.trim().toLowerCase();
    renderNoteList();
  });

  elements.workspaceTabList.addEventListener("click", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const closeNoteId = target.closest<HTMLElement>("[data-workspace-tab-close]")?.dataset.workspaceTabClose?.trim();
    if (closeNoteId) {
      event.preventDefault();
      event.stopPropagation();
      void closeWorkspaceTab(closeNoteId);
      return;
    }

    const pinNoteId = target.closest<HTMLElement>("[data-workspace-tab-pin]")?.dataset.workspaceTabPin?.trim();
    if (pinNoteId) {
      event.preventDefault();
      event.stopPropagation();
      void toggleWorkspaceTabPin(pinNoteId);
      return;
    }

    const activateNoteId = target.closest<HTMLElement>("[data-workspace-tab-activate]")?.dataset.workspaceTabActivate?.trim();
    if (activateNoteId) {
      event.preventDefault();
      void activateWorkspaceTab(activateNoteId);
    }
  });

  elements.workspaceNewTabButton.addEventListener("click", () => {
    void openSelectedNoteInNewTab();
  });

  elements.workspaceBackButton.addEventListener("click", () => {
    void navigateBack();
  });

  elements.workspaceTabList.addEventListener("dragstart", (event: DragEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const tab = target.closest<HTMLElement>("[data-workspace-tab-id]");
    const noteId = tab?.dataset.workspaceTabId?.trim();
    if (!tab || !noteId) {
      return;
    }

    draggedWorkspaceTabId = noteId;
    tab.classList.add("is-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", noteId);
    }
  });

  elements.workspaceTabList.addEventListener("dragend", () => {
    draggedWorkspaceTabId = null;
    clearWorkspaceTabDragState();
  });

  elements.workspaceTabList.addEventListener("dragover", (event: DragEvent) => {
    if (!draggedWorkspaceTabId) {
      return;
    }

    event.preventDefault();
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    clearWorkspaceTabDropTargets();
    const tab = target.closest<HTMLElement>("[data-workspace-tab-id]");
    if (tab && tab.dataset.workspaceTabId !== draggedWorkspaceTabId) {
      tab.classList.add("is-drop-target");
    }
  });

  elements.workspaceTabList.addEventListener("dragleave", (event: DragEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const tab = target.closest<HTMLElement>("[data-workspace-tab-id]");
    tab?.classList.remove("is-drop-target");
  });

  elements.workspaceTabList.addEventListener("drop", (event: DragEvent) => {
    if (!draggedWorkspaceTabId) {
      return;
    }

    event.preventDefault();
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      clearWorkspaceTabDragState();
      return;
    }

    const tab = target.closest<HTMLElement>("[data-workspace-tab-id]");
    void moveWorkspaceTab(draggedWorkspaceTabId, tab, event.clientX);
    clearWorkspaceTabDragState();
  });

  elements.viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.view;
      if (!isViewMode(mode)) {
        return;
      }

      void navigateToView(mode);
    });
  });

  elements.notePreview.addEventListener("click", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const link = target.closest<HTMLElement>("[data-wikilink]");
    const title = link?.dataset.wikilink?.trim();
    if (!title) {
      return;
    }

    void handleOpenOrCreateByTitle(title);
  });

  elements.noteTags.addEventListener("click", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const tag = target.closest<HTMLElement>("[data-tag]")?.dataset.tag?.trim();
    if (!tag) {
      return;
    }

    applyTagFilter(tag);
  });

  elements.noteBacklinks.addEventListener("click", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const noteId = target.closest<HTMLElement>("[data-note-id]")?.dataset.noteId?.trim();
    if (!noteId) {
      return;
    }

    void openNote(noteId);
  });

  elements.graphCanvas.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }

    isGraphDragging = false;
    graphDragPointerId = event.pointerId;
    graphLastPointer = { x: event.clientX, y: event.clientY };
    elements.graphCanvas.setPointerCapture(event.pointerId);
    elements.graphCanvas.classList.add("is-dragging");
  });

  elements.graphCanvas.addEventListener("pointermove", (event: PointerEvent) => {
    if (graphDragPointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - graphLastPointer.x;
    const deltaY = event.clientY - graphLastPointer.y;
    if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
      isGraphDragging = true;
    }

    graphLastPointer = { x: event.clientX, y: event.clientY };
    const rect = elements.graphCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    state.graph.panX += (deltaX * GRAPH_VIEWBOX_WIDTH) / (rect.width * state.graph.zoom);
    state.graph.panY += (deltaY * GRAPH_VIEWBOX_HEIGHT) / (rect.height * state.graph.zoom);
    renderGraphCanvas();
  });

  elements.graphCanvas.addEventListener("pointerup", (event: PointerEvent) => {
    if (graphDragPointerId !== event.pointerId) {
      return;
    }

    elements.graphCanvas.releasePointerCapture(event.pointerId);
    graphDragPointerId = null;
    elements.graphCanvas.classList.remove("is-dragging");
    window.setTimeout(() => {
      isGraphDragging = false;
    }, 0);
  });

  elements.graphCanvas.addEventListener("pointerleave", () => {
    if (graphDragPointerId === null) {
      elements.graphCanvas.classList.remove("is-dragging");
    }
  });

  elements.graphCanvas.addEventListener("click", () => {
    if (isGraphDragging || state.graph.selectedNodeId === null) {
      return;
    }

    closeGraphNodeMenu();
    state.graph.selectedNodeId = null;
    renderGraphCanvas();
  });

  elements.graphCanvas.addEventListener("wheel", (event: WheelEvent) => {
    event.preventDefault();
    closeGraphNodeMenu();
    const direction = event.deltaY > 0 ? -1 : 1;
    const nextZoom = clamp(state.graph.zoom + direction * 0.12, 0.18, 2.8);
    if (nextZoom === state.graph.zoom) {
      return;
    }

    state.graph.zoom = nextZoom;
    renderGraphCanvas();
  }, { passive: false });

  [
    elements.graphTopLinked,
    elements.graphHubs,
    elements.graphBridges,
    elements.graphOrphans,
    elements.graphPathResult,
  ].forEach((container) => {
    container.addEventListener("click", (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const noteId = target.closest<HTMLElement>("[data-note-id]")?.dataset.noteId?.trim();
      if (!noteId) {
        return;
      }

      void openNote(noteId);
    });
  });

  elements.graphBrokenLinks.addEventListener("click", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const noteId = target.closest<HTMLElement>("[data-note-id]")?.dataset.noteId?.trim();
    if (!noteId) {
      return;
    }

    void openNote(noteId);
  });

  elements.folderList.addEventListener("click", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const togglePath = target.closest<HTMLElement>("[data-folder-toggle]")?.dataset.folderToggle;
    if (togglePath !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      toggleFolderCollapse(togglePath);
      renderFolderList();
      renderNoteList();
      return;
    }

    const folderPath = target.closest<HTMLElement>("[data-folder-path]")?.dataset.folderPath;
    if (folderPath === undefined) {
      return;
    }

    state.vault.selectedFolderPath = folderPath;
    expandFolderAncestors(folderPath);
    renderFolderControls();
    renderFolderList();
    renderNoteList();
    renderGraphView();
    if (state.view === "graph") {
      void ensureGraphData(true);
    }
  });

  elements.noteList.addEventListener("click", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const togglePath = target.closest<HTMLElement>("[data-folder-toggle]")?.dataset.folderToggle;
    if (togglePath !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      toggleFolderCollapse(togglePath);
      renderNoteList();
      return;
    }

    const folderPath = target.closest<HTMLElement>("[data-folder-path]")?.dataset.folderPath;
    if (folderPath !== undefined) {
      state.vault.selectedFolderPath = folderPath;
      expandFolderAncestors(folderPath);
      renderFolderControls();
      renderFolderList();
      renderNoteList();
      renderGraphView();
      if (state.view === "graph") {
        void ensureGraphData(true);
      }
    }
  });

  elements.noteList.addEventListener("contextmenu", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const noteId = target.closest<HTMLElement>("[data-note-id]")?.dataset.noteId?.trim();
    if (noteId) {
      event.preventDefault();
      openExplorerContextMenu({ type: "note", noteId }, event.clientX, event.clientY);
      return;
    }

    const folderPath = target.closest<HTMLElement>("[data-folder-path]")?.dataset.folderPath;
    if (folderPath !== undefined) {
      event.preventDefault();
      openExplorerContextMenu({ type: "folder", folderPath }, event.clientX, event.clientY);
    }
  });

  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (!elements.confirmDialog.hidden && event.key === "Escape") {
      event.preventDefault();
      resolveConfirmDialog(false);
      return;
    }

    if (!elements.connectionManager.hidden && event.key === "Escape") {
      event.preventDefault();
      closeConnectionManager();
      return;
    }

    if (event.key === "Escape") {
      closeSidebarVaultSwitcher();
      closeGraphNodeMenu();
      closeExplorerContextMenu();
    }

    const meta = event.metaKey || event.ctrlKey;

    if (meta && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void flushAllPendingSaves({ flash: true });
    }

    if (meta && event.key.toLowerCase() === "n") {
      event.preventDefault();
      void handleCreateNote();
    }
  });

  window.addEventListener("pagehide", () => {
    persistPendingChangesForUnload();
  });

  document.addEventListener("click", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (
      state.workspace.switcherOpen
      && !elements.sidebarVaultSwitcher.contains(target)
      && !elements.sidebarVaultMenu.contains(target)
    ) {
      closeSidebarVaultSwitcher();
    }

    if (!elements.graphNodeMenu.hidden && !elements.graphNodeMenu.contains(target)) {
      closeGraphNodeMenu();
    }

    if (!elements.explorerContextMenu.hidden && !elements.explorerContextMenu.contains(target)) {
      closeExplorerContextMenu();
    }
  });

  elements.graphNodeMenu.addEventListener("click", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.closest<HTMLElement>("[data-graph-menu-action]")?.dataset.graphMenuAction;
    if (!action) {
      return;
    }

    void handleGraphNodeMenuAction(action);
  });

  elements.explorerContextMenu.addEventListener("click", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.closest<HTMLElement>("[data-explorer-menu-action]")?.dataset.explorerMenuAction;
    if (!action) {
      return;
    }

    void handleExplorerContextMenuAction(action);
  });

  elements.sidebarVaultMenu.addEventListener("click", (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const connectionId = target.closest<HTMLElement>("[data-sidebar-connection-id]")?.dataset.sidebarConnectionId?.trim();
    if (!connectionId || connectionId === getActiveConnectionId()) {
      closeSidebarVaultSwitcher();
      return;
    }

    closeSidebarVaultSwitcher();
    void handleConnectionSelectionChange(connectionId);
  });

  window.addEventListener("beforeunload", (event) => {
    persistPendingChangesForUnload();
    if (hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

function hydrateShellPreferences(): void {
  try {
    const storedWidth = window.localStorage.getItem(EXPLORER_WIDTH_STORAGE_KEY);
    const parsedWidth = storedWidth ? Number.parseInt(storedWidth, 10) : Number.NaN;
    if (Number.isFinite(parsedWidth)) {
      state.shell.explorerWidth = clampExplorerWidth(parsedWidth);
    }

    state.shell.explorerCollapsed = window.localStorage.getItem(EXPLORER_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    state.shell.explorerWidth = DEFAULT_EXPLORER_WIDTH;
    state.shell.explorerCollapsed = false;
  }
}

function persistShellPreferences(): void {
  try {
    window.localStorage.setItem(EXPLORER_WIDTH_STORAGE_KEY, String(state.shell.explorerWidth));
    window.localStorage.setItem(
      EXPLORER_COLLAPSED_STORAGE_KEY,
      state.shell.explorerCollapsed ? "true" : "false"
    );
  } catch {
    // Ignore storage failures; layout still works for the current session.
  }
}

function clampExplorerWidth(width: number): number {
  const viewportCap = Math.max(MIN_EXPLORER_WIDTH, Math.min(MAX_EXPLORER_WIDTH, window.innerWidth - 360));
  return Math.round(clamp(width, MIN_EXPLORER_WIDTH, viewportCap));
}

function applyShellLayout(): void {
  state.shell.explorerWidth = clampExplorerWidth(state.shell.explorerWidth);
  elements.appShell.dataset.explorerCollapsed = String(state.shell.explorerCollapsed);
  elements.appShell.style.setProperty("--sidebar-width", `${state.shell.explorerWidth}px`);
  elements.toggleExplorerButton.classList.toggle("is-active", state.shell.explorerCollapsed);
  elements.toggleExplorerButton.title = state.shell.explorerCollapsed
    ? t("activity.expandExplorer")
    : t("activity.collapseExplorer");
  elements.toggleExplorerButton.setAttribute(
    "aria-label",
    state.shell.explorerCollapsed
      ? t("activity.expandExplorer")
      : t("activity.collapseExplorer")
  );
  elements.toggleExplorerGlyph.textContent = state.shell.explorerCollapsed ? "⇥" : "⇤";
}

function toggleExplorer(): void {
  state.shell.explorerCollapsed = !state.shell.explorerCollapsed;
  applyShellLayout();
  persistShellPreferences();
}

function openGraphNodeMenu(noteId: string, clientX: number, clientY: number): void {
  state.graph.contextMenuNoteId = noteId;
  state.graph.contextMenuX = clientX;
  state.graph.contextMenuY = clientY;
  renderGraphNodeMenu();
}

function openExplorerContextMenu(
  target: { type: "note"; noteId: string } | { type: "folder"; folderPath: string },
  clientX: number,
  clientY: number
): void {
  explorerContextMenuTarget = target;
  renderExplorerContextMenu(clientX, clientY);
}

function closeGraphNodeMenu(): void {
  if (!state.graph.contextMenuNoteId && elements.graphNodeMenu.hidden) {
    return;
  }

  state.graph.contextMenuNoteId = null;
  elements.graphNodeMenu.hidden = true;
  elements.graphNodeMenu.innerHTML = "";
}

function closeExplorerContextMenu(): void {
  if (!explorerContextMenuTarget && elements.explorerContextMenu.hidden) {
    return;
  }

  explorerContextMenuTarget = null;
  elements.explorerContextMenu.hidden = true;
  elements.explorerContextMenu.innerHTML = "";
}

function renderGraphNodeMenu(): void {
  const noteId = state.graph.contextMenuNoteId;
  if (!noteId) {
    elements.graphNodeMenu.hidden = true;
    elements.graphNodeMenu.innerHTML = "";
    return;
  }

  const note = state.vault.notes.find((item) => item.id === noteId);
  if (!note) {
    closeGraphNodeMenu();
    return;
  }

  elements.graphNodeMenu.hidden = false;
  elements.graphNodeMenu.innerHTML = `
    <div class="graph-node-menu__title">${escapeHtml(getDisplayTitle(note))}</div>
    <button type="button" class="graph-node-menu__item" data-graph-menu-action="open">${escapeHtml(t("common.open"))}</button>
    <button type="button" class="graph-node-menu__item" data-graph-menu-action="reveal">${escapeHtml(t("graph.revealInList"))}</button>
    <button type="button" class="graph-node-menu__item" data-graph-menu-action="copy">${escapeHtml(t("graph.copyWikilink"))}</button>
  `;

  const menuWidth = 192;
  const menuHeight = 152;
  const left = Math.min(
    Math.max(12, state.graph.contextMenuX),
    Math.max(12, window.innerWidth - menuWidth - 12)
  );
  const top = Math.min(
    Math.max(12, state.graph.contextMenuY),
    Math.max(12, window.innerHeight - menuHeight - 12)
  );

  elements.graphNodeMenu.style.left = `${left}px`;
  elements.graphNodeMenu.style.top = `${top}px`;
}

function renderExplorerContextMenu(clientX: number, clientY: number): void {
  const target = explorerContextMenuTarget;
  if (!target) {
    closeExplorerContextMenu();
    return;
  }

  if (target.type === "note") {
    const note = findNoteById(target.noteId);
    if (!note) {
      closeExplorerContextMenu();
      return;
    }

    elements.explorerContextMenu.innerHTML = `
      <div class="graph-node-menu__title">${escapeHtml(getDisplayTitle(note))}</div>
      <button type="button" class="graph-node-menu__item" data-explorer-menu-action="copy">${escapeHtml(t("common.copy"))}</button>
      <button type="button" class="graph-node-menu__item" data-explorer-menu-action="rename">${escapeHtml(t("common.rename"))}</button>
      <button type="button" class="graph-node-menu__item" data-explorer-menu-action="delete">${escapeHtml(t("common.delete"))}</button>
    `;
  } else {
    const label = target.folderPath || getRootLabel();
    elements.explorerContextMenu.innerHTML = `
      <div class="graph-node-menu__title">${escapeHtml(label)}</div>
      <button type="button" class="graph-node-menu__item" data-explorer-menu-action="copy">${escapeHtml(t("common.copy"))}</button>
      <button type="button" class="graph-node-menu__item" data-explorer-menu-action="rename">${escapeHtml(t("common.rename"))}</button>
      <button type="button" class="graph-node-menu__item" data-explorer-menu-action="delete">${escapeHtml(t("common.delete"))}</button>
    `;
  }

  elements.explorerContextMenu.hidden = false;
  const menuWidth = 196;
  const menuHeight = 152;
  const left = Math.min(
    Math.max(12, clientX),
    Math.max(12, window.innerWidth - menuWidth - 12)
  );
  const top = Math.min(
    Math.max(12, clientY),
    Math.max(12, window.innerHeight - menuHeight - 12)
  );

  elements.explorerContextMenu.style.left = `${left}px`;
  elements.explorerContextMenu.style.top = `${top}px`;
}

async function handleGraphNodeMenuAction(action: string): Promise<void> {
  const noteId = state.graph.contextMenuNoteId;
  closeGraphNodeMenu();
  if (!noteId) {
    return;
  }

  if (action === "open") {
    await openNote(noteId, { nextView: getLastNoteView() });
    return;
  }

  if (action === "reveal") {
    revealNoteInList(noteId);
    return;
  }

  if (action === "copy") {
    await copyGraphNodeWikilink(noteId);
  }
}

async function handleExplorerContextMenuAction(action: string): Promise<void> {
  const target = explorerContextMenuTarget;
  closeExplorerContextMenu();
  if (!target) {
    return;
  }

  if (target.type === "note") {
    if (action === "copy") {
      await copyGraphNodeWikilink(target.noteId);
      return;
    }

    if (action === "rename") {
      await beginRenameNoteFromExplorer(target.noteId);
      return;
    }

    if (action === "delete") {
      await deleteNoteFromExplorer(target.noteId);
    }
    return;
  }

  state.vault.selectedFolderPath = target.folderPath;
  expandFolderAncestors(target.folderPath);
  renderFolderControls();
  renderFolderList();
  renderNoteList();

  if (action === "copy") {
    await copyTextToClipboard(
      target.folderPath || getRootLabel(),
      t("status.copyFolder", { value: target.folderPath || getRootLabel() })
    );
    return;
  }

  if (action === "rename") {
    await handleRenameSelectedFolder();
    return;
  }

  if (action === "delete") {
    await handleDeleteSelectedFolder();
  }
}

function revealNoteInList(noteId: string): void {
  const note = state.vault.notes.find((item) => item.id === noteId);
  if (!note) {
    return;
  }

  state.shell.explorerCollapsed = false;
  state.vault.selectedFolderPath = note.folderPath;
  expandFolderAncestors(note.folderPath);
  applyShellLayout();
  renderFolderControls();
  renderFolderList();
  renderNoteList();

  window.requestAnimationFrame(() => {
    const match = Array.from(elements.noteList.querySelectorAll<HTMLElement>("[data-note-id]"))
      .find((element) => element.dataset.noteId === noteId);
    if (!match) {
      return;
    }

    match.scrollIntoView({ block: "center", behavior: "smooth" });
    match.classList.add("is-revealed");
    window.setTimeout(() => {
      match.classList.remove("is-revealed");
    }, 1400);
  });

  flashStatus(t("status.shownInList", { title: getDisplayTitle(note) }));
}

async function copyGraphNodeWikilink(noteId: string): Promise<void> {
  const note = state.vault.notes.find((item) => item.id === noteId);
  if (!note) {
    return;
  }

  try {
    await copyTextToClipboard(
      `[[${getDisplayTitle(note)}]]`,
      t("status.copyWikilink", { title: getDisplayTitle(note) })
    );
  } catch (error) {
    console.error(error);
    flashStatus(t("status.copyFailed"));
  }
}

async function copyTextToClipboard(value: string, successMessage: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  flashStatus(successMessage);
}

async function beginRenameNoteFromExplorer(noteId: string): Promise<void> {
  await openNote(noteId);
  window.requestAnimationFrame(() => {
    elements.noteTitle.focus();
    elements.noteTitle.select();
  });
}

async function deleteNoteFromExplorer(noteId: string): Promise<void> {
  await openNote(noteId);
  await handleDeleteNote();
}

function confirmAction(options: {
  title: string;
  description: string;
  confirmLabel?: string;
}): Promise<boolean> {
  if (confirmDialogResolver) {
    resolveConfirmDialog(false);
  }

  elements.confirmDialogTitle.textContent = options.title;
  elements.confirmDialogDescription.textContent = options.description;
  elements.confirmDialogConfirm.textContent = options.confirmLabel ?? t("common.delete");
  elements.confirmDialog.hidden = false;

  return new Promise<boolean>((resolve) => {
    confirmDialogResolver = resolve;
    window.requestAnimationFrame(() => {
      elements.confirmDialogConfirm.focus();
    });
  });
}

function resolveConfirmDialog(confirmed: boolean): void {
  if (!confirmDialogResolver) {
    return;
  }

  const resolver = confirmDialogResolver;
  confirmDialogResolver = null;
  elements.confirmDialog.hidden = true;
  resolver(confirmed);
}

function isViewMode(value: string | undefined): value is ViewMode {
  return value === "split" || value === "editor" || value === "preview" || value === "graph" || value === "memory";
}

function isGraphColorMode(value: string | undefined): value is GraphColorMode {
  return value === "none" || value === "folder" || value === "tag" || value === "cluster";
}

function getNextGraphColorMode(mode: GraphColorMode): GraphColorMode {
  if (mode === "none") {
    return "folder";
  }

  if (mode === "folder") {
    return "tag";
  }

  if (mode === "tag") {
    return "cluster";
  }

  return "none";
}

function getGraphColorModeLabel(mode: GraphColorMode): string {
  if (mode === "folder") {
    return t("graph.color.folder");
  }

  if (mode === "tag") {
    return t("graph.color.tag");
  }

  if (mode === "cluster") {
    return t("graph.color.cluster");
  }

  return t("graph.color.none");
}

function getGraphColorModeGlyph(mode: GraphColorMode): string {
  if (mode === "folder") {
    return "▦";
  }

  if (mode === "tag") {
    return "#";
  }

  if (mode === "cluster") {
    return "◍";
  }

  return "◌";
}

function getViewModeLabel(view: ViewMode): string {
  if (view === "split") {
    return t("view.split");
  }

  if (view === "editor") {
    return t("view.editor");
  }

  if (view === "preview") {
    return t("view.preview");
  }

  if (view === "memory") {
    return t("view.memory");
  }

  return t("view.graph");
}

async function handleRefreshVault(): Promise<void> {
  commitCurrentTitleDraft();
  const saved = await flushAllPendingSaves();
  if (!saved) {
    return;
  }
  setStatus(t("status.refreshingVault"));
  await reloadVault(state.vault.selectedNoteId);
  flashStatus(t("status.synced"));
}

function createEmptyConnectionDraft(): WorkspaceConnectionDraft {
  return {
    name: "",
    kind: "vault",
    rootPath: "",
    codeRoot: "",
    notesRoot: "",
    isDefault: false,
    activateOnSave: true,
  };
}

function createEmptyMemoryDocument(scope: "global" | "workspace"): MemoryDocumentState {
  return {
    scope,
    connectionId: null,
    connectionName: null,
    content: "",
    savedContent: "",
    exists: false,
    createdAt: null,
    updatedAt: null,
    loading: false,
    saving: false,
    error: null,
  };
}

function isConnectionPathField(value: string | undefined): value is ConnectionPathField {
  return value === "rootPath" || value === "codeRoot" || value === "notesRoot";
}

function createConnectionDraft(connection: WorkspaceConnection): WorkspaceConnectionDraft {
  return {
    name: connection.name,
    kind: connection.kind,
    rootPath: connection.notesRoot ?? connection.rootPath ?? "",
    codeRoot: connection.codeRoot ?? "",
    notesRoot: connection.notesRoot ?? "",
    isDefault: connection.isDefault === true,
    activateOnSave: false,
  };
}

function isWorkspaceConnectionKind(value: string | undefined): value is WorkspaceConnectionKind {
  return value === "vault" || value === "repo_docs" || value === "code_repo" || value === "docs_folder";
}

function getWorkspaceConnectionKindLabel(kind: WorkspaceConnectionKind): string {
  if (kind === "vault") {
    return "vault";
  }

  if (kind === "repo_docs") {
    return "repo_docs";
  }

  if (kind === "code_repo") {
    return "code_repo";
  }

  return "docs_folder";
}

function getWorkspaceConnectionKindDescription(kind: WorkspaceConnectionKind): string {
  if (kind === "vault") {
    return t("connection.kindHint.vault");
  }

  if (kind === "repo_docs") {
    return t("connection.kindHint.repo_docs");
  }

  if (kind === "code_repo") {
    return t("connection.kindHint.code_repo");
  }

  return t("connection.kindHint.docs_folder");
}

function getWorkspaceConnectionNamePlaceholder(kind: WorkspaceConnectionKind): string {
  if (kind === "vault") {
    return t("connection.connectVault");
  }

  if (kind === "repo_docs") {
    return t("connection.connectRepoDocs");
  }

  if (kind === "code_repo") {
    return t("connection.connectCodeRepo");
  }

  return t("connection.connectDocsFolder");
}

function getWorkspaceConnectionPathPlaceholders(kind: WorkspaceConnectionKind): {
  rootPath: string;
  codeRoot: string;
  notesRoot: string;
} {
  if (kind === "vault") {
    return {
      rootPath: "/absolute/path/to/vault",
      codeRoot: "/absolute/path/to/repo",
      notesRoot: "/absolute/path/to/vault",
    };
  }

  if (kind === "repo_docs") {
    return {
      rootPath: "/absolute/path/to/repo/docs",
      codeRoot: "/absolute/path/to/repo",
      notesRoot: "/absolute/path/to/repo/docs",
    };
  }

  if (kind === "code_repo") {
    return {
      rootPath: "/absolute/path/to/repo",
      codeRoot: "/absolute/path/to/repo",
      notesRoot: "/absolute/path/to/repo/docs",
    };
  }

  return {
    rootPath: "/absolute/path/to/docs",
    codeRoot: "/absolute/path/to/repo",
    notesRoot: "/absolute/path/to/docs",
  };
}

function getConnectionPathBrowseTitle(field: ConnectionPathField, draft: WorkspaceConnectionDraft): string {
  if (field === "codeRoot") {
    return t("connection.codeRoot");
  }

  if (field === "notesRoot") {
    return t("connection.notesRoot");
  }

  if (draft.kind === "vault") {
    return t("connection.vaultRoot");
  }

  if (draft.kind === "repo_docs") {
    return t("connection.docsRoot");
  }

  return t("connection.folderRoot");
}

function getConnectionRootFieldMeta(kind: WorkspaceConnectionKind): { label: string; hint: string } {
  if (kind === "vault") {
    return {
      label: t("connection.vaultRoot"),
      hint: t("connection.vaultRootHint"),
    };
  }

  if (kind === "repo_docs") {
    return {
      label: t("connection.docsRoot"),
      hint: t("connection.repoDocsRootHint"),
    };
  }

  return {
    label: t("connection.folderRoot"),
    hint: t("connection.folderRootHint"),
  };
}

function normalizeConnectionManagerSelection(): void {
  if (state.workspace.manager.mode === "create") {
    return;
  }

  const connections = state.workspace.connections;
  const preferredId = state.workspace.manager.selectedConnectionId;
  const nextConnection = connections.find((connection) => connection.id === preferredId)
    ?? getActiveConnection()
    ?? connections[0]
    ?? null;

  if (!nextConnection) {
    state.workspace.manager.selectedConnectionId = null;
    return;
  }

  if (state.workspace.manager.selectedConnectionId === nextConnection.id) {
    return;
  }

  state.workspace.manager.selectedConnectionId = nextConnection.id;
  state.workspace.manager.draft = createConnectionDraft(nextConnection);
}

function getActiveConnectionId(): string | undefined {
  return state.workspace.activeConnectionId ?? state.workspace.connections[0]?.id;
}

function getActiveConnection(): WorkspaceConnection | null {
  const activeConnectionId = getActiveConnectionId();
  if (!activeConnectionId) {
    return null;
  }

  return state.workspace.connections.find((connection) => connection.id === activeConnectionId) ?? null;
}

function getConnectionLabel(connection: WorkspaceConnection): string {
  if (connection.kind === "code_repo" && connection.codeRoot?.trim()) {
    return `${connection.name} · ${t("connection.kindSuffix.codeRepo")}`;
  }

  if (connection.kind === "docs_folder") {
    return `${connection.name} · ${t("connection.kindSuffix.docs")}`;
  }

  if (connection.kind === "repo_docs") {
    return `${connection.name} · ${t("connection.kindSuffix.repoDocs")}`;
  }

  return connection.name;
}

function getConnectionNotesRoot(connection: WorkspaceConnection): string {
  return connection.notesRoot?.trim() || connection.rootPath?.trim() || connection.codeRoot?.trim() || "";
}

function openConnectionManager(): void {
  closeSidebarVaultSwitcher();
  normalizeConnectionManagerSelection();
  if (!state.workspace.manager.selectedConnectionId && state.workspace.connections.length > 0) {
    const activeConnection = getActiveConnection() ?? state.workspace.connections[0];
    state.workspace.manager.selectedConnectionId = activeConnection?.id ?? null;
    if (activeConnection) {
      state.workspace.manager.mode = "edit";
      state.workspace.manager.draft = createConnectionDraft(activeConnection);
    }
  }

  state.workspace.manager.open = true;
  state.workspace.manager.error = null;
  renderConnectionManager();

  window.requestAnimationFrame(() => {
    elements.connectionManagerNameInput.focus();
    if (state.workspace.manager.mode === "create") {
      elements.connectionManagerNameInput.select();
    }
  });
}

function closeConnectionManager(): void {
  state.workspace.manager.open = false;
  state.workspace.manager.error = null;
  renderConnectionManager();
}

function startCreatingWorkspaceConnection(kind: WorkspaceConnectionKind = "vault"): void {
  closeSidebarVaultSwitcher();
  state.workspace.manager.open = true;
  state.workspace.manager.mode = "create";
  state.workspace.manager.selectedConnectionId = null;
  state.workspace.manager.draft = {
    ...createEmptyConnectionDraft(),
    kind,
  };
  state.workspace.manager.error = null;
  renderConnectionManager();

  window.requestAnimationFrame(() => {
    elements.connectionManagerNameInput.focus();
  });
}

function selectWorkspaceConnectionForEditing(connectionId: string): void {
  const connection = state.workspace.connections.find((item) => item.id === connectionId);
  if (!connection) {
    return;
  }

  state.workspace.manager.open = true;
  state.workspace.manager.mode = "edit";
  state.workspace.manager.selectedConnectionId = connection.id;
  state.workspace.manager.draft = createConnectionDraft(connection);
  state.workspace.manager.error = null;
  renderConnectionManager();
}

function updateConnectionManagerDraft(patch: Partial<WorkspaceConnectionDraft>): void {
  state.workspace.manager.draft = {
    ...state.workspace.manager.draft,
    ...patch,
  };
  state.workspace.manager.error = null;
  renderConnectionManager();
}

function updateConnectionManagerKind(kind: WorkspaceConnectionKind): void {
  const previousDraft = state.workspace.manager.draft;
  const nextDraft: WorkspaceConnectionDraft = {
    ...previousDraft,
    kind,
  };

  if (kind === "code_repo") {
    nextDraft.codeRoot = previousDraft.codeRoot || previousDraft.rootPath;
    nextDraft.notesRoot = previousDraft.notesRoot || previousDraft.rootPath || previousDraft.codeRoot;
  } else if (!previousDraft.rootPath) {
    nextDraft.rootPath = previousDraft.notesRoot || previousDraft.codeRoot;
  }

  state.workspace.manager.draft = nextDraft;
  state.workspace.manager.error = null;
  renderConnectionManager();
}

function inferConnectionNameFromPath(targetPath: string): string {
  const normalizedPath = targetPath.replace(/[\\/]+$/, "");
  const baseName = normalizedPath.split(/[/\\]/).filter(Boolean).pop() ?? targetPath;
  return baseName
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function applyConnectionPathField(field: ConnectionPathField, nextPath: string): void {
  const normalizedPath = normalizeFilesystemPath(nextPath);
  if (!normalizedPath) {
    return;
  }

  const patch: Partial<WorkspaceConnectionDraft> = {
    [field]: normalizedPath,
  };

  if (!state.workspace.manager.draft.name.trim()) {
    patch.name = inferConnectionNameFromPath(normalizedPath);
  }

  updateConnectionManagerDraft(patch);
}

function clearConnectionPathField(field: ConnectionPathField): void {
  updateConnectionManagerDraft({ [field]: "" });
}

async function pasteConnectionPathField(field: ConnectionPathField): Promise<void> {
  try {
    const rawValue = await navigator.clipboard.readText();
    const normalizedPath = normalizeFilesystemPath(rawValue);
    if (!normalizedPath) {
      state.workspace.manager.error = t("error.invalidClipboardPath");
      renderConnectionManager();
      return;
    }

    applyConnectionPathField(field, normalizedPath);
    flashStatus(t("status.pathPasted"));
  } catch (error) {
    console.error(error);
    state.workspace.manager.error = t("error.readClipboard");
    renderConnectionManager();
  }
}

async function browseConnectionPathField(field: ConnectionPathField): Promise<void> {
  try {
    const selectedPath = await api.pickDirectory({
      title: getConnectionPathBrowseTitle(field, state.workspace.manager.draft),
      defaultPath: state.workspace.manager.draft[field].trim() || undefined,
    });
    if (!selectedPath) {
      return;
    }

    applyConnectionPathField(field, selectedPath);
    flashStatus(t("status.folderChosen"));
  } catch (error) {
    console.error(error);
    state.workspace.manager.error = getErrorMessage(error, t("error.pickDirectory"));
    renderConnectionManager();
  }
}

function normalizeFilesystemPath(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = trimmed
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && !value.startsWith("#"));

  for (const candidate of candidates) {
    const normalized = normalizeFilesystemPathCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeFilesystemPathCandidate(value: string): string | null {
  const unquoted = value.replace(/^['"]|['"]$/g, "").trim();
  if (!unquoted) {
    return null;
  }

  if (unquoted.startsWith("file://")) {
    try {
      const url = new URL(unquoted);
      if (url.protocol !== "file:") {
        return null;
      }

      let pathname = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:\//.test(pathname)) {
        pathname = pathname.slice(1);
      }

      if (url.host && url.host !== "localhost") {
        return `//${url.host}${pathname}`;
      }

      return pathname || null;
    } catch {
      return null;
    }
  }

  if (unquoted.startsWith("/") || /^[A-Za-z]:[\\/]/.test(unquoted) || unquoted.startsWith("\\\\")) {
    return unquoted;
  }

  return null;
}

function extractDroppedConnectionPath(dataTransfer: DataTransfer | null): string | null {
  if (!dataTransfer) {
    return null;
  }

  const uriList = dataTransfer.getData("text/uri-list");
  const fromUriList = normalizeFilesystemPath(uriList);
  if (fromUriList) {
    return fromUriList;
  }

  const text = dataTransfer.getData("text/plain");
  const fromText = normalizeFilesystemPath(text);
  if (fromText) {
    return fromText;
  }

  const firstFile = dataTransfer.files.item(0) as (File & { path?: string }) | null;
  if (firstFile?.path) {
    return normalizeFilesystemPath(firstFile.path);
  }

  return null;
}

function resetConnectionManagerDraft(): void {
  if (state.workspace.manager.mode === "create") {
    state.workspace.manager.draft = createEmptyConnectionDraft();
  } else {
    normalizeConnectionManagerSelection();
    const selectedConnection = state.workspace.connections.find((item) => item.id === state.workspace.manager.selectedConnectionId);
    if (!selectedConnection) {
      return;
    }

    state.workspace.manager.draft = createConnectionDraft(selectedConnection);
  }

  state.workspace.manager.error = null;
  renderConnectionManager();
}

function getConnectionManagerSelectedConnection(): WorkspaceConnection | null {
  if (state.workspace.manager.mode !== "edit") {
    return null;
  }

  return state.workspace.connections.find((item) => item.id === state.workspace.manager.selectedConnectionId) ?? null;
}

function validateConnectionDraft(draft: WorkspaceConnectionDraft): string | null {
  if (!draft.name.trim()) {
    return t("error.workspaceNameRequired");
  }

  if (draft.kind === "code_repo") {
    if (!draft.codeRoot.trim()) {
      return t("error.codeRootRequired");
    }

    if (!draft.notesRoot.trim()) {
      return t("error.notesRootRequired");
    }

    return null;
  }

  if (!draft.rootPath.trim()) {
    return t("error.rootPathRequired");
  }

  return null;
}

function buildWorkspaceConnectionPayload(draft: WorkspaceConnectionDraft): {
  name: string;
  kind: WorkspaceConnectionKind;
  rootPath?: string;
  codeRoot?: string;
  notesRoot?: string;
  isDefault: boolean;
} {
  if (draft.kind === "code_repo") {
    return {
      name: draft.name.trim(),
      kind: draft.kind,
      codeRoot: draft.codeRoot.trim(),
      notesRoot: draft.notesRoot.trim(),
      isDefault: draft.isDefault,
    };
  }

  return {
    name: draft.name.trim(),
    kind: draft.kind,
    rootPath: draft.rootPath.trim(),
    isDefault: draft.isDefault,
  };
}

async function saveConnectionFromManager(): Promise<void> {
  const validationError = validateConnectionDraft(state.workspace.manager.draft);
  if (validationError) {
    state.workspace.manager.error = validationError;
    renderConnectionManager();
    return;
  }

  commitCurrentTitleDraft();
  const saved = await flushAllPendingSaves();
  if (!saved) {
    return;
  }

  const selectedConnection = getConnectionManagerSelectedConnection();
  const mode = state.workspace.manager.mode;
  if (mode === "edit" && !selectedConnection) {
    state.workspace.manager.error = t("error.connectionMissing");
    renderConnectionManager();
    return;
  }

  state.workspace.manager.saving = true;
  state.workspace.manager.error = null;
  renderConnectionManager();

  try {
    const payload = buildWorkspaceConnectionPayload(state.workspace.manager.draft);
    const connection = mode === "create"
      ? await api.createWorkspaceConnection(payload)
      : await api.updateWorkspaceConnection(selectedConnection!.id, payload);
    const preferredConnectionId = state.workspace.manager.draft.activateOnSave
      ? connection.id
      : getActiveConnectionId() ?? connection.id;
    await reloadVault(state.vault.selectedNoteId, { preferredConnectionId });
    closeConnectionManager();
    flashStatus(mode === "create" ? t("status.workspaceConnected") : t("status.workspaceUpdated"));
  } catch (error) {
    console.error(error);
    state.workspace.manager.error = getErrorMessage(error, t("error.connectionSave"));
    renderConnectionManager();
  } finally {
    state.workspace.manager.saving = false;
    renderConnectionManager();
  }
}

async function activateConnectionFromManager(): Promise<void> {
  const connection = getConnectionManagerSelectedConnection();
  if (!connection || connection.id === getActiveConnectionId()) {
    return;
  }

  await handleConnectionSelectionChange(connection.id);
  renderConnectionManager();
}

async function deleteConnectionFromManager(): Promise<void> {
  const connection = getConnectionManagerSelectedConnection();
  if (!connection) {
    return;
  }

  const confirmed = await confirmAction({
    title: t("confirm.deleteConnectionTitle", { name: connection.name }),
    description: connection.isDefault
      ? t("confirm.deleteConnectionDefault")
      : t("confirm.deleteConnectionDescription"),
    confirmLabel: t("common.delete"),
  });
  if (!confirmed || connection.isDefault) {
    return;
  }

  commitCurrentTitleDraft();
  const saved = await flushAllPendingSaves();
  if (!saved) {
    return;
  }

  state.workspace.manager.saving = true;
  state.workspace.manager.error = null;
  renderConnectionManager();

  try {
    await api.deleteWorkspaceConnection(connection.id);
    const fallbackConnection = state.workspace.connections.find((item) => item.id !== connection.id) ?? null;
    const preferredConnectionId = getActiveConnectionId() === connection.id
      ? fallbackConnection?.id ?? null
      : getActiveConnectionId() ?? fallbackConnection?.id ?? null;
    await reloadVault(null, { preferredConnectionId });

    const nextSelection = state.workspace.connections.find((item) => item.id === preferredConnectionId)
      ?? getActiveConnection()
      ?? state.workspace.connections[0]
      ?? null;
    if (nextSelection) {
      state.workspace.manager.mode = "edit";
      state.workspace.manager.selectedConnectionId = nextSelection.id;
      state.workspace.manager.draft = createConnectionDraft(nextSelection);
    } else {
      state.workspace.manager.mode = "create";
      state.workspace.manager.selectedConnectionId = null;
      state.workspace.manager.draft = createEmptyConnectionDraft();
    }

    flashStatus(t("status.connectionDeleted"));
  } catch (error) {
    console.error(error);
    state.workspace.manager.error = getErrorMessage(error, t("error.connectionDelete"));
  } finally {
    state.workspace.manager.saving = false;
    renderConnectionManager();
  }
}

function normalizeActiveConnectionId(preferredConnectionId?: string | null): void {
  const validIds = new Set(state.workspace.connections.map((connection) => connection.id));
  const storedConnectionId = resolveStoredActiveConnectionId();
  if (preferredConnectionId && validIds.has(preferredConnectionId)) {
    state.workspace.activeConnectionId = preferredConnectionId;
    persistActiveConnectionPreference(preferredConnectionId);
    return;
  }

  if (storedConnectionId && validIds.has(storedConnectionId)) {
    state.workspace.activeConnectionId = storedConnectionId;
    persistActiveConnectionPreference(storedConnectionId);
    return;
  }

  if (state.workspace.activeConnectionId && validIds.has(state.workspace.activeConnectionId)) {
    persistActiveConnectionPreference(state.workspace.activeConnectionId);
    return;
  }

  state.workspace.activeConnectionId = state.workspace.connections[0]?.id ?? null;
  persistActiveConnectionPreference(state.workspace.activeConnectionId);
}

function renderWorkspaceConnections(): void {
  const connections = state.workspace.connections;
  const activeConnectionId = getActiveConnectionId();
  const activeConnection = connections.find((connection) => connection.id === activeConnectionId) ?? null;
  elements.sidebarVaultTitle.textContent = activeConnection?.name ?? t("sidebar.vault");
  elements.sidebarVaultSwitcher.classList.toggle("is-open", state.workspace.switcherOpen);
  elements.sidebarVaultMenu.hidden = !state.workspace.switcherOpen;
  elements.sidebarVaultMenu.innerHTML = connections
    .map((connection) => {
      const isActive = connection.id === activeConnectionId;
      const root = getConnectionNotesRoot(connection) || t("common.notSet");
      return `
        <button
          type="button"
          class="sidebar-vault-menu__item${isActive ? " is-active" : ""}"
          data-sidebar-connection-id="${escapeAttribute(connection.id)}"
        >
          <p class="sidebar-vault-menu__title">${escapeHtml(connection.name)}</p>
          <p class="sidebar-vault-menu__meta">${escapeHtml(getWorkspaceConnectionKindLabel(connection.kind))} · ${escapeHtml(root)}</p>
        </button>
      `;
    })
    .join("");
  const label = state.workspace.manager.open ? t("common.close") : t("workspace.manage");
  const labelElement = elements.workspaceConnectionsButton.querySelector<HTMLElement>(".activity-button__label");
  if (labelElement) {
    labelElement.textContent = label;
  } else {
    elements.workspaceConnectionsButton.textContent = label;
  }
  elements.workspaceConnectionsButton.title = label;
  elements.workspaceConnectionsButton.setAttribute("aria-label", label);
  elements.workspaceConnectionsButton.classList.toggle("is-active", state.workspace.manager.open);
}

function closeSidebarVaultSwitcher(): void {
  if (!state.workspace.switcherOpen) {
    return;
  }

  state.workspace.switcherOpen = false;
  renderWorkspaceConnections();
}

function renderConnectionManager(): void {
  normalizeConnectionManagerSelection();

  const managerState = state.workspace.manager;
  const selectedConnection = getConnectionManagerSelectedConnection();
  const draft = managerState.draft;
  const showCodeRoots = draft.kind === "code_repo";
  const rootMeta = getConnectionRootFieldMeta(draft.kind);
  const placeholders = getWorkspaceConnectionPathPlaceholders(draft.kind);
  const canUseSelectedConnection = selectedConnection !== null
    && selectedConnection.id !== getActiveConnectionId()
    && !managerState.saving;

  elements.connectionManager.hidden = !managerState.open;
  elements.connectionManagerTitle.textContent = managerState.mode === "create"
    ? t("connection.title")
    : selectedConnection?.name ?? t("workspace.edit");
  elements.connectionManagerDescription.textContent = managerState.mode === "create"
    ? t("connection.description")
    : t("workspace.updateDescription");
  elements.connectionManagerKindHint.textContent = getWorkspaceConnectionKindDescription(draft.kind);
  elements.connectionManagerRootLabel.textContent = rootMeta.label;
  elements.connectionManagerRootHint.textContent = rootMeta.hint;

  elements.connectionManagerNameInput.value = draft.name;
  elements.connectionManagerNameInput.placeholder = getWorkspaceConnectionNamePlaceholder(draft.kind);
  elements.connectionManagerKindSelect.value = draft.kind;
  elements.connectionManagerRootPathInput.value = draft.rootPath;
  elements.connectionManagerRootPathInput.placeholder = placeholders.rootPath;
  elements.connectionManagerCodeRootInput.value = draft.codeRoot;
  elements.connectionManagerCodeRootInput.placeholder = placeholders.codeRoot;
  elements.connectionManagerNotesRootInput.value = draft.notesRoot;
  elements.connectionManagerNotesRootInput.placeholder = placeholders.notesRoot;
  elements.connectionManagerDefaultCheckbox.checked = draft.isDefault;
  elements.connectionManagerActivateCheckbox.checked = draft.activateOnSave;

  elements.connectionManagerRootField.hidden = showCodeRoots;
  elements.connectionManagerNameInput.disabled = managerState.saving;
  elements.connectionManagerKindSelect.disabled = managerState.saving;
  elements.connectionManagerRootPathInput.disabled = managerState.saving || showCodeRoots;
  elements.connectionManagerCodeRootInput.disabled = managerState.saving || !showCodeRoots;
  elements.connectionManagerNotesRootInput.disabled = managerState.saving || !showCodeRoots;
  elements.connectionManagerDefaultCheckbox.disabled = managerState.saving;
  elements.connectionManagerActivateCheckbox.disabled = managerState.saving;
  elements.connectionManagerCreateButton.disabled = managerState.saving;

  elements.connectionManagerRootPathInput.required = !showCodeRoots;
  elements.connectionManagerCodeRootInput.required = showCodeRoots;
  elements.connectionManagerNotesRootInput.required = showCodeRoots;
  elements.connectionManagerCodeRootField.hidden = !showCodeRoots;
  elements.connectionManagerNotesRootField.hidden = !showCodeRoots;

  elements.connectionManagerError.textContent = managerState.error ?? "";
  elements.connectionManagerError.hidden = managerState.error === null;

  elements.connectionManagerDeleteButton.hidden = managerState.mode !== "edit";
  elements.connectionManagerDeleteButton.disabled = managerState.saving || selectedConnection?.isDefault === true;
  elements.connectionManagerUseButton.hidden = managerState.mode !== "edit";
  elements.connectionManagerUseButton.disabled = !canUseSelectedConnection;
  elements.connectionManagerResetButton.disabled = managerState.saving;
  elements.connectionManagerSubmitButton.disabled = managerState.saving;
  elements.connectionManagerSubmitButton.textContent = managerState.saving
    ? (managerState.mode === "create" ? t("common.connecting") : t("status.saving"))
    : (managerState.mode === "create" ? t("connection.create") : t("connection.save"));

  elements.connectionManagerForm.querySelectorAll<HTMLButtonElement>("[data-connection-preset]")
    .forEach((element) => {
      element.classList.toggle("is-active", element.dataset.connectionPreset === draft.kind);
      element.disabled = managerState.saving;
    });

  elements.connectionManagerForm.querySelectorAll<HTMLButtonElement>("[data-connection-path-browse], [data-connection-path-paste], [data-connection-path-clear]")
    .forEach((element) => {
      element.disabled = managerState.saving;
    });

  elements.connectionManagerList.innerHTML = state.workspace.connections
    .map((connection) => {
      const isActive = connection.id === getActiveConnectionId();
      const isSelected = managerState.mode === "edit" && connection.id === managerState.selectedConnectionId;
      const notesRoot = getConnectionNotesRoot(connection);
      const codeMeta = connection.kind === "code_repo" && connection.codeRoot?.trim()
        ? `<p class="connection-manager-list__meta">${escapeHtml(t("connection.codeLabel"))} · ${escapeHtml(connection.codeRoot)}</p>`
        : "";
      const notesLabel = connection.kind === "code_repo" ? t("connection.notesLabel") : t("connection.rootLabel");
      return `
        <button
          type="button"
          class="connection-manager-list__item${isSelected ? " is-selected" : ""}"
          data-connection-manager-id="${escapeAttribute(connection.id)}"
        >
          <div class="connection-manager-list__header">
            <span class="connection-manager-list__title">${escapeHtml(connection.name)}</span>
            <span class="connection-manager-list__kind">${escapeHtml(getWorkspaceConnectionKindLabel(connection.kind))}</span>
          </div>
          <div class="connection-manager-list__flags">
            ${connection.isDefault ? `<span class="connection-manager-list__flag">${escapeHtml(t("common.default"))}</span>` : ""}
            ${isActive ? `<span class="connection-manager-list__flag is-active">${escapeHtml(t("common.active"))}</span>` : ""}
          </div>
          <p class="connection-manager-list__meta">${escapeHtml(notesLabel)} · ${escapeHtml(notesRoot || t("common.notSet"))}</p>
          ${codeMeta}
        </button>
      `;
    })
    .join("");

  elements.connectionManagerEmpty.hidden = state.workspace.connections.length > 0;
  elements.connectionManagerList.hidden = state.workspace.connections.length === 0;
}

async function reloadVault(
  preferredNoteId: string | null = state.vault.selectedNoteId,
  options: { preferredConnectionId?: string | null } = {}
): Promise<void> {
  try {
    state.workspace.switcherOpen = false;
    const connections = await api.listWorkspaceConnections();
    state.workspace.connections = connections;
    normalizeActiveConnectionId(options.preferredConnectionId);
    renderWorkspaceConnections();

    const activeConnectionId = getActiveConnectionId();
    if (!activeConnectionId) {
      state.vault.notes = [];
      state.vault.folders = [];
      state.vault.selectedNoteId = null;
      render();
      setStatus(t("status.noConnections"));
      return;
    }

    const [notes, folders] = await Promise.all([
      apiClient.listNotes(),
      apiClient.listFolders(),
    ]);
    state.vault.notes = notes;
    state.vault.folders = folders;
    await ensureMemoryLoaded();
    state.vault.selectedNoteId = resolveSelection(preferredNoteId, notes);
    await hydrateWorkspaceTabs(state.vault.selectedNoteId);
    ensureSelectedFolderStillExists();
    syncSelectedFolderWithSelectedNote();
    state.hasExternalChanges = false;
    render();
    setStatus(getBaseStatusLabel());
  } catch (error) {
    console.error(error);
    state.vault.notes = [];
    state.vault.folders = [];
    state.vault.selectedFolderPath = "";
    state.vault.selectedNoteId = null;
    renderWorkspaceConnections();
    render();
    flashStatus(t("status.loadError"));
  }
}

async function handleConnectionSelectionChange(connectionId: string): Promise<void> {
  const nextConnectionId = connectionId.trim();
  if (!nextConnectionId || nextConnectionId === state.workspace.activeConnectionId) {
    return;
  }

  commitCurrentTitleDraft();
  const saved = await flushAllPendingSaves();
  if (!saved) {
    renderWorkspaceConnections();
    return;
  }

  state.workspace.activeConnectionId = nextConnectionId;
  state.workspace.switcherOpen = false;
  persistActiveConnectionPreference(nextConnectionId);
  state.vault.selectedFolderPath = "";
  state.query = "";
  elements.searchInput.value = "";
  setStatus(t("status.switchingWorkspace"));
  await reloadVault(null, { preferredConnectionId: nextConnectionId });
}

function resolveSelection(preferredNoteId: string | null, notes: Note[]): string | null {
  if (preferredNoteId && notes.some((note) => note.id === preferredNoteId)) {
    return preferredNoteId;
  }

  return notes[0]?.id ?? null;
}

async function handleCreateNote(title = ""): Promise<void> {
  commitCurrentTitleDraft();
  const saved = await flushPendingSave();
  if (!saved) {
    return;
  }

  try {
    const baseTitle = title.trim();
    const note = await api.createNote({
      title: baseTitle,
      content: baseTitle ? `# ${baseTitle}\n` : "",
      folderPath: state.vault.selectedFolderPath,
    });

    state.vault.notes.unshift({
      ...note,
      draftTitle: baseTitle ? undefined : "",
    });
    await syncWorkspaceTabOpen(note.id);
    state.vault.selectedNoteId = note.id;
    syncSelectedFolderWithSelectedNote();
    render();
    flashStatus(t("status.noteCreated"));
  } catch (error) {
    console.error(error);
    flashStatus(getErrorMessage(error, t("error.create")));
  }
}

async function handleCreateFolder(): Promise<void> {
  const suggestedPath = state.vault.selectedFolderPath ? `${state.vault.selectedFolderPath}/` : "";
  const nextPath = window.prompt(t("prompt.newFolder"), suggestedPath)?.trim();
  if (!nextPath) {
    return;
  }

  try {
    const folder = await apiClient.createFolder(nextPath);
    state.vault.folders = await apiClient.listFolders();
    state.vault.selectedFolderPath = folder.path;
    expandFolderAncestors(folder.path);
    render();
    flashStatus(t("status.folderCreated", { path: folder.path }));
  } catch (error) {
    console.error(error);
    flashStatus(t("error.createFolder"));
  }
}

async function handleRenameSelectedFolder(): Promise<void> {
  const currentPath = state.vault.selectedFolderPath;
  if (!currentPath) {
    return;
  }

  const nextPath = window.prompt(t("prompt.renameFolder"), currentPath)?.trim();
  if (!nextPath || nextPath === currentPath) {
    return;
  }

  const preferredNoteId = remapNoteIdForFolderChange(state.vault.selectedNoteId, currentPath, nextPath);

  try {
    setStatus(t("folders.rename"));
    await apiClient.renameFolder(currentPath, nextPath);
    remapFolderState(currentPath, nextPath);
    await reloadVault(preferredNoteId);
    flashStatus(t("status.folderRenamed", { path: nextPath }));
  } catch (error) {
    console.error(error);
    flashStatus(getErrorMessage(error, t("error.renameFolder")));
  }
}

async function handleDeleteSelectedFolder(): Promise<void> {
  const currentPath = state.vault.selectedFolderPath;
  if (!currentPath) {
    return;
  }

  if (!isSelectedFolderDeletable()) {
    flashStatus(t("status.onlyEmptyFolders"));
    return;
  }

  const confirmed = await confirmAction({
    title: t("confirm.deleteFolderTitle"),
    description: t("confirm.deleteFolderDescription", { path: currentPath }),
  });
  if (!confirmed) {
    return;
  }

  try {
    setStatus(t("common.delete"));
    await apiClient.deleteFolder(currentPath);
    state.vault.selectedFolderPath = getParentFolderPath(currentPath);
    state.vault.collapsedFolderPaths = state.vault.collapsedFolderPaths
      .filter((item) => item !== getFolderCollapseKey(currentPath));
    await reloadVault(state.vault.selectedNoteId);
    flashStatus(t("status.folderDeleted", { path: currentPath }));
  } catch (error) {
    console.error(error);
    flashStatus(getErrorMessage(error, t("error.deleteFolder")));
  }
}

async function handleMoveSelectedNote(nextFolderPath: string): Promise<void> {
  commitCurrentTitleDraft({ delayMs: 0 });
  const saved = await flushPendingSave();
  if (!saved) {
    renderWorkspace(false);
    return;
  }

  const note = getSelectedNote();
  if (!note || note.folderPath === nextFolderPath) {
    renderWorkspace(false);
    return;
  }

  try {
    setStatus(t("status.moving"));
    const moved = await api.updateNote(note.id, {
      title: getPersistableTitle(note),
      content: note.content,
      folderPath: nextFolderPath,
    });
    state.vault.selectedFolderPath = moved.folderPath;
    expandFolderAncestors(moved.folderPath);
    replaceNote(note.id, moved);
    flashStatus(
      moved.folderPath
        ? t("status.movedTo", { path: moved.folderPath })
        : t("status.movedToRoot")
    );
  } catch (error) {
    console.error(error);
    flashStatus(getErrorMessage(error, t("error.move")));
    renderWorkspace(false);
  }
}

async function handlePromptMoveSelectedNote(): Promise<void> {
  const note = getSelectedNote();
  if (!note) {
    return;
  }

  const nextFolderPath = window.prompt(
    t("prompt.moveNote"),
    note.folderPath
  )?.trim();

  if (nextFolderPath === undefined || nextFolderPath === note.folderPath) {
    return;
  }

  await handleMoveSelectedNote(nextFolderPath);
}

async function handleDeleteNote(): Promise<void> {
  const note = getSelectedNote();
  if (!note) {
    return;
  }

  commitCurrentTitleDraft();
  const saved = await flushPendingSave();
  if (!saved) {
    return;
  }

  const confirmed = await confirmAction({
    title: t("confirm.deleteNoteTitle"),
    description: t("confirm.deleteNoteDescription", { title: getDisplayTitle(note) }),
  });
  if (!confirmed) {
    return;
  }

  try {
    const tab = findWorkspaceTabByNoteId(note.id);
    const fallbackTabId = tab ? getWorkspaceTabFallbackTabId(tab.id) : null;
    const fallbackNoteId = findWorkspaceTab(fallbackTabId ?? "")?.noteId ?? note.id;
    await api.deleteNote(note.id);
    state.vault.notes = state.vault.notes.filter((item) => item.id !== note.id);
    await hydrateWorkspaceTabs(fallbackNoteId);
    if (tab) {
      removeWorkspaceTabReference(tab.id, fallbackTabId);
    }
    syncSelectedNoteFromTabs(fallbackNoteId);
    render();
    flashStatus(t("status.fileDeleted"));
  } catch (error) {
    console.error(error);
    flashStatus(t("error.delete"));
  }
}

async function handleOpenOrCreateByTitle(title: string): Promise<void> {
  const existing = findNoteByTitle(title);
  if (existing) {
    await openNote(existing.id);
    return;
  }

  await handleCreateNote(title);
}

function render(): void {
  ensureSelection();
  normalizeSelectedNoteSelection();
  applyShellLayout();
  renderWorkspaceConnections();
  renderNavigationControls();
  renderView();
  renderWorkspaceTabs();
  renderFolderControls();
  renderFolderList();
  renderNoteList();
  renderWorkspace();
  renderMemoryView();
  renderConnectionManager();
  renderGraphNodeMenu();

  if (state.view === "graph") {
    renderGraphView();
    void ensureGraphData();
  } else {
    closeGraphNodeMenu();
  }

  applyTranslations();
}

function renderView(): void {
  elements.editorLayout.dataset.view = state.view;
  elements.editorLayout.hidden = state.view === "memory";
  elements.memoryLayout.hidden = state.view !== "memory";
  elements.graphPane.hidden = state.view !== "graph";
  elements.workspaceViewBadge.textContent = getViewModeLabel(state.view);
  elements.viewButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
}

function rememberNoteView(mode: ViewMode): void {
  if (mode !== "graph" && mode !== "memory") {
    state.shell.lastNoteView = mode;
  }
}

function getLastNoteView(): NoteViewMode {
  return state.shell.lastNoteView;
}

function renderMemoryView(): void {
  const globalMemory = state.memory.global;
  const workspaceMemory = state.memory.workspace;

  if (document.activeElement !== elements.memoryGlobalEditor) {
    elements.memoryGlobalEditor.value = globalMemory.content;
  }

  if (document.activeElement !== elements.memoryWorkspaceEditor) {
    elements.memoryWorkspaceEditor.value = workspaceMemory.content;
  }
  elements.memoryGlobalEditor.disabled = globalMemory.loading || globalMemory.saving;
  elements.memoryWorkspaceEditor.disabled = workspaceMemory.loading || workspaceMemory.saving || !workspaceMemory.connectionId;

  elements.memoryGlobalState.textContent = getMemoryStateLabel(globalMemory);
  elements.memoryWorkspaceState.textContent = getMemoryStateLabel(workspaceMemory);
  elements.memoryGlobalUpdated.textContent = formatMemoryTimestamp(globalMemory.updatedAt);
  elements.memoryWorkspaceUpdated.textContent = formatMemoryTimestamp(workspaceMemory.updatedAt);
  elements.memoryWorkspaceConnection.textContent = workspaceMemory.connectionName ?? t("memory.noWorkspace");

  elements.memoryReloadAllButton.disabled = globalMemory.loading || workspaceMemory.loading;
  elements.memoryGlobalSaveButton.disabled = !isMemoryDirty("global") || globalMemory.loading || globalMemory.saving;
  elements.memoryGlobalReloadButton.disabled = globalMemory.loading || globalMemory.saving;
  elements.memoryGlobalClearButton.disabled = (!globalMemory.exists && !globalMemory.content) || globalMemory.loading || globalMemory.saving;
  elements.memoryWorkspaceSaveButton.disabled = !isMemoryDirty("workspace") || workspaceMemory.loading || workspaceMemory.saving || !workspaceMemory.connectionId;
  elements.memoryWorkspaceReloadButton.disabled = workspaceMemory.loading || workspaceMemory.saving || !workspaceMemory.connectionId;
  elements.memoryWorkspaceClearButton.disabled = (!workspaceMemory.exists && !workspaceMemory.content)
    || workspaceMemory.loading
    || workspaceMemory.saving
    || !workspaceMemory.connectionId;

  if (state.view === "memory") {
    elements.noteMeta.textContent = buildMemoryMetaLabel();
  }
}

function renderGraphView(): void {
  syncGraphPathSelection();
  elements.graphPane.dataset.sidebarCollapsed = String(state.graph.sidebarCollapsed);
  elements.graphGlobalButton.classList.toggle("is-active", state.graph.mode === "global");
  elements.graphLocalButton.classList.toggle("is-active", state.graph.mode === "local");
  elements.graphGlobalButton.title = t("graph.global");
  elements.graphGlobalButton.setAttribute("aria-label", t("graph.global"));
  elements.graphLocalButton.title = t("graph.local");
  elements.graphLocalButton.setAttribute("aria-label", t("graph.local"));
  elements.graphColorModeButton.title = `${t("common.color")}: ${getGraphColorModeLabel(state.graph.colorMode)}`;
  elements.graphColorModeButton.setAttribute("aria-label", `${t("common.color")}: ${getGraphColorModeLabel(state.graph.colorMode)}`);
  const graphColorModeGlyph = elements.graphColorModeButton.querySelector<HTMLElement>(".graph-toolbar-button__glyph");
  if (graphColorModeGlyph) {
    graphColorModeGlyph.textContent = getGraphColorModeGlyph(state.graph.colorMode);
  }
  elements.graphFolderScopeButton.classList.toggle("is-active", state.graph.folderScoped);
  elements.graphExistingOnlyButton.classList.toggle("is-active", state.graph.existingFilesOnly);
  elements.graphFolderScopeButton.title = t("graph.scopeFolder");
  elements.graphFolderScopeButton.setAttribute("aria-label", t("graph.scopeFolder"));
  elements.graphExistingOnlyButton.title = t("graph.existingOnly");
  elements.graphExistingOnlyButton.setAttribute("aria-label", t("graph.existingOnly"));
  elements.graphToggleSidebarButton.classList.toggle("is-active", state.graph.sidebarCollapsed);
  elements.graphCenterViewButton.title = t("graph.center");
  elements.graphCenterViewButton.setAttribute("aria-label", t("graph.center"));
  elements.graphResetViewButton.title = t("graph.resetView");
  elements.graphResetViewButton.setAttribute("aria-label", t("graph.resetView"));
  const toggleSidebarLabel = state.graph.sidebarCollapsed
    ? t("graph.showPanel")
    : t("graph.hidePanel");
  const toggleSidebarGlyph = elements.graphToggleSidebarButton.querySelector<HTMLElement>(".graph-action-button__glyph");
  if (toggleSidebarGlyph) {
    toggleSidebarGlyph.textContent = state.graph.sidebarCollapsed ? "▸" : "◂";
  }
  elements.graphToggleSidebarButton.title = toggleSidebarLabel;
  elements.graphToggleSidebarButton.setAttribute("aria-label", toggleSidebarLabel);
  elements.graphLocalButton.disabled = state.vault.selectedNoteId === null;
  elements.graphPathFindButton.disabled = !state.graph.pathFromNoteId || !state.graph.pathToNoteId;

  renderGraphStats();
  renderGraphLegend();
  renderGraphCanvas();
  renderGraphPathControls();
  renderGraphPathResult();
  renderGraphInsightList(elements.graphTopLinked, state.graph.topLinked, t("graph.noRankedNotes"));
  renderGraphInsightList(elements.graphHubs, state.graph.hubs, t("graph.noHubNotes"));
  renderGraphInsightList(elements.graphBridges, state.graph.bridges, t("graph.noBridgeNotes"));
  renderGraphBrokenLinks();
  renderGraphOrphans();
}

async function ensureGraphData(force = false): Promise<void> {
  const requestConfig = getGraphRequestConfig();
  if (!requestConfig) {
    state.graph.snapshot = null;
    state.graph.clusters = [];
    state.graph.topLinked = [];
    state.graph.hubs = [];
    state.graph.bridges = [];
    state.graph.brokenLinks = [];
    state.graph.orphans = [];
    state.graph.path = null;
    state.graph.pathRequestKey = "";
    state.graph.error = t("graph.chooseLocal");
    state.graph.requestKey = "";
    renderGraphView();
    return;
  }

  if (!force && requestConfig.key === state.graph.requestKey && state.graph.snapshot) {
    return;
  }

  const requestId = ++graphRequestSequence;
  state.graph.loading = true;
  state.graph.error = null;
  renderGraphView();

  try {
    const [snapshot, clusters, topLinked, hubs, bridges, brokenLinks, orphans] = await Promise.all([
      fetchJson<GraphSnapshot>(requestConfig.graphUrl),
      fetchJson<GraphCluster[]>(requestConfig.clustersUrl),
      fetchJson<GraphRankedNote[]>(requestConfig.topLinkedUrl),
      fetchJson<GraphRankedNote[]>(requestConfig.hubsUrl),
      fetchJson<GraphBridgeNote[]>(requestConfig.bridgesUrl),
      fetchJson<GraphBrokenLink[]>(requestConfig.brokenLinksUrl),
      fetchJson<Note[]>(requestConfig.orphansUrl),
    ]);

    if (requestId !== graphRequestSequence) {
      return;
    }

    state.graph.snapshot = snapshot;
    state.graph.clusters = clusters;
    state.graph.topLinked = topLinked;
    state.graph.hubs = hubs;
    state.graph.bridges = bridges;
    state.graph.brokenLinks = brokenLinks;
    state.graph.orphans = orphans;
    state.graph.requestKey = requestConfig.key;
    state.graph.error = null;
    if (force || state.graph.panX !== 0 || state.graph.panY !== 0 || state.graph.zoom !== 1) {
      resetGraphViewport();
    }
  } catch (error) {
    console.error(error);
    if (requestId !== graphRequestSequence) {
      return;
    }

    state.graph.snapshot = null;
    state.graph.clusters = [];
    state.graph.topLinked = [];
    state.graph.hubs = [];
    state.graph.bridges = [];
    state.graph.brokenLinks = [];
    state.graph.orphans = [];
    state.graph.error = t("graph.loadError");
  } finally {
    if (requestId === graphRequestSequence) {
      state.graph.loading = false;
      renderGraphView();
      void ensureGraphPathData();
    }
  }
}

function getGraphRequestConfig(): {
  key: string;
  graphUrl: string;
  clustersUrl: string;
  topLinkedUrl: string;
  hubsUrl: string;
  bridgesUrl: string;
  brokenLinksUrl: string;
  orphansUrl: string;
} | null {
  const selectedNoteId = state.vault.selectedNoteId;
  if (state.graph.mode === "local" && !selectedNoteId) {
    return null;
  }

  const params = new URLSearchParams();
  const activeConnectionId = getActiveConnectionId();
  if (activeConnectionId) {
    params.set("connectionId", activeConnectionId);
  }

  if (state.graph.folderScoped && state.vault.selectedFolderPath) {
    params.set("folderPath", state.vault.selectedFolderPath);
  }

  if (state.graph.existingFilesOnly) {
    params.set("existingFilesOnly", "true");
  }

  const sharedParams = params.toString();
  const graphParams = new URLSearchParams(sharedParams);
  if (state.graph.mode === "local" && selectedNoteId) {
    graphParams.set("noteId", selectedNoteId);
    graphParams.set("depth", "1");
  }

  const graphUrl = state.graph.mode === "local"
    ? `/api/graph/local?${graphParams.toString()}`
    : `/api/graph?${graphParams.toString()}`;
  const insightBase = sharedParams ? `?${sharedParams}&limit=6` : "?limit=6";

  return {
    key: [
      activeConnectionId ?? "",
      state.graph.mode,
      selectedNoteId ?? "",
      state.graph.folderScoped ? state.vault.selectedFolderPath : "",
      state.graph.existingFilesOnly ? "existing" : "all",
      state.vault.notes.length,
      state.vault.notes[0]?.updatedAt ?? "",
      state.vault.notes.find((note) => note.id === selectedNoteId)?.updatedAt ?? "",
    ].join("|"),
    graphUrl,
    clustersUrl: `/api/graph/clusters${sharedParams ? `?${sharedParams}` : ""}`,
    topLinkedUrl: `/api/graph/top-linked${insightBase}`,
    hubsUrl: `/api/graph/hubs${insightBase}`,
    bridgesUrl: `/api/graph/bridges${insightBase}`,
    brokenLinksUrl: `/api/graph/broken-links${sharedParams ? `?${sharedParams}` : ""}`,
    orphansUrl: `/api/graph/orphans${sharedParams ? `?${sharedParams}` : ""}`,
  };
}

function renderGraphStats(): void {
  if (state.graph.loading) {
    elements.graphStats.innerHTML = `<span class="graph-stat">${escapeHtml(t("graph.loading"))}</span>`;
    return;
  }

  if (!state.graph.snapshot) {
    elements.graphStats.innerHTML = "";
    return;
  }

  const stats = state.graph.snapshot.stats;
  const modeLabel = state.graph.mode === "local" ? t("graph.localGraph") : t("graph.globalGraph");
  const scopeLabel = state.graph.folderScoped
    ? state.vault.selectedFolderPath || t("graph.rootScope")
    : t("graph.wholeVault");

  elements.graphStats.innerHTML = [
    modeLabel,
    scopeLabel,
    t("graph.notes", { count: stats.noteCount }),
    t("graph.edges", { count: stats.edgeCount }),
    t("graph.tags", { count: stats.tagCount }),
    t("graph.dangling", { count: stats.danglingCount }),
    t("graph.orphansCount", { count: stats.orphanNoteCount }),
  ]
    .map((label) => `<span class="graph-stat">${escapeHtml(label)}</span>`)
    .join("");
}

function renderGraphLegend(): void {
  const colorState = getGraphColorState();
  if (!colorState || colorState.items.length === 0) {
    elements.graphLegend.innerHTML = "";
    return;
  }

  elements.graphLegend.innerHTML = colorState.items
    .slice(0, 8)
    .map((item) => `
      <span class="graph-legend__item">
        <span class="graph-legend__swatch" style="background:${escapeAttribute(item.color)}"></span>
        <span>${escapeHtml(item.label)}${item.count > 1 ? ` · ${item.count}` : ""}</span>
      </span>
    `)
    .join("");
}

function renderGraphCanvas(): void {
  const svg = elements.graphCanvas;
  svg.innerHTML = "";

  const snapshot = state.graph.snapshot;
  const pathHighlights = getGraphPathHighlights(state.graph.path);
  const colorState = getGraphColorState();
  if (!snapshot) {
    svg.classList.remove("is-dense");
    elements.graphEmptyState.hidden = false;
    elements.graphEmptyState.textContent = state.graph.error ?? t("graph.loadingNotStarted");
    return;
  }

  if (state.graph.loading && snapshot.nodes.length === 0) {
    svg.classList.remove("is-dense");
    elements.graphEmptyState.hidden = false;
    elements.graphEmptyState.textContent = t("graph.loading");
    return;
  }

  if (snapshot.nodes.length === 0) {
    svg.classList.remove("is-dense");
    elements.graphEmptyState.hidden = false;
    elements.graphEmptyState.textContent = state.graph.error ?? t("graph.noData");
    return;
  }

  elements.graphEmptyState.hidden = true;
  const selectedNodeId = snapshot.nodes.some((node) => node.id === state.graph.selectedNodeId)
    ? state.graph.selectedNodeId
    : null;
  if (state.graph.selectedNodeId !== selectedNodeId) {
    state.graph.selectedNodeId = selectedNodeId;
  }
  const selectionHighlights = getGraphSelectionHighlights(snapshot, selectedNodeId);
  const layout = getGraphLayoutResult();
  if (!layout) {
    elements.graphEmptyState.hidden = false;
    elements.graphEmptyState.textContent = state.graph.error ?? t("graph.loadingNotStarted");
    svg.classList.remove("is-dense");
    return;
  }
  svg.classList.toggle("is-dense", layout.dense);
  const positions = layout.positions;

  const namespace = "http://www.w3.org/2000/svg";
  const viewport = document.createElementNS(namespace, "g");
  viewport.setAttribute(
    "transform",
    `translate(${state.graph.panX} ${state.graph.panY}) scale(${state.graph.zoom})`
  );

  snapshot.edges.forEach((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) {
      return;
    }

    const line = document.createElementNS(namespace, "line");
    line.setAttribute("x1", String(source.x));
    line.setAttribute("y1", String(source.y));
    line.setAttribute("x2", String(target.x));
    line.setAttribute("y2", String(target.y));
    line.setAttribute(
      "class",
      [
        "graph-edge",
        edge.kind === "tag" ? "graph-edge--tag" : "",
        pathHighlights.edgeIds.has(edge.id) ? "is-path" : "",
        selectionHighlights.edgeIds.has(edge.id) ? "is-selected" : "",
        selectionHighlights.hasSelection && !selectionHighlights.edgeIds.has(edge.id) ? "is-dimmed" : "",
      ].filter(Boolean).join(" ")
    );
    line.setAttribute("stroke-width", String(Math.min(3.2, 1 + edge.weight * 0.45)));
    viewport.append(line);
  });

  snapshot.nodes.forEach((node) => {
    const position = positions.get(node.id);
    if (!position) {
      return;
    }

    const group = document.createElementNS(namespace, "g");
    group.setAttribute("transform", `translate(${position.x} ${position.y})`);
    group.setAttribute("class", "graph-node-button");
    if (node.noteId) {
      group.dataset.graphNoteId = node.noteId;
    }
    if (node.tag) {
      group.dataset.graphTag = node.tag;
    }
    if (node.type === "dangling") {
      group.dataset.graphDangling = node.label;
    }
    group.addEventListener("pointerdown", (event: PointerEvent) => {
      event.stopPropagation();
    });
    group.addEventListener("pointerup", (event: PointerEvent) => {
      event.stopPropagation();
    });
    group.addEventListener("contextmenu", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!node.noteId) {
        return;
      }

      openGraphNodeMenu(node.noteId, event.clientX, event.clientY);
    });
    group.addEventListener("click", (event: MouseEvent) => {
      if (isGraphDragging) {
        return;
      }

      event.stopPropagation();
      closeGraphNodeMenu();
      state.graph.selectedNodeId = state.graph.selectedNodeId === node.id ? null : node.id;
      renderGraphCanvas();
    });
    group.addEventListener("dblclick", (event: MouseEvent) => {
      if (isGraphDragging || !node.noteId) {
        return;
      }

      event.stopPropagation();
      closeGraphNodeMenu();
      void openNote(node.noteId, { nextView: getLastNoteView() });
    });

    const circle = document.createElementNS(namespace, "circle");
    const title = document.createElementNS(namespace, "title");
    title.textContent = node.type === "tag" ? `#${node.tag ?? node.label}` : node.label;
    group.append(title);

    circle.setAttribute("r", String(getGraphNodeRadius(node, snapshot)));
    const nodeColor = colorState?.nodeColors.get(node.noteId ?? node.id);
    if (nodeColor) {
      circle.style.setProperty("--graph-node-fill", nodeColor.fill);
      circle.style.setProperty("--graph-node-stroke", nodeColor.stroke);
    }
    circle.setAttribute(
      "class",
      [
        "graph-node",
        `graph-node--${node.type}`,
        node.noteId === state.vault.selectedNoteId ? "is-active" : "",
        node.type === "note" && node.noteId && pathHighlights.nodeIds.has(node.noteId) ? "is-path" : "",
        selectionHighlights.selectedNodeId === node.id ? "is-selected" : "",
        selectionHighlights.relatedNodeIds.has(node.id) ? "is-related" : "",
        selectionHighlights.hasSelection
          && selectionHighlights.selectedNodeId !== node.id
          && !selectionHighlights.relatedNodeIds.has(node.id)
          ? "is-dimmed"
          : "",
      ].filter(Boolean).join(" ")
    );
    group.append(circle);

    if (shouldShowGraphLabel(node, snapshot, layout, selectionHighlights, pathHighlights)) {
      const label = document.createElementNS(namespace, "text");
      label.setAttribute("y", String(getGraphNodeRadius(node, snapshot) + 16));
      label.setAttribute(
        "class",
        [
          "graph-label",
          node.type === "dangling" ? "graph-label--muted" : "",
          selectionHighlights.selectedNodeId === node.id ? "is-selected" : "",
          selectionHighlights.relatedNodeIds.has(node.id) ? "is-related" : "",
          selectionHighlights.hasSelection
            && selectionHighlights.selectedNodeId !== node.id
            && !selectionHighlights.relatedNodeIds.has(node.id)
            ? "is-dimmed"
            : "",
        ].filter(Boolean).join(" ")
      );
      const labelLength = layout.dense && !selectionHighlights.relatedNodeIds.has(node.id) ? 13 : 16;
      label.textContent = truncateLabel(node.type === "tag" ? `#${node.tag ?? node.label}` : node.label, labelLength);
      group.append(label);
    }

    viewport.append(group);
  });

  svg.append(viewport);
}

function getGraphLayoutPositions(): Map<string, GraphPoint> | null {
  return getGraphLayoutResult()?.positions ?? null;
}

function getGraphLayoutResult(): GraphLayoutResult | null {
  if (!state.graph.snapshot) {
    return null;
  }

  const key = getGraphLayoutCacheKey(state.graph.snapshot, state.vault.selectedNoteId, state.graph.mode);
  if (graphLayoutCache?.key === key) {
    return graphLayoutCache.result;
  }

  const result = buildGraphLayout(state.graph.snapshot, state.vault.selectedNoteId, state.graph.mode);
  graphLayoutCache = { key, result };
  return result;
}

function getGraphSelectionHighlights(
  snapshot: GraphSnapshot,
  selectedNodeId: string | null
): {
  hasSelection: boolean;
  selectedNodeId: string | null;
  relatedNodeIds: Set<string>;
  edgeIds: Set<string>;
} {
  if (!selectedNodeId) {
    return {
      hasSelection: false,
      selectedNodeId: null,
      relatedNodeIds: new Set<string>(),
      edgeIds: new Set<string>(),
    };
  }

  const relatedNodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  snapshot.edges.forEach((edge) => {
    if (edge.source !== selectedNodeId && edge.target !== selectedNodeId) {
      return;
    }

    edgeIds.add(edge.id);
    relatedNodeIds.add(edge.source);
    relatedNodeIds.add(edge.target);
  });

  return {
    hasSelection: true,
    selectedNodeId,
    relatedNodeIds,
    edgeIds,
  };
}

function centerGraphViewport(): void {
  const layout = getGraphLayoutResult();
  if (!layout || layout.positions.size === 0) {
    resetGraphViewport();
    return;
  }

  const { minX, maxX, minY, maxY } = layout.bounds;
  if (!isValidGraphBounds(layout.bounds)) {
    resetGraphViewport();
    return;
  }

  const contentCenterX = (minX + maxX) / 2;
  const contentCenterY = (minY + maxY) / 2;

  state.graph.panX = GRAPH_VIEWBOX_CENTER_X - contentCenterX * state.graph.zoom;
  state.graph.panY = GRAPH_VIEWBOX_CENTER_Y - contentCenterY * state.graph.zoom;
}

function renderGraphInsightList(
  container: HTMLElement,
  items: Array<GraphRankedNote | GraphBridgeNote>,
  emptyLabel: string
): void {
  if (items.length === 0) {
    container.innerHTML = `<p class="graph-empty-list">${escapeHtml(emptyLabel)}</p>`;
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const meta = "disconnectedGroups" in item
        ? t("graph.bridgeMeta", {
            cuts: item.disconnectedGroups,
            neighbors: item.neighborCount,
          })
        : t("graph.hubMeta", {
            inbound: item.inboundLinks,
            outbound: item.outboundLinks,
            neighbors: item.neighborCount,
          });
      return `
        <button type="button" class="graph-insight-item" data-note-id="${escapeAttribute(item.noteId)}">
          <p class="graph-insight-item__title">${escapeHtml(item.title)}</p>
          <p class="graph-insight-item__meta">${escapeHtml(item.folderPath || getRootLabel())} · ${escapeHtml(t("graph.score", { score: item.score }))}</p>
          <p class="graph-insight-item__meta">${escapeHtml(meta)}</p>
        </button>
      `;
    })
    .join("");
}

function renderGraphPathControls(): void {
  const options = state.vault.notes
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((note) => {
      const label = note.folderPath ? `${note.folderPath}/${note.title}` : note.title;
      return `<option value="${escapeAttribute(note.id)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  const placeholder = `<option value="">${escapeHtml(t("graph.selectNote"))}</option>`;
  elements.graphPathFrom.innerHTML = placeholder + options;
  elements.graphPathTo.innerHTML = placeholder + options;
  elements.graphPathFrom.value = state.graph.pathFromNoteId ?? "";
  elements.graphPathTo.value = state.graph.pathToNoteId ?? "";
}

function renderGraphPathResult(): void {
  if (state.graph.pathLoading) {
    elements.graphPathResult.innerHTML = `<p class="graph-empty-list">${escapeHtml(t("graph.findingPath"))}</p>`;
    return;
  }

  if (state.graph.pathError) {
    elements.graphPathResult.innerHTML = `<p class="graph-empty-list">${escapeHtml(state.graph.pathError)}</p>`;
    return;
  }

  if (!state.graph.path) {
    elements.graphPathResult.innerHTML = `<p class="graph-empty-list">${escapeHtml(t("graph.chooseTwoNotes"))}</p>`;
    return;
  }

  if (!state.graph.path.found) {
    elements.graphPathResult.innerHTML = `<p class="graph-empty-list">${escapeHtml(t("graph.noPath"))}</p>`;
    return;
  }

  const summary = `<p class="graph-empty-list">${escapeHtml(t("graph.distance", { distance: state.graph.path.distance ?? 0 }))}</p>`;
  const steps = state.graph.path.nodes
    .map((item, index) => `
      <button type="button" class="graph-insight-item${index === 0 ? " is-path-start" : ""}" data-note-id="${escapeAttribute(item.noteId)}">
        <p class="graph-insight-item__title">${escapeHtml(item.title)}</p>
        <p class="graph-insight-item__meta">${escapeHtml(item.folderPath || getRootLabel())} · ${escapeHtml(t("graph.step", { step: index + 1 }))}</p>
      </button>
    `)
    .join("");

  elements.graphPathResult.innerHTML = summary + steps;
}

function syncGraphPathSelection(): void {
  const noteIds = new Set(state.vault.notes.map((note) => note.id));
  const selectedNoteId = state.vault.selectedNoteId;

  if (!state.graph.pathFromNoteId || !noteIds.has(state.graph.pathFromNoteId)) {
    state.graph.pathFromNoteId = selectedNoteId ?? state.vault.notes[0]?.id ?? null;
  }

  if (!state.graph.pathToNoteId || !noteIds.has(state.graph.pathToNoteId) || state.graph.pathToNoteId === state.graph.pathFromNoteId) {
    state.graph.pathToNoteId = state.vault.notes.find((note) => note.id !== state.graph.pathFromNoteId)?.id ?? null;
  }

  if (
    state.graph.path &&
    (!state.graph.pathFromNoteId || !state.graph.pathToNoteId)
  ) {
    state.graph.path = null;
  }
}

async function ensureGraphPathData(force = false): Promise<void> {
  const pathConfig = getGraphPathRequestConfig();
  if (!pathConfig) {
    state.graph.path = null;
    state.graph.pathRequestKey = "";
    state.graph.pathError = null;
    state.graph.pathLoading = false;
    renderGraphView();
    return;
  }

  if (!force && state.graph.pathRequestKey === pathConfig.key && state.graph.path) {
    return;
  }

  const requestId = ++graphPathRequestSequence;
  state.graph.pathLoading = true;
  state.graph.pathError = null;
  renderGraphView();

  try {
    const path = await fetchJson<GraphPathResult>(pathConfig.url);
    if (requestId !== graphPathRequestSequence) {
      return;
    }

    state.graph.path = path;
    state.graph.pathRequestKey = pathConfig.key;
    state.graph.pathError = null;
  } catch (error) {
    console.error(error);
    if (requestId !== graphPathRequestSequence) {
      return;
    }

    state.graph.path = null;
    state.graph.pathRequestKey = pathConfig.key;
    state.graph.pathError = t("graph.pathError");
  } finally {
    if (requestId === graphPathRequestSequence) {
      state.graph.pathLoading = false;
      renderGraphView();
    }
  }
}

function getGraphPathRequestConfig(): { key: string; url: string } | null {
  if (!state.graph.pathFromNoteId || !state.graph.pathToNoteId) {
    return null;
  }

  const params = new URLSearchParams({
    fromNoteId: state.graph.pathFromNoteId,
    toNoteId: state.graph.pathToNoteId,
  });
  const activeConnectionId = getActiveConnectionId();
  if (activeConnectionId) {
    params.set("connectionId", activeConnectionId);
  }

  if (state.graph.folderScoped && state.vault.selectedFolderPath) {
    params.set("folderPath", state.vault.selectedFolderPath);
  }

  return {
    key: `${activeConnectionId ?? ""}|${state.graph.pathFromNoteId}|${state.graph.pathToNoteId}|${state.graph.folderScoped ? state.vault.selectedFolderPath : ""}`,
    url: `/api/graph/path?${params.toString()}`,
  };
}

function renderGraphBrokenLinks(): void {
  if (state.graph.brokenLinks.length === 0) {
    elements.graphBrokenLinks.innerHTML = `<p class="graph-empty-list">${escapeHtml(t("graph.noBrokenLinks"))}</p>`;
    return;
  }

  elements.graphBrokenLinks.innerHTML = state.graph.brokenLinks
    .map((item) => `
      <button type="button" class="graph-insight-item graph-insight-item--warning" data-note-id="${escapeAttribute(item.sourceNoteId)}">
        <p class="graph-insight-item__title">${escapeHtml(item.linkText)}</p>
        <p class="graph-insight-item__meta">${escapeHtml(item.sourceTitle)} · ${escapeHtml(item.sourceFolderPath || getRootLabel())}</p>
        <p class="graph-insight-item__meta">${escapeHtml(t("graph.unresolvedLinks", { count: item.occurrences }))}</p>
      </button>
    `)
    .join("");
}

function renderGraphOrphans(): void {
  if (state.graph.orphans.length === 0) {
    elements.graphOrphans.innerHTML = `<p class="graph-empty-list">${escapeHtml(t("graph.noOrphans"))}</p>`;
    return;
  }

  elements.graphOrphans.innerHTML = state.graph.orphans
    .map((item) => `
      <button type="button" class="graph-insight-item" data-note-id="${escapeAttribute(item.id)}">
        <p class="graph-insight-item__title">${escapeHtml(item.title)}</p>
        <p class="graph-insight-item__meta">${escapeHtml(item.folderPath || getRootLabel())}</p>
        <p class="graph-insight-item__meta">${escapeHtml(t("graph.noNoteLinks"))}</p>
      </button>
    `)
    .join("");
}

function renderNoteList(): void {
  const notes = getFilteredNotes();
  elements.noteCount.textContent = String(notes.length);
  elements.noteList.innerHTML = "";

  if (!notes.length) {
    const item = document.createElement("li");
    item.className = "note-list__item";
    item.innerHTML = `
      <p class="note-list__title">${escapeHtml(t("note.none"))}</p>
      <p class="note-list__excerpt">${escapeHtml(t("note.noneCopy"))}</p>
    `;
    elements.noteList.append(item);
    return;
  }

  const notesByFolder = new Map<string, Note[]>();
  notes.forEach((note) => {
    const folderNotes = notesByFolder.get(note.folderPath) ?? [];
    folderNotes.push(note);
    notesByFolder.set(note.folderPath, folderNotes);
  });

  const visibleFolderTree = buildFolderTree(
    getVisibleFolderPaths(notes, state.vault.folders)
      .filter((folderPath) => folderPath !== "")
      .map((folderPath) => ({
        path: folderPath,
        name: folderPath.split("/").pop() ?? folderPath,
        parentPath: getParentFolderPath(folderPath) || null,
      }))
  );

  visibleFolderTree.forEach((node) => {
    elements.noteList.append(renderExplorerFolderNode(node, notesByFolder, 0));
  });

  (notesByFolder.get("") ?? []).forEach((note, index) => {
    elements.noteList.append(
      renderExplorerNoteItem(note, 0, {
        rootStart: visibleFolderTree.length > 0 && index === 0,
      })
    );
  });
}

function renderFolderControls(): void {
  const selectedFolderPath = state.vault.selectedFolderPath;
  const showAll = state.vault.folderVisibilityMode === "all";

  elements.showAllFoldersButton.classList.toggle("is-active", showAll);
  elements.showSelectedFolderButton.classList.toggle("is-active", !showAll);
  elements.folderSelectionPath.textContent = selectedFolderPath || getRootLabel();

  const isRoot = selectedFolderPath === "";
  const deleteHint = isRoot
    ? t("folder.rootCannotDelete")
    : isSelectedFolderDeletable()
      ? t("folder.deleteSelected", { path: selectedFolderPath })
      : t("folder.deleteOnlyEmpty");

  elements.renameFolderButton.disabled = isRoot;
  elements.renameFolderButton.title = isRoot
    ? t("folder.rootCannotRename")
    : t("folder.renameSelected", { path: selectedFolderPath });
  elements.deleteFolderButton.disabled = isRoot || !isSelectedFolderDeletable();
  elements.deleteFolderButton.title = deleteHint;
}

function renderFolderList(): void {
  const folders = getAllFolderOptions(state.vault.folders);
  elements.folderCount.textContent = String(folders.length);
  elements.folderList.innerHTML = "";

  const rootItem = document.createElement("li");
  rootItem.className = "folder-list__item";
  rootItem.innerHTML = `
    <button type="button" class="folder-list__button${state.vault.selectedFolderPath === "" ? " is-active" : ""}" data-folder-path="">
      <span class="folder-list__icon">▣</span>
      <span class="folder-list__label">${escapeHtml(getRootLabel())}</span>
    </button>
  `;
  elements.folderList.append(rootItem);

  const tree = buildFolderTree(state.vault.folders);
  tree.forEach((node) => {
    elements.folderList.append(renderFolderTreeNode(node, 0));
  });
}

function renderWorkspaceTabs(): void {
  const tabs = getWorkspaceTabs();
  const activeTab = getActiveWorkspaceTab();
  const selectedNote = getSelectedNote();
  const activeNote = activeTab && isTabInActiveConnection(activeTab)
    ? findNoteById(activeTab.noteId)
    : selectedNote;

  elements.workspaceViewBadge.textContent = getViewModeLabel(state.view);
  elements.workspaceNewTabButton.disabled = selectedNote === null;

  if (!activeNote && !activeTab) {
    elements.workspaceActiveTabState.textContent = t("workspace.noActiveNote");
  } else if (activeTab) {
    const folderLabel = activeNote?.folderPath || activeTab.folderPath || getRootLabel();
    const connectionLabel = activeTab.connectionName && !isTabInActiveConnection(activeTab)
      ? ` · ${activeTab.connectionName}`
      : "";
    elements.workspaceActiveTabState.innerHTML = `
      <span class="workspace-tabs__active-title">${escapeHtml(activeNote ? getDisplayTitle(activeNote) : activeTab.title ?? activeTab.noteId)}</span>
      <span class="workspace-tabs__active-path">${escapeHtml(`${folderLabel}${connectionLabel}`)}</span>
    `;
  } else {
    const folderLabel = activeNote?.folderPath || getRootLabel();
    elements.workspaceActiveTabState.innerHTML = `
      <span class="workspace-tabs__active-title">${escapeHtml(activeNote ? getDisplayTitle(activeNote) : t("workspace.noActiveNote"))}</span>
      <span class="workspace-tabs__active-path">${escapeHtml(`${t("workspace.currentNote")} · ${folderLabel}`)}</span>
    `;
  }

  if (tabs.length === 0) {
    elements.workspaceTabList.innerHTML = `
      <div class="workspace-tabs__empty">
        <span>${escapeHtml(t("workspace.emptyTabsTitle"))}</span>
        <span>${escapeHtml(t("workspace.emptyTabsCopy"))}</span>
      </div>
    `;
    return;
  }

  elements.workspaceTabList.innerHTML = tabs
    .map((tab) => {
      const note = isTabInActiveConnection(tab) ? findNoteById(tab.noteId) : null;
      const isActive = tab.id === state.tabs.activeTabId;
      const isDirty = note ? isWorkspaceTabDirty(note.id) : false;
      const title = note ? getDisplayTitle(note) : tab.title ?? tab.noteId;
      const meta = !isTabInActiveConnection(tab) && tab.connectionName
        ? `<span class="workspace-note-tab__meta">${escapeHtml(tab.connectionName)}</span>`
        : "";
      return `
        <div
          class="workspace-note-tab${isActive ? " is-active" : ""}${tab.pinned ? " is-pinned" : ""}"
          data-workspace-tab-id="${escapeAttribute(tab.id)}"
          draggable="true"
        >
          <button
            type="button"
            class="workspace-note-tab__button"
            data-workspace-tab-activate="${escapeAttribute(tab.id)}"
            title="${escapeAttribute(title)}"
          >
            <span class="workspace-note-tab__pin-mark" aria-hidden="true">${tab.pinned ? "●" : ""}</span>
            <span class="workspace-note-tab__title">${escapeHtml(title)}</span>
            ${meta}
            <span class="workspace-note-tab__dirty${isDirty ? " is-visible" : ""}" aria-hidden="true"></span>
          </button>
          <div class="workspace-note-tab__actions">
            <button
              type="button"
              class="workspace-note-tab__icon"
              data-workspace-tab-pin="${escapeAttribute(tab.id)}"
              aria-label="${escapeAttribute(tab.pinned ? t("workspace.tabUnpin") : t("workspace.tabPin"))}"
              title="${escapeAttribute(tab.pinned ? t("workspace.tabUnpin") : t("workspace.tabPin"))}"
            >
              ${tab.pinned ? "★" : "☆"}
            </button>
            <button
              type="button"
              class="workspace-note-tab__icon"
              data-workspace-tab-close="${escapeAttribute(tab.id)}"
              aria-label="${escapeAttribute(t("workspace.tabClose"))}"
              title="${escapeAttribute(t("workspace.tabClose"))}"
            >
              ×
            </button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderWorkspace(forceSyncInputs = true): void {
  const note = getSelectedNote();

  if (!note) {
    const template = elements.emptyNoteTemplate.content.cloneNode(true);
    elements.noteTitle.value = "";
    elements.noteFolderSelect.innerHTML = `<option value="">${escapeHtml(getRootLabel())}</option>`;
    elements.noteFolderSelect.value = "";
    elements.notePathBadge.textContent = getRootLabel();
    elements.noteEditor.value = "";
    elements.noteTitle.disabled = true;
    elements.noteFolderSelect.disabled = true;
    elements.noteMoveButton.disabled = true;
    elements.noteEditor.disabled = true;
    elements.deleteButton.disabled = true;
    hideTitleHint();
    hideTags();
    hideBacklinks();
    closeWikilinkSuggestions();
    elements.notePreview.innerHTML = "";
    elements.notePreview.append(template);
    elements.noteMeta.textContent = t("note.wordsMeta", { count: 0 });
    return;
  }

  elements.noteTitle.disabled = false;
  elements.noteFolderSelect.disabled = false;
  elements.noteMoveButton.disabled = false;
  elements.noteEditor.disabled = false;
  elements.deleteButton.disabled = false;

  if (forceSyncInputs || document.activeElement !== elements.noteTitle) {
    elements.noteTitle.value = note.draftTitle ?? note.title;
  }

  if (forceSyncInputs || document.activeElement !== elements.noteEditor) {
    elements.noteEditor.value = note.content;
  }

  renderTitleHint(note);
  renderFolderSelect(note);
  elements.notePathBadge.textContent = note.folderPath || getRootLabel();
  renderNoteTags(note);
  renderBacklinks(note);
  renderWikilinkSuggestions();
  elements.notePreview.innerHTML = renderMarkdown(note.content);
  elements.noteMeta.textContent = [
    note.folderPath || getRootLabel(),
    t("note.wordsMeta", { count: countWords(note.content) }),
    t("note.charactersMeta", { count: countCharacters(note.content) }),
  ].join(" · ");
}

function updateNoteTitle(nextTitle: string): void {
  const note = getSelectedNote();
  if (!note) {
    return;
  }

  note.draftTitle = nextTitle;
  setStatus(t("status.unsavedChanges"));
  renderNoteList();
  renderWorkspace(false);
}

function updateNoteContent(content: string): void {
  const note = getSelectedNote();
  if (!note) {
    return;
  }

  note.content = content;
  note.updatedAt = new Date().toISOString();
  renderNoteList();
  renderWorkspace(false);
  queueSave(note.id);
}

function updateWikilinkSuggestions(): void {
  const note = getSelectedNote();
  if (!note || document.activeElement !== elements.noteEditor) {
    closeWikilinkSuggestions();
    return;
  }

  const selectionStart = elements.noteEditor.selectionStart ?? elements.noteEditor.value.length;
  const context = getWikilinkAutocompleteContext(elements.noteEditor.value, selectionStart);
  if (!context) {
    closeWikilinkSuggestions();
    return;
  }

  const items = getWikilinkSuggestionItems(context.query, note.id);
  if (items.length === 0) {
    state.editor.wikilink.query = context.query;
    state.editor.wikilink.replaceStart = context.replaceStart;
    state.editor.wikilink.replaceEnd = context.replaceEnd;
    state.editor.wikilink.activeIndex = 0;
    state.editor.wikilink.items = [];
    renderWikilinkSuggestions();
    return;
  }

  state.editor.wikilink.query = context.query;
  state.editor.wikilink.replaceStart = context.replaceStart;
  state.editor.wikilink.replaceEnd = context.replaceEnd;
  state.editor.wikilink.items = items;
  state.editor.wikilink.activeIndex = clamp(state.editor.wikilink.activeIndex, 0, items.length - 1);
  renderWikilinkSuggestions();
}

function closeWikilinkSuggestions(): void {
  state.editor.wikilink.query = "";
  state.editor.wikilink.replaceStart = 0;
  state.editor.wikilink.replaceEnd = 0;
  state.editor.wikilink.activeIndex = 0;
  state.editor.wikilink.items = [];
  renderWikilinkSuggestions();
}

function renderWikilinkSuggestions(): void {
  const suggestionState = state.editor.wikilink;
  if (
    !suggestionState.query
    && suggestionState.items.length === 0
  ) {
    elements.wikilinkSuggestions.hidden = true;
    elements.wikilinkSuggestions.innerHTML = "";
    return;
  }

  elements.wikilinkSuggestions.hidden = false;
  if (suggestionState.items.length === 0) {
    elements.wikilinkSuggestions.innerHTML = `<p class="wikilink-suggestions__empty">${escapeHtml(t("editor.noLinkMatches"))}</p>`;
    return;
  }

  elements.wikilinkSuggestions.innerHTML = suggestionState.items
    .map((item, index) => `
      <button
        type="button"
        class="wikilink-suggestion${index === suggestionState.activeIndex ? " is-active" : ""}"
        data-wikilink-note-id="${escapeAttribute(item.noteId)}"
      >
        <p class="wikilink-suggestion__title">${escapeHtml(item.insertion)}</p>
        <p class="wikilink-suggestion__meta">${escapeHtml(item.meta)}</p>
      </button>
    `)
    .join("");
}

function applyActiveWikilinkSuggestion(): void {
  const suggestion = state.editor.wikilink.items[state.editor.wikilink.activeIndex];
  const note = getSelectedNote();
  if (!suggestion || !note) {
    closeWikilinkSuggestions();
    return;
  }

  const editor = elements.noteEditor;
  const nextValue = `${editor.value.slice(0, state.editor.wikilink.replaceStart)}${suggestion.insertion}${editor.value.slice(state.editor.wikilink.replaceEnd)}`;
  editor.value = nextValue;
  const nextCaret = state.editor.wikilink.replaceStart + suggestion.insertion.length;
  editor.setSelectionRange(nextCaret, nextCaret);
  editor.focus();
  updateNoteContent(nextValue);
  closeWikilinkSuggestions();
}

function getWikilinkAutocompleteContext(
  content: string,
  cursorIndex: number
): { query: string; replaceStart: number; replaceEnd: number } | null {
  const beforeCursor = content.slice(0, cursorIndex);
  const openIndex = beforeCursor.lastIndexOf("[[");
  if (openIndex === -1) {
    return null;
  }

  const closeIndex = beforeCursor.lastIndexOf("]]");
  if (closeIndex > openIndex) {
    return null;
  }

  const rawQuery = beforeCursor.slice(openIndex + 2);
  if (rawQuery.includes("\n") || rawQuery.includes("\r") || rawQuery.includes("[") || rawQuery.includes("]") || rawQuery.includes("|")) {
    return null;
  }

  return {
    query: rawQuery.trim(),
    replaceStart: openIndex + 2,
    replaceEnd: cursorIndex,
  };
}

function getWikilinkSuggestionItems(query: string, currentNoteId: string): WikilinkSuggestionItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const titleCounts = new Map<string, number>();
  state.vault.notes.forEach((note) => {
    titleCounts.set(note.title.toLowerCase(), (titleCounts.get(note.title.toLowerCase()) ?? 0) + 1);
  });

  return state.vault.notes
    .filter((note) => note.id !== currentNoteId)
    .map((note) => {
      const qualifiedPath = note.id.replace(/\.md$/i, "");
      const folderLabel = note.folderPath || getRootLabel();
      const duplicateTitle = (titleCounts.get(note.title.toLowerCase()) ?? 0) > 1;
      const shouldUseQualifiedPath = duplicateTitle || normalizedQuery.includes("/");
      const insertion = shouldUseQualifiedPath ? qualifiedPath : note.title;
      const searchable = [
        note.title.toLowerCase(),
        qualifiedPath.toLowerCase(),
        `${folderLabel}/${note.title}`.toLowerCase(),
      ];
      const score = getWikilinkSuggestionScore(searchable, normalizedQuery, note.title.toLowerCase(), qualifiedPath.toLowerCase());
      return {
        noteId: note.id,
        title: note.title,
        folderPath: note.folderPath,
        insertion,
        meta: duplicateTitle ? qualifiedPath : folderLabel,
        score,
      };
    })
    .filter((item) => item.score > 0 || normalizedQuery.length === 0)
    .sort((left, right) => right.score - left.score || left.insertion.localeCompare(right.insertion, "en"))
    .slice(0, 8)
    .map(({ score: _score, ...item }) => item);
}

function getWikilinkSuggestionScore(
  searchable: string[],
  normalizedQuery: string,
  title: string,
  qualifiedPath: string
): number {
  if (!normalizedQuery) {
    return 1;
  }

  if (title === normalizedQuery || qualifiedPath === normalizedQuery) {
    return 120;
  }

  if (title.startsWith(normalizedQuery)) {
    return 90;
  }

  if (qualifiedPath.startsWith(normalizedQuery)) {
    return 80;
  }

  if (searchable.some((value) => value.includes(normalizedQuery))) {
    return 40;
  }

  return 0;
}

async function openNote(
  noteId: string,
  options: { nextView?: ViewMode; openInNewTab?: boolean; historyMode?: "push" | "skip" } = {}
): Promise<void> {
  const currentTab = findWorkspaceTabByNoteId(noteId);
  const nextView = options.nextView ?? state.view;
  if (
    noteId === state.vault.selectedNoteId
    && nextView === state.view
    && !options.openInNewTab
    && state.tabs.activeTabId === currentTab?.id
  ) {
    return;
  }

  if (options.historyMode !== "skip" && !isRestoringNavigation) {
    pushNavigationEntry(captureNavigationEntry());
  }

  commitCurrentTitleDraft();
  const saved = await flushPendingSave();
  if (!saved) {
    return;
  }

  if (options.nextView) {
    state.view = options.nextView;
    rememberNoteView(options.nextView);
  }
  await syncWorkspaceTabOpen(noteId, {
    replaceActive: options.openInNewTab !== true,
    forceNew: options.openInNewTab === true,
  });
  state.vault.selectedNoteId = noteId;
  syncSelectedFolderWithSelectedNote();
  render();
}

async function openSelectedNoteInNewTab(): Promise<void> {
  const note = getSelectedNote();
  if (!note) {
    return;
  }

  await openNote(note.id, {
    openInNewTab: true,
  });
}

function queueSave(noteId: string, delayMs = SAVE_DEBOUNCE_MS): void {
  pendingSaveNoteId = noteId;
  setStatus(t("status.unsavedChanges"));

  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }

  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    const queuedNoteId = pendingSaveNoteId;
    pendingSaveNoteId = null;
    if (!queuedNoteId) {
      return;
    }

    void enqueueSave(queuedNoteId, false);
  }, delayMs);
}

async function flushPendingSave({ flash = false }: { flash?: boolean } = {}): Promise<boolean> {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  const queuedNoteId = pendingSaveNoteId;
  pendingSaveNoteId = null;

  if (!queuedNoteId) {
    if (flash) {
      flashStatus(t("status.saved"));
    }
    return true;
  }

  return enqueueSave(queuedNoteId, flash);
}

function enqueueSave(noteId: string, flash: boolean): Promise<boolean> {
  const queuedNote = state.vault.notes.find((item) => item.id === noteId);
  if (!queuedNote) {
    return Promise.resolve(true);
  }

  const payload = {
    title: getPersistableTitle(queuedNote),
    content: queuedNote.content,
  };

  saveSequence = saveSequence.then(async () => {
    const note = state.vault.notes.find((item) => item.id === noteId);
    if (!note) {
      return true;
    }

    try {
      saveInFlight = true;
      setStatus(t("status.saving"));
      const saved = await api.updateNote(noteId, payload);
      const currentNote = state.vault.notes.find((item) => item.id === noteId);
      const hasNewerLocalChanges = currentNote !== undefined && hasDivergedFromPayload(currentNote, payload);

      if (hasNewerLocalChanges && currentNote) {
        mergeSavedNoteWithLocalChanges(noteId, saved, currentNote);
        queueSave(saved.id);
      } else {
        replaceNote(noteId, saved);
      }

      if (flash) {
        flashStatus(t("status.savedInVault"));
      } else {
        setStatus(getBaseStatusLabel());
      }
      await maybeReloadAfterExternalChanges();
      return true;
    } catch (error) {
      console.error(error);
      pendingSaveNoteId = noteId;
      flashStatus(getErrorMessage(error, t("error.save")));
      return false;
    } finally {
      saveInFlight = false;
    }
  });

  return saveSequence;
}

function replaceNote(noteId: string, savedNote: Note): void {
  const index = state.vault.notes.findIndex((note) => note.id === noteId);
  if (index === -1) {
    return;
  }

  const previousNote = state.vault.notes[index];
  state.vault.notes[index] = {
    ...savedNote,
    draftTitle: shouldPreserveDraft(previousNote, savedNote),
  };
  remapWorkspaceTabNoteId(noteId, savedNote.id);
  if (state.vault.selectedNoteId === noteId) {
    state.vault.selectedNoteId = savedNote.id;
  }
  render();
}

function mergeSavedNoteWithLocalChanges(noteId: string, savedNote: Note, currentNote: Note): void {
  const index = state.vault.notes.findIndex((note) => note.id === noteId);
  if (index === -1) {
    return;
  }

  state.vault.notes[index] = {
    ...savedNote,
    content: currentNote.content,
    draftTitle: currentNote.draftTitle,
  };
  remapWorkspaceTabNoteId(noteId, savedNote.id);
  if (state.vault.selectedNoteId === noteId) {
    state.vault.selectedNoteId = savedNote.id;
  }
  render();
}

function getSelectedNote(): Note | null {
  return state.vault.notes.find((note) => note.id === state.vault.selectedNoteId) ?? null;
}

function getWorkspaceTabs(): WorkspaceTab[] {
  return state.tabs.tabs;
}

function getActiveWorkspaceTab(): WorkspaceTab | null {
  return state.tabs.tabs.find((tab) => tab.id === state.tabs.activeTabId) ?? null;
}

function findWorkspaceTab(tabId: string): WorkspaceTab | null {
  return state.tabs.tabs.find((tab) => tab.id === tabId) ?? null;
}

function getWorkspaceTabConnectionId(tab: WorkspaceTab): string | null {
  return tab.connectionId ?? getActiveConnectionId() ?? null;
}

function isTabInActiveConnection(tab: WorkspaceTab): boolean {
  const activeConnectionId = getActiveConnectionId();
  if (!activeConnectionId) {
    return false;
  }

  return getWorkspaceTabConnectionId(tab) === activeConnectionId;
}

function findNoteById(noteId: string): Note | null {
  return state.vault.notes.find((note) => note.id === noteId) ?? null;
}

function isWorkspaceTabOpen(noteId: string): boolean {
  return state.tabs.tabs.some((tab) => tab.noteId === noteId && isTabInActiveConnection(tab));
}

function findWorkspaceTabByNoteId(noteId: string, connectionId = getActiveConnectionId()): WorkspaceTab | null {
  return state.tabs.tabs.find((tab) => tab.noteId === noteId && getWorkspaceTabConnectionId(tab) === connectionId) ?? null;
}

function ensureWorkspaceTab(
  noteId: string,
  options: { replaceActive?: boolean; forceNew?: boolean } = {}
): void {
  const note = findNoteById(noteId);
  if (!note) {
    return;
  }

  const activeConnectionId = getActiveConnectionId();
  const existingTab = findWorkspaceTabByNoteId(noteId, activeConnectionId);
  const activeTab = getActiveWorkspaceTab();

  if (options.forceNew) {
    const baseId = activeConnectionId && activeConnectionId !== "default"
      ? `${activeConnectionId}:${noteId}`
      : noteId;
    let nextId = baseId;
    let counter = 2;
    while (findWorkspaceTab(nextId)) {
      nextId = `${baseId}::${counter}`;
      counter += 1;
    }

    state.tabs.tabs = [...state.tabs.tabs, {
      id: nextId,
      noteId,
      title: note.title,
      folderPath: note.folderPath,
      pinned: false,
      connectionId: activeConnectionId,
    }];
    state.tabs.activeTabId = nextId;
    return;
  }

  if (options.replaceActive && activeTab && isTabInActiveConnection(activeTab)) {
    if (existingTab && existingTab.id !== activeTab.id) {
      state.tabs.activeTabId = existingTab.id;
      return;
    }

    state.tabs.tabs = state.tabs.tabs.map((tab) =>
      tab.id === activeTab.id
        ? {
            ...tab,
            id: activeConnectionId && activeConnectionId !== "default" ? `${activeConnectionId}:${noteId}` : noteId,
            noteId,
            title: note.title,
            folderPath: note.folderPath,
            connectionId: activeConnectionId,
          }
        : tab
    );
    state.tabs.activeTabId = activeConnectionId && activeConnectionId !== "default" ? `${activeConnectionId}:${noteId}` : noteId;
    return;
  }

  if (!existingTab) {
    state.tabs.tabs = [...state.tabs.tabs, {
      id: activeConnectionId && activeConnectionId !== "default" ? `${activeConnectionId}:${noteId}` : noteId,
      noteId,
      title: note.title,
      folderPath: note.folderPath,
      pinned: false,
      connectionId: activeConnectionId,
    }];
  }

  state.tabs.activeTabId = state.tabs.tabs.find((tab) => tab.noteId === noteId && isTabInActiveConnection(tab))?.id
    ?? (activeConnectionId && activeConnectionId !== "default" ? `${activeConnectionId}:${noteId}` : noteId);
}

async function activateWorkspaceTab(tabId: string): Promise<void> {
  const tab = findWorkspaceTab(tabId);
  if (!tab) {
    return;
  }

  if (!isRestoringNavigation) {
    pushNavigationEntry(captureNavigationEntry());
  }

  commitCurrentTitleDraft();
  const saved = await flushPendingSave();
  if (!saved) {
    return;
  }

  try {
    applyWorkspaceTabsSnapshot(await api.activateWorkspaceTab(tabId));
  } catch (error) {
    console.error(error);
    state.tabs.activeTabId = tabId;
  }

  const targetConnectionId = getWorkspaceTabConnectionId(tab);
  if (targetConnectionId && targetConnectionId !== getActiveConnectionId()) {
    state.workspace.activeConnectionId = targetConnectionId;
    await reloadVault(tab.noteId, { preferredConnectionId: targetConnectionId });
    return;
  }

  syncSelectedNoteFromTabs(tab.noteId);
  render();
}

async function toggleWorkspaceTabPin(tabId: string): Promise<void> {
  const tab = findWorkspaceTab(tabId);
  const nextPinned = !(tab?.pinned ?? false);

  try {
    applyWorkspaceTabsSnapshot(await api.setWorkspaceTabPinned(tabId, nextPinned));
  } catch (error) {
    console.error(error);
    state.tabs.tabs = state.tabs.tabs.map((item) =>
      item.id === tabId
        ? { ...item, pinned: nextPinned }
        : item
    );
  }

  renderWorkspaceTabs();
}

async function closeWorkspaceTab(tabId: string): Promise<void> {
  const tab = findWorkspaceTab(tabId);
  const fallbackTabId = getWorkspaceTabFallbackTabId(tabId);
  const fallbackNoteId = findWorkspaceTab(fallbackTabId ?? "")?.noteId ?? null;

  try {
    applyWorkspaceTabsSnapshot(await api.closeWorkspaceTab(tabId));
  } catch (error) {
    console.error(error);
    removeWorkspaceTabReference(tabId, fallbackTabId);
  }

  if (tab?.connectionId && tab.connectionId !== getActiveConnectionId()) {
    renderWorkspaceTabs();
    return;
  }

  syncSelectedNoteFromTabs(fallbackNoteId ?? tab?.noteId ?? null);
  render();
}

function removeWorkspaceTabReference(tabId: string, fallbackTabId: string | null): void {
  state.tabs.tabs = state.tabs.tabs.filter((tab) => tab.id !== tabId);

  if (state.tabs.activeTabId !== tabId) {
    return;
  }

  if (fallbackTabId && findWorkspaceTab(fallbackTabId)) {
    state.tabs.activeTabId = fallbackTabId;
    return;
  }

  state.tabs.activeTabId = null;
}

function getWorkspaceTabFallbackTabId(tabId: string): string | null {
  const index = state.tabs.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return state.tabs.activeTabId;
  }

  return state.tabs.tabs[index + 1]?.id
    ?? state.tabs.tabs[index - 1]?.id
    ?? null;
}

async function moveWorkspaceTab(
  draggedTabId: string,
  targetTab: HTMLElement | null,
  clientX: number
): Promise<void> {
  const orderedIds = state.tabs.tabs.map((tab) => tab.id);
  if (!orderedIds.includes(draggedTabId)) {
    return;
  }

  const nextIds = orderedIds.filter((tabId) => tabId !== draggedTabId);
  if (!targetTab) {
    nextIds.push(draggedTabId);
  } else {
    const targetNoteId = targetTab.dataset.workspaceTabId?.trim();
    if (!targetNoteId || targetNoteId === draggedTabId) {
      return;
    }

    const targetIndex = nextIds.indexOf(targetNoteId);
    if (targetIndex === -1) {
      nextIds.push(draggedTabId);
    } else {
      const { left, width } = targetTab.getBoundingClientRect();
      const insertAfter = clientX > left + width / 2;
      const insertIndex = insertAfter ? targetIndex + 1 : targetIndex;
      nextIds.splice(insertIndex, 0, draggedTabId);
    }
  }

  try {
    applyWorkspaceTabsSnapshot(await api.reorderWorkspaceTabs(nextIds));
  } catch (error) {
    console.error(error);
    state.tabs.tabs = nextIds
      .map((tabId) => state.tabs.tabs.find((tab) => tab.id === tabId))
      .filter((tab): tab is WorkspaceTab => tab !== undefined);
  }

  renderWorkspaceTabs();
}

function clearWorkspaceTabDropTargets(): void {
  elements.workspaceTabList.querySelectorAll<HTMLElement>(".workspace-note-tab.is-drop-target")
    .forEach((tab) => {
      tab.classList.remove("is-drop-target");
    });
}

function clearWorkspaceTabDragState(): void {
  clearWorkspaceTabDropTargets();
  elements.workspaceTabList.querySelectorAll<HTMLElement>(".workspace-note-tab.is-dragging")
    .forEach((tab) => {
      tab.classList.remove("is-dragging");
    });
}

function reconcileWorkspaceTabs(preferredNoteId: string | null = state.vault.selectedNoteId): void {
  const validNoteIds = new Set(state.vault.notes.map((note) => note.id));
  const activeConnectionId = getActiveConnectionId();
  state.tabs.tabs = state.tabs.tabs.filter((tab) => {
    if (!isTabInActiveConnection(tab)) {
      return true;
    }

    return validNoteIds.has(tab.noteId) && (!activeConnectionId || getWorkspaceTabConnectionId(tab) === activeConnectionId);
  });

  const activeTab = getActiveWorkspaceTab();
  if (activeTab && isTabInActiveConnection(activeTab) && !validNoteIds.has(activeTab.noteId)) {
    state.tabs.activeTabId = null;
  }

  if (!state.tabs.initialized) {
    state.tabs.initialized = true;
    if (preferredNoteId && validNoteIds.has(preferredNoteId)) {
      ensureWorkspaceTab(preferredNoteId);
    }
  }

  if (!state.tabs.activeTabId && state.tabs.tabs.length > 0) {
    state.tabs.activeTabId = state.tabs.tabs[0]?.id ?? null;
  }

  syncSelectedNoteFromTabs(preferredNoteId);
}

function applyWorkspaceTabsSnapshot(snapshot: TabsSessionSnapshot): void {
  state.tabs.tabs = snapshot.tabs.map((tab) => ({
    id: tab.id,
    noteId: tab.noteId,
    title: tab.title,
    folderPath: tab.folderPath,
    pinned: tab.pinned,
    connectionId: tab.connectionId,
    connectionName: tab.connectionName,
  }));
  state.tabs.activeTabId = snapshot.activeTabId;
  state.tabs.initialized = true;
}

async function hydrateWorkspaceTabs(preferredNoteId: string | null = state.vault.selectedNoteId): Promise<void> {
  try {
    let snapshot = await api.getWorkspaceTabs();

    if (
      !state.tabs.initialized &&
      snapshot.tabs.length === 0 &&
      preferredNoteId &&
      findNoteById(preferredNoteId)
    ) {
      snapshot = await api.openWorkspaceTab(preferredNoteId);
    }

    applyWorkspaceTabsSnapshot(snapshot);
    syncSelectedNoteFromTabs(snapshot.activeNoteId ?? preferredNoteId);
  } catch (error) {
    console.error(error);
    reconcileWorkspaceTabs(preferredNoteId);
  }
}

async function syncWorkspaceTabOpen(
  noteId: string,
  options: { replaceActive?: boolean; forceNew?: boolean } = {}
): Promise<void> {
  try {
    applyWorkspaceTabsSnapshot(await api.openWorkspaceTab(noteId, options));
  } catch (error) {
    console.error(error);
    ensureWorkspaceTab(noteId, options);
  }
}

function remapWorkspaceTabNoteId(previousNoteId: string, nextNoteId: string): void {
  if (previousNoteId === nextNoteId) {
    return;
  }

  const activeConnectionId = getActiveConnectionId();
  state.tabs.tabs = state.tabs.tabs.map((tab) => {
    if (tab.noteId !== previousNoteId || getWorkspaceTabConnectionId(tab) !== activeConnectionId) {
      return tab;
    }

    return {
      ...tab,
      noteId: nextNoteId,
    };
  });
}

function syncSelectedNoteFromTabs(fallbackNoteId: string | null = state.vault.selectedNoteId): void {
  const activeTab = getActiveWorkspaceTab();
  if (activeTab && isTabInActiveConnection(activeTab) && findNoteById(activeTab.noteId)) {
    state.vault.selectedNoteId = activeTab.noteId;
    syncSelectedFolderWithSelectedNote();
    return;
  }

  if (fallbackNoteId && findNoteById(fallbackNoteId)) {
    state.vault.selectedNoteId = fallbackNoteId;
    syncSelectedFolderWithSelectedNote();
    return;
  }

  state.vault.selectedNoteId = state.vault.notes[0]?.id ?? null;
  syncSelectedFolderWithSelectedNote();
}

function isWorkspaceTabDirty(noteId: string): boolean {
  const note = findNoteById(noteId);
  if (!note) {
    return false;
  }

  return pendingSaveNoteId === noteId || note.draftTitle !== undefined;
}

function getFilteredNotes(): Note[] {
  const notes = [...state.vault.notes].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
  const matchingNotes = !state.query
    ? notes
    : notes.filter((note) => matchesNoteQuery(note, getNoteMetadata(note), state.query));

  return filterNotesByFolderScope(matchingNotes);
}

function ensureSelection(): void {
  if (state.tabs.activeTabId && findNoteById(state.tabs.activeTabId)) {
    state.vault.selectedNoteId = state.tabs.activeTabId;
    syncSelectedFolderWithSelectedNote();
    return;
  }

  if (state.vault.selectedNoteId && getSelectedNote()) {
    return;
  }

  state.vault.selectedNoteId = state.vault.notes[0]?.id ?? null;
  syncSelectedFolderWithSelectedNote();
}

function syncSelectedFolderWithSelectedNote(): void {
  const note = getSelectedNote();
  if (!note) {
    return;
  }

  if (!state.vault.selectedNoteIds.includes(note.id)) {
    state.vault.selectedNoteIds = [note.id];
    state.vault.selectionAnchorNoteId = note.id;
  } else if (!state.vault.selectionAnchorNoteId) {
    state.vault.selectionAnchorNoteId = note.id;
  }

  state.vault.selectedFolderPath = note.folderPath;
  expandFolderAncestors(note.folderPath);
}

function normalizeSelectedNoteSelection(): void {
  const validNoteIds = new Set(state.vault.notes.map((note) => note.id));
  state.vault.selectedNoteIds = state.vault.selectedNoteIds.filter((noteId) => validNoteIds.has(noteId));

  if (
    state.vault.selectionAnchorNoteId &&
    !validNoteIds.has(state.vault.selectionAnchorNoteId)
  ) {
    state.vault.selectionAnchorNoteId = null;
  }

  if (state.vault.selectedNoteId && validNoteIds.has(state.vault.selectedNoteId)) {
    if (!state.vault.selectedNoteIds.includes(state.vault.selectedNoteId)) {
      state.vault.selectedNoteIds = [state.vault.selectedNoteId];
      state.vault.selectionAnchorNoteId = state.vault.selectedNoteId;
    }
    return;
  }

  if (state.vault.selectedNoteIds.length > 0) {
    state.vault.selectedNoteId = state.vault.selectedNoteIds[0] ?? null;
    return;
  }

  state.vault.selectionAnchorNoteId = null;
}

function ensureSelectedFolderStillExists(): void {
  const folders = new Set(getAllFolderOptions(state.vault.folders));
  if (!folders.has(state.vault.selectedFolderPath)) {
    state.vault.selectedFolderPath = "";
  }
}

function findNoteByTitle(title: string): Note | null {
  return state.vault.notes.find((note) => getDisplayTitle(note).toLowerCase() === title.toLowerCase()) ?? null;
}

function getDisplayTitle(note: Note): string {
  const draftTitle = note.draftTitle?.trim();
  return draftTitle || note.title;
}

function getPersistableTitle(note: Note): string {
  const draftTitle = note.draftTitle?.trim();
  if (!draftTitle || hasTitleConflict(note, note.folderPath)) {
    return note.title;
  }

  return draftTitle;
}

function hasUnsavedChanges(): boolean {
  return pendingSaveNoteId !== null
    || saveTimer !== null
    || saveInFlight
    || hasUncommittedTitleDraft()
    || hasPendingMemoryChanges();
}

function hasDivergedFromPayload(
  note: Note,
  payload: { title: string; content: string }
): boolean {
  return note.content !== payload.content || getPersistableTitle(note) !== payload.title;
}

function shouldPreserveDraft(note: Note, savedNote: Note): string | undefined {
  if (note.draftTitle === undefined) {
    return undefined;
  }

  const trimmedTitle = note.draftTitle.trim();
  if (!trimmedTitle) {
    return "";
  }

  if (trimmedTitle !== savedNote.title) {
    return note.draftTitle;
  }

  return undefined;
}

function commitCurrentTitleDraft({ delayMs = SAVE_DEBOUNCE_MS }: { delayMs?: number } = {}): void {
  const note = getSelectedNote();
  if (!note || note.draftTitle === undefined) {
    return;
  }

  const trimmedTitle = note.draftTitle.trim();
  if (!trimmedTitle) {
    note.draftTitle = undefined;
    return;
  }

  note.draftTitle = trimmedTitle;

  if (hasTitleConflict(note, note.folderPath)) {
    return;
  }

  if (trimmedTitle === note.title) {
    note.draftTitle = undefined;
    return;
  }

  queueSave(note.id, delayMs);
}

function getTitleConflict(note: Note, folderPath: string): string | null {
  const draftTitle = note.draftTitle?.trim();
  if (!draftTitle) {
    return null;
  }

  const conflicts = state.vault.notes.some((item) =>
    item.id !== note.id &&
    item.folderPath === folderPath &&
    item.title.toLowerCase() === draftTitle.toLowerCase()
  );

  return conflicts ? t("error.titleTaken") : null;
}

function hasTitleConflict(note: Note, folderPath: string): boolean {
  return getTitleConflict(note, folderPath) !== null;
}

function renderTitleHint(note: Note): void {
  const conflict = getTitleConflict(note, note.folderPath);
  if (!conflict) {
    hideTitleHint();
    return;
  }

  elements.titleHint.hidden = false;
  elements.titleHint.textContent = conflict;
}

function hideTitleHint(): void {
  elements.titleHint.hidden = true;
  elements.titleHint.textContent = "";
}

function renderFolderSelect(note: Note): void {
  const options = getAllFolderOptions(state.vault.folders)
    .map((folderPath) => {
      const label = folderPath || getRootLabel();
      return `<option value="${escapeAttribute(folderPath)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  elements.noteFolderSelect.innerHTML = options;
  elements.noteFolderSelect.value = note.folderPath;
}

function renderNoteTags(note: Note): void {
  const tags = getNoteTags(note);
  if (!tags.length) {
    hideTags();
    return;
  }

  elements.noteTags.hidden = false;
  elements.noteTags.innerHTML = tags
    .map((tag) =>
      `<button class="note-tag" data-tag="${escapeAttribute(tag)}">#${escapeHtml(tag)}</button>`
    )
    .join("");
}

function hideTags(): void {
  elements.noteTags.hidden = true;
  elements.noteTags.innerHTML = "";
}

function getNoteTags(note: Note): string[] {
  return getNoteMetadata(note).tags;
}

function getNoteMetadata(note: Note): { links: { link: string }[]; backlinks: string[]; tags: string[] } {
  return wiki.getMetadata(note, state.vault.notes) ?? {
    links: [],
    backlinks: [],
    tags: [],
  };
}

function applyTagFilter(tag: string): void {
  const query = `#${tag}`;
  state.query = query.toLowerCase();
  elements.searchInput.value = query;
  renderNoteList();
  flashStatus(t("status.filterTag", { tag }));
}

function renderBacklinks(note: Note): void {
  const backlinks = getNoteBacklinks(note);
  if (!backlinks.length) {
    hideBacklinks();
    return;
  }

  elements.noteContext.hidden = false;
  elements.noteBacklinks.innerHTML = backlinks
    .map(
      (backlink) =>
        `<button class="context-link" data-note-id="${escapeAttribute(backlink.id)}">${escapeHtml(backlink.title)}</button>`
    )
    .join("");
}

function hideBacklinks(): void {
  elements.noteContext.hidden = true;
  elements.noteBacklinks.innerHTML = "";
}

function getNoteBacklinks(note: Note): Note[] {
  const backlinkIds = getNoteMetadata(note).backlinks;
  return backlinkIds
    .map((id) => state.vault.notes.find((item) => item.id === id) ?? null)
    .filter((item): item is Note => item !== null);
}

async function startWorkspacePolling(): Promise<void> {
  const stateSnapshot = await safeGetWorkspaceState();
  if (stateSnapshot) {
    state.workspaceRevision = stateSnapshot.revision;
  }

  workspacePollTimer = window.setInterval(() => {
    void pollWorkspaceState();
  }, WORKSPACE_POLL_MS);
}

async function pollWorkspaceState(): Promise<void> {
  const nextState = await safeGetWorkspaceState();
  if (!nextState || nextState.revision <= state.workspaceRevision) {
    return;
  }

  state.workspaceRevision = nextState.revision;

  if (hasUnsavedChanges()) {
    state.hasExternalChanges = true;
    setStatus(t("status.externalChanges"));
    return;
  }

  setStatus(t("status.externalReloading"));
  await reloadVault(state.vault.selectedNoteId);
  flashStatus(t("status.vaultUpdated"));
}

async function maybeReloadAfterExternalChanges(): Promise<void> {
  if (!state.hasExternalChanges || hasUnsavedChanges()) {
    return;
  }

  setStatus(t("status.applyingExternal"));
  await reloadVault(state.vault.selectedNoteId);
  flashStatus(t("status.externalApplied"));
}

async function safeGetWorkspaceState(): Promise<{ revision: number; changedAt: string } | null> {
  try {
    return await apiClient.getWorkspaceState(getActiveConnectionId());
  } catch (error) {
    console.error(error);
    return null;
  }
}

function persistPendingChangesForUnload(): void {
  commitCurrentTitleDraft();
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  const noteId = pendingSaveNoteId ?? state.vault.selectedNoteId;
  if (!noteId) {
    return;
  }

  const note = state.vault.notes.find((item) => item.id === noteId);
  if (!note) {
    return;
  }

  const activeConnectionId = getActiveConnectionId();
  const keepaliveUrl = activeConnectionId
    ? `/api/notes/${encodeURIComponent(noteId)}?connectionId=${encodeURIComponent(activeConnectionId)}`
    : `/api/notes/${encodeURIComponent(noteId)}`;
  void fetch(keepaliveUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: getPersistableTitle(note),
      content: note.content,
      connectionId: activeConnectionId,
    }),
    keepalive: true,
  });
  pendingSaveNoteId = null;

  persistMemoryChangesForUnload("global");
  persistMemoryChangesForUnload("workspace");
}

function persistMemoryChangesForUnload(scope: "global" | "workspace"): void {
  const document = getMemoryDocument(scope);
  const timer = scope === "global" ? globalMemorySaveTimer : workspaceMemorySaveTimer;
  if (timer !== null) {
    window.clearTimeout(timer);
    if (scope === "global") {
      globalMemorySaveTimer = null;
    } else {
      workspaceMemorySaveTimer = null;
    }
  }

  if (document.content === document.savedContent) {
    return;
  }

  const url = scope === "global"
    ? "/api/memory/global"
    : document.connectionId
      ? `/api/memory/workspace?connectionId=${encodeURIComponent(document.connectionId)}`
      : null;
  if (!url) {
    return;
  }

  void fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: document.content,
    }),
    keepalive: true,
  });
}

function toggleFolderCollapse(folderPath: string): void {
  const key = getFolderCollapseKey(folderPath);

  if (isFolderCollapsed(folderPath)) {
    state.vault.collapsedFolderPaths = state.vault.collapsedFolderPaths
      .filter((item) => item !== key);
    return;
  }

  state.vault.collapsedFolderPaths = [...state.vault.collapsedFolderPaths, key];
}

function isFolderCollapsed(folderPath: string): boolean {
  return state.vault.collapsedFolderPaths.includes(getFolderCollapseKey(folderPath));
}

function expandFolderAncestors(folderPath: string): void {
  const ancestors = getFolderAncestors(folderPath);
  state.vault.collapsedFolderPaths = state.vault.collapsedFolderPaths
    .filter((path) => !ancestors.includes(path));
}

function setFolderVisibilityMode(mode: FolderVisibilityMode): void {
  if (state.vault.folderVisibilityMode === mode) {
    return;
  }

  state.vault.folderVisibilityMode = mode;
  renderFolderControls();
  renderNoteList();
  renderGraphView();
}

function setGraphMode(mode: GraphMode): void {
  if (state.graph.mode === mode) {
    return;
  }

  state.graph.mode = mode;
  renderGraphView();
  if (state.view === "graph") {
    void ensureGraphData(true);
  }
}

function getAllFolderOptions(folders: WorkspaceFolder[]): string[] {
  return ["", ...folders.map((folder) => folder.path)];
}

function filterNotesByFolderScope(notes: Note[]): Note[] {
  if (state.vault.folderVisibilityMode === "all") {
    return notes;
  }

  return notes.filter((note) => isNoteInFolderScope(note, state.vault.selectedFolderPath));
}

function isFolderPathVisible(folderPath: string): boolean {
  if (state.vault.folderVisibilityMode === "all") {
    return true;
  }

  return isFolderPathInScope(folderPath, state.vault.selectedFolderPath);
}

function isNoteInFolderScope(note: Note, folderPath: string): boolean {
  return isFolderPathInScope(note.folderPath, folderPath);
}

function isFolderPathInScope(folderPath: string, scopePath: string): boolean {
  if (!scopePath) {
    return true;
  }

  return folderPath === scopePath || folderPath.startsWith(`${scopePath}/`);
}

function getVisibleFolderPaths(notes: Note[], folders: WorkspaceFolder[]): string[] {
  const visible = new Set<string>(
    getAllFolderOptions(folders).filter((folderPath) => isFolderPathVisible(folderPath))
  );
  notes.forEach((note) => {
    visible.add(note.folderPath);
  });

  return [...visible].sort((left, right) => left.localeCompare(right, "en"));
}

function groupNotesByFolder(
  notes: Note[],
  folderPaths: string[]
): Array<{ folderPath: string; notes: Note[] }> {
  return folderPaths.map((folderPath) => ({
    folderPath,
    notes: notes.filter((note) => note.folderPath === folderPath),
  })).filter((group) => group.notes.length > 0 || group.folderPath === state.vault.selectedFolderPath);
}

type FolderTreeNode = {
  path: string;
  name: string;
  children: FolderTreeNode[];
};

function buildFolderTree(folders: WorkspaceFolder[]): FolderTreeNode[] {
  const byPath = new Map<string, FolderTreeNode>();
  folders.forEach((folder) => {
    byPath.set(folder.path, {
      path: folder.path,
      name: folder.name,
      children: [],
    });
  });

  const roots: FolderTreeNode[] = [];
  folders.forEach((folder) => {
    const node = byPath.get(folder.path);
    if (!node) {
      return;
    }

    if (folder.parentPath) {
      const parent = byPath.get(folder.parentPath);
      if (parent) {
        parent.children.push(node);
        return;
      }
    }

    roots.push(node);
  });

  const sortNodes = (nodes: FolderTreeNode[]): FolderTreeNode[] => nodes
    .sort((left, right) => left.path.localeCompare(right.path, "en"))
    .map((node) => ({
      ...node,
      children: sortNodes(node.children),
    }));

  return sortNodes(roots);
}

function renderFolderTreeNode(node: FolderTreeNode, depth: number): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "folder-list__item";

  const hasChildren = node.children.length > 0;
  const isCollapsed = isFolderCollapsed(node.path);
  const isActive = node.path === state.vault.selectedFolderPath;
  item.innerHTML = `
    <div class="folder-list__row" style="--folder-depth:${depth}">
      <button type="button" class="folder-list__toggle${hasChildren ? "" : " is-empty"}" data-folder-toggle="${escapeAttribute(node.path)}" aria-label="${escapeAttribute(isCollapsed ? t("folder.expand") : t("folder.collapse"))}">
        <span class="folder-list__chevron">${hasChildren ? (isCollapsed ? "▸" : "▾") : ""}</span>
      </button>
      <button type="button" class="folder-list__button${isActive ? " is-active" : ""}" data-folder-path="${escapeAttribute(node.path)}">
        <span class="folder-list__icon">▣</span>
        <span class="folder-list__label">${escapeHtml(node.name)}</span>
      </button>
    </div>
  `;

  if (hasChildren && !isCollapsed) {
    const children = document.createElement("ul");
    children.className = "folder-list__children";
    node.children.forEach((child) => {
      children.append(renderFolderTreeNode(child, depth + 1));
    });
    item.append(children);
  }

  return item;
}

function renderExplorerFolderNode(
  node: FolderTreeNode,
  notesByFolder: Map<string, Note[]>,
  depth: number
): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "folder-list__item";

  const childFolders = node.children;
  const childNotes = notesByFolder.get(node.path) ?? [];
  const hasChildren = childFolders.length > 0 || childNotes.length > 0;
  const isCollapsed = isFolderCollapsed(node.path);
  const isActive = node.path === state.vault.selectedFolderPath;
  item.innerHTML = `
    <div class="folder-list__row note-tree__folder-row" style="--folder-depth:${depth}">
      <button type="button" class="folder-list__toggle${hasChildren ? "" : " is-empty"}" data-folder-toggle="${escapeAttribute(node.path)}" aria-label="${escapeAttribute(isCollapsed ? t("folder.expand") : t("folder.collapse"))}">
        <span class="folder-list__chevron">${hasChildren ? (isCollapsed ? "▸" : "▾") : ""}</span>
      </button>
      <button type="button" class="folder-list__button${isActive ? " is-active" : ""}" data-folder-path="${escapeAttribute(node.path)}">
        <span class="folder-list__label">${escapeHtml(node.name)}</span>
      </button>
    </div>
  `;

  if (hasChildren && !isCollapsed) {
    const children = document.createElement("ul");
    children.className = "folder-list__children note-tree__children";

    childFolders.forEach((child) => {
      children.append(renderExplorerFolderNode(child, notesByFolder, depth + 1));
    });

    childNotes.forEach((note) => {
      children.append(renderExplorerNoteItem(note, depth + 1));
    });

    item.append(children);
  }

  return item;
}

function renderExplorerNoteItem(
  note: Note,
  depth: number,
  options: { rootStart?: boolean } = {}
): HTMLLIElement {
  const item = document.createElement("li");
  item.className = `note-tree__item${options.rootStart ? " note-tree__item--root-start" : ""}`;
  const isSelected = state.vault.selectedNoteIds.includes(note.id);

  const button = document.createElement("button");
  button.type = "button";
  button.className = `note-list__button${isSelected ? " is-selected" : ""}${note.id === state.vault.selectedNoteId ? " is-active" : ""}`;
  button.dataset.noteId = note.id;
  button.style.setProperty("--folder-depth", String(depth));
  button.title = note.folderPath ? `${note.folderPath}/${getDisplayTitle(note)}` : getDisplayTitle(note);
  button.innerHTML = `
    <span class="note-list__icon" aria-hidden="true">•</span>
    <span class="note-list__title">${escapeHtml(getDisplayTitle(note))}</span>
  `;
  button.addEventListener("click", (event: MouseEvent) => {
    void handleExplorerNoteClick(note.id, event);
  });

  item.append(button);
  return item;
}

async function handleExplorerNoteClick(noteId: string, event: MouseEvent): Promise<void> {
  if (event.shiftKey) {
    selectExplorerNoteRange(noteId);
  } else {
    state.vault.selectedNoteIds = [noteId];
    state.vault.selectionAnchorNoteId = noteId;
  }

  await openNote(noteId);
}

function selectExplorerNoteRange(noteId: string): void {
  const visibleNoteIds = Array.from(
    elements.noteList.querySelectorAll<HTMLElement>("[data-note-id]")
  )
    .map((element) => element.dataset.noteId?.trim())
    .filter((value): value is string => Boolean(value));

  const anchorNoteId = state.vault.selectionAnchorNoteId
    ?? state.vault.selectedNoteId
    ?? noteId;
  const anchorIndex = visibleNoteIds.indexOf(anchorNoteId);
  const targetIndex = visibleNoteIds.indexOf(noteId);

  if (anchorIndex === -1 || targetIndex === -1) {
    state.vault.selectedNoteIds = [noteId];
    state.vault.selectionAnchorNoteId = noteId;
    return;
  }

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  state.vault.selectedNoteIds = visibleNoteIds.slice(start, end + 1);
}

function getFolderAncestors(folderPath: string): string[] {
  if (!folderPath) {
    return [];
  }

  const segments = folderPath.split("/");
  const ancestors = [folderPath];
  for (let index = segments.length - 1; index > 0; index -= 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

function getFolderCollapseKey(folderPath: string): string {
  return folderPath || ROOT_FOLDER_KEY;
}

function isSelectedFolderDeletable(): boolean {
  const folderPath = state.vault.selectedFolderPath;
  if (!folderPath) {
    return false;
  }

  const hasChildFolders = state.vault.folders.some((folder) => folder.parentPath === folderPath);
  const hasDirectNotes = state.vault.notes.some((note) => note.folderPath === folderPath);
  return !hasChildFolders && !hasDirectNotes;
}

function remapFolderState(sourceFolderPath: string, targetFolderPath: string): void {
  state.vault.selectedFolderPath = remapFolderPath(sourceFolderPath, targetFolderPath, state.vault.selectedFolderPath);
  state.vault.collapsedFolderPaths = state.vault.collapsedFolderPaths
    .map((folderPath) => remapFolderPath(sourceFolderPath, targetFolderPath, folderPath))
    .filter((folderPath, index, items) => items.indexOf(folderPath) === index);
}

function remapFolderPath(sourceFolderPath: string, targetFolderPath: string, folderPath: string): string {
  if (!folderPath) {
    return folderPath;
  }

  if (folderPath === sourceFolderPath) {
    return targetFolderPath;
  }

  if (folderPath.startsWith(`${sourceFolderPath}/`)) {
    return `${targetFolderPath}${folderPath.slice(sourceFolderPath.length)}`;
  }

  return folderPath;
}

function remapNoteIdForFolderChange(
  noteId: string | null,
  sourceFolderPath: string,
  targetFolderPath: string
): string | null {
  if (!noteId || !noteId.startsWith(`${sourceFolderPath}/`)) {
    return noteId;
  }

  return `${targetFolderPath}${noteId.slice(sourceFolderPath.length)}`;
}

function getParentFolderPath(folderPath: string): string {
  const segments = folderPath.split("/");
  segments.pop();
  return segments.join("/");
}

function hasUncommittedTitleDraft(): boolean {
  return state.vault.notes.some((note) => {
    if (note.draftTitle === undefined) {
      return false;
    }

    const trimmed = note.draftTitle.trim();
    if (!trimmed) {
      return false;
    }

    return trimmed !== note.title;
  });
}

const api = {
  async listWorkspaceConnections(): Promise<WorkspaceConnection[]> {
    return apiClient.listWorkspaceConnections();
  },

  async getGlobalMemory(): Promise<MemoryDocumentState> {
    const payload = await apiClient.getGlobalMemory();
    return toMemoryDocumentState(payload, null);
  },

  async updateGlobalMemory(content: string): Promise<MemoryDocumentState> {
    const payload = await apiClient.updateGlobalMemory(content);
    return toMemoryDocumentState(payload, null);
  },

  async deleteGlobalMemory(): Promise<void> {
    await apiClient.deleteGlobalMemory();
  },

  async getWorkspaceMemory(connectionId: string): Promise<MemoryDocumentState> {
    const payload = await apiClient.getWorkspaceMemory(connectionId);
    return toMemoryDocumentState(payload, payload.connectionName ?? null);
  },

  async updateWorkspaceMemory(connectionId: string, content: string): Promise<MemoryDocumentState> {
    const payload = await apiClient.updateWorkspaceMemory(connectionId, content);
    return toMemoryDocumentState(payload, payload.connectionName ?? null);
  },

  async deleteWorkspaceMemory(connectionId: string): Promise<void> {
    await apiClient.deleteWorkspaceMemory(connectionId);
  },

  async createWorkspaceConnection(payload: {
    name: string;
    kind: WorkspaceConnectionKind;
    rootPath?: string;
    codeRoot?: string;
    notesRoot?: string;
    isDefault: boolean;
  }): Promise<WorkspaceConnection> {
    return apiClient.createWorkspaceConnection(payload);
  },

  async updateWorkspaceConnection(
    connectionId: string,
    payload: {
      name: string;
      kind: WorkspaceConnectionKind;
      rootPath?: string;
      codeRoot?: string;
      notesRoot?: string;
      isDefault: boolean;
    }
  ): Promise<WorkspaceConnection> {
    return apiClient.updateWorkspaceConnection(connectionId, payload);
  },

  async deleteWorkspaceConnection(connectionId: string): Promise<void> {
    await apiClient.deleteWorkspaceConnection(connectionId);
  },

  async pickDirectory(payload: { title?: string; defaultPath?: string }): Promise<string | null> {
    return apiClient.pickDirectory(payload);
  },

  async createNote(payload: { title: string; content: string; folderPath?: string }): Promise<Note> {
    return apiClient.createNote(payload);
  },

  async updateNote(
    noteId: string,
    payload: { title: string; content: string; folderPath?: string }
  ): Promise<Note> {
    return apiClient.updateNote(noteId, payload);
  },

  async deleteNote(noteId: string): Promise<void> {
    await apiClient.deleteNote(noteId);
  },

  async getWorkspaceTabs(): Promise<TabsSessionSnapshot> {
    return apiClient.getWorkspaceTabs();
  },

  async openWorkspaceTab(
    noteId: string,
    options: { replaceActive?: boolean; forceNew?: boolean } = {}
  ): Promise<TabsSessionSnapshot> {
    return apiClient.openWorkspaceTab(noteId, options);
  },

  async closeWorkspaceTab(tabId: string): Promise<TabsSessionSnapshot> {
    return apiClient.closeWorkspaceTab(tabId);
  },

  async setWorkspaceTabPinned(tabId: string, pinned: boolean): Promise<TabsSessionSnapshot> {
    return apiClient.setWorkspaceTabPinned(tabId, pinned);
  },

  async reorderWorkspaceTabs(tabIds: string[]): Promise<TabsSessionSnapshot> {
    return apiClient.reorderWorkspaceTabs(tabIds);
  },

  async activateWorkspaceTab(tabId: string): Promise<TabsSessionSnapshot> {
    return apiClient.activateWorkspaceTab(tabId);
  },
};

function toMemoryDocumentState(
  payload: AppMemoryDocument,
  connectionName: string | null
): MemoryDocumentState {
  return {
    ...payload,
    connectionName,
    savedContent: payload.content,
    loading: false,
    saving: false,
    error: null,
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof RequestError) {
    if (error.status === 409 && error.message === "A note with this title already exists") {
      return t("error.titleTaken");
    }

    if (error.status === 404 && error.message === "Connection not found") {
      return t("error.connectionMissing");
    }

    if (error.status === 501 && error.message.trim()) {
      return error.message;
    }

    if (error.message.trim()) {
      return error.message;
    }
  }

  return fallback;
}

function getMemoryDocument(scope: "global" | "workspace"): MemoryDocumentState {
  return scope === "global" ? state.memory.global : state.memory.workspace;
}

function isMemoryDirty(scope: "global" | "workspace"): boolean {
  const document = getMemoryDocument(scope);
  return document.content !== document.savedContent;
}

function hasPendingMemoryChanges(): boolean {
  return globalMemorySaveTimer !== null
    || workspaceMemorySaveTimer !== null
    || state.memory.global.saving
    || state.memory.workspace.saving
    || isMemoryDirty("global")
    || isMemoryDirty("workspace");
}

function updateMemoryContent(scope: "global" | "workspace", content: string): void {
  const document = getMemoryDocument(scope);
  document.content = content;
  document.error = null;
  queueMemorySave(scope);
  renderMemoryView();
  setStatus(t("status.unsavedChanges"));
}

function queueMemorySave(scope: "global" | "workspace", delayMs = SAVE_DEBOUNCE_MS): void {
  const timer = scope === "global" ? globalMemorySaveTimer : workspaceMemorySaveTimer;
  if (timer !== null) {
    window.clearTimeout(timer);
  }

  const nextTimer = window.setTimeout(() => {
    if (scope === "global") {
      globalMemorySaveTimer = null;
    } else {
      workspaceMemorySaveTimer = null;
    }

    void enqueueMemorySave(scope, false);
  }, delayMs);

  if (scope === "global") {
    globalMemorySaveTimer = nextTimer;
  } else {
    workspaceMemorySaveTimer = nextTimer;
  }
}

async function flushAllPendingSaves({ flash = false }: { flash?: boolean } = {}): Promise<boolean> {
  const notesSaved = await flushPendingSave({ flash: false });
  if (!notesSaved) {
    return false;
  }

  return flushPendingMemorySaves({ flash });
}

async function flushPendingMemorySaves(options: {
  scopes?: MemorySaveScope[];
  flash?: boolean;
} = {}): Promise<boolean> {
  const scopes = resolveMemorySaveScopes(options.scopes);
  const results = await Promise.all(scopes.map((scope) => flushPendingMemorySave(scope, options.flash === true)));
  return didEverySaveSucceed(results);
}

async function flushPendingMemorySave(scope: MemorySaveScope, flash: boolean): Promise<boolean> {
  const timer = scope === "global" ? globalMemorySaveTimer : workspaceMemorySaveTimer;
  if (timer !== null) {
    window.clearTimeout(timer);
    if (scope === "global") {
      globalMemorySaveTimer = null;
    } else {
      workspaceMemorySaveTimer = null;
    }
  }

  const document = getMemoryDocument(scope);
  const dirty = isMemoryDirty(scope);
  if (shouldSkipMemorySave({
    isDirty: dirty,
    isLoading: document.loading,
    isSaving: document.saving,
    requiresConnection: scope === "workspace",
    hasConnection: Boolean(document.connectionId),
  })) {
    if (flash && !dirty && !document.loading && !document.saving) {
      flashStatus(t("status.saved"));
    }
    return true;
  }

  return enqueueMemorySave(scope, flash);
}

async function enqueueMemorySave(scope: MemorySaveScope, flash: boolean): Promise<boolean> {
  const document = getMemoryDocument(scope);
  if (shouldSkipMemorySave({
    isDirty: isMemoryDirty(scope),
    isLoading: document.loading,
    isSaving: document.saving,
    requiresConnection: scope === "workspace",
    hasConnection: Boolean(document.connectionId),
  })) {
    return true;
  }

  document.saving = true;
  document.error = null;
  renderMemoryView();
  setStatus(t("status.saving"));

  try {
    const targetConnectionId = document.connectionId;
    const saved = scope === "global"
      ? await api.updateGlobalMemory(document.content)
      : await api.updateWorkspaceMemory(targetConnectionId!, document.content);
    if (scope === "workspace" && state.memory.workspace.connectionId !== targetConnectionId) {
      return true;
    }
    applyMemoryDocument(scope, saved);
    if (flash) {
      flashStatus(t("status.memorySaved"));
    } else {
      setStatus(getBaseStatusLabel());
    }
    return true;
  } catch (error) {
    console.error(error);
    document.saving = false;
    document.error = getErrorMessage(error, t("error.memorySave"));
    renderMemoryView();
    flashStatus(document.error);
    return false;
  }
}

function applyMemoryDocument(scope: "global" | "workspace", document: MemoryDocumentState): void {
  const current = getMemoryDocument(scope);
  const nextContent = current.content !== current.savedContent ? current.content : document.content;
  const nextSavedContent = document.content;

  if (scope === "global") {
    state.memory.global = {
      ...document,
      content: nextContent,
      savedContent: nextSavedContent,
      saving: false,
      loading: false,
      error: null,
    };
  } else {
    if (state.memory.workspace.connectionId && document.connectionId !== state.memory.workspace.connectionId) {
      return;
    }

    state.memory.workspace = {
      ...document,
      content: nextContent,
      savedContent: nextSavedContent,
      saving: false,
      loading: false,
      error: null,
    };
  }

  renderMemoryView();
}

async function ensureMemoryLoaded(force = false): Promise<void> {
  await Promise.all([
    reloadMemoryScope("global", { force }),
    reloadMemoryScope("workspace", { force }),
  ]);
  state.memory.initialized = true;
}

async function handleReloadMemory(force = false): Promise<void> {
  const saved = await flushPendingMemorySaves();
  if (!saved) {
    return;
  }

  setStatus(t("status.memoryReloading"));
  await ensureMemoryLoaded(force);
  flashStatus(t("memory.synced"));
}

async function reloadMemoryScope(
  scope: "global" | "workspace",
  options: { force?: boolean } = {}
): Promise<void> {
  const document = getMemoryDocument(scope);
  if (!options.force && document.loading) {
    return;
  }

  if (scope === "workspace") {
    const connection = getActiveConnection();
    if (!connection) {
      state.memory.workspace = createEmptyMemoryDocument("workspace");
      renderMemoryView();
      return;
    }

    if (!options.force && document.connectionId === connection.id && state.memory.initialized) {
      return;
    }

    state.memory.workspace = {
      ...state.memory.workspace,
      connectionId: connection.id,
      connectionName: connection.name,
      loading: true,
      saving: false,
      error: null,
      content: "",
      savedContent: "",
      exists: false,
      createdAt: null,
      updatedAt: null,
    };
    renderMemoryView();

    try {
      const loaded = await api.getWorkspaceMemory(connection.id);
      if (state.memory.workspace.connectionId !== connection.id) {
        return;
      }

      applyMemoryDocument("workspace", loaded);
    } catch (error) {
      console.error(error);
      state.memory.workspace.loading = false;
      state.memory.workspace.error = getErrorMessage(error, t("error.memoryWorkspaceLoad"));
      renderMemoryView();
    }

    return;
  }

  if (!options.force && state.memory.initialized) {
    return;
  }

  state.memory.global = {
    ...state.memory.global,
    loading: true,
    saving: false,
    error: null,
  };
  renderMemoryView();

  try {
    const loaded = await api.getGlobalMemory();
    applyMemoryDocument("global", loaded);
  } catch (error) {
    console.error(error);
    state.memory.global.loading = false;
    state.memory.global.error = getErrorMessage(error, t("error.memoryGlobalLoad"));
    renderMemoryView();
  }
}

async function clearMemoryDocument(scope: "global" | "workspace"): Promise<void> {
  const document = getMemoryDocument(scope);
  if (scope === "workspace" && !document.connectionId) {
    return;
  }

  const confirmed = await confirmAction({
    title: scope === "global" ? t("memory.clearGlobalTitle") : t("memory.clearWorkspaceTitle"),
    description: t("memory.clearDescription"),
    confirmLabel: t("common.clear"),
  });
  if (!confirmed) {
    return;
  }

  document.saving = true;
  document.error = null;
  renderMemoryView();

  try {
    if (scope === "global") {
      await api.deleteGlobalMemory();
      state.memory.global = createEmptyMemoryDocument("global");
    } else {
      await api.deleteWorkspaceMemory(document.connectionId!);
      state.memory.workspace = {
        ...createEmptyMemoryDocument("workspace"),
        connectionId: document.connectionId,
        connectionName: document.connectionName,
      };
    }

    renderMemoryView();
    flashStatus(scope === "global" ? t("memory.clearedGlobal") : t("memory.clearedWorkspace"));
  } catch (error) {
    console.error(error);
    document.saving = false;
    document.error = getErrorMessage(error, t("error.memoryClear"));
    renderMemoryView();
    flashStatus(document.error);
  }
}

function getMemoryStateLabel(document: MemoryDocumentState): string {
  if (document.loading) {
    return t("memory.state.loading");
  }

  if (document.saving) {
    return t("memory.state.saving");
  }

  if (document.error) {
    return t("memory.state.error");
  }

  if (document.content !== document.savedContent) {
    return t("memory.state.draft");
  }

  return document.exists ? t("memory.state.ready") : t("memory.state.empty");
}

function formatMemoryTimestamp(value: string | null): string {
  if (!value) {
    return t("memory.notSavedYet");
  }

  return new Date(value).toLocaleString(state.locale === "ru" ? "ru-RU" : "en-US");
}

function buildMemoryMetaLabel(): string {
  const globalWords = countWords(state.memory.global.content);
  const workspaceWords = countWords(state.memory.workspace.content);
  const workspaceLabel = state.memory.workspace.connectionName ?? t("memory.noWorkspace");
  return t("memory.meta", {
    globalWords,
    workspaceLabel,
    workspaceWords,
  });
}

function setStatus(label: string): void {
  elements.saveState.textContent = label;
}

function flashStatus(label: string): void {
  elements.saveState.textContent = label;
  if (saveStateTimeout !== null) {
    window.clearTimeout(saveStateTimeout);
  }

  saveStateTimeout = window.setTimeout(() => {
    elements.saveState.textContent = getBaseStatusLabel();
  }, 1400);
}

function getBaseStatusLabel(): string {
  if (hasUnsavedChanges()) {
    return t("status.unsavedChanges");
  }

  if (state.hasExternalChanges) {
    return t("status.externalChanges");
  }

  const baseStatus = t("app.status");
  const activeConnection = getActiveConnection();
  return activeConnection ? `${baseStatus} · ${activeConnection.name}` : baseStatus;
}

function buildGraphLayout(
  snapshot: GraphSnapshot,
  selectedNoteId: string | null,
  mode: GraphMode
): GraphLayoutResult {
  const positions = new Map<string, GraphPoint>();
  const dense = isDenseGraph(snapshot);
  const world = getGraphWorldSize(snapshot, mode, dense);
  const centerX = world.width / 2;
  const centerY = dense && mode === "global" ? 310 : world.height / 2;

  const selectedNode = mode === "local" && selectedNoteId
    ? snapshot.nodes.find((node) => node.noteId === selectedNoteId)
    : null;
  if (selectedNode) {
    positions.set(selectedNode.id, { x: centerX, y: centerY });
  }

  const allNoteNodes = snapshot.nodes
    .filter((node) => node.type === "note" && node.id !== selectedNode?.id)
    .sort((left, right) => right.size - left.size || left.label.localeCompare(right.label, "en"));
  const orphanNoteNodes = dense && mode === "global"
    ? allNoteNodes.filter(isGraphOrphanNode)
    : [];
  const noteNodes = dense && mode === "global"
    ? allNoteNodes.filter((node) => !isGraphOrphanNode(node))
    : allNoteNodes;
  const tagNodes = snapshot.nodes
    .filter((node) => node.type === "tag")
    .sort((left, right) => right.degree - left.degree || left.label.localeCompare(right.label, "en"));
  const danglingNodes = snapshot.nodes
    .filter((node) => node.type === "dangling")
    .sort((left, right) => left.label.localeCompare(right.label, "en"));

  placeNodesOnRings(
    positions,
    noteNodes,
    centerX,
    centerY,
    mode === "local" ? 170 : dense ? 145 : 120,
    dense ? 88 : 78,
    dense ? 16 : 10,
    -Math.PI / 2
  );
  placeNodesOnRings(
    positions,
    tagNodes,
    centerX,
    centerY,
    mode === "local" ? 300 : dense ? 360 : 330,
    dense ? 76 : 64,
    dense ? 18 : 14,
    -Math.PI / 2 + 0.16
  );
  placeNodesOnRings(
    positions,
    danglingNodes,
    centerX,
    centerY,
    mode === "local" ? 390 : dense ? 470 : 420,
    62,
    dense ? 18 : 16,
    Math.PI / 2
  );

  if (orphanNoteNodes.length > 0) {
    placeDenseGraphOrphans(positions, orphanNoteNodes, world, centerY);
  }

  if (snapshot.nodes.length <= 1) {
    return {
      positions,
      bounds: getGraphLayoutBounds(positions, snapshot),
      dense,
    };
  }

  type SimPoint = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    fixed: boolean;
    targetX: number;
    targetY: number;
    radius: number;
    node: GraphNode;
  };

  const simPoints = new Map<string, SimPoint>();
  snapshot.nodes.forEach((node) => {
    const start = positions.get(node.id) ?? { x: centerX, y: centerY };
    simPoints.set(node.id, {
      x: start.x,
      y: start.y,
      vx: 0,
      vy: 0,
      fixed: node.id === selectedNode?.id || (dense && mode === "global" && isGraphOrphanNode(node)),
      targetX: start.x,
      targetY: start.y,
      radius: getGraphNodeRadius(node, snapshot),
      node,
    });
  });

  const movingNodeCount = [...simPoints.values()].filter((point) => !point.fixed).length;
  const iterations = dense
    ? Math.min(68, 34 + movingNodeCount * 2)
    : Math.min(84, 42 + snapshot.nodes.length * 2);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    applyGraphRepulsion(simPoints, dense ? 2400 : snapshot.nodes.length > 48 ? 2800 : 3600);
    applyGraphCollisions(simPoints);
    applyGraphEdgeSprings(simPoints, snapshot.edges);
    applyGraphAnchors(simPoints, mode, centerX, centerY, selectedNode?.id ?? null);
    integrateGraphPositions(simPoints, world.width, world.height);
  }

  simPoints.forEach((point, nodeId) => {
    positions.set(nodeId, { x: point.x, y: point.y });
  });

  return {
    positions,
    bounds: getGraphLayoutBounds(positions, snapshot),
    dense,
  };
}

void bootstrap();

function isDenseGraph(snapshot: GraphSnapshot): boolean {
  return snapshot.nodes.length >= DENSE_GRAPH_NODE_THRESHOLD
    || snapshot.stats.orphanNoteCount >= DENSE_GRAPH_ORPHAN_THRESHOLD;
}

function getGraphWorldSize(
  snapshot: GraphSnapshot,
  mode: GraphMode,
  dense: boolean
): { width: number; height: number } {
  if (!dense || mode === "local") {
    return {
      width: GRAPH_VIEWBOX_WIDTH,
      height: GRAPH_VIEWBOX_HEIGHT,
    };
  }

  const orphanCount = snapshot.nodes.filter(isGraphOrphanNode).length;
  const connectedCount = Math.max(1, snapshot.nodes.length - orphanCount);
  const columns = Math.max(8, Math.ceil(Math.sqrt(Math.max(orphanCount, 1)) * 1.35));
  const rows = Math.ceil(orphanCount / columns);
  return {
    width: Math.max(GRAPH_VIEWBOX_WIDTH, columns * 126 + 180, connectedCount * 18 + 760),
    height: Math.max(GRAPH_VIEWBOX_HEIGHT, 720 + rows * 74),
  };
}

function isGraphOrphanNode(node: GraphNode): boolean {
  return node.type === "note" && (node.orphan === true || node.degree === 0);
}

function placeDenseGraphOrphans(
  positions: Map<string, GraphPoint>,
  nodes: GraphNode[],
  world: { width: number; height: number },
  centerY: number
): void {
  if (nodes.length === 0) {
    return;
  }

  const columns = Math.max(8, Math.floor((world.width - 180) / 126));
  const startX = (world.width - Math.min(nodes.length, columns) * 126) / 2 + 63;
  const startY = Math.min(world.height - 240, centerY + 360);
  placeNodesInGrid(positions, nodes, startX, startY, columns, 126, 74);
}

function placeNodesInGrid(
  positions: Map<string, GraphPoint>,
  nodes: GraphNode[],
  startX: number,
  startY: number,
  columns: number,
  columnGap: number,
  rowGap: number
): void {
  nodes
    .sort((left, right) => left.folderPath?.localeCompare(right.folderPath ?? "", "en") || left.label.localeCompare(right.label, "en"))
    .forEach((node, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      positions.set(node.id, {
        x: startX + column * columnGap + seededDirection(node.id, "orphan", "x") * 5,
        y: startY + row * rowGap + seededDirection(node.id, "orphan", "y") * 4,
      });
    });
}

function placeNodesOnRings(
  positions: Map<string, GraphPoint>,
  nodes: GraphNode[],
  centerX: number,
  centerY: number,
  baseRadius: number,
  radiusStep: number,
  maxPerRing: number,
  startAngle: number
): void {
  let index = 0;
  let ring = 0;

  while (index < nodes.length) {
    const radius = baseRadius + ring * radiusStep;
    const slice = nodes.slice(index, index + maxPerRing);
    slice.forEach((node, sliceIndex) => {
      const angle = startAngle + (Math.PI * 2 * sliceIndex) / Math.max(slice.length, 1) + ring * 0.18;
      positions.set(node.id, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    });

    index += maxPerRing;
    ring += 1;
  }
}

function getGraphLayoutBounds(
  positions: Map<string, GraphPoint>,
  snapshot: GraphSnapshot
): GraphLayoutBounds {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  positions.forEach((position, nodeId) => {
    const node = nodeById.get(nodeId);
    const radius = node ? getGraphNodeRadius(node, snapshot) + 22 : 24;
    minX = Math.min(minX, position.x - radius);
    maxX = Math.max(maxX, position.x + radius);
    minY = Math.min(minY, position.y - radius);
    maxY = Math.max(maxY, position.y + radius + 16);
  });

  return { minX, maxX, minY, maxY };
}

function isValidGraphBounds(bounds: GraphLayoutBounds): boolean {
  return Number.isFinite(bounds.minX)
    && Number.isFinite(bounds.maxX)
    && Number.isFinite(bounds.minY)
    && Number.isFinite(bounds.maxY)
    && bounds.maxX > bounds.minX
    && bounds.maxY > bounds.minY;
}

function getGraphLayoutCacheKey(
  snapshot: GraphSnapshot,
  selectedNoteId: string | null,
  mode: GraphMode
): string {
  const nodeKey = snapshot.nodes
    .map((node) => `${node.id}:${node.type}:${node.degree}:${node.size}:${node.orphan ? "o" : ""}`)
    .join("|");
  const edgeKey = snapshot.edges.map((edge) => `${edge.id}:${edge.weight}`).join("|");
  return [
    mode,
    selectedNoteId ?? "",
    snapshot.nodes.length,
    snapshot.edges.length,
    snapshot.stats.noteCount,
    snapshot.stats.orphanNoteCount,
    nodeKey,
    edgeKey,
  ].join("::");
}

function shouldShowGraphLabel(
  node: GraphNode,
  snapshot: GraphSnapshot,
  layout: GraphLayoutResult,
  selectionHighlights: ReturnType<typeof getGraphSelectionHighlights>,
  pathHighlights: ReturnType<typeof getGraphPathHighlights>
): boolean {
  if (!layout.dense) {
    return true;
  }

  if (selectionHighlights.selectedNodeId === node.id || selectionHighlights.relatedNodeIds.has(node.id)) {
    return true;
  }

  if (node.noteId && (node.noteId === state.vault.selectedNoteId || pathHighlights.nodeIds.has(node.noteId))) {
    return true;
  }

  if (node.type === "tag") {
    return node.degree >= 2 || snapshot.stats.tagCount <= 8;
  }

  if (node.type === "dangling") {
    return false;
  }

  return node.degree > 0 || node.size >= Math.max(8, snapshot.stats.maxNodeSize - 2);
}

function applyGraphRepulsion(
  simPoints: Map<string, {
    x: number;
    y: number;
    vx: number;
    vy: number;
    fixed: boolean;
    targetX: number;
    targetY: number;
    radius: number;
    node: GraphNode;
  }>,
  strength: number
): void {
  const points = [...simPoints.values()];

  for (let index = 0; index < points.length; index += 1) {
    for (let inner = index + 1; inner < points.length; inner += 1) {
      const left = points[index];
      const right = points[inner];
      if (left.fixed && right.fixed) {
        continue;
      }

      let dx = right.x - left.x;
      let dy = right.y - left.y;
      let distanceSq = dx * dx + dy * dy;

      if (distanceSq < 1) {
        dx = seededDirection(left.node.id, right.node.id, "x");
        dy = seededDirection(left.node.id, right.node.id, "y");
        distanceSq = dx * dx + dy * dy;
      }

      const distance = Math.sqrt(distanceSq);
      const force = strength / distanceSq;
      const pushX = (dx / distance) * force;
      const pushY = (dy / distance) * force;

      if (!left.fixed) {
        left.vx -= pushX;
        left.vy -= pushY;
      }

      if (!right.fixed) {
        right.vx += pushX;
        right.vy += pushY;
      }
    }
  }
}

function applyGraphCollisions(
  simPoints: Map<string, {
    x: number;
    y: number;
    vx: number;
    vy: number;
    fixed: boolean;
    targetX: number;
    targetY: number;
    radius: number;
    node: GraphNode;
  }>
): void {
  const points = [...simPoints.values()];

  for (let index = 0; index < points.length; index += 1) {
    for (let inner = index + 1; inner < points.length; inner += 1) {
      const left = points[index];
      const right = points[inner];
      if (left.fixed && right.fixed) {
        continue;
      }

      let dx = right.x - left.x;
      let dy = right.y - left.y;
      let distance = Math.hypot(dx, dy);
      const minimum = left.radius + right.radius + (left.node.type === "note" && right.node.type === "note" ? 16 : 18);

      if (distance === 0) {
        dx = seededDirection(left.node.id, right.node.id, "x");
        dy = seededDirection(left.node.id, right.node.id, "y");
        distance = Math.hypot(dx, dy);
      }

      if (distance >= minimum) {
        continue;
      }

      const overlap = (minimum - distance) * 0.12;
      const pushX = (dx / distance) * overlap;
      const pushY = (dy / distance) * overlap;

      if (!left.fixed) {
        left.vx -= pushX;
        left.vy -= pushY;
      }

      if (!right.fixed) {
        right.vx += pushX;
        right.vy += pushY;
      }
    }
  }
}

function applyGraphEdgeSprings(
  simPoints: Map<string, {
    x: number;
    y: number;
    vx: number;
    vy: number;
    fixed: boolean;
    targetX: number;
    targetY: number;
    radius: number;
    node: GraphNode;
  }>,
  edges: GraphSnapshot["edges"]
): void {
  edges.forEach((edge) => {
    const source = simPoints.get(edge.source);
    const target = simPoints.get(edge.target);
    if (!source || !target) {
      return;
    }

    let dx = target.x - source.x;
    let dy = target.y - source.y;
    let distance = Math.hypot(dx, dy);
    if (distance === 0) {
      dx = seededDirection(source.node.id, target.node.id, "x");
      dy = seededDirection(source.node.id, target.node.id, "y");
      distance = Math.hypot(dx, dy);
    }

    const targetDistance = edge.kind === "tag"
      ? 96
      : source.node.type === "note" && target.node.type === "note"
        ? 128
        : 110;
    const spring = (distance - targetDistance) * 0.006 * Math.min(edge.weight, 3);
    const pullX = (dx / distance) * spring;
    const pullY = (dy / distance) * spring;

    if (!source.fixed) {
      source.vx += pullX;
      source.vy += pullY;
    }

    if (!target.fixed) {
      target.vx -= pullX;
      target.vy -= pullY;
    }
  });
}

function applyGraphAnchors(
  simPoints: Map<string, {
    x: number;
    y: number;
    vx: number;
    vy: number;
    fixed: boolean;
    targetX: number;
    targetY: number;
    radius: number;
    node: GraphNode;
  }>,
  mode: GraphMode,
  centerX: number,
  centerY: number,
  selectedNodeId: string | null
): void {
  simPoints.forEach((point, nodeId) => {
    if (point.fixed) {
      point.x = centerX;
      point.y = centerY;
      point.vx = 0;
      point.vy = 0;
      return;
    }

    const anchorStrength = point.node.type === "note"
      ? mode === "local" ? 0.012 : 0.009
      : point.node.type === "tag"
        ? 0.018
        : 0.02;
    point.vx += (point.targetX - point.x) * anchorStrength;
    point.vy += (point.targetY - point.y) * anchorStrength;

    if (selectedNodeId && nodeId !== selectedNodeId && point.node.type === "note") {
      const dx = point.x - centerX;
      const dy = point.y - centerY;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const desired = mode === "local" ? 150 : 240;
      const radialCorrection = (distance - desired) * 0.0022;
      point.vx -= (dx / distance) * radialCorrection;
      point.vy -= (dy / distance) * radialCorrection;
    }
  });
}

function integrateGraphPositions(
  simPoints: Map<string, {
    x: number;
    y: number;
    vx: number;
    vy: number;
    fixed: boolean;
    targetX: number;
    targetY: number;
    radius: number;
    node: GraphNode;
  }>,
  viewportWidth: number,
  viewportHeight: number
): void {
  simPoints.forEach((point) => {
    if (point.fixed) {
      return;
    }

    point.vx *= 0.82;
    point.vy *= 0.82;
    point.x += point.vx;
    point.y += point.vy;

    const margin = point.radius + 26;
    point.x = clamp(point.x, margin, viewportWidth - margin);
    point.y = clamp(point.y, margin, viewportHeight - margin);
  });
}

function seededDirection(leftId: string, rightId: string, axis: "x" | "y"): number {
  const seed = hashString(`${leftId}:${rightId}:${axis}`);
  const normalized = ((Math.abs(seed) % 2000) / 1000) - 1;
  return normalized === 0 ? 0.001 : normalized;
}

function getGraphNodeRadius(node: GraphNode, snapshot: GraphSnapshot | null = state.graph.snapshot): number {
  const dense = snapshot ? isDenseGraph(snapshot) : false;
  if (node.type === "note") {
    if (dense && isGraphOrphanNode(node)) {
      return 6;
    }

    const minRadius = dense ? 8 : 10;
    const maxRadius = dense ? 21 : 26;
    return Math.max(minRadius, Math.min(maxRadius, 8 + node.size * (dense ? 1.05 : 1.35)));
  }

  return node.type === "tag" ? dense ? 7 : 9 : dense ? 6 : 8;
}

function truncateLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function resetGraphViewport(): void {
  const layout = getGraphLayoutResult();
  if (!layout || !isValidGraphBounds(layout.bounds)) {
    state.graph.panX = 0;
    state.graph.panY = 0;
    state.graph.zoom = 1;
    return;
  }

  const padding = layout.dense ? 72 : 56;
  const contentWidth = Math.max(1, layout.bounds.maxX - layout.bounds.minX + padding * 2);
  const contentHeight = Math.max(1, layout.bounds.maxY - layout.bounds.minY + padding * 2);
  const fitZoom = Math.min(
    (GRAPH_VIEWBOX_WIDTH - padding) / contentWidth,
    (GRAPH_VIEWBOX_HEIGHT - padding) / contentHeight
  );
  state.graph.zoom = clamp(fitZoom, 0.18, layout.dense ? 0.92 : 1.1);
  centerGraphViewport();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getGraphPathHighlights(path: GraphPathResult | null): {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
} {
  if (!path?.found || path.nodes.length < 2) {
    return {
      nodeIds: new Set<string>(path?.nodes.map((node) => node.noteId) ?? []),
      edgeIds: new Set<string>(),
    };
  }

  const nodeIds = new Set<string>(path.nodes.map((node) => node.noteId));
  const edgeIds = new Set<string>();

  for (let index = 0; index < path.nodes.length - 1; index += 1) {
    const source = path.nodes[index];
    const target = path.nodes[index + 1];
    edgeIds.add(`wikilink:${source.noteId}->${target.noteId}`);
    edgeIds.add(`wikilink:${target.noteId}->${source.noteId}`);
  }

  return { nodeIds, edgeIds };
}

function getGraphColorState(): {
  nodeColors: Map<string, { fill: string; stroke: string }>;
  items: Array<{ key: string; label: string; color: string; count: number }>;
} | null {
  const snapshot = state.graph.snapshot;
  if (!snapshot || state.graph.colorMode === "none") {
    return null;
  }

  const noteNodes = snapshot.nodes.filter((node) => node.type === "note");
  if (noteNodes.length === 0) {
    return null;
  }

  const groups = new Map<string, { label: string; noteIds: string[] }>();

  if (state.graph.colorMode === "folder") {
    noteNodes.forEach((node) => {
      const key = node.folderPath || "root";
      const group = groups.get(key) ?? { label: node.folderPath || getRootLabel(), noteIds: [] };
      group.noteIds.push(node.noteId ?? node.id);
      groups.set(key, group);
    });
  } else if (state.graph.colorMode === "tag") {
    noteNodes.forEach((node) => {
      const note = state.vault.notes.find((item) => item.id === (node.noteId ?? ""));
      const tags = note ? getNoteTags(note) : [];
      const key = tags[0] ?? "__untagged__";
      const label = tags[0] ? `#${tags[0]}` : t("graph.untagged");
      const group = groups.get(key) ?? { label, noteIds: [] };
      group.noteIds.push(node.noteId ?? node.id);
      groups.set(key, group);
    });
  } else if (state.graph.colorMode === "cluster") {
    const clusterByNoteId = new Map<string, GraphCluster>();
    state.graph.clusters.forEach((cluster) => {
      cluster.noteIds.forEach((noteId) => {
        clusterByNoteId.set(noteId, cluster);
      });
    });

    noteNodes.forEach((node) => {
      const noteId = node.noteId ?? node.id;
      const cluster = clusterByNoteId.get(noteId);
      const key = cluster?.id ?? "__isolated__";
      const label = cluster ? t("graph.clusterLabel", { size: cluster.size }) : t("graph.unclustered");
      const group = groups.get(key) ?? { label, noteIds: [] };
      group.noteIds.push(noteId);
      groups.set(key, group);
    });
  }

  const sortedGroups = [...groups.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => right.noteIds.length - left.noteIds.length || left.label.localeCompare(right.label, "en"));

  const nodeColors = new Map<string, { fill: string; stroke: string }>();
  const items = sortedGroups.map((group) => {
    const color = getGraphPaletteColor(group.key);
    group.noteIds.forEach((noteId) => {
      nodeColors.set(noteId, {
        fill: color,
        stroke: colorToStroke(color),
      });
    });

    return {
      key: group.key,
      label: group.label,
      color,
      count: group.noteIds.length,
    };
  });

  if (state.graph.colorMode === "tag") {
    snapshot.nodes
      .filter((node) => node.type === "tag" && node.tag)
      .forEach((node) => {
        const color = getGraphPaletteColor(node.tag ?? node.id);
        nodeColors.set(node.id, {
          fill: color,
          stroke: colorToStroke(color),
        });
      });
  }

  return { nodeColors, items };
}

function getGraphPaletteColor(key: string): string {
  const palette = [
    "#ef8c42",
    "#63a4ff",
    "#86c66b",
    "#f4c95d",
    "#e07a7a",
    "#8d7cf0",
    "#57c3b5",
    "#d889d0",
  ];
  const index = Math.abs(hashString(key)) % palette.length;
  return palette[index];
}

function colorToStroke(fill: string): string {
  return fill;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const block: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].startsWith("```")) {
        block.push(lines[index]);
        index += 1;
      }

      index += 1;
      html.push(
        `<pre><code class="language-${escapeHtml(language)}">${escapeHtml(block.join("\n"))}</code></pre>`
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      html.push(`<blockquote>${quote.map(renderInline).join("<br />")}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+\[[ xX]\]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+\[[ xX]\]\s+/.test(lines[index])) {
        const match = lines[index].match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
        if (!match) {
          index += 1;
          continue;
        }

        const [, mark, content] = match;
        items.push(
          `<li><input type="checkbox" disabled ${mark.toLowerCase() === "x" ? "checked" : ""} /><span>${renderInline(content)}</span></li>`
        );
        index += 1;
      }
      html.push(`<ul class="task-list">${items.join("")}</ul>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(`<li>${renderInline(lines[index].replace(/^\s*[-*]\s+/, ""))}</li>`);
        index += 1;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(`<li>${renderInline(lines[index].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        index += 1;
      }
      html.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return html.join("");
}

function startsBlock(line: string): boolean {
  return /^(#{1,4})\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\s*[-*]\s+\[[ xX]\]\s+/.test(line) ||
    line.startsWith("```");
}

function renderInline(text: string): string {
  let html = escapeHtml(text);

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[\[([^[\]]+)\]\]/g, (_, title: string) => {
    return `<button class="wikilink" data-wikilink="${escapeAttribute(title)}">${escapeHtml(title)}</button>`;
  });
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, href: string) => {
    const safeHref = sanitizeUrl(href);
    return safeHref
      ? `<a href="${safeHref}" target="_blank" rel="noreferrer">${label}</a>`
      : label;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");

  return html;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return value.replaceAll('"', "&quot;");
}

function sanitizeUrl(value: string): string {
  const trimmed = value.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) {
    return escapeAttribute(trimmed);
  }

  return "";
}

function excerpt(content: string): string {
  return content.replace(/\n+/g, " ").replace(/[#>*`\-[\]]/g, "").trim().slice(0, 88) || t("note.emptyExcerpt");
}

function countWords(content: string): number {
  const words = content.trim().match(/\S+/g);
  return words ? words.length : 0;
}

function countCharacters(content: string): number {
  return content.length;
}

function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat(state.locale === "ru" ? "ru-RU" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}
