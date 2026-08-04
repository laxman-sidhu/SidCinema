// Identity is the TMDB id OR title AND year. TMDB holds some films twice ("Ved" is both 1037690 and 913544), and title alone once marked every "The Call" watched.

import { SERIES_INDUSTRY } from "../config.js";
import { parseId, normaliseTitle } from "../core/util.js";

export const MOVIE = "movie";
export const TV = "tv";

// "" means unknown and matches anything: a blank Industry cell says nothing, and most rows the site adds have one.
export function mediaOf(industry) {
  const text = String(industry || "").trim();
  if (!text) return "";
  return text.toLowerCase() === SERIES_INDUSTRY.trim().toLowerCase() ? TV : MOVIE;
}

// Movie and TV ids are separate sequences, so low ids collide - a watched series used to hide a queued film of the same id.
export function mediaCompatible(a, b) {
  if (!a || !b) return true;
  return a === b;
}

// The media type to match against, whether the record came from TMDB (media_type) or the sheet (Industry).
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

// Callers may pass a bare id, a sheet row or a TMDB result and get the same treatment.
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

// What a lookup asks for: the exact key first, then the loose one, which only ever reaches rows with no year.
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

// Sent with every write, so a row whose id is absent or stale is still found by title and year.
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

// De-duplicating needs "have I seen ANY of these keys", not one canonical string: the two Ved rows share only t:ved|2022.
export function identityKeys(row) {
  const keys = [];
  const id = idOf(row);
  if (id !== null) keys.push(`id:${id}`);
  for (const key of indexKeys(row)) keys.push(`t:${key}`);
  return keys;
}

// seen() is true the first time a row is offered and false after. onCollapse(dropped, kept, key) reports what was swallowed.
export function firstSeen(onCollapse) {
  const seen = new Map();
  return row => {
    const keys = identityKeys(row);
    if (!keys.length) return true;              // nothing to key on: never a duplicate
    const clash = keys.find(key => seen.has(key));
    if (clash !== undefined) {
      if (onCollapse) onCollapse(row, seen.get(clash), clash);
      return false;
    }
    for (const key of keys) seen.set(key, row);
    return true;
  };
}
