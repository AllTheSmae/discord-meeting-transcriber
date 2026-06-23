require('dotenv').config();
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));
process.on('uncaughtException', err => console.error('[uncaughtException]', err));
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const { startRecording } = require('./recorder');
const { formatMeetingNotes } = require('./transcriber');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// guildId -> { connection, recordings, displayNames, startTime, textChannel }
const sessions = new Map();

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('error', err => console.error('[client error]', err));

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'meet') return;

  // Log token age so we can detect stale replayed interactions
  const tokenAge = Date.now() - interaction.createdTimestamp;
  console.log(`[meet] interaction received, token age: ${tokenAge}ms, id: ${interaction.id}`);

  if (interaction.replied || interaction.deferred) {
    console.warn('[meet] interaction already replied/deferred — skipping');
    return;
  }

  // deferReply is the absolute first await — nothing else runs before this
  try {
    await interaction.deferReply();
  } catch (err) {
    console.error('[meet] deferReply failed (interaction may be stale):', err.message);
    return; // token is gone — nothing more we can do
  }

  try {
    const sub = interaction.options.getSubcommand();

    // ── /meet start ────────────────────────────────────────────────────────
    if (sub === 'start') {
      if (sessions.has(interaction.guildId)) {
        return interaction.editReply('A meeting is already in progress.');
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const voiceChannel = member.voice.channel;

      if (!voiceChannel) {
        return interaction.editReply('You must be in a voice channel to start a meeting.');
      }

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: false,
        daveEncryption: false, // DAVE E2E encryption breaks prism-media opus decoding
      });

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      } catch (err) {
        console.error('Voice join error:', err);
        connection.destroy();
        return interaction.editReply('Failed to join the voice channel.');
      }

      const recordings = startRecording(connection, interaction.guildId);
      const displayNames = new Map();
      for (const [id, vcMember] of voiceChannel.members) {
        displayNames.set(id, vcMember.displayName);
      }

      sessions.set(interaction.guildId, {
        connection,
        recordings,
        displayNames,
        startTime: new Date(),
        textChannel: interaction.channel,
      });

      return interaction.editReply(`Recording started in **${voiceChannel.name}**. Use \`/meet stop\` to finish.`);
    }

    // ── /meet stop ─────────────────────────────────────────────────────────
    if (sub === 'stop') {
      const session = sessions.get(interaction.guildId);
      if (!session) {
        return interaction.editReply('No meeting is currently in progress.');
      }

      sessions.delete(interaction.guildId);
      session.connection.destroy();

      await new Promise(r => setTimeout(r, 2000));

      const notes = await formatMeetingNotes(session.recordings, session.displayNames, session.startTime);
      const chunks = [];
      for (let i = 0; i < notes.length; i += 1900) chunks.push(notes.slice(i, i + 1900));

      await interaction.editReply(chunks[0]);
      for (const chunk of chunks.slice(1)) await interaction.followUp(chunk);
      return;
    }

    // ── /meet status ───────────────────────────────────────────────────────
    if (sub === 'status') {
      const session = sessions.get(interaction.guildId);
      if (!session) {
        return interaction.editReply('No meeting is currently in progress.');
      }

      const elapsed = Math.floor((Date.now() - session.startTime.getTime()) / 1000);
      const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
      const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
      const s = (elapsed % 60).toString().padStart(2, '0');

      return interaction.editReply(`Meeting duration: **${h}:${m}:${s}** — ${session.recordings.size} speaker(s) recorded so far.`);
    }
  } catch (err) {
    console.error('[meet] error:', err);
    interaction.editReply(`An error occurred: ${err.message}`).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
