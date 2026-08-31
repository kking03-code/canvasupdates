const cron = require('node-cron');
const { addOrUpdateAssignment } = require('./storage');

const CANVAS_BASE_URL = process.env.CANVAS_BASE_URL; // e.g. https://yourschool.instructure.com
const CANVAS_API_TOKEN = process.env.CANVAS_API_TOKEN;
// Optional comma-separated list to restrict which Canvas course IDs get synced.
// If unset, all of the user's active courses are synced.
const CANVAS_COURSE_IDS = (process.env.CANVAS_COURSE_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isCanvasConfigured() {
  return Boolean(CANVAS_BASE_URL && CANVAS_API_TOKEN);
}

// Canvas paginates with a `Link` response header (RFC 5988). Parse it to find
// the "next" page URL, if any.
function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const parts = linkHeader.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

// Fetches every page of a Canvas API endpoint and returns the combined array.
async function canvasFetchAll(pathOrUrl) {
  const results = [];
  let url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${CANVAS_BASE_URL.replace(/\/$/, '')}${pathOrUrl}`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${CANVAS_API_TOKEN}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Canvas API error ${res.status} for ${url}: ${body.slice(0, 300)}`);
    }

    const page = await res.json();
    if (Array.isArray(page)) results.push(...page);
    else results.push(page);

    url = parseNextLink(res.headers.get('link'));
  }

  return results;
}

async function fetchActiveCourses() {
  const courses = await canvasFetchAll(
    '/api/v1/courses?enrollment_state=active&per_page=100'
  );

  const filtered = CANVAS_COURSE_IDS.length
    ? courses.filter((c) => CANVAS_COURSE_IDS.includes(String(c.id)))
    : courses;

  // Courses the API returns without a name/code (rare, e.g. concluded
  // access issues) aren't useful to sync.
  return filtered.filter((c) => c && c.id && (c.course_code || c.name));
}

async function fetchUpcomingAssignmentsForCourse(course) {
  const assignments = await canvasFetchAll(
    `/api/v1/courses/${course.id}/assignments?bucket=upcoming&per_page=100&order_by=due_at`
  );

  return assignments
    .filter((a) => a.due_at) // skip assignments with no due date
    .map((a) => ({
      id: `canvas-${a.id}`,
      course: course.course_code || course.name,
      title: a.name,
      dueISO: new Date(a.due_at).toISOString(),
      url: a.html_url,
      source: 'canvas',
    }));
}

// Pulls upcoming assignments from all configured Canvas courses and upserts
// them into local storage. Safe to call repeatedly (idempotent by id).
async function syncCanvasAssignments() {
  if (!isCanvasConfigured()) {
    return { configured: false, synced: 0, added: 0, updated: 0, errors: [] };
  }

  const errors = [];
  let courses = [];
  try {
    courses = await fetchActiveCourses();
  } catch (err) {
    errors.push(`Could not list courses: ${err.message}`);
    return { configured: true, synced: 0, added: 0, updated: 0, errors };
  }

  let synced = 0;
  let added = 0;
  let updated = 0;
  const newlyAdded = [];

  for (const course of courses) {
    try {
      const upcoming = await fetchUpcomingAssignmentsForCourse(course);
      for (const item of upcoming) {
        const result = addOrUpdateAssignment(item);
        synced += 1;
        if (result.created) {
          added += 1;
          newlyAdded.push(result.entry);
        } else if (result.dueChanged) {
          updated += 1;
        }
      }
    } catch (err) {
      errors.push(`Course "${course.course_code || course.name}": ${err.message}`);
    }
  }

  return { configured: true, synced, added, updated, errors, newlyAdded };
}

function scheduleCanvasSync(cronExpr, { onResult } = {}) {
  if (!isCanvasConfigured()) {
    console.warn('CANVAS_BASE_URL/CANVAS_API_TOKEN not set; Canvas sync disabled.');
    return;
  }
  if (!cronExpr) {
    console.warn('No CANVAS_SYNC_CRON set; skipping scheduled Canvas sync.');
    return;
  }
  cron.schedule(cronExpr, async () => {
    try {
      const result = await syncCanvasAssignments();
      console.log(
        `Canvas sync: ${result.synced} upcoming, ${result.added} new, ${result.updated} updated` +
          (result.errors.length ? `, ${result.errors.length} error(s)` : '')
      );
      if (result.errors.length) console.error(result.errors);
      if (onResult) onResult(result);
    } catch (err) {
      console.error('Canvas sync failed:', err);
    }
  });
  console.log(`Scheduled Canvas sync with cron "${cronExpr}".`);
}

module.exports = {
  isCanvasConfigured,
  syncCanvasAssignments,
  scheduleCanvasSync,
  canvasFetchAll,
  fetchActiveCourses,
};
