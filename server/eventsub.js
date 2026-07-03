import WebSocket from "ws";
import { loadConfig, saveConfig } from "./config.js";

const EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws";
const HELIX = "https://api.twitch.tv/helix";
const OAUTH_TOKEN = "https://id.twitch.tv/oauth2/token";

/**
 * Twitch EventSub over WebSocket, used for follow alerts.
 *
 * Follows are no longer delivered over chat/IRC, so they can't be read
 * anonymously like subs/cheers/raids. `channel.follow` (v2) requires a user
 * access token carrying the `moderator:read:followers` scope, where the
 * authorizing user is the broadcaster (or a moderator). The streamer connects
 * their own account once via OAuth (see the /auth routes in index.js); the
 * tokens live in config.twitch and are refreshed automatically here.
 */
export class EventSub {
  constructor(onAlert) {
    this.onAlert = onAlert;
    this.ws = null;
    this.sessionId = null;
    this.status = "not_connected"; // not_connected | connecting | connected | error
    this.detail = "";
    this.shouldRun = false;
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
      await this.subscribeFollows();
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
      const subType = msg.payload.subscription.type;
      if (subType === "channel.follow") {
        const ev = msg.payload.event;
        this.onAlert({ type: "follow", name: ev.user_name || ev.user_login || "Someone", raw: ev });
      }
    } else if (type === "revocation") {
      this.status = "error";
      this.detail = "Subscription revoked (token expired or scope removed). Reconnect your Twitch account.";
      console.error("[eventsub]", this.detail);
    }
  }

  async subscribeFollows() {
    try {
      const user = await this.getUser();
      if (!user) {
        this.status = "error";
        this.detail = "Could not resolve your Twitch user. Reconnect your account.";
        return;
      }
      const res = await this.helix("POST", "/eventsub/subscriptions", {
        type: "channel.follow",
        version: "2",
        condition: { broadcaster_user_id: user.id, moderator_user_id: user.id },
        transport: { method: "websocket", session_id: this.sessionId }
      });
      if (res.ok) {
        this.status = "connected";
        this.detail = `Follow alerts active for ${user.login}`;
        console.log(`[eventsub] ${this.detail}`);
      } else {
        const body = await res.text();
        this.status = "error";
        this.detail = `Subscription failed (${res.status}). Ensure the moderator:read:followers scope was granted. ${body}`;
        console.error("[eventsub]", this.detail);
      }
    } catch (err) {
      this.status = "error";
      this.detail = err.message;
      console.error("[eventsub] subscribe error:", err.message);
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
