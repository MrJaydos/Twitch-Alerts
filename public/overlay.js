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
  cannonBag: document.getElementById("cannon-bag"),
  fx: document.getElementById("fx")
};

// Fixed on-screen length per style (ms), tuned to each animation.
const LENGTHS = { punch: 3400, pop: 2600, cannon: 3900, rainbow: 3600 };

const queue = [];
let playing = false;

// ======================================================================
// Particle engine — one canvas, one RAF loop. Effects push particles.
// ======================================================================
const fxCanvas = els.fx;
const fxCtx = fxCanvas.getContext("2d");
let particles = [];
function sizeCanvas() { fxCanvas.width = window.innerWidth; fxCanvas.height = window.innerHeight; }
sizeCanvas();
window.addEventListener("resize", sizeCanvas);

function fxLoop() {
  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += p.g;
    p.vx *= p.drag; p.vy *= p.drag;
    p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life--;
    if (p.grow) p.size += p.grow;
    if (p.life <= 0 || p.y > fxCanvas.height + 60) { particles.splice(i, 1); continue; }
    const a = Math.min(1, p.life / p.fade);
    fxCtx.save();
    fxCtx.globalAlpha = a;
    fxCtx.translate(p.x, p.y);
    fxCtx.rotate(p.rot);
    p.draw(fxCtx, p);
    fxCtx.restore();
  }
  requestAnimationFrame(fxLoop);
}
requestAnimationFrame(fxLoop);

const rand = (a, b) => a + Math.random() * (b - a);

function drawCoin(ctx, p) {
  ctx.beginPath(); ctx.arc(0, 0, p.size, 0, 7); ctx.fillStyle = "#f0b24a"; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = "#b6842a"; ctx.stroke();
  ctx.fillStyle = "#8a5a12"; ctx.font = `800 ${p.size}px AlertSans, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("$", 0, 1);
}
function drawConfetti(ctx, p) { ctx.fillStyle = p.color; ctx.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2); }
function drawSpark(ctx, p) {
  ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(0, 0, p.size, 0, 7); ctx.fill();
}
function drawShock(ctx, p) {
  ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1, 10 * (p.life / p.fade));
  ctx.beginPath(); ctx.arc(0, 0, p.size, 0, 7); ctx.stroke();
}
// Expanding impact ring.
function shockwave(x, y, accent) {
  particles.push({ x, y, vx: 0, vy: 0, g: 0, drag: 1, rot: 0, vr: 0,
    size: 20, grow: 26, life: 26, fade: 26, color: accent, draw: drawShock });
}

// Coins erupt from a point (the cannon) then rain down.
function coinBurst(x, y, n = 26) {
  for (let i = 0; i < n; i++) {
    const ang = rand(-Math.PI * 0.85, -Math.PI * 0.15);
    const sp = rand(9, 20);
    particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 0.55, drag: 0.995,
      rot: rand(0, 7), vr: rand(-0.3, 0.3), size: rand(10, 18), life: rand(70, 120), fade: 40, draw: drawCoin });
  }
}
// Confetti rains from the top.
function confetti(n = 90) {
  const cols = ["#e5484d", "#f2711c", "#ffd21e", "#46a758", "#3b82f6", "#8b5cf6", "#e1f7f1"];
  for (let i = 0; i < n; i++) {
    particles.push({ x: rand(0, fxCanvas.width), y: rand(-fxCanvas.height * 0.3, 0), vx: rand(-2, 2), vy: rand(2, 6),
      g: 0.08, drag: 0.999, rot: rand(0, 7), vr: rand(-0.25, 0.25), size: rand(5, 9), color: cols[i % cols.length],
      life: rand(120, 200), fade: 60, draw: drawConfetti });
  }
}
// Emote/sparkle firework: rockets rise from the bottom and burst.
function firework(accent) {
  const cols = [accent, "#ffffff", "#ffd21e", "#e1f7f1"];
  const shots = 5;
  for (let s = 0; s < shots; s++) {
    setTimeout(() => {
      const x = rand(fxCanvas.width * 0.2, fxCanvas.width * 0.8);
      const y = rand(fxCanvas.height * 0.25, fxCanvas.height * 0.5);
      const col = cols[s % cols.length];
      for (let i = 0; i < 24; i++) {
        const ang = (i / 24) * Math.PI * 2;
        const sp = rand(4, 9);
        particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 0.12, drag: 0.94,
          rot: 0, vr: 0, size: rand(3, 6), color: col, life: rand(40, 70), fade: 40, draw: drawSpark });
      }
    }, s * 180);
  }
}
// Sparkle ring bursting outward (follows).
function sparkleRing(x, y, accent) {
  for (let i = 0; i < 18; i++) {
    const ang = (i / 18) * Math.PI * 2;
    const sp = rand(5, 9);
    particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 0.02, drag: 0.93,
      rot: 0, vr: 0, size: rand(3, 6), color: i % 2 ? accent : "#ffffff", life: rand(30, 55), fade: 35, draw: drawSpark });
  }
}

// Physics-driven cash bag: parabola from the cannon across the screen + spin.
function fireCashBag() {
  const el = els.cannonBag;
  const startX = fxCanvas.width - 220, startY = fxCanvas.height - 190;
  let vx = -rand(15, 18), vy = -rand(20, 24);
  let x = startX, y = startY, rot = 0;
  el.style.opacity = "1";
  const step = () => {
    if (!els.cannon.classList.contains("show")) { el.style.opacity = "0"; return; }
    vy += 0.6; x += vx; y += vy; rot += 0.14;
    el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}rad)`;
    if (y > fxCanvas.height + 120 || x < -140) { el.style.opacity = "0"; return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

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

// ---- Text-to-speech ------------------------------------------------------
function fillTemplate(t, event) {
  const vars = {
    name: event.name ?? "", gifter: event.gifter ?? "", recipient: event.recipient ?? event.name ?? "",
    months: event.months ?? "", streak: event.streak ?? "", tier: event.tier ?? "",
    bits: event.bits ?? "", viewers: event.viewers ?? "", count: event.count ?? "",
    message: cleanCheermotes(event.message ?? "")
  };
  return t.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : "")).replace(/\s+/g, " ").trim();
}
// Drop cheermote tokens like "cheer500" / "Kappa100" from a chat message.
function cleanCheermotes(s) {
  return s.split(/\s+/).filter((w) => !/^[A-Za-z]+\d+$/.test(w)).join(" ");
}
let ttsAudio = null;
function speak(text, tts) {
  if (!text) return;
  const clipped = text.slice(0, tts.maxLength || 200);
  try {
    if (tts.provider === "browser" && window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(clipped);
      u.volume = tts.volume ?? 1;
      window.speechSynthesis.speak(u);
    } else {
      // StreamElements speech API returns an MP3 (works inside OBS's browser).
      const voice = encodeURIComponent(tts.voice || "Brian");
      const url = `https://api.streamelements.com/kappa/v2/speech?voice=${voice}&text=${encodeURIComponent(clipped)}`;
      ttsAudio = new Audio(url);
      ttsAudio.volume = tts.volume ?? 1;
      ttsAudio.play().catch(() => {});
    }
  } catch {
    /* tts unavailable */
  }
}
function maybeSpeak(event, style, tts) {
  if (!style.tts || !tts || tts.provider === "off") return;
  const text = fillTemplate(style.ttsTemplate || style.message || "", event);
  if (text) setTimeout(() => speak(text, tts), 700); // let the alert sound land first
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

function accentOf(style) { return style.accentColor || "#a2cab8"; }

function playPunch(event, style, done) {
  playFixed(els.punch, style, () => {
    els.punchWord.textContent = style.title || "NEW SUBSCRIBER";
    els.punchName.textContent = event.name || "";
    els.punchSub.textContent = subLine(event);
  }, done);
  // Shockwave ring on the impact, then an emote-firework as the name lands.
  setTimeout(() => shockwave(window.innerWidth / 2, window.innerHeight / 2, accentOf(style)), 300);
  setTimeout(() => firework(accentOf(style)), 600);
}
function playPop(event, style, done) {
  playFixed(els.pop, style, () => {
    els.popWord.textContent = style.title || "NEW FOLLOWER";
    els.popName.textContent = event.name || "";
  }, done);
  setTimeout(() => sparkleRing(window.innerWidth / 2, window.innerHeight / 2 - 40, accentOf(style)), 150);
}
function playCannon(event, style, done) {
  playFixed(els.cannon, style, () => {
    els.cannonName.textContent = event.name || "";
    els.cannonBits.textContent = `${event.bits || 0} BITS`;
  }, done);
  // Fire the bag + coin burst at the recoil moment (~0.72s into the 3.9s anim).
  setTimeout(() => {
    fireCashBag();
    coinBurst(window.innerWidth - 210, window.innerHeight - 180, 28);
  }, 720);
}
function playRainbow(event, style, done) {
  playFixed(els.rainbow, style, () => {
    els.rainbowWord.textContent = style.title || "RAID";
    els.rainbowName.textContent = event.name || "";
    els.rainbowSub.textContent = event.viewers ? `${event.viewers} RAIDERS` : "";
  }, done);
  setTimeout(() => confetti(110), 250);
}

const RENDERERS = { punch: playPunch, pop: playPop, cannon: playCannon, rainbow: playRainbow, banner: playBanner };

function playNext() {
  if (playing || queue.length === 0) return;
  playing = true;
  const { event, style, tts } = queue.shift();
  const finish = () => { playing = false; playNext(); };
  (RENDERERS[style.style] || playBanner)(event, style, finish);
  maybeSpeak(event, style, tts);
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
