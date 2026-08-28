require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('addassignment')
    .setDescription('Add a new assignment to track')
    .addStringOption((opt) =>
      opt.setName('course').setDescription('Course name/code, e.g. CS101').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('title').setDescription('Assignment title, e.g. "Homework 3"').setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('due')
        .setDescription('Due date/time, e.g. "2026-09-05 23:59" (24h, server-local time)')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('assignments')
    .setDescription('List all tracked assignments, soonest first'),
  new SlashCommandBuilder()
    .setName('syncnow')
    .setDescription('Manually trigger a sync of upcoming assignments from Canvas'),
  new SlashCommandBuilder()
    .setName('removeassignment')
    .setDescription('Remove a tracked assignment by its ID')
    .addStringOption((opt) =>
      opt.setName('id').setDescription('The assignment ID (see /assignments)').setRequired(true)
    ),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    if (!process.env.CLIENT_ID || !process.env.GUILD_ID) {
      throw new Error('CLIENT_ID and GUILD_ID must be set in .env');
    }
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('Slash commands registered for guild', process.env.GUILD_ID);
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exit(1);
  }
})();
