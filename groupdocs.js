const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'groupdocs.json');

function ensureFile() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify({ groups: {} }, null, 2));
  }
}

function loadAll() {
  ensureFile();
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    return parsed.groups && typeof parsed.groups === 'object' ? parsed.groups : {};
  } catch (err) {
    console.error('Failed to parse groupdocs.json, starting fresh:', err);
    return {};
  }
}

function saveAll(groups) {
  fs.writeFileSync(DATA_PATH, JSON.stringify({ groups }, null, 2));
}

// Groups are keyed by Discord role ID (a stable snowflake), not role name,
// so a role rename doesn't orphan its documents.
function addDoc(roleId, roleName, { name, url, addedBy }) {
  const groups = loadAll();
  if (!groups[roleId]) groups[roleId] = { roleName, docs: [] };
  groups[roleId].roleName = roleName; // keep the display name current

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const entry = { id, name, url, addedBy, addedAt: new Date().toISOString() };
  groups[roleId].docs.push(entry);
  saveAll(groups);
  return entry;
}

function listDocs(roleId) {
  const groups = loadAll();
  return groups[roleId] ? groups[roleId].docs : [];
}

function removeDoc(roleId, docId) {
  const groups = loadAll();
  const group = groups[roleId];
  if (!group) return null;
  const idx = group.docs.findIndex((d) => d.id === docId);
  if (idx === -1) return null;
  const [removed] = group.docs.splice(idx, 1);
  saveAll(groups);
  return removed;
}

// Returns { roleId, roleName, docs }[] for every group the given set of role
// IDs (a user's roles) has an entry for — used by /docs when no specific
// role is given, to show "everything I have access to."
function listDocsForRoles(roleIds) {
  const groups = loadAll();
  const result = [];
  for (const roleId of roleIds) {
    if (groups[roleId] && groups[roleId].docs.length > 0) {
      result.push({ roleId, roleName: groups[roleId].roleName, docs: groups[roleId].docs });
    }
  }
  return result;
}

module.exports = {
  addDoc,
  listDocs,
  removeDoc,
  listDocsForRoles,
};
