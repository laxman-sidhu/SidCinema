// The last known sheet, hydrated synchronously before the first paint so cards are green in the first frame.

import { store } from "../core/util.js";

// Bump when the row shape changes, or an old snapshot is hydrated into a reader that no longer understands it.
const VERSION = 2;

// A week. A background read corrects it seconds later, so this only matters for a device left unused.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function key(name) {
  return `sidcinema-snapshot-${name}-v${VERSION}`;
}

export function save(name, rows) {
  if (!rows || !rows.length) return;
  store.setJSON(key(name), { at: Date.now(), rows });
}

export function load(name) {
  const packed = store.getJSON(key(name));
  if (!packed || !Array.isArray(packed.rows) || !packed.rows.length) return null;
  if (Date.now() - (packed.at || 0) > MAX_AGE_MS) {
    store.remove(key(name));
    return null;
  }
  return packed.rows;
}
