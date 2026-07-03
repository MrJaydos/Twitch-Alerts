import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.CONFIG_PATH || join(__dirname, "..", "config.json");

/**
 * Default configuration. Every alert type has its own block so streamers can
 * tune text, timing and look independently.
 *
 * `treatGiftedAsSub` reproduces the behaviour the original LachhhTools was
 * *supposed* to have: a gifted sub should look and feel like a normal
 * subscriber alert. When true, gift alerts render with the `sub` block's
 * styling (image/sound/colour/duration) while still exposing the gifter.
 */
export const DEFAULT_CONFIG = {
  channel: "",
  // Anonymous chat read needs no token. A token is only required if you want
  // real follow alerts (delivered over EventSub, not chat).
  twitch: {
    eventsubToken: "",
    clientId: ""
  },
  // When true, gifted-sub alerts use the `sub` alert styling.
  treatGiftedAsSub: true,
  alerts: {
    follow: {
      enabled: true,
      duration: 6000,
      title: "New Follower",
      message: "{name} just followed!",
      accentColor: "#9147ff",
      textColor: "#ffffff",
      image: "",
      sound: "",
      soundVolume: 0.6
    },
    sub: {
      enabled: true,
      duration: 7000,
      title: "New Subscriber",
      message: "{name} subscribed at Tier {tier}!",
      accentColor: "#1db954",
      textColor: "#ffffff",
      image: "",
      sound: "",
      soundVolume: 0.7
    },
    resub: {
      enabled: true,
      duration: 7000,
      title: "Resub",
      message: "{name} resubscribed for {months} months!",
      accentColor: "#1db954",
      textColor: "#ffffff",
      image: "",
      sound: "",
      soundVolume: 0.7
    },
    giftsub: {
      enabled: true,
      duration: 7000,
      title: "Gifted Sub",
      message: "{gifter} gifted a sub to {name}!",
      accentColor: "#1db954",
      textColor: "#ffffff",
      image: "",
      sound: "",
      soundVolume: 0.7
    },
    giftbomb: {
      enabled: true,
      duration: 8000,
      title: "Gift Bomb",
      message: "{gifter} is gifting {count} subs to the community!",
      accentColor: "#e91916",
      textColor: "#ffffff",
      image: "",
      sound: "",
      soundVolume: 0.8
    },
    cheer: {
      enabled: true,
      duration: 7000,
      title: "Bits",
      message: "{name} cheered {bits} bits!",
      accentColor: "#772ce8",
      textColor: "#ffffff",
      image: "",
      sound: "",
      soundVolume: 0.7
    },
    raid: {
      enabled: true,
      duration: 8000,
      title: "Raid",
      message: "{name} raided with {viewers} viewers!",
      accentColor: "#f0a500",
      textColor: "#ffffff",
      image: "",
      sound: "",
      soundVolume: 0.8
    }
  }
};

function deepMerge(base, override) {
  if (Array.isArray(base) || typeof base !== "object" || base === null) {
    return override === undefined ? base : override;
  }
  const out = { ...base };
  for (const key of Object.keys(base)) {
    if (override && key in override) {
      out[key] = deepMerge(base[key], override[key]);
    }
  }
  // keep any extra keys the user added
  if (override) {
    for (const key of Object.keys(override)) {
      if (!(key in out)) out[key] = override[key];
    }
  }
  return out;
}

let cache = null;

export function loadConfig() {
  if (cache) return cache;
  let fromDisk = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      fromDisk = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    } catch (err) {
      console.error(`[config] Failed to parse ${CONFIG_PATH}:`, err.message);
    }
  }
  // env override for channel makes container deploys easy
  if (process.env.TWITCH_CHANNEL) {
    fromDisk.channel = process.env.TWITCH_CHANNEL;
  }
  cache = deepMerge(DEFAULT_CONFIG, fromDisk);
  return cache;
}

export function saveConfig(next) {
  cache = deepMerge(DEFAULT_CONFIG, next);
  writeFileSync(CONFIG_PATH, JSON.stringify(cache, null, 2));
  return cache;
}

export function getConfigPath() {
  return CONFIG_PATH;
}
