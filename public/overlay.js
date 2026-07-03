// Overlay client: connects to the server WebSocket, queues alerts and plays one
// at a time. Each alert renders in the style matching what the original
// LachhhTools on-stream alert did:
//   punch (subs) · pop (follows) · cannon (cheers) · rainbow (raids) · banner.

const els = {
  alert: document.getElementById("alert"),
  image: document.getElementById("alert-image"),
  title: document.getElementById("alert-title"),
  message: document.getElementById("alert-message"),
  audio: document.getElementById("alert-audio"),
  punch: document.getElementById("punch"),
  punchWord: document.getElementById("punch-word"),
  punchName: document.getElementById("punch-name"),
  punchSub: document.getElementById("punch-sub"),
  pop: document.getElementById("pop"),
  popWord: document.getElementById("pop-word"),
  popName: document.getElementById("pop-name"),
  cannon: document.getElementById("cannon"),
  cannonName: document.getElementById("cannon-name"),
  cannonBits: document.getElementById("cannon-bits"),
  rainbow: document.getElementById("rainbow"),
  rainbowWord: document.getElementById("rainbow-word"),
  rainbowName: document.getElementById("rainbow-name"),
  rainbowSub: document.getElementById("rainbow-sub"),
  rainbowSparkles: document.getElementById("rainbow-sparkles")
};

// Fixed on-screen length per style (ms), tuned to each animation.
const LENGTHS = { punch: 3400, pop: 2600, cannon: 3900, rainbow: 3600 };

const queue = [];
let playing = false;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---- Synthesized sounds (Web Audio, no external files) -------------------
let _ctx = null;
function ctx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}
function tone(freqFrom, freqTo, t0, dur, vol, type = "sine") {
  const c = ctx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freqFrom, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}
function noiseBurst(t0, dur, vol, cutoff) {
  const c = ctx();
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = cutoff;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  s.connect(f).connect(g).connect(c.destination);
  s.start(t0);
  s.stop(t0 + dur);
}
const SOUNDS = {
  punch(v) { const t = ctx().currentTime; tone(190, 44, t, 0.38, v); noiseBurst(t, 0.2, v * 0.85, 1400); },
  pop(v) { const t = ctx().currentTime; tone(520, 900, t, 0.12, v, "triangle"); tone(900, 1300, t + 0.1, 0.12, v * 0.8, "triangle"); },
  boom(v) { const t = ctx().currentTime; tone(140, 32, t, 0.5, v); noiseBurst(t, 0.28, v * 0.9, 900); },
  fanfare(v) {
    const t = ctx().currentTime;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, f, t + i * 0.11, 0.22, v * 0.7, "triangle"));
    noiseBurst(t + 0.44, 0.5, v * 0.25, 6000);
  }
};
function playSoundFor(style) {
  try {
    if (style.sound) {
      els.audio.src = style.sound;
      els.audio.volume = style.soundVolume ?? 0.7;
      els.audio.play().catch(() => {});
      return;
    }
    const v = style.soundVolume ?? 0.7;
    const fn = { punch: SOUNDS.punch, pop: SOUNDS.pop, cannon: SOUNDS.boom, rainbow: SOUNDS.fanfare }[style.style];
    if (fn) fn(v);
  } catch {
    /* audio unavailable */
  }
}

// ---- Helpers -------------------------------------------------------------
function renderMessage(template, event) {
  const vars = {
    name: event.name ?? "", gifter: event.gifter ?? "", recipient: event.recipient ?? event.name ?? "",
    months: event.months ?? "", streak: event.streak ?? "", tier: event.tier ?? "",
    bits: event.bits ?? "", viewers: event.viewers ?? "", count: event.count ?? ""
  };
  const hl = new Set(["name", "gifter", "bits", "viewers", "count"]);
  return template.replace(/\{(\w+)\}/g, (m, k) =>
    k in vars ? (hl.has(k) ? `<span class="hl">${escapeHtml(vars[k])}</span>` : escapeHtml(vars[k])) : m
  );
}
function subLine(event) {
  switch (event.type) {
    case "resub": return `${event.months} MONTH${event.months == 1 ? "" : "S"}`;
    case "sub": return event.tier === "Prime" ? "PRIME" : `TIER ${event.tier}`;
    case "giftsub": return `GIFTED BY ${event.gifter}`;
    case "giftbomb": return `${event.count} SUBS FROM ${event.gifter}`;
    default: return "";
  }
}
function setVars(el, style) {
  el.style.setProperty("--accent", style.accentColor || "#a2cab8");
  el.style.setProperty("--text", style.textColor || "#e1f7f1");
}
// Restart CSS animations by toggling the class after a reflow.
function restart(el) {
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
}

// ---- Renderers -----------------------------------------------------------
function playBanner(event, style, done) {
  setVars(els.alert, style);
  els.title.textContent = style.title || "";
  els.message.innerHTML = renderMessage(style.message || "{name}", event);
  if (style.image) { els.image.src = style.image; els.alert.classList.add("has-image"); }
  else { els.image.removeAttribute("src"); els.alert.classList.remove("has-image"); }
  playSoundFor({ ...style, style: "banner" });
  els.alert.classList.remove("hide");
  els.alert.classList.add("show");
  const dur = Number(style.duration) || 6000;
  setTimeout(() => {
    els.alert.classList.remove("show");
    els.alert.classList.add("hide");
    setTimeout(done, 500);
  }, dur);
}

function playFixed(el, style, fill, done) {
  setVars(el, style);
  fill();
  restart(el);
  playSoundFor(style);
  setTimeout(() => { el.classList.remove("show"); done(); }, LENGTHS[style.style] || 3400);
}

function playPunch(event, style, done) {
  playFixed(els.punch, style, () => {
    els.punchWord.textContent = style.title || "NEW SUBSCRIBER";
    els.punchName.textContent = event.name || "";
    els.punchSub.textContent = subLine(event);
  }, done);
}
function playPop(event, style, done) {
  playFixed(els.pop, style, () => {
    els.popWord.textContent = style.title || "NEW FOLLOWER";
    els.popName.textContent = event.name || "";
  }, done);
}
function playCannon(event, style, done) {
  playFixed(els.cannon, style, () => {
    els.cannonName.textContent = event.name || "";
    els.cannonBits.textContent = `${event.bits || 0} BITS`;
  }, done);
}
function playRainbow(event, style, done) {
  playFixed(els.rainbow, style, () => {
    els.rainbowWord.textContent = style.title || "RAID";
    els.rainbowName.textContent = event.name || "";
    els.rainbowSub.textContent = event.viewers ? `${event.viewers} RAIDERS` : "";
    // scatter a handful of sparkles
    els.rainbowSparkles.innerHTML = "";
    for (let i = 0; i < 14; i++) {
      const s = document.createElement("span");
      s.className = "spk";
      s.textContent = "✨";
      s.style.left = 8 + Math.random() * 84 + "%";
      s.style.top = 12 + Math.random() * 60 + "%";
      s.style.animationDelay = (Math.random() * 1.2).toFixed(2) + "s";
      s.style.fontSize = 26 + Math.random() * 34 + "px";
      els.rainbowSparkles.appendChild(s);
    }
  }, done);
}

const RENDERERS = { punch: playPunch, pop: playPop, cannon: playCannon, rainbow: playRainbow, banner: playBanner };

function playNext() {
  if (playing || queue.length === 0) return;
  playing = true;
  const { event, style } = queue.shift();
  const finish = () => { playing = false; playNext(); };
  (RENDERERS[style.style] || playBanner)(event, style, finish);
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.kind === "alert") { queue.push(data); playNext(); }
    } catch { /* ignore */ }
  };
  ws.onclose = () => setTimeout(connect, 2000);
  ws.onerror = () => ws.close();
}
connect();
