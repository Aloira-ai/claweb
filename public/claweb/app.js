// Canonical endpoints are short-path: /login /history /ws
// Compat endpoints (optional): /claweb/login /claweb/history /claweb/ws

function defaultWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

function safeRandomId(prefix = "msg") {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function nextMessageId(clientId) {
  const cid = String(clientId || "").trim() || "client";
  const ts = Date.now();

  // Prefer a monotonic, per-client id to make dedupe stable across refresh.
  try {
    const key = `claweb:counter:${cid}`;
    const prev = Number(window.localStorage.getItem(key) || "0");
    const next = Number.isFinite(prev) ? prev + 1 : 1;
    window.localStorage.setItem(key, String(next));
    return `${cid}:${next}:${ts}`;
  } catch {
    return safeRandomId(`msg-${cid}`);
  }
}

async function fetchJsonWithFallback(primaryUrl, fallbackUrl, options) {
  const resp1 = await fetch(primaryUrl, options);
  if (resp1.status !== 404) {
    return { resp: resp1, data: await tryReadJson(resp1) };
  }
  const resp2 = await fetch(fallbackUrl, options);
  return { resp: resp2, data: await tryReadJson(resp2) };
}

async function tryReadJson(resp) {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

const state = {
  ws: null,
  ready: false,
  session: null,
  pendingById: new Map(),
  renderedMessageKeys: new Set(),
  threads: null,
  switchTarget: null,
  messageIndex: new Map(), // messageId -> { text, node }
  assistantName: null,
  composingReplyTo: null,
};

const el = {
  loginPanel: document.getElementById("login-panel"),
  chatPanel: document.getElementById("chat-panel"),
  passphrase: document.getElementById("passphrase-input"),
  loginBtn: document.getElementById("login-btn"),
  loginError: document.getElementById("login-error"),
  sessionDesc: document.getElementById("session-desc"),
  status: document.getElementById("conn-status"),
  messages: document.getElementById("messages"),
  input: document.getElementById("message-input"),
  sendBtn: document.getElementById("send-btn"),
  disconnectBtn: document.getElementById("disconnect-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  threadsBtn: document.getElementById("threads-btn"),
  threadsModal: document.getElementById("threads-modal"),
  threadsClose: document.getElementById("threads-close"),
  threadsList: document.getElementById("threads-list"),
  searchInput: document.getElementById("search-input"),
  searchClear: document.getElementById("search-clear"),
  searchResults: document.getElementById("search-results"),
  replyBanner: document.getElementById("reply-banner"),
  replyBannerText: document.getElementById("reply-banner-text"),
  replyCancel: document.getElementById("reply-cancel"),
  msgMenu: document.getElementById("msg-menu"),
  msgMenuReply: document.getElementById("msg-menu-reply"),
  msgMenuCopy: document.getElementById("msg-menu-copy"),
};

function setStatus(text, cls) {
  el.status.textContent = text;
  el.status.className = `status ${cls}`;
}

function setLoginError(msg = "") {
  el.loginError.textContent = msg;
}

function addMessage(role, text, meta = "") {
  return addMessageRich({ role, text, meta });
}

function hideMsgMenu() {
  if (!el.msgMenu) return;
  el.msgMenu.classList.add("hidden");
  el.msgMenu.setAttribute("aria-hidden", "true");
  el.msgMenu.style.left = "";
  el.msgMenu.style.top = "";
  el.msgMenu.dataset.messageId = "";
  el.msgMenu.dataset.messageText = "";
}

function showMsgMenu({ x, y, messageId, messageText }) {
  if (!el.msgMenu) return;
  const mx = Math.max(8, Math.min(window.innerWidth - 160, x));
  const my = Math.max(8, Math.min(window.innerHeight - 120, y));

  el.msgMenu.style.left = `${mx}px`;
  el.msgMenu.style.top = `${my}px`;
  el.msgMenu.dataset.messageId = String(messageId || "");
  el.msgMenu.dataset.messageText = String(messageText || "");
  el.msgMenu.classList.remove("hidden");
  el.msgMenu.setAttribute("aria-hidden", "false");
}

function addMessageRich({ role, text, meta = "", messageId = null, replyTo = null }) {
  const node = document.createElement("div");
  node.className = `msg msg-${role}`;

  if (messageId) node.dataset.messageId = messageId;

  // Right-click / long-press menu (Reply/Copy)
  if (messageId && role !== "system") {
    node.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMsgMenu({ x: e.clientX, y: e.clientY, messageId, messageText: text });
    });

    let longPressTimer = null;
    let touchStartX = 0;
    let touchStartY = 0;

    node.addEventListener(
      "touchstart",
      (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        longPressTimer = window.setTimeout(() => {
          showMsgMenu({ x: touchStartX, y: touchStartY, messageId, messageText: text });
        }, 550);
      },
      { passive: true },
    );

    const cancelLongPress = () => {
      if (longPressTimer) window.clearTimeout(longPressTimer);
      longPressTimer = null;
    };

    node.addEventListener("touchend", cancelLongPress, { passive: true });
    node.addEventListener("touchcancel", cancelLongPress, { passive: true });
    node.addEventListener(
      "touchmove",
      (e) => {
        if (!longPressTimer) return;
        if (!e.touches || e.touches.length !== 1) return;
        const t = e.touches[0];
        const dx = Math.abs(t.clientX - touchStartX);
        const dy = Math.abs(t.clientY - touchStartY);
        if (dx > 12 || dy > 12) cancelLongPress();
      },
      { passive: true },
    );
  }

  const normalizedReplyTo = normalizeId(replyTo);
  if (normalizedReplyTo) {
    const quote = document.createElement("div");
    quote.className = "quote";
    quote.tabIndex = 0;

    const quoted = state.messageIndex.get(normalizedReplyTo);
    const quotedText = quoted?.text ? String(quoted.text) : "(message not in view)";

    quote.textContent = `Reply to: ${quotedText.slice(0, 140)}`;

    const jump = () => {
      const target = state.messageIndex.get(normalizedReplyTo)?.node;
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    };

    quote.addEventListener("click", jump);
    quote.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") jump();
    });

    node.appendChild(quote);
  }

  const body = document.createElement("div");
  body.className = "msg-body";
  body.textContent = text;
  node.appendChild(body);

  if (meta) {
    const metaNode = document.createElement("div");
    metaNode.className = "meta";
    metaNode.textContent = meta;
    node.appendChild(metaNode);
  }

  el.messages.appendChild(node);
  el.messages.scrollTop = el.messages.scrollHeight;
  return node;
}

function markPending(metaNode, status) {
  if (!metaNode) return;
  metaNode.classList.remove("pending", "failed");
  if (status === "pending") {
    metaNode.classList.add("pending");
    metaNode.textContent = "Sending...";
  } else if (status === "failed") {
    metaNode.classList.add("failed");
    metaNode.textContent = "Send failed";
  } else {
    metaNode.textContent = "Delivered";
  }
}

function closeSocket() {
  if (!state.ws) return;
  try {
    state.ws.close();
  } catch {
    // ignore
  }
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showSearchResults() {
  if (!el.searchResults) return;
  el.searchResults.classList.remove("hidden");
}

function hideSearchResults() {
  if (!el.searchResults) return;
  el.searchResults.classList.add("hidden");
  el.searchResults.innerHTML = "";
}

function renderSearchResults(results, query) {
  if (!el.searchResults) return;
  if (!results.length) {
    el.searchResults.innerHTML = `<div class="subtitle">No results for “${escapeHtml(query)}”.</div>`;
    showSearchResults();
    return;
  }

  const nameOf = (role) => {
    if (role === "user") {
      return state.session?.displayName || state.session?.identity || "You";
    }
    if (role === "assistant") {
      return state.assistantName || window.CLAWEB_ASSISTANT_NAME || "Assistant";
    }
    return "System";
  };

  const items = results
    .slice(0, 20)
    .map((r) => {
      const who = escapeHtml(nameOf(r.role));
      const snippet = escapeHtml(r.text);
      return `
        <div class="search-hit" data-mid="${escapeHtml(r.messageId)}">
          <div class="search-hit-title">${who}</div>
          <div class="search-hit-snippet">${snippet}</div>
        </div>
      `.trim();
    })
    .join("");

  el.searchResults.innerHTML = items;
  showSearchResults();

  el.searchResults.querySelectorAll(".search-hit").forEach((node) => {
    node.addEventListener("click", () => {
      const mid = normalizeId(node.getAttribute("data-mid"));
      const target = mid ? state.messageIndex.get(mid)?.node : null;
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
  });
}

function runLocalSearch(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];

  const results = [];
  for (const [messageId, rec] of state.messageIndex.entries()) {
    const text = String(rec?.text || "");
    if (!text) continue;
    if (!text.toLowerCase().includes(q)) continue;

    const node = rec?.node;
    const role = node?.classList?.contains("msg-user")
      ? "user"
      : node?.classList?.contains("msg-assistant")
        ? "assistant"
        : "system";

    results.push({ messageId, role, text });
  }

  return results;
}

function normalizeWsUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return defaultWsUrl();
  if (raw.startsWith("ws://") || raw.startsWith("wss://")) return raw;
  if (raw.startsWith("/")) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}${raw}`;
  }
  return defaultWsUrl();
}

function showChatPanel(session) {
  el.loginPanel.classList.add("hidden");
  el.chatPanel.classList.remove("hidden");
  const roomLabel = session.roomId ? `room=${session.roomId}` : "room=direct";
  el.sessionDesc.textContent = `${session.displayName || session.identity} | user=${session.userId} | ${roomLabel}`;
  el.input.focus();
}

function showLoginPanel() {
  el.chatPanel.classList.add("hidden");
  el.loginPanel.classList.remove("hidden");
  el.passphrase.value = "";
  setLoginError("");
  el.passphrase.focus();
}

function mapLoginError(errorCode) {
  if (errorCode === "invalid_credentials") return "Invalid passphrase.";
  if (errorCode === "missing_passphrase") return "Passphrase is required.";
  if (errorCode === "ambiguous_passphrase") return "Passphrase mapping conflict on server.";
  if (errorCode === "too_many_attempts") return "Too many attempts. Try again later.";
  if (errorCode === "login_not_configured") return "Server login mapping is not configured.";
  return "Login failed. Please try again.";
}

function mapRole(role) {
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  return "system";
}

function parseMessageRole(role) {
  if (role === "user" || role === "assistant" || role === "system") return role;
  return null;
}

function normalizeText(text) {
  return String(text == null ? "" : text).trim();
}

function normalizeId(value) {
  const id = String(value == null ? "" : value).trim();
  return id || null;
}

function normalizeTs(value) {
  const ts = Number(value);
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

function buildMessageKey(message) {
  if (!message) return null;
  if (message.messageId) {
    return `id:${message.role}:${message.messageId}`;
  }
  if (message.ts) {
    return `ts:${message.role}:${message.ts}:${message.text}`;
  }
  return null;
}

function markMessageRendered(message) {
  const key = buildMessageKey(message);
  if (key) state.renderedMessageKeys.add(key);
}

function isMessageRendered(message) {
  const key = buildMessageKey(message);
  return key ? state.renderedMessageKeys.has(key) : false;
}

function normalizeIncomingMessage(frame) {
  if (!frame || frame.type !== "message") return null;

  const text = normalizeText(frame.text);
  if (!text) return null;

  const explicitRole = ["role", "senderRole", "authorRole", "sender"]
    .map((key) => parseMessageRole(frame[key]))
    .find(Boolean);

  const frameId = normalizeId(frame.id || frame.messageId);
  const replyTo = normalizeId(frame.replyTo || frame.parentId);
  const replyIds = [replyTo].map(normalizeId).filter(Boolean);
  const linkedPendingId = [frameId, ...replyIds].find((id) => id && state.pendingById.has(id)) || null;
  const linkedPending = linkedPendingId ? state.pendingById.get(linkedPendingId) : null;

  let role = explicitRole || "assistant";
  if (!explicitRole && linkedPending) {
    role = normalizeText(linkedPending.text) === text ? "user" : "assistant";
  }

  return {
    role,
    text,
    messageId: frameId,
    ts: normalizeTs(frame.ts || frame.timestamp),
    pendingId: linkedPendingId,
    replyTo: replyTo || null,
  };
}

function renderNormalizedMessage(message) {
  if (!message) return false;
  if (isMessageRendered(message)) return false;

  const node = addMessageRich({
    role: message.role,
    text: message.text,
    messageId: message.messageId,
    replyTo: message.replyTo,
  });

  if (message.messageId) {
    state.messageIndex.set(message.messageId, { text: message.text, node });
  }

  markMessageRendered(message);
  return true;
}

async function loadRecentHistory() {
  if (!state.session) return;

  try {
    const query = new URLSearchParams({
      userId: String(state.session.userId || ""),
      roomId: String(state.session.roomId || ""),
      clientId: String(state.session.clientId || ""),
      limit: "60",
    });
    const url1 = `/history?${query.toString()}`;
    const url2 = `/claweb/history?${query.toString()}`;
    const { resp, data } = await fetchJsonWithFallback(url1, url2, {
      headers: {
        "x-claweb-token": String(state.session.token || ""),
      },
    });

    if (!resp.ok || !data?.ok || !Array.isArray(data.messages)) {
      addMessage("system", "Failed to load history. Starting from new messages.");
      return;
    }

    if (!data.messages.length) {
      addMessage("system", "No previous history for this session.");
      return;
    }

    let restored = 0;
    for (const item of data.messages) {
      const normalized = normalizeIncomingMessage({
        type: "message",
        role: mapRole(item?.role),
        text: item?.text,
        messageId: item?.messageId,
        replyTo: item?.replyTo,
        ts: item?.ts,
      });
      if (renderNormalizedMessage(normalized)) restored += 1;
    }
    addMessage("system", `Restored ${restored} recent message(s).`);
  } catch {
    addMessage("system", "Network error while loading history.");
  }
}

async function loadUiConfig() {
  try {
    const { resp, data } = await fetchJsonWithFallback("/config", "/claweb/config", { method: "GET" });
    if (resp.ok && data?.ok) {
      state.assistantName = data.assistantName ? String(data.assistantName) : null;
    }
  } catch {
    // ignore
  }
}

async function login() {
  const passphrase = el.passphrase.value.trim();
  if (!passphrase) {
    setLoginError("Passphrase is required.");
    return;
  }

  setLoginError("");
  el.loginBtn.disabled = true;

  try {
    const { resp, data } = await fetchJsonWithFallback("/login", "/claweb/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });

    if (!resp.ok || !data?.ok || !data?.session) {
      setLoginError(mapLoginError(data?.error));
      return;
    }

    const session = {
      ...data.session,
      wsUrl: normalizeWsUrl(data.session.wsUrl),
      clientId: String(data.session.clientId || ""),
    };

    if (!session.clientId) {
      setLoginError("Server session identity is missing.");
      return;
    }

    if (state.switchTarget && session.identity && session.identity !== state.switchTarget) {
      setLoginError(`Logged in as ${session.identity}, expected ${state.switchTarget}.`);
      state.session = null;
      return;
    }

    state.switchTarget = null;
    await loadUiConfig();
    state.session = session;
    state.renderedMessageKeys.clear();
    el.messages.innerHTML = "";
    showChatPanel(session);
    addMessage("system", "Login succeeded. Loading recent history...");
    await loadRecentHistory();
    addMessage("system", "Connecting to claweb...");
    connect();
  } catch {
    setLoginError("Network error. Please try again.");
  } finally {
    el.loginBtn.disabled = false;
  }
}

function connect() {
  if (!state.session) {
    setLoginError("Missing session info. Please login again.");
    showLoginPanel();
    return;
  }

  closeSocket();
  setStatus("Connecting", "status-connecting");
  state.ready = false;

  let ws;
  try {
    ws = new WebSocket(state.session.wsUrl);
  } catch {
    setStatus("Connection failed", "status-offline");
    addMessage("system", "Unable to create WebSocket.");
    return;
  }

  state.ws = ws;

  ws.addEventListener("open", () => {
    const hello = {
      type: "hello",
      token: state.session.token,
      clientId: state.session.clientId,
      userId: state.session.userId,
      roomId: state.session.roomId || undefined,
    };
    ws.send(JSON.stringify(hello));
  });

  ws.addEventListener("message", (event) => {
    let frame;
    try {
      frame = JSON.parse(String(event.data));
    } catch {
      addMessage("system", "Received an invalid server frame.");
      return;
    }

    if (frame.type === "ready") {
      state.ready = true;
      setStatus("Online", "status-online");
      addMessage("system", `claweb ready (${frame.serverVersion || "unknown"})`);
      return;
    }

    if (frame.type === "message") {
      const normalized = normalizeIncomingMessage(frame);
      if (!normalized) return;

      renderNormalizedMessage(normalized);

      if (normalized.role === "assistant" && normalized.pendingId) {
        const pending = state.pendingById.get(normalized.pendingId);
        if (pending) {
          markPending(pending.metaNode, "sent");
          state.pendingById.delete(normalized.pendingId);
        }
      }
      return;
    }

    if (frame.type === "error") {
      const reason = frame.message || "unknown error";
      addMessage("system", `Server error: ${reason}`);
      const pendingCandidates = [frame.id, frame.replyTo, frame.parentId]
        .map(normalizeId)
        .filter(Boolean);
      for (const cid of pendingCandidates) {
        if (!state.pendingById.has(cid)) continue;
        const pending = state.pendingById.get(cid);
        markPending(pending.metaNode, "failed");
        state.pendingById.delete(cid);
        break;
      }
      if (reason.toLowerCase().includes("auth") || reason.toLowerCase().includes("token")) {
        setStatus("Auth failed", "status-offline");
      }
      return;
    }

    addMessage("system", `Unsupported frame type: ${frame.type || "unknown"}`);
  });

  ws.addEventListener("close", () => {
    setStatus("Disconnected", "status-offline");
    state.ready = false;

    for (const pending of state.pendingById.values()) {
      markPending(pending.metaNode, "failed");
    }
    state.pendingById.clear();
  });

  ws.addEventListener("error", () => {
    addMessage("system", "Connection error occurred.");
  });
}

function sendCurrentMessage() {
  const text = el.input.value.trim();
  if (!text) return;
  if (!state.ws || !state.ready) {
    addMessage("system", "Not connected yet. Try again in a moment.");
    return;
  }

  const ts = Date.now();
  const id = nextMessageId(state.session && state.session.clientId);
  const localMessage = {
    role: "user",
    text,
    messageId: id,
    replyTo: state.composingReplyTo,
    ts,
  };
  renderNormalizedMessage(localMessage);
  const msgNode = el.messages.lastElementChild;
  const metaNode = document.createElement("div");
  metaNode.className = "meta pending";
  metaNode.textContent = "Sending...";
  if (msgNode) msgNode.appendChild(metaNode);
  state.pendingById.set(id, { metaNode, text });

  const frame = {
    type: "message",
    id,
    text,
    replyTo: state.composingReplyTo || undefined,
    timestamp: ts,
  };

  try {
    state.ws.send(JSON.stringify(frame));
    el.input.value = "";
    // clear reply mode after send
    state.composingReplyTo = null;
    el.replyBanner?.classList.add("hidden");
    if (el.replyBannerText) el.replyBannerText.textContent = "";
    el.input.focus();
  } catch {
    markPending(metaNode, "failed");
    state.pendingById.delete(id);
  }
}

function logout() {
  closeSocket();
  state.session = null;
  state.ready = false;
  state.pendingById.clear();
  state.renderedMessageKeys.clear();
  state.messageIndex.clear();
  state.composingReplyTo = null;
  el.replyBanner?.classList.add("hidden");
  if (el.replyBannerText) el.replyBannerText.textContent = "";
  el.messages.innerHTML = "";
  setStatus("Offline", "status-offline");
  showLoginPanel();
}

function showThreadsModal() {
  if (!el.threadsModal) return;
  el.threadsModal.classList.remove("hidden");
  el.threadsModal.setAttribute("aria-hidden", "false");
  try {
    el.threadsClose?.focus();
  } catch {
    // ignore
  }
}

function hideThreadsModal() {
  if (!el.threadsModal) return;
  el.threadsModal.classList.add("hidden");
  el.threadsModal.setAttribute("aria-hidden", "true");
  try {
    el.threadsBtn?.focus();
  } catch {
    // ignore
  }
}

function isThreadsModalOpen() {
  return !!el.threadsModal && !el.threadsModal.classList.contains("hidden");
}

async function loadThreads() {
  if (!state.session) throw new Error("not_logged_in");

  const { resp, data } = await fetchJsonWithFallback(
    "/threads",
    "/claweb/threads",
    {
      method: "GET",
      headers: {
        "x-claweb-token": state.session.token,
      },
    },
  );

  if (!resp.ok || !data || data.ok !== true) {
    throw new Error(data?.error || `threads_failed_${resp.status}`);
  }

  state.threads = Array.isArray(data.threads) ? data.threads : [];
  return state.threads;
}

function renderThreadsList(threads) {
  if (!el.threadsList) return;
  el.threadsList.innerHTML = "";

  if (!threads || threads.length === 0) {
    const empty = document.createElement("div");
    empty.className = "subtitle";
    empty.textContent = "No threads available.";
    el.threadsList.appendChild(empty);
    return;
  }

  for (const t of threads) {
    const item = document.createElement("div");
    item.className = "thread-item";

    const meta = document.createElement("div");
    meta.className = "thread-meta";

    const title = document.createElement("div");
    title.className = "thread-title";
    title.textContent = t.displayName || t.identity || t.userId || "thread";

    const sub = document.createElement("div");
    sub.className = "thread-sub";
    sub.textContent = `${t.userId || ""} / ${t.roomId || ""} / ${t.clientId || ""}`;

    meta.appendChild(title);
    meta.appendChild(sub);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost";
    btn.textContent = state.session && t.identity === state.session.identity ? "Current" : "Switch";
    btn.disabled = state.session && t.identity === state.session.identity;

    btn.addEventListener("click", () => {
      // Switching identity requires a new login token.
      state.switchTarget = t.identity || null;
      hideThreadsModal();
      logout();
      if (el.passphrase) {
        el.passphrase.value = "";
        el.passphrase.focus();
      }
      setLoginError(`Switching to ${t.displayName || t.identity}. Please enter passphrase.`);
    });

    item.appendChild(meta);
    item.appendChild(btn);
    el.threadsList.appendChild(item);
  }
}

showLoginPanel();
setStatus("Offline", "status-offline");

el.loginBtn.addEventListener("click", login);
el.passphrase.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    login();
  }
});
el.sendBtn.addEventListener("click", sendCurrentMessage);
el.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendCurrentMessage();
  }
});
el.disconnectBtn.addEventListener("click", closeSocket);
el.logoutBtn.addEventListener("click", logout);

if (el.replyCancel) {
  el.replyCancel.addEventListener("click", () => {
    state.composingReplyTo = null;
    el.replyBanner?.classList.add("hidden");
    if (el.replyBannerText) el.replyBannerText.textContent = "";
    el.input?.focus();
  });
}

// message menu actions
if (el.msgMenuReply) {
  el.msgMenuReply.addEventListener("click", () => {
    const messageId = String(el.msgMenu?.dataset?.messageId || "").trim();
    const messageText = String(el.msgMenu?.dataset?.messageText || "");
    if (!messageId) return;
    state.composingReplyTo = messageId;
    const snippet = messageText.slice(0, 140);
    if (el.replyBannerText) el.replyBannerText.textContent = `Replying to: ${snippet}`;
    el.replyBanner?.classList.remove("hidden");
    hideMsgMenu();
    el.input?.focus();
  });
}

if (el.msgMenuCopy) {
  el.msgMenuCopy.addEventListener("click", async () => {
    const messageText = String(el.msgMenu?.dataset?.messageText || "");
    hideMsgMenu();
    try {
      await navigator.clipboard.writeText(messageText);
      addMessage("system", "Copied.");
    } catch {
      // best-effort fallback
      try {
        const ta = document.createElement("textarea");
        ta.value = messageText;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        addMessage("system", "Copied.");
      } catch {
        addMessage("system", "Copy failed.");
      }
    }
  });
}

// dismiss menu on outside interaction
window.addEventListener(
  "click",
  (e) => {
    if (!el.msgMenu || el.msgMenu.classList.contains("hidden")) return;
    const target = e.target;
    if (target && el.msgMenu.contains(target)) return;
    hideMsgMenu();
  },
  { capture: true },
);

window.addEventListener(
  "scroll",
  () => {
    if (!el.msgMenu || el.msgMenu.classList.contains("hidden")) return;
    hideMsgMenu();
  },
  { passive: true },
);

if (el.searchInput) {
  const onSearch = () => {
    const q = String(el.searchInput.value || "").trim();
    if (!q) {
      hideSearchResults();
      return;
    }
    const results = runLocalSearch(q);
    renderSearchResults(results, q);
  };

  el.searchInput.addEventListener("input", onSearch);
  el.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSearch();
    } else if (e.key === "Escape") {
      hideSearchResults();
      el.searchInput.value = "";
      el.searchInput.blur();
    }
  });
}

if (el.searchClear) {
  el.searchClear.addEventListener("click", () => {
    if (el.searchInput) el.searchInput.value = "";
    hideSearchResults();
    el.searchInput?.focus();
  });
}

if (el.threadsBtn) {
  el.threadsBtn.addEventListener("click", async () => {
    if (!state.session) {
      addMessage("system", "Please login first.");
      return;
    }

    // Toggle behavior: if it's already open, close it.
    if (isThreadsModalOpen()) {
      hideThreadsModal();
      return;
    }

    showThreadsModal();
    el.threadsList.textContent = "Loading...";
    try {
      const threads = await loadThreads();
      renderThreadsList(threads);
    } catch (e) {
      el.threadsList.textContent = "Failed to load threads.";
      addMessage("system", `Threads error: ${String(e?.message || e)}`);
    }
  });
}

if (el.threadsClose) {
  const onClose = (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideThreadsModal();
  };
  el.threadsClose.addEventListener("click", onClose);
  el.threadsClose.addEventListener("touchstart", onClose, { passive: false });
}

if (el.threadsModal) {
  const onBackdrop = (e) => {
    if (e.target === el.threadsModal) hideThreadsModal();
  };
  el.threadsModal.addEventListener("click", onBackdrop);
  // Mobile hardening: some webviews are flaky with click; ensure touch also closes.
  el.threadsModal.addEventListener("touchstart", onBackdrop, { passive: true });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isThreadsModalOpen()) {
    hideThreadsModal();
  }
});
