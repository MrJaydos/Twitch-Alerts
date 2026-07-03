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
  try {
    const s = await api("/api/status");
    const node = el("#status");
    if (!s.channel) {
      node.textContent = "no channel set";
      node.className = "status";
    } else if (s.status === "connected") {
      node.textContent = `connected to #${s.channel}`;
      node.className = "status connected";
    } else {
      node.textContent = `${s.status}…`;
      node.className = "status";
    }
  } catch {
    const node = el("#status");
    node.textContent = "server offline";
    node.className = "status error";
  }
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
  renderAlertCards();
  refreshStatus();
  setInterval(refreshStatus, 5000);
}

init();
