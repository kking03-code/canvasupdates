const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const { loadAssignments, markNotified } = require('./storage');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysUntil(dueISO) {
  const due = new Date(dueISO).getTime();
  const now = Date.now();
  return (due - now) / MS_PER_DAY;
}

function buildDailyEmbed(dueSoon) {
  const embed = new EmbedBuilder()
    .setTitle('📚 Upcoming Assignments')
    .setColor(0x5865f2)
    .setTimestamp();

  const lines = dueSoon
    .sort((a, b) => new Date(a.due) - new Date(b.due))
    .map((a) => {
      const due = new Date(a.due);
      const discordTs = `<t:${Math.floor(due.getTime() / 1000)}:R>`;
      const link = a.url ? ` · [Open in Canvas](${a.url})` : '';
      return `**${a.course}** — ${a.title}\nDue ${discordTs} (${due.toLocaleString()})${link}`;
    });

  embed.setDescription(lines.join('\n\n') || 'Nothing due soon.');
  return embed;
}

// Checks all assignments and posts a reminder if any are within the window
// and haven't already been pinged today.
async function runReminderCheck(client, channelId, windowDays) {
  const assignments = loadAssignments();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const tag = `daily:${today}`;

  const dueSoon = assignments.filter((a) => {
    const d = daysUntil(a.due);
    return d >= 0 && d <= windowDays && !a.notified.includes(tag);
  });

  if (dueSoon.length === 0) return;

  const channel = await client.channels.fetch(channelId).catch((err) => {
    console.error('Could not fetch reminder channel:', err);
    return null;
  });
  if (!channel) return;

  const embed = buildDailyEmbed(dueSoon);
  await channel.send({ embeds: [embed] });

  for (const a of dueSoon) markNotified(a.id, tag);
}

function scheduleReminders(client, { channelId, cronExpr, windowDays }) {
  if (!cronExpr) {
    console.warn('No REMINDER_CRON set; skipping scheduled reminders.');
    return;
  }
  cron.schedule(cronExpr, () => {
    runReminderCheck(client, channelId, windowDays).catch((err) =>
      console.error('Reminder check failed:', err)
    );
  });
  console.log(`Scheduled reminder check with cron "${cronExpr}".`);
}

module.exports = { scheduleReminders, runReminderCheck, buildDailyEmbed, daysUntil };
