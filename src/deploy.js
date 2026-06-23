require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('meet')
    .setDescription('Meeting transcriber commands')
    .addSubcommand(sub =>
      sub.setName('start').setDescription('Join your voice channel and start recording'))
    .addSubcommand(sub =>
      sub.setName('stop').setDescription('Stop recording and post the transcript'))
    .addSubcommand(sub =>
      sub.setName('status').setDescription('Show current meeting duration')),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('Successfully registered /meet command with subcommands: start, stop, status');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
