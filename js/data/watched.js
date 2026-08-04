// All Watched, indexed for lookup and for the library page.

import { SERIES_INDUSTRY } from "../config.js";
import { fetchTab } from "./sheets.js";
import * as snapshot from "./snapshot.js";
import {
  MOVIE, TV, mediaOf, mediaCompatible, mediaWanted, idOf, asRecord,
  indexKeys, lookupKeys, firstSeen
} from "./identity.js";
import {
  parseId, isYes, cleanLabel, splitGenres, normaliseTitle,
  orderCategories, formatCategories
} from "../core/util.js";

// Web Series is a series and everything else a film. The DISPLAY answer, which always gives one; mediaOf() answers "" for a blank cell.
export function mediaForIndustry(industry) {
  const text = String(industry || "").trim().toLowerCase();
  return text === SERIES_INDUSTRY.trim().toLowerCase() ? TV : MOVIE;
}

function blankRow() {
  return {
    name: "", year: null, genre: "", poster: "", tmdb_id: null,
    og_title: "", industry: "", must_watch: false, favorite: false,
    media: MOVIE, media_hint: ""
  };
}

function shape(raw) {
  const record = blankRow();
  record.name = (raw.name || "").trim();
  record.genre = (raw.genre || "").trim();
  record.poster = (raw.poster || "").trim();
  record.og_title = (raw.og_title || "").trim();
  record.industry = cleanLabel(raw.industry);
  record.tmdb_id = parseId(raw.tmdb_id);
  record.year = parseId(raw.year);
  record.must_watch = isYes(raw.must_watch);
  record.favorite = isYes(raw.favorite);
  record.media = mediaForIndustry(record.industry);
  record.media_hint = mediaOf(record.industry);

  // Unmatchable without at least one key, and unusable without a name.
  if (record.tmdb_id === null && !record.og_title && !record.name) return null;
  return record;
}

// One collapse in the terms the sheet is edited in. The key is the diagnosis: "id:550" is a pasted id, "t:ved|2022" is an agreeing title and year.
function describeCollapse(dropped, kept, key) {
  const pick = row => ({
    name: row.name,
    og_title: row.og_title,
    year: row.year,
    tmdb_id: row.tmdb_id,
    industry: row.industry,
    genre: row.genre
  });
  return {
    key,
    // A shared id and a shared title+year are different mistakes, so they get different sentences.
    reason: key.startsWith("id:")
      ? `both rows carry TMDB id ${key.slice(3)}`
      : `both rows normalise to "${key.slice(2)}" (title|year)`,
    dropped: pick(dropped),
    kept: pick(kept)
  };
}

class WatchedLibrary {
  constructor() {
    this.rows = [];
    this.byId = new Map();
    this.byKey = new Map();
    this.byTitle = new Map();
    this.watchedAny = new Set();
    this.loadedAt = 0;
    this.lastError = null;
    this.fromSnapshot = false;
  }

  // Synchronous, so it can run before the first paint; the live read replaces it moments later.
  hydrate() {
    if (this.rows.length) return true;
    const rows = snapshot.load("watched");
    if (!rows) return false;
    this.install(rows);
    this.fromSnapshot = true;
    return true;
  }

  async load() {
    try {
      const raw = await fetchTab("watched");
      this.install(raw.map(shape).filter(Boolean));
      this.fromSnapshot = false;
      snapshot.save("watched", this.rows);
      return true;
    } catch (error) {
      // A snapshot already on screen is better than an error over the top of it.
      if (!this.rows.length) this.lastError = error.message;
      return this.rows.length > 0;
    }
  }

  install(rows) {
    const byId = new Map();
    const byKey = new Map();
    const byTitle = new Map();
    const pooled = new Set();

    for (const record of rows) {
      // Title AND year, for every row: ved|2022 is all the two Ved records have in common.
      for (const key of indexKeys(record)) if (!byKey.has(key)) byKey.set(key, record);

      if (record.tmdb_id !== null) {
        if (!byId.has(record.tmdb_id)) byId.set(record.tmdb_id, record);
        pooled.add(record.tmdb_id);
      } else {
        // Only rows without an id are indexed by title - indexing every row that way marked every "The Call" watched.
        const key = normaliseTitle(record.og_title || record.name);
        if (key && !byTitle.has(key)) byTitle.set(key, record);
      }
    }

    this.rows = rows;
    this.byId = byId;
    this.byKey = byKey;
    this.byTitle = byTitle;
    this.watchedAny = pooled;
    this.loadedAt = Date.now();
    this.lastError = null;
  }

  // Three rungs, cheapest and most certain first: the id, then title AND year, then the bare title for id-less rows only.
  match(tmdbId, originalTitle = "", title = "", record = null) {
    const wanted = mediaWanted(record);

    if (tmdbId != null) {
      const hit = this.byId.get(Number(tmdbId));
      if (hit && mediaCompatible(hit.media_hint, wanted)) return { row: hit, via: "tmdb_id" };
    }

    const probe = record || { title, original_title: originalTitle };
    for (const key of lookupKeys(probe)) {
      const hit = this.byKey.get(key);
      if (hit && mediaCompatible(hit.media_hint, wanted)) return { row: hit, via: "title_year" };
    }

    for (const candidate of [originalTitle, title]) {
      const key = normaliseTitle(candidate);
      if (key && this.byTitle.has(key)) return { row: this.byTitle.get(key), via: "og_title" };
    }
    return null;
  }

  // Same shape as watchlist.find(), so either library answers "is this in here".
  find(value) {
    const record = asRecord(value);
    if (!record) return null;
    const found = this.match(idOf(record), record.original_title || record.og_title || "",
      record.title || record.name || "", record);
    return found ? found.row : null;
  }

  annotate(item) {
    const found = this.match(idOf(item), item.original_title, item.title, item);
    if (!found) {
      item.watched = false;
      item.must_watch = false;
      item.favorite = false;
      item.sheet_id = null;
      return item;
    }
    item.watched = true;
    // The id of the row that ACTUALLY sits in the sheet, which is not the card's id when TMDB holds the film twice.
    item.sheet_id = found.row.tmdb_id;
    item.watched_via = found.via;
    item.watched_name = found.row.name || found.row.og_title;
    item.watched_source = found.row.industry;
    item.must_watch = found.row.must_watch;
    item.favorite = found.row.favorite;
    return item;
  }

  annotateAll(items) {
    return items.map(item => this.annotate(item));
  }

  industries() {
    const counts = {};
    for (const row of this.rows) {
      if (row.industry) counts[row.industry] = (counts[row.industry] || 0) + 1;
    }
    return orderCategories(counts);
  }

  // Every genre in the sheet, or only those already used within one industry - a Bollywood row has never been tagged "Western".
  genres(industry) {
    const wanted = industry ? cleanLabel(industry) : "";
    const counts = {};
    for (const row of this.rows) {
      if (wanted && row.industry !== wanted) continue;
      for (const genre of splitGenres(row.genre)) counts[genre] = (counts[genre] || 0) + 1;
    }
    return orderCategories(counts);
  }

  // --- keeping memory in step with a write, only after the bridge confirms ---

  applyAdd(record) {
    const row = Object.assign(blankRow(), record);
    row.industry = cleanLabel(row.industry);
    row.tmdb_id = parseId(row.tmdb_id);
    row.year = parseId(row.year);
    row.media = mediaForIndustry(row.industry);
    row.media_hint = mediaOf(row.industry);
    row.must_watch = Boolean(row.must_watch);
    row.favorite = Boolean(row.favorite);

    // Already watched under one of its identities: set the flags on that row rather than adding a second.
    const existing = this.find(row);
    if (existing) {
      return this.applyFlags(existing.tmdb_id, row.must_watch, row.favorite) || existing;
    }

    this.rows.push(row);
    for (const key of indexKeys(row)) if (!this.byKey.has(key)) this.byKey.set(key, row);
    if (row.tmdb_id !== null) {
      this.byId.set(row.tmdb_id, row);
      this.watchedAny.add(row.tmdb_id);
    } else {
      const key = normaliseTitle(row.og_title || row.name);
      if (key) this.byTitle.set(key, row);
    }
    snapshot.save("watched", this.rows);
    return row;
  }

  // Takes a bare id or a whole title, because the id on the card is not always the id in the sheet.
  applyFlags(target, mustWatch, favorite) {
    const row = this.find(target);
    if (!row) return null;
    if (mustWatch !== null && mustWatch !== undefined) row.must_watch = Boolean(mustWatch);
    if (favorite !== null && favorite !== undefined) row.favorite = Boolean(favorite);
    snapshot.save("watched", this.rows);
    return row;
  }

  applyRemove(tmdbId) {
    const id = Number(tmdbId);
    const before = this.rows.length;
    // install() rebuilds every index, so byKey and byTitle cannot be left pointing at a row that has gone.
    this.install(this.rows.filter(row => row.tmdb_id !== id));
    snapshot.save("watched", this.rows);
    return this.rows.length !== before;
  }

  // --- views ---------------------------------------------------------------

  library() {
    const items = [];
    const genreCounts = {};
    const unseen = firstSeen();

    for (const row of this.rows) {
      if (!unseen(row)) continue;   // a re-watch is still one title

      const genres = splitGenres(row.genre);
      for (const genre of genres) genreCounts[genre] = (genreCounts[genre] || 0) + 1;

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
        must_watch: row.must_watch,
        favorite: row.favorite,
        watched: true,
        watched_via: row.tmdb_id !== null ? "tmdb_id" : "og_title",
        watched_name: row.name || row.og_title,
        watched_source: row.industry
      });
    }

    const stats = this.stats();
    return {
      items,
      genres: orderCategories(genreCounts),
      // EVERY industry, not stats.categories - that counts films only, so "Web Series" never reached the dropdown.
      categories: this.industries(),
      series_categories: stats.series_categories,
      stats
    };
  }

  stats() {
    const movieCounts = {};
    const seriesCounts = {};
    let movies = 0;
    let series = 0;
    // The library counts DISTINCT TITLES and the sheet counts ROWS; ?dupes=1 names the difference.
    const duplicates = [];
    const counted = firstSeen((row, kept, key) => duplicates.push(describeCollapse(row, kept, key)));
    let mustWatch = 0;
    let favorites = 0;

    for (const row of this.rows) {
      if (!counted(row)) continue;

      if (row.media === TV) {
        series++;
        if (row.industry) seriesCounts[row.industry] = (seriesCounts[row.industry] || 0) + 1;
      } else {
        movies++;
        if (row.industry) movieCounts[row.industry] = (movieCounts[row.industry] || 0) + 1;
      }

      if (row.must_watch) mustWatch++;
      if (row.favorite) favorites++;
    }

    const categories = orderCategories(movieCounts);
    const seriesCategories = orderCategories(seriesCounts);

    return {
      total_rows: this.rows.length,
      // total_rows minus duplicates.length, so the gap is a number the page can show rather than one you work out.
      distinct: movies + series,
      duplicates,
      movies,
      series,
      must_watch: mustWatch,
      favorites,
      categories,
      series_categories: seriesCategories,
      category_line: formatCategories(categories),
      series_category_line: formatCategories(seriesCategories),
      with_tmdb_id: this.watchedAny.size,
      loaded_at: this.loadedAt,
      loaded: this.rows.length > 0,
      error: this.lastError,
      warning: this.warning()
    };
  }

  // A sheet can load perfectly and still be half unusable.
  warning() {
    if (!this.rows.length) return null;
    if (!this.watchedAny.size) {
      return "No row has a TMDB id, so nothing can be matched by id. Fill in the Tmdb Id column.";
    }
    const seriesRows = this.rows.filter(row => row.media === TV);
    if (seriesRows.length && !seriesRows.some(row => row.tmdb_id !== null)) {
      return "No series row has a TMDB id, so watched series will not be recognised.";
    }
    return null;
  }
}

export const watched = new WatchedLibrary();
