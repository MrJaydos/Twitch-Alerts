import { loadConfig } from "./config.js";

/**
 * Processes a normalized alert event before it fires, applying (in order):
 *   1. ignore list  — drop bots / muted accounts
 *   2. thresholds   — drop cheers/raids below a minimum
 *   3. gift grouping — collapse a community gift bomb into one alert
 *   4. dedupe       — drop identical events delivered twice in quick succession
 *   5. TTS gating   — mark speak=false and mask profanity in spoken text
 *
 * Returns { drop, reason, event } — event may be mutated (message, speak).
 */

const BOMB_WINDOW_MS = 60_000; // how long a gift bomb suppresses its gifts
const DEDUPE_MS = 1500;

const recentBombs = new Map(); // originId -> expiry ts
const recentEvents = []; // { key, time } for dedupe

// Basic profanity mask. Not exhaustive — a sensible default that catches the
// common strong words; extend as needed.
const PROFANITY = [
  "fuck", "shit", "bitch", "cunt", "asshole", "dick", "pussy", "bastard",
  "nigger", "nigga", "faggot", "retard", "whore", "slut", "cock"
];
const profanityRe = new RegExp(`\\b(${PROFANITY.join("|")})\\b`, "gi");
function maskProfanity(text) {
  return text.replace(profanityRe, (w) => w[0] + "*".repeat(Math.max(1, w.length - 1)));
}

function matchesList(event, list) {
  if (!list || list.length === 0) return false;
  const set = new Set(list.map((s) => String(s).trim().toLowerCase()).filter(Boolean));
  if (event.login && set.has(event.login.toLowerCase())) return true;
  if (event.name && set.has(event.name.toLowerCase())) return true;
  return false;
}

function cleanupBombs() {
  const now = Date.now();
  for (const [id, exp] of recentBombs) if (exp < now) recentBombs.delete(id);
}

export function processEvent(event) {
  const cfg = loadConfig();
  const f = cfg.filters || {};
  const tts = cfg.tts || {};

  // 1. ignore list
  if (matchesList(event, f.ignoreUsers)) return { drop: true, reason: "ignored user", event };

  // 2. thresholds
  if (event.type === "cheer" && (event.bits || 0) < (f.minBits || 0)) {
    return { drop: true, reason: `below ${f.minBits} bits`, event };
  }
  if (event.type === "raid" && (event.viewers || 0) < (f.minRaidViewers || 0)) {
    return { drop: true, reason: `raid below ${f.minRaidViewers} viewers`, event };
  }

  // 3. gift bomb grouping
  if (f.groupGiftBombs !== false) {
    cleanupBombs();
    if (event.type === "giftbomb" && event.originId) {
      recentBombs.set(event.originId, Date.now() + BOMB_WINDOW_MS);
    } else if (event.type === "giftsub" && event.originId && recentBombs.has(event.originId)) {
      return { drop: true, reason: "part of gift bomb", event };
    }
  }

  // 4. dedupe identical rapid events (e.g. a USERNOTICE delivered twice)
  const now = Date.now();
  const key = `${event.type}|${(event.name || "").toLowerCase()}|${
    event.bits ?? event.months ?? event.viewers ?? event.count ?? ""
  }`;
  for (let i = recentEvents.length - 1; i >= 0; i--) {
    if (now - recentEvents[i].time > DEDUPE_MS) recentEvents.splice(i, 1);
  }
  if (recentEvents.some((e) => e.key === key)) return { drop: true, reason: "duplicate", event };
  recentEvents.push({ key, time: now });

  // 5. TTS gating + profanity
  let speak = true;
  if (event.type === "cheer" && (event.bits || 0) < (tts.minBits || 0)) speak = false;
  if (matchesList(event, tts.mutedUsers)) speak = false;
  if (tts.filterProfanity && typeof event.message === "string") {
    event.message = maskProfanity(event.message);
  }
  event.speak = speak;

  return { drop: false, reason: null, event };
}
