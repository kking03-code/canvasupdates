require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { addAssignment, removeAssignment, loadAssignments } = require('./storage');
const { scheduleReminders } = require('./reminders');
const { isCanvasConfigured, syncCanvasAssignments, scheduleCanvasSync } = require('./canvas');

const {
  DISCORD_TOKEN,
  REMINDER_CHANNEL_ID,
  REMINDER_CRON,
  REMINDER_WINDOW_DAYS,
  CANVAS_SYNC_CRON,
} = process.env;

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env. See .env.example.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Accepts "YYYY-MM-DD HH:mm" or "YYYY-MM-DD" (defaults to 23:59) in server-local time.
function parseDueDate(input) {
  const trimmed = input.trim();
  const dateTimeMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/
  );
  if (!dateTimeMatch) return null;

  const [, year, month, day, hour, minute] = dateTimeMatch;
  const h = hour ?? '23';
  const m = minute ?? '59';
  const y = Number(year);
  const mo = Number(month) - 1;
  const d = Number(day);
  const hh = Number(h);
  const mm = Number(m);

  const date = new Date(y, mo, d, hh, mm);
  if (Number.isNaN(date.getTime())) return null;

  // Reject dates JS silently rolled over (e.g. month 13, day 99)
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo ||
    date.getDate() !== d ||
    date.getHours() !== hh ||
    date.getMinutes() !== mm
  ) {
    return null;
  }

  return date;
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  if (REMINDER_CHANNEL_ID) {
    scheduleReminders(client, {
      channelId: REMINDER_CHANNEL_ID,
      cronExpr: REMINDER_CRON || '0 8 * * *',
      windowDays: Number(REMINDER_WINDOW_DAYS) || 3,
    });
  } else {
    console.warn('REMINDER_CHANNEL_ID not set; automated reminders are disabled.');
  }

  if (isCanvasConfigured()) {
    // Sync once on startup so the bot doesn't wait for the first cron tick.
    try {
      const result = await syncCanvasAssignments();
      console.log(
        `Initial Canvas sync: ${result.synced} upcoming, ${result.added} new` +
          (result.errors.length ? `, ${result.errors.length} error(s)` : '')
      );
      if (result.errors.length) console.error(result.errors);
    } catch (err) {
      console.error('Initial Canvas sync failed:', err);
    }
    scheduleCanvasSync(CANVAS_SYNC_CRON || '*/30 * * * *');
  } else {
    console.log('Canvas not configured (CANVAS_BASE_URL/CANVAS_API_TOKEN unset); skipping sync.');
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'addassignment') {
      const course = interaction.options.getString('course', true);
      const title = interaction.options.getString('title', true);
      const dueRaw = interaction.options.getString('due', true);

      const dueDate = parseDueDate(dueRaw);
      if (!dueDate) {
        await interaction.reply({
          content:
            'Could not parse that due date. Use `YYYY-MM-DD` or `YYYY-MM-DD HH:mm` (24h), e.g. `2026-09-05 23:59`.',
          ephemeral: true,
        });
        return;
      }

      const entry = addAssignment({ course, title, dueISO: dueDate.toISOString() });
      const ts = Math.floor(dueDate.getTime() / 1000);

      const embed = new EmbedBuilder()
        .setTitle('✅ Assignment added')
        .setColor(0x57f287)
        .setDescription(
          `**${entry.course}** — ${entry.title}\nDue <t:${ts}:F> (<t:${ts}:R>)\nID: \`${entry.id}\``
        );

      await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'assignments') {
      const assignments = loadAssignments().sort(
        (a, b) => new Date(a.due) - new Date(b.due)
      );

      if (assignments.length === 0) {
        await interaction.reply('No assignments are being tracked yet. Add one with `/addassignment`.');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('📋 Tracked Assignments')
        .setColor(0x5865f2)
        .setDescription(
          assignments
            .map((a) => {
              const ts = Math.floor(new Date(a.due).getTime() / 1000);
              const tag = a.source === 'canvas' ? '🎓 Canvas' : '✍️ Manual';
              const link = a.url ? ` · [Open](${a.url})` : '';
              return `**${a.course}** — ${a.title}\nDue <t:${ts}:R> · ${tag} · ID: \`${a.id}\`${link}`;
            })
            .join('\n\n')
        );

      await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'syncnow') {
      if (!isCanvasConfigured()) {
        await interaction.reply({
          content: 'Canvas isn\'t configured (missing `CANVAS_BASE_URL` / `CANVAS_API_TOKEN` in `.env`).',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();
      const result = await syncCanvasAssignments();

      const lines = [
        `Synced **${result.synced}** upcoming assignment(s) from Canvas.`,
        `${result.added} new, ${result.updated} updated due date(s).`,
      ];
      if (result.errors.length) {
        lines.push(`⚠️ ${result.errors.length} error(s): ${result.errors.slice(0, 3).join('; ')}`);
      }

      await interaction.editReply(lines.join('\n'));
    }

    if (interaction.commandName === 'removeassignment') {
      const id = interaction.options.getString('id', true);
      const removed = removeAssignment(id);

      if (!removed) {
        await interaction.reply({
          content: `No assignment found with ID \`${id}\`. Check \`/assignments\` for valid IDs.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply(`🗑️ Removed **${removed.course}** — ${removed.title}.`);
    }
  } catch (err) {
    console.error('Error handling interaction:', err);
    const payload = { content: 'Something went wrong handling that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.login(DISCORD_TOKEN);
