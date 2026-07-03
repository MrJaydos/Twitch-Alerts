// Settings dashboard: loads config, renders an editor per alert type, saves
// back to the server, and fires test alerts.

const ALERT_META = {
  follow: { label: "Follow", tokens: "{name}" },
  sub: { label: "Subscriber", tokens: "{name} {tier} {months}" },
  resub: { label: "Resub", tokens: "{name} {tier} {months} {streak}" },
  giftsub: { label: "Gifted Sub", tokens: "{gifter} {name} {recipient} {tier}" },
  giftbomb: { label: "Gift Bomb", tokens: "{gifter} {count} {tier}" },
  cheer: { label: "Cheer / Bits", tokens: "{name} {bits}" },
  raid: { label: "Raid", tokens: "{name} {viewers}" }
};

let config = null;

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function el(sel, root = document) {
  return root.querySelector(sel);
}

function renderAlertCards() {
  const container = el("#alerts");
  container.innerHTML = "";
  const tpl = el("#alert-card");
  for (const key of Object.keys(config.alerts)) {
    const meta = ALERT_META[key] || { label: key, tokens: "" };
    const node = tpl.content.cloneNode(true);
    const a = config.alerts[key];

    el(".alert-name", node).textContent = meta.label;
    el(".tokens", node).textContent = "Tokens: " + meta.tokens;
    el(".f-enabled", node).checked = a.enabled !== false;
    el(".f-title", node).value = a.title || "";
    el(".f-message", node).value = a.message || "";
    el(".f-duration", node).value = a.duration || 6000;
    el(".f-accentColor", node).value = a.accentColor || "#9147ff";
    el(".f-textColor", node).value = a.textColor || "#ffffff";
    el(".f-soundVolume", node).value = a.soundVolume ?? 0.7;
    el(".f-image", node).value = a.image || "";
    el(".f-sound", node).value = a.sound || "";

    const card = el(".alert-card", node);
    card.dataset.key = key;
    el(".test-btn", node).addEventListener("click", () => testAlert(key));
    container.appendChild(node);
  }
}

function collectFromDom() {
  config.channel = el("#channel").value.trim();
  config.treatGiftedAsSub = el("#treatGiftedAsSub").checked;
  config.twitch = config.twitch || {};
  config.twitch.clientId = el("#tw-client-id").value.trim();
  config.twitch.publicUrl = el("#tw-public-url").value.trim();
  const secret = el("#tw-client-secret").value.trim();
  if (secret) config.twitch.clientSecret = secret;
  for (const card of document.querySelectorAll(".alert-card")) {
    const key = card.dataset.key;
    const a = config.alerts[key];
    a.enabled = el(".f-enabled", card).checked;
    a.title = el(".f-title", card).value;
    a.message = el(".f-message", card).value;
    a.duration = Number(el(".f-duration", card).value) || 6000;
    a.accentColor = el(".f-accentColor", card).value;
    a.textColor = el(".f-textColor", card).value;
    a.soundVolume = Number(el(".f-soundVolume", card).value);
    a.image = el(".f-image", card).value.trim();
    a.sound = el(".f-sound", card).value.trim();
  }
}

async function save() {
  collectFromDom();
  config = await api("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config)
  });
  const msg = el("#save-msg");
  msg.textContent = "Saved ✓";
  setTimeout(() => (msg.textContent = ""), 2000);
  refreshStatus();
}

async function testAlert(type) {
  // Save first so the preview reflects unsaved edits.
  collectFromDom();
  await api("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config)
  });
  await api("/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type })
  });
}

async function refreshStatus() {
  const node = el("#status");
  try {
    const s = await api("/api/status");
    const chat = s.chat || {};
    if (!chat.channel) {
      node.textContent = "no channel set";
      node.className = "status";
    } else if (chat.status === "connected") {
      node.textContent = `connected to #${chat.channel}`;
      node.className = "status connected";
    } else {
      node.textContent = `${chat.status}…`;
      node.className = "status";
    }

    // Redirect URL for the Twitch app (built from how you're reaching this page).
    if (s.redirectUri) el("#redirect-uri").value = s.redirectUri;

    // Follow / EventSub connection status.
    const f = s.follows || {};
    const fNode = el("#follow-status");
    const connectBtn = el("#follow-connect");
    const disconnectBtn = el("#follow-disconnect");
    if (f.status === "connected") {
      fNode.textContent = f.detail || `follow alerts active (${f.userLogin})`;
      fNode.style.color = "var(--accent-2)";
      connectBtn.textContent = "Reconnect";
      disconnectBtn.style.display = "";
    } else if (f.status === "error") {
      fNode.textContent = "⚠ " + (f.detail || "error");
      fNode.style.color = "#ff5c5c";
      connectBtn.textContent = "Reconnect Twitch account";
      disconnectBtn.style.display = f.userLogin ? "" : "none";
    } else if (f.status === "connecting") {
      fNode.textContent = "connecting…";
      fNode.style.color = "var(--muted)";
    } else {
      fNode.textContent = "not connected";
      fNode.style.color = "var(--muted)";
      connectBtn.textContent = "Connect Twitch account";
      disconnectBtn.style.display = "none";
    }
  } catch {
    node.textContent = "server offline";
    node.className = "status error";
  }
}

// Save the Twitch app credentials, then hand off to the OAuth flow.
async function connectFollows() {
  collectFromDom();
  const hasSecret = el("#tw-client-secret").value.trim() || config.twitch.hasSecret;
  if (!config.twitch.clientId || !hasSecret) {
    alert("Enter your Twitch Client ID and Client Secret first.");
    return;
  }
  await api("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config)
  });
  window.location.href = "/auth/twitch";
}

async function disconnectFollows() {
  await api("/auth/disconnect", { method: "POST" });
  refreshStatus();
}

async function init() {
  config = await api("/api/config");
  el("#channel").value = config.channel || "";
  el("#treatGiftedAsSub").checked = config.treatGiftedAsSub !== false;
  el("#overlay-url").value = `${location.origin}/overlay.html`;
  el("#copy-url").addEventListener("click", () => {
    navigator.clipboard.writeText(`${location.origin}/overlay.html`);
    el("#copy-url").textContent = "Copied!";
    setTimeout(() => (el("#copy-url").textContent = "Copy"), 1500);
  });
  el("#save").addEventListener("click", save);

  // Twitch / follow-alert connection
  const tw = config.twitch || {};
  el("#tw-client-id").value = tw.clientId || "";
  el("#tw-public-url").value = tw.publicUrl || "";
  if (tw.hasSecret) el("#tw-client-secret").placeholder = "•••••• (saved — leave blank to keep)";
  el("#follow-connect").addEventListener("click", connectFollows);
  el("#follow-disconnect").addEventListener("click", disconnectFollows);
  el("#copy-redirect").addEventListener("click", () => {
    navigator.clipboard.writeText(el("#redirect-uri").value);
    el("#copy-redirect").textContent = "Copied!";
    setTimeout(() => (el("#copy-redirect").textContent = "Copy redirect URL"), 1500);
  });

  // Banner after returning from the OAuth flow.
  const q = new URLSearchParams(location.search);
  if (q.get("follow") === "connected") {
    el("#save-msg").textContent = "Twitch connected — follow alerts active ✓";
  } else if (q.get("follow") === "error") {
    el("#save-msg").textContent = "Twitch connect failed: " + (q.get("msg") || "unknown error");
    el("#save-msg").style.color = "#ff5c5c";
  }
  if (q.get("follow")) history.replaceState(null, "", location.pathname);

  renderAlertCards();
  refreshStatus();
  setInterval(refreshStatus, 5000);
}

init();
