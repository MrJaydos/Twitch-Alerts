import express from "express";
import { WebSocketServer } from "ws";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig, saveConfig, getConfigPath } from "./config.js";
import { TwitchChat } from "./twitchChat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.get("/", (req, res) => res.sendFile(join(PUBLIC_DIR, "settings.html")));
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

// --- REST API ------------------------------------------------------------
app.get("/api/config", (req, res) => {
  res.json(loadConfig());
});

app.post("/api/config", (req, res) => {
  const next = saveConfig(req.body || {});
  chat.setChannel(next.channel);
  res.json(next);
});

app.get("/api/status", (req, res) => {
  res.json({ ...chat.getStatus(), configPath: getConfigPath() });
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
