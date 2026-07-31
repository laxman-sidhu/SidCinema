// The Watchlist tab. Same columns as All Watched minus the two flags.
//
// Matching is by IDENTITY, not by TMDB id alone - see js/data/identity.js. A
// film TMDB holds twice was invisible to its own row: the card showed no
// watchlist state and clicking it appended a second row for the same film.

import { fetchTab } from "./sheets.js";
import * as snapshot from "./snapshot.js";
import { mediaForIndustry } from "./watched.js";
import {
  mediaOf, mediaCompatible, mediaWanted, idOf, asRecord,
  indexKeys, lookupKeys, firstSeen
} from "./identity.js";
import {
  parseId, cleanLabel, splitGenres,
  orderCategories, formatCategories
} from "../core/util.js";

function shape(raw) {
  const record = {
    name: (raw.name || "").trim(),
    genre: (raw.genre || "").trim(),
    poster: (raw.poster || "").trim(),
    og_title: (raw.og_title || "").trim(),
    industry: cleanLabel(raw.industry),
    tmdb_id: parseId(raw.tmdb_id),
    year: parseId(raw.year)
  };
  // media is what the card is rendered as and always has a value. media_hint is
  // what the row actually KNOWS, and is "" when the Industry cell is blank -
  // which it is for most rows the site adds, because a TMDB result carries no
  // industry to copy. Matching uses the hint, so an unknown row matches either
  // kind rather than being wrongly pinned to "movie".
  record.media = mediaForIndustry(record.industry);
  record.media_hint = mediaOf(record.industry);
  if (record.tmdb_id === null && !record.og_title && !record.name) return null;
  return record;
}

class WatchlistLibrary {
  constructor() {
    this.rows = [];
    this.byId = new Map();
    this.byKey = new Map();
    this.loadedAt = 0;
    this.lastError = null;
  }

  hydrate() {
    if (this.rows.length) return true;
    const rows = snapshot.load("watchlist");
    if (!rows) return false;
    this.install(rows);
    return true;
  }

  async load() {
    try {
      const raw = await fetchTab("watchlist");
      this.install(raw.map(shape).filter(Boolean));
      snapshot.save("watchlist", this.rows);
      return true;
    } catch (error) {
      if (!this.rows.length) this.lastError = error.message;
      return this.rows.length > 0;
    }
  }

  install(rows) {
    const byId = new Map();
    const byKey = new Map();
    for (const row of rows) {
      if (row.tmdb_id !== null && !byId.has(row.tmdb_id)) byId.set(row.tmdb_id, row);
      for (const key of indexKeys(row)) if (!byKey.has(key)) byKey.set(key, row);
    }
    this.rows = rows;
    this.byId = byId;
    this.byKey = byKey;
    this.loadedAt = Date.now();
    this.lastError = null;
  }

  // The row for this title, or null. Accepts a bare id, a TMDB result or a
  // sheet row.
  find(value) {
    const record = asRecord(value);
    if (!record) return null;
    const wanted = mediaWanted(record);

    const id = idOf(record);
    if (id !== null) {
      const hit = this.byId.get(id);
      if (hit && mediaCompatible(hit.media_hint, wanted)) return hit;
    }
    for (const key of lookupKeys(record)) {
      const hit = this.byKey.get(key);
      if (hit && mediaCompatible(hit.media_hint, wanted)) return hit;
    }
    return null;
  }

  // Every row for this title, not just the first. Duplicates already in the
  // sheet have to leave together, or removing one leaves the other behind.
  matches(value) {
    const record = asRecord(value);
    if (!record) return [];
    const wanted = mediaWanted(record);
    const id = idOf(record);
    const keys = new Set(lookupKeys(record));

    return this.rows.filter(row => {
      if (!mediaCompatible(row.media_hint, wanted)) return false;
      if (id !== null && row.tmdb_id === id) return true;
      return indexKeys(row).some(key => keys.has(key));
    });
  }

  has(value) {
    return this.find(value) !== null;
  }

  annotate(item) {
    const row = this.find(item);
    item.watchlisted = Boolean(row);
    // The id of the row that ACTUALLY sits in the sheet, which is not always the
    // id on the card. Every write uses this one, or a remove would ask the
    // bridge to delete a row that was never there.
    item.watchlist_id = row ? row.tmdb_id : null;
    return item;
  }

  annotateAll(items) {
    return items.map(item => this.annotate(item));
  }

  applyAdd(record) {
    const row = {
      name: record.name || record.title || "",
      genre: record.genre || "",
      poster: record.poster || "",
      og_title: record.og_title || record.original_title || "",
      industry: cleanLabel(record.industry),
      tmdb_id: parseId(record.tmdb_id != null ? record.tmdb_id : record.id),
      year: parseId(record.year)
    };
    row.media = mediaForIndustry(row.industry);
    row.media_hint = mediaOf(row.industry);

    // Already queued under one of its identities, so nothing is appended. This
    // is the memory-side half of the duplicate fix; the bridge holds the other.
    const existing = this.find(row);
    if (existing) return existing;

    this.rows.push(row);
    if (row.tmdb_id !== null && !this.byId.has(row.tmdb_id)) this.byId.set(row.tmdb_id, row);
    for (const key of indexKeys(row)) if (!this.byKey.has(key)) this.byKey.set(key, row);
    snapshot.save("watchlist", this.rows);
    return row;
  }

  // Removes EVERY row for this title, so a duplicate that predates the fix
  // leaves with the row that was clicked.
  applyRemove(value) {
    const doomed = new Set(this.matches(value));
    if (!doomed.size) return false;
    this.install(this.rows.filter(row => !doomed.has(row)));
    snapshot.save("watchlist", this.rows);
    return true;
  }

  // Anything already watched is dropped from the view. The row is removed from
  // the sheet by the same Apps Script call that marks it watched, so this only
  // covers a row edited by hand in the workbook - or a film watched under one
  // TMDB id and queued under another.
  //
  // watchedSource is the watched library itself, so the check is the same
  // identity match used everywhere else. A plain Set of ids is still accepted,
  // because that is what this took before.
  library(watchedSource) {
    const items = [];
    const genreCounts = {};
    const counts = {};
    const unseen = firstSeen();

    for (const row of this.rows) {
      if (!unseen(row)) continue;              // the same film twice is one card
      if (isWatched(watchedSource, row)) continue;

      const genres = splitGenres(row.genre);
      for (const genre of genres) genreCounts[genre] = (genreCounts[genre] || 0) + 1;
      if (row.industry) counts[row.industry] = (counts[row.industry] || 0) + 1;

      items.push({
        id: row.tmdb_id,
        title: row.name || row.og_title,
        original_title: row.og_title,
        year: row.year,
        poster: row.poster,
        genres,
        media_type: row.media,
        media_hint: row.media_hint,
        category: row.industry,
        watched: false,
        watchlisted: true,
        watchlist_id: row.tmdb_id
      });
    }

    const categories = orderCategories(counts);
    return {
      items,
      genres: orderCategories(genreCounts),
      categories,
      stats: this.stats(watchedSource, items.length, categories)
    };
  }

  stats(watchedSource, queued, categories) {
    const rows = this.rows;
    const movies = rows.filter(row => row.media !== "tv").length;
    const series = rows.length - movies;
    const cats = categories || orderCategories(
      rows.reduce((acc, row) => {
        if (row.industry) acc[row.industry] = (acc[row.industry] || 0) + 1;
        return acc;
      }, {})
    );

    return {
      total_rows: rows.length,
      queued: queued === undefined ? rows.length : queued,
      movies,
      series,
      categories: cats,
      category_line: formatCategories(cats),
      loaded_at: this.loadedAt,
      loaded: rows.length > 0,
      error: this.lastError
    };
  }
}

function isWatched(source, row) {
  if (!source) return false;
  if (typeof source.find === "function") return Boolean(source.find(row));
  if (typeof source.has === "function") return row.tmdb_id !== null && source.has(row.tmdb_id);
  return false;
}

export const watchlist = new WatchlistLibrary();
