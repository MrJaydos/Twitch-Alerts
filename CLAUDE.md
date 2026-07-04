# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A self-hostable Twitch stream-alerts app: a Node server reads Twitch events and
drives **two** OBS browser-source overlays. It's a modern recreation of the
alerts portion of the defunct Flash tool **LachhhTools** (the original repo:
`Lachhh/LachhhTools`, an Adobe Flash / AS3 project — kept for reference, not a
dependency).

## Commands

```bash
npm install
npm start        # node server/index.js  (PORT env or 3000)
npm run dev      # same, with --watch auto-reload
```

There is **no build step, no linter, and no test suite.** To verify overlay
changes, drive them with headless Chromium (Playwright is available in this
environment via `playwright-core`, Chromium at `/opt/pw-browsers/chromium-*`):
start the server on a spare port, open `/overlay.html` or `/widget.html`, fire
an event via `POST /api/test {type}` or `POST /api/replay {line}`, and
screenshot. The server logs every alert and pipeline decision.

Server-side logic (parser, pipeline, EventSub mapping) is best exercised by
importing the module and calling the function directly with a synthetic event,
or by `POST /api/replay` with a raw IRC line.

Config lives in `config.json` (git-ignored, created on first save). Delete it to
reset. `config.example.json` is generated from `DEFAULT_CONFIG` — regenerate
after changing the schema:
`node -e 'import("./server/config.js").then(m=>require("fs").writeFileSync("config.example.json",JSON.stringify({...m.DEFAULT_CONFIG,channel:"your_channel_name"},null,2)+"\n"))'`

## Architecture — the event spine

Everything funnels through **one function, `handleAlert(event, source)` in
`server/index.js`.** Understanding the flow across these files is the key to the
codebase:

1. **Sources** produce a *normalized event* (`{ type, name, login, ... }`):
   - `server/twitchChat.js` — anonymous Twitch IRC over WebSocket (no auth).
     Parses lines with `server/ircParser.js` (`parseLine` → `toAlert`). Covers
     subs/resubs/gifts/cheers/raids/first-chat.
   - `server/eventsub.js` — Twitch EventSub WebSocket (needs OAuth). Covers
     follows plus subs/resubs/cheers/raids when connected.
   - `POST /api/test` and `POST /api/replay` (test/replay sources).
2. **`handleAlert`** runs the event through `server/pipeline.js` `processEvent`
   (ignore-list, thresholds, gift-bomb grouping, dedupe, TTS gating +
   profanity), then applies returning-raider flag, `resolveAlert` (which config
   block styles it), and `applyVariations`.
3. **Two sinks**, both fed from the same event:
   - `broadcast()` → `/ws` WebSocket → **`public/overlay.html`** (the modern
     CSS/SVG overlay) and `public/goals.html`.
   - `feedWidget()` → `/widget-socket` WebSocket → **`public/widget.html`** (the
     original `lachhhWidget.swf` running in Ruffle). `toWidgetMessage()`
     translates the normalized event into the widget's socket JSON protocol.

Normalized event `type` values: `follow, sub, resub, giftsub, giftbomb, cheer,
raid, firstchat`. Gifts intentionally stay on the **chat** path (EventSub's gift
event lacks recipient names), so `eventsub.activeTypes` never includes gifts and
`chat.shouldSuppress` only suppresses the types EventSub actually delivers — this
is the sub/cheer/raid dedup mechanism between the two sources.

## The two overlays

- **Modern overlay** (`public/overlay.{html,js,css}`): transparent. Per-type
  animation "styles" (`banner`, `punch`, `pop`, `cannon`, `rainbow`) built from
  custom SVG art + a canvas particle engine. Reads the per-alert config `style`
  block from the broadcast payload; supports variations, TTS, goals.
- **Original widget** (`public/widget.html` + `public/widget/`): the actual
  `lachhhWidget.swf` played by the bundled Ruffle Flash emulator. Ruffle proxies
  the SWF's Flash TCP socket (`127.0.0.1:9231`) to `/widget-socket`; the server
  answers the Flash socket-policy request, sends a minimal `{"type":"refreshConfig"}`
  to unlock the built-in animations, then feeds `subAlert`/`followAlert`/
  `cheerAlert`/`hostAlert` messages. The widget renders on **green** for OBS
  chroma key. The SWF's built-in donation-goal bar and news ticker are patched
  out at the AS3 level (see "Widget SWF patching" below), so `widget.html` is
  just the Ruffle player — no CSS masking, no `/ws` subscription of its own.
  **The modern-overlay-only features (variations, goals, first-chat, per-type
  styles) do not affect the widget** — it draws its own compiled animations.

## Widget SWF patching

`public/widget/lachhhWidget.swf` is a compiled AS3 SWF (no source in this
repo). It originally always booted `MainGame.startNormalDonation()`, which —
besides wiring up the alert-handling socket listener — also spawned the
original tool's built-in donation-goal bar (`UI_DonationWidget`) and
promotional news ticker (`UI_News`, an ad/self-promo carousel unrelated to
alerts). That boot call was repointed to the SWF's own
`startNormalDonationWithoutNewsAndWidget()` method (same class,
`com.flashinit.ReleaseDonationInit`), which skips both chrome widgets while
leaving the alert listener (`LogicAddDonation`) untouched.

Two other classes independently resurrect `UI_News` after they finish, so the
boot-time fix alone wasn't enough: `MetaCmdPlayHostAlert.onAnimEnded()` (runs
after every raid/host alert) and `MetaCmdAddDonation.onEndDonation()` (runs
after a donation, not currently reachable since this server never sends a
`newDonation` message — patched anyway for when/if it is). Both `MainGame.
instance.createNews();` calls were deleted. `UI_DonationWidget` has no other
instantiation site, so the boot-time fix fully covers it.

To re-patch or inspect further: decompile/recompile with JPEXS FFDec
(`ffdec-cli.jar`, needs a JRE — no Java/FFDec install is assumed on this
machine, download portable copies if needed). `-export script <dir>
lachhhWidget.swf` pulls AS3 source; after editing, `-importScript
lachhhWidget.swf out.swf <dir>` rebuilds the SWF. It's a binary, un-diffable
asset, so verify visually — load `widget.html` (or a bare Ruffle player
pointed at the file) in a real browser or headless Chrome via CDP, and
screenshot both idle and mid-alert (including after the alert ends, since the
resurrection bug above only showed up post-alert).

**Cache-busting**: `.swf` is served with a week-long `Cache-Control` (see
`server/index.js`), so replacing the file under the same URL won't reach
already-loaded browsers/OBS sources — they'll keep the old binary for up to a
week. `widget.html` loads it as `/widget/lachhhWidget.swf?vN` — bump `N`
every time the SWF is replaced so the URL actually changes.

### Widget-only extras (spook, emote fireworks) — disabled by default, known-broken

`LogicAddDonation.handleMsg()` in the SWF has working cases for message types
the server never used: `halloweenSpook` (plays `UI_Charity.playSpook()`, a
jump-scare) and `emoteFirework` (spawns `EmoteFirework` instances loaded from
Twitch's emote CDN by numeric ID). `server/emoteCombo.js` and the chat-command
handling in `server/index.js` (`onChatLine`, `triggerSpook`) detect when to
fire them — that part works and is safe. **Actually sending either message
type to the widget is not**: confirmed via headless-Chrome testing that
whichever alert plays *after* one of these two corrupts — a Halloween spook
permanently stalls the AS3 command queue (no further alerts ever render again
on that connection) and an emote firework burst causes the *next* alert to
render an unrelated starter-kit splash screen instead of itself. Both
reproduced with the handler code reduced to a no-op / the switch case emptied
entirely, which rules out our AS3 edits (`UI_Charity.isTemp`,
`MetaCmdPlayHalloweenAlert`) as the cause — something deeper in the compiled
widget or Ruffle's socket/AVM2 handling breaks when either message type is
received, and it wasn't isolated further. `config.spook.enabled` and
`config.emoteCombo.enabled` default to `false`; don't flip them on for a live
stream without re-verifying (fire one, then fire a normal test alert
afterward and confirm it still renders) — see git history around this comment
for the failed debugging session if picking this back up.

## Config model (`server/config.js`)

Single source of truth. `loadConfig()` deep-merges `DEFAULT_CONFIG` with the
on-disk `config.json` and **caches the result at module level** — `saveConfig()`
replaces the cache, so always mutate through `saveConfig`, and note that a stale
in-process cache means the running server won't see external edits to
`config.json` without a restart. `deepMerge` **replaces arrays wholesale**
(so `ignoreUsers`, `variations`, `seenRaiders` round-trip by replacement, not
element merge). The settings page (`public/settings.{html,js}`) reads/writes the
whole config via `GET`/`POST /api/config`; `sanitizeConfig` strips Twitch
secrets/tokens before sending to the browser, and `mergeInboundConfig` protects
server-held secrets from being clobbered by the sanitized payload.

## Auth, caching, deploy

- `ADMIN_PASSWORD` env enables a session-cookie login for the dashboard + config
  APIs. The overlays and `/ws`/`/widget-socket` stay open (OBS needs them
  unauthenticated); see `OPEN_PATHS` and the `/fonts/` + `/widget/` prefixes.
- HTML/JS/CSS are served `no-cache` (OBS caches hard); fonts/images/`.swf`/`.wasm`
  cache for a week. `.wasm`/`.swf` get explicit content-types. After code
  changes the user still may need to Refresh the OBS Browser Source once.
- Ships a `Dockerfile` + `docker-compose.yml`; on Coolify mount a volume at
  `/data` (config is written to `CONFIG_PATH=/data/config.json`).

## Workflow

There's no CI or staging environment — `main` auto-deploys to Coolify on
push. After making a change (and sanity-checking it), commit and push to
`main` directly without asking for confirmation first; that's the only way
changes reach the user's environment for testing.

## Conventions

- ES modules (`"type": "module"`), Node ≥18, only two runtime deps (`express`,
  `ws`). Keep it dependency-light. Twitch/StreamElements calls use global `fetch`.
- When adding an alert type or field: update `ircParser.js`/`eventsub.js` (parse),
  `pipeline.js` (if it needs filtering), `config.js` `DEFAULT_CONFIG` (block +
  regenerate example), `toWidgetMessage` (if the widget should show it), the
  overlay renderer, and the settings UI.
