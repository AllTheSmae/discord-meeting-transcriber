const { EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');
const ffmpeg = require('ffmpeg-static');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEMP_DIR = path.join(__dirname, '..', 'temp');

function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Subscribe to all speakers in a voice connection and write per-user WAV files.
 * Returns a Map<userId, wavFilePath> populated as recordings finish.
 */
function startRecording(connection, guildId) {
  ensureTempDir();
  const receiver = connection.receiver;
  const recordings = new Map(); // userId -> wavFilePath

  receiver.speaking.on('start', userId => {
    if (recordings.has(userId)) return; // already recording this user

    const wavPath = path.join(TEMP_DIR, `${guildId}-${userId}-${Date.now()}.wav`);
    recordings.set(userId, wavPath);

    const opusStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 100 },
    });

    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });

    const ffProc = spawn(ffmpeg, [
      '-f', 's16le', '-ar', '48000', '-ac', '2',
      '-i', 'pipe:0',
      '-ar', '16000', '-ac', '1',
      '-f', 'wav', wavPath,
    ]);

    opusStream.pipe(decoder).pipe(ffProc.stdin);

    ffProc.on('error', err => console.error(`ffmpeg error for ${userId}:`, err));
    ffProc.stdin.on('error', () => {}); // ignore EPIPE on early close

    opusStream.on('end', () => {
      decoder.destroy();
    });

    ffProc.on('close', code => {
      if (code !== 0) console.warn(`ffmpeg exited ${code} for user ${userId}`);
    });
  });

  return recordings;
}

module.exports = { startRecording };
