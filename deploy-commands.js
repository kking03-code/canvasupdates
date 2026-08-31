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
    .setName('setzoomlink')
    .setDescription('Save or update the Zoom link for a course')
    .addStringOption((opt) =>
      opt.setName('course').setDescription('Course name/code, e.g. CS101').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('link').setDescription('The Zoom meeting URL').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('zoomlink')
    .setDescription('Get the Zoom link for a course (omit course to see all)')
    .addStringOption((opt) =>
      opt.setName('course').setDescription('Course name/code, e.g. CS101').setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('removezoomlink')
    .setDescription('Remove a saved Zoom link for a course')
    .addStringOption((opt) =>
      opt.setName('course').setDescription('Course name/code, e.g. CS101').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('setsyllabus')
    .setDescription('Save or update syllabus/FAQ info for a course (fill in one or more fields at a time)')
    .addStringOption((opt) =>
      opt.setName('course').setDescription('Course name/code, e.g. CS101').setRequired(true)
    )
    .addStringOption((opt) => opt.setName('professor').setDescription('Professor\'s name'))
    .addStringOption((opt) => opt.setName('email').setDescription('Professor\'s or TA\'s contact email'))
    .addStringOption((opt) => opt.setName('office_hours').setDescription('Office hours, e.g. "Tue/Thu 2-3pm, Rm 204"'))
    .addStringOption((opt) => opt.setName('grading').setDescription('Grading breakdown, e.g. "HW 30%, Midterm 30%, Final 40%"'))
    .addStringOption((opt) => opt.setName('late_policy').setDescription('Late submission policy'))
    .addStringOption((opt) => opt.setName('textbook').setDescription('Required textbook(s)'))
    .addStringOption((opt) => opt.setName('syllabus_url').setDescription('Link to the full syllabus PDF/doc')),
  new SlashCommandBuilder()
    .setName('syllabus')
    .setDescription('Get syllabus/FAQ info for a course (omit course to list all)')
    .addStringOption((opt) =>
      opt.setName('course').setDescription('Course name/code, e.g. CS101').setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('removesyllabus')
    .setDescription('Remove saved syllabus info for a course')
    .addStringOption((opt) =>
      opt.setName('course').setDescription('Course name/code, e.g. CS101').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('meetingpoll')
    .setDescription('Create a poll to find a meeting time that works for everyone')
    .addStringOption((opt) =>
      opt.setName('title').setDescription('Poll question, e.g. "When should we meet this week?"').setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('options')
        .setDescription('Comma-separated time options (2-10), e.g. "Mon 5pm, Tue 6pm, Wed 4pm"')
        .setRequired(true)
    )
    .addBooleanOption((opt) =>
      opt
        .setName('multiselect')
        .setDescription('Allow people to pick more than one time they\'re free? (default: yes)')
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('duration_hours')
        .setDescription('How long the poll stays open, in hours (default: 24, max: 768)')
        .setMinValue(1)
        .setMaxValue(768)
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('checkannouncements')
    .setDescription('Manually check Canvas for new announcements and post them'),
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
