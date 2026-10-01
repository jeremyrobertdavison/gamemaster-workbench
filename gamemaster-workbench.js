const MODULE_ID = "gamemaster-workbench";
const DATA_KEY = "workbenchData";
const TEMPLATE = `modules/${MODULE_ID}/templates/workbench.hbs`;

const COLUMN_DEFINITIONS = [
  ["backlog", "Backlog"],
  ["todo", "To Do"],
  ["in-progress", "In Progress"],
  ["blocked", "Blocked"],
  ["done", "Done"]
];

const DEFAULT_TAGS = ["NPC", "Combat", "Maps", "Story", "Treasure", "Session Prep"];
const PRIORITIES = ["Low", "Normal", "High"];
let workbenchApp = null;

function uid() {
  return foundry.utils.randomID(16);
}

function clone(value) {
  return foundry.utils.deepClone ? foundry.utils.deepClone(value) : structuredClone(value);
}

function emptyData() {
  return {
    schemaVersion: 1,
    columns: COLUMN_DEFINITIONS.map(([id, title]) => ({ id, title, cardIds: [] })),
    cards: {},
    notes: [],
    tags: [...DEFAULT_TAGS],
    sessions: [],
    currentSessionId: ""
  };
}

function normalizeData(raw) {
  const base = emptyData();
  if (!raw || typeof raw !== "object") return base;

  const data = {
    ...base,
    ...clone(raw),
    cards: raw.cards && typeof raw.cards === "object" ? clone(raw.cards) : {},
    notes: Array.isArray(raw.notes) ? clone(raw.notes) : [],
    tags: Array.isArray(raw.tags) ? [...new Set([...DEFAULT_TAGS, ...raw.tags.filter(Boolean)])] : [...DEFAULT_TAGS],
    sessions: Array.isArray(raw.sessions) ? clone(raw.sessions) : [],
    columns: Array.isArray(raw.columns) ? clone(raw.columns) : base.columns
  };

  for (const [id, title] of COLUMN_DEFINITIONS) {
    let column = data.columns.find(c => c.id === id);
    if (!column) {
      column = { id, title, cardIds: [] };
      data.columns.push(column);
    }
    column.title ||= title;
    column.cardIds = Array.isArray(column.cardIds) ? column.cardIds.filter(cardId => data.cards[cardId]) : [];
  }

  for (const [cardId, card] of Object.entries(data.cards)) {
    card.id ||= cardId;
    card.title ||= "Untitled Card";
    card.description ||= "";
    card.comments = Array.isArray(card.comments) ? card.comments : [];
    card.checklists = Array.isArray(card.checklists) ? card.checklists : [];
    card.tags = Array.isArray(card.tags) ? card.tags : [];
    card.priority = PRIORITIES.includes(card.priority) ? card.priority : "Normal";
    card.sessionId ||= "";
    card.prepDate ||= "";
    card.linkedDocuments = Array.isArray(card.linkedDocuments) ? card.linkedDocuments : [];
    card.archived = Boolean(card.archived);
    card.createdAt ||= Date.now();
    card.updatedAt ||= Date.now();

    if (!card.archived && !data.columns.some(c => c.cardIds.includes(cardId))) {
      data.columns.find(c => c.id === "backlog").cardIds.push(cardId);
    }
  }

  for (const note of data.notes) {
    note.id ||= uid();
    note.title ||= "Untitled Note";
    note.content ||= "";
    note.createdAt ||= Date.now();
    note.updatedAt ||= Date.now();
  }

  if (data.currentSessionId && !data.sessions.some(s => s.id === data.currentSessionId)) {
    data.currentSessionId = "";
  }
  return data;
}

function getData() {
  return normalizeData(game.settings.get(MODULE_ID, DATA_KEY));
}

async function saveData(data) {
  return game.settings.set(MODULE_ID, DATA_KEY, normalizeData(data));
}

function dialogField(result, key) {
  if (!result) return "";
  if (typeof result.get === "function") return result.get(key) ?? "";
  if (result.object && Object.hasOwn(result.object, key)) return result.object[key] ?? "";
  if (Object.hasOwn(result, key)) return result[key] ?? "";
  return "";
}

function formatTimestamp(timestamp) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function sanitizeRichText(html) {
  const doc = new DOMParser().parseFromString(`<div>${html ?? ""}</div>`, "text/html");
  for (const bad of doc.querySelectorAll("script, iframe, object, embed, style, link, meta")) bad.remove();
  for (const el of doc.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      if ((name === "href" || name === "src") && value.startsWith("javascript:")) el.removeAttribute(attr.name);
    }
  }
  return doc.body.firstElementChild?.innerHTML ?? "";
}

function cardSearchText(card) {
  return [
    card.title,
    card.description,
    card.priority,
    ...card.tags,
    ...card.comments.map(c => c.text),
    ...card.checklists.flatMap(c => [c.title, ...c.items.map(i => i.text)]),
    ...card.linkedDocuments.map(l => `${l.name} ${l.type}`)
  ].join(" ").toLowerCase();
}

function extractDocumentId(li) {
  const element = li?.[0] ?? li;
  if (!element) return "";
  return element.dataset?.documentId
    || element.dataset?.entryId
    || element.dataset?.entityId
    || element.closest?.("[data-document-id]")?.dataset?.documentId
    || element.closest?.("[data-entry-id]")?.dataset?.entryId
    || "";
}

async function getDocumentFromDrop(event) {
  try {
    const dragData = foundry.applications.ux.TextEditor.getDragEventData(event);
    if (!dragData) return null;
    if (dragData.uuid) return await fromUuid(dragData.uuid);
    if (dragData.type && dragData.id) {
      const collection = {
        Actor: game.actors,
        Item: game.items,
        JournalEntry: game.journal,
        Scene: game.scenes,
        RollTable: game.tables,
        Playlist: game.playlists
      }[dragData.type];
      return collection?.get(dragData.id) ?? null;
    }
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not read dropped document`, error);
  }
  return null;
}

async function createCardFromDocument(document, { open = true } = {}) {
  if (!game.user.isGM || !document) return;
  const data = getData();
  const id = uid();
  const now = Date.now();
  data.cards[id] = {
    id,
    title: `Prep: ${document.name}`,
    description: "",
    comments: [],
    checklists: [],
    tags: ["Session Prep"],
    priority: "Normal",
    sessionId: data.currentSessionId || "",
    prepDate: "",
    linkedDocuments: [{
      uuid: document.uuid,
      name: document.name,
      type: document.documentName ?? document.constructor?.name ?? "Document"
    }],
    archived: false,
    createdAt: now,
    updatedAt: now
  };
  data.columns.find(c => c.id === "todo").cardIds.push(id);
  await saveData(data);
  ui.notifications.info(`Added “${document.name}” to Gamemaster Workbench.`);
  if (open) {
    openWorkbench();
    workbenchApp.activeCardId = id;
    workbenchApp.tab = "board";
    workbenchApp.render({ force: true });
  }
}

function openWorkbench() {
  if (!game.user?.isGM) return;
  workbenchApp ??= new GamemasterWorkbench();
  workbenchApp.render({ force: true });
}

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

class GamemasterWorkbench extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "gamemaster-workbench",
    classes: ["gamemaster-workbench"],
    tag: "section",
    window: {
      title: "Gamemaster Workbench",
      icon: "fa-solid fa-briefcase",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 1220,
      height: 780
    }
  };

  static PARTS = {
    main: { template: TEMPLATE }
  };

  constructor(options = {}) {
    super(options);
    this.tab = "board";
    this.viewMode = "all";
    this.search = "";
    this.priorityFilter = "";
    this.tagFilter = "";
    this.activeCardId = "";
    this.activeNoteId = "";
    this.showArchive = false;
    this.showSessionManager = false;
  }

  async _prepareContext(options) {
    const data = getData();
    this.data = data;

    const sessionOptions = data.sessions.map(session => ({
      ...session,
      selected: session.id === data.currentSessionId
    }));

    const query = this.search.trim().toLowerCase();
    const visibleCard = card => {
      if (card.archived) return false;
      if (this.viewMode === "current" && (!data.currentSessionId || card.sessionId !== data.currentSessionId)) return false;
      if (this.priorityFilter && card.priority !== this.priorityFilter) return false;
      if (this.tagFilter && !card.tags.includes(this.tagFilter)) return false;
      if (query && !cardSearchText(card).includes(query)) return false;
      return true;
    };

    const columns = data.columns
      .filter(c => COLUMN_DEFINITIONS.some(([id]) => id === c.id))
      .map(column => ({
        ...column,
        cards: column.cardIds.map(id => data.cards[id]).filter(card => card && visibleCard(card))
      }));

    const activeCard = data.cards[this.activeCardId] && !data.cards[this.activeCardId].archived
      ? clone(data.cards[this.activeCardId])
      : null;

    if (activeCard) {
      activeCard.comments = activeCard.comments.map(comment => ({
        ...comment,
        formattedTime: formatTimestamp(comment.createdAt)
      }));
      activeCard.priorityOptions = PRIORITIES.map(value => ({ value, selected: value === activeCard.priority }));
      activeCard.sessionOptions = data.sessions.map(session => ({ ...session, selected: session.id === activeCard.sessionId }));
      activeCard.tagOptions = data.tags.map(tag => ({ tag, checked: activeCard.tags.includes(tag) }));
      activeCard.checklists = activeCard.checklists.map(list => ({
        ...list,
        completed: list.items.filter(i => i.complete).length,
        total: list.items.length
      }));
    }

    let activeNote = data.notes.find(n => n.id === this.activeNoteId) ?? null;
    if (!activeNote && data.notes.length) {
      activeNote = data.notes[0];
      this.activeNoteId = activeNote.id;
    }

    const currentCards = data.currentSessionId
      ? Object.values(data.cards).filter(c => !c.archived && c.sessionId === data.currentSessionId)
      : [];
    const currentDone = currentCards.filter(c => data.columns.find(col => col.id === "done")?.cardIds.includes(c.id)).length;

    return {
      isBoard: this.tab === "board",
      isNotes: this.tab === "notes",
      columns,
      activeCard,
      notes: data.notes.map(note => ({ ...note, active: note.id === this.activeNoteId, formattedTime: formatTimestamp(note.updatedAt) })),
      activeNote,
      tags: data.tags,
      priorityOptions: PRIORITIES,
      priorityFilters: PRIORITIES.map(value => ({ value, selected: value === this.priorityFilter })),
      tagFilters: data.tags.map(tag => ({ tag, selected: tag === this.tagFilter })),
      sessionOptions,
      currentSessionId: data.currentSessionId,
      currentSessionName: data.sessions.find(s => s.id === data.currentSessionId)?.name ?? "No current session",
      currentProgress: currentCards.length ? `${currentDone} / ${currentCards.length}` : "0 / 0",
      viewMode: this.viewMode,
      viewAll: this.viewMode === "all",
      viewCurrent: this.viewMode === "current",
      search: this.search,
      priorityFilter: this.priorityFilter,
      tagFilter: this.tagFilter,
      archivedCards: Object.values(data.cards).filter(c => c.archived),
      showArchive: this.showArchive,
      showSessionManager: this.showSessionManager,
      sessions: data.sessions,
      hasSessions: data.sessions.length > 0
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (!game.user?.isGM) {
      this.close();
      return;
    }

    const root = this.element;
    root.querySelectorAll("[data-tab]").forEach(el => el.addEventListener("click", () => {
      this.tab = el.dataset.tab;
      this.render({ force: true });
    }));

    root.querySelector("[data-action='create-card']")?.addEventListener("click", () => this._createCard());
    root.querySelectorAll("[data-card-id]").forEach(el => {
      if (!el.classList.contains("gmw-card")) return;
      el.addEventListener("click", event => {
        if (event.target.closest("button, input, select, textarea, a")) return;
        this.activeCardId = el.dataset.cardId;
        this.render({ force: true });
      });
      el.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.activeCardId = el.dataset.cardId;
          this.render({ force: true });
        }
      });
      el.addEventListener("dragstart", event => {
        event.dataTransfer.setData("text/gmw-card", el.dataset.cardId);
        event.dataTransfer.effectAllowed = "move";
        el.classList.add("is-dragging");
      });
      el.addEventListener("dragend", () => el.classList.remove("is-dragging"));
    });

    root.querySelectorAll(".gmw-column-cards").forEach(zone => {
      zone.addEventListener("dragover", event => {
        if (event.dataTransfer.types.includes("text/gmw-card")) {
          event.preventDefault();
          zone.classList.add("is-drop-target");
        }
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("is-drop-target"));
      zone.addEventListener("drop", event => this._dropCard(event, zone));
    });

    root.querySelector("[data-action='close-card']")?.addEventListener("click", () => {
      this.activeCardId = "";
      this.render({ force: true });
    });

    root.querySelector(".gmw-card-editor")?.addEventListener("change", event => this._cardFieldChanged(event));
    root.querySelector("[data-action='add-comment']")?.addEventListener("click", () => this._addComment());
    root.querySelector("[data-action='add-checklist']")?.addEventListener("click", () => this._addChecklist());
    root.querySelectorAll("[data-action='delete-comment']").forEach(btn => btn.addEventListener("click", () => this._deleteComment(btn.dataset.commentId)));
    root.querySelectorAll("[data-action='delete-checklist']").forEach(btn => btn.addEventListener("click", () => this._deleteChecklist(btn.dataset.checklistId)));
    root.querySelectorAll("[data-action='add-check-item']").forEach(btn => btn.addEventListener("click", () => this._addChecklistItem(btn.dataset.checklistId)));
    root.querySelectorAll("[data-action='delete-check-item']").forEach(btn => btn.addEventListener("click", () => this._deleteChecklistItem(btn.dataset.checklistId, btn.dataset.itemId)));
    root.querySelectorAll("[data-action='move-check-item']").forEach(btn => btn.addEventListener("click", () => this._moveChecklistItem(btn.dataset.checklistId, btn.dataset.itemId, Number(btn.dataset.direction))));
    root.querySelector("[data-action='add-tag']")?.addEventListener("click", () => this._addTag());
    root.querySelector("[data-action='duplicate-card']")?.addEventListener("click", () => this._duplicateCard());
    root.querySelector("[data-action='archive-card']")?.addEventListener("click", () => this._archiveCard());
    root.querySelector("[data-action='delete-card']")?.addEventListener("click", () => this._deleteCard());

    const linkDrop = root.querySelector(".gmw-link-drop");
    if (linkDrop) {
      linkDrop.addEventListener("dragover", event => {
        event.preventDefault();
        linkDrop.classList.add("is-drop-target");
      });
      linkDrop.addEventListener("dragleave", () => linkDrop.classList.remove("is-drop-target"));
      linkDrop.addEventListener("drop", event => this._linkDroppedDocument(event));
    }
    root.querySelectorAll("[data-action='open-link']").forEach(btn => btn.addEventListener("click", () => this._openLink(btn.dataset.uuid)));
    root.querySelectorAll("[data-action='remove-link']").forEach(btn => btn.addEventListener("click", () => this._removeLink(btn.dataset.uuid)));

    root.querySelector("[data-action='new-note']")?.addEventListener("click", () => this._createNote());
    root.querySelectorAll("[data-note-id]").forEach(btn => btn.addEventListener("click", () => {
      this.activeNoteId = btn.dataset.noteId;
      this.render({ force: true });
    }));
    root.querySelector("[data-action='delete-note']")?.addEventListener("click", () => this._deleteNote());
    root.querySelector(".gmw-note-title")?.addEventListener("change", event => this._updateNoteTitle(event.currentTarget.value));
    const noteEditor = root.querySelector(".gmw-rich-editor");
    if (noteEditor) {
      let saveTimer;
      noteEditor.addEventListener("input", () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => this._updateNoteContent(noteEditor.innerHTML), 400);
      });
    }
    root.querySelectorAll("[data-command]").forEach(btn => btn.addEventListener("click", () => {
      document.execCommand(btn.dataset.command, false, null);
      noteEditor?.focus();
    }));
    root.querySelectorAll("[data-block]").forEach(btn => btn.addEventListener("click", () => {
      document.execCommand("formatBlock", false, btn.dataset.block);
      noteEditor?.focus();
    }));
    root.querySelector("[data-action='rich-link']")?.addEventListener("click", () => {
      const url = window.prompt("Link URL");
      if (url) document.execCommand("createLink", false, url);
      noteEditor?.focus();
    });

    root.querySelector(".gmw-current-session")?.addEventListener("change", event => this._setCurrentSession(event.currentTarget.value));
    root.querySelector("[data-action='new-session']")?.addEventListener("click", () => this._createSession());
    root.querySelector("[data-action='toggle-session-manager']")?.addEventListener("click", () => {
      this.showSessionManager = !this.showSessionManager;
      this.render({ force: true });
    });
    root.querySelectorAll("[data-action='rename-session']").forEach(btn => btn.addEventListener("click", () => this._renameSession(btn.dataset.sessionId)));
    root.querySelectorAll("[data-action='delete-session']").forEach(btn => btn.addEventListener("click", () => this._deleteSession(btn.dataset.sessionId)));

    root.querySelector(".gmw-view-mode")?.addEventListener("change", event => {
      this.viewMode = event.currentTarget.value;
      this.render({ force: true });
    });
    root.querySelector(".gmw-search")?.addEventListener("change", event => {
      this.search = event.currentTarget.value;
      this.render({ force: true });
    });
    root.querySelector(".gmw-priority-filter")?.addEventListener("change", event => {
      this.priorityFilter = event.currentTarget.value;
      this.render({ force: true });
    });
    root.querySelector(".gmw-tag-filter")?.addEventListener("change", event => {
      this.tagFilter = event.currentTarget.value;
      this.render({ force: true });
    });

    root.querySelector("[data-action='toggle-archive']")?.addEventListener("click", () => {
      this.showArchive = !this.showArchive;
      this.render({ force: true });
    });
    root.querySelectorAll("[data-action='restore-card']").forEach(btn => btn.addEventListener("click", () => this._restoreCard(btn.dataset.cardId)));
    root.querySelectorAll("[data-action='delete-archived-card']").forEach(btn => btn.addEventListener("click", () => this._deleteArchivedCard(btn.dataset.cardId)));
  }

  async _persist({ render = true } = {}) {
    await saveData(this.data);
    if (render) this.render({ force: true });
  }

  async _createCard() {
    const id = uid();
    const now = Date.now();
    this.data.cards[id] = {
      id,
      title: "New Card",
      description: "",
      comments: [],
      checklists: [],
      tags: [],
      priority: "Normal",
      sessionId: this.data.currentSessionId || "",
      prepDate: "",
      linkedDocuments: [],
      archived: false,
      createdAt: now,
      updatedAt: now
    };
    this.data.columns.find(c => c.id === "backlog").cardIds.push(id);
    this.activeCardId = id;
    await this._persist();
  }

  async _dropCard(event, zone) {
    const cardId = event.dataTransfer.getData("text/gmw-card");
    if (!cardId || !this.data.cards[cardId]) return;
    event.preventDefault();
    zone.classList.remove("is-drop-target");
    const destination = this.data.columns.find(c => c.id === zone.dataset.columnId);
    if (!destination) return;

    for (const column of this.data.columns) column.cardIds = column.cardIds.filter(id => id !== cardId);
    const targetCard = event.target.closest(".gmw-card");
    const beforeId = targetCard?.dataset.cardId;
    const index = beforeId ? destination.cardIds.indexOf(beforeId) : -1;
    if (index >= 0) destination.cardIds.splice(index, 0, cardId);
    else destination.cardIds.push(cardId);
    this.data.cards[cardId].updatedAt = Date.now();
    await this._persist();
  }

  async _cardFieldChanged(event) {
    const card = this.data.cards[this.activeCardId];
    if (!card) return;
    const el = event.target;

    if (el.matches("[data-card-field]")) {
      card[el.dataset.cardField] = el.value;
    } else if (el.matches("[data-tag-value]")) {
      const tag = el.dataset.tagValue;
      card.tags = el.checked ? [...new Set([...card.tags, tag])] : card.tags.filter(t => t !== tag);
    } else if (el.matches("[data-checklist-title]")) {
      const list = card.checklists.find(c => c.id === el.dataset.checklistTitle);
      if (list) list.title = el.value;
    } else if (el.matches("[data-check-item-text]")) {
      const list = card.checklists.find(c => c.id === el.dataset.checklistId);
      const item = list?.items.find(i => i.id === el.dataset.checkItemText);
      if (item) item.text = el.value;
    } else if (el.matches("[data-check-item-complete]")) {
      const list = card.checklists.find(c => c.id === el.dataset.checklistId);
      const item = list?.items.find(i => i.id === el.dataset.checkItemComplete);
      if (item) item.complete = el.checked;
    } else return;

    card.updatedAt = Date.now();
    await this._persist({ render: true });
  }

  async _addComment() {
    const input = this.element.querySelector(".gmw-new-comment");
    const text = input?.value.trim();
    if (!text) return;
    const card = this.data.cards[this.activeCardId];
    card.comments.push({ id: uid(), text, createdAt: Date.now() });
    card.updatedAt = Date.now();
    await this._persist();
  }

  async _deleteComment(commentId) {
    const card = this.data.cards[this.activeCardId];
    card.comments = card.comments.filter(c => c.id !== commentId);
    card.updatedAt = Date.now();
    await this._persist();
  }

  async _addChecklist() {
    const card = this.data.cards[this.activeCardId];
    card.checklists.push({ id: uid(), title: "Checklist", items: [] });
    card.updatedAt = Date.now();
    await this._persist();
  }

  async _deleteChecklist(checklistId) {
    const card = this.data.cards[this.activeCardId];
    card.checklists = card.checklists.filter(c => c.id !== checklistId);
    card.updatedAt = Date.now();
    await this._persist();
  }

  async _addChecklistItem(checklistId) {
    const card = this.data.cards[this.activeCardId];
    const list = card.checklists.find(c => c.id === checklistId);
    if (!list) return;
    list.items.push({ id: uid(), text: "New item", complete: false });
    card.updatedAt = Date.now();
    await this._persist();
  }

  async _deleteChecklistItem(checklistId, itemId) {
    const card = this.data.cards[this.activeCardId];
    const list = card.checklists.find(c => c.id === checklistId);
    if (!list) return;
    list.items = list.items.filter(i => i.id !== itemId);
    card.updatedAt = Date.now();
    await this._persist();
  }

  async _moveChecklistItem(checklistId, itemId, direction) {
    const card = this.data.cards[this.activeCardId];
    const list = card.checklists.find(c => c.id === checklistId);
    if (!list) return;
    const index = list.items.findIndex(i => i.id === itemId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= list.items.length) return;
    [list.items[index], list.items[next]] = [list.items[next], list.items[index]];
    card.updatedAt = Date.now();
    await this._persist();
  }

  async _addTag() {
    const fd = await DialogV2.input({
      window: { title: "Add Workbench Tag" },
      content: '<input name="tag" type="text" placeholder="Tag name" autofocus>',
      ok: { label: "Add Tag" }
    });
    const tag = String(dialogField(fd, "tag")).trim();
    if (!tag) return;
    if (!this.data.tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) this.data.tags.push(tag);
    const card = this.data.cards[this.activeCardId];
    if (card && !card.tags.includes(tag)) card.tags.push(tag);
    await this._persist();
  }

  async _duplicateCard() {
    const source = this.data.cards[this.activeCardId];
    if (!source) return;
    const id = uid();
    const copy = clone(source);
    copy.id = id;
    copy.title = `${source.title} (Copy)`;
    copy.comments = copy.comments.map(c => ({ ...c, id: uid() }));
    copy.checklists = copy.checklists.map(list => ({ ...list, id: uid(), items: list.items.map(item => ({ ...item, id: uid() })) }));
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    copy.archived = false;
    this.data.cards[id] = copy;
    const column = this.data.columns.find(c => c.cardIds.includes(this.activeCardId)) ?? this.data.columns.find(c => c.id === "backlog");
    const index = column.cardIds.indexOf(this.activeCardId);
    column.cardIds.splice(index + 1, 0, id);
    this.activeCardId = id;
    await this._persist();
  }

  async _archiveCard() {
    const card = this.data.cards[this.activeCardId];
    if (!card) return;
    card.archived = true;
    card.updatedAt = Date.now();
    for (const column of this.data.columns) column.cardIds = column.cardIds.filter(id => id !== card.id);
    this.activeCardId = "";
    await this._persist();
  }

  async _deleteCard() {
    const card = this.data.cards[this.activeCardId];
    if (!card) return;
    const confirmed = await DialogV2.confirm({
      window: { title: "Delete Workbench Card" },
      content: `<p>Delete <strong>${foundry.utils.escapeHTML(card.title)}</strong> permanently?</p>`,
      modal: true
    });
    if (!confirmed) return;
    for (const column of this.data.columns) column.cardIds = column.cardIds.filter(id => id !== card.id);
    delete this.data.cards[card.id];
    this.activeCardId = "";
    await this._persist();
  }

  async _linkDroppedDocument(event) {
    event.preventDefault();
    event.currentTarget.classList.remove("is-drop-target");
    const document = await getDocumentFromDrop(event);
    if (!document) {
      ui.notifications.warn("That drop did not contain a Foundry document.");
      return;
    }
    const card = this.data.cards[this.activeCardId];
    if (!card) return;
    if (!card.linkedDocuments.some(link => link.uuid === document.uuid)) {
      card.linkedDocuments.push({
        uuid: document.uuid,
        name: document.name,
        type: document.documentName ?? document.constructor?.name ?? "Document"
      });
      card.updatedAt = Date.now();
      await this._persist();
    }
  }

  async _openLink(uuid) {
    const document = await fromUuid(uuid);
    if (!document) {
      ui.notifications.warn("The linked Foundry document could not be found.");
      return;
    }
    document.sheet?.render(true);
  }

  async _removeLink(uuid) {
    const card = this.data.cards[this.activeCardId];
    card.linkedDocuments = card.linkedDocuments.filter(link => link.uuid !== uuid);
    card.updatedAt = Date.now();
    await this._persist();
  }

  async _createNote() {
    const id = uid();
    this.data.notes.unshift({ id, title: "Untitled Note", content: "", createdAt: Date.now(), updatedAt: Date.now() });
    this.activeNoteId = id;
    await this._persist();
  }

  async _updateNoteTitle(title) {
    const note = this.data.notes.find(n => n.id === this.activeNoteId);
    if (!note) return;
    note.title = title.trim() || "Untitled Note";
    note.updatedAt = Date.now();
    await this._persist({ render: false });
  }

  async _updateNoteContent(content) {
    const note = this.data.notes.find(n => n.id === this.activeNoteId);
    if (!note) return;
    note.content = sanitizeRichText(content);
    note.updatedAt = Date.now();
    await this._persist({ render: false });
  }

  async _deleteNote() {
    const note = this.data.notes.find(n => n.id === this.activeNoteId);
    if (!note) return;
    const confirmed = await DialogV2.confirm({
      window: { title: "Delete Private Note" },
      content: `<p>Delete <strong>${foundry.utils.escapeHTML(note.title)}</strong>?</p>`,
      modal: true
    });
    if (!confirmed) return;
    this.data.notes = this.data.notes.filter(n => n.id !== note.id);
    this.activeNoteId = this.data.notes[0]?.id ?? "";
    await this._persist();
  }

  async _createSession() {
    const fd = await DialogV2.input({
      window: { title: "Create Prep Session" },
      content: '<input name="name" type="text" placeholder="Session 18" autofocus>',
      ok: { label: "Create Session" }
    });
    const name = String(dialogField(fd, "name")).trim();
    if (!name) return;
    const session = { id: uid(), name };
    this.data.sessions.push(session);
    this.data.currentSessionId = session.id;
    await this._persist();
  }

  async _setCurrentSession(sessionId) {
    this.data.currentSessionId = sessionId;
    await this._persist();
  }

  async _renameSession(sessionId) {
    const session = this.data.sessions.find(s => s.id === sessionId);
    if (!session) return;
    const fd = await DialogV2.input({
      window: { title: "Rename Prep Session" },
      content: `<input name="name" type="text" value="${foundry.utils.escapeHTML(session.name)}" autofocus>`,
      ok: { label: "Rename" }
    });
    const name = String(dialogField(fd, "name")).trim();
    if (!name) return;
    session.name = name;
    await this._persist();
  }

  async _deleteSession(sessionId) {
    const session = this.data.sessions.find(s => s.id === sessionId);
    if (!session) return;
    const confirmed = await DialogV2.confirm({
      window: { title: "Delete Prep Session" },
      content: `<p>Delete <strong>${foundry.utils.escapeHTML(session.name)}</strong>? Cards assigned to it will remain on the board but become unassigned.</p>`,
      modal: true
    });
    if (!confirmed) return;
    this.data.sessions = this.data.sessions.filter(s => s.id !== sessionId);
    for (const card of Object.values(this.data.cards)) if (card.sessionId === sessionId) card.sessionId = "";
    if (this.data.currentSessionId === sessionId) this.data.currentSessionId = "";
    await this._persist();
  }

  async _restoreCard(cardId) {
    const card = this.data.cards[cardId];
    if (!card) return;
    card.archived = false;
    card.updatedAt = Date.now();
    this.data.columns.find(c => c.id === "backlog").cardIds.push(cardId);
    await this._persist();
  }

  async _deleteArchivedCard(cardId) {
    const card = this.data.cards[cardId];
    if (!card) return;
    const confirmed = await DialogV2.confirm({
      window: { title: "Delete Archived Card" },
      content: `<p>Permanently delete <strong>${foundry.utils.escapeHTML(card.title)}</strong>?</p>`,
      modal: true
    });
    if (!confirmed) return;
    delete this.data.cards[cardId];
    await this._persist();
  }
}

function registerDirectoryContextHooks() {
  const definitions = [
    ["getActorDirectoryEntryContext", () => game.actors],
    ["getItemDirectoryEntryContext", () => game.items],
    ["getJournalDirectoryEntryContext", () => game.journal],
    ["getSceneDirectoryEntryContext", () => game.scenes],
    ["getRollTableDirectoryEntryContext", () => game.tables],
    ["getPlaylistDirectoryEntryContext", () => game.playlists]
  ];

  for (const [hookName, getCollection] of definitions) {
    Hooks.on(hookName, (...args) => {
      if (!game.user?.isGM) return;
      const options = args.at(-1);
      if (!Array.isArray(options)) return;
      options.push({
        name: "Add to GM To-Do",
        icon: '<i class="fa-solid fa-list-check"></i>',
        condition: () => game.user.isGM,
        callback: li => {
          const id = extractDocumentId(li);
          const document = getCollection()?.get(id);
          if (document) createCardFromDocument(document);
        }
      });
    });
  }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, DATA_KEY, {
    name: "Gamemaster Workbench Data",
    hint: "Private per-user data used by Gamemaster Workbench.",
    scope: "user",
    config: false,
    type: Object,
    default: {}
  });

  game.modules.get(MODULE_ID).api = {
    open: openWorkbench,
    createCardFromDocument
  };

  registerDirectoryContextHooks();
});

Hooks.on("getSceneControlButtons", controls => {
  if (!game.user?.isGM) return;
  controls[MODULE_ID] = {
    name: MODULE_ID,
    title: "Gamemaster Workbench",
    icon: "fa-solid fa-briefcase",
    order: 95,
    visible: true,
    activeTool: "open",
    tools: {
      open: {
        name: "open",
        title: "Open Gamemaster Workbench",
        icon: "fa-solid fa-list-check",
        order: 0,
        button: true,
        visible: true,
        onChange: () => openWorkbench()
      }
    }
  };
});
