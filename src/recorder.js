const { EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');
const { pipeline } = require('stream');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const TEMP_DIR = path.join(process.cwd(), 'temp');

class Recorder {
  constructor(connection, voiceChannel) {
    this.connection = connection;
    this.voiceChannel = voiceChannel;
    this.streams = new Map(); // userId -> { pcmPath, displayName }
    this.memberNames = new Map();
  }

  start() {
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

    // Cache member display names
    this.voiceChannel.members.forEach((member) => {
      this.memberNames.set(member.id, member.displayName);
    });

    const receiver = this.connection.receiver;

    receiver.speaking.on('start', (userId) => {
      if (this.streams.has(userId)) return; // already recording this user

      const displayName = this.memberNames.get(userId) ?? `User-${userId.slice(-4)}`;
      const pcmPath = path.join(TEMP_DIR, `${userId}-${Date.now()}.pcm`);

      console.log(`[recorder] started capturing ${displayName}`);

      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
      });

      const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
      const out = fs.createWriteStream(pcmPath);

      pipeline(opusStream, decoder, out, (err) => {
        if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
          console.error(`[recorder] pipeline error for ${displayName}:`, err.message);
        }
        this.streams.set(userId, { ...this.streams.get(userId), done: true });
      });

      this.streams.set(userId, { pcmPath, displayName, done: false });
    });
  }

  stop() {
    return new Promise((resolve) => {
      // Give any active pipelines 2 seconds to flush
      setTimeout(async () => {
        const wavFiles = [];

        for (const [userId, info] of this.streams) {
          const { pcmPath, displayName } = info;

          if (!fs.existsSync(pcmPath) || fs.statSync(pcmPath).size === 0) continue;

          const wavPath = pcmPath.replace('.pcm', '.wav');
          try {
            // Convert 48kHz stereo PCM → 16kHz mono WAV (Whisper-friendly)
            execSync(
              `"${ffmpegPath}" -y -f s16le -ar 48000 -ac 2 -i "${pcmPath}" -ar 16000 -ac 1 "${wavPath}"`,
              { stdio: 'pipe' }
            );
            wavFiles.push({ wavPath, displayName });
            fs.unlinkSync(pcmPath);
          } catch (err) {
            console.error(`[recorder] ffmpeg error for ${displayName}:`, err.message);
          }
        }

        resolve(wavFiles);
      }, 2000);
    });
  }
}

module.exports = Recorder;
