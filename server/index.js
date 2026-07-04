import express from "express";
import { WebSocketServer } from "ws";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import crypto from "node:crypto";
import { loadConfig, saveConfig, getConfigPath } from "./config.js";
import { TwitchChat } from "./twitchChat.js";
import { EventSub } from "./eventsub.js";
import { parseLine, toAlert } from "./ircParser.js";
import { processEvent } from "./pipeline.js";
import { HypeTracker } from "./hype.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

// Scopes for the EventSub topics we subscribe to (follows, subs, resubs,
// cheers; raids need none). Users granted only the old follows scope keep
// working — the extra topics just fail until they reconnect.
const EVENTSUB_SCOPES = "moderator:read:followers channel:read:subscriptions bits:read channel:read:hype_train";

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));

// --- Password protection -------------------------------------------------
// Protects the settings page and the config/test/auth APIs. The overlay and
// its WebSocket stay open so OBS can load them without credentials. Auth is
// enabled only when ADMIN_PASSWORD is set — local (localhost) use needs no
// password; set it on public deployments (Coolify) to lock the dashboard.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const authEnabled = () => ADMIN_PASSWORD.length > 0;
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const sessions = new Map(); // token -> createdAt

// Paths reachable without logging in.
const OPEN_PATHS = new Set([
  "/overlay.html",
  "/overlay.js",
  "/overlay.css",
  "/widget.html",
  "/goals.html",
  "/hype.html",
  "/login",
  "/api/login",
  "/favicon.ico"
]);

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function isAuthed(req) {
  const token = parseCookies(req).sid;
  if (!token) return false;
  const created = sessions.get(token);
  if (!created) return false;
  if (Date.now() - created > SESSION_TTL) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

app.use((req, res, next) => {
  if (!authEnabled()) return next();
  if (OPEN_PATHS.has(req.path) || req.path.startsWith("/fonts/") || req.path.startsWith("/widget/")) return next();
  if (isAuthed(req)) return next();
  if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return res.redirect("/login");
});

// The overlay/settings/login markup changes with every update, and OBS's
// browser source caches hard — so never let HTML/JS/CSS be cached. Fonts and
// images are content-stable and can cache.
const NO_CACHE = "no-cache, no-store, must-revalidate";
function sendPage(res, file) {
  res.set("Cache-Control", NO_CACHE);
  res.sendFile(join(PUBLIC_DIR, file));
}

app.get("/login", (req, res) => {
  if (!authEnabled() || isAuthed(req)) return res.redirect("/");
  sendPage(res, "login.html");
});

app.post("/api/login", (req, res) => {
  if (!authEnabled()) return res.json({ ok: true });
  const password = (req.body && req.body.password) || "";
  if (!timingSafeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ ok: false, error: "Incorrect password" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, Date.now());
  const secure = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`
  );
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  const token = parseCookies(req).sid;
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/", (req, res) => sendPage(res, "settings.html"));
app.get("/favicon.ico", (req, res) => res.status(204).end());
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      if (/\.wasm$/i.test(filePath)) {
        res.set("Content-Type", "application/wasm");
        res.set("Cache-Control", "public, max-age=604800");
      } else if (/\.swf$/i.test(filePath)) {
        res.set("Content-Type", "application/x-shockwave-flash");
        res.set("Cache-Control", "public, max-age=604800");
      } else if (/\.(html|css)$/i.test(filePath)) {
        res.set("Cache-Control", NO_CACHE);
      } else if (/ruffle[\\/].*\.js$/i.test(filePath)) {
        res.set("Cache-Control", "public, max-age=604800"); // Ruffle chunks are hashed
      } else if (/\.js$/i.test(filePath)) {
        res.set("Cache-Control", NO_CACHE);
      } else if (/\.(woff2?|png|jpe?g|gif|svg|mp3|ogg)$/i.test(filePath)) {
        res.set("Cache-Control", "public, max-age=604800");
      }
    }
  })
);

const server = http.createServer(app);

// --- WebSocket hubs -------------------------------------------------------
// /ws            : the CSS overlay clients (receive JSON alert events)
// /widget-socket : Ruffle's socket proxy for the original widget. The widget
//                  opens a Flash TCP socket (127.0.0.1:9231); Ruffle relays it
//                  here, and we feed it the original tool's alert protocol.
const wss = new WebSocketServer({ noServer: true });
const widgetWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  let pathname = "/";
  try {
    pathname = new URL(req.url, "http://localhost").pathname;
  } catch {
    /* ignore */
  }
  if (pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else if (pathname === "/widget-socket") {
    widgetWss.handleUpgrade(req, socket, head, (ws) => widgetWss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(msg);
  }
}

// The original widget (Flash) requests a socket policy file on connect; answer
// it, then unlock alerts with a minimal config (the widget self-initialises its
// defaults, so an empty refreshConfig is enough to enable the built-in anims).
const SOCKET_POLICY =
  '<?xml version="1.0"?><cross-domain-policy><allow-access-from domain="*" to-ports="*"/></cross-domain-policy>\0';

widgetWss.on("connection", (ws) => {
  ws.on("message", (m) => {
    if (m.toString().includes("policy-file-request")) ws.send(Buffer.from(SOCKET_POLICY));
  });
  setTimeout(() => {
    if (ws.readyState === ws.OPEN) ws.send(Buffer.from(JSON.stringify({ type: "refreshConfig" }) + "\n"));
  }, 300);
  console.log("[widget] Ruffle widget connected");
});

// Translate a normalized alert event into the original widget's JSON protocol.
function toWidgetMessage(e) {
  switch (e.type) {
    case "follow": return { type: "followAlert", name: e.name };
    case "sub": return { type: "subAlert", name: e.name, numMonthInARow: e.months || 1, modelSubSource: "twitch" };
    case "resub": return { type: "subAlert", name: e.name, numMonthInARow: e.months || 1, modelSubSource: "twitch" };
    case "giftsub": return { type: "subAlert", name: e.name, numMonthInARow: 1, modelSubSource: "twitch" };
    case "giftbomb": return { type: "subAlert", name: e.gifter, numMonthInARow: 1, modelSubSource: "twitch" };
    case "cheer": return { type: "cheerAlert", name: e.name, numBits: e.bits || 0 };
    case "raid": return { type: "hostAlert", name: e.name, numViewers: e.viewers || 0 };
    default: return null;
  }
}
function feedWidget(event) {
  const msg = toWidgetMessage(event);
  if (!msg) return;
  const data = Buffer.from(JSON.stringify(msg) + "\n");
  for (const ws of widgetWss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

/**
 * Resolve which alert config block should style an event. This is where the
 * "gifted subs look the same as subscriber alerts" behaviour lives: when
 * `treatGiftedAsSub` is on, gift events borrow the `sub` block.
 */
function resolveAlert(event, config) {
  let key = event.type;
  if (config.treatGiftedAsSub && (event.type === "giftsub" || event.type === "giftbomb")) {
    key = "sub";
  }
  const block = config.alerts[key] || config.alerts[event.type];
  return { block, styleKey: key };
}

// Recent-events monitor: a ring buffer of every alert the server has seen
// (fired or not), so the dashboard can show what's coming through — handy for
// catching an event you missed or confirming the live pipeline works.
const eventLog = [];
const EVENT_LOG_MAX = 60;
function recordEvent(entry) {
  eventLog.push({ id: crypto.randomUUID(), ...entry });
  if (eventLog.length > EVENT_LOG_MAX) eventLog.shift();
}
function eventDetail(e) {
  switch (e.type) {
    case "sub": return `tier ${e.tier}`;
    case "resub": return `${e.months} months · tier ${e.tier}`;
    case "giftsub": return `from ${e.gifter}`;
    case "giftbomb": return `${e.count} subs from ${e.gifter}`;
    case "cheer": return `${e.bits} bits`;
    case "raid": return `${e.viewers} viewers` + (e.returning ? " · returning" : "");
    default: return "";
  }
}

// The primary numeric value a variation threshold is compared against.
function primaryValue(e) {
  switch (e.type) {
    case "cheer": return e.bits || 0;
    case "resub": return e.months || 0;
    case "giftbomb": return e.count || 0;
    case "raid": return e.viewers || 0;
    case "sub":
    case "giftsub": return e.tier === "Prime" ? 1 : parseInt(e.tier || "1", 10) || 1;
    default: return 0;
  }
}
// Pick one item from a "a | b | c" list (for random image/sound variants).
function pickRandom(field) {
  if (typeof field !== "string" || !field.includes("|")) return field;
  const opts = field.split("|").map((s) => s.trim()).filter(Boolean);
  return opts.length ? opts[Math.floor(Math.random() * opts.length)] : "";
}
// Merge the best-matching variation onto the base style, then resolve randoms.
function applyVariations(block, event) {
  const style = { ...block };
  const val = primaryValue(event);
  const match = (block.variations || [])
    .filter((v) => val >= (Number(v.min) || 0))
    .sort((a, b) => (Number(b.min) || 0) - (Number(a.min) || 0))[0];
  if (match) {
    for (const k of ["accentColor", "textColor", "title", "message", "image", "sound", "duration"]) {
      if (match[k] !== undefined && match[k] !== "") style[k] = match[k];
    }
  }
  style.image = pickRandom(style.image);
  style.sound = pickRandom(style.sound);
  delete style.variations;
  return style;
}

// Mark returning raiders (seen before) and remember new ones (real raids only).
function markReturningRaider(event, source) {
  if (event.type !== "raid") return;
  const login = (event.login || event.name || "").toLowerCase();
  if (!login) return;
  const cfg = loadConfig();
  const seen = cfg.seenRaiders || [];
  event.returning = seen.includes(login);
  if (!event.returning && source === "twitch") {
    saveConfig({ ...cfg, seenRaiders: [...seen, login].slice(-1000) });
  }
}

// Auto-increment session goals on real events, persist and push to /goals.html.
function bumpGoals(event, source) {
  if (source !== "twitch") return;
  const cfg = loadConfig();
  const g = cfg.goals || {};
  let changed = false;
  const subInc = { sub: 1, resub: 1, giftsub: 1, giftbomb: event.count || 1 }[event.type];
  if (subInc && g.subs) { g.subs.current = (g.subs.current || 0) + subInc; changed = true; }
  if (event.type === "follow" && g.follows) { g.follows.current = (g.follows.current || 0) + 1; changed = true; }
  if (changed) { saveConfig({ ...cfg, goals: g }); broadcast({ kind: "goals", goals: g }); }
}

function handleAlert(event, source = "twitch") {
  const config = loadConfig();
  const result = processEvent(event); // filters, thresholds, gift grouping, dedupe, TTS
  const ev = result.event || event;
  markReturningRaider(ev, source);
  const { block, styleKey } = resolveAlert(ev, config);
  const enabled = !!(block && block.enabled !== false);
  const fired = enabled && !result.drop;
  recordEvent({
    time: Date.now(),
    type: ev.type,
    name: ev.name,
    detail: eventDetail(ev),
    source,
    fired,
    reason: result.drop ? result.reason : enabled ? null : "disabled",
    raw: ev.rawLine || null
  });
  if (!fired) return;
  const style = applyVariations(block, ev);
  broadcast({ kind: "alert", event: ev, style, styleKey, tts: config.tts });
  feedWidget(ev); // drive the original widget overlay too
  bumpGoals(ev, source);
  hype.addSupport(ev); // build the combo/hype meter
  console.log(`[alert] ${ev.type} (${source}):`, ev.name);
}

const hype = new HypeTracker(broadcast);

const chat = new TwitchChat(handleAlert);
chat.setChannel(loadConfig().channel);

const eventsub = new EventSub(handleAlert);
eventsub.start();

// When EventSub is delivering a given alert type, suppress the chat reader for
// it so we don't fire twice. Gifts always stay on chat (grouping + recipients).
chat.shouldSuppress = (type) => eventsub.activeTypes.has(type);

// Real Twitch Hype Trains drive the hype meter (overrides the combo meter).
eventsub.onHype = (update) => hype.fromTwitch(update);

// --- config sanitization -------------------------------------------------
// Never send secrets/tokens to a browser; expose only booleans it needs.
function sanitizeConfig(config) {
  const c = JSON.parse(JSON.stringify(config));
  const t = c.twitch || {};
  c.twitch = {
    clientId: t.clientId || "",
    publicUrl: t.publicUrl || "",
    userLogin: t.userLogin || "",
    hasSecret: !!t.clientSecret,
    connected: !!(t.accessToken && t.refreshToken)
  };
  return c;
}

// Merge an inbound (sanitized) config from the settings page without letting
// it clobber server-held secrets/tokens.
function mergeInboundConfig(inbound) {
  const current = loadConfig();
  const t = (inbound && inbound.twitch) || {};
  const nextTwitch = { ...current.twitch };
  if (typeof t.clientId === "string") nextTwitch.clientId = t.clientId.trim();
  if (typeof t.publicUrl === "string") nextTwitch.publicUrl = t.publicUrl.trim();
  // Only overwrite the secret when a fresh non-empty value is supplied.
  if (typeof t.clientSecret === "string" && t.clientSecret.trim() !== "") {
    nextTwitch.clientSecret = t.clientSecret.trim();
  }
  const merged = { ...inbound, twitch: nextTwitch };
  return saveConfig(merged);
}

// --- REST API ------------------------------------------------------------
app.get("/api/config", (req, res) => {
  res.json(sanitizeConfig(loadConfig()));
});

app.post("/api/config", (req, res) => {
  const next = mergeInboundConfig(req.body || {});
  chat.setChannel(next.channel);
  broadcast({ kind: "goals", goals: next.goals }); // keep /goals.html in sync
  res.json(sanitizeConfig(next));
});

// Current goal state for /goals.html on load.
app.get("/api/goals", (req, res) => {
  res.json({ goals: loadConfig().goals || {} });
});

// Current hype meter state for /hype.html on load.
app.get("/api/hype", (req, res) => {
  res.json(hype.getState());
});

app.get("/api/status", (req, res) => {
  res.json({
    chat: chat.getStatus(),
    follows: eventsub.getStatus(),
    redirectUri: redirectUri(req),
    scope: EVENTSUB_SCOPES,
    authEnabled: authEnabled(),
    configPath: getConfigPath()
  });
});

// --- Twitch OAuth (follow alerts) ---------------------------------------
// Derive the redirect URI. Prefer an explicit publicUrl (set behind a proxy);
// otherwise build it from the incoming request.
function redirectUri(req) {
  const cfg = loadConfig();
  const base = (cfg.twitch.publicUrl || "").trim().replace(/\/$/, "");
  if (base) return `${base}/auth/callback`;
  return `${req.protocol}://${req.get("host")}/auth/callback`;
}

const oauthStates = new Set();

app.get("/auth/twitch", (req, res) => {
  const cfg = loadConfig();
  if (!cfg.twitch.clientId || !cfg.twitch.clientSecret) {
    return res.status(400).send("Set your Twitch Client ID and Secret first.");
  }
  const state = crypto.randomBytes(16).toString("hex");
  oauthStates.add(state);
  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.searchParams.set("client_id", cfg.twitch.clientId);
  url.searchParams.set("redirect_uri", redirectUri(req));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", EVENTSUB_SCOPES);
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

app.get("/auth/callback", async (req, res) => {
  const { code, state, error, error_description: errDesc } = req.query;
  if (error) return res.redirect(`/?follow=error&msg=${encodeURIComponent(errDesc || error)}`);
  if (!code || !state || !oauthStates.has(state)) {
    return res.redirect("/?follow=error&msg=" + encodeURIComponent("Invalid OAuth state"));
  }
  oauthStates.delete(state);

  const cfg = loadConfig();
  try {
    const params = new URLSearchParams({
      client_id: cfg.twitch.clientId,
      client_secret: cfg.twitch.clientSecret,
      code: String(code),
      grant_type: "authorization_code",
      redirect_uri: redirectUri(req)
    });
    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      return res.redirect("/?follow=error&msg=" + encodeURIComponent(`Token exchange failed: ${body}`));
    }
    const tok = await tokenRes.json();
    saveConfig({
      ...loadConfig(),
      twitch: {
        ...loadConfig().twitch,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        userId: "",
        userLogin: ""
      }
    });
    eventsub.restart();
    res.redirect("/?follow=connected");
  } catch (err) {
    res.redirect("/?follow=error&msg=" + encodeURIComponent(err.message));
  }
});

app.post("/auth/disconnect", (req, res) => {
  const cfg = loadConfig();
  saveConfig({
    ...cfg,
    twitch: { ...cfg.twitch, accessToken: "", refreshToken: "", userId: "", userLogin: "" }
  });
  eventsub.stop();
  res.json({ ok: true });
});

// Fire a fake alert so streamers can preview/position without waiting for a
// real event. Body: { type, name?, ...overrides }
app.post("/api/test", (req, res) => {
  const type = (req.body && req.body.type) || "sub";
  const event = buildTestEvent(type, req.body || {});
  handleAlert(event, "test");
  res.json({ ok: true, event });
});

// Recent events for the dashboard monitor (most recent first).
app.get("/api/events", (req, res) => {
  res.json({ events: eventLog.slice().reverse() });
});

// Stop any TTS currently playing on the overlay(s).
app.post("/api/tts/skip", (req, res) => {
  broadcast({ kind: "ttsSkip" });
  res.json({ ok: true });
});

// Replay a raw Twitch IRC line through the exact live parse + render path.
// Lets you confirm real Twitch payloads parse and fire correctly. Body: { line }
app.post("/api/replay", (req, res) => {
  const line = ((req.body && req.body.line) || "").trim();
  if (!line) return res.status(400).json({ ok: false, error: "No line provided" });
  let alert = null;
  try {
    alert = toAlert(parseLine(line));
  } catch (err) {
    return res.status(400).json({ ok: false, error: "Parse error: " + err.message });
  }
  if (!alert) {
    recordEvent({
      time: Date.now(), type: "unrecognized", name: "—",
      detail: "line matched no alert", source: "replay", fired: false, raw: line
    });
    return res.json({ ok: true, parsed: null });
  }
  alert.rawLine = line;
  handleAlert(alert, "replay");
  res.json({ ok: true, parsed: { type: alert.type, name: alert.name } });
});

function buildTestEvent(type, overrides) {
  const name = overrides.name || "TestViewer";
  const base = { follow: { type: "follow", name },
    sub: { type: "sub", name, tier: "1", months: 1 },
    resub: { type: "resub", name, tier: "1", months: 6, streak: 3 },
    giftsub: { type: "giftsub", name: "LuckyViewer", gifter: name, tier: "1", months: 1 },
    giftbomb: { type: "giftbomb", name, gifter: name, tier: "1", count: 5 },
    cheer: { type: "cheer", name, bits: 500, message: "cheer500 pog" },
    raid: { type: "raid", name, viewers: 42 }
  }[type] || { type: "sub", name, tier: "1", months: 1 };
  return { ...base, ...overrides, type: base.type, raw: { test: true } };
}

const PORT = process.env.PORT || loadConfig().port || 3000;
server.listen(PORT, () => {
  console.log(`\n  Twitch Alerts running`);
  console.log(`  Settings:  http://localhost:${PORT}/`);
  console.log(`  Overlay:   http://localhost:${PORT}/overlay.html   (add as OBS Browser Source)`);
  console.log(`  Config:    ${getConfigPath()}\n`);
});
