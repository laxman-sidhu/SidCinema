// What counts as "the same title", in one place.
//
// WHY THIS EXISTS
// A TMDB id was the whole identity, and it is not enough. TMDB holds some films
// twice: "Ved" (2022) is on the sheet as 1037690 and comes back from search as
// 913544 - same film, same poster path, two records. With the id as the only
// key the sheet said no, the card showed no watchlist state, and a second row
// was appended. One film, two rows, and neither knew about the other.
//
// So identity is: the TMDB id, OR the title and the year together.
//
// The year is not decoration. Indexing by title alone is the bug this project
// already fixed once - one watched "The Call" marked every other film of that
// name as watched. Title AND year is specific enough that a collision means two
// different films released the same year under the same name, which is rare
// enough to accept and impossible to distinguish from the sheet anyway.
//
// The one place a bare title is still used is a row that has no year at all.
// Those are filed under the loose key and only ever reachable by it, so a row
// that HAS a year can never be matched across years.

import { SERIES_INDUSTRY } from "../config.js";
import { parseId, normaliseTitle } from "../core/util.js";

export const MOVIE = "movie";
export const TV = "tv";

// "" means unknown, and unknown matches anything.
//
// A blank Industry cell genuinely says nothing: every row the site itself adds
// to the Watchlist has one, because a TMDB search result carries no industry to
// copy. Treating blank as "movie" for matching would make every series on the
// watchlist unmatchable against its own card. Blank stays blank here, and
// mediaForIndustry() keeps defaulting to "movie" for DISPLAY, where a value is
// required.
export function mediaOf(industry) {
  const text = String(industry || "").trim();
  if (!text) return "";
  return text.toLowerCase() === SERIES_INDUSTRY.trim().toLowerCase() ? TV : MOVIE;
}

// A film and a series can share a TMDB id: the two id sequences are separate and
// both start at 1, so low ids collide constantly - The Lord of the Rings is 120,
// 121 and 122. Without this a watched series hid a queued film of the same id
// from the watchlist page, silently.
export function mediaCompatible(a, b) {
  if (!a || !b) return true;
  return a === b;
}

// The media type to match a record against, whether it came from TMDB (which
// says media_type) or from the sheet (which implies it through Industry).
export function mediaWanted(record) {
  if (!record) return "";
  if (record.media_hint) return record.media_hint;
  const explicit = String(record.media_type || "").trim().toLowerCase();
  if (explicit === TV || explicit === MOVIE) return explicit;
  return mediaOf(record.industry || record.category || "");
}

export function idOf(record) {
  if (record == null) return null;
  if (typeof record !== "object") return parseId(record);
  return parseId(record.tmdb_id != null ? record.tmdb_id : record.id);
}

// Anything with an id or a title can be looked up, so callers may pass a bare
// id, a sheet row or a TMDB result and get the same treatment.
export function asRecord(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  return { id: parseId(value) };
}

function titlesOf(record) {
  return [record.og_title, record.original_title, record.name, record.title];
}

// What a SHEET ROW is filed under. One key per distinct title it carries.
export function indexKeys(row) {
  if (!row) return [];
  const year = parseId(row.year);
  const keys = [];
  for (const raw of titlesOf(row)) {
    const norm = normaliseTitle(raw);
    if (!norm) continue;
    const key = year === null ? `${norm}|` : `${norm}|${year}`;
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

// What a lookup ASKS FOR. The exact key first, then the loose one, which only
// ever reaches rows that have no year of their own.
export function lookupKeys(record) {
  if (!record) return [];
  const year = parseId(record.year);
  const keys = [];
  for (const raw of titlesOf(record)) {
    const norm = normaliseTitle(raw);
    if (!norm) continue;
    if (year !== null && !keys.includes(`${norm}|${year}`)) keys.push(`${norm}|${year}`);
    if (!keys.includes(`${norm}|`)) keys.push(`${norm}|`);
  }
  return keys;
}

// Everything the bridge needs to find this row again, whichever half survives.
// Sent with every write, so a row whose id is absent or stale is still found by
// title and year rather than being appended a second time.
export function identityPayload(record, fallbackId) {
  const source = asRecord(record) || {};
  const id = idOf(source);
  return {
    tmdb_id: id != null ? id : (fallbackId != null ? fallbackId : ""),
    name: source.name || source.title || "",
    og_title: source.og_title || source.original_title || source.name || source.title || "",
    year: source.year || ""
  };
}

// Every key a row answers to, for de-duplicating a list in place.
//
// A list is de-duplicated by "have I seen ANY of these keys before", not by one
// canonical string: the two Ved rows carry different ids, so an id-only key
// would keep both. They share t:ved|2022, and that is what collapses them into
// one card.
export function identityKeys(row) {
  const keys = [];
  const id = idOf(row);
  if (id !== null) keys.push(`id:${id}`);
  for (const key of indexKeys(row)) keys.push(`t:${key}`);
  return keys;
}

// A de-duplicator over identityKeys. seen() is true the first time a row is
// offered and false afterwards, for every key it holds.
export function firstSeen() {
  const seen = new Set();
  return row => {
    const keys = identityKeys(row);
    if (!keys.length) return true;              // nothing to key on: never a duplicate
    if (keys.some(key => seen.has(key))) return false;
    for (const key of keys) seen.add(key);
    return true;
  };
}
