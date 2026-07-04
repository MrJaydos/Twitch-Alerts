// Settings dashboard: loads config, renders an editor per alert type, saves
// back to the server, and fires test alerts.

const ALERT_META = {
  follow: { label: "Follow", tokens: "{name}" },
  sub: { label: "Subscriber", tokens: "{name} {tier} {months}" },
  resub: { label: "Resub", tokens: "{name} {tier} {months} {streak}" },
  giftsub: { label: "Gifted Sub", tokens: "{gifter} {name} {recipient} {tier}" },
  giftbomb: { label: "Gift Bomb", tokens: "{gifter} {count} {tier}" },
  cheer: { label: "Cheer / Bits", tokens: "{name} {bits}" },
  raid: { label: "Raid", tokens: "{name} {viewers}" },
  firstchat: { label: "First-time Chatter", tokens: "{name}" }
};

// The numeric field a variation threshold compares against, per alert type.
const VARIATION_UNIT = {
  sub: "tier", giftsub: "tier", resub: "months", giftbomb: "gifts",
  cheer: "bits", raid: "viewers"
};

let config = null;

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (res.status === 401) {
    // Session expired or not logged in — bounce to the login page.
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
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
    el(".f-style", node).value = a.style || "banner";
    el(".f-target", node).value = a.target || "both";
    el(".f-title", node).value = a.title || "";
    el(".f-message", node).value = a.message || "";
    el(".f-duration", node).value = a.duration || 6000;
    el(".f-accentColor", node).value = a.accentColor || "#9147ff";
    el(".f-textColor", node).value = a.textColor || "#ffffff";
    el(".f-soundVolume", node).value = a.soundVolume ?? 0.7;
    el(".f-tts", node).checked = a.tts === true;
    el(".f-ttsTemplate", node).value = a.ttsTemplate || "";
    el(".f-image", node).value = a.image || "";
    el(".f-sound", node).value = a.sound || "";
    el(".f-variations", node).value = serializeVariations(a.variations);
    // Label the variation threshold unit (bits/tier/months…) for this type.
    const unit = VARIATION_UNIT[key];
    if (unit) el(".variations-field code", node).textContent = `min ${unit} | accent | image | sound | title`;

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
    a.style = el(".f-style", card).value;
    a.target = el(".f-target", card).value;
    a.title = el(".f-title", card).value;
    a.message = el(".f-message", card).value;
    a.duration = Number(el(".f-duration", card).value) || 6000;
    a.accentColor = el(".f-accentColor", card).value;
    a.textColor = el(".f-textColor", card).value;
    a.soundVolume = Number(el(".f-soundVolume", card).value);
    a.tts = el(".f-tts", card).checked;
    a.ttsTemplate = el(".f-ttsTemplate", card).value;
    a.image = el(".f-image", card).value.trim();
    a.sound = el(".f-sound", card).value.trim();
    a.variations = parseVariations(el(".f-variations", card).value);
  }
  // Goals
  config.goals = config.goals || { subs: {}, follows: {} };
  for (const key of ["subs", "follows"]) {
    config.goals[key] = config.goals[key] || {};
    config.goals[key].enabled = el(`#goal-${key}-enabled`).checked;
    config.goals[key].label = el(`#goal-${key}-label`).value;
    config.goals[key].current = Number(el(`#goal-${key}-current`).value) || 0;
    config.goals[key].target = Number(el(`#goal-${key}-target`).value) || 1;
  }
  // Widget-only extras
  config.spook = config.spook || {};
  config.spook.enabled = el("#spook-enabled").checked;
  config.spook.command = el("#spook-command").value.trim() || "!spook";
  config.spook.cooldownSeconds = Number(el("#spook-cooldown").value) || 0;
  config.emoteCombo = config.emoteCombo || {};
  config.emoteCombo.enabled = el("#emote-enabled").checked;
  config.emoteCombo.threshold = Number(el("#emote-threshold").value) || 1;
  config.emoteCombo.windowSeconds = Number(el("#emote-window").value) || 1;
  config.emoteCombo.cooldownSeconds = Number(el("#emote-cooldown").value) || 0;
  config.emoteCombo.burstSize = Number(el("#emote-burst").value) || 1;
  // Original widget volume
  config.widgetVolume = config.widgetVolume || {};
  config.widgetVolume.follow = Number(el("#wv-follow").value);
  config.widgetVolume.sub = Number(el("#wv-sub").value);
  config.widgetVolume.host = Number(el("#wv-host").value);
  config.widgetVolume.cheer = Number(el("#wv-cheer").value);
  // Hype meter
  config.hype = config.hype || {};
  config.hype.enabled = el("#hype-enabled").checked;
  config.hype.pointsPerSub = Number(el("#hype-persub").value) || 0;
  config.hype.pointsPerHundredBits = Number(el("#hype-perbits").value) || 0;
  config.hype.levelPoints = Number(el("#hype-levelpoints").value) || 1;
  config.hype.decaySeconds = Number(el("#hype-decay").value) || 300;
  config.tts = config.tts || {};
  config.tts.provider = el("#tts-provider").value;
  config.tts.voice = el("#tts-voice").value.trim() || "Brian";
  config.tts.volume = Number(el("#tts-volume").value);
  config.tts.maxLength = Number(el("#tts-maxlen").value) || 200;
  config.tts.minBits = Number(el("#tts-minbits").value) || 0;
  config.tts.filterProfanity = el("#tts-profanity").checked;
  config.tts.mutedUsers = parseList(el("#tts-muted").value);
  config.filters = config.filters || {};
  config.filters.minBits = Number(el("#flt-minbits").value) || 0;
  config.filters.minRaidViewers = Number(el("#flt-minraid").value) || 0;
  config.filters.groupGiftBombs = el("#flt-groupgifts").checked;
  config.filters.ignoreUsers = parseList(el("#flt-ignore").value);
}

// Split a textarea of comma/newline-separated names into a clean array.
function parseList(str) {
  return (str || "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Variations: one per line — "min | accent | image | sound | title"
function serializeVariations(vars) {
  return (vars || [])
    .map((v) => [v.min ?? "", v.accentColor || "", v.image || "", v.sound || "", v.title || ""].join(" | "))
    .join("\n");
}
function parseVariations(str) {
  return (str || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [min, accentColor, image, sound, title] = line.split("|").map((s) => s.trim());
      const v = { min: Number(min) || 0 };
      if (accentColor) v.accentColor = accentColor;
      if (image) v.image = image;
      if (sound) v.sound = sound;
      if (title) v.title = title;
      return v;
    });
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

    el("#logout").style.display = s.authEnabled ? "" : "none";

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
  el("#widget-url").value = `${location.origin}/widget.html`;
  const copyBtn = (btnId, url) =>
    el(btnId).addEventListener("click", () => {
      navigator.clipboard.writeText(url);
      const b = el(btnId);
      const t = b.textContent;
      b.textContent = "Copied!";
      setTimeout(() => (b.textContent = t), 1500);
    });
  copyBtn("#copy-url", `${location.origin}/overlay.html`);
  copyBtn("#copy-widget-url", `${location.origin}/widget.html`);
  el("#save").addEventListener("click", save);
  el("#logout").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  });

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

  // Text-to-speech
  const tts = config.tts || {};
  el("#tts-provider").value = tts.provider || "streamelements";
  el("#tts-voice").value = tts.voice || "Brian";
  el("#tts-volume").value = tts.volume ?? 1;
  el("#tts-maxlen").value = tts.maxLength || 200;
  el("#tts-minbits").value = tts.minBits || 0;
  el("#tts-profanity").checked = tts.filterProfanity !== false;
  el("#tts-muted").value = (tts.mutedUsers || []).join(", ");
  el("#tts-skip").addEventListener("click", () => fetch("/api/tts/skip", { method: "POST" }));
  el("#tts-test").addEventListener("click", async () => {
    const text = el("#tts-test-text").value.trim();
    if (!text) return;
    collectFromDom();
    await api("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
    await api("/api/tts/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  });

  // Filters
  const flt = config.filters || {};
  el("#flt-minbits").value = flt.minBits || 0;
  el("#flt-minraid").value = flt.minRaidViewers || 0;
  el("#flt-groupgifts").checked = flt.groupGiftBombs !== false;
  el("#flt-ignore").value = (flt.ignoreUsers || []).join(", ");

  // Goals
  const goals = config.goals || {};
  el("#goals-url").value = `${location.origin}/goals.html`;
  copyBtn("#copy-goals-url", `${location.origin}/goals.html`);
  for (const key of ["subs", "follows"]) {
    const g = goals[key] || {};
    el(`#goal-${key}-enabled`).checked = !!g.enabled;
    el(`#goal-${key}-label`).value = g.label || "";
    el(`#goal-${key}-current`).value = g.current || 0;
    el(`#goal-${key}-target`).value = g.target || 1;
  }

  // Widget-only extras
  const spook = config.spook || {};
  el("#spook-enabled").checked = spook.enabled !== false;
  el("#spook-command").value = spook.command || "!spook";
  el("#spook-cooldown").value = spook.cooldownSeconds ?? 10;
  el("#spook-test").addEventListener("click", async () => {
    collectFromDom();
    await api("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
    await api("/api/spook-test", { method: "POST" });
  });
  const ec = config.emoteCombo || {};
  el("#emote-enabled").checked = ec.enabled !== false;
  el("#emote-threshold").value = ec.threshold ?? 5;
  el("#emote-window").value = ec.windowSeconds ?? 8;
  el("#emote-cooldown").value = ec.cooldownSeconds ?? 20;
  el("#emote-burst").value = ec.burstSize ?? 10;
  el("#emote-test").addEventListener("click", async () => {
    collectFromDom();
    await api("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
    await api("/api/emote-test", { method: "POST" });
  });

  // Original widget volume
  const wv = config.widgetVolume || {};
  el("#wv-follow").value = wv.follow ?? 1;
  el("#wv-sub").value = wv.sub ?? 1;
  el("#wv-host").value = wv.host ?? 1;
  el("#wv-cheer").value = wv.cheer ?? 1;

  // Hype meter
  const hype = config.hype || {};
  el("#hype-url").value = `${location.origin}/hype.html`;
  copyBtn("#copy-hype-url", `${location.origin}/hype.html`);
  el("#hype-enabled").checked = hype.enabled !== false;
  el("#hype-persub").value = hype.pointsPerSub ?? 100;
  el("#hype-perbits").value = hype.pointsPerHundredBits ?? 100;
  el("#hype-levelpoints").value = hype.levelPoints ?? 500;
  el("#hype-decay").value = hype.decaySeconds ?? 300;

  // Live events monitor + raw replay
  el("#events-refresh").addEventListener("click", refreshEvents);
  el("#replay-btn").addEventListener("click", replayLine);

  renderAlertCards();
  refreshStatus();
  refreshEvents();
  setInterval(refreshStatus, 5000);
  setInterval(refreshEvents, 4000);
}

const REL_TIME = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return new Date(t).toLocaleTimeString();
};

async function refreshEvents() {
  let data;
  try {
    data = await api("/api/events");
  } catch {
    return;
  }
  const list = el("#events-list");
  if (!data.events || data.events.length === 0) {
    list.innerHTML = '<div class="events-empty">No events yet.</div>';
    return;
  }
  list.innerHTML = data.events
    .map((e) => {
      const cls = e.fired ? "" : " notfired";
      const name = e.name ? `<span class="event-name">${escapeHtml(e.name)}</span>` : "";
      const detail = e.detail ? `<span class="event-detail">${escapeHtml(e.detail)}</span>` : "";
      const src = e.reason ? `${e.source} · ${e.reason}` : e.source;
      return `<div class="event-row${cls}">
        <span class="event-time">${REL_TIME(e.time)}</span>
        <span class="event-type">${escapeHtml(e.type)}</span>
        ${name}${detail}
        <span class="event-src">${escapeHtml(src)}</span>
      </div>`;
    })
    .join("");
}

async function replayLine() {
  const line = el("#replay-line").value.trim();
  const msg = el("#replay-msg");
  if (!line) {
    msg.textContent = "Paste a raw IRC line first.";
    return;
  }
  try {
    const res = await api("/api/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line })
    });
    msg.textContent = res.parsed
      ? `Fired ${res.parsed.type} for ${res.parsed.name} ✓`
      : "Parsed, but it matched no alert type.";
    msg.style.color = res.parsed ? "var(--accent-2)" : "var(--muted)";
    refreshEvents();
  } catch (err) {
    msg.textContent = "Replay failed: " + err.message;
    msg.style.color = "#ff5c5c";
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

init();
