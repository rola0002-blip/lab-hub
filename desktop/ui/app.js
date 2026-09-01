// LabHub desktop chrome rail. Plain JS on window.__TAURI__ (withGlobalTauri).
// Renders server list from config, handles add/remove/switch, badge events,
// and the Cmd/Ctrl+1..9 accelerators (v1 limitation: keys only reach this
// document while the rail webview has focus).

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const state = {
  servers: [],
  active: null,
  closeToTray: false,
  launchAtLogin: false,
};

const listEl = document.getElementById("server-list");
const addToggle = document.getElementById("add-toggle");
const addForm = document.getElementById("add-form");
const addUrl = document.getElementById("add-url");
const addSubmit = document.getElementById("add-submit");
const addError = document.getElementById("add-error");
const trayCheckbox = document.getElementById("close-to-tray");
const loginCheckbox = document.getElementById("launch-at-login");

const badgeListeners = new Map(); // server id -> unlisten fn

async function load() {
  const [servers, config] = await Promise.all([
    invoke("list_servers"),
    invoke("get_app_config"),
  ]);
  state.servers = servers;
  state.active = config.active_server;
  state.closeToTray = config.close_to_tray;
  state.launchAtLogin = await invoke("get_launch_at_login");
  render();
}

function initials(name) {
  const parts = String(name).split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return String(name).slice(0, 2).toUpperCase() || "?";
}

function discColor(id) {
  // Hue from the stable server id (uuid hex): first 8 hex chars -> 0..360.
  const int = parseInt(id.slice(0, 8), 16);
  const hue = Number.isNaN(int) ? 0 : int % 360;
  return `hsl(${hue}, 45%, 42%)`;
}

function render() {
  listEl.replaceChildren();

  for (const [index, server] of state.servers.entries()) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "server-row" + (server.id === state.active ? " active" : "");
    row.dataset.id = server.id;
    row.title = server.url;
    if (server.id === state.active) {
      row.setAttribute("aria-current", "true");
    }
    const hotkey = index < 9 ? ` (⌘${index + 1})` : "";
    row.setAttribute("aria-label", `Switch to ${server.name}${hotkey}`);

    const disc = document.createElement("span");
    disc.className = "disc";
    disc.style.background = discColor(server.id);
    disc.textContent = initials(server.name);

    const name = document.createElement("span");
    name.className = "server-name";
    name.textContent = server.name;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.dataset.unread = "";
    badge.hidden = true;
    badge.textContent = "";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-btn";
    remove.textContent = "⋯";
    remove.title = "Remove server";
    remove.setAttribute("aria-label", `Remove ${server.name}`);

    row.append(disc, name, badge, remove);
    listEl.append(row);
  }

  if (state.servers.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "No servers yet. Add one to get started.";
    listEl.append(hint);
  }

  trayCheckbox.checked = state.closeToTray;
  loginCheckbox.checked = state.launchAtLogin;
  syncBadgeListeners();
}

async function syncBadgeListeners() {
  const wanted = new Set(state.servers.map((s) => s.id));
  for (const [id, off] of badgeListeners) {
    if (!wanted.has(id)) {
      try {
        await off();
      } catch {
        /* webview going away */
      }
      badgeListeners.delete(id);
    }
  }
  for (const id of wanted) {
    if (badgeListeners.has(id)) continue;
    try {
      const off = await listen(`server-badge://${id}`, (event) => {
        const count = Number(event.payload) || 0;
        const badge = listEl.querySelector(
          `.server-row[data-id="${CSS.escape(id)}"] .badge`
        );
        if (!badge) return;
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.hidden = count <= 0;
      });
      badgeListeners.set(id, off);
    } catch (err) {
      console.error(`badge listener for ${id} failed`, err);
    }
  }
}

async function setActive(id) {
  if (id === state.active) return;
  try {
    await invoke("set_active", { id });
    // servers-changed event triggers the re-render.
  } catch (err) {
    console.error("set_active failed", err);
  }
}

async function removeServer(id, name) {
  if (!confirm(`Remove server "${name}"?`)) return;
  try {
    await invoke("remove_server", { id });
  } catch (err) {
    console.error("remove_server failed", err);
  }
}

listEl.addEventListener("click", (event) => {
  const row = event.target.closest(".server-row");
  if (!row) return;
  const server = state.servers.find((s) => s.id === row.dataset.id);
  if (!server) return;
  if (event.target.closest(".remove-btn")) {
    removeServer(server.id, server.name);
  } else {
    setActive(server.id);
  }
});

listEl.addEventListener("contextmenu", (event) => {
  const row = event.target.closest(".server-row");
  if (!row) return;
  event.preventDefault();
  const server = state.servers.find((s) => s.id === row.dataset.id);
  if (server) removeServer(server.id, server.name);
});

addToggle.addEventListener("click", () => {
  const open = addForm.hidden;
  addForm.hidden = !open;
  addToggle.setAttribute("aria-expanded", String(open));
  if (open) addUrl.focus();
  else setAddError(null);
});

function setAddError(message) {
  addError.hidden = !message;
  addError.textContent = message || "";
}

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (addSubmit.disabled) return;
  const url = addUrl.value.trim();
  if (!url) {
    setAddError("Enter a server URL");
    addUrl.focus();
    return;
  }
  addSubmit.disabled = true;
  addUrl.disabled = true;
  setAddError(null);
  try {
    await invoke("add_server", { url });
    addUrl.value = "";
    addForm.hidden = true;
    addToggle.setAttribute("aria-expanded", "false");
    addToggle.focus();
  } catch (err) {
    setAddError(String(err));
    addUrl.focus();
  } finally {
    addSubmit.disabled = false;
    addUrl.disabled = false;
  }
});

trayCheckbox.addEventListener("change", async () => {
  try {
    await invoke("set_close_to_tray", { v: trayCheckbox.checked });
  } catch (err) {
    console.error("set_close_to_tray failed", err);
    trayCheckbox.checked = !trayCheckbox.checked;
  }
});

loginCheckbox.addEventListener("change", async () => {
  try {
    await invoke("set_launch_at_login", { v: loginCheckbox.checked });
  } catch (err) {
    console.error("set_launch_at_login failed", err);
    loginCheckbox.checked = !loginCheckbox.checked;
  }
});

// Cmd/Ctrl+1..9 switches servers. v1 limitation: only fires while the rail
// webview itself has keyboard focus (content webviews keep their keys).
document.addEventListener("keydown", (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
  const index = Number(event.key) - 1;
  if (!Number.isInteger(index) || index < 0 || index > 8) return;
  const server = state.servers[index];
  if (server) {
    event.preventDefault();
    setActive(server.id);
  }
});

listen("servers-changed", () => {
  load().catch((err) => console.error("reload after servers-changed failed", err));
});

window.__TAURI__.app
  .getVersion()
  .then((version) => {
    document.getElementById("header-version").textContent = `v${version}`;
    document.getElementById("footer-version").textContent = `LabHub Desktop v${version}`;
  })
  .catch((err) => console.error("getVersion failed", err));

load().catch((err) => console.error("initial load failed", err));
