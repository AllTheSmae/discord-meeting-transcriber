# Discord Meeting Transcriber Bot 🎙️

Joins your Discord voice channel, records each speaker separately, transcribes
with **OpenAI Whisper**, and posts formatted meeting notes to your text channel.

---

## What you'll need

| Requirement | Where to get it |
|---|---|
| Node.js 18 or later | https://nodejs.org |
| A Discord bot token | https://discord.com/developers |
| An OpenAI API key | https://platform.openai.com/api-keys |

---

## Setup (step by step)

### 1 — Create a Discord Application & Bot

1. Go to https://discord.com/developers/applications and click **New Application**.
2. Give it a name (e.g. "Meeting Transcriber"), then click **Create**.
3. In the left sidebar click **Bot**, then click **Add Bot → Yes, do it!**
4. Under **Token**, click **Reset Token**, copy it — you'll need it for `.env`.
5. Under **Privileged Gateway Intents**, enable:
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent** *(only needed if you add prefix commands later)*
6. Click **Save Changes**.

### 2 — Invite the bot to your server

1. In the sidebar click **OAuth2 → URL Generator**.
2. Under **Scopes** check: `bot` and `applications.commands`.
3. Under **Bot Permissions** check:
   - ✅ Connect
   - ✅ Speak
   - ✅ Send Messages
   - ✅ Read Message History
4. Copy the generated URL, open it in your browser, and add the bot to your server.

### 3 — Download and configure

```bash
# Unzip / copy the project files, then:
cd discord-meeting-transcriber
npm install

# Copy the example env file
cp .env.example .env
```

Open `.env` and fill in:
```
DISCORD_TOKEN=<your bot token from step 1>
CLIENT_ID=<your Application ID — found on the General Information page>
OPENAI_API_KEY=<your OpenAI key>
```

### 4 — Register the slash commands (one-time)

```bash
node src/deploy.js
```

You should see: `✅ Slash commands registered successfully!`

> Slash commands can take up to an hour to appear on Discord's end, but usually
> they show up within a few seconds.

### 5 — Start the bot

```bash
node src/bot.js
```

You should see: `✅ Logged in as <YourBot>#0000`

---

## Usage

| Command | What it does |
|---|---|
| `/meet start` | Bot joins your current voice channel and starts recording |
| `/meet stop` | Stops recording, transcribes with Whisper, posts notes in this channel |
| `/meet status` | Shows how long the current meeting has been running |

**Tip:** Run `/meet stop` in the same channel where you want the transcript to appear.

---

## How it works

```
Voice Channel (Discord)
    ↓  Opus audio packets (per user)
MeetingRecorder (recorder.js)
    ↓  prism-media decodes Opus → raw PCM
    ↓  ffmpeg converts PCM → 16 kHz mono WAV
OpenAI Whisper API (transcriber.js)
    ↓  text transcript per speaker
Discord text channel
    ↓  formatted meeting notes
```

---

## Troubleshooting

**"No audio was captured"**
Make sure participants are **unmuted** in Discord. The bot can only hear users
who are not server-muted or self-muted.

**"Could not connect to the voice channel"**
Check the bot has the **Connect** permission in that voice channel.

**Opus decoder error on install**
`@discordjs/opus` requires native build tools (a C++ compiler + Python).
- **Windows:** install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022) and run `npm install` again.
- **macOS:** run `xcode-select --install` first.
- **Linux (Ubuntu/Debian):** run `sudo apt-get install build-essential python3` first.
- As a fallback, `opusscript` is included as an optional dep and will be used automatically if `@discordjs/opus` fails to build.

**Whisper transcription is slow**
The free tier of the OpenAI API is rate-limited. Longer meetings simply take
longer to process. For a 1-hour meeting, expect 1–3 minutes of processing time.

---

## Upgrading the transcript

Want smarter meeting notes (action items, summaries)?  
After `transcribeMeeting()` in `transcriber.js`, add a call to the Anthropic API:

```js
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const notes = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages: [{
    role: 'user',
    content: `Here is a raw meeting transcript. Please write structured meeting notes with:
1. A brief summary (2-3 sentences)
2. Key decisions made
3. Action items with owners

Transcript:
${rawTranscript}`
  }]
});
```

Add `ANTHROPIC_API_KEY` to your `.env` and install `@anthropic-ai/sdk` to use this.

---

## Project structure

```
discord-meeting-transcriber/
├── src/
│   ├── bot.js          # Discord client, slash command handlers
│   ├── recorder.js     # Voice recording and audio conversion
│   ├── transcriber.js  # Whisper API calls and formatting
│   └── deploy.js       # One-time slash command registration
├── temp/               # Temporary audio files (auto-cleaned)
├── .env.example        # Template for your environment variables
├── .env                # Your actual secrets (never commit this!)
└── package.json
```
