const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Transcribe a single WAV file with Whisper and return { speaker, text, timestamp }.
 * userId is used as the speaker label until a display name is provided.
 */
async function transcribeFile(wavPath, speakerLabel) {
  const response = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: fs.createReadStream(wavPath),
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  });
  return { speaker: speakerLabel, text: response.text.trim(), segments: response.segments || [] };
}

/**
 * Transcribe all recordings and format the result as meeting notes.
 * @param {Map<string, string>} recordings  userId -> wavFilePath
 * @param {Map<string, string>} displayNames userId -> display name
 * @param {Date} startTime  when the meeting started
 */
async function formatMeetingNotes(recordings, displayNames, startTime) {
  const results = [];

  for (const [userId, wavPath] of recordings.entries()) {
    if (!fs.existsSync(wavPath)) continue;
    const label = displayNames.get(userId) || `User(${userId.slice(-4)})`;
    try {
      const result = await transcribeFile(wavPath, label);
      // Attach wall-clock offset for each segment
      for (const seg of result.segments) {
        const offsetMs = seg.start * 1000;
        const wallTime = new Date(startTime.getTime() + offsetMs);
        results.push({
          time: wallTime,
          speaker: result.speaker,
          text: seg.text.trim(),
        });
      }
      // Fallback if no segments
      if (result.segments.length === 0 && result.text) {
        results.push({ time: startTime, speaker: result.speaker, text: result.text });
      }
    } catch (err) {
      console.error(`Transcription failed for ${userId}:`, err.message);
    }
  }

  results.sort((a, b) => a.time - b.time);

  if (results.length === 0) return '*(No speech detected)*';

  const lines = results.map(r => {
    const ts = r.time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `**[${ts}] ${r.speaker}:** ${r.text}`;
  });

  return `## Meeting Transcript\n\n${lines.join('\n')}`;
}

module.exports = { formatMeetingNotes };
