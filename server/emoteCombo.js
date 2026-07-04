/**
 * Detects "emote combos": the same emote appearing enough times across
 * recent chat messages within a short window. Used to trigger the original
 * widget's built-in emote-firework animation (a compiled feature the SWF
 * already has — this module just decides when to fire it).
 */
export class EmoteCombo {
  /**
   * @param {() => object} getConfig - returns the live emoteCombo config
   *   ({ enabled, threshold, windowSeconds, cooldownSeconds, burstSize }).
   * @param {(emoteId: string, count: number) => void} onFire
   */
  constructor(getConfig, onFire) {
    this.getConfig = getConfig;
    this.onFire = onFire;
    this.recent = new Map(); // emoteId -> timestamps[]
    this.cooldownUntil = new Map(); // emoteId -> ms timestamp
  }

  /** counts: { [emoteId]: occurrencesInThisMessage } from parseEmotesTag(). */
  handleEmoteCounts(counts) {
    const cfg = this.getConfig() || {};
    if (!cfg.enabled || !counts) return;
    const now = Date.now();
    const windowMs = (cfg.windowSeconds ?? 8) * 1000;
    const cooldownMs = (cfg.cooldownSeconds ?? 20) * 1000;
    const threshold = cfg.threshold ?? 5;

    for (const [id, occurrences] of Object.entries(counts)) {
      const until = this.cooldownUntil.get(id) || 0;
      if (now < until) continue;

      const times = (this.recent.get(id) || []).filter((t) => now - t <= windowMs);
      for (let i = 0; i < occurrences; i++) times.push(now);
      this.recent.set(id, times);

      if (times.length >= threshold) {
        this.recent.set(id, []);
        this.cooldownUntil.set(id, now + cooldownMs);
        this.onFire(id, times.length);
      }
    }
  }
}
