require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { addAssignment, removeAssignment, loadAssignments } = require('./storage');
const { scheduleReminders } = require('./reminders');
const { isCanvasConfigured, syncCanvasAssignments, scheduleCanvasSync } = require('./canvas');
const { setZoomLink, getZoomLink, removeZoomLink, listZoomLinks } = require('./zoomlinks');
const { syncAnnouncements, scheduleAnnouncementSync } = require('./announcements');
const { setSyllabusInfo, getSyllabusInfo, removeSyllabusInfo, listCourses } = require('./syllabus');
const { addDoc, listDocs, removeDoc, listDocsForRoles } = require('./groupdocs');

const {
  DISCORD_TOKEN,
  REMINDER_CHANNEL_ID,
  REMINDER_CRON,
  REMINDER_WINDOW_DAYS,
  CANVAS_SYNC_CRON,
  ANNOUNCEMENTS_CHANNEL_ID,
  ANNOUNCEMENT_SYNC_CRON,
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

    const announcementsChannel = ANNOUNCEMENTS_CHANNEL_ID || REMINDER_CHANNEL_ID;
    if (announcementsChannel) {
      try {
        const result = await syncAnnouncements(client, announcementsChannel);
        if (result.firstRun) {
          console.log(
            `Announcement sync: first run, baselined ${result.baseline} existing announcement(s) (nothing posted).`
          );
        } else {
          console.log(`Initial announcement sync: ${result.posted} posted`);
        }
        if (result.errors.length) console.error(result.errors);
      } catch (err) {
        console.error('Initial announcement sync failed:', err);
      }
      scheduleAnnouncementSync(client, {
        channelId: announcementsChannel,
        cronExpr: ANNOUNCEMENT_SYNC_CRON || '*/15 * * * *',
      });
    } else {
      console.warn('No REMINDER_CHANNEL_ID/ANNOUNCEMENTS_CHANNEL_ID set; announcement sync disabled.');
    }
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

    if (interaction.commandName === 'setzoomlink') {
      const course = interaction.options.getString('course', true);
      const link = interaction.options.getString('link', true);

      let url;
      try {
        url = new URL(link);
      } catch {
        await interaction.reply({
          content: 'That doesn\'t look like a valid URL. Paste the full link, starting with `https://`.',
          ephemeral: true,
        });
        return;
      }
      const saved = setZoomLink(course, url.toString());
      const looksLikeZoom =
        /zoom\.us$/i.test(url.hostname) || url.hostname.toLowerCase().endsWith('.zoom.us');

      await interaction.reply(`✅ Saved Zoom link for **${saved.course}**.`);
      if (!looksLikeZoom) {
        await interaction.followUp({
          content: `Heads up — that URL's domain is \`${url.hostname}\`, not a zoom.us link. Saved anyway in case that's intentional.`,
        });
      }
    }

    if (interaction.commandName === 'zoomlink') {
      const course = interaction.options.getString('course');

      if (course) {
        const entry = getZoomLink(course);
        if (!entry) {
          await interaction.reply({
            content: `No Zoom link saved for **${course}** yet. Add one with \`/setzoomlink\`.`,
            ephemeral: true,
          });
          return;
        }
        await interaction.reply(`🔗 **${entry.course}** Zoom link: ${entry.url}`);
        return;
      }

      const all = listZoomLinks();
      if (all.length === 0) {
        await interaction.reply({
          content: 'No Zoom links saved yet. Add one with `/setzoomlink`.',
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🔗 Zoom Links')
        .setColor(0x2d8cff)
        .setDescription(all.map((e) => `**${e.course}**: ${e.url}`).join('\n'));

      await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'removezoomlink') {
      const course = interaction.options.getString('course', true);
      const removed = removeZoomLink(course);
      if (!removed) {
        await interaction.reply({
          content: `No Zoom link found for **${course}**.`,
          ephemeral: true,
        });
        return;
      }
      await interaction.reply(`🗑️ Removed the Zoom link for **${removed.course}**.`);
    }

    if (interaction.commandName === 'setsyllabus') {
      const course = interaction.options.getString('course', true);
      const fields = {
        professor: interaction.options.getString('professor'),
        email: interaction.options.getString('email'),
        officeHours: interaction.options.getString('office_hours'),
        grading: interaction.options.getString('grading'),
        latePolicy: interaction.options.getString('late_policy'),
        textbook: interaction.options.getString('textbook'),
        syllabusUrl: interaction.options.getString('syllabus_url'),
      };

      const providedCount = Object.values(fields).filter((v) => v).length;
      if (providedCount === 0) {
        await interaction.reply({
          content: 'Provide at least one field to set (professor, email, office_hours, grading, late_policy, textbook, or syllabus_url).',
          ephemeral: true,
        });
        return;
      }

      const saved = setSyllabusInfo(course, fields);
      await interaction.reply(`✅ Updated syllabus info for **${saved.course}**. Use \`/syllabus course:${saved.course}\` to view it.`);
    }

    if (interaction.commandName === 'syllabus') {
      const course = interaction.options.getString('course');
      const FIELD_LABELS = {
        professor: 'Professor',
        email: 'Contact Email',
        officeHours: 'Office Hours',
        grading: 'Grading Breakdown',
        latePolicy: 'Late Policy',
        textbook: 'Textbook',
        syllabusUrl: 'Full Syllabus',
      };

      if (course) {
        const entry = getSyllabusInfo(course);
        if (!entry) {
          await interaction.reply({
            content: `No syllabus info saved for **${course}** yet. Add some with \`/setsyllabus\`.`,
            ephemeral: true,
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle(`📖 ${entry.course} — Syllabus & FAQ`)
          .setColor(0x9b59b6);

        for (const [key, label] of Object.entries(FIELD_LABELS)) {
          if (entry[key]) embed.addFields({ name: label, value: entry[key] });
        }

        await interaction.reply({ embeds: [embed] });
        return;
      }

      const all = listCourses();
      if (all.length === 0) {
        await interaction.reply({
          content: 'No syllabus info saved yet. Add some with `/setsyllabus`.',
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('📖 Courses with saved syllabus info')
        .setColor(0x9b59b6)
        .setDescription(all.map((c) => `**${c.course}**`).join('\n') + '\n\nUse `/syllabus course:<name>` for details.');

      await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'removesyllabus') {
      const course = interaction.options.getString('course', true);
      const removed = removeSyllabusInfo(course);
      if (!removed) {
        await interaction.reply({
          content: `No syllabus info found for **${course}**.`,
          ephemeral: true,
        });
        return;
      }
      await interaction.reply(`🗑️ Removed syllabus info for **${removed.course}**.`);
    }

    if (interaction.commandName === 'checkannouncements') {
      if (!isCanvasConfigured()) {
        await interaction.reply({
          content: 'Canvas isn\'t configured (missing `CANVAS_BASE_URL` / `CANVAS_API_TOKEN` in `.env`).',
          ephemeral: true,
        });
        return;
      }

      const announcementsChannel = ANNOUNCEMENTS_CHANNEL_ID || REMINDER_CHANNEL_ID;
      if (!announcementsChannel) {
        await interaction.reply({
          content: 'No `REMINDER_CHANNEL_ID` or `ANNOUNCEMENTS_CHANNEL_ID` set, so there\'s nowhere to post new announcements.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();
      const result = await syncAnnouncements(client, announcementsChannel);

      let msg;
      if (result.firstRun) {
        msg = `First-time setup: baselined ${result.baseline} existing announcement(s). Nothing posted — future *new* announcements will show up automatically from here on.`;
      } else {
        msg = `Posted **${result.posted}** new announcement(s).`;
      }
      if (result.errors.length) {
        msg += `\n⚠️ ${result.errors.length} error(s): ${result.errors.slice(0, 3).join('; ')}`;
      }
      await interaction.editReply(msg);
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

    // Members of the target role can manage its docs; server admins can too
    // (e.g. to fix a mistake), even if they aren't personally in the role.
    function hasGroupAccess(member, roleId) {
      if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
      return member.roles.cache.has(roleId);
    }

    if (interaction.commandName === 'adddoc') {
      const role = interaction.options.getRole('role', true);
      const name = interaction.options.getString('name', true);
      const link = interaction.options.getString('link', true);

      if (!hasGroupAccess(interaction.member, role.id)) {
        await interaction.reply({
          content: `You need the **${role.name}** role to add documents to that group.`,
          ephemeral: true,
        });
        return;
      }

      let url;
      try {
        url = new URL(link);
      } catch {
        await interaction.reply({
          content: 'That doesn\'t look like a valid URL. Paste the full link, starting with `https://`.',
          ephemeral: true,
        });
        return;
      }

      const entry = addDoc(role.id, role.name, {
        name,
        url: url.toString(),
        addedBy: interaction.user.tag,
      });

      await interaction.reply({
        content: `✅ Added **${entry.name}** to **${role.name}**'s documents. ID: \`${entry.id}\``,
        ephemeral: true,
      });
    }

    if (interaction.commandName === 'docs') {
      const role = interaction.options.getRole('role');

      if (role) {
        if (!hasGroupAccess(interaction.member, role.id)) {
          await interaction.reply({
            content: `You need the **${role.name}** role to view that group's documents.`,
            ephemeral: true,
          });
          return;
        }

        const docs = listDocs(role.id);
        if (docs.length === 0) {
          await interaction.reply({
            content: `No documents saved for **${role.name}** yet. Add one with \`/adddoc\`.`,
            ephemeral: true,
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle(`🔒 ${role.name} — Documents`)
          .setColor(role.color || 0x5865f2)
          .setDescription(
            docs.map((d) => `**${d.name}**: ${d.url}\n_added by ${d.addedBy} · ID: \`${d.id}\`_`).join('\n\n')
          );

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      // No role given: show every group the invoking member currently belongs to.
      const memberRoleIds = interaction.member.roles.cache.map((r) => r.id);
      const groups = listDocsForRoles(memberRoleIds);

      if (groups.length === 0) {
        await interaction.reply({
          content: 'No documents found for any of your roles yet. Add one with `/adddoc`.',
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🔒 Your Group Documents')
        .setColor(0x5865f2)
        .setDescription(
          groups
            .map(
              (g) =>
                `**${g.roleName}**\n` +
                g.docs.map((d) => `• **${d.name}**: ${d.url} (\`${d.id}\`)`).join('\n')
            )
            .join('\n\n')
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'removedoc') {
      const role = interaction.options.getRole('role', true);
      const id = interaction.options.getString('id', true);

      if (!hasGroupAccess(interaction.member, role.id)) {
        await interaction.reply({
          content: `You need the **${role.name}** role to remove documents from that group.`,
          ephemeral: true,
        });
        return;
      }

      const removed = removeDoc(role.id, id);
      if (!removed) {
        await interaction.reply({
          content: `No document found with ID \`${id}\` in **${role.name}**'s group.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `🗑️ Removed **${removed.name}** from **${role.name}**'s documents.`,
        ephemeral: true,
      });
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
