# jev-chat-agent

Twitch bot that classifies messages in real time using [Jev-Style-2B-Decision-v3](https://huggingface.co/chaoliangUNSW/Jev-Style-2B-Decision-v3) and logs the result. **Observer mode**: it does not delete messages or take any moderation action.

## Requirements

- Node.js 18+
- A running Jev endpoint (e.g. `http://localhost:8765/v1/systemone`)

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
2. Generate a token (you need chat read permissions)
3. Copy the **access token** and paste it into `TWITCH_TOKEN` with the `oauth:` prefix

Example: `TWITCH_TOKEN=oauth:abc123def456...`

> With `MODERATION_ENABLED=false` the bot only reads and logs, so it does not need moderator permissions. To delete messages and time users out it needs moderator permissions and the bot account must be a moderator in the channel.

| Variable | Description |
|---|---|
| `TWITCH_CHANNEL` | Channel to monitor |
| `TWITCH_USERNAME` | Bot username |
| `TWITCH_TOKEN` | Bot OAuth token |
| `JEV_ENDPOINT` | URL of the Jev endpoint |
| `MODERATION_ENABLED` | `false` = log only, `true` = delete messages and time out |
| `CHAT_MESSAGES_ENABLED` | `false` = do not send chat messages, `true` = warn in chat when something is detected |
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

## Notes

- The bot uses a concurrency-1 queue so it does not overwhelm the Jev endpoint.
- Messages longer than 500 characters are skipped.
- Automatic retries with backoff if the endpoint fails.
