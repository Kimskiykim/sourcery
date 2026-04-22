import { ObsidianAppClient, RequestError } from "./compat/obsidian/app.js";
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
import type { WorkspaceFolder, WorkspaceNote } from "./core/workspace/types.js";
import { HttpWorkspaceClient } from "./core/workspace/http-workspace-client.js";
import { matchesNoteQuery } from "./core/wiki/query.js";

type ViewMode = "split" | "editor" | "preview" | "graph";
type NoteViewMode = Exclude<ViewMode, "graph">;
type FolderVisibilityMode = "all" | "selected";
type GraphMode = "global" | "local";
type GraphColorMode = "none" | "folder" | "tag" | "cluster";

interface Note extends WorkspaceNote {
  draftTitle?: string;
}

interface WorkspaceTab {
  noteId: string;
  pinned: boolean;
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

interface State {
  vault: Vault;
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
  workspaceTabList: HTMLElement;
  workspaceActiveTabState: HTMLElement;
  workspaceViewBadge: HTMLElement;
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
  graphColorMode: HTMLSelectElement;
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
const DEFAULT_EXPLORER_WIDTH = 292;
const MIN_EXPLORER_WIDTH = 248;
const MAX_EXPLORER_WIDTH = 420;
const EXPLORER_WIDTH_STORAGE_KEY = "sourcery:explorer-width";
const EXPLORER_COLLAPSED_STORAGE_KEY = "sourcery:explorer-collapsed";
const workspaceClient = new HttpWorkspaceClient();
const obsidianApp = new ObsidianAppClient(workspaceClient);

const state: State = {
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
    mode: "global",
    folderScoped: false,
    existingFilesOnly: false,
    colorMode: "none",
    sidebarCollapsed: false,
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
  workspaceTabList: query<HTMLElement>("#workspace-tab-list"),
  workspaceActiveTabState: query<HTMLElement>("#workspace-active-tab-state"),
  workspaceViewBadge: query<HTMLElement>("#workspace-view-badge"),
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
  graphColorMode: query<HTMLSelectElement>("#graph-color-mode"),
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
let explorerContextMenuTarget:
  | { type: "note"; noteId: string }
  | { type: "folder"; folderPath: string }
  | null = null;

void bootstrap();

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

async function bootstrap(): Promise<void> {
  hydrateShellPreferences();
  bindEvents();
  applyShellLayout();
  setStatus("Загрузка vault...");
  await reloadVault();
  startWorkspacePolling();
}

function bindEvents(): void {
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

  elements.graphColorMode.addEventListener("change", () => {
    if (!isGraphColorMode(elements.graphColorMode.value)) {
      return;
    }

    state.graph.colorMode = elements.graphColorMode.value;
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

      state.view = mode;
      rememberNoteView(mode);
      renderView();
      if (state.view === "graph") {
        void ensureGraphData(true);
      }
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

    state.graph.panX += (deltaX * GRAPH_VIEWBOX_WIDTH) / rect.width;
    state.graph.panY += (deltaY * GRAPH_VIEWBOX_HEIGHT) / rect.height;
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

  elements.graphCanvas.addEventListener("wheel", (event: WheelEvent) => {
    event.preventDefault();
    closeGraphNodeMenu();
    const direction = event.deltaY > 0 ? -1 : 1;
    const nextZoom = clamp(state.graph.zoom + direction * 0.12, 0.45, 2.6);
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

    if (event.key === "Escape") {
      closeGraphNodeMenu();
      closeExplorerContextMenu();
    }

    const meta = event.metaKey || event.ctrlKey;

    if (meta && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void flushPendingSave({ flash: true });
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
  elements.toggleExplorerButton.title = state.shell.explorerCollapsed ? "Expand explorer" : "Collapse explorer";
  elements.toggleExplorerButton.setAttribute(
    "aria-label",
    state.shell.explorerCollapsed ? "Expand explorer" : "Collapse explorer"
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
    <button type="button" class="graph-node-menu__item" data-graph-menu-action="open">Open</button>
    <button type="button" class="graph-node-menu__item" data-graph-menu-action="reveal">Reveal in list</button>
    <button type="button" class="graph-node-menu__item" data-graph-menu-action="copy">Copy wikilink</button>
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
      <button type="button" class="graph-node-menu__item" data-explorer-menu-action="copy">Копировать</button>
      <button type="button" class="graph-node-menu__item" data-explorer-menu-action="rename">Переименовать</button>
      <button type="button" class="graph-node-menu__item" data-explorer-menu-action="delete">Удалить</button>
    `;
  } else {
    const label = target.folderPath || "Root";
    elements.explorerContextMenu.innerHTML = `
      <div class="graph-node-menu__title">${escapeHtml(label)}</div>
      <button type="button" class="graph-node-menu__item" data-explorer-menu-action="copy">Копировать</button>
      <button type="button" class="graph-node-menu__item" data-explorer-menu-action="rename">Переименовать</button>
      <button type="button" class="graph-node-menu__item" data-explorer-menu-action="delete">Удалить</button>
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
    await copyTextToClipboard(target.folderPath || "Root", `Скопировано: ${target.folderPath || "Root"}`);
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

  flashStatus(`Показано в списке: ${getDisplayTitle(note)}`);
}

async function copyGraphNodeWikilink(noteId: string): Promise<void> {
  const note = state.vault.notes.find((item) => item.id === noteId);
  if (!note) {
    return;
  }

  try {
    await copyTextToClipboard(`[[${getDisplayTitle(note)}]]`, `Скопировано: [[${getDisplayTitle(note)}]]`);
  } catch (error) {
    console.error(error);
    flashStatus("Не удалось скопировать wikilink");
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
  elements.confirmDialogConfirm.textContent = options.confirmLabel ?? "Удалить";
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
  return value === "split" || value === "editor" || value === "preview" || value === "graph";
}

function isGraphColorMode(value: string | undefined): value is GraphColorMode {
  return value === "none" || value === "folder" || value === "tag" || value === "cluster";
}

function getViewModeLabel(view: ViewMode): string {
  if (view === "split") {
    return "Split";
  }

  if (view === "editor") {
    return "Editor";
  }

  if (view === "preview") {
    return "Preview";
  }

  return "Graph";
}

async function handleRefreshVault(): Promise<void> {
  commitCurrentTitleDraft();
  const saved = await flushPendingSave();
  if (!saved) {
    return;
  }
  setStatus("Обновление vault...");
  await reloadVault(state.vault.selectedNoteId);
  flashStatus("Синхронизировано");
}

async function reloadVault(preferredNoteId: string | null = state.vault.selectedNoteId): Promise<void> {
  try {
    const [snapshot, folders] = await Promise.all([
      obsidianApp.sync(preferredNoteId),
      workspaceClient.listFolders(),
    ]);
    state.vault.notes = snapshot.notes;
    state.vault.folders = folders;
    state.vault.selectedNoteId = snapshot.activeNoteId;
    await hydrateWorkspaceTabs(snapshot.activeNoteId);
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
    render();
    flashStatus("Ошибка загрузки");
  }
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
    const baseTitle = title.trim() || "Untitled";
    const note = await api.createNote({
      title: baseTitle,
      content: title ? `# ${baseTitle}\n` : "",
      folderPath: state.vault.selectedFolderPath,
    });

    state.vault.notes.unshift({
      ...note,
      draftTitle: title ? undefined : "",
    });
    await syncWorkspaceTabOpen(note.id);
    state.vault.selectedNoteId = note.id;
    syncSelectedFolderWithSelectedNote();
    render();
    flashStatus("Создан markdown-файл");
  } catch (error) {
    console.error(error);
    flashStatus(getErrorMessage(error, "Ошибка создания"));
  }
}

async function handleCreateFolder(): Promise<void> {
  const suggestedPath = state.vault.selectedFolderPath ? `${state.vault.selectedFolderPath}/` : "";
  const nextPath = window.prompt("Путь новой папки", suggestedPath)?.trim();
  if (!nextPath) {
    return;
  }

  try {
    const folder = await workspaceClient.createFolder({ path: nextPath });
    state.vault.folders = await workspaceClient.listFolders();
    state.vault.selectedFolderPath = folder.path;
    expandFolderAncestors(folder.path);
    render();
    flashStatus(`Папка создана: ${folder.path}`);
  } catch (error) {
    console.error(error);
    flashStatus("Ошибка создания папки");
  }
}

async function handleRenameSelectedFolder(): Promise<void> {
  const currentPath = state.vault.selectedFolderPath;
  if (!currentPath) {
    return;
  }

  const nextPath = window.prompt("Новый путь папки", currentPath)?.trim();
  if (!nextPath || nextPath === currentPath) {
    return;
  }

  const preferredNoteId = remapNoteIdForFolderChange(state.vault.selectedNoteId, currentPath, nextPath);

  try {
    setStatus("Переименование папки...");
    await workspaceClient.renameFolder(currentPath, { nextPath });
    remapFolderState(currentPath, nextPath);
    await reloadVault(preferredNoteId);
    flashStatus(`Папка переименована: ${nextPath}`);
  } catch (error) {
    console.error(error);
    flashStatus(getErrorMessage(error, "Ошибка переименования папки"));
  }
}

async function handleDeleteSelectedFolder(): Promise<void> {
  const currentPath = state.vault.selectedFolderPath;
  if (!currentPath) {
    return;
  }

  if (!isSelectedFolderDeletable()) {
    flashStatus("Удаляются только пустые папки");
    return;
  }

  const confirmed = await confirmAction({
    title: "Удалить папку?",
    description: `Папка "${currentPath}" будет удалена. Это действие нельзя отменить.`,
  });
  if (!confirmed) {
    return;
  }

  try {
    setStatus("Удаление папки...");
    await workspaceClient.deleteFolder(currentPath);
    state.vault.selectedFolderPath = getParentFolderPath(currentPath);
    state.vault.collapsedFolderPaths = state.vault.collapsedFolderPaths
      .filter((item) => item !== getFolderCollapseKey(currentPath));
    await reloadVault(state.vault.selectedNoteId);
    flashStatus(`Папка удалена: ${currentPath}`);
  } catch (error) {
    console.error(error);
    flashStatus(getErrorMessage(error, "Ошибка удаления папки"));
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
    setStatus("Перемещение...");
    const moved = await api.updateNote(note.id, {
      title: getPersistableTitle(note),
      content: note.content,
      folderPath: nextFolderPath,
    });
    state.vault.selectedFolderPath = moved.folderPath;
    expandFolderAncestors(moved.folderPath);
    replaceNote(note.id, moved);
    flashStatus(moved.folderPath ? `Перемещено в ${moved.folderPath}` : "Перемещено в Root");
  } catch (error) {
    console.error(error);
    flashStatus(getErrorMessage(error, "Ошибка перемещения"));
    renderWorkspace(false);
  }
}

async function handlePromptMoveSelectedNote(): Promise<void> {
  const note = getSelectedNote();
  if (!note) {
    return;
  }

  const nextFolderPath = window.prompt(
    "Куда переместить заметку",
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
    title: "Удалить заметку?",
    description: `Заметка "${getDisplayTitle(note)}" будет удалена из vault. Это действие нельзя отменить.`,
  });
  if (!confirmed) {
    return;
  }

  try {
    const fallbackNoteId = getWorkspaceTabFallbackNoteId(note.id) ?? note.id;
    await api.deleteNote(note.id);
    state.vault.notes = state.vault.notes.filter((item) => item.id !== note.id);
    await hydrateWorkspaceTabs(fallbackNoteId);
    removeWorkspaceTabReference(note.id, fallbackNoteId);
    syncSelectedNoteFromTabs(fallbackNoteId);
    render();
    flashStatus("Файл удалён");
  } catch (error) {
    console.error(error);
    flashStatus("Ошибка удаления");
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
  renderView();
  renderWorkspaceTabs();
  renderFolderControls();
  renderFolderList();
  renderNoteList();
  renderWorkspace();
  renderGraphNodeMenu();

  if (state.view === "graph") {
    renderGraphView();
    void ensureGraphData();
  } else {
    closeGraphNodeMenu();
  }
}

function renderView(): void {
  elements.editorLayout.dataset.view = state.view;
  elements.graphPane.hidden = state.view !== "graph";
  elements.workspaceViewBadge.textContent = getViewModeLabel(state.view);
  elements.viewButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
}

function rememberNoteView(mode: ViewMode): void {
  if (mode !== "graph") {
    state.shell.lastNoteView = mode;
  }
}

function getLastNoteView(): NoteViewMode {
  return state.shell.lastNoteView;
}

function renderGraphView(): void {
  syncGraphPathSelection();
  elements.graphPane.dataset.sidebarCollapsed = String(state.graph.sidebarCollapsed);
  elements.graphGlobalButton.classList.toggle("is-active", state.graph.mode === "global");
  elements.graphLocalButton.classList.toggle("is-active", state.graph.mode === "local");
  elements.graphColorMode.value = state.graph.colorMode;
  elements.graphFolderScopeButton.classList.toggle("is-active", state.graph.folderScoped);
  elements.graphExistingOnlyButton.classList.toggle("is-active", state.graph.existingFilesOnly);
  elements.graphToggleSidebarButton.classList.toggle("is-active", state.graph.sidebarCollapsed);
  elements.graphToggleSidebarButton.textContent = state.graph.sidebarCollapsed ? "Show panel" : "Hide panel";
  elements.graphLocalButton.disabled = state.vault.selectedNoteId === null;
  elements.graphPathFindButton.disabled = !state.graph.pathFromNoteId || !state.graph.pathToNoteId;

  renderGraphStats();
  renderGraphLegend();
  renderGraphCanvas();
  renderGraphPathControls();
  renderGraphPathResult();
  renderGraphInsightList(elements.graphTopLinked, state.graph.topLinked, "Нет ranked notes");
  renderGraphInsightList(elements.graphHubs, state.graph.hubs, "Нет hub notes");
  renderGraphInsightList(elements.graphBridges, state.graph.bridges, "Нет bridge notes");
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
    state.graph.error = "Выберите заметку для local graph";
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
    state.graph.error = "Ошибка загрузки graph view";
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
    elements.graphStats.innerHTML = `<span class="graph-stat">Loading graph…</span>`;
    return;
  }

  if (!state.graph.snapshot) {
    elements.graphStats.innerHTML = "";
    return;
  }

  const stats = state.graph.snapshot.stats;
  const modeLabel = state.graph.mode === "local" ? "Local graph" : "Global graph";
  const scopeLabel = state.graph.folderScoped
    ? state.vault.selectedFolderPath || "Root scope"
    : "Whole vault";

  elements.graphStats.innerHTML = [
    modeLabel,
    scopeLabel,
    `${stats.noteCount} notes`,
    `${stats.edgeCount} edges`,
    `${stats.tagCount} tags`,
    `${stats.danglingCount} dangling`,
    `${stats.orphanNoteCount} orphans`,
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
    elements.graphEmptyState.hidden = false;
    elements.graphEmptyState.textContent = state.graph.error ?? "Graph loading not started";
    return;
  }

  if (state.graph.loading && snapshot.nodes.length === 0) {
    elements.graphEmptyState.hidden = false;
    elements.graphEmptyState.textContent = "Loading graph…";
    return;
  }

  if (snapshot.nodes.length === 0) {
    elements.graphEmptyState.hidden = false;
    elements.graphEmptyState.textContent = state.graph.error ?? "Нет graph данных для текущего scope";
    return;
  }

  elements.graphEmptyState.hidden = true;
  const positions = getGraphLayoutPositions();
  if (!positions) {
    elements.graphEmptyState.hidden = false;
    elements.graphEmptyState.textContent = state.graph.error ?? "Graph loading not started";
    return;
  }

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
      if (node.noteId) {
        void openNote(node.noteId, { nextView: getLastNoteView() });
        return;
      }

      if (node.tag) {
        applyTagFilter(node.tag);
        return;
      }

      if (node.type === "dangling") {
        flashStatus(`Нет заметки для [[${node.label}]]`);
      }
    });

    const circle = document.createElementNS(namespace, "circle");
    circle.setAttribute("r", String(getGraphNodeRadius(node)));
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
      ].filter(Boolean).join(" ")
    );
    group.append(circle);

    const label = document.createElementNS(namespace, "text");
    label.setAttribute("y", String(getGraphNodeRadius(node) + 16));
    label.setAttribute("class", `graph-label${node.type === "dangling" ? " graph-label--muted" : ""}`);
    label.textContent = truncateLabel(node.type === "tag" ? `#${node.tag ?? node.label}` : node.label, 16);
    group.append(label);

    viewport.append(group);
  });

  svg.append(viewport);
}

function getGraphLayoutPositions(): Map<string, { x: number; y: number }> | null {
  if (!state.graph.snapshot) {
    return null;
  }

  return buildGraphLayout(state.graph.snapshot, state.vault.selectedNoteId, state.graph.mode);
}

function centerGraphViewport(): void {
  const positions = getGraphLayoutPositions();
  if (!positions || positions.size === 0) {
    resetGraphViewport();
    return;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  positions.forEach((position) => {
    minX = Math.min(minX, position.x);
    maxX = Math.max(maxX, position.x);
    minY = Math.min(minY, position.y);
    maxY = Math.max(maxY, position.y);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    resetGraphViewport();
    return;
  }

  const contentCenterX = (minX + maxX) / 2;
  const contentCenterY = (minY + maxY) / 2;
  const viewportCenterX = GRAPH_VIEWBOX_WIDTH / 2;
  const viewportCenterY = GRAPH_VIEWBOX_HEIGHT / 2;

  state.graph.panX = viewportCenterX - contentCenterX * state.graph.zoom;
  state.graph.panY = viewportCenterY - contentCenterY * state.graph.zoom;
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
        ? `${item.disconnectedGroups} cuts · ${item.neighborCount} neighbors`
        : `${item.inboundLinks} in · ${item.outboundLinks} out · ${item.neighborCount} neighbors`;
      return `
        <button type="button" class="graph-insight-item" data-note-id="${escapeAttribute(item.noteId)}">
          <p class="graph-insight-item__title">${escapeHtml(item.title)}</p>
          <p class="graph-insight-item__meta">${escapeHtml(item.folderPath || "Root")} · score ${item.score}</p>
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

  const placeholder = `<option value="">Select note</option>`;
  elements.graphPathFrom.innerHTML = placeholder + options;
  elements.graphPathTo.innerHTML = placeholder + options;
  elements.graphPathFrom.value = state.graph.pathFromNoteId ?? "";
  elements.graphPathTo.value = state.graph.pathToNoteId ?? "";
}

function renderGraphPathResult(): void {
  if (state.graph.pathLoading) {
    elements.graphPathResult.innerHTML = `<p class="graph-empty-list">Finding path…</p>`;
    return;
  }

  if (state.graph.pathError) {
    elements.graphPathResult.innerHTML = `<p class="graph-empty-list">${escapeHtml(state.graph.pathError)}</p>`;
    return;
  }

  if (!state.graph.path) {
    elements.graphPathResult.innerHTML = `<p class="graph-empty-list">Choose two notes to inspect graph path</p>`;
    return;
  }

  if (!state.graph.path.found) {
    elements.graphPathResult.innerHTML = `<p class="graph-empty-list">No path found in current graph scope</p>`;
    return;
  }

  const summary = `<p class="graph-empty-list">Distance ${state.graph.path.distance}</p>`;
  const steps = state.graph.path.nodes
    .map((item, index) => `
      <button type="button" class="graph-insight-item${index === 0 ? " is-path-start" : ""}" data-note-id="${escapeAttribute(item.noteId)}">
        <p class="graph-insight-item__title">${escapeHtml(item.title)}</p>
        <p class="graph-insight-item__meta">${escapeHtml(item.folderPath || "Root")} · step ${index + 1}</p>
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
    state.graph.pathError = "Ошибка поиска пути";
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

  if (state.graph.folderScoped && state.vault.selectedFolderPath) {
    params.set("folderPath", state.vault.selectedFolderPath);
  }

  return {
    key: `${state.graph.pathFromNoteId}|${state.graph.pathToNoteId}|${state.graph.folderScoped ? state.vault.selectedFolderPath : ""}`,
    url: `/api/graph/path?${params.toString()}`,
  };
}

function renderGraphBrokenLinks(): void {
  if (state.graph.brokenLinks.length === 0) {
    elements.graphBrokenLinks.innerHTML = `<p class="graph-empty-list">Нет broken links</p>`;
    return;
  }

  elements.graphBrokenLinks.innerHTML = state.graph.brokenLinks
    .map((item) => `
      <button type="button" class="graph-insight-item graph-insight-item--warning" data-note-id="${escapeAttribute(item.sourceNoteId)}">
        <p class="graph-insight-item__title">${escapeHtml(item.linkText)}</p>
        <p class="graph-insight-item__meta">${escapeHtml(item.sourceTitle)} · ${escapeHtml(item.sourceFolderPath || "Root")}</p>
        <p class="graph-insight-item__meta">${item.occurrences} unresolved link${item.occurrences > 1 ? "s" : ""}</p>
      </button>
    `)
    .join("");
}

function renderGraphOrphans(): void {
  if (state.graph.orphans.length === 0) {
    elements.graphOrphans.innerHTML = `<p class="graph-empty-list">Нет orphan notes</p>`;
    return;
  }

  elements.graphOrphans.innerHTML = state.graph.orphans
    .map((item) => `
      <button type="button" class="graph-insight-item" data-note-id="${escapeAttribute(item.id)}">
        <p class="graph-insight-item__title">${escapeHtml(item.title)}</p>
        <p class="graph-insight-item__meta">${escapeHtml(item.folderPath || "Root")}</p>
        <p class="graph-insight-item__meta">No note-to-note links</p>
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
      <p class="note-list__title">Нет заметок</p>
      <p class="note-list__excerpt">Создайте markdown-заметку, и она появится здесь.</p>
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
  elements.folderSelectionPath.textContent = selectedFolderPath || "Root";

  const isRoot = selectedFolderPath === "";
  const deleteHint = isRoot
    ? "Root нельзя удалить"
    : isSelectedFolderDeletable()
      ? `Удалить пустую папку ${selectedFolderPath}`
      : "Удаляются только пустые папки без вложенных папок и заметок";

  elements.renameFolderButton.disabled = isRoot;
  elements.renameFolderButton.title = isRoot
    ? "Root нельзя переименовать"
    : `Переименовать ${selectedFolderPath}`;
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
      <span class="folder-list__label">Root</span>
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
  const activeNote = activeTab ? findNoteById(activeTab.noteId) : selectedNote;

  elements.workspaceViewBadge.textContent = getViewModeLabel(state.view);

  if (!activeNote) {
    elements.workspaceActiveTabState.textContent = "No active note";
  } else if (activeTab) {
    const folderLabel = activeNote.folderPath || "Root";
    elements.workspaceActiveTabState.innerHTML = `
      <span class="workspace-tabs__active-title">${escapeHtml(getDisplayTitle(activeNote))}</span>
      <span class="workspace-tabs__active-path">${escapeHtml(folderLabel)}</span>
    `;
  } else {
    const folderLabel = activeNote.folderPath || "Root";
    elements.workspaceActiveTabState.innerHTML = `
      <span class="workspace-tabs__active-title">${escapeHtml(getDisplayTitle(activeNote))}</span>
      <span class="workspace-tabs__active-path">Current note · ${escapeHtml(folderLabel)}</span>
    `;
  }

  if (tabs.length === 0) {
    elements.workspaceTabList.innerHTML = `
      <div class="workspace-tabs__empty">
        <span>No tabs yet</span>
        <span>Open the current note to pin it into the workspace strip.</span>
      </div>
    `;
    return;
  }

  elements.workspaceTabList.innerHTML = tabs
    .map((tab) => {
      const note = findNoteById(tab.noteId);
      if (!note) {
        return "";
      }

      const isActive = tab.noteId === state.tabs.activeTabId;
      const isDirty = isWorkspaceTabDirty(tab.noteId);
      return `
        <div
          class="workspace-note-tab${isActive ? " is-active" : ""}${tab.pinned ? " is-pinned" : ""}"
          data-workspace-tab-id="${escapeAttribute(tab.noteId)}"
          draggable="true"
        >
          <button
            type="button"
            class="workspace-note-tab__button"
            data-workspace-tab-activate="${escapeAttribute(tab.noteId)}"
            title="${escapeAttribute(getDisplayTitle(note))}"
          >
            <span class="workspace-note-tab__pin-mark" aria-hidden="true">${tab.pinned ? "●" : ""}</span>
            <span class="workspace-note-tab__title">${escapeHtml(getDisplayTitle(note))}</span>
            <span class="workspace-note-tab__dirty${isDirty ? " is-visible" : ""}" aria-hidden="true"></span>
          </button>
          <div class="workspace-note-tab__actions">
            <button
              type="button"
              class="workspace-note-tab__icon"
              data-workspace-tab-pin="${escapeAttribute(tab.noteId)}"
              aria-label="${tab.pinned ? "Unpin tab" : "Pin tab"}"
              title="${tab.pinned ? "Unpin tab" : "Pin tab"}"
            >
              ${tab.pinned ? "★" : "☆"}
            </button>
            <button
              type="button"
              class="workspace-note-tab__icon"
              data-workspace-tab-close="${escapeAttribute(tab.noteId)}"
              aria-label="Close tab"
              title="Close tab"
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
    elements.noteFolderSelect.innerHTML = `<option value="">Root</option>`;
    elements.noteFolderSelect.value = "";
    elements.notePathBadge.textContent = "Root";
    elements.noteEditor.value = "";
    elements.noteTitle.disabled = true;
    elements.noteFolderSelect.disabled = true;
    elements.noteMoveButton.disabled = true;
    elements.noteEditor.disabled = true;
    elements.deleteButton.disabled = true;
    hideTitleHint();
    hideTags();
    hideBacklinks();
    elements.notePreview.innerHTML = "";
    elements.notePreview.append(template);
    elements.noteMeta.textContent = "0 слов";
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
  elements.notePathBadge.textContent = note.folderPath || "Root";
  renderNoteTags(note);
  renderBacklinks(note);
  elements.notePreview.innerHTML = renderMarkdown(note.content);
  elements.noteMeta.textContent = `${note.folderPath || "Root"} · ${countWords(note.content)} слов · ${countCharacters(note.content)} символов`;
}

function updateNoteTitle(nextTitle: string): void {
  const note = getSelectedNote();
  if (!note) {
    return;
  }

  note.draftTitle = nextTitle;
  setStatus("Есть несохранённые изменения");
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

async function openNote(
  noteId: string,
  options: { nextView?: ViewMode } = {}
): Promise<void> {
  if (noteId === state.vault.selectedNoteId && !options.nextView && state.tabs.activeTabId === noteId) {
    return;
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
  await syncWorkspaceTabOpen(noteId);
  state.vault.selectedNoteId = noteId;
  syncSelectedFolderWithSelectedNote();
  render();
}

function queueSave(noteId: string, delayMs = SAVE_DEBOUNCE_MS): void {
  pendingSaveNoteId = noteId;
  setStatus("Есть несохранённые изменения");

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
      flashStatus("Сохранено");
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
      setStatus("Сохранение...");
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
        flashStatus("Сохранено в vault");
      } else {
        setStatus(getBaseStatusLabel());
      }
      await maybeReloadAfterExternalChanges();
      return true;
    } catch (error) {
      console.error(error);
      pendingSaveNoteId = noteId;
      flashStatus(getErrorMessage(error, "Ошибка сохранения"));
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
  return state.tabs.tabs.filter((tab) => findNoteById(tab.noteId) !== null);
}

function getActiveWorkspaceTab(): WorkspaceTab | null {
  return state.tabs.tabs.find((tab) => tab.noteId === state.tabs.activeTabId) ?? null;
}

function findNoteById(noteId: string): Note | null {
  return state.vault.notes.find((note) => note.id === noteId) ?? null;
}

function isWorkspaceTabOpen(noteId: string): boolean {
  return state.tabs.tabs.some((tab) => tab.noteId === noteId);
}

function ensureWorkspaceTab(noteId: string): void {
  if (!findNoteById(noteId)) {
    return;
  }

  if (!isWorkspaceTabOpen(noteId)) {
    state.tabs.tabs = [...state.tabs.tabs, { noteId, pinned: false }];
  }

  state.tabs.activeTabId = noteId;
}

async function activateWorkspaceTab(noteId: string): Promise<void> {
  if (!findNoteById(noteId)) {
    return;
  }

  commitCurrentTitleDraft();
  const saved = await flushPendingSave();
  if (!saved) {
    return;
  }

  try {
    applyWorkspaceTabsSnapshot(await api.activateWorkspaceTab(noteId));
  } catch (error) {
    console.error(error);
    state.tabs.activeTabId = noteId;
  }
  syncSelectedNoteFromTabs(noteId);
  render();
}

async function toggleWorkspaceTabPin(noteId: string): Promise<void> {
  const tab = state.tabs.tabs.find((item) => item.noteId === noteId);
  const nextPinned = !(tab?.pinned ?? false);

  try {
    applyWorkspaceTabsSnapshot(await api.setWorkspaceTabPinned(noteId, nextPinned));
  } catch (error) {
    console.error(error);
    state.tabs.tabs = state.tabs.tabs.map((item) =>
      item.noteId === noteId
        ? { ...item, pinned: nextPinned }
        : item
    );
  }

  renderWorkspaceTabs();
}

async function closeWorkspaceTab(noteId: string): Promise<void> {
  const fallbackNoteId = getWorkspaceTabFallbackNoteId(noteId);

  try {
    applyWorkspaceTabsSnapshot(await api.closeWorkspaceTab(noteId));
  } catch (error) {
    console.error(error);
    removeWorkspaceTabReference(noteId, fallbackNoteId);
  }

  syncSelectedNoteFromTabs(fallbackNoteId ?? noteId);
  render();
}

function removeWorkspaceTabReference(noteId: string, fallbackNoteId: string | null): void {
  state.tabs.tabs = state.tabs.tabs.filter((tab) => tab.noteId !== noteId);

  if (state.tabs.activeTabId !== noteId) {
    return;
  }

  if (fallbackNoteId && isWorkspaceTabOpen(fallbackNoteId)) {
    state.tabs.activeTabId = fallbackNoteId;
    return;
  }

  state.tabs.activeTabId = null;
}

function getWorkspaceTabFallbackNoteId(noteId: string): string | null {
  const index = state.tabs.tabs.findIndex((tab) => tab.noteId === noteId);
  if (index === -1) {
    return state.tabs.activeTabId;
  }

  return state.tabs.tabs[index + 1]?.noteId
    ?? state.tabs.tabs[index - 1]?.noteId
    ?? null;
}

async function moveWorkspaceTab(
  draggedNoteId: string,
  targetTab: HTMLElement | null,
  clientX: number
): Promise<void> {
  const orderedIds = state.tabs.tabs.map((tab) => tab.noteId);
  if (!orderedIds.includes(draggedNoteId)) {
    return;
  }

  const nextIds = orderedIds.filter((noteId) => noteId !== draggedNoteId);
  if (!targetTab) {
    nextIds.push(draggedNoteId);
  } else {
    const targetNoteId = targetTab.dataset.workspaceTabId?.trim();
    if (!targetNoteId || targetNoteId === draggedNoteId) {
      return;
    }

    const targetIndex = nextIds.indexOf(targetNoteId);
    if (targetIndex === -1) {
      nextIds.push(draggedNoteId);
    } else {
      const { left, width } = targetTab.getBoundingClientRect();
      const insertAfter = clientX > left + width / 2;
      const insertIndex = insertAfter ? targetIndex + 1 : targetIndex;
      nextIds.splice(insertIndex, 0, draggedNoteId);
    }
  }

  try {
    applyWorkspaceTabsSnapshot(await api.reorderWorkspaceTabs(nextIds));
  } catch (error) {
    console.error(error);
    state.tabs.tabs = nextIds
      .map((noteId) => state.tabs.tabs.find((tab) => tab.noteId === noteId))
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
  state.tabs.tabs = state.tabs.tabs.filter((tab) => validNoteIds.has(tab.noteId));

  if (state.tabs.activeTabId && !validNoteIds.has(state.tabs.activeTabId)) {
    state.tabs.activeTabId = null;
  }

  if (!state.tabs.initialized) {
    state.tabs.initialized = true;
    if (preferredNoteId && validNoteIds.has(preferredNoteId)) {
      ensureWorkspaceTab(preferredNoteId);
    }
  }

  if (!state.tabs.activeTabId && state.tabs.tabs.length > 0) {
    state.tabs.activeTabId = state.tabs.tabs[0]?.noteId ?? null;
  }

  syncSelectedNoteFromTabs(preferredNoteId);
}

function applyWorkspaceTabsSnapshot(snapshot: TabsSessionSnapshot): void {
  state.tabs.tabs = snapshot.tabs.map((tab) => ({
    noteId: tab.noteId,
    pinned: tab.pinned,
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

async function syncWorkspaceTabOpen(noteId: string): Promise<void> {
  try {
    applyWorkspaceTabsSnapshot(await api.openWorkspaceTab(noteId));
  } catch (error) {
    console.error(error);
    ensureWorkspaceTab(noteId);
  }
}

function remapWorkspaceTabNoteId(previousNoteId: string, nextNoteId: string): void {
  if (previousNoteId === nextNoteId) {
    return;
  }

  let nextActiveTabId = state.tabs.activeTabId;
  state.tabs.tabs = state.tabs.tabs.map((tab) => {
    if (tab.noteId !== previousNoteId) {
      return tab;
    }

    nextActiveTabId = tab.noteId === state.tabs.activeTabId ? nextNoteId : nextActiveTabId;
    return {
      ...tab,
      noteId: nextNoteId,
    };
  });
  state.tabs.activeTabId = nextActiveTabId;
}

function syncSelectedNoteFromTabs(fallbackNoteId: string | null = state.vault.selectedNoteId): void {
  if (state.tabs.activeTabId && findNoteById(state.tabs.activeTabId)) {
    state.vault.selectedNoteId = state.tabs.activeTabId;
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
  return pendingSaveNoteId !== null || saveTimer !== null || saveInFlight || hasUncommittedTitleDraft();
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

  return conflicts ? "Название уже занято" : null;
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
      const label = folderPath || "Root";
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
  const file = obsidianApp.vault.getAbstractFileByPath(note.id);
  if (!file) {
    return {
      links: [],
      backlinks: [],
      tags: [],
    };
  }

  return obsidianApp.metadataCache.getFileCache(file) ?? {
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
  flashStatus(`Фильтр по #${tag}`);
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
    setStatus("Есть внешние изменения");
    return;
  }

  setStatus("Внешние изменения, обновление...");
  await reloadVault(state.vault.selectedNoteId);
  flashStatus("Vault обновлён с диска");
}

async function maybeReloadAfterExternalChanges(): Promise<void> {
  if (!state.hasExternalChanges || hasUnsavedChanges()) {
    return;
  }

  setStatus("Применение внешних изменений...");
  await reloadVault(state.vault.selectedNoteId);
  flashStatus("Внешние изменения применены");
}

async function safeGetWorkspaceState(): Promise<{ revision: number; changedAt: string } | null> {
  try {
    return await workspaceClient.getWorkspaceState();
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

  workspaceClient.updateNoteKeepalive(noteId, {
    title: getPersistableTitle(note),
    content: note.content,
  });
  pendingSaveNoteId = null;
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
      <button type="button" class="folder-list__toggle${hasChildren ? "" : " is-empty"}" data-folder-toggle="${escapeAttribute(node.path)}" aria-label="${isCollapsed ? "Развернуть" : "Свернуть"} папку">
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
      <button type="button" class="folder-list__toggle${hasChildren ? "" : " is-empty"}" data-folder-toggle="${escapeAttribute(node.path)}" aria-label="${isCollapsed ? "Развернуть" : "Свернуть"} папку">
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
  async createNote(payload: { title: string; content: string; folderPath?: string }): Promise<Note> {
    return obsidianApp.createNote(payload);
  },

  async updateNote(
    noteId: string,
    payload: { title: string; content: string; folderPath?: string }
  ): Promise<Note> {
    return obsidianApp.updateNote(noteId, payload);
  },

  async deleteNote(noteId: string): Promise<void> {
    await obsidianApp.deleteNote(noteId);
  },

  async getWorkspaceTabs(): Promise<TabsSessionSnapshot> {
    return requestJson<TabsSessionSnapshot>("/api/workspace/tabs");
  },

  async openWorkspaceTab(noteId: string): Promise<TabsSessionSnapshot> {
    return requestJson<TabsSessionSnapshot>("/api/workspace/tabs/open", {
      method: "POST",
      body: JSON.stringify({ noteId }),
    });
  },

  async closeWorkspaceTab(tabId: string): Promise<TabsSessionSnapshot> {
    return requestJson<TabsSessionSnapshot>("/api/workspace/tabs/close", {
      method: "POST",
      body: JSON.stringify({ tabId }),
    });
  },

  async setWorkspaceTabPinned(tabId: string, pinned: boolean): Promise<TabsSessionSnapshot> {
    return requestJson<TabsSessionSnapshot>(pinned ? "/api/workspace/tabs/pin" : "/api/workspace/tabs/unpin", {
      method: "POST",
      body: JSON.stringify({ tabId }),
    });
  },

  async reorderWorkspaceTabs(tabIds: string[]): Promise<TabsSessionSnapshot> {
    return requestJson<TabsSessionSnapshot>("/api/workspace/tabs/reorder", {
      method: "POST",
      body: JSON.stringify({ tabIds }),
    });
  },

  async activateWorkspaceTab(tabId: string): Promise<TabsSessionSnapshot> {
    return requestJson<TabsSessionSnapshot>("/api/workspace/tabs/activate", {
      method: "POST",
      body: JSON.stringify({ tabId }),
    });
  },
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof RequestError) {
    if (error.status === 409 && error.message === "A note with this title already exists") {
      return "Название уже занято";
    }

    if (error.message.trim()) {
      return error.message;
    }
  }

  return fallback;
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
    return "Есть несохранённые изменения";
  }

  if (state.hasExternalChanges) {
    return "Есть внешние изменения";
  }

  return DEFAULT_STATUS;
}

function buildGraphLayout(
  snapshot: GraphSnapshot,
  selectedNoteId: string | null,
  mode: GraphMode
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const centerX = 500;
  const centerY = 320;
  const viewportWidth = GRAPH_VIEWBOX_WIDTH;
  const viewportHeight = GRAPH_VIEWBOX_HEIGHT;

  const selectedNode = mode === "local" && selectedNoteId
    ? snapshot.nodes.find((node) => node.noteId === selectedNoteId)
    : null;
  if (selectedNode) {
    positions.set(selectedNode.id, { x: centerX, y: centerY });
  }

  const noteNodes = snapshot.nodes
    .filter((node) => node.type === "note" && node.id !== selectedNode?.id)
    .sort((left, right) => right.size - left.size || left.label.localeCompare(right.label, "en"));
  const tagNodes = snapshot.nodes
    .filter((node) => node.type === "tag")
    .sort((left, right) => left.label.localeCompare(right.label, "en"));
  const danglingNodes = snapshot.nodes
    .filter((node) => node.type === "dangling")
    .sort((left, right) => left.label.localeCompare(right.label, "en"));

  placeNodesOnRings(positions, noteNodes, centerX, centerY, mode === "local" ? 170 : 120, 78, 10, -Math.PI / 2);
  placeNodesOnRings(positions, tagNodes, centerX, centerY, mode === "local" ? 300 : 330, 64, 14, -Math.PI / 2 + 0.16);
  placeNodesOnRings(positions, danglingNodes, centerX, centerY, mode === "local" ? 390 : 420, 56, 16, Math.PI / 2);

  if (snapshot.nodes.length <= 1) {
    return positions;
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
      fixed: node.id === selectedNode?.id,
      targetX: start.x,
      targetY: start.y,
      radius: getGraphNodeRadius(node),
      node,
    });
  });

  const iterations = Math.min(84, 42 + snapshot.nodes.length * 2);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    applyGraphRepulsion(simPoints, snapshot.nodes.length > 48 ? 2800 : 3600);
    applyGraphCollisions(simPoints);
    applyGraphEdgeSprings(simPoints, snapshot.edges);
    applyGraphAnchors(simPoints, mode, centerX, centerY, selectedNode?.id ?? null);
    integrateGraphPositions(simPoints, viewportWidth, viewportHeight);
  }

  simPoints.forEach((point, nodeId) => {
    positions.set(nodeId, { x: point.x, y: point.y });
  });

  return positions;
}

function placeNodesOnRings(
  positions: Map<string, { x: number; y: number }>,
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
      let dx = right.x - left.x;
      let dy = right.y - left.y;
      let distance = Math.hypot(dx, dy);
      const minimum = left.radius + right.radius + 18;

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

function getGraphNodeRadius(node: GraphNode): number {
  if (node.type === "note") {
    return Math.max(10, Math.min(26, 9 + node.size * 1.35));
  }

  return node.type === "tag" ? 9 : 8;
}

function truncateLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function resetGraphViewport(): void {
  state.graph.panX = 0;
  state.graph.panY = 0;
  state.graph.zoom = 1;
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

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.trim() || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchJson<T>(url: string): Promise<T> {
  return requestJson<T>(url);
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
      const group = groups.get(key) ?? { label: node.folderPath || "Root", noteIds: [] };
      group.noteIds.push(node.noteId ?? node.id);
      groups.set(key, group);
    });
  } else if (state.graph.colorMode === "tag") {
    noteNodes.forEach((node) => {
      const note = state.vault.notes.find((item) => item.id === (node.noteId ?? ""));
      const tags = note ? getNoteTags(note) : [];
      const key = tags[0] ?? "__untagged__";
      const label = tags[0] ? `#${tags[0]}` : "Untagged";
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
      const label = cluster ? `Cluster ${cluster.size}` : "Unclustered";
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
  return content.replace(/\n+/g, " ").replace(/[#>*`\-[\]]/g, "").trim().slice(0, 88) || "Пустая заметка";
}

function countWords(content: string): number {
  const words = content.trim().match(/\S+/g);
  return words ? words.length : 0;
}

function countCharacters(content: string): number {
  return content.length;
}

function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}
