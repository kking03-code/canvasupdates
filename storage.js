const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'assignments.json');

function ensureFile() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify({ assignments: [] }, null, 2));
  }
}

function loadAssignments() {
  ensureFile();
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.assignments) ? parsed.assignments : [];
  } catch (err) {
    console.error('Failed to parse assignments.json, starting fresh:', err);
    return [];
  }
}

function saveAssignments(assignments) {
  fs.writeFileSync(DATA_PATH, JSON.stringify({ assignments }, null, 2));
}

function addAssignment({ course, title, dueISO }) {
  const assignments = loadAssignments();
  const id = 'manual-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const entry = { id, course, title, due: dueISO, source: 'manual', notified: [] };
  assignments.push(entry);
  saveAssignments(assignments);
  return entry;
}

// Insert or update an assignment by a stable id (used for Canvas sync, where
// id = `canvas-${canvasAssignmentId}` so re-syncing never creates duplicates).
// If the due date changes, the notified list is cleared so reminders re-fire.
function addOrUpdateAssignment({ id, course, title, dueISO, url, source }) {
  const assignments = loadAssignments();
  const existing = assignments.find((a) => a.id === id);

  if (existing) {
    const dueChanged = existing.due !== dueISO;
    existing.course = course;
    existing.title = title;
    existing.due = dueISO;
    existing.url = url;
    existing.source = source;
    if (dueChanged) existing.notified = [];
    saveAssignments(assignments);
    return { entry: existing, created: false, dueChanged };
  }

  const entry = { id, course, title, due: dueISO, url, source, notified: [] };
  assignments.push(entry);
  saveAssignments(assignments);
  return { entry, created: true, dueChanged: false };
}

function removeAssignment(id) {
  const assignments = loadAssignments();
  const idx = assignments.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  const [removed] = assignments.splice(idx, 1);
  saveAssignments(assignments);
  return removed;
}

function markNotified(id, tag) {
  const assignments = loadAssignments();
  const entry = assignments.find((a) => a.id === id);
  if (!entry) return;
  if (!entry.notified.includes(tag)) {
    entry.notified.push(tag);
    saveAssignments(assignments);
  }
}

module.exports = {
  loadAssignments,
  saveAssignments,
  addAssignment,
  addOrUpdateAssignment,
  removeAssignment,
  markNotified,
};
