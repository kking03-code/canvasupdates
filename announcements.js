const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const { isCanvasConfigured, canvasFetchAll, fetchActiveCourses } = require('./canvas');

const SEEN_PATH = path.join(__dirname, 'announcements-seen.json');
const PRUNE_AFTER_DAYS = 90; // stop tracking announcements older than this

function loadSeen() {
  if (!fs.existsSync(SEEN_PATH)) return null; // null = "never run before"
  try {
    const parsed = JSON.parse(fs.readFileSync(SEEN_PATH, 'utf-8'));
    return parsed && typeof parsed.seen === 'object' ? parsed.seen : {};
  } catch (err) {
    console.error('Failed to parse announcements-seen.json, treating as empty:', err);
    return {};
  }
}

function saveSeen(seen) {
  const cutoff = Date.now() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const pruned = {};
  for (const [id, postedAtMs] of Object.entries(seen)) {
    if (postedAtMs >= cutoff) pruned[id] = postedAtMs;
  }
  fs.writeFileSync(SEEN_PATH, JSON.stringify({ seen: pruned }, null, 2));
}

// Canvas announcement `message` fields are HTML. Strip tags and decode the
// handful of entities Canvas commonly emits, then trim to a safe embed length.
function htmlToPlainText(html, maxLen = 500) {
  if (!html) return '';
  const withoutTags = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  const decoded = withoutTags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (decoded.length <= maxLen) return decoded;
  return decoded.slice(0, maxLen).trim() + '…';
}

// Fetches announcements across all configured courses in a single API call
// (Canvas supports multiple context_codes on one request).
async function fetchAllAnnouncements() {
  const courses = await fetchActiveCourses();
  if (courses.length === 0) return [];

  const contextParams = courses
    .map((c) => `context_codes[]=${encodeURIComponent(`course_${c.id}`)}`)
    .join('&');

  const courseById = new Map(courses.map((c) => [String(c.id), c]));

  const raw = await canvasFetchAll(
    `/api/v1/announcements?${contextParams}&per_page=50&order_by=posted_at`
  );

  return raw
    .filter((a) => a.id && a.posted_at)
    .map((a) => {
      const courseId = String(a.context_code || '').replace('course_', '');
      const course = courseById.get(courseId);
      return {
        id: String(a.id),
        course: course ? course.course_code || course.name : `Course ${courseId}`,
        title: a.title,
        body: htmlToPlainText(a.message),
        url: a.html_url || a.url,
        postedAtMs: new Date(a.posted_at).getTime(),
      };
    });
}

function buildAnnouncementEmbed(a) {
  return new EmbedBuilder()
    .setTitle(`📢 ${a.title}`)
    .setColor(0xf5a623)
    .setDescription(a.body || '*(no message body)*')
    .addFields({ name: 'Course', value: a.course, inline: true })
    .setURL(a.url || null)
    .setTimestamp(a.postedAtMs);
}

// Checks for announcements not yet posted to Discord and sends any new ones.
// On the very first run (no seen-file yet), everything currently on Canvas is
// marked seen WITHOUT posting, so the channel doesn't get flooded with the
// entire semester's backlog the moment this feature is turned on.
async function syncAnnouncements(client, channelId) {
  if (!isCanvasConfigured()) {
    return { configured: false, posted: 0, errors: [] };
  }

  const errors = [];
  let announcements = [];
  try {
    announcements = await fetchAllAnnouncements();
  } catch (err) {
    errors.push(`Could not fetch announcements: ${err.message}`);
    return { configured: true, posted: 0, errors };
  }

  const existingSeen = loadSeen();
  const isFirstRun = existingSeen === null;
  const seen = existingSeen || {};

  const newOnes = announcements.filter((a) => !(a.id in seen));

  if (isFirstRun) {
    for (const a of announcements) seen[a.id] = a.postedAtMs;
    saveSeen(seen);
    return { configured: true, posted: 0, errors, firstRun: true, baseline: announcements.length };
  }

  if (newOnes.length === 0) {
    return { configured: true, posted: 0, errors };
  }

  let posted = 0;
  if (channelId) {
    const channel = await client.channels.fetch(channelId).catch((err) => {
      errors.push(`Could not fetch announcements channel: ${err.message}`);
      return null;
    });

    if (channel) {
      // Oldest first, so they read top-to-bottom in posting order.
      newOnes.sort((a, b) => a.postedAtMs - b.postedAtMs);
      for (const a of newOnes) {
        try {
          await channel.send({ embeds: [buildAnnouncementEmbed(a)] });
          posted += 1;
        } catch (err) {
          errors.push(`Failed to post "${a.title}": ${err.message}`);
        }
      }
    }
  } else {
    errors.push('No announcements channel configured; new announcements were not posted.');
  }

  for (const a of newOnes) seen[a.id] = a.postedAtMs;
  saveSeen(seen);

  return { configured: true, posted, errors };
}

function scheduleAnnouncementSync(client, { channelId, cronExpr }) {
  if (!isCanvasConfigured()) {
    console.warn('Canvas not configured; announcement sync disabled.');
    return;
  }
  if (!cronExpr) {
    console.warn('No ANNOUNCEMENT_SYNC_CRON set; skipping scheduled announcement sync.');
    return;
  }
  cron.schedule(cronExpr, async () => {
    try {
      const result = await syncAnnouncements(client, channelId);
      if (result.firstRun) {
        console.log(`Announcement sync: first run, baselined ${result.baseline} existing announcement(s).`);
      } else {
        console.log(
          `Announcement sync: ${result.posted} new posted` +
            (result.errors.length ? `, ${result.errors.length} error(s)` : '')
        );
      }
      if (result.errors.length) console.error(result.errors);
    } catch (err) {
      console.error('Announcement sync failed:', err);
    }
  });
  console.log(`Scheduled announcement sync with cron "${cronExpr}".`);
}

module.exports = {
  syncAnnouncements,
  scheduleAnnouncementSync,
};
