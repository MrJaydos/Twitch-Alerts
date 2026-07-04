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
  // Anonymous chat read needs no token. Credentials/tokens here are only used
  // for follow alerts (delivered over EventSub, not chat). They're written by
  // the OAuth flow and refreshed automatically; config.json is git-ignored.
  twitch: {
    clientId: "",
    clientSecret: "",
    accessToken: "",
    refreshToken: "",
    userId: "",
    userLogin: "",
    // Optional. Set when running behind a proxy (e.g. Coolify) so the OAuth
    // redirect URI matches what you registered, e.g. https://alerts.example.com
    publicUrl: ""
  },
  // When true, gifted-sub alerts use the `sub` alert styling.
  treatGiftedAsSub: true,
  // Event filtering, applied before any alert fires (to both overlays).
  filters: {
    // Logins/names to ignore entirely (bots, yourself). Case-insensitive.
    ignoreUsers: [
      "nightbot", "streamelements", "streamlabs", "moobot", "wizebot",
      "fossabot", "soundalerts", "soundalert", "commanderroot",
      "anotherttvviewer", "streamlootsbot"
    ],
    // Drop cheers / raids below these sizes (0 = allow all).
    minBits: 0,
    minRaidViewers: 0,
    // Collapse a community gift bomb (mystery gift + its individual gifts)
    // into a single alert instead of one per recipient.
    groupGiftBombs: true
  },
  // Text-to-speech, spoken by the overlay after an alert fires.
  //   provider: "streamelements" (plays an MP3 from StreamElements' speech API,
  //             works inside OBS's browser source), "browser" (Web Speech API,
  //             may be silent in OBS), or "off".
  //   voice:    StreamElements voice name (Brian is the classic Twitch TTS).
  tts: {
    provider: "streamelements",
    voice: "Brian",
    volume: 1,
    maxLength: 200,
    minBits: 0,             // only speak cheers with at least this many bits
    filterProfanity: true,  // mask common profanity in spoken messages
    mutedUsers: []          // names/logins whose messages are never spoken
  },
  alerts: {
    follow: {
      enabled: true,
      style: "pop",
      target: "both",
      duration: 6000,
      title: "New Follower",
      message: "{name} just followed!",
      tts: false,
      ttsTemplate: "{name} just followed",
      accentColor: "#5ec8c8",
      textColor: "#e1f7f1",
      image: "",
      sound: "",
      soundVolume: 0.6,
      variations: []
    },
    sub: {
      enabled: true,
      style: "punch",
      target: "both",
      duration: 7000,
      title: "New Subscriber",
      message: "{name} subscribed at Tier {tier}!",
      tts: true,
      ttsTemplate: "{name} just subscribed",
      accentColor: "#a2cab8",
      textColor: "#e1f7f1",
      image: "",
      sound: "",
      soundVolume: 0.7,
      variations: []
    },
    resub: {
      enabled: true,
      style: "punch",
      target: "both",
      duration: 7000,
      title: "Resub",
      message: "{name} resubscribed for {months} months!",
      tts: true,
      ttsTemplate: "{name} resubscribed for {months} months",
      accentColor: "#a2cab8",
      textColor: "#e1f7f1",
      image: "",
      sound: "",
      soundVolume: 0.7,
      variations: []
    },
    giftsub: {
      enabled: true,
      style: "punch",
      target: "both",
      duration: 7000,
      title: "Gifted Sub",
      message: "{gifter} gifted a sub to {name}!",
      tts: true,
      ttsTemplate: "{gifter} gifted a sub to {name}",
      accentColor: "#a2cab8",
      textColor: "#e1f7f1",
      image: "",
      sound: "",
      soundVolume: 0.7,
      variations: []
    },
    giftbomb: {
      enabled: true,
      style: "punch",
      target: "both",
      duration: 8000,
      title: "Gift Bomb",
      message: "{gifter} is gifting {count} subs to the community!",
      tts: true,
      ttsTemplate: "{gifter} gifted {count} subs to the community",
      accentColor: "#a2cab8",
      textColor: "#e1f7f1",
      image: "",
      sound: "",
      soundVolume: 0.8,
      variations: []
    },
    cheer: {
      enabled: true,
      style: "cannon",
      target: "both",
      duration: 7000,
      title: "Bits",
      message: "{name} cheered {bits} bits!",
      tts: true,
      ttsTemplate: "{name} cheered {bits} bits. {message}",
      accentColor: "#a06ce6",
      textColor: "#e1f7f1",
      image: "",
      sound: "",
      soundVolume: 0.7,
      variations: []
    },
    raid: {
      enabled: true,
      style: "rainbow",
      target: "both",
      duration: 8000,
      title: "Raid",
      message: "{name} raided with {viewers} viewers!",
      tts: false,
      ttsTemplate: "{name} raided with {viewers} viewers",
      accentColor: "#f0b24a",
      textColor: "#e1f7f1",
      image: "",
      sound: "",
      soundVolume: 0.8,
      variations: []
    },
    // Fires the first time a viewer ever chats (Twitch's first-message flag).
    firstchat: {
      enabled: false,
      style: "banner",
      target: "both",
      duration: 6000,
      title: "First Message",
      message: "{name} is chatting for the first time!",
      tts: false,
      ttsTemplate: "Welcome {name}",
      accentColor: "#ff8ac2",
      textColor: "#e1f7f1",
      image: "",
      sound: "",
      soundVolume: 0.5,
      variations: []
    }
  },
  // Session goal bars shown on /goals.html. `current` auto-increments on the
  // matching events and is persisted; reset it from the settings page.
  goals: {
    subs: { enabled: false, label: "Sub Goal", current: 0, target: 50 },
    follows: { enabled: false, label: "Follower Goal", current: 0, target: 100 }
  },
  // Hype / combo meter shown on /hype.html. Real Twitch Hype Trains drive it
  // when your account is connected; otherwise a homegrown combo meter builds
  // from rapid subs/gifts/bits and empties after `decaySeconds` of quiet.
  hype: {
    enabled: true,
    pointsPerSub: 100,        // sub / resub / gift (per sub)
    pointsPerHundredBits: 100, // points per 100 bits cheered
    levelPoints: 500,         // points to advance one combo level
    decaySeconds: 300         // reset the combo meter after this much quiet
  },
  // Logins of raiders we've seen before (for "welcome back" on returning raids).
  seenRaiders: []
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
