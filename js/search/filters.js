// The browse filters.
//
// NOT a view over whatever the last search returned. Picking Hindi and Romance
// runs a fresh discover query across the entire catalogue, so the filters are a
// way into the millions of titles TMDB holds rather than a sieve over the twenty
// on screen.
//
// Genre options carry the genre NAME, not its id. TMDB numbers genres
// differently for movies and TV ("Action" is 28, "Action & Adventure" is 10759),
// and names let a selection survive the Movies/Series toggle.

import * as tmdb from "../tmdb/client.js";
import { discover } from "../tmdb/queries.js";
import { BROWSE_PAGES } from "../config.js";

const TV = "tv";

// Every key the browse form understands. Anything else is dropped on arrival.
const KEYS = ["genre", "language", "year", "sort", "rating"];

const OLDEST_YEAR = 1950;
const FUTURE_YEARS = 2;

const SORTS = [
  { value: "popularity", label: "Most popular" },
  { value: "rating", label: "Highest rated" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "revenue", label: "Biggest box office" }
];

const RATINGS = [
  { value: "5", label: "5+" },
  { value: "6", label: "6+" },
  { value: "7", label: "7+" },
  { value: "8", label: "8+" }
];

// Languages worth offering. The full TMDB list is ~190 entries, most of which
// have a handful of titles, and a dropdown that long is not a control.
const LANGUAGE_ORDER = [
  "hi", "en", "ta", "te", "ml", "kn", "mr", "bn", "pa", "gu",
  "ko", "ja", "zh", "es", "fr", "de", "it", "ru", "tr", "th", "ar", "fa"
];

function text(value) {
  return String(value == null ? "" : value).trim();
}

async function genreOptions(media) {
  try {
    const { list } = await tmdb.genreLookup(media);
    return list.map(genre => ({ value: genre.name, label: genre.name }));
  } catch {
    return [];
  }
}

async function languageOptions() {
  await tmdb.loadLanguageNames();
  return LANGUAGE_ORDER.map(code => ({
    value: code,
    label: tmdb.languageLabel(code)
  }));
}

function yearOptions() {
  const now = new Date().getFullYear();
  const out = [];
  for (let year = now + FUTURE_YEARS; year >= OLDEST_YEAR; year--) {
    out.push({ value: String(year), label: String(year) });
  }
  return out;
}

export async function filterOptions(media) {
  const kind = tmdb.cleanMedia(media);
  const [genres, languages] = await Promise.all([genreOptions(kind), languageOptions()]);

  return {
    noun: kind === TV ? "series" : "movies",
    groups: [
      { key: "genre", label: "Genre", all_label: "All Genres", options: genres },
      { key: "language", label: "Language", all_label: "All Languages", options: languages },
      { key: "year", label: "Year", all_label: "All Years", options: yearOptions() },
      { key: "rating", label: "Rating", all_label: "Any Rating", options: RATINGS },
      { key: "sort", label: "Sort", all_label: "Most popular", options: SORTS }
    ]
  };
}

export function cleanSelection(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const key of KEYS) {
    const value = text(raw[key]).slice(0, 40);
    if (value) out[key] = value;
  }
  return out;
}

// A sort on its own is not enough: "order the nothing I picked by popularity" is
// the home feed with extra steps.
export function isActive(selection) {
  const chosen = selection || {};
  return ["genre", "language", "year", "rating"].some(key => text(chosen[key]));
}

// A genre is handled one of three ways: it exists here and is kept; it is the
// other catalogue's name for the same thing and is rewritten; or it does not
// exist here and is removed and reported. Running the query without a genre the
// UI still shows as active reads as "the filter does nothing".
export async function resolve(selection, media) {
  const kind = tmdb.cleanMedia(media);
  const usable = { ...(selection || {}) };
  const dropped = [];

  const genre = text(usable.genre);
  if (genre) {
    const genreId = await tmdb.resolveGenre(genre, kind);
    if (genreId === null) {
      delete usable.genre;
      dropped.push("genre");
    } else {
      const canonical = await tmdb.genreNamesFor([genreId], kind);
      if (canonical.length && canonical[0] !== genre) usable.genre = canonical[0];
    }
  }

  return { selection: usable, dropped };
}

export async function browse(selection, media, { page = 1, pages = BROWSE_PAGES } = {}) {
  const kind = tmdb.cleanMedia(media);
  const genre = text(selection.genre);
  const year = text(selection.year);
  const rating = parseFloat(text(selection.rating));

  return discover({
    media: kind,
    genreNames: genre ? [genre] : null,
    language: text(selection.language) || null,
    year: /^\d+$/.test(year) ? parseInt(year, 10) : null,
    minRating: Number.isNaN(rating) ? null : rating,
    sort: text(selection.sort) || "popularity",
    startPage: page,
    pages
  });
}

export function describe(selection, media) {
  const kind = tmdb.cleanMedia(media);
  const noun = kind === TV ? "series" : "movies";
  const bits = [];

  const sort = text(selection.sort);
  if (sort === "rating") bits.push("Highest rated");
  else if (sort === "newest") bits.push("Newest");
  else if (sort === "oldest") bits.push("Oldest");
  else if (sort === "revenue") bits.push("Biggest");
  else bits.push("Popular");

  const language = text(selection.language);
  if (language) bits.push(tmdb.languageLabel(language));

  const genre = text(selection.genre);
  if (genre) bits.push(genre);

  bits.push(noun);

  const rating = text(selection.rating);
  if (rating) bits.push(`rated ${rating}+`);

  const year = text(selection.year);
  if (year) bits.push(`from ${year}`);

  return bits.join(" ");
}
