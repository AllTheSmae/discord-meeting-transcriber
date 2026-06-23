require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder } = require('discord.js');
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
} = require('@discordjs/voice');
const Recorder = require('./recorder');
const Transcriber = require('./transcriber');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// Map of guildId -> { connection, recorder, startTime }
const sessions = new Map();

client.on('error', (err) => {
  console.error('[client error]', err);
});

client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'meet') return;

  // Guard: bail out if this interaction is already handled (stale duplicate events)
  if (interaction.replied || interaction.deferred) return;

  const sub = interaction.options.getSubcommand();

  // deferReply MUST be the very first await — Discord gives 3 seconds
  try {
    await interaction.deferReply();
  } catch (err) {
    // 10062 = interaction token already expired (duplicate/stale event from prior crashed session)
    console.warn('[meet] deferReply failed (stale interaction):', err.code ?? err.message);
    return;
  }

  const tokenAge = Date.now() - interaction.createdTimestamp;
  console.log(`[meet] interaction received, token age: ${tokenAge}ms, id: ${interaction.id}`);

  try {
    if (sub === 'start') {
      // --- already in a session? ---
      if (sessions.has(interaction.guildId)) {
        return interaction.editReply('⚠️ A meeting is already in progress. Use `/meet stop` to end it first.');
      }

      // --- must be in a voice channel ---
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const voiceChannel = member.voice?.channel;
      if (!voiceChannel) {
        return interaction.editReply('❌ You need to join a voice channel first, then run `/meet start`.');
      }

      // --- join voice ---
      let connection;
      try {
        connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guildId,
          adapterCreator: interaction.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: true,
          daveEncryption: false, // disable Discord E2E so Opus packets arrive plain
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      } catch (err) {
        console.error('Voice join error:', err);
        connection?.destroy();
        return interaction.editReply(`❌ Failed to join the voice channel: ${err.message}`);
      }

      // --- start recording ---
      const recorder = new Recorder(connection, voiceChannel);
      recorder.start();

      sessions.set(interaction.guildId, {
        connection,
        recorder,
        startTime: Date.now(),
        textChannel: interaction.channel,
      });

      return interaction.editReply(`🎙️ Recording started in **${voiceChannel.name}**. Use \`/meet stop\` when the meeting is over.`);
    }

    if (sub === 'stop') {
      const session = sessions.get(interaction.guildId);
      if (!session) {
        return interaction.editReply('❌ No meeting is currently in progress.');
      }

      await interaction.editReply('⏳ Stopping recording and transcribing — this may take a minute...');

      const { connection, recorder, startTime } = session;
      sessions.delete(interaction.guildId);

      const audioFiles = await recorder.stop();
      connection.destroy();

      const durationMs = Date.now() - startTime;
      const minutes = Math.floor(durationMs / 60_000);
      const seconds = Math.floor((durationMs % 60_000) / 1000);

      if (!audioFiles || audioFiles.length === 0) {
        return interaction.editReply('⚠️ No audio was recorded. Make sure people were speaking in the voice channel.');
      }

      const transcriber = new Transcriber();
      const notes = await transcriber.transcribe(audioFiles);

      // Split long transcripts across multiple messages (Discord 2000 char limit)
      const chunks = [];
      let current = '';
      for (const line of notes.split('\n')) {
        if ((current + '\n' + line).length > 1900) {
          chunks.push(current);
          current = line;
        } else {
          current += (current ? '\n' : '') + line;
        }
      }
      if (current) chunks.push(current);

      await interaction.editReply(`✅ Meeting ended — duration: **${minutes}m ${seconds}s**\n\n${chunks[0]}`);
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
      }
    }

    if (sub === 'status') {
      const session = sessions.get(interaction.guildId);
      if (!session) {
        return interaction.editReply('ℹ️ No meeting is currently in progress.');
      }
      const elapsed = Date.now() - session.startTime;
      const minutes = Math.floor(elapsed / 60_000);
      const seconds = Math.floor((elapsed % 60_000) / 1000);
      return interaction.editReply(`🎙️ Meeting in progress — running for **${minutes}m ${seconds}s**.`);
    }
  } catch (err) {
    console.error(`Error handling /meet ${sub}:`, err);
    try {
      await interaction.editReply(`❌ Something went wrong: ${err.message}`);
    } catch (_) {}
  }
});

client.login(process.env.DISCORD_TOKEN);
