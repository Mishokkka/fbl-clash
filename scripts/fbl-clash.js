const MODULE_ID = "fbl-clash";
const SOCKET_NAME = `module.${MODULE_ID}`;
const STATE_VERSION = 1;
const MAX_STEPS = 8;

const BASE_CATEGORIES = [
  { id: "none", key: "FBLClash.Category.None", icon: "fa-regular fa-circle" },
  { id: "attack", key: "FBLClash.Category.Attack", icon: "fa-solid fa-crosshairs" },
  { id: "defense", key: "FBLClash.Category.Defense", icon: "fa-solid fa-shield" },
  { id: "prepare", key: "FBLClash.Category.Prepare", icon: "fa-solid fa-hourglass-half" },
  { id: "maneuver", key: "FBLClash.Category.Maneuver", icon: "fa-solid fa-person-running" },
  { id: "hinder", key: "FBLClash.Category.Hinder", icon: "fa-solid fa-hand" },
  { id: "wait", key: "FBLClash.Category.Wait", icon: "fa-solid fa-pause" },
  { id: "special", key: "FBLClash.Category.Special", icon: "fa-solid fa-star" },
  { id: "other", key: "FBLClash.Category.Other", icon: "fa-solid fa-ellipsis" }
];

function t(key, data = {}) {
  try {
    return game.i18n.format(key, data);
  } catch (_) {
    return key;
  }
}

function localize(key) {
  try {
    return game.i18n.localize(key);
  } catch (_) {
    return key;
  }
}

function deepClone(value) {
  if (value === undefined) return undefined;
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return structuredClone(value);
}

function randomID(length = 16) {
  if (globalThis.foundry?.utils?.randomID) return foundry.utils.randomID(length);
  return crypto.randomUUID().replaceAll("-", "").slice(0, length);
}

function esc(value) {
  const s = String(value ?? "");
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function now() {
  return Date.now();
}

function getActiveGM() {
  return game.users?.find((u) => u.active && u.isGM) ?? null;
}

function notify(type, message) {
  const n = ui?.notifications;
  if (!n) return;
  const fn = n[type] ?? n.info;
  fn.call(n, message);
}

function parseCustomCategories() {
  const raw = String(game.settings.get(MODULE_ID, "customCategories") ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/[;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((label, i) => ({
      id: `custom-${i}`,
      label,
      icon: "fa-solid fa-tag"
    }));
}

function getCategories() {
  return [
    ...BASE_CATEGORIES.map((c) => ({ ...c, label: localize(c.key) })),
    ...parseCustomCategories()
  ];
}

function getCategory(id) {
  return getCategories().find((c) => c.id === id) ?? getCategories()[0];
}

function isEmptyAction(action) {
  if (!action) return true;
  return (action.category === "none" || !action.category) && !String(action.text ?? "").trim();
}

function defaultAction() {
  return { category: "none", text: "" };
}

function inferControllerForActor(actor) {
  if (!actor) return getActiveGM()?.id ?? game.user?.id ?? null;
  const activePlayers = game.users?.filter((u) => u.active && !u.isGM) ?? [];
  const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  for (const user of activePlayers) {
    try {
      if (actor.testUserPermission(user, ownerLevel)) return user.id;
    } catch (_) {
      const level = actor.ownership?.[user.id] ?? 0;
      if (level >= ownerLevel) return user.id;
    }
  }
  return getActiveGM()?.id ?? game.user?.id ?? null;
}

function tokenDescriptor(token) {
  if (!token) return null;
  const actor = token.actor ?? token.document?.actor;
  return {
    tokenId: token.document?.id ?? token.id ?? null,
    actorId: actor?.id ?? null,
    name: token.name ?? token.document?.name ?? actor?.name ?? localize("FBLClash.Common.Unknown"),
    img: token.document?.texture?.src ?? actor?.img ?? "icons/svg/mystery-man.svg",
    userId: inferControllerForActor(actor)
  };
}

function currentTokenCandidates() {
  const seen = new Set();
  const out = [];
  const add = (token, source) => {
    if (!token) return;
    const id = token.document?.id ?? token.id;
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ ...tokenDescriptor(token), source });
  };
  for (const token of canvas?.tokens?.controlled ?? []) add(token, "selected");
  for (const token of game.user?.targets ?? []) add(token, "target");
  return out;
}

function makeSide({ name, img, userId, actorId = null, tokenId = null }) {
  return {
    name: name || localize("FBLClash.Common.Combatant"),
    img: img || "icons/svg/mystery-man.svg",
    userId: userId ?? null,
    actorId,
    tokenId,
    locked: false,
    plan: {}
  };
}

function createState(config) {
  const steps = [];
  const count = Math.max(1, Math.min(MAX_STEPS, Number(config.steps) || 2));
  for (let i = 0; i < count; i++) {
    steps.push({
      id: randomID(),
      order: config.defaultOrder ?? "simultaneous"
    });
  }

  return {
    schema: STATE_VERSION,
    id: randomID(),
    title: config.title || localize("FBLClash.Common.Clash"),
    status: "planning",
    round: 1,
    createdAt: now(),
    updatedAt: now(),
    revealMode: config.revealMode ?? "step",
    visibility: config.visibility ?? "all",
    sides: {
      left: makeSide(config.left),
      right: makeSide(config.right)
    },
    steps,
    revealed: {},
    queue: [],
    proposals: [],
    rounds: [],
    log: [
      {
        id: randomID(),
        at: now(),
        text: t("FBLClash.Log.Started", { title: config.title || localize("FBLClash.Common.Clash") })
      }
    ]
  };
}

function allSidesLocked(state) {
  return Boolean(state?.sides?.left?.locked && state?.sides?.right?.locked);
}

function controllerSideKeys(state, userId = game.user?.id) {
  if (!state || !userId) return [];
  return ["left", "right"].filter((key) => state.sides?.[key]?.userId === userId);
}

function canViewState(state, user = game.user) {
  if (!state?.id || !user) return false;
  if (user.isGM) return true;
  if (state.visibility === "all") return true;
  return controllerSideKeys(state, user.id).length > 0;
}

function actionKey(stepId, sideKey) {
  return `${stepId}:${sideKey}`;
}

function isActionRevealed(state, stepId, sideKey) {
  return Boolean(state?.revealed?.[actionKey(stepId, sideKey)]);
}

function sideAction(state, sideKey, stepId) {
  return deepClone(state?.sides?.[sideKey]?.plan?.[stepId] ?? defaultAction());
}

function appendLog(state, text) {
  state.log ??= [];
  state.log.push({ id: randomID(), at: now(), text });
  if (state.log.length > 100) state.log.splice(0, state.log.length - 100);
}

function ensureQueueActive(state) {
  if (!state.queue?.length) return;
  const hasActive = state.queue.some((e) => e.status === "active");
  if (hasActive) return;
  const next = state.queue.find((e) => e.status === "pending");
  if (next) next.status = "active";
}

function createQueueEntry({ stepId = null, stepIndex = null, simultaneous = false, actions = [], source = "step", label = null }) {
  return {
    id: randomID(),
    stepId,
    stepIndex,
    simultaneous,
    actions: deepClone(actions),
    status: "pending",
    source,
    label
  };
}

function queueHasSource(state, sourceId) {
  return state.queue?.some((e) => e.sourceId === sourceId);
}

function buildStepQueueEntries(state, stepId) {
  const stepIndex = state.steps.findIndex((s) => s.id === stepId);
  if (stepIndex < 0) return [];
  const step = state.steps[stepIndex];
  const left = sideAction(state, "left", stepId);
  const right = sideAction(state, "right", stepId);
  const sourceBase = `step:${stepId}`;
  if (queueHasSource(state, sourceBase)) return [];

  const leftPayload = isEmptyAction(left) ? null : { side: "left", stepId, ...left };
  const rightPayload = isEmptyAction(right) ? null : { side: "right", stepId, ...right };

  if (!leftPayload && !rightPayload) return [];

  if (step.order === "simultaneous" && leftPayload && rightPayload) {
    return [{
      ...createQueueEntry({ stepId, stepIndex, simultaneous: true, actions: [leftPayload, rightPayload] }),
      sourceId: sourceBase
    }];
  }

  const ordered = [];
  if (step.order === "right-first") {
    if (rightPayload) ordered.push(rightPayload);
    if (leftPayload) ordered.push(leftPayload);
  } else {
    if (leftPayload) ordered.push(leftPayload);
    if (rightPayload) ordered.push(rightPayload);
  }

  return ordered.map((payload, idx) => ({
    ...createQueueEntry({ stepId, stepIndex, simultaneous: false, actions: [payload] }),
    sourceId: idx === 0 ? sourceBase : `${sourceBase}:${idx}`
  }));
}

function summaryRound(state) {
  return {
    round: state.round,
    steps: state.steps.map((step, i) => ({
      index: i,
      order: step.order,
      left: sideAction(state, "left", step.id),
      right: sideAction(state, "right", step.id),
      revealedLeft: isActionRevealed(state, step.id, "left"),
      revealedRight: isActionRevealed(state, step.id, "right")
    })),
    queue: deepClone(state.queue ?? [])
  };
}

class ClashManager {
  constructor() {
    this.state = null;
    this.app = new ClashWindow(this);
    this.launcher = null;
  }

  registerSettings() {
    game.settings.register(MODULE_ID, "activeClash", {
      scope: "world",
      config: false,
      type: Object,
      default: {}
    });

    game.settings.register(MODULE_ID, "archive", {
      scope: "world",
      config: false,
      type: Object,
      default: { items: [] }
    });

    game.settings.register(MODULE_ID, "defaultSteps", {
      name: "FBLClash.Settings.DefaultSteps.Name",
      hint: "FBLClash.Settings.DefaultSteps.Hint",
      scope: "world",
      config: true,
      type: Number,
      default: 2,
      range: { min: 1, max: MAX_STEPS, step: 1 }
    });

    game.settings.register(MODULE_ID, "defaultRevealMode", {
      name: "FBLClash.Settings.RevealMode.Name",
      hint: "FBLClash.Settings.RevealMode.Hint",
      scope: "world",
      config: true,
      type: String,
      default: "step",
      choices: {
        step: "FBLClash.Reveal.Step",
        all: "FBLClash.Reveal.All",
        manual: "FBLClash.Reveal.Manual"
      }
    });

    game.settings.register(MODULE_ID, "defaultOrder", {
      name: "FBLClash.Settings.DefaultOrder.Name",
      hint: "FBLClash.Settings.DefaultOrder.Hint",
      scope: "world",
      config: true,
      type: String,
      default: "simultaneous",
      choices: {
        simultaneous: "FBLClash.Order.Simultaneous",
        "left-first": "FBLClash.Order.LeftFirst",
        "right-first": "FBLClash.Order.RightFirst"
      }
    });

    game.settings.register(MODULE_ID, "defaultVisibility", {
      name: "FBLClash.Settings.Visibility.Name",
      hint: "FBLClash.Settings.Visibility.Hint",
      scope: "world",
      config: true,
      type: String,
      default: "all",
      choices: {
        all: "FBLClash.Visibility.All",
        participants: "FBLClash.Visibility.Participants"
      }
    });

    game.settings.register(MODULE_ID, "autoOpenSpectators", {
      name: "FBLClash.Settings.AutoOpenSpectators.Name",
      hint: "FBLClash.Settings.AutoOpenSpectators.Hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: true
    });

    game.settings.register(MODULE_ID, "customCategories", {
      name: "FBLClash.Settings.CustomCategories.Name",
      hint: "FBLClash.Settings.CustomCategories.Hint",
      scope: "world",
      config: true,
      type: String,
      default: ""
    });

    game.settings.register(MODULE_ID, "archiveLimit", {
      name: "FBLClash.Settings.ArchiveLimit.Name",
      hint: "FBLClash.Settings.ArchiveLimit.Hint",
      scope: "world",
      config: true,
      type: Number,
      default: 20,
      range: { min: 1, max: 100, step: 1 }
    });
  }

  async ready() {
    game.socket.on(SOCKET_NAME, (message) => this.onSocket(message));
    const saved = deepClone(game.settings.get(MODULE_ID, "activeClash"));
    this.state = saved?.id ? saved : null;
    this.exposeAPI();

    if (this.state && this.shouldAutoOpen(this.state)) this.app.open();
  }

  exposeAPI() {
    game.fblClash = {
      openLauncher: () => this.openLauncher(),
      open: () => this.app.open(),
      finish: () => this.finish(),
      postSummary: () => this.postSummary(),
      archive: () => this.openArchive(),
      openForViewers: () => this.openForViewers(),
      getState: () => deepClone(this.state)
    };
  }

  shouldAutoOpen(state) {
    if (!state?.id || !canViewState(state)) return false;
    if (game.user.isGM) return true;
    if (controllerSideKeys(state).length) return true;
    return game.settings.get(MODULE_ID, "autoOpenSpectators");
  }

  emit(type, payload = {}) {
    game.socket.emit(SOCKET_NAME, {
      type,
      senderId: game.user.id,
      clashId: this.state?.id ?? null,
      payload
    });
  }

  async onSocket(message) {
    if (!message?.type) return;

    if (message.type === "STATE") {
      const incoming = message.payload?.state;
      this.state = incoming?.id ? deepClone(incoming) : null;
      if (!this.state) {
        this.app.close(true);
        return;
      }
      if (this.shouldAutoOpen(this.state)) this.app.open();
      else if (this.app.isOpen) this.app.render();
      return;
    }

    if (message.type === "OPEN_WINDOW") {
      const incoming = message.payload?.state;
      if (incoming?.id) this.state = deepClone(incoming);
      if (!this.state?.id) return;
      if (message.clashId && message.clashId !== this.state.id) return;
      if (canViewState(this.state)) this.app.open();
      return;
    }

    if (!game.user.isGM) return;
    if (!this.state?.id || (message.clashId && message.clashId !== this.state.id)) return;

    const sender = game.users.get(message.senderId);
    if (!sender) return;

    switch (message.type) {
      case "LOCK_SIDE":
        await this.handleRemoteLock(sender, message.payload);
        break;
      case "PROPOSE_EXTRA":
        await this.handleProposal(sender, message.payload);
        break;
      case "REQUEST_OPEN":
        this.broadcastState();
        break;
    }
  }

  async persist({ broadcast = true } = {}) {
    if (!game.user.isGM) return;
    if (this.state) this.state.updatedAt = now();
    await game.settings.set(MODULE_ID, "activeClash", this.state ? deepClone(this.state) : {});
    if (broadcast) this.broadcastState();
    if (this.state) this.app.render();
  }

  broadcastState() {
    game.socket.emit(SOCKET_NAME, {
      type: "STATE",
      senderId: game.user.id,
      clashId: this.state?.id ?? null,
      payload: { state: this.state ? deepClone(this.state) : null }
    });
  }

  openForViewers() {
    if (!game.user.isGM || !this.state?.id) return;
    game.socket.emit(SOCKET_NAME, {
      type: "OPEN_WINDOW",
      senderId: game.user.id,
      clashId: this.state.id,
      payload: { state: deepClone(this.state) }
    });
    this.app.open();
    notify("info", localize("FBLClash.Notifications.OpenWindowsSent"));
  }

  async openLauncher() {
    if (!game.user.isGM) {
      notify("warn", localize("FBLClash.Notifications.GMOnly"));
      return;
    }
    if (this.state?.id && this.state.status !== "finished") {
      const ok = await SimpleModal.confirm({
        title: localize("FBLClash.Launcher.ActiveTitle"),
        content: localize("FBLClash.Launcher.ActiveWarning"),
        confirmLabel: localize("FBLClash.Common.Replace"),
        danger: true
      });
      if (!ok) return;
    }
    this.launcher = new ClashLauncher(this);
    this.launcher.open();
  }

  async startClash(config) {
    if (!game.user.isGM) return;
    this.state = createState(config);
    await this.persist();
    this.app.open();
  }

  async handleRemoteLock(sender, payload) {
    const sideKey = payload?.sideKey;
    if (!["left", "right"].includes(sideKey)) return;
    const side = this.state.sides[sideKey];
    if (side.userId !== sender.id && !sender.isGM) return;
    await this.lockSide(sideKey, payload.plan, sender.id);
  }

  async lockSide(sideKey, plan, actorUserId = game.user.id) {
    if (!this.state || !["left", "right"].includes(sideKey)) return;
    const side = this.state.sides[sideKey];
    if (side.locked) return;
    const cleanPlan = {};
    for (const step of this.state.steps) {
      const a = plan?.[step.id] ?? defaultAction();
      cleanPlan[step.id] = {
        category: getCategory(a.category).id,
        text: String(a.text ?? "").slice(0, 1000)
      };
    }
    side.plan = cleanPlan;
    side.locked = true;
    appendLog(this.state, t("FBLClash.Log.Locked", { name: side.name }));
    if (allSidesLocked(this.state)) this.state.status = "locked";
    await this.persist();
  }

  requestLock(sideKey, plan) {
    if (!this.state) return;
    if (game.user.isGM) return this.lockSide(sideKey, plan);
    this.emit("LOCK_SIDE", { sideKey, plan });
  }

  async unlockSide(sideKey) {
    if (!game.user.isGM || !this.state) return;
    const side = this.state.sides[sideKey];
    if (!side) return;
    side.locked = false;
    this.state.status = "planning";
    appendLog(this.state, t("FBLClash.Log.Unlocked", { name: side.name }));
    await this.persist();
  }

  async addStep() {
    if (!game.user.isGM || !this.state) return;
    if (this.state.steps.length >= MAX_STEPS) return;
    if (this.state.sides.left.locked || this.state.sides.right.locked) {
      notify("warn", localize("FBLClash.Notifications.UnlockBeforeStructure"));
      return;
    }
    this.state.steps.push({ id: randomID(), order: game.settings.get(MODULE_ID, "defaultOrder") });
    await this.persist();
  }

  async removeStep(stepId) {
    if (!game.user.isGM || !this.state || this.state.steps.length <= 1) return;
    if (this.state.sides.left.locked || this.state.sides.right.locked) return;
    const idx = this.state.steps.findIndex((s) => s.id === stepId);
    if (idx < 0) return;
    this.state.steps.splice(idx, 1);
    delete this.state.sides.left.plan?.[stepId];
    delete this.state.sides.right.plan?.[stepId];
    await this.persist();
  }

  async moveStep(stepId, delta) {
    if (!game.user.isGM || !this.state) return;
    if (this.state.sides.left.locked || this.state.sides.right.locked) return;
    const idx = this.state.steps.findIndex((s) => s.id === stepId);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= this.state.steps.length) return;
    const [step] = this.state.steps.splice(idx, 1);
    this.state.steps.splice(to, 0, step);
    await this.persist();
  }

  async setStepOrder(stepId, order) {
    if (!game.user.isGM || !this.state) return;
    if (!["simultaneous", "left-first", "right-first"].includes(order)) return;
    const step = this.state.steps.find((s) => s.id === stepId);
    if (!step) return;
    step.order = order;
    await this.persist();
  }

  async revealAction(stepId, sideKey, { queue = true } = {}) {
    if (!game.user.isGM || !this.state || !allSidesLocked(this.state)) return;
    this.state.status = "resolving";
    this.state.revealed[actionKey(stepId, sideKey)] = true;
    appendLog(this.state, t("FBLClash.Log.RevealedAction", {
      step: this.state.steps.findIndex((s) => s.id === stepId) + 1,
      name: this.state.sides[sideKey].name
    }));

    if (queue) {
      const action = sideAction(this.state, sideKey, stepId);
      if (!isEmptyAction(action)) {
        const sourceId = `manual:${stepId}:${sideKey}`;
        if (!queueHasSource(this.state, sourceId)) {
          this.state.queue.push({
            ...createQueueEntry({
              stepId,
              stepIndex: this.state.steps.findIndex((s) => s.id === stepId),
              simultaneous: false,
              actions: [{ side: sideKey, stepId, ...action }],
              source: "manual"
            }),
            sourceId
          });
        }
      }
      ensureQueueActive(this.state);
    }
    await this.persist();
  }

  async revealStep(stepId) {
    if (!game.user.isGM || !this.state || !allSidesLocked(this.state)) return;
    const stepIndex = this.state.steps.findIndex((s) => s.id === stepId);
    if (stepIndex < 0) return;
    this.state.status = "resolving";
    this.state.revealed[actionKey(stepId, "left")] = true;
    this.state.revealed[actionKey(stepId, "right")] = true;
    const entries = buildStepQueueEntries(this.state, stepId);
    this.state.queue.push(...entries);
    ensureQueueActive(this.state);
    appendLog(this.state, t("FBLClash.Log.RevealedStep", { step: stepIndex + 1 }));
    await this.persist();
  }

  async revealNext() {
    if (!game.user.isGM || !this.state) return;
    const step = this.state.steps.find((s) =>
      !isActionRevealed(this.state, s.id, "left") || !isActionRevealed(this.state, s.id, "right")
    );
    if (!step) return;
    if (this.state.revealMode === "manual") {
      const sideKey = !isActionRevealed(this.state, step.id, "left") ? "left" : "right";
      await this.revealAction(step.id, sideKey, { queue: true });
      return;
    }
    await this.revealStep(step.id);
  }

  async revealAll() {
    if (!game.user.isGM || !this.state || !allSidesLocked(this.state)) return;
    this.state.status = "resolving";
    for (const step of this.state.steps) {
      const bothHidden = !isActionRevealed(this.state, step.id, "left") && !isActionRevealed(this.state, step.id, "right");
      this.state.revealed[actionKey(step.id, "left")] = true;
      this.state.revealed[actionKey(step.id, "right")] = true;
      if (bothHidden) this.state.queue.push(...buildStepQueueEntries(this.state, step.id));
      else {
        for (const sideKey of ["left", "right"]) {
          const sourceId = `manual:${step.id}:${sideKey}`;
          if (queueHasSource(this.state, sourceId)) continue;
          const a = sideAction(this.state, sideKey, step.id);
          if (isEmptyAction(a)) continue;
          this.state.queue.push({
            ...createQueueEntry({
              stepId: step.id,
              stepIndex: this.state.steps.findIndex((s) => s.id === step.id),
              actions: [{ side: sideKey, stepId: step.id, ...a }],
              source: "manual"
            }),
            sourceId
          });
        }
      }
    }
    ensureQueueActive(this.state);
    appendLog(this.state, localize("FBLClash.Log.RevealedAll"));
    await this.persist();
  }

  async resolveNext() {
    if (!game.user.isGM || !this.state) return;
    const active = this.state.queue.find((e) => e.status === "active");
    if (active) {
      active.status = "resolved";
      appendLog(this.state, t("FBLClash.Log.ResolvedQueue", { label: this.queueEntryLabel(active) }));
    }
    ensureQueueActive(this.state);
    await this.persist();
  }

  async setEntryStatus(entryId, status) {
    if (!game.user.isGM || !this.state) return;
    if (!["pending", "active", "resolved", "skipped", "cancelled"].includes(status)) return;
    const entry = this.state.queue.find((e) => e.id === entryId);
    if (!entry) return;
    if (status === "active") {
      for (const e of this.state.queue) if (e.status === "active") e.status = "pending";
    }
    entry.status = status;
    if (["resolved", "skipped", "cancelled"].includes(status)) ensureQueueActive(this.state);
    await this.persist();
  }

  async reorderQueue(fromId, toId) {
    if (!game.user.isGM || !this.state || fromId === toId) return;
    const from = this.state.queue.findIndex((e) => e.id === fromId);
    const to = this.state.queue.findIndex((e) => e.id === toId);
    if (from < 0 || to < 0) return;
    const [entry] = this.state.queue.splice(from, 1);
    this.state.queue.splice(to, 0, entry);
    await this.persist();
  }

  async moveQueue(entryId, delta) {
    if (!game.user.isGM || !this.state) return;
    const idx = this.state.queue.findIndex((e) => e.id === entryId);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= this.state.queue.length) return;
    const [entry] = this.state.queue.splice(idx, 1);
    this.state.queue.splice(to, 0, entry);
    await this.persist();
  }

  queueEntryLabel(entry) {
    return (entry.actions ?? [])
      .map((a) => `${this.state.sides[a.side]?.name ?? a.side}: ${a.text || getCategory(a.category).label}`)
      .join(" + ");
  }

  async addExtra({ sideKey, category, text, position = "after-active", source = "gm" }) {
    if (!game.user.isGM || !this.state) return;
    const action = {
      side: sideKey,
      category: getCategory(category).id,
      text: String(text ?? "").slice(0, 1000),
      stepId: null
    };
    if (isEmptyAction(action)) return;
    const entry = createQueueEntry({
      actions: [action],
      simultaneous: false,
      source,
      label: localize("FBLClash.Queue.Extra")
    });
    this.insertQueueEntry(entry, position);
    ensureQueueActive(this.state);
    appendLog(this.state, t("FBLClash.Log.ExtraAdded", { name: this.state.sides[sideKey]?.name ?? sideKey }));
    await this.persist();
  }

  insertQueueEntry(entry, position) {
    if (position === "start") {
      this.state.queue.unshift(entry);
      return;
    }
    if (position === "before-active" || position === "after-active") {
      const idx = this.state.queue.findIndex((e) => e.status === "active");
      if (idx >= 0) {
        this.state.queue.splice(position === "before-active" ? idx : idx + 1, 0, entry);
        return;
      }
    }
    this.state.queue.push(entry);
  }

  requestProposal(sideKey, category, text) {
    if (!this.state) return;
    if (game.user.isGM) return this.handleProposal(game.user, { sideKey, category, text });
    this.emit("PROPOSE_EXTRA", { sideKey, category, text });
    notify("info", localize("FBLClash.Notifications.ProposalSent"));
  }

  async handleProposal(sender, payload) {
    const sideKey = payload?.sideKey;
    if (!["left", "right"].includes(sideKey)) return;
    if (this.state.sides[sideKey].userId !== sender.id && !sender.isGM) return;
    const proposal = {
      id: randomID(),
      senderId: sender.id,
      sideKey,
      category: getCategory(payload.category).id,
      text: String(payload.text ?? "").slice(0, 1000),
      at: now(),
      status: "pending"
    };
    if (isEmptyAction(proposal)) return;
    this.state.proposals.push(proposal);
    appendLog(this.state, t("FBLClash.Log.Proposal", { name: this.state.sides[sideKey].name }));
    await this.persist();
  }

  async acceptProposal(proposalId, position = "after-active") {
    if (!game.user.isGM || !this.state) return;
    const proposal = this.state.proposals.find((p) => p.id === proposalId);
    if (!proposal || proposal.status !== "pending") return;
    proposal.status = "accepted";
    const entry = createQueueEntry({
      actions: [{
        side: proposal.sideKey,
        category: proposal.category,
        text: proposal.text,
        stepId: null
      }],
      source: "proposal",
      label: localize("FBLClash.Queue.Extra")
    });
    this.insertQueueEntry(entry, position);
    ensureQueueActive(this.state);
    await this.persist();
  }

  async rejectProposal(proposalId) {
    if (!game.user.isGM || !this.state) return;
    const proposal = this.state.proposals.find((p) => p.id === proposalId);
    if (!proposal) return;
    proposal.status = "rejected";
    await this.persist();
  }

  async newRound() {
    if (!game.user.isGM || !this.state) return;
    this.state.rounds.push(summaryRound(this.state));
    const limit = Number(game.settings.get(MODULE_ID, "archiveLimit")) || 20;
    if (this.state.rounds.length > limit) this.state.rounds.splice(0, this.state.rounds.length - limit);
    this.state.round += 1;
    this.state.status = "planning";
    this.state.revealed = {};
    this.state.queue = [];
    this.state.proposals = [];
    for (const side of Object.values(this.state.sides)) {
      side.locked = false;
      side.plan = {};
    }
    appendLog(this.state, t("FBLClash.Log.NewRound", { round: this.state.round }));
    await this.persist();
  }

  async finish() {
    if (!game.user.isGM || !this.state) return;
    this.state.status = "finished";
    appendLog(this.state, localize("FBLClash.Log.Finished"));
    await this.persist();
  }

  async archiveAndClose() {
    if (!game.user.isGM || !this.state) return;
    const archive = deepClone(game.settings.get(MODULE_ID, "archive")) || { items: [] };
    archive.items ??= [];
    const rounds = [...(this.state.rounds ?? []), summaryRound(this.state)];
    archive.items.unshift({
      id: this.state.id,
      title: this.state.title,
      createdAt: this.state.createdAt,
      endedAt: now(),
      sides: {
        left: { name: this.state.sides.left.name, img: this.state.sides.left.img },
        right: { name: this.state.sides.right.name, img: this.state.sides.right.img }
      },
      rounds
    });
    const limit = Number(game.settings.get(MODULE_ID, "archiveLimit")) || 20;
    archive.items = archive.items.slice(0, limit);
    await game.settings.set(MODULE_ID, "archive", archive);
    this.state = null;
    await this.persist();
  }

  async postSummary() {
    if (!this.state) return;
    const rounds = [...(this.state.rounds ?? []), summaryRound(this.state)];
    const sideL = esc(this.state.sides.left.name);
    const sideR = esc(this.state.sides.right.name);
    const html = rounds.map((round) => {
      const rows = round.steps.map((s) => {
        const l = s.revealedLeft ? `${esc(getCategory(s.left.category).label)}: ${esc(s.left.text || "—")}` : localize("FBLClash.Common.Hidden");
        const r = s.revealedRight ? `${esc(getCategory(s.right.category).label)}: ${esc(s.right.text || "—")}` : localize("FBLClash.Common.Hidden");
        return `<div class="fbl-clash-chat-row"><b>${t("FBLClash.Common.StepN", { n: s.index + 1 })}</b><span>${l}</span><span>${r}</span></div>`;
      }).join("");
      return `<section class="fbl-clash-chat-round"><h4>${t("FBLClash.Common.RoundN", { n: round.round })}</h4>${rows}</section>`;
    }).join("");

    await ChatMessage.create({
      user: game.user.id,
      speaker: { alias: "FBL-Clash" },
      content: `<div class="fbl-clash-chat"><h3>${esc(this.state.title)}</h3><div class="fbl-clash-chat-head"><span>${sideL}</span><span>${sideR}</span></div>${html}</div>`
    });
  }

  openArchive() {
    const archive = deepClone(game.settings.get(MODULE_ID, "archive")) || { items: [] };
    const items = archive.items ?? [];
    const content = items.length
      ? `<div class="fbl-clash-archive-list">${items.map((item) => `
          <article class="fbl-clash-archive-item">
            <div class="fbl-clash-archive-title">${esc(item.title)}</div>
            <div class="fbl-clash-archive-vs">${esc(item.sides?.left?.name ?? "?")} <span>vs</span> ${esc(item.sides?.right?.name ?? "?")}</div>
            <div class="fbl-clash-archive-meta">${new Date(item.endedAt ?? item.createdAt).toLocaleString()} · ${t("FBLClash.Archive.Rounds", { n: item.rounds?.length ?? 0 })}</div>
          </article>`).join("")}</div>`
      : `<div class="fbl-clash-empty-state">${localize("FBLClash.Archive.Empty")}</div>`;
    SimpleModal.alert({ title: localize("FBLClash.Archive.Title"), content, wide: true });
  }
}

class SimpleModal {
  static open({ title, content, buttons = [], wide = false, onMount = null }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "fbl-clash-modal-overlay";
      const dialog = document.createElement("div");
      dialog.className = `fbl-clash-modal ${wide ? "wide" : ""}`;
      dialog.innerHTML = `
        <header class="fbl-clash-modal-header">
          <h2>${esc(title)}</h2>
          <button type="button" class="fbl-clash-icon-btn" data-close aria-label="${esc(localize("FBLClash.Common.Close"))}"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <div class="fbl-clash-modal-body">${content}</div>
        <footer class="fbl-clash-modal-footer"></footer>`;
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      const done = (value) => {
        overlay.remove();
        resolve(value);
      };
      overlay.addEventListener("mousedown", (ev) => {
        if (ev.target === overlay) done(null);
      });
      dialog.querySelector("[data-close]").addEventListener("click", () => done(null));
      const footer = dialog.querySelector(".fbl-clash-modal-footer");
      if (!buttons.length) footer.remove();
      for (const button of buttons) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `fbl-clash-btn ${button.primary ? "primary" : ""} ${button.danger ? "danger" : ""}`;
        b.innerHTML = button.icon ? `<i class="${button.icon}"></i><span>${esc(button.label)}</span>` : `<span>${esc(button.label)}</span>`;
        b.addEventListener("click", () => button.onClick?.(dialog, done));
        footer.appendChild(b);
      }
      onMount?.(dialog, done);
    });
  }

  static confirm({ title, content, confirmLabel, danger = false }) {
    return this.open({
      title,
      content: `<p>${esc(content)}</p>`,
      buttons: [
        { label: localize("FBLClash.Common.Cancel"), onClick: (_d, done) => done(false) },
        { label: confirmLabel, primary: true, danger, onClick: (_d, done) => done(true) }
      ]
    });
  }

  static alert({ title, content, wide = false }) {
    return this.open({
      title,
      content,
      wide,
      buttons: [
        { label: localize("FBLClash.Common.Close"), primary: true, onClick: (_d, done) => done(true) }
      ]
    });
  }
}

class ClashLauncher {
  constructor(manager) {
    this.manager = manager;
    this.candidates = currentTokenCandidates();
    this.overlay = null;
  }

  open() {
    const users = game.users?.filter((u) => u.active) ?? [];
    const gm = getActiveGM() ?? game.user;
    const leftToken = this.candidates[0] ?? null;
    const rightToken = this.candidates[1] ?? null;
    const left = leftToken ?? { name: localize("FBLClash.Launcher.GMSide"), img: "icons/svg/mystery-man.svg", userId: gm.id };
    const right = rightToken ?? { name: localize("FBLClash.Launcher.PlayerSide"), img: "icons/svg/mystery-man.svg", userId: users.find((u) => !u.isGM)?.id ?? gm.id };

    const candidateOptions = `<option value="">${esc(localize("FBLClash.Launcher.Custom"))}</option>${this.candidates.map((c, i) => `<option value="${i}">${esc(c.name)} (${esc(c.source)})</option>`).join("")}`;
    const userOptions = users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}${u.isGM ? " [GM]" : ""}</option>`).join("");

    const content = `
      <div class="fbl-clash-launcher">
        <label class="fbl-clash-field span-2">
          <span>${esc(localize("FBLClash.Launcher.TitleLabel"))}</span>
          <input type="text" name="title" value="${esc(localize("FBLClash.Common.Clash"))}" maxlength="120">
        </label>
        ${this.sideFields("left", left, candidateOptions, userOptions)}
        ${this.sideFields("right", right, candidateOptions, userOptions)}
        <label class="fbl-clash-field">
          <span>${esc(localize("FBLClash.Launcher.Steps"))}</span>
          <input type="number" name="steps" min="1" max="${MAX_STEPS}" value="${Number(game.settings.get(MODULE_ID, "defaultSteps")) || 2}">
        </label>
        <label class="fbl-clash-field">
          <span>${esc(localize("FBLClash.Launcher.RevealMode"))}</span>
          <select name="revealMode">
            <option value="step">${esc(localize("FBLClash.Reveal.Step"))}</option>
            <option value="all">${esc(localize("FBLClash.Reveal.All"))}</option>
            <option value="manual">${esc(localize("FBLClash.Reveal.Manual"))}</option>
          </select>
        </label>
        <label class="fbl-clash-field">
          <span>${esc(localize("FBLClash.Launcher.DefaultOrder"))}</span>
          <select name="defaultOrder">
            <option value="simultaneous">${esc(localize("FBLClash.Order.Simultaneous"))}</option>
            <option value="left-first">${esc(localize("FBLClash.Order.LeftFirst"))}</option>
            <option value="right-first">${esc(localize("FBLClash.Order.RightFirst"))}</option>
          </select>
        </label>
        <label class="fbl-clash-field">
          <span>${esc(localize("FBLClash.Launcher.Visibility"))}</span>
          <select name="visibility">
            <option value="all">${esc(localize("FBLClash.Visibility.All"))}</option>
            <option value="participants">${esc(localize("FBLClash.Visibility.Participants"))}</option>
          </select>
        </label>
      </div>`;

    SimpleModal.open({
      title: localize("FBLClash.Launcher.Title"),
      content,
      wide: true,
      buttons: [
        {
          label: localize("FBLClash.Archive.Title"),
          icon: "fa-solid fa-box-archive",
          onClick: () => this.manager.openArchive()
        },
        {
          label: localize("FBLClash.Common.Cancel"),
          onClick: (_dialog, done) => done(false)
        },
        {
          label: localize("FBLClash.Launcher.Start"),
          icon: "fa-solid fa-bolt",
          primary: true,
          onClick: async (dialog, done) => {
            const config = this.readConfig(dialog);
            done(true);
            await this.manager.startClash(config);
          }
        }
      ],
      onMount: (dialog) => this.activate(dialog, left, right)
    });
  }

  sideFields(sideKey, side, candidateOptions, userOptions) {
    const label = sideKey === "left" ? localize("FBLClash.Common.LeftSide") : localize("FBLClash.Common.RightSide");
    return `
      <section class="fbl-clash-launcher-side ${sideKey}">
        <div class="fbl-clash-launcher-side-title">${esc(label)}</div>
        <label class="fbl-clash-field">
          <span>${esc(localize("FBLClash.Launcher.Token"))}</span>
          <select name="${sideKey}-token">${candidateOptions}</select>
        </label>
        <label class="fbl-clash-field">
          <span>${esc(localize("FBLClash.Launcher.Name"))}</span>
          <input type="text" name="${sideKey}-name" value="${esc(side.name)}" maxlength="120">
        </label>
        <label class="fbl-clash-field">
          <span>${esc(localize("FBLClash.Launcher.Controller"))}</span>
          <select name="${sideKey}-user">${userOptions}</select>
        </label>
        <input type="hidden" name="${sideKey}-img" value="${esc(side.img)}">
        <input type="hidden" name="${sideKey}-actorId" value="${esc(side.actorId ?? "")}">
        <input type="hidden" name="${sideKey}-tokenId" value="${esc(side.tokenId ?? "")}">
      </section>`;
  }

  activate(dialog, left, right) {
    const setUser = (sideKey, id) => {
      const select = dialog.querySelector(`[name="${sideKey}-user"]`);
      if (select && id) select.value = id;
    };
    setUser("left", left.userId);
    setUser("right", right.userId);
    dialog.querySelector('[name="revealMode"]').value = game.settings.get(MODULE_ID, "defaultRevealMode");
    dialog.querySelector('[name="defaultOrder"]').value = game.settings.get(MODULE_ID, "defaultOrder");
    dialog.querySelector('[name="visibility"]').value = game.settings.get(MODULE_ID, "defaultVisibility");

    for (const sideKey of ["left", "right"]) {
      dialog.querySelector(`[name="${sideKey}-token"]`)?.addEventListener("change", (ev) => {
        const idx = ev.currentTarget.value;
        if (idx === "") return;
        const c = this.candidates[Number(idx)];
        if (!c) return;
        dialog.querySelector(`[name="${sideKey}-name"]`).value = c.name;
        dialog.querySelector(`[name="${sideKey}-img"]`).value = c.img;
        dialog.querySelector(`[name="${sideKey}-actorId"]`).value = c.actorId ?? "";
        dialog.querySelector(`[name="${sideKey}-tokenId"]`).value = c.tokenId ?? "";
        setUser(sideKey, c.userId);
      });
    }
  }

  readConfig(dialog) {
    const readSide = (sideKey) => ({
      name: dialog.querySelector(`[name="${sideKey}-name"]`).value.trim() || localize("FBLClash.Common.Combatant"),
      img: dialog.querySelector(`[name="${sideKey}-img"]`).value || "icons/svg/mystery-man.svg",
      actorId: dialog.querySelector(`[name="${sideKey}-actorId"]`).value || null,
      tokenId: dialog.querySelector(`[name="${sideKey}-tokenId"]`).value || null,
      userId: dialog.querySelector(`[name="${sideKey}-user"]`).value || getActiveGM()?.id
    });
    return {
      title: dialog.querySelector('[name="title"]').value.trim(),
      steps: Number(dialog.querySelector('[name="steps"]').value) || 2,
      revealMode: dialog.querySelector('[name="revealMode"]').value,
      defaultOrder: dialog.querySelector('[name="defaultOrder"]').value,
      visibility: dialog.querySelector('[name="visibility"]').value,
      left: readSide("left"),
      right: readSide("right")
    };
  }
}

class ClashWindow {
  constructor(manager) {
    this.manager = manager;
    this.root = null;
    this.isOpen = false;
    this.minimized = false;
    this.drafts = {};
    this.draftRound = null;
    this.dragQueueId = null;
  }

  open() {
    if (!this.manager.state?.id || !canViewState(this.manager.state)) {
      if (!this.manager.state?.id && !game.user.isGM) this.manager.emit("REQUEST_OPEN");
      return;
    }
    if (!this.root) this.createRoot();
    this.isOpen = true;
    this.root.classList.remove("hidden");
    this.syncDrafts();
    this.render();
  }

  close(force = false) {
    if (!this.root) return;
    if (force) {
      this.root.remove();
      this.root = null;
      this.isOpen = false;
      return;
    }
    this.root.classList.add("hidden");
    this.isOpen = false;
  }

  createRoot() {
    const root = document.createElement("section");
    root.id = "fbl-clash-window";
    root.className = "fbl-clash-window";
    root.style.left = `${Math.max(16, (window.innerWidth - 1120) / 2)}px`;
    root.style.top = `${Math.max(48, (window.innerHeight - 760) / 2)}px`;
    document.body.appendChild(root);
    this.root = root;
    this.activateDrag();
  }

  activateDrag() {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    const move = (ev) => {
      if (!dragging) return;
      const nextLeft = Math.min(window.innerWidth - 220, Math.max(0, startLeft + ev.clientX - startX));
      const nextTop = Math.min(window.innerHeight - 80, Math.max(0, startTop + ev.clientY - startY));
      this.root.style.left = `${nextLeft}px`;
      this.root.style.top = `${nextTop}px`;
    };
    const up = () => {
      dragging = false;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    this.root.addEventListener("mousedown", (ev) => {
      const handle = ev.target.closest("[data-drag-handle]");
      if (!handle || ev.target.closest("button, input, select, textarea")) return;
      dragging = true;
      startX = ev.clientX;
      startY = ev.clientY;
      startLeft = parseFloat(this.root.style.left) || this.root.offsetLeft;
      startTop = parseFloat(this.root.style.top) || this.root.offsetTop;
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }

  syncDrafts() {
    const state = this.manager.state;
    if (!state) return;
    if (this.draftRound !== state.round) {
      this.drafts = {};
      this.draftRound = state.round;
    }
    for (const sideKey of controllerSideKeys(state)) {
      this.drafts[sideKey] ??= {};
      for (const step of state.steps) {
        this.drafts[sideKey][step.id] ??= deepClone(state.sides[sideKey].plan?.[step.id] ?? defaultAction());
      }
      for (const stepId of Object.keys(this.drafts[sideKey])) {
        if (!state.steps.some((s) => s.id === stepId)) delete this.drafts[sideKey][stepId];
      }
    }
  }

  canEditSide(sideKey) {
    const state = this.manager.state;
    return Boolean(state && state.status === "planning" && !state.sides[sideKey].locked && state.sides[sideKey].userId === game.user.id);
  }

  canSeeAction(sideKey, stepId) {
    const state = this.manager.state;
    if (!state) return false;
    if (state.sides[sideKey].userId === game.user.id) return true;
    return isActionRevealed(state, stepId, sideKey);
  }

  getDisplayedAction(sideKey, stepId) {
    const state = this.manager.state;
    if (!state) return defaultAction();
    if (this.canEditSide(sideKey)) return deepClone(this.drafts[sideKey]?.[stepId] ?? defaultAction());
    return sideAction(state, sideKey, stepId);
  }

  render() {
    const state = this.manager.state;
    if (!this.root || !state?.id || !canViewState(state)) return;
    this.syncDrafts();
    this.root.classList.toggle("minimized", this.minimized);
    this.root.innerHTML = `
      ${this.headerHtml(state)}
      <div class="fbl-clash-body ${this.minimized ? "hidden" : ""}">
        ${this.toolbarHtml(state)}
        <div class="fbl-clash-layout">
          <main class="fbl-clash-board">${this.boardHtml(state)}</main>
          <aside class="fbl-clash-sidebar">${this.sidebarHtml(state)}</aside>
        </div>
      </div>`;
    this.activateEvents();
  }

  headerHtml(state) {
    return `
      <header class="fbl-clash-header" data-drag-handle>
        <div class="fbl-clash-brand">
          <span class="fbl-clash-mark"><i class="fa-solid fa-bolt"></i></span>
          <div>
            <div class="fbl-clash-title">${esc(state.title)}</div>
            <div class="fbl-clash-subtitle">${t("FBLClash.Common.RoundN", { n: state.round })} · ${esc(localize(`FBLClash.Status.${state.status}`))}</div>
          </div>
        </div>
        <div class="fbl-clash-header-actions">
          ${game.user.isGM ? `<button class="fbl-clash-icon-btn" data-action="launcher" title="${esc(localize("FBLClash.Common.NewClash"))}"><i class="fa-solid fa-plus"></i></button>` : ""}
          <button class="fbl-clash-icon-btn" data-action="minimize" title="${esc(localize("FBLClash.Common.Minimize"))}"><i class="fa-solid ${this.minimized ? "fa-window-maximize" : "fa-minus"}"></i></button>
          <button class="fbl-clash-icon-btn" data-action="close-window" title="${esc(localize("FBLClash.Common.Close"))}"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </header>`;
  }

  toolbarHtml(state) {
    const gm = game.user.isGM;
    const revealDisabled = !allSidesLocked(state);
    const unrevealed = state.steps.some((s) => !isActionRevealed(state, s.id, "left") || !isActionRevealed(state, s.id, "right"));
    return `
      <div class="fbl-clash-toolbar">
        <div class="fbl-clash-status-strip">
          ${this.sideStatusPill(state, "left")}
          <span class="fbl-clash-vs">VS</span>
          ${this.sideStatusPill(state, "right")}
        </div>
        <div class="fbl-clash-toolbar-actions">
          ${gm ? `<button class="fbl-clash-btn ghost" data-action="open-viewers" title="${esc(localize("FBLClash.Common.OpenWindowsHint"))}"><i class="fa-solid fa-up-right-from-square"></i><span>${esc(localize("FBLClash.Common.OpenWindows"))}</span></button>` : ""}
          ${gm && state.status === "planning" ? `<button class="fbl-clash-btn ghost" data-action="add-step"><i class="fa-solid fa-plus"></i><span>${esc(localize("FBLClash.Common.AddStep"))}</span></button>` : ""}
          ${gm && ["locked", "resolving"].includes(state.status) && unrevealed ? `<button class="fbl-clash-btn" data-action="reveal-next" ${revealDisabled ? "disabled" : ""}><i class="fa-solid fa-eye"></i><span>${esc(localize("FBLClash.Common.RevealNext"))}</span></button>` : ""}
          ${gm && ["locked", "resolving"].includes(state.status) && unrevealed ? `<button class="fbl-clash-btn ghost" data-action="reveal-all" ${revealDisabled ? "disabled" : ""}><i class="fa-solid fa-eye"></i><span>${esc(localize("FBLClash.Common.RevealAll"))}</span></button>` : ""}
          ${gm && ["resolving", "locked"].includes(state.status) ? `<button class="fbl-clash-btn primary" data-action="resolve-next"><i class="fa-solid fa-check"></i><span>${esc(localize("FBLClash.Common.ResolveNext"))}</span></button>` : ""}
          ${gm && state.status !== "finished" ? `<button class="fbl-clash-btn ghost" data-action="add-extra"><i class="fa-solid fa-plus"></i><span>${esc(localize("FBLClash.Common.ExtraAction"))}</span></button>` : ""}
        </div>
      </div>`;
  }

  sideStatusPill(state, sideKey) {
    const side = state.sides[sideKey];
    const ready = side.locked;
    return `<div class="fbl-clash-status-pill ${sideKey} ${ready ? "ready" : ""}">
      <img src="${esc(side.img)}" alt="">
      <div><strong>${esc(side.name)}</strong><span>${esc(ready ? localize("FBLClash.Common.Ready") : localize("FBLClash.Common.Choosing"))}</span></div>
      <i class="fa-solid ${ready ? "fa-lock" : "fa-pen"}"></i>
    </div>`;
  }

  boardHtml(state) {
    const planning = state.status === "planning";
    const steps = state.steps.map((step, index) => this.stepRowHtml(state, step, index, planning)).join("");
    return `
      <div class="fbl-clash-column-heads">
        ${this.combatantHead(state, "left")}
        <div class="fbl-clash-step-head">${esc(localize("FBLClash.Common.Sequence"))}</div>
        ${this.combatantHead(state, "right")}
      </div>
      <div class="fbl-clash-steps">${steps}</div>
      ${planning ? this.planningFooter(state) : ""}
      ${state.status === "finished" ? this.finishedHtml(state) : ""}`;
  }

  combatantHead(state, sideKey) {
    const side = state.sides[sideKey];
    const user = game.users.get(side.userId);
    return `<div class="fbl-clash-combatant-head ${sideKey}">
      <img src="${esc(side.img)}" alt="">
      <div><strong>${esc(side.name)}</strong><span>${esc(user?.name ?? localize("FBLClash.Common.Unassigned"))}</span></div>
    </div>`;
  }

  stepRowHtml(state, step, index, planning) {
    const order = step.order;
    return `
      <section class="fbl-clash-step" data-step-id="${step.id}">
        ${this.actionCardHtml(state, "left", step, index)}
        <div class="fbl-clash-step-center">
          <div class="fbl-clash-step-number">${index + 1}</div>
          ${game.user.isGM ? `
            <select class="fbl-clash-order-select" data-order-step="${step.id}" ${planning || state.status === "locked" ? "" : "disabled"}>
              <option value="simultaneous" ${order === "simultaneous" ? "selected" : ""}>${esc(localize("FBLClash.Order.SimultaneousShort"))}</option>
              <option value="left-first" ${order === "left-first" ? "selected" : ""}>${esc(localize("FBLClash.Order.LeftFirstShort"))}</option>
              <option value="right-first" ${order === "right-first" ? "selected" : ""}>${esc(localize("FBLClash.Order.RightFirstShort"))}</option>
            </select>
            ${planning && !state.sides.left.locked && !state.sides.right.locked ? `
              <div class="fbl-clash-step-tools">
                <button class="fbl-clash-mini-btn" data-action="step-up" data-step-id="${step.id}" title="${esc(localize("FBLClash.Common.Up"))}"><i class="fa-solid fa-chevron-up"></i></button>
                <button class="fbl-clash-mini-btn" data-action="step-down" data-step-id="${step.id}" title="${esc(localize("FBLClash.Common.Down"))}"><i class="fa-solid fa-chevron-down"></i></button>
                <button class="fbl-clash-mini-btn danger" data-action="remove-step" data-step-id="${step.id}" title="${esc(localize("FBLClash.Common.Remove"))}"><i class="fa-solid fa-xmark"></i></button>
              </div>` : ""}` : `<div class="fbl-clash-order-readonly">${esc(this.orderLabel(order))}</div>`}
        </div>
        ${this.actionCardHtml(state, "right", step, index)}
      </section>`;
  }

  orderLabel(order) {
    if (order === "left-first") return localize("FBLClash.Order.LeftFirstShort");
    if (order === "right-first") return localize("FBLClash.Order.RightFirstShort");
    return localize("FBLClash.Order.SimultaneousShort");
  }

  actionCardHtml(state, sideKey, step, index) {
    const editable = this.canEditSide(sideKey);
    const visible = this.canSeeAction(sideKey, step.id);
    const revealed = isActionRevealed(state, step.id, sideKey);
    const side = state.sides[sideKey];
    const action = this.getDisplayedAction(sideKey, step.id);
    const category = getCategory(action.category);

    if (!visible) {
      return `<article class="fbl-clash-action-card hidden-card ${sideKey} ${side.locked ? "locked" : ""}">
        <div class="fbl-clash-card-back"><i class="fa-solid ${side.locked ? "fa-lock" : "fa-pen"}"></i><span>${esc(side.locked ? localize("FBLClash.Common.Locked") : localize("FBLClash.Common.Choosing"))}</span></div>
        ${game.user.isGM && state.revealMode === "manual" && side.locked ? `<button class="fbl-clash-reveal-card" data-action="reveal-action" data-step-id="${step.id}" data-side="${sideKey}"><i class="fa-solid fa-eye"></i>${esc(localize("FBLClash.Common.Reveal"))}</button>` : ""}
      </article>`;
    }

    if (editable) {
      return `<article class="fbl-clash-action-card editing ${sideKey}" data-category="${esc(action.category)}">
        <div class="fbl-clash-action-top">
          <select class="fbl-clash-category-select" data-draft-category data-side="${sideKey}" data-step-id="${step.id}">
            ${getCategories().map((c) => `<option value="${esc(c.id)}" ${c.id === action.category ? "selected" : ""}>${esc(c.label)}</option>`).join("")}
          </select>
          <span class="fbl-clash-category-icon"><i class="${esc(category.icon)}"></i></span>
        </div>
        <textarea data-draft-text data-side="${sideKey}" data-step-id="${step.id}" maxlength="1000" placeholder="${esc(localize("FBLClash.Common.ActionPlaceholder"))}">${esc(action.text)}</textarea>
      </article>`;
    }

    return `<article class="fbl-clash-action-card revealed ${sideKey} cat-${esc(action.category)} ${revealed ? "is-revealed" : "own-hidden"}">
      <div class="fbl-clash-action-top"><span class="fbl-clash-category-badge"><i class="${esc(category.icon)}"></i>${esc(category.label)}</span>${revealed ? `<span class="fbl-clash-revealed-label">${esc(localize("FBLClash.Common.Revealed"))}</span>` : ""}</div>
      <div class="fbl-clash-action-text">${esc(action.text || localize("FBLClash.Common.NoText"))}</div>
    </article>`;
  }

  planningFooter(state) {
    const buttons = controllerSideKeys(state).map((sideKey) => {
      const side = state.sides[sideKey];
      if (side.locked) {
        return `<div class="fbl-clash-lock-state"><i class="fa-solid fa-lock"></i>${esc(t("FBLClash.Common.LockedAs", { name: side.name }))}</div>`;
      }
      return `<button class="fbl-clash-lock-btn ${sideKey}" data-action="lock-side" data-side="${sideKey}"><i class="fa-solid fa-lock"></i><span>${esc(t("FBLClash.Common.LockPlan", { name: side.name }))}</span></button>`;
    }).join("");

    const gmUnlocks = game.user.isGM ? ["left", "right"].filter((k) => state.sides[k].locked).map((k) => `<button class="fbl-clash-btn ghost compact" data-action="unlock-side" data-side="${k}"><i class="fa-solid fa-lock-open"></i><span>${esc(t("FBLClash.Common.UnlockName", { name: state.sides[k].name }))}</span></button>`).join("") : "";

    return `<footer class="fbl-clash-planning-footer"><div>${buttons || `<span class="fbl-clash-muted">${esc(localize("FBLClash.Common.WaitingParticipants"))}</span>`}</div><div>${gmUnlocks}</div></footer>`;
  }

  finishedHtml(state) {
    if (!game.user.isGM) return `<div class="fbl-clash-finished-banner"><i class="fa-solid fa-flag-checkered"></i>${esc(localize("FBLClash.Common.ClashFinished"))}</div>`;
    return `<div class="fbl-clash-finished-banner gm"><i class="fa-solid fa-flag-checkered"></i><span>${esc(localize("FBLClash.Common.ClashFinished"))}</span>
      <button class="fbl-clash-btn" data-action="post-summary"><i class="fa-solid fa-message"></i>${esc(localize("FBLClash.Common.PostSummary"))}</button>
      <button class="fbl-clash-btn primary" data-action="archive-close"><i class="fa-solid fa-box-archive"></i>${esc(localize("FBLClash.Common.ArchiveClose"))}</button>
    </div>`;
  }

  sidebarHtml(state) {
    return `
      <section class="fbl-clash-side-panel">
        <div class="fbl-clash-panel-head"><h3>${esc(localize("FBLClash.Queue.Title"))}</h3>${game.user.isGM && state.queue.length ? `<span>${state.queue.length}</span>` : ""}</div>
        ${this.proposalsHtml(state)}
        ${this.queueHtml(state)}
        ${this.playerExtraHtml(state)}
      </section>
      <section class="fbl-clash-side-panel history">
        <div class="fbl-clash-panel-head"><h3>${esc(localize("FBLClash.History.Title"))}</h3><span>${state.log?.length ?? 0}</span></div>
        <div class="fbl-clash-history-list">${(state.log ?? []).slice().reverse().slice(0, 14).map((e) => `<div class="fbl-clash-history-item"><time>${new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><span>${esc(e.text)}</span></div>`).join("")}</div>
      </section>
      ${game.user.isGM ? `<section class="fbl-clash-side-footer">
        ${state.status !== "finished" ? `<button class="fbl-clash-btn ghost" data-action="new-round"><i class="fa-solid fa-rotate"></i>${esc(localize("FBLClash.Common.NewRound"))}</button><button class="fbl-clash-btn danger ghost" data-action="finish"><i class="fa-solid fa-flag-checkered"></i>${esc(localize("FBLClash.Common.Finish"))}</button>` : ""}
      </section>` : ""}`;
  }

  proposalsHtml(state) {
    const pending = (state.proposals ?? []).filter((p) => p.status === "pending");
    if (!pending.length) return "";
    if (!game.user.isGM) {
      const own = pending.filter((p) => p.senderId === game.user.id);
      if (!own.length) return "";
      return `<div class="fbl-clash-proposals"><div class="fbl-clash-proposal-title">${esc(localize("FBLClash.Queue.PendingProposals"))}</div>${own.map((p) => `<div class="fbl-clash-proposal pending"><span>${esc(p.text)}</span><i class="fa-solid fa-clock"></i></div>`).join("")}</div>`;
    }
    return `<div class="fbl-clash-proposals"><div class="fbl-clash-proposal-title">${esc(localize("FBLClash.Queue.PendingProposals"))}</div>${pending.map((p) => `
      <div class="fbl-clash-proposal">
        <div><strong>${esc(state.sides[p.sideKey]?.name ?? p.sideKey)}</strong><span>${esc(getCategory(p.category).label)} · ${esc(p.text)}</span></div>
        <div class="fbl-clash-proposal-actions">
          <button class="fbl-clash-mini-btn" data-action="accept-proposal" data-proposal="${p.id}" data-position="before-active" title="${esc(localize("FBLClash.Queue.BeforeActive"))}"><i class="fa-solid fa-arrow-up"></i></button>
          <button class="fbl-clash-mini-btn primary" data-action="accept-proposal" data-proposal="${p.id}" data-position="after-active" title="${esc(localize("FBLClash.Queue.AfterActive"))}"><i class="fa-solid fa-plus"></i></button>
          <button class="fbl-clash-mini-btn" data-action="accept-proposal" data-proposal="${p.id}" data-position="end" title="${esc(localize("FBLClash.Queue.AtEnd"))}"><i class="fa-solid fa-arrow-down"></i></button>
          <button class="fbl-clash-mini-btn danger" data-action="reject-proposal" data-proposal="${p.id}" title="${esc(localize("FBLClash.Common.Reject"))}"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>`).join("")}</div>`;
  }

  queueHtml(state) {
    if (!state.queue?.length) return `<div class="fbl-clash-empty-state small"><i class="fa-solid fa-list-ol"></i><span>${esc(localize("FBLClash.Queue.Empty"))}</span></div>`;
    return `<div class="fbl-clash-queue-list">${state.queue.map((entry, index) => this.queueEntryHtml(state, entry, index)).join("")}</div>`;
  }

  queueEntryHtml(state, entry, index) {
    const classes = ["fbl-clash-queue-entry", entry.status, entry.simultaneous ? "simultaneous" : ""].filter(Boolean).join(" ");
    const actions = entry.actions.map((a) => {
      const cat = getCategory(a.category);
      return `<div class="fbl-clash-queue-action ${a.side}"><span class="fbl-clash-queue-who">${esc(state.sides[a.side]?.name ?? a.side)}</span><span class="fbl-clash-queue-cat"><i class="${esc(cat.icon)}"></i>${esc(cat.label)}</span><span class="fbl-clash-queue-text">${esc(a.text || localize("FBLClash.Common.NoText"))}</span></div>`;
    }).join(entry.simultaneous ? `<div class="fbl-clash-simul-mark"><i class="fa-solid fa-arrows-left-right"></i></div>` : "");

    return `<article class="${classes}" draggable="${game.user.isGM ? "true" : "false"}" data-queue-id="${entry.id}">
      <div class="fbl-clash-queue-index">${index + 1}</div>
      <div class="fbl-clash-queue-content">
        ${entry.label ? `<div class="fbl-clash-queue-label">${esc(entry.label)}</div>` : entry.stepIndex != null ? `<div class="fbl-clash-queue-label">${esc(t("FBLClash.Common.StepN", { n: entry.stepIndex + 1 }))}</div>` : ""}
        ${actions}
      </div>
      <div class="fbl-clash-queue-status"><span>${esc(localize(`FBLClash.Queue.Status.${entry.status}`))}</span></div>
      ${game.user.isGM ? `<div class="fbl-clash-queue-tools">
        <button class="fbl-clash-mini-btn" data-action="queue-up" data-queue-id="${entry.id}" title="${esc(localize("FBLClash.Common.Up"))}"><i class="fa-solid fa-chevron-up"></i></button>
        <button class="fbl-clash-mini-btn" data-action="queue-down" data-queue-id="${entry.id}" title="${esc(localize("FBLClash.Common.Down"))}"><i class="fa-solid fa-chevron-down"></i></button>
        ${entry.status !== "resolved" ? `<button class="fbl-clash-mini-btn primary" data-action="entry-resolve" data-queue-id="${entry.id}" title="${esc(localize("FBLClash.Common.Resolve"))}"><i class="fa-solid fa-check"></i></button>` : ""}
        ${!["skipped", "cancelled", "resolved"].includes(entry.status) ? `<button class="fbl-clash-mini-btn" data-action="entry-skip" data-queue-id="${entry.id}" title="${esc(localize("FBLClash.Common.Skip"))}"><i class="fa-solid fa-forward-step"></i></button>` : ""}
        ${!["cancelled", "resolved"].includes(entry.status) ? `<button class="fbl-clash-mini-btn danger" data-action="entry-cancel" data-queue-id="${entry.id}" title="${esc(localize("FBLClash.Common.CancelAction"))}"><i class="fa-solid fa-ban"></i></button>` : ""}
      </div>` : ""}
    </article>`;
  }

  playerExtraHtml(state) {
    if (!["locked", "resolving"].includes(state.status)) return "";
    const keys = controllerSideKeys(state);
    if (!keys.length || game.user.isGM) return "";
    return `<div class="fbl-clash-player-extra"><button class="fbl-clash-btn ghost full" data-action="propose-extra"><i class="fa-solid fa-plus"></i>${esc(localize("FBLClash.Common.ProposeExtra"))}</button></div>`;
  }

  activateEvents() {
    if (!this.root) return;
    this.root.querySelectorAll("[data-action]").forEach((el) => el.addEventListener("click", (ev) => this.onAction(ev)));
    this.root.querySelectorAll("[data-draft-text]").forEach((el) => el.addEventListener("input", (ev) => {
      const { side, stepId } = ev.currentTarget.dataset;
      this.drafts[side] ??= {};
      this.drafts[side][stepId] ??= defaultAction();
      this.drafts[side][stepId].text = ev.currentTarget.value;
    }));
    this.root.querySelectorAll("[data-draft-category]").forEach((el) => el.addEventListener("change", (ev) => {
      const { side, stepId } = ev.currentTarget.dataset;
      this.drafts[side] ??= {};
      this.drafts[side][stepId] ??= defaultAction();
      this.drafts[side][stepId].category = ev.currentTarget.value;
      const card = ev.currentTarget.closest(".fbl-clash-action-card");
      if (card) card.dataset.category = ev.currentTarget.value;
    }));
    this.root.querySelectorAll("[data-order-step]").forEach((el) => el.addEventListener("change", (ev) => this.manager.setStepOrder(ev.currentTarget.dataset.orderStep, ev.currentTarget.value)));

    if (game.user.isGM) {
      this.root.querySelectorAll("[draggable='true'][data-queue-id]").forEach((el) => {
        el.addEventListener("dragstart", (ev) => {
          this.dragQueueId = ev.currentTarget.dataset.queueId;
          ev.dataTransfer.effectAllowed = "move";
        });
        el.addEventListener("dragover", (ev) => {
          ev.preventDefault();
          ev.dataTransfer.dropEffect = "move";
        });
        el.addEventListener("drop", async (ev) => {
          ev.preventDefault();
          const target = ev.currentTarget.dataset.queueId;
          if (this.dragQueueId && target) await this.manager.reorderQueue(this.dragQueueId, target);
          this.dragQueueId = null;
        });
      });
    }
  }

  async onAction(ev) {
    ev.preventDefault();
    const el = ev.currentTarget.closest("[data-action]");
    const action = el.dataset.action;
    switch (action) {
      case "close-window":
        this.close();
        break;
      case "minimize":
        this.minimized = !this.minimized;
        this.render();
        break;
      case "launcher":
        await this.manager.openLauncher();
        break;
      case "open-viewers":
        this.manager.openForViewers();
        break;
      case "add-step":
        await this.manager.addStep();
        break;
      case "remove-step":
        await this.manager.removeStep(el.dataset.stepId);
        break;
      case "step-up":
        await this.manager.moveStep(el.dataset.stepId, -1);
        break;
      case "step-down":
        await this.manager.moveStep(el.dataset.stepId, 1);
        break;
      case "lock-side": {
        const sideKey = el.dataset.side;
        this.manager.requestLock(sideKey, deepClone(this.drafts[sideKey] ?? {}));
        break;
      }
      case "unlock-side":
        await this.manager.unlockSide(el.dataset.side);
        break;
      case "reveal-action":
        await this.manager.revealAction(el.dataset.stepId, el.dataset.side, { queue: true });
        break;
      case "reveal-next":
        await this.manager.revealNext();
        break;
      case "reveal-all":
        await this.manager.revealAll();
        break;
      case "resolve-next":
        await this.manager.resolveNext();
        break;
      case "queue-up":
        await this.manager.moveQueue(el.dataset.queueId, -1);
        break;
      case "queue-down":
        await this.manager.moveQueue(el.dataset.queueId, 1);
        break;
      case "entry-resolve":
        await this.manager.setEntryStatus(el.dataset.queueId, "resolved");
        break;
      case "entry-skip":
        await this.manager.setEntryStatus(el.dataset.queueId, "skipped");
        break;
      case "entry-cancel":
        await this.manager.setEntryStatus(el.dataset.queueId, "cancelled");
        break;
      case "add-extra":
        await this.openExtraModal(true);
        break;
      case "propose-extra":
        await this.openExtraModal(false);
        break;
      case "accept-proposal":
        await this.manager.acceptProposal(el.dataset.proposal, el.dataset.position);
        break;
      case "reject-proposal":
        await this.manager.rejectProposal(el.dataset.proposal);
        break;
      case "new-round": {
        const ok = await SimpleModal.confirm({
          title: localize("FBLClash.Common.NewRound"),
          content: localize("FBLClash.Common.NewRoundConfirm"),
          confirmLabel: localize("FBLClash.Common.StartRound")
        });
        if (ok) await this.manager.newRound();
        break;
      }
      case "finish":
        await this.manager.finish();
        break;
      case "post-summary":
        await this.manager.postSummary();
        break;
      case "archive-close":
        await this.manager.archiveAndClose();
        break;
    }
  }

  async openExtraModal(gmMode) {
    const state = this.manager.state;
    if (!state) return;
    const availableSides = gmMode ? ["left", "right"] : controllerSideKeys(state);
    if (!availableSides.length) return;
    const sideOptions = availableSides.map((k) => `<option value="${k}">${esc(state.sides[k].name)}</option>`).join("");
    const categoryOptions = getCategories().filter((c) => c.id !== "none").map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join("");
    const positionField = gmMode ? `<label class="fbl-clash-field"><span>${esc(localize("FBLClash.Queue.Position"))}</span><select name="position"><option value="before-active">${esc(localize("FBLClash.Queue.BeforeActive"))}</option><option value="after-active" selected>${esc(localize("FBLClash.Queue.AfterActive"))}</option><option value="end">${esc(localize("FBLClash.Queue.AtEnd"))}</option></select></label>` : "";
    const content = `<div class="fbl-clash-extra-form">
      <label class="fbl-clash-field"><span>${esc(localize("FBLClash.Common.Side"))}</span><select name="side">${sideOptions}</select></label>
      <label class="fbl-clash-field"><span>${esc(localize("FBLClash.Common.Category"))}</span><select name="category">${categoryOptions}</select></label>
      ${positionField}
      <label class="fbl-clash-field span-2"><span>${esc(localize("FBLClash.Common.Action"))}</span><textarea name="text" maxlength="1000" placeholder="${esc(localize("FBLClash.Common.ActionPlaceholder"))}"></textarea></label>
    </div>`;

    await SimpleModal.open({
      title: gmMode ? localize("FBLClash.Common.ExtraAction") : localize("FBLClash.Common.ProposeExtra"),
      content,
      buttons: [
        { label: localize("FBLClash.Common.Cancel"), onClick: (_d, done) => done(false) },
        {
          label: gmMode ? localize("FBLClash.Common.Add") : localize("FBLClash.Common.Send"),
          primary: true,
          onClick: async (dialog, done) => {
            const sideKey = dialog.querySelector('[name="side"]').value;
            const category = dialog.querySelector('[name="category"]').value;
            const text = dialog.querySelector('[name="text"]').value.trim();
            if (!text) {
              notify("warn", localize("FBLClash.Notifications.EnterAction"));
              return;
            }
            if (gmMode) await this.manager.addExtra({ sideKey, category, text, position: dialog.querySelector('[name="position"]').value });
            else this.manager.requestProposal(sideKey, category, text);
            done(true);
          }
        }
      ]
    });
  }
}

const manager = new ClashManager();

Hooks.once("init", () => {
  manager.registerSettings();
});

Hooks.once("ready", async () => {
  await manager.ready();
  console.log("FBL-Clash | Ready");
});
