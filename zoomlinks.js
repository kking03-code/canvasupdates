const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'zoomlinks.json');

function ensureFile() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify({ links: {} }, null, 2));
  }
}

function loadLinks() {
  ensureFile();
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    return parsed.links && typeof parsed.links === 'object' ? parsed.links : {};
  } catch (err) {
    console.error('Failed to parse zoomlinks.json, starting fresh:', err);
    return {};
  }
}

function saveLinks(links) {
  fs.writeFileSync(DATA_PATH, JSON.stringify({ links }, null, 2));
}

// Keys are matched case-insensitively so "CS101" and "cs101" hit the same entry.
function normalizeKey(course) {
  return course.trim().toLowerCase();
}

function setZoomLink(course, url) {
  const links = loadLinks();
  const key = normalizeKey(course);
  links[key] = { course: course.trim(), url, updatedAt: new Date().toISOString() };
  saveLinks(links);
  return links[key];
}

function getZoomLink(course) {
  const links = loadLinks();
  return links[normalizeKey(course)] || null;
}

function removeZoomLink(course) {
  const links = loadLinks();
  const key = normalizeKey(course);
  const existing = links[key];
  if (!existing) return null;
  delete links[key];
  saveLinks(links);
  return existing;
}

function listZoomLinks() {
  const links = loadLinks();
  return Object.values(links).sort((a, b) => a.course.localeCompare(b.course));
}

module.exports = {
  setZoomLink,
  getZoomLink,
  removeZoomLink,
  listZoomLinks,
};
