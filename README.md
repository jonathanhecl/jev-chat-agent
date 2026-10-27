# jev-chat-agent

Twitch bot that classifies messages in real time using [Jev-Style-2B-Decision-v3](https://huggingface.co/chaoliangUNSW/Jev-Style-2B-Decision-v3) and logs the result. **Observer mode**: it does not delete messages or take any moderation action.

## Requirements

- Node.js 18+
- A running Jev endpoint (default `localhost`, port 11434)

## Installation

```bash
cp .env.example .env
# Edit .env with your credentials
npm install
npm start
```

## Configuration

### Getting the Twitch token

1. Go to [twitchtokengenerator.com](https://twitchtokengenerator.com/)
2. Generate a token with `chat:read` and `chat:edit` (add `channel:read:redemptions` for channel point redemption logs)
3. Copy the **access token** and paste it into `TWITCH_TOKEN` with the `oauth:` prefix

Example: `TWITCH_TOKEN=oauth:abc123def456...`

> With `MODERATION_ENABLED=false` the bot only reads and logs, so it does not need moderator permissions. To delete messages and time users out it needs moderator permissions and the bot account must be a moderator in the channel.

| Variable | Description |
|---|---|
| `TWITCH_CHANNEL` | Channel to monitor |
| `TWITCH_USERNAME` | Bot username |
| `TWITCH_TOKEN` | Bot OAuth token |
| `TWITCH_CLIENT_ID` | Client ID of the app that generated the token (required for EventSub redemptions) |
| `JEV_ENDPOINT` | Jev host with optional port (`host` or `host:port`); `http(s)://` scheme is optional. Defaults to `localhost` and port 11434 when omitted; `/v1/systemone` is appended automatically. Full `…/v1/systemone` URLs are still accepted |
| `JEV_MODEL` | Required model name (e.g. `tev1:0.8b`) |
| `MODERATION_ENABLED` | `false` = log only, `true` = delete messages and time out |
| `CHAT_MESSAGES_ENABLED` | `false` = do not send chat messages, `true` = warn in chat when something is detected |
| `OVERLAY_ENABLED` | `true` (default) serves the OBS overlay; `false` disables the HTTP server |
| `OVERLAY_HOST` | Bind address for the overlay server (default `127.0.0.1`; use `0.0.0.0` for another PC on the LAN) |
| `OVERLAY_PORT` | Overlay server port (default `3000`) |
| `OVERLAY_MAX_CHARS` | Maximum characters per danmaku line (default `140`, clipped with `…`) |
| `REDEMPTIONS_ENABLED` | `true` (default) logs channel point redemptions; `false` disables EventSub |
| `REDEMPTIONS_HIGHLIGHT_REWARD` | Optional reward name to highlight in the redemption log |
| `JEV_CONTEXT_MESSAGES` | Number of recent messages used as context (default 3) |
| `JEV_EXCLUDED_USERS` | Comma-separated list of excluded usernames (e.g. `mod1,bot2`) |
| `JEV_THRESHOLD_*` | Classification thresholds (0.0–1.0). Use `> 1` to disable a category |

## Categories

- **insult** — offensive language directed at another user
- **spam** — repetitive content or unsolicited promotion
- **toxicity** — harmful language or harassment
- **links** — disallowed links or URLs
- **attention** — questions/requests directed at the streamer

## Moderation

- `attention` is informational only. It is highlighted in yellow but **never** triggers deletion, a timeout, or a chat warning.
- When `MODERATION_ENABLED=true`, messages flagged with a negative category (insult, spam, toxicity, links) are deleted and the user is timed out. Messages flagged only as `attention` are left untouched.

## OBS overlay (danmaku)

While the bot runs it also serves a transparent page sized for a 1920x1080
browser source. Every message that is **not** flagged as insult, spam, toxicity
or links becomes a danmaku line: it enters from the right and scrolls left,
with new lines stacked on the next free row below. Lines flagged only as
`attention` get a bright blue glow border; the page background stays fully
transparent.

The widget port and bind address come from `OVERLAY_PORT` and `OVERLAY_HOST`
in `.env`.

Add a **Browser** source in OBS:

- URL: `http://127.0.0.1:3000/`
- Width `1920`, Height `1080`
- Keep "Shutdown source when not visible" unchecked

Test it without the bot or Twitch with the demo URL:

- `http://127.0.0.1:3000/?demo=1`
- Add `&debug=1` to show a connection badge in the corner

### URL parameters

| Parameter | Default | Description |
|---|---|---|
| `demo` | off | Generate sample messages locally (`?demo=1`) |
| `size` | `40` | Font size in px |
| `speed` | `220` | Scroll speed in px/s |
| `lanes` | `12` | Number of stacked rows |
| `top` | `0` | Vertical offset in px before the first row |
| `gap` | `64` | Minimum horizontal gap between lines on the same row |
| `chars` | `140` | Maximum characters per line |
| `names` | on | `names=0` hides usernames |
| `debug` | off | Show the connection badge (`debug=1`) |
| `demoMin` / `demoMax` | `400` / `1700` | Demo delay range in ms |

Messages are rendered with `textContent`, so chat content cannot inject HTML
into the widget.

## Channel point redemptions

Twitch does not send channel point redemptions over IRC, so the bot listens to
the `channel.channel_points_custom_reward_redemption.add` EventSub subscription
over a WebSocket. No public webhook URL is needed.

Every redemption is logged with the viewer, the reward, its cost and the viewer
input:

```
🎁 redemption alice → Voz de Scorpion (500 pts) · "hola"
```

Setup:

1. Generate a new token with `chat:read`, `chat:edit` and
   `channel:read:redemptions` scopes.
2. Put it in `TWITCH_TOKEN` and the app client ID in `TWITCH_CLIENT_ID`.
3. Keep `REDEMPTIONS_ENABLED=true`.
4. Optionally set `REDEMPTIONS_HIGHLIGHT_REWARD=Voz de Scorpion` to paint that
   reward in yellow in the log.

If the token lacks the scope, the bot prints
`[redemptions] off: token lacks channel:read:redemptions` and keeps running
normally. If Twitch rejects the subscription, generate the token with the
broadcaster account instead of the bot account.

## Notes

- The bot uses a concurrency-1 queue so it does not overwhelm the Jev endpoint.
- Messages longer than 500 characters are skipped.
- Automatic retries with backoff if the endpoint fails.
