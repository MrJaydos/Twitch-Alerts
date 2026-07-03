// Overlay client: connects to the server WebSocket, queues incoming alerts and
// plays them one at a time so they never overlap on stream.

const els = {
  alert: document.getElementById("alert"),
  image: document.getElementById("alert-image"),
  imageWrap: document.querySelector(".alert-image-wrap"),
  title: document.getElementById("alert-title"),
  message: document.getElementById("alert-message"),
  audio: document.getElementById("alert-audio")
};

const queue = [];
let playing = false;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Replace {tokens} in a template with event values. The primary noun ({name},
// {gifter}, {bits}, {viewers}...) is wrapped so it can be accent-highlighted.
function renderMessage(template, event) {
  const vars = {
    name: event.name ?? "",
    gifter: event.gifter ?? "",
    recipient: event.recipient ?? event.name ?? "",
    months: event.months ?? "",
    streak: event.streak ?? "",
    tier: event.tier ?? "",
    bits: event.bits ?? "",
    viewers: event.viewers ?? "",
    count: event.count ?? ""
  };
  const highlightKeys = new Set(["name", "gifter", "bits", "viewers", "count"]);
  return template.replace(/\{(\w+)\}/g, (m, key) => {
    if (!(key in vars)) return m;
    const val = escapeHtml(vars[key]);
    return highlightKeys.has(key) ? `<span class="hl">${val}</span>` : val;
  });
}

function playNext() {
  if (playing || queue.length === 0) return;
  playing = true;

  const { event, style } = queue.shift();
  const duration = Number(style.duration) || 6000;

  els.alert.style.setProperty("--accent", style.accentColor || "#9147ff");
  els.alert.style.setProperty("--text", style.textColor || "#ffffff");
  els.title.textContent = style.title || "";
  els.message.innerHTML = renderMessage(style.message || "{name}", event);

  if (style.image) {
    els.image.src = style.image;
    els.alert.classList.add("has-image");
  } else {
    els.image.removeAttribute("src");
    els.alert.classList.remove("has-image");
  }

  if (style.sound) {
    els.audio.src = style.sound;
    els.audio.volume = style.soundVolume ?? 0.7;
    els.audio.play().catch(() => {
      /* browsers may block autoplay until first interaction; OBS allows it */
    });
  }

  els.alert.classList.remove("hide");
  els.alert.classList.add("show");

  setTimeout(() => {
    els.alert.classList.remove("show");
    els.alert.classList.add("hide");
    setTimeout(() => {
      playing = false;
      playNext();
    }, 500);
  }, duration);
}

function enqueue(payload) {
  queue.push(payload);
  playNext();
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.kind === "alert") enqueue(data);
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onclose = () => setTimeout(connect, 2000);
  ws.onerror = () => ws.close();
}

connect();
