function defaultWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/claweb/ws`;
}

function safeRandomId(prefix = "msg") {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

const state = {
  ws: null,
  ready: false,
  session: null,
  pendingById: new Map(),
  renderedMessageKeys: new Set(),
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
};

function setStatus(text, cls) {
  el.status.textContent = text;
  el.status.className = `status ${cls}`;
}

function setLoginError(msg = "") {
  el.loginError.textContent = msg;
}

function addMessage(role, text, meta = "") {
  const node = document.createElement("div");
  node.className = `msg msg-${role}`;
  node.textContent = text;

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
  const replyIds = [frame.replyTo, frame.parentId].map(normalizeId).filter(Boolean);
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
  };
}

function renderNormalizedMessage(message) {
  if (!message) return false;
  if (isMessageRendered(message)) return false;
  addMessage(message.role, message.text);
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
    const resp = await fetch(`/claweb/history?${query.toString()}`, {
      headers: {
        "x-claweb-token": String(state.session.token || ""),
      },
    });

    let data = null;
    try {
      data = await resp.json();
    } catch {
      // ignore invalid json
    }

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
        ts: item?.ts,
      });
      if (renderNormalizedMessage(normalized)) restored += 1;
    }
    addMessage("system", `Restored ${restored} recent message(s).`);
  } catch {
    addMessage("system", "Network error while loading history.");
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
    const resp = await fetch("/claweb/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });

    let data = null;
    try {
      data = await resp.json();
    } catch {
      // ignore invalid json
    }

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
      if (frame.id && state.pendingById.has(frame.id)) {
        const pending = state.pendingById.get(frame.id);
        markPending(pending.metaNode, "failed");
        state.pendingById.delete(frame.id);
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

  const id = safeRandomId("msg");
  const ts = Date.now();
  const localMessage = {
    role: "user",
    text,
    messageId: id,
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
    timestamp: ts,
  };

  try {
    state.ws.send(JSON.stringify(frame));
    el.input.value = "";
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
  el.messages.innerHTML = "";
  setStatus("Offline", "status-offline");
  showLoginPanel();
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
