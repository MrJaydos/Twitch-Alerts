import WebSocket from "ws";
import { loadConfig, saveConfig } from "./config.js";

const EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws";
const HELIX = "https://api.twitch.tv/helix";
const OAUTH_TOKEN = "https://id.twitch.tv/oauth2/token";

function planToTier(plan) {
  if (!plan) return "1";
  if (plan === "Prime" || plan === "prime") return "Prime";
  if (plan === "1000") return "1";
  if (plan === "2000") return "2";
  if (plan === "3000") return "3";
  return String(plan);
}

// EventSub topics we subscribe to and the normalized alert types each "covers"
// (used to suppress the chat path for those types, avoiding double alerts).
// Gifts are intentionally left to the chat path so we keep recipient names and
// the gift-bomb grouping in the pipeline.
const TOPICS = [
  { type: "channel.follow", version: "2", cond: (u) => ({ broadcaster_user_id: u.id, moderator_user_id: u.id }), covers: ["follow"], scope: "moderator:read:followers" },
  { type: "channel.subscribe", version: "1", cond: (u) => ({ broadcaster_user_id: u.id }), covers: ["sub"], scope: "channel:read:subscriptions" },
  { type: "channel.subscription.message", version: "1", cond: (u) => ({ broadcaster_user_id: u.id }), covers: ["resub"], scope: "channel:read:subscriptions" },
  { type: "channel.cheer", version: "1", cond: (u) => ({ broadcaster_user_id: u.id }), covers: ["cheer"], scope: "bits:read" },
  { type: "channel.raid", version: "1", cond: (u) => ({ to_broadcaster_user_id: u.id }), covers: ["raid"], scope: "(none)" }
];

/**
 * Twitch EventSub over WebSocket — the reliable event source when the streamer
 * has connected their account. Covers follows (not in chat) plus subs, resubs,
 * cheers and raids (guaranteed delivery + exact data, vs scraping chat). Gifts
 * stay on the chat path so we keep recipient names and gift-bomb grouping.
 *
 * Requires a user token with the scopes in TOPICS; the authorizing user is the
 * broadcaster. Whatever subscriptions succeed populate `activeTypes`, and the
 * chat reader suppresses those types to avoid duplicates. Missing scopes just
 * mean that type keeps coming from chat.
 */
export class EventSub {
  constructor(onAlert) {
    this.onAlert = onAlert;
    this.ws = null;
    this.sessionId = null;
    this.status = "not_connected"; // not_connected | connecting | connected | error
    this.detail = "";
    this.shouldRun = false;
    this.activeTypes = new Set(); // normalized alert types delivered via EventSub
  }

  hasAuth() {
    const t = loadConfig().twitch;
    return !!(t.clientId && t.clientSecret && t.accessToken && t.refreshToken);
  }

  start() {
    if (!this.hasAuth()) {
      this.status = "not_connected";
      return;
    }
    this.shouldRun = true;
    this.connect(EVENTSUB_URL);
  }

  stop() {
    this.shouldRun = false;
    this.sessionId = null;
    this.activeTypes = new Set();
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.status = "not_connected";
  }

  restart() {
    this.stop();
    this.start();
  }

  connect(url) {
    this.status = "connecting";
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("message", (data) => this.onMessage(data.toString()));
    ws.on("error", (err) => {
      console.error("[eventsub] socket error:", err.message);
    });
    ws.on("close", () => {
      if (this.shouldRun && this.status !== "error") {
        setTimeout(() => this.connect(EVENTSUB_URL), 3000);
      }
    });
  }

  async onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const type = msg.metadata && msg.metadata.message_type;

    if (type === "session_welcome") {
      this.sessionId = msg.payload.session.id;
      await this.subscribeAll();
    } else if (type === "session_reconnect") {
      const url = msg.payload.session.reconnect_url;
      // Twitch asks us to move to a new socket; the old one stays up briefly.
      const old = this.ws;
      this.connect(url);
      setTimeout(() => {
        try {
          old && old.close();
        } catch {
          /* ignore */
        }
      }, 2000);
    } else if (type === "notification") {
      this.handleNotification(msg.payload.subscription.type, msg.payload.event || {});
    } else if (type === "revocation") {
      this.status = "error";
      this.detail = "Subscription revoked (token expired or scope removed). Reconnect your Twitch account.";
      console.error("[eventsub]", this.detail);
    }
  }

  // Map an EventSub notification to a normalized alert event.
  handleNotification(subType, ev) {
    switch (subType) {
      case "channel.follow":
        this.onAlert({ type: "follow", name: ev.user_name || ev.user_login || "Someone", login: ev.user_login || "", raw: ev });
        break;
      case "channel.subscribe":
        // Fires for gifted subs too; gifts are handled via chat, so skip them.
        if (ev.is_gift) return;
        this.onAlert({ type: "sub", name: ev.user_name || ev.user_login, login: ev.user_login || "", tier: planToTier(ev.tier), months: 1, raw: ev });
        break;
      case "channel.subscription.message":
        this.onAlert({
          type: "resub", name: ev.user_name || ev.user_login, login: ev.user_login || "",
          tier: planToTier(ev.tier), months: ev.cumulative_months || 1, streak: ev.streak_months || 0,
          message: (ev.message && ev.message.text) || "", raw: ev
        });
        break;
      case "channel.cheer": {
        const anon = ev.is_anonymous;
        this.onAlert({ type: "cheer", name: anon ? "Anonymous" : ev.user_name || ev.user_login, login: anon ? "" : ev.user_login || "", bits: ev.bits || 0, message: ev.message || "", raw: ev });
        break;
      }
      case "channel.raid":
        this.onAlert({ type: "raid", name: ev.from_broadcaster_user_name || ev.from_broadcaster_user_login, login: ev.from_broadcaster_user_login || "", viewers: ev.viewers || 0, raw: ev });
        break;
      default:
        break;
    }
  }

  async subscribeAll() {
    this.activeTypes = new Set();
    let user;
    try {
      user = await this.getUser();
    } catch (err) {
      this.status = "error";
      this.detail = err.message;
      return;
    }
    if (!user) {
      this.status = "error";
      this.detail = "Could not resolve your Twitch user. Reconnect your account.";
      return;
    }

    const missingScopes = new Set();
    for (const topic of TOPICS) {
      try {
        const res = await this.helix("POST", "/eventsub/subscriptions", {
          type: topic.type,
          version: topic.version,
          condition: topic.cond(user),
          transport: { method: "websocket", session_id: this.sessionId }
        });
        if (res.ok) {
          topic.covers.forEach((t) => this.activeTypes.add(t));
        } else {
          const body = await res.text();
          if (res.status === 403) missingScopes.add(topic.scope);
          console.error(`[eventsub] ${topic.type} failed (${res.status}): ${body}`);
        }
      } catch (err) {
        console.error(`[eventsub] ${topic.type} error:`, err.message);
      }
    }

    if (this.activeTypes.size > 0) {
      this.status = "connected";
      const list = [...this.activeTypes].join(", ");
      this.detail = `Live via EventSub for ${user.login}: ${list}` +
        (missingScopes.size ? ` — reconnect to add: ${[...missingScopes].join(", ")}` : "");
      console.log(`[eventsub] ${this.detail}`);
    } else {
      this.status = "error";
      this.detail = "No EventSub subscriptions succeeded — reconnect your Twitch account with the required scopes.";
      console.error("[eventsub]", this.detail);
    }
  }

  async getUser() {
    const cfg = loadConfig();
    if (cfg.twitch.userId && cfg.twitch.userLogin) {
      return { id: cfg.twitch.userId, login: cfg.twitch.userLogin };
    }
    const res = await this.helix("GET", "/users");
    if (!res.ok) return null;
    const json = await res.json();
    const u = json.data && json.data[0];
    if (!u) return null;
    saveConfig({ ...cfg, twitch: { ...cfg.twitch, userId: u.id, userLogin: u.login } });
    return { id: u.id, login: u.login };
  }

  /** Authorized Helix call that refreshes the token once on a 401. */
  async helix(method, path, body, retried = false) {
    const cfg = loadConfig();
    const res = await fetch(`${HELIX}${path}`, {
      method,
      headers: {
        "Client-Id": cfg.twitch.clientId,
        Authorization: `Bearer ${cfg.twitch.accessToken}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401 && !retried) {
      const ok = await this.refreshToken();
      if (ok) return this.helix(method, path, body, true);
    }
    return res;
  }

  async refreshToken() {
    const cfg = loadConfig();
    const params = new URLSearchParams({
      client_id: cfg.twitch.clientId,
      client_secret: cfg.twitch.clientSecret,
      grant_type: "refresh_token",
      refresh_token: cfg.twitch.refreshToken
    });
    const res = await fetch(OAUTH_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });
    if (!res.ok) {
      console.error("[eventsub] token refresh failed:", res.status);
      return false;
    }
    const json = await res.json();
    saveConfig({
      ...cfg,
      twitch: {
        ...cfg.twitch,
        accessToken: json.access_token,
        refreshToken: json.refresh_token || cfg.twitch.refreshToken
      }
    });
    return true;
  }

  getStatus() {
    return { status: this.status, detail: this.detail, userLogin: loadConfig().twitch.userLogin || "" };
  }
}
