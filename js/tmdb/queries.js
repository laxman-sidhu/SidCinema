// Every call shape the app makes against TMDB.

import { PAGES_PER_REQUEST, ENRICH_LIMIT, POSTER_SIZE } from "../config.js";
import { today, mapLimit, normaliseTitle } from "../core/util.js";
import * as tmdb from "./client.js";

const { MOVIE, TV } = tmdb;

const TITLE_RESULT_LIMIT = 24;
const RELATED_LIMIT = 20;

export async function discover(options = {}) {
  const media = tmdb.cleanMedia(options.media);
  const isTv = media === TV;
  const dateField = isTv ? "first_air_date" : "primary_release_date";

  const params = { include_adult: "false", language: "en-US" };
  if (!isTv) params.include_video = "false";

  const ids = await tmdb.genreIdsFor(options.genreNames || [], media);
  if (ids.length) params.with_genres = ids.join(",");

  // Language and country over-filter each other, so language wins.
  if (options.language) {
    params.with_original_language =
      tmdb.LANGUAGE_CODES[String(options.language).toLowerCase()] || String(options.language).slice(0, 2).toLowerCase();
  } else if (options.country) {
    params.with_origin_country = String(options.country).slice(0, 2).toUpperCase();
  }

  if (options.company) {
    const found = isTv ? await tmdb.networkId(options.company) : await tmdb.companyId(options.company);
    if (found) params.with_companies = String(found);
  }

  // A COMMA is an AND on TMDB and a pipe is an OR, so with_cast=976,85034 is the whole feature. /discover/tv has no people parameter at all.
  const people = (options.withPeople || []).map(Number).filter(Boolean);
  if (people.length && !isTv) {
    params[options.crewToo ? "with_people" : "with_cast"] = people.join(",");
  }

  if (options.keywords && options.keywords.length) {
    const resolved = [];
    for (const word of options.keywords) {
      const id = await tmdb.keywordId(word);
      if (id) resolved.push(String(id));
    }
    if (resolved.length) params.with_keywords = resolved.join("|");
  }

  if (options.year) params[isTv ? "first_air_date_year" : "primary_release_year"] = options.year;
  if (options.yearFrom) params[`${dateField}.gte`] = `${options.yearFrom}-01-01`;
  if (options.yearTo) params[`${dateField}.lte`] = `${options.yearTo}-12-31`;

  const regional = tmdb.isRegional(options.language);
  const sort = options.sort;

  // No vote floor on top of an AND: a co-star list is a handful of films and a 300-vote floor empties it, so the caller sorts client-side.
  const peopleFiltered = people.length > 0 && !isTv;

  if (peopleFiltered) {
    params.sort_by = "popularity.desc";
  } else if (sort === "rating") {
    params.sort_by = "vote_average.desc";
    params["vote_count.gte"] = regional ? tmdb.MIN_VOTES_RATING_REGIONAL : tmdb.MIN_VOTES_RATING;
  } else if (sort === "newest") {
    params.sort_by = `${dateField}.desc`;
    params["vote_count.gte"] = regional ? tmdb.MIN_VOTES_DATE_REGIONAL : tmdb.MIN_VOTES_DATE;
    if (!params[`${dateField}.lte`]) params[`${dateField}.lte`] = today();
  } else if (sort === "oldest") {
    params.sort_by = `${dateField}.asc`;
    params["vote_count.gte"] = regional ? tmdb.MIN_VOTES_DATE_REGIONAL : tmdb.MIN_VOTES_DATE;
  } else if (sort === "revenue" && !isTv) {
    params.sort_by = "revenue.desc";
  } else {
    params.sort_by = "popularity.desc";
  }

  // A rating floor without a vote floor is meaningless - a single 10/10 vote would outrank a classic.
  if (options.minRating && !peopleFiltered) {
    params["vote_average.gte"] = options.minRating;
    params["vote_count.gte"] = Math.max(
      Number(params["vote_count.gte"] || 0),
      regional ? tmdb.MIN_VOTES_RATING_REGIONAL : tmdb.MIN_VOTES_RATING
    );
  }

  const { results, exhausted } = await tmdb.getPages(
    `/discover/${media}`, params, options.pages || PAGES_PER_REQUEST, options.startPage || 1
  );
  const items = await tmdb.pack(results, media);
  items.exhausted = exhausted;
  return items;
}

// --- titles -----------------------------------------------------------------

export async function searchTitles(title, media = MOVIE, limit = TITLE_RESULT_LIMIT) {
  if (!title) return [];
  const kind = tmdb.cleanMedia(media);
  const { results } = await tmdb.getPages(`/search/${kind}`, {
    query: title, include_adult: "false", language: "en-US"
  }, 2);
  const items = await tmdb.pack(results, kind);
  return items.slice(0, limit);
}

function isExactTitle(item, query) {
  const wanted = normaliseTitle(query);
  if (!wanted) return false;
  return normaliseTitle(item.title) === wanted || normaliseTitle(item.original_title) === wanted;
}

export function hasExactTitle(items, ...queries) {
  return items.some(item => queries.some(query => query && isExactTitle(item, query)));
}

export async function similarTitles(itemId, media = MOVIE) {
  const kind = tmdb.cleanMedia(media);
  const [similar, recommended] = await Promise.all([
    tmdb.get(`/${kind}/${itemId}/similar`, { language: "en-US" }).catch(() => ({ results: [] })),
    tmdb.get(`/${kind}/${itemId}/recommendations`, { language: "en-US" }).catch(() => ({ results: [] }))
  ]);
  const items = await tmdb.pack([...(recommended.results || []), ...(similar.results || [])], kind);
  return items.slice(0, RELATED_LIMIT);
}

// A title search appends titles related to its top match, flagged so the UI can section them separately.
export async function titleSearch(query, media = MOVIE, { withRelated = true } = {}) {
  const matches = await searchTitles(query, media);
  if (!matches.length) return { seed: null, items: [] };

  const seed = matches[0];
  if (!withRelated) return { seed, items: matches };

  let related = [];
  try {
    const seen = new Set(matches.map(item => item.id));
    related = (await similarTitles(seed.id, media))
      .filter(item => !seen.has(item.id))
      .map(item => ({ ...item, related: true }));
  } catch {
    // Related titles are a bonus. A search that found its title still worked.
  }
  return { seed, items: [...matches, ...related] };
}

// The first genre TMDB gives this title, for a card that arrived without any - a blank Genre column drops out of every filter later.
export async function firstGenre(itemId, media = MOVIE) {
  if (!itemId) return "";
  try {
    const payload = await tmdb.get(`/${tmdb.cleanMedia(media)}/${itemId}`, { language: "en-US" });
    const first = (payload.genres || [])[0];
    return first && first.name ? String(first.name) : "";
  } catch {
    return "";
  }
}

// --- people -----------------------------------------------------------------

function asPerson(raw, fallbackName = "") {
  return {
    id: Number(raw.id),
    name: raw.name || fallbackName,
    profile: tmdb.profileUrl(raw.profile_path),
    known_for: raw.known_for_department || "",
    popularity: Number(raw.popularity) || 0,
    biography: (raw.biography || "").trim(),
    birthday: raw.birthday || "",
    place_of_birth: raw.place_of_birth || ""
  };
}

export async function searchPerson(name, strict = false) {
  if (!name) return null;
  const payload = await tmdb.get("/search/person", { query: name, include_adult: "false" });
  const results = payload.results || [];
  if (!results.length) return null;

  if (!strict) return asPerson(results[0], name);

  let best = null;
  let bestScore = 0;
  for (const raw of results.slice(0, 8)) {
    const score = tmdb.nameScore(name, raw.name);
    if (score > bestScore) {
      best = raw;
      bestScore = score;
    }
  }
  return best && bestScore >= tmdb.PERSON_CONFIDENCE ? asPerson(best, name) : null;
}

export async function personById(personId) {
  if (!personId) return null;
  try {
    const payload = await tmdb.get(`/person/${personId}`, { language: "en-US" });
    return asPerson(payload);
  } catch {
    return null;
  }
}

const TV_LEAD_JOBS = new Set(["Director", "Creator", "Executive Producer", "Series Director"]);

async function personCredits(personId, role = null, media = MOVIE) {
  const kind = tmdb.cleanMedia(media);
  const payload = await tmdb.get(`/person/${personId}/${kind}_credits`, { language: "en-US" });

  const cast = payload.cast || [];
  const crew = payload.crew || [];

  let raw;
  if (role === "director") {
    raw = crew.filter(entry =>
      kind === TV ? TV_LEAD_JOBS.has(entry.job) : entry.job === "Director");
  } else if (role === "actor") {
    raw = cast;
  } else {
    raw = [...cast, ...crew];
  }

  const items = await tmdb.pack(raw, kind);
  return items.sort((a, b) => {
    // Lead roles first, then popularity: an uncredited cameo should not head a filmography.
    const aLead = a.order !== null && a.order <= 3 ? 0 : 1;
    const bLead = b.order !== null && b.order <= 3 ? 0 : 1;
    if (aLead !== bLead) return aLead - bLead;
    return b.popularity - a.popularity;
  });
}

export async function personFilmography(personId, role, media = MOVIE) {
  try {
    return await personCredits(personId, role, media);
  } catch {
    return [];
  }
}

// What two or more people worked on TOGETHER: the only way for series, and the safety net for films. An empty intersection stays empty, because the union answers a different question.
export async function sharedFilmography(personIds, role = null, media = MOVIE) {
  const ids = [...new Set((personIds || []).map(Number).filter(Boolean))];
  if (ids.length < 2) return [];

  const lists = await Promise.all(ids.map(id => personFilmography(id, role, media)));
  if (lists.some(list => !list.length)) return [];

  const [first, ...rest] = lists;
  const sets = rest.map(list => new Set(list.map(item => item.id)));
  return first
    .filter(item => sets.every(set => set.has(item.id)))
    .sort((a, b) => b.popularity - a.popularity);
}

// --- feeds ------------------------------------------------------------------

export async function popularTitles(media = MOVIE) {
  const kind = tmdb.cleanMedia(media);
  const { results } = await tmdb.getPages(`/${kind}/popular`, { language: "en-US" });
  return tmdb.pack(results, kind);
}

export async function topRatedTitles(media = MOVIE) {
  const kind = tmdb.cleanMedia(media);
  const { results } = await tmdb.getPages(`/${kind}/top_rated`, { language: "en-US" });
  return tmdb.pack(results, kind);
}

export async function trendingTitles(media = MOVIE, window = "week") {
  const kind = tmdb.cleanMedia(media);
  const payload = await tmdb.get(`/trending/${kind}/${window}`, {});
  return tmdb.pack(payload.results || [], kind);
}

// Trending, topped up with popular titles when trending is thin.
export async function trendingFeed(media = MOVIE) {
  const kind = tmdb.cleanMedia(media);
  const trending = await trendingTitles(kind);
  if (trending.length >= 18) return trending;

  const popular = await popularTitles(kind);
  const seen = new Set(trending.map(item => item.id));
  return [...trending, ...popular.filter(item => !seen.has(item.id))];
}

// --- enrichment -------------------------------------------------------------

function needsExtras(item) {
  return !item.runtime && item.media_type === MOVIE;
}

// Runtimes cost one call per title, so only the visible top of a list is enriched.
export async function enrichDetails(items) {
  const targets = items.slice(0, ENRICH_LIMIT).filter(needsExtras);
  if (!targets.length) return items;

  await mapLimit(targets, 4, async item => {
    try {
      const payload = await tmdb.get(`/${item.media_type}/${item.id}`, { language: "en-US" });
      if (payload.runtime) item.runtime = Number(payload.runtime);
    } catch {
      // A missing runtime is a missing line of metadata, not a failure.
    }
  });
  return items;
}

// --- one title --------------------------------------------------------------

function pickTrailer(videos) {
  const results = (videos && videos.results) || [];
  const youtube = results.filter(video => video.site === "YouTube");
  const trailer = youtube.find(video => video.type === "Trailer" && video.official)
    || youtube.find(video => video.type === "Trailer")
    || youtube.find(video => video.type === "Teaser");
  return trailer ? { key: trailer.key, name: trailer.name, url: `https://www.youtube.com/watch?v=${trailer.key}` } : null;
}

function seasonList(raw) {
  return (raw.seasons || [])
    .filter(season => season.season_number > 0)
    .map(season => ({
      number: season.season_number,
      name: season.name,
      episodes: season.episode_count,
      air_date: season.air_date,
      poster: tmdb.imageUrl(season.poster_path, POSTER_SIZE)
    }));
}

export async function details(itemId, media = MOVIE) {
  const kind = tmdb.cleanMedia(media);
  const raw = await tmdb.get(`/${kind}/${itemId}`, {
    language: "en-US",
    append_to_response: "credits,videos,recommendations,similar,external_ids"
  });

  const item = await tmdb.normaliseItem(raw, kind);
  const credits = raw.credits || {};

  item.cast = (credits.cast || []).slice(0, 12).map(entry => ({
    id: entry.id,
    name: entry.name,
    character: entry.character,
    profile: tmdb.profileUrl(entry.profile_path)
  }));

  const crew = credits.crew || [];
  const leadJobs = kind === TV ? TV_LEAD_JOBS : new Set(["Director"]);
  item.directors = crew
    .filter(entry => leadJobs.has(entry.job))
    .map(entry => ({ id: entry.id, name: entry.name }));
  if (kind === TV && !item.directors.length) {
    item.directors = (raw.created_by || []).map(entry => ({ id: entry.id, name: entry.name }));
  }

  item.writers = crew
    .filter(entry => ["Writer", "Screenplay", "Story"].includes(entry.job))
    .slice(0, 4)
    .map(entry => ({ id: entry.id, name: entry.name }));

  item.trailer = pickTrailer(raw.videos);
  item.tagline = (raw.tagline || "").trim();
  item.status = raw.status || "";
  item.homepage = raw.homepage || "";
  item.imdb_id = (raw.external_ids && raw.external_ids.imdb_id) || raw.imdb_id || "";
  item.production_countries = (raw.production_countries || []).map(country => country.name);
  item.spoken_languages = (raw.spoken_languages || []).map(language => language.english_name || language.name);
  item.budget = raw.budget || null;
  item.revenue = raw.revenue || null;
  item.season_list = kind === TV ? seasonList(raw) : [];

  const recommended = (raw.recommendations && raw.recommendations.results) || [];
  const similar = (raw.similar && raw.similar.results) || [];
  item.similar = (await tmdb.pack([...recommended, ...similar], kind)).slice(0, 12);

  return item;
}
