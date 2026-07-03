import express from "express";
import { WebSocketServer } from "ws";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import crypto from "node:crypto";
import { loadConfig, saveConfig, getConfigPath } from "./config.js";
import { TwitchChat } from "./twitchChat.js";
import { EventSub } from "./eventsub.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

const FOLLOW_SCOPE = "moderator:read:followers";

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));
app.get("/", (req, res) => res.sendFile(join(PUBLIC_DIR, "settings.html")));
app.get("/favicon.ico", (req, res) => res.status(204).end());
app.use(express.static(PUBLIC_DIR));

const server = http.createServer(app);

// --- WebSocket hub: overlay clients connect here and receive alert events ---
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(msg);
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

function handleAlert(event) {
  const config = loadConfig();
  const { block, styleKey } = resolveAlert(event, config);
  if (!block || block.enabled === false) return;
  broadcast({ kind: "alert", event, style: block, styleKey });
  console.log(`[alert] ${event.type}:`, event.name);
}

const chat = new TwitchChat(handleAlert);
chat.setChannel(loadConfig().channel);

const eventsub = new EventSub(handleAlert);
eventsub.start();

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
  res.json(sanitizeConfig(next));
});

app.get("/api/status", (req, res) => {
  res.json({
    chat: chat.getStatus(),
    follows: eventsub.getStatus(),
    redirectUri: redirectUri(req),
    scope: FOLLOW_SCOPE,
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
  url.searchParams.set("scope", FOLLOW_SCOPE);
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
  handleAlert(event);
  res.json({ ok: true, event });
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
