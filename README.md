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
  `TWITCH_CHANNEL` to pre-fill your channel.
- **Plain Docker:**

  ```bash
  docker compose up -d
  ```

Then point your OBS Browser Source at
`https://your-domain/overlay.html`.

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

Twitch no longer delivers follow events over chat/IRC — they require
[EventSub](https://dev.twitch.tv/docs/eventsub/) with an authenticated token.
The Follow alert type, its styling, and its Test button are fully wired, so
follow alerts render the moment an EventSub feed is connected. Anonymous chat
covers everything else out of the box.

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
