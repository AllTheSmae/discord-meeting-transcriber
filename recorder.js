// src/recorder.js
// ─────────────────────────────────────────────────────────────────────────────
// MeetingRecorder
//
// Joins a Discord voice channel, listens for each speaker individually, and
// collects their raw PCM audio in memory.  When stop() is called it writes
// each speaker's audio to a temp WAV file (converted from Discord's Opus
// format via ffmpeg) ready for Whisper transcription.
//
// Audio pipeline:
//   Discord (Opus packets) → prism Opus decoder → PCM chunks in memory
//   → ffmpeg → 16-bit / 16 kHz / mono WAV  (Whisper's preferred format)
// ─────────────────────────────────────────────────────────────────────────────
const { EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const TEMP_DIR = path.join(__dirname, '..', 'temp');

// Minimum number of PCM chunks needed to count as "real" speech.
// At 48 kHz stereo the decoder emits ~960 samples (1920 bytes) per 20 ms frame.
// We require at least ~0.5 s of audio to avoid submitting silence to Whisper.
const MIN_CHUNKS = 25;

class MeetingRecorder {
  /**
   * @param {import('@discordjs/voice').VoiceConnection} connection
   * @param {import('discord.js').Guild} guild  - used to look up display names
   */
  constructor(connection, guild) {
    this.connection = connection;
    this.guild = guild;
    this.receiver = connection.receiver;

    // userId → { username: string, chunks: Buffer[] }
    this.userAudio = new Map();

    this.isRecording = false;

    // Ensure temp directory exists
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  }

  // ───────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────

  /** Begin listening for speakers in the voice channel. */
  start() {
    this.isRecording = true;

    // Subscribe to a user's audio stream each time they start speaking.
    // 'AfterSilence' means Discord closes the stream when the user is quiet
    // for `duration` ms — at which point prism fires 'end' and we can
    // re-subscribe next time they speak.
    this.receiver.speaking.on('start', (userId) => {
      if (!this.isRecording) return;
      this._subscribeToUser(userId);
    });

    console.log('🎙️ MeetingRecorder started');
  }

  /**
   * Stop listening and convert all captured audio to WAV files.
   * @returns {Promise<Array<{ userId: string, username: string, wavPath: string }>>}
   */
  async stop() {
    this.isRecording = false;

    // Brief pause to let any in-flight chunks flush through the decoder
    await new Promise((resolve) => setTimeout(resolve, 800));

    const recordings = [];

    for (const [userId, { username, chunks }] of this.userAudio) {
      if (chunks.length < MIN_CHUNKS) {
        console.log(`⏭️  Skipping ${username} — too little audio captured`);
        continue;
      }

      const wavPath = await this._convertToWav(userId, username, chunks);
      if (wavPath) {
        recordings.push({ userId, username, wavPath });
      }
    }

    return recordings;
  }

  // ───────────────────────────────────────────────
  // Private helpers
  // ───────────────────────────────────────────────

  /** Subscribe to a single user's Opus audio stream and collect PCM chunks. */
  _subscribeToUser(userId) {
    // If a live stream already exists for this user, do nothing.
    // (receiver.subscribe returns the existing stream when called twice.)
    if (this.receiver.subscriptions.has(userId)) return;

    // Resolve a friendly display name (falls back to userId if not cached)
    const member = this.guild.members.cache.get(userId);
    const username = member?.displayName ?? `User_${userId.slice(-4)}`;

    // Initialise storage bucket for this user if it's their first utterance
    if (!this.userAudio.has(userId)) {
      this.userAudio.set(userId, { username, chunks: [] });
      console.log(`👤 New speaker detected: ${username}`);
    }

    // Ask Discord to stream this user's audio to us
    const audioStream = this.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 2000, // wait 2 s of silence before closing the stream
      },
    });

    // Decode Opus → raw signed 16-bit PCM (48 kHz, 2 ch)
    const decoder = new prism.opus.Decoder({
      frameSize: 960, // 20 ms frame at 48 kHz
      channels: 2,
      rate: 48000,
    });

    audioStream.pipe(decoder).on('data', (chunk) => {
      if (this.isRecording) {
        // Store a copy of the chunk (important — don't store the view directly)
        this.userAudio.get(userId).chunks.push(Buffer.from(chunk));
      }
    });

    audioStream.on('error', (err) => {
      console.error(`Audio stream error for ${username}:`, err.message);
    });
  }

  /**
   * Concatenate a user's PCM chunks and convert to a 16 kHz mono WAV file
   * suitable for Whisper.
   *
   * @param {string}   userId
   * @param {string}   username
   * @param {Buffer[]} chunks
   * @returns {string|null} Path to the WAV file, or null on failure
   */
  async _convertToWav(userId, username, chunks) {
    const pcmPath = path.join(TEMP_DIR, `${userId}_${Date.now()}.pcm`);
    const wavPath = path.join(TEMP_DIR, `${userId}_${Date.now()}.wav`);

    try {
      // Write raw PCM
      const pcmBuffer = Buffer.concat(chunks);
      fs.writeFileSync(pcmPath, pcmBuffer);

      // Convert: s16le 48000 Hz stereo  →  s16le 16000 Hz mono WAV
      execFileSync(
        ffmpegPath,
        [
          '-f',  's16le',  // input format
          '-ar', '48000',  // input sample rate
          '-ac', '2',      // input channels (stereo)
          '-i',  pcmPath,  // input file
          '-ar', '16000',  // output sample rate (Whisper sweet spot)
          '-ac', '1',      // output channels (mono)
          '-y',            // overwrite output without asking
          wavPath,
        ],
        { stdio: 'pipe' },
      );

      console.log(`✅ Converted audio for ${username} → ${path.basename(wavPath)}`);
      return wavPath;
    } catch (err) {
      console.error(`❌ ffmpeg conversion failed for ${username}:`, err.message);
      return null;
    } finally {
      // Always clean up the raw PCM file
      if (fs.existsSync(pcmPath)) fs.unlinkSync(pcmPath);
    }
  }
}

module.exports = MeetingRecorder;
