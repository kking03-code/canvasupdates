const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'syllabus.json');

const FIELDS = ['professor', 'email', 'officeHours', 'grading', 'latePolicy', 'textbook', 'syllabusUrl'];

function ensureFile() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify({ courses: {} }, null, 2));
  }
}

function loadAll() {
  ensureFile();
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    return parsed.courses && typeof parsed.courses === 'object' ? parsed.courses : {};
  } catch (err) {
    console.error('Failed to parse syllabus.json, starting fresh:', err);
    return {};
  }
}

function saveAll(courses) {
  fs.writeFileSync(DATA_PATH, JSON.stringify({ courses }, null, 2));
}

function normalizeKey(course) {
  return course.trim().toLowerCase();
}

// Merges only the fields provided (non-null/undefined) into the existing
// entry, so `/setsyllabus` can be called repeatedly to fill in fields one at
// a time without wiping out what's already set.
function setSyllabusInfo(course, fields) {
  const courses = loadAll();
  const key = normalizeKey(course);
  const existing = courses[key] || { course: course.trim() };

  for (const f of FIELDS) {
    if (fields[f] !== undefined && fields[f] !== null && fields[f] !== '') {
      existing[f] = fields[f];
    }
  }
  existing.course = course.trim(); // keep latest casing
  existing.updatedAt = new Date().toISOString();

  courses[key] = existing;
  saveAll(courses);
  return existing;
}

function getSyllabusInfo(course) {
  const courses = loadAll();
  return courses[normalizeKey(course)] || null;
}

function removeSyllabusInfo(course) {
  const courses = loadAll();
  const key = normalizeKey(course);
  const existing = courses[key];
  if (!existing) return null;
  delete courses[key];
  saveAll(courses);
  return existing;
}

function listCourses() {
  const courses = loadAll();
  return Object.values(courses).sort((a, b) => a.course.localeCompare(b.course));
}

module.exports = {
  FIELDS,
  setSyllabusInfo,
  getSyllabusInfo,
  removeSyllabusInfo,
  listCourses,
};
