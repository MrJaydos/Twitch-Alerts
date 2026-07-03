# Twitch Alerts

A modern, self-hostable **Twitch stream alerts overlay** for OBS — Sub, Resub,
Gifted Sub, Cheer/Bits, Raid, and Follow alerts, with a settings dashboard and
one-click test buttons.

This is a ground-up recreation of the alerts portion of the old
[LachhhTools](https://github.com/Lachhh/LachhhTools) (`TwitchGiveawayTool`),
which was an Adobe Flash / ActionScript 3 app. Flash reached end-of-life in
2020 and several services LachhhTools depended on (GameWisp, StreamTip,
PlayerIO) have shut down, so the original can't run today. This rebuild keeps
the useful, still-possible part — the alerts overlay — as a small web app.

### The gifted-sub fix

The original read Twitch IRC `USERNOTICE` messages but only handled
`msg-id=sub` and `msg-id=resub` — it had **no branch for gifted subs**
(`subgift`, `submysterygift`, `anonsubgift`), so gifted subs never triggered an
alert. This version treats gifted subs as first-class events, and by default
renders them with the **same styling as a normal subscriber alert** (the
`Gifted subs use the Subscriber alert style` toggle, on by default) — the way
you remembered it was meant to work. Turn the toggle off to give gifts their
own look.

## Alert types

| Type | Source | Notes |
|------|--------|-------|
| Subscriber | Twitch chat (`USERNOTICE msg-id=sub`) | New subs |
| Resub | `msg-id=resub` | Shows cumulative months + streak |
| Gifted Sub | `msg-id=subgift` / `anonsubgift` | Uses the Sub style by default |
| Gift Bomb | `msg-id=submysterygift` | Mass community gifts |
| Cheer / Bits | chat message with a `bits` tag | |
| Raid | `msg-id=raid` | Incoming raids + viewer count |
| Follow | *EventSub (optional)* | See "Follow alerts" below |

Subs, resubs, gifts, cheers and raids need **no login** — the app reads your
channel's chat anonymously.

## Run it locally (streaming PC)

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

Then:

1. Open **http://localhost:3000/** — the settings page. Enter your Twitch
   channel name and click **Save**. The status pill should read
   `connected to #yourchannel`.
2. In OBS, add a **Browser Source** pointing to
   **http://localhost:3000/overlay.html** — set it to 1920×1080.
3. Back on the settings page, click any **Test** button to preview an alert in
   OBS and position it.

## Deploy on Coolify (or any Docker host)

The repo ships a `Dockerfile` and `docker-compose.yml`.

- **Coolify:** create a new resource from this Git repo. Coolify will build the
  `Dockerfile`. Expose port `3000`, and add a persistent volume mounted at
  `/data` so your settings survive restarts (config is written to
  `/data/config.json` via the `CONFIG_PATH` env var). Optionally set
  `TWITCH_CHANNEL` to pre-fill your channel. **Set `ADMIN_PASSWORD`** to
  protect the dashboard (see below).
- **Plain Docker:**

  ```bash
  docker compose up -d
  ```

Then point your OBS Browser Source at
`https://your-domain/overlay.html`.

## Alert styles

Each alert type has its own animation, set per type on the settings page. The
styles recreate the *choreography* of the original LachhhTools on-stream alerts
(read from the widget source in `platform/xSplitWidget`). The original's custom
cartoon art lived in a compiled widget SWF that isn't in the repo, so emoji/CSS
stand-ins carry the same motion and beats:

- **Punch** *(subs, resubs, gifts)* — full-screen takeover: flash + sunburst,
  a doors nameplate that frames the name, a hard "punch" impact with screen
  shake, and a subtitle (tier / "N MONTHS" / gifter). Mirrors `UI_NewSubAnim`
  (centered `punchMc`/`doorsMc` + sound).
- **Pop** *(follows)* — a quick centered badge pop with the name. Mirrors
  `UI_NewFollowerAnim` (centered, name-only, sound).
- **Cannon** *(cheers)* — a monster rises bottom-right and a cannon fires a
  cash bag arcing across the screen, with the cheerer's name + bits. Mirrors
  `UI_NewCheerAnim` (bottom-right `FxMonster` + `FxCheerBag` fired at frame 52
  with a boom).
- **Rainbow** *(raids)* — a centered rainbow + sparkles celebration with the
  raider's name and party size. Mirrors the host alert `UI_NewHostAnim`
  ("rainbow" big variant + sparkle/crowd sounds).
- **Banner** — a compact top notification (a clean fallback for any type).

Each style plays a **built-in synthesized sound** (impact / pop / boom /
fanfare — no files needed); set a Sound URL to override it. Punch/rainbow
subtitles and the cheer bits come straight from the event; the Message field
applies to the banner style.

## Design

The overlay's look is taken from the original LachhhTools Flash source
(`LachhhToolsInterfaces.fla`): the dark charcoal glass panel (`#13181B` /
`#1D262C`), the faint teal border (`#80A297`), the mint alert label (`#A2CAB8`)
and near-white name (`#E1F7F1`), and the geometric bold typography. The
original used the commercial *Nexa* font; a close open-source substitute
(Montserrat, OFL) is bundled and self-hosted under `public/fonts`. The elastic
entrance recreates the feel of the original's ActionScript motion effects
(`EffectGotoElastic` / `EffectKickBack` / `EffectSquash`). All colours, text and
timing remain editable per alert on the settings page.

## Password protection

Set the `ADMIN_PASSWORD` environment variable to require a login for the
settings dashboard and its config/test/auth APIs. The **overlay URL and its
WebSocket stay open** (unauthenticated) so OBS can always load them.

- **Local:** leave it unset — the app is bound to your machine anyway, so no
  password is needed.
- **Public / Coolify:** set `ADMIN_PASSWORD` so only you can reach the
  dashboard. Anyone with the overlay URL can still display alerts, but they
  can't change your settings or fire tests.

When set, visiting the dashboard shows a login page; a session cookie keeps you
logged in for 30 days, and there's a **Log out** button in the header.

## Configuration

Everything is editable from the settings page. Per alert type you can set:

- Enable/disable
- Title and message text (with tokens — see below)
- On-screen duration
- Accent + text colours
- Image URL (GIF/PNG shown next to the text)
- Sound URL + volume

### Message tokens

Use these in the **Message** field; they're filled in per event:

| Token | Meaning | Available on |
|-------|---------|--------------|
| `{name}` | Viewer name (recipient for gifts) | all |
| `{gifter}` | Who gifted | giftsub, giftbomb |
| `{recipient}` | Gift recipient | giftsub |
| `{months}` | Cumulative months | sub, resub, giftsub |
| `{streak}` | Consecutive months | resub |
| `{tier}` | Sub tier (`1`/`2`/`3`/`Prime`) | subs, gifts |
| `{bits}` | Bits cheered | cheer |
| `{viewers}` | Raid party size | raid |
| `{count}` | Number of gifted subs | giftbomb |

Config is stored in `config.json` (git-ignored). `config.example.json` shows the
full shape.

## Follow alerts

Subs, resubs, gifts, cheers and raids need no login. **Follows** are the one
exception: Twitch no longer delivers them over chat, so they require
[EventSub](https://dev.twitch.tv/docs/eventsub/) with an authenticated token.
This is a one-time setup on the settings page:

1. Go to the [Twitch developer console](https://dev.twitch.tv/console/apps) and
   **Register Your Application**.
   - **OAuth Redirect URL:** copy it from the *Follow alerts* card on the
     settings page (the "Copy redirect URL" button). Locally this is
     `http://localhost:3000/auth/callback`; on Coolify use your public URL.
   - **Category:** Broadcasting Suite (any is fine).
2. Copy the app's **Client ID** and generate a **Client Secret**, paste both
   into the *Follow alerts* card, and click **Connect Twitch account**.
3. Authorize with the account you stream from (the `moderator:read:followers`
   scope is requested). You'll be redirected back and the status turns green.

Under the hood the app opens a Twitch EventSub WebSocket, subscribes to
`channel.follow` (v2), and refreshes the access token automatically. If you run
behind a reverse proxy (Coolify), set **Public URL** in that card (or the
`PUBLIC_URL`/`publicUrl` config value) so the OAuth redirect matches what you
registered.

Tokens are stored only in `config.json` (git-ignored) and are never sent back
to the browser.

## How it works

```
Twitch chat (anonymous IRC over WebSocket)
        │  USERNOTICE / PRIVMSG+bits
        ▼
  server/ircParser.js   → normalized alert event
        ▼
  server/index.js       → picks the alert's style block
        │  (gifts → sub style when treatGiftedAsSub is on)
        ▼  WebSocket /ws
  public/overlay.js     → queues + animates one alert at a time  →  OBS
```

- `server/twitchChat.js` — anonymous Twitch chat connection, auto-reconnect.
- `server/ircParser.js` — turns raw IRC lines into alert events.
- `server/index.js` — Express + WebSocket hub, config API, `/api/test`.
- `public/overlay.*` — the OBS browser source.
- `public/settings.*` — the dashboard.

## License

MIT
