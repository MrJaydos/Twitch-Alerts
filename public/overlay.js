// Overlay client: connects to the server WebSocket, queues incoming alerts and
// plays them one at a time. Each alert renders in one of two styles:
//   - "banner": compact top notification (follow / cheer / raid)
//   - "punch":  full-screen centered takeover (subs / resubs / gifts),
//               recreating the original LachhhTools UI_NewSubAnim.

const els = {
  // banner
  alert: document.getElementById("alert"),
  image: document.getElementById("alert-image"),
  title: document.getElementById("alert-title"),
  message: document.getElementById("alert-message"),
  audio: document.getElementById("alert-audio"),
  // punch
  punch: document.getElementById("punch"),
  punchWord: document.getElementById("punch-word"),
  punchName: document.getElementById("punch-name"),
  punchSub: document.getElementById("punch-sub")
};

const PUNCH_MS = 3400; // fixed length of the full-screen punch sequence

const queue = [];
let playing = false;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---- Built-in impact sound (Web Audio, no external file) -----------------
let _ctx = null;
function audioCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}
function playImpact(volume) {
  try {
    const ctx = audioCtx();
    const now = ctx.currentTime;
    const v = Math.max(0, Math.min(1, volume ?? 0.8));

    // Low sine "thud" sweeping down.
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(44, now + 0.19);
    g.gain.setValueAtTime(v, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);

    // Short filtered noise burst for the "hit".
    const dur = 0.2;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const nf = ctx.createBiquadFilter();
    nf.type = "lowpass";
    nf.frequency.value = 1400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(v * 0.85, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(nf).connect(ng).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + dur);
  } catch {
    /* audio unavailable */
  }
}

function playSoundFor(style) {
  if (style.sound) {
    els.audio.src = style.sound;
    els.audio.volume = style.soundVolume ?? 0.7;
    els.audio.play().catch(() => {});
  } else if (style.style === "punch") {
    playImpact(style.soundVolume ?? 0.8);
  }
}

// ---- Message templating (banner) -----------------------------------------
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
  const highlight = new Set(["name", "gifter", "bits", "viewers", "count"]);
  return template.replace(/\{(\w+)\}/g, (m, key) => {
    if (!(key in vars)) return m;
    const val = escapeHtml(vars[key]);
    return highlight.has(key) ? `<span class="hl">${val}</span>` : val;
  });
}

// The punch layout is name-centric: a subtitle derived straight from the event
// (mirrors the original's big name + "N MONTHS").
function punchSubtitle(event) {
  switch (event.type) {
    case "resub":
      return `${event.months} MONTH${event.months == 1 ? "" : "S"}`;
    case "sub":
      return event.tier === "Prime" ? "PRIME" : `TIER ${event.tier}`;
    case "giftsub":
      return `GIFTED BY ${event.gifter}`;
    case "giftbomb":
      return `${event.count} SUBS FROM ${event.gifter}`;
    default:
      return "";
  }
}

function setAccent(el, style) {
  el.style.setProperty("--accent", style.accentColor || "#a2cab8");
  el.style.setProperty("--text", style.textColor || "#e1f7f1");
}

function playBanner(event, style, done) {
  setAccent(els.alert, style);
  els.title.textContent = style.title || "";
  els.message.innerHTML = renderMessage(style.message || "{name}", event);

  if (style.image) {
    els.image.src = style.image;
    els.alert.classList.add("has-image");
  } else {
    els.image.removeAttribute("src");
    els.alert.classList.remove("has-image");
  }

  playSoundFor(style);
  els.alert.classList.remove("hide");
  els.alert.classList.add("show");

  const duration = Number(style.duration) || 6000;
  setTimeout(() => {
    els.alert.classList.remove("show");
    els.alert.classList.add("hide");
    setTimeout(done, 500);
  }, duration);
}

function playPunch(event, style, done) {
  setAccent(els.punch, style);
  els.punchWord.textContent = style.title || "NEW SUBSCRIBER";
  els.punchName.textContent = event.name || "";
  els.punchSub.textContent = punchSubtitle(event);

  // Restart the CSS animation cleanly.
  els.punch.classList.remove("show");
  void els.punch.offsetWidth;
  els.punch.classList.add("show");
  playSoundFor(style);

  setTimeout(() => {
    els.punch.classList.remove("show");
    done();
  }, PUNCH_MS);
}

function playNext() {
  if (playing || queue.length === 0) return;
  playing = true;
  const { event, style } = queue.shift();
  const finish = () => {
    playing = false;
    playNext();
  };
  if (style.style === "punch") playPunch(event, style, finish);
  else playBanner(event, style, finish);
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
