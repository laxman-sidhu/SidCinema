// The last known sheet, kept in localStorage.
//
// Why this exists: a refresh used to paint the TMDB grid first and turn the
// watched cards green a second later, when the Apps Script read finally came
// back. The flags arriving after the posters is the single most visible piece of
// lag in the app, because it reads as the page correcting itself.
//
// A snapshot is written after every successful read and after every confirmed
// write, and hydrated SYNCHRONOUSLY before the first paint. The index is then
// already populated when the first annotate() runs, so cards are green in the
// first frame. The live read still happens, in the background, and replaces it.
//
// Stale-while-revalidate, in other words - the same bargain the app already
// makes with its in-memory copy, just surviving a reload.

import { store } from "../core/util.js";

// Bump when the row shape changes, or an old snapshot will be hydrated into a
// reader that no longer understands it. v2 added media_hint, which matching
// reads: a v1 snapshot has none, and an absent hint means "unknown", which
// matches anything - safe, but only correct until the live read lands.
const VERSION = 2;

// A week. The snapshot is only ever a first paint: a background read corrects it
// seconds later, so the expiry only matters for a device left unused.
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
