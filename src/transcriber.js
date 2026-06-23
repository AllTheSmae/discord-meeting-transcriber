const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const TEMP_DIR = path.join(process.cwd(), 'temp');

class Transcriber {
  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async transcribe(audioFiles) {
    const segments = [];

    for (const { wavPath, displayName } of audioFiles) {
      try {
        console.log(`[transcriber] sending ${displayName} audio to Whisper...`);

        const response = await this.openai.audio.transcriptions.create({
          file: fs.createReadStream(wavPath),
          model: 'whisper-1',
          language: process.env.WHISPER_LANGUAGE ?? 'en',
          response_format: 'verbose_json',
          timestamp_granularities: ['segment'],
        });

        const text = response.text?.trim();
        if (text) {
          segments.push({ displayName, text });
        }

        // Clean up WAV after transcription
        fs.unlinkSync(wavPath);
      } catch (err) {
        console.error(`[transcriber] error for ${displayName}:`, err.message);
      }
    }

    return this._format(segments);
  }

  _format(segments) {
    if (segments.length === 0) {
      return '📝 No speech was detected in the recording.';
    }

    const date = new Date().toLocaleString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const speakerNames = [...new Set(segments.map((s) => s.displayName))];

    let out = `📝 **Meeting Transcript**\n`;
    out += `📅 ${date}\n`;
    out += `👥 Participants (${speakerNames.length}): ${speakerNames.join(', ')}\n`;
    out += `${'━'.repeat(35)}\n\n`;

    for (const { displayName, text } of segments) {
      out += `🗣️ **${displayName}**\n${text}\n\n`;
    }

    return out.trim();
  }
}

module.exports = Transcriber;
