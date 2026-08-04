// Two layers: the map answers within a page, sessionStorage across a reload.

const memory = new Map();
const PREFIX = "sc:";

function readSession(key) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    return entry && typeof entry.until === "number" ? entry : null;
  } catch {
    return null;
  }
}

function writeSession(key, entry) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota exceeded. The memory layer still works, so carry on.
  }
}

export function get(key) {
  const now = Date.now();

  const hit = memory.get(key);
  if (hit) {
    if (hit.until > now) return hit.value;
    memory.delete(key);
  }

  const stored = readSession(key);
  if (stored && stored.until > now) {
    memory.set(key, stored);
    return stored.value;
  }
  return undefined;
}

export function set(key, value, ttl) {
  const entry = { value, until: Date.now() + ttl };
  memory.set(key, entry);
  writeSession(key, entry);
  return value;
}
