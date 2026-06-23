require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('meet')
    .setDescription('Meeting transcription controls')
    .addSubcommand((sub) =>
      sub.setName('start').setDescription('Join your voice channel and start recording')
    )
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('Stop recording and post the transcript')
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Show how long the current meeting has been running')
    ),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  console.log('Registering slash commands...');
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
  console.log(`Successfully registered /meet command with subcommands: start, stop, status`);
})().catch(console.error);
