// src/deploy.js
// ─────────────────────────────────────────────────────
// Run this ONCE with: node src/deploy.js
// It registers the /meet slash commands with Discord.
// ─────────────────────────────────────────────────────
require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const { DISCORD_TOKEN, CLIENT_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('❌ Missing DISCORD_TOKEN or CLIENT_ID in your .env file.');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('meet')
    .setDescription('Meeting transcription commands')
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Start recording the meeting in your current voice channel')
    )
    .addSubcommand((sub) =>
      sub
        .setName('stop')
        .setDescription('Stop recording and post the transcript to this channel')
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Check whether a meeting is currently being recorded')
    ),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log('⏳ Registering slash commands with Discord...');

    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });

    console.log('✅ Slash commands registered successfully!');
    console.log('   You can now run: node src/bot.js');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
    process.exit(1);
  }
})();
