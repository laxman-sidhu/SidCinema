// All TMDB access. Nothing above this file knows the shape of TMDB's JSON.

import {
  TMDB_API_KEY, TMDB_BASE, TMDB_TTL_MS, IMAGE_BASE,
  POSTER_SIZE, BACKDROP_SIZE, PROFILE_SIZE, PAGES_PER_REQUEST
} from "../config.js";
import { getJSON } from "../core/http.js";
import * as cache from "../core/cache.js";
import { yearFrom } from "../core/util.js";

export const MOVIE = "movie";
export const TV = "tv";

export const MIN_VOTES_RATING = 300;
export const MIN_VOTES_RATING_REGIONAL = 50;
export const MIN_VOTES_DATE = 25;
export const MIN_VOTES_DATE_REGIONAL = 8;

export class TMDBError extends Error {
  constructor(message) {
    super(message);
    this.name = "TMDBError";
  }
}

export function isConfigured() {
  return Boolean(TMDB_API_KEY);
}

export function cleanMedia(value) {
  const text = String(value || "").trim().toLowerCase();
  if ([TV, "tv", "series", "show", "shows", "web series"].includes(text)) return TV;
  return MOVIE;
}

// A v4 token goes in a header; a v3 key goes in the query string.
function authFor(url) {
  if (TMDB_API_KEY.startsWith("ey")) {
    return { url, headers: { Authorization: `Bearer ${TMDB_API_KEY}` } };
  }
  const joiner = url.includes("?") ? "&" : "?";
  return { url: `${url}${joiner}api_key=${encodeURIComponent(TMDB_API_KEY)}`, headers: {} };
}

function buildUrl(path, params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return `${TMDB_BASE}${path}${query ? `?${query}` : ""}`;
}

export async function get(path, params) {
  if (!isConfigured()) throw new TMDBError("No TMDB key. Set TMDB_API_KEY in js/config.js.");

  const key = `tmdb:${buildUrl(path, params)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const { url, headers } = authFor(buildUrl(path, params));
  let payload;
  try {
    payload = await getJSON(url, { headers });
  } catch (error) {
    throw new TMDBError(
      error.status === 401
        ? "TMDB rejected the key. Check TMDB_API_KEY in js/config.js."
        : `TMDB is not answering. ${error.message}`
    );
  }

  // An empty result set is a real answer, but not one worth remembering for
  // six hours - a title added to TMDB tomorrow should be findable tomorrow.
  const worthCaching = !(payload && Array.isArray(payload.results) && payload.results.length === 0);
  if (worthCaching) cache.set(key, payload, TMDB_TTL_MS);
  return payload;
}

export async function getPages(path, params, pages = PAGES_PER_REQUEST, startPage = 1) {
  const wanted = [];
  for (let offset = 0; offset < pages; offset++) wanted.push(startPage + offset);

  const responses = await Promise.all(
    wanted.map(page => get(path, { ...params, page }).catch(() => null))
  );

  const out = [];
  let totalPages = Infinity;
  for (const payload of responses) {
    if (!payload) continue;
    if (payload.total_pages) totalPages = Math.min(totalPages, payload.total_pages);
    for (const raw of payload.results || []) out.push(raw);
  }
  return { results: out, exhausted: startPage + pages - 1 >= totalPages };
}

// --- genres -----------------------------------------------------------------

const genreCache = new Map();

export async function genreLookup(media = MOVIE) {
  const kind = cleanMedia(media);
  if (genreCache.has(kind)) return genreCache.get(kind);

  const payload = await get(`/genre/${kind}/list`, { language: "en-US" });
  const byName = new Map();
  const byId = new Map();
  for (const genre of payload.genres || []) {
    byName.set(String(genre.name).toLowerCase(), genre.id);
    byId.set(genre.id, genre.name);
  }
  const lookup = { byName, byId, list: payload.genres || [] };
  genreCache.set(kind, lookup);
  return lookup;
}

// Aliases the TMDB genre list does not carry itself.
const GENRE_ALIASES = {
  "sci fi": "science fiction", "scifi": "science fiction", "sci-fi": "science fiction",
  romantic: "romance", romcom: "comedy", "rom com": "comedy",
  thriller: "thriller", suspense: "thriller", biopic: "history",
  kids: "family", cartoon: "animation", anime: "animation",
  superhero: "action", psychological: "thriller", "coming of age": "drama",
  "true story": "history", noir: "crime", spy: "thriller",
  musical: "music", "stand up": "comedy", docu: "documentary"
};

export async function resolveGenre(name, media = MOVIE) {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return null;

  const { byName } = await genreLookup(media);
  if (byName.has(wanted)) return byName.get(wanted);

  const alias = GENRE_ALIASES[wanted];
  if (alias && byName.has(alias)) return byName.get(alias);

  // TV has no Science Fiction genre of its own; it lives under Sci-Fi & Fantasy.
  for (const [label, id] of byName) {
    if (label.includes(wanted) || wanted.includes(label)) return id;
  }
  return null;
}

export async function genreIdsFor(names, media = MOVIE) {
  const ids = [];
  for (const name of names || []) {
    const id = await resolveGenre(name, media);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export async function genreNamesFor(ids, media = MOVIE) {
  if (!ids || !ids.length) return [];
  const { byId } = await genreLookup(media);
  return ids.map(id => byId.get(Number(id))).filter(Boolean);
}

// --- languages --------------------------------------------------------------

export const LANGUAGE_CODES = {
  hindi: "hi", english: "en", tamil: "ta", telugu: "te", malayalam: "ml",
  kannada: "kn", marathi: "mr", bengali: "bn", punjabi: "pa", gujarati: "gu",
  korean: "ko", japanese: "ja", chinese: "zh", mandarin: "zh", spanish: "es",
  french: "fr", german: "de", italian: "it", russian: "ru", turkish: "tr",
  portuguese: "pt", thai: "th", arabic: "ar", urdu: "ur", persian: "fa",
  swedish: "sv", danish: "da", norwegian: "no", dutch: "nl", polish: "pl"
};

let languageNames = null;

export async function loadLanguageNames() {
  if (languageNames) return languageNames;
  languageNames = {};
  try {
    const payload = await get("/configuration/languages", {});
    for (const entry of payload || []) {
      if (entry.iso_639_1) languageNames[entry.iso_639_1] = entry.english_name || entry.name;
    }
  } catch {
    // Labels are cosmetic. A code is a worse label than a name, not a failure.
  }
  return languageNames;
}

export function languageLabel(code) {
  if (!code) return "";
  if (languageNames && languageNames[code]) return languageNames[code];
  for (const [name, iso] of Object.entries(LANGUAGE_CODES)) {
    if (iso === code) return name[0].toUpperCase() + name.slice(1);
  }
  return String(code).toUpperCase();
}

// Regional catalogues carry far fewer votes, so the vote floors that keep a
// single 10/10 from outranking a classic have to be lower for them.
export function isRegional(language) {
  if (!language) return false;
  const code = LANGUAGE_CODES[String(language).toLowerCase()] || String(language).slice(0, 2);
  return !["en"].includes(code);
}

// --- ids for names ----------------------------------------------------------

export async function keywordId(name) {
  if (!name) return null;
  const payload = await get("/search/keyword", { query: name });
  const first = (payload.results || [])[0];
  return first ? first.id : null;
}

export async function companyId(name) {
  if (!name) return null;
  const payload = await get("/search/company", { query: name });
  const first = (payload.results || [])[0];
  return first ? first.id : null;
}

export async function networkId(name) {
  // TMDB has no /search/network, and most networks exist as companies too.
  return companyId(name);
}

// --- shaping ----------------------------------------------------------------

export function imageUrl(path, size = POSTER_SIZE) {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

export function profileUrl(path) {
  return imageUrl(path, PROFILE_SIZE);
}

function firstRuntime(value) {
  if (Array.isArray(value)) return value.length ? Number(value[0]) : null;
  return value ? Number(value) : null;
}

export async function normaliseItem(raw, media = MOVIE) {
  const kind = cleanMedia(raw.media_type || media);
  const isTv = kind === TV;

  let genres;
  let genreIds;
  if (raw.genres && raw.genres.length) {
    genres = raw.genres.map(g => g.name).filter(Boolean);
    genreIds = raw.genres.map(g => Number(g.id)).filter(id => !Number.isNaN(id));
  } else {
    genreIds = (raw.genre_ids || []).map(Number);
    genres = await genreNamesFor(genreIds, kind);
  }

  const languageCode = raw.original_language || "";
  const date = (isTv ? raw.first_air_date : raw.release_date) || "";

  // Billing order is the best signal for lead vs cameo, so it has to survive
  // normalisation. 0 is valid and must not be lost to a falsy check.
  const order = typeof raw.order === "number" ? raw.order : null;
  const creditType = order !== null ? "cast" : (raw.job || raw.department ? "crew" : null);

  return {
    id: Number(raw.id),
    media_type: kind,
    title: (isTv ? raw.name : raw.title) || raw.name || raw.title || "Untitled",
    original_title: (isTv ? raw.original_name : raw.original_title) || "",
    overview: (raw.overview || "").trim(),
    poster: imageUrl(raw.poster_path, POSTER_SIZE),
    backdrop: imageUrl(raw.backdrop_path, BACKDROP_SIZE),
    release_date: date,
    year: yearFrom(date),
    rating: Math.round((Number(raw.vote_average) || 0) * 10) / 10,
    vote_count: Number(raw.vote_count) || 0,
    popularity: Number(raw.popularity) || 0,
    language_code: languageCode,
    language: languageLabel(languageCode),
    genres,
    genre_ids: genreIds,
    runtime: firstRuntime(isTv ? raw.episode_run_time : raw.runtime),
    seasons: isTv ? raw.number_of_seasons || null : null,
    episodes: isTv ? raw.number_of_episodes || null : null,
    character: (raw.character || "").trim() || null,
    job: (raw.job || "").trim() || null,
    order,
    credit_type: creditType
  };
}

export async function pack(rawList, media) {
  const items = await Promise.all((rawList || []).map(raw => normaliseItem(raw, media)));
  return dropJunk(dedupe(items));
}

// One title can appear several times in a filmography: an actor credited both
// as a character and as "Himself", or someone who directed and also appeared.
// Keep the best billing and any directing job rather than whichever came first.
function mergeCredits(kept, other) {
  const keptOrder = kept.order;
  const otherOrder = other.order;
  if (otherOrder !== null && (keptOrder === null || otherOrder < keptOrder)) {
    kept.order = otherOrder;
    kept.character = other.character || kept.character;
  }
  if (!kept.job && other.job) kept.job = other.job;
  if (kept.credit_type !== "cast" && other.credit_type === "cast") kept.credit_type = "cast";
  return kept;
}

function dedupe(items) {
  const byId = new Map();
  for (const item of items) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? mergeCredits(existing, item) : item);
  }
  return [...byId.values()];
}

function dropJunk(items) {
  return items.filter(item => item.id && item.title && item.title !== "Untitled");
}

// Levenshtein, on names, so short enough that the O(n*m) table costs nothing.
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

export function nameScore(query, name) {
  const simplify = text => String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  const left = simplify(query);
  const right = simplify(name);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (right.startsWith(left) || left.startsWith(right)) {
    return 0.85 * (Math.min(left.length, right.length) / Math.max(left.length, right.length));
  }
  if (right.includes(left) || left.includes(right)) return 0.7;

  // A name misspelled by a letter or two is still that name, and this is the
  // commonest way a real search failed: "sunil shetty" is Suniel Shetty and
  // "maduri dixit" is Madhuri Dixit, but neither is a prefix or a substring of
  // the other, so every test above scored them zero and the person was dropped.
  //
  // Bounded by an ABSOLUTE distance, not a ratio. Two edits is a typo; four is
  // a different word, and a ratio alone would let "the call" reach "call" - the
  // exact confusion the Search by control exists to prevent.
  const distance = editDistance(left, right);
  const longest = Math.max(left.length, right.length);
  if (longest >= 6 && distance <= 2) return 1 - (distance / longest);

  return 0;
}

export const PERSON_CONFIDENCE = 0.6;
