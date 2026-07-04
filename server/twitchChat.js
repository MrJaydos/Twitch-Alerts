import WebSocket from "ws";
import { parseLine, toAlert } from "./ircParser.js";

const IRC_URL = "wss://irc-ws.chat.twitch.tv:443";

/**
 * Connects anonymously to a channel's Twitch chat and emits normalized alert
 * events via the supplied callback. No OAuth token is required to *read* a
 * channel — we log in as an anonymous `justinfan` user and request the tags +
 * commands capabilities so USERNOTICE (subs/gifts/raids) and cheer tags arrive.
 */
export class TwitchChat {
  constructor(onAlert) {
    this.onAlert = onAlert;
    this.channel = "";
    this.ws = null;
    this.reconnectDelay = 2000;
    this.status = "disconnected";
    this.shouldRun = false;
    this.shouldSuppress = null; // (type) => bool; set by the server for EventSub dedupe
    this.onChatLine = null; // (parsed) => void; called for every parsed line, alert or not
  }

  setChannel(channel) {
    const next = (channel || "").trim().toLowerCase().replace(/^#/, "");
    if (next === this.channel && this.status === "connected") return;
    this.channel = next;
    this.restart();
  }

  restart() {
    this.shouldRun = !!this.channel;
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    if (this.shouldRun) this.connect();
    else this.status = "disconnected";
  }

  connect() {
    if (!this.channel) return;
    this.status = "connecting";
    const nick = "justinfan" + Math.floor(Math.random() * 90000 + 10000);
    const ws = new WebSocket(IRC_URL);
    this.ws = ws;

    ws.on("open", () => {
      ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      ws.send("PASS SCHMOOPIIE");
      ws.send(`NICK ${nick}`);
      ws.send(`JOIN #${this.channel}`);
    });

    ws.on("message", (data) => {
      const raw = data.toString();
      for (const line of raw.split("\r\n")) {
        if (line === "") continue;
        if (line.startsWith("PING")) {
          ws.send("PONG :tmi.twitch.tv");
          continue;
        }
        if (line.includes(" 001 ") || line.includes(":Welcome, GLHF!")) {
          this.status = "connected";
          this.reconnectDelay = 2000;
          console.log(`[chat] Connected to #${this.channel}`);
          continue;
        }
        try {
          const parsed = parseLine(line);
          if (this.onChatLine) this.onChatLine(parsed);
          const alert = toAlert(parsed);
          if (alert) {
            // Skip types EventSub is already delivering (avoids double alerts).
            if (this.shouldSuppress && this.shouldSuppress(alert.type)) continue;
            alert.rawLine = line;
            this.onAlert(alert, "twitch");
          }
        } catch (err) {
          console.error("[chat] parse error:", err.message, "\n  line:", line);
        }
      }
    });

    ws.on("close", () => {
      if (this.status !== "disconnected") this.status = "reconnecting";
      if (this.shouldRun) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      }
    });

    ws.on("error", (err) => {
      console.error("[chat] socket error:", err.message);
    });
  }

  getStatus() {
    return { status: this.status, channel: this.channel };
  }
}
