require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType,
} = require('discord.js');

const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');

const MeetingRecorder = require('./recorder');
const { transcribeMeeting, splitIntoChunks } = require('./transcriber');

const { DISCORD_TOKEN, OPENAI_API_KEY } = process.env;

if (!DISCORD_TOKEN) { console.error('❌ DISCORD_TOKEN missing'); process.exit(1); }
if (!OPENAI_API_KEY) { console.error('❌ OPENAI_API_KEY missing'); process.exit(1); }

const activeMeetings = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity('for /meet start', { type: ActivityType.Watching });
});

client.on('error', (err) => console.error('Discord client error:', err));

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'meet') return;

  // Guard against duplicate/stale interactions
  if (interaction.replied || interaction.deferred) return;

  const tokenAge = Date.now() - interaction.createdTimestamp;
  console.log(`[meet] received, token age: ${tokenAge}ms`);

  // Defer immediately — must be first async call
  try {
    await interaction.deferReply();
  } catch (err) {
    console.error('deferReply failed (stale interaction?):', err.message);
    return;
  }

  const sub = interaction.options.getSubcommand();

  try {
    if (sub === 'start')  await handleStart(interaction);
    if (sub === 'stop')   await handleStop(interaction);
    if (sub === 'status') await handleStatus(interaction);
  } catch (err) {
    console.error(`Error in /meet ${sub}:`, err);
    await interaction.editReply('❌ Something went wrong. Check the bot logs.').catch(() => {});
  }
});

async function handleStart(interaction) {
  const voiceChannel = interaction.member.voice?.channel;

  if (!voiceChannel) {
    return interaction.editReply('❌ You need to **join a voice channel** first, then run `/meet start`.');
  }

  if (activeMeetings.has(interaction.guildId)) {
    const meeting = activeMeetings.get(interaction.guildId);
    const elapsed = formatElapsed(meeting.startTime);
    return interaction.editReply(`❌ Already recording in **${meeting.voiceChannelName}** (${elapsed} ago). Use \`/meet stop\` first.`);
  }

  console.log(`Joining voice channel: ${voiceChannel.name} (${voiceChannel.id})`);

  let connection;
  try {
    connection = joinVoiceChannel({
      channelId:       voiceChannel.id,
      guildId:         interaction.guildId,
      adapterCreator:  interaction.guild.voiceAdapterCreator,
      selfDeaf:        false,
      selfMute:        true,
      daveEncryption:  false, // disable Discord's E2E encryption so audio is decodable
    });

    connection.on('stateChange', (oldState, newState) => {
      console.log(`Voice connection: ${oldState.status} → ${newState.status}`);
    });

    connection.on('error', (err) => {
      console.error('Voice connection error:', err);
    });

    console.log('Waiting for voice connection to be ready...');
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    console.log('Voice connection ready!');
  } catch (err) {
    console.error('Failed to join voice channel:', err);
    if (connection) connection.destroy();
    return interaction.editReply(`❌ Could not connect to the voice channel.\n\nError: ${err.message}\n\nMake sure the bot has **Connect** and **Speak** permissions.`);
  }

  const recorder = new MeetingRecorder(connection, interaction.guild);
  recorder.start();

  activeMeetings.set(interaction.guildId, {
    recorder,
    textChannelId:    interaction.channelId,
    voiceChannelName: voiceChannel.name,
    startTime:        new Date(),
  });

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🎙️ Recording Started')
    .setDescription(`Joined **${voiceChannel.name}** and recording your meeting.`)
    .addFields(
      { name: 'How to stop', value: 'Run `/meet stop` when you\'re done.' },
      { name: 'Tip', value: 'Make sure everyone is unmuted!' },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleStop(interaction) {
  const meeting = activeMeetings.get(interaction.guildId);

  if (!meeting) {
    return interaction.editReply('❌ No meeting is currently being recorded.');
  }

  const { recorder, textChannelId, startTime } = meeting;
  activeMeetings.delete(interaction.guildId);

  await interaction.editReply('⏳ Stopping and processing audio...');

  let recordings = [];
  try {
    recordings = await recorder.stop();
  } catch (err) {
    console.error('recorder.stop() failed:', err);
  }

  const connection = getVoiceConnection(interaction.guildId);
  if (connection) connection.destroy();

  if (!recordings.length) {
    return interaction.editReply('❌ No audio captured. Make sure participants were unmuted and speaking!');
  }

  await interaction.editReply(`⏳ Transcribing ${recordings.length} speaker(s) with Whisper...`);

  let transcript;
  try {
    transcript = await transcribeMeeting(recordings, startTime);
  } catch (err) {
    console.error('transcribeMeeting() failed:', err);
    return interaction.editReply('❌ Transcription failed. Check your OPENAI_API_KEY.');
  }

  const targetChannel = interaction.guild.channels.cache.get(textChannelId) ?? interaction.channel;
  for (const chunk of splitIntoChunks(transcript)) {
    await targetChannel.send(chunk);
  }

  await interaction.editReply('✅ Transcript posted!');
}

async function handleStatus(interaction) {
  const meeting = activeMeetings.get(interaction.guildId);

  if (!meeting) {
    return interaction.editReply('🔇 No meeting is currently being recorded.');
  }

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('🎙️ Meeting in Progress')
    .addFields(
      { name: 'Voice Channel', value: meeting.voiceChannelName, inline: true },
      { name: 'Duration',      value: formatElapsed(meeting.startTime), inline: true },
    )
    .setFooter({ text: 'Use /meet stop to end the recording.' })
    .setTimestamp(meeting.startTime);

  return interaction.editReply({ embeds: [embed] });
}

function formatElapsed(since) {
  const secs = Math.floor((Date.now() - since.getTime()) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

client.on('voiceStateUpdate', (oldState, newState) => {
  if (newState.member?.id !== client.user.id) return;
  if (oldState.channelId && !newState.channelId) {
    console.log('⚠️ Bot disconnected from voice');
    activeMeetings.delete(newState.guild.id);
  }
});

client.login(DISCORD_TOKEN);
