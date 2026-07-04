import { loadConfig } from "./config.js";

/**
 * Drives the hype/combo meter (/hype.html). Two sources:
 *  - Real Twitch Hype Trains via EventSub (authoritative while a train runs).
 *  - A homegrown "combo" meter that accumulates points from rapid support
 *    (subs/gifts/bits) and empties after a period of quiet.
 *
 * Emits `{ kind: "hype", active, level, progress (0..1), total, source, levelUp,
 * label }` over the broadcast function it's given.
 */
export class HypeTracker {
  constructor(broadcast) {
    this.broadcast = broadcast;
    this.points = 0;
    this.level = 0;
    this.decayTimer = null;
    this.twitchActive = false;
    this.twitchTimer = null;
    this.last = { kind: "hype", active: false, level: 0, progress: 0, source: "combo" };
  }

  cfg() {
    return loadConfig().hype || {};
  }

  // --- homegrown combo meter ---------------------------------------------
  addSupport(event) {
    const c = this.cfg();
    if (c.enabled === false) return;
    if (this.twitchActive) return; // a real Hype Train takes over

    let pts = 0;
    if (event.type === "sub" || event.type === "resub" || event.type === "giftsub") {
      pts = c.pointsPerSub || 100;
    } else if (event.type === "giftbomb") {
      pts = (c.pointsPerSub || 100) * (event.count || 1);
    } else if (event.type === "cheer") {
      pts = Math.round(((event.bits || 0) / 100) * (c.pointsPerHundredBits || 100));
    }
    if (pts <= 0) return;

    const levelPoints = Math.max(1, c.levelPoints || 500);
    const prevLevel = this.level;
    this.points += pts;
    this.level = Math.floor(this.points / levelPoints) + 1;
    const progress = (this.points % levelPoints) / levelPoints;
    this.emit({
      active: true,
      level: this.level,
      progress,
      total: this.points,
      source: "combo",
      levelUp: prevLevel > 0 && this.level > prevLevel
    });
    this.armDecay((c.decaySeconds || 300) * 1000);
  }

  armDecay(ms) {
    clearTimeout(this.decayTimer);
    this.decayTimer = setTimeout(() => this.resetCombo(), ms);
  }

  resetCombo() {
    this.points = 0;
    this.level = 0;
    this.emit({ active: false, level: 0, progress: 0, total: 0, source: "combo" });
  }

  // --- real Twitch Hype Train --------------------------------------------
  // update: { phase: "begin"|"progress"|"end", level, progress (0..1), total }
  fromTwitch(update) {
    if (update.phase === "end") {
      this.twitchActive = false;
      clearTimeout(this.twitchTimer);
      this.emit({ active: false, level: 0, progress: 0, total: 0, source: "twitch" });
      return;
    }
    const wasActive = this.twitchActive;
    this.twitchActive = true;
    this.emit({
      active: true,
      level: update.level || 1,
      progress: update.progress || 0,
      total: update.total || 0,
      source: "twitch",
      levelUp: wasActive && update.phase === "progress" && update.levelUp === true
    });
    // Safety: clear if no end event arrives (trains last a few minutes).
    clearTimeout(this.twitchTimer);
    this.twitchTimer = setTimeout(() => {
      this.twitchActive = false;
      this.emit({ active: false, level: 0, progress: 0, total: 0, source: "twitch" });
    }, 15 * 60 * 1000);
  }

  emit(state) {
    this.last = { kind: "hype", label: "HYPE", ...state };
    this.broadcast(this.last);
  }

  getState() {
    return this.last;
  }
}
