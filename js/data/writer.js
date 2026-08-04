// The ONLY module that changes the sheet: Google first then memory, and every confirmed write updates memory rather than re-reading.

import { APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, FLAG_YES } from "../config.js";
import { postPlain } from "../core/http.js";
import { watched } from "./watched.js";
import { watchlist } from "./watchlist.js";
import { identityPayload, idOf } from "./identity.js";
import { invalidate } from "./sheets.js";

class WriteError extends Error {
  constructor(message) {
    super(message);
    this.name = "WriteError";
  }
}

export function isConfigured() {
  return Boolean(APPS_SCRIPT_URL && APPS_SCRIPT_TOKEN);
}

async function call(action, payload) {
  if (!isConfigured()) {
    throw new WriteError("No write bridge configured. Set APPS_SCRIPT_URL in js/config.js.");
  }

  let body;
  try {
    body = await postPlain(APPS_SCRIPT_URL, { token: APPS_SCRIPT_TOKEN, action, payload });
  } catch (error) {
    throw new WriteError(`Could not reach the sheet. ${error.message}`);
  }

  if (!body || body.ok !== true) {
    throw new WriteError((body && body.error) || "The sheet refused the change.");
  }

  invalidate();
  return body;
}

function rowFor(item, extra) {
  return {
    tmdb_id: item.tmdb_id != null ? item.tmdb_id : item.id,
    name: item.name || item.title || "",
    year: item.year || "",
    genre: item.genre || "",
    poster: item.poster || "",
    og_title: item.og_title || item.original_title || item.title || "",
    industry: item.industry || "",
    ...extra
  };
}

export async function addWatched(item, { mustWatch = false, favorite = false } = {}) {
  if (!item.tmdb_id && !item.id) throw new WriteError("That title has no TMDB id, so it cannot be saved.");
  if (!item.industry) throw new WriteError("Choose an industry first.");

  const row = rowFor(item, {
    must_watch: mustWatch ? FLAG_YES : "",
    favorite: favorite ? FLAG_YES : ""
  });

  // One call appends to All Watched and deletes from Watchlist: two calls can half-fail and leave a title in both.
  const result = await call("add_watched", row);

  const stored = watched.applyAdd({ ...row, must_watch: mustWatch, favorite });
  // By identity, not by id: the queued row may be TMDB's other record for the same film.
  if (result.removed_from_watchlist) watchlist.applyRemove(row);

  return { row: stored, removed_from_watchlist: Boolean(result.removed_from_watchlist) };
}

// Each takes a bare id or the whole title - the bridge falls back to name-and-year when the id it is given misses.
export async function removeWatched(target) {
  const payload = identityPayload(target);
  if (!payload.tmdb_id && !payload.name) throw new WriteError("No TMDB id given.");
  const result = await call("remove_watched", payload);
  const removed = watched.applyRemove(payload.tmdb_id || idOf(target));
  return { removed: result.removed !== undefined ? Boolean(result.removed) : removed };
}

// Must Watch and Favorites in one call, touching only the flags named, so liking something never disturbs must-watch.
export async function setFlags(target, { mustWatch = null, favorite = null } = {}) {
  const payload = identityPayload(target);
  if (!payload.tmdb_id && !payload.name) throw new WriteError("No TMDB id given.");
  if (mustWatch === null && favorite === null) throw new WriteError("Nothing to change.");

  if (mustWatch !== null) payload.must_watch = Boolean(mustWatch);
  if (favorite !== null) payload.favorite = Boolean(favorite);

  await call("set_flags", payload);
  const row = watched.applyFlags(target, mustWatch, favorite);
  return { row };
}

export async function addWatchlist(item) {
  if (!item.tmdb_id && !item.id) throw new WriteError("That title has no TMDB id, so it cannot be saved.");
  const row = rowFor(item, {});

  // The bridge checks name and year as well as the id before appending; applyAdd does the same in memory.
  const result = await call("add_watchlist", row);
  return { row: watchlist.applyAdd(row), already_listed: Boolean(result.already_listed) };
}

export async function removeWatchlist(target) {
  const payload = identityPayload(target);
  if (!payload.tmdb_id && !payload.name) throw new WriteError("No TMDB id given.");
  // Removes EVERY row for this title, so a duplicate that predates the identity fix goes with it.
  const result = await call("remove_watchlist", payload);
  const removed = watchlist.applyRemove(target);
  return { removed: result.removed !== undefined ? Boolean(result.removed) : removed };
}
