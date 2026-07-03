/**
 * Parse raw Twitch IRC lines into normalized alert events.
 *
 * The original LachhhTools read Twitch IRC USERNOTICE messages but only ever
 * handled `msg-id=sub` and `msg-id=resub`. It had no branch for `subgift`,
 * `submysterygift` or `anonsubgift`, so gifted subs never fired an alert.
 * This parser closes that gap: gifted subs are first-class events, and the
 * server maps them onto the subscriber alert so they "look the same as the
 * gifted alerts" — the behaviour the tool was meant to have.
 */

/** Parse the IRCv3 tag portion (`@key=value;key2=value2`) into an object. */
function parseTags(tagString) {
  const tags = {};
  if (!tagString) return tags;
  for (const part of tagString.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      tags[part] = "";
      continue;
    }
    const key = part.slice(0, eq);
    let value = part.slice(eq + 1);
    // Twitch escapes these per IRCv3 tag rules.
    value = value
      .replace(/\\s/g, " ")
      .replace(/\\:/g, ";")
      .replace(/\\\\/g, "\\")
      .replace(/\\r/g, "")
      .replace(/\\n/g, "");
    tags[key] = value;
  }
  return tags;
}

/**
 * Split a single raw IRC line into { tags, prefix, command, params, trailing }.
 * Returns null for non-message lines we don't care about.
 */
export function parseLine(line) {
  let rest = line.trim();
  if (rest === "") return null;

  let tags = {};
  if (rest.startsWith("@")) {
    const sp = rest.indexOf(" ");
    tags = parseTags(rest.slice(1, sp));
    rest = rest.slice(sp + 1);
  }

  let prefix = "";
  if (rest.startsWith(":")) {
    const sp = rest.indexOf(" ");
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }

  // Split off the trailing param (everything after " :").
  let trailing = "";
  const trailingIdx = rest.indexOf(" :");
  if (rest.startsWith(":")) {
    trailing = rest.slice(1);
    rest = "";
  } else if (trailingIdx !== -1) {
    trailing = rest.slice(trailingIdx + 2);
    rest = rest.slice(0, trailingIdx);
  }

  const parts = rest.split(" ").filter(Boolean);
  const command = parts[0] || "";
  const params = parts.slice(1);

  return { tags, prefix, command, params, trailing };
}

function planToTier(plan) {
  if (!plan) return "1";
  if (plan === "Prime") return "Prime";
  if (plan === "1000") return "1";
  if (plan === "2000") return "2";
  if (plan === "3000") return "3";
  return plan;
}

/**
 * Turn a parsed line into a normalized alert event, or null if it isn't one.
 *
 * Event shape: { type, name, ...typeSpecificFields, raw }
 * type is one of: follow | sub | resub | giftsub | giftbomb | cheer | raid
 */
export function toAlert(parsed) {
  if (!parsed) return null;
  const { command, tags, trailing } = parsed;

  if (command === "PRIVMSG") {
    // Bits/cheers arrive as normal chat messages carrying a `bits` tag.
    const bits = parseInt(tags.bits, 10);
    if (bits > 0) {
      return {
        type: "cheer",
        name: tags["display-name"] || tags.login || "Someone",
        bits,
        message: trailing || "",
        raw: tags
      };
    }
    return null;
  }

  if (command !== "USERNOTICE") return null;

  const msgId = tags["msg-id"];
  const name = tags["display-name"] || tags.login || "Someone";
  const tier = planToTier(tags["msg-param-sub-plan"]);

  switch (msgId) {
    case "sub": {
      return { type: "sub", name, tier, months: 1, raw: tags };
    }
    case "resub": {
      const months =
        parseInt(tags["msg-param-cumulative-months"], 10) ||
        parseInt(tags["msg-param-months"], 10) ||
        1;
      const streak = parseInt(tags["msg-param-streak-months"], 10) || 0;
      return { type: "resub", name, tier, months, streak, message: trailing || "", raw: tags };
    }
    case "subgift":
    case "anonsubgift": {
      const gifter =
        msgId === "anonsubgift" ? "An anonymous gifter" : name;
      return {
        type: "giftsub",
        // `name` is the recipient so sub-style templates read naturally.
        name: tags["msg-param-recipient-display-name"] || tags["msg-param-recipient-user-name"] || "Someone",
        gifter,
        tier,
        months: parseInt(tags["msg-param-months"], 10) || 1,
        recipient: tags["msg-param-recipient-display-name"] || "",
        raw: tags
      };
    }
    case "submysterygift":
    case "anonsubmysterygift": {
      const gifter =
        msgId === "anonsubmysterygift" ? "An anonymous gifter" : name;
      const count =
        parseInt(tags["msg-param-mass-gift-count"], 10) ||
        parseInt(tags["msg-param-sender-count"], 10) ||
        1;
      return { type: "giftbomb", name: gifter, gifter, tier, count, raw: tags };
    }
    case "raid": {
      return {
        type: "raid",
        name: tags["msg-param-displayName"] || tags["msg-param-login"] || name,
        viewers: parseInt(tags["msg-param-viewerCount"], 10) || 0,
        raw: tags
      };
    }
    default:
      return null;
  }
}
