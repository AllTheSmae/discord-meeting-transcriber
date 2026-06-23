// src/transcriber.js
// ─────────────────────────────────────────────────────────────────────────────
// Sends each speaker's WAV file to OpenAI Whisper and combines the results
// into nicely formatted meeting notes ready to post in Discord.
// ─────────────────────────────────────────────────────────────────────────────
const OpenAI = require('openai');
const fs = require('fs');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || 'en';

/**
 * Transcribe all recordings and return a formatted transcript string.
 *
 * @param {Array<{ userId: string, username: string, wavPath: string }>} recordings
 * @param {Date} startTime - when the meeting started
 * @returns {Promise<string>} formatted meeting notes (Markdown)
 */
async function transcribeMeeting(recordings, startTime) {
  const results = [];

  for (const { username, wavPath } of recordings) {
    console.log(`⏳ Transcribing ${username}...`);

    try {
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(wavPath),
        model: 'whisper-1',
        language: WHISPER_LANGUAGE,
        response_format: 'text', // plain text is sufficient; use 'verbose_json' for timestamps
      });

      const text = (transcription || '').trim();

      if (text) {
        results.push({ username, text });
        console.log(`✅ Transcribed ${username}: ${text.slice(0, 60)}...`);
      } else {
        console.log(`⏭️  Empty transcript for ${username} — skipping`);
      }
    } catch (err) {
      console.error(`❌ Whisper error for ${username}:`, err.message);
    } finally {
      // Always remove the WAV file after transcription
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    }
  }

  if (results.length === 0) {
    return '❌ No speech was detected in the meeting. Make sure participants were unmuted!';
  }

  return formatTranscript(results, startTime);
}

/**
 * Turn raw per-speaker transcripts into readable meeting notes.
 *
 * @param {Array<{ username: string, text: string }>} results
 * @param {Date} startTime
 * @returns {string}
 */
function formatTranscript(results, startTime) {
  const dateStr = startTime.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = startTime.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const participants = results.map((r) => r.username).join(', ');

  let output = '';
  output += `## 📝 Meeting Transcript\n`;
  output += `**Date:** ${dateStr} at ${timeStr}\n`;
  output += `**Participants (${results.length}):** ${participants}\n`;
  output += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const { username, text } of results) {
    output += `**🗣️ ${username}**\n`;
    output += `${text}\n\n`;
  }

  output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  output += `*Transcribed with OpenAI Whisper · ${new Date().toLocaleTimeString('en-GB')}*`;

  return output;
}

/**
 * Split a long string into chunks that fit within Discord's message limit.
 * Tries to break on newlines where possible.
 *
 * @param {string} text
 * @param {number} [limit=1900]  Leave headroom below Discord's 2000-char cap
 * @returns {string[]}
 */
function splitIntoChunks(text, limit = 1900) {
  if (text.length <= limit) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    // Try to find a newline to break on
    let breakAt = remaining.lastIndexOf('\n', limit);
    if (breakAt <= 0) breakAt = limit; // No newline found; hard-cut

    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }

  return chunks;
}

module.exports = { transcribeMeeting, splitIntoChunks };
