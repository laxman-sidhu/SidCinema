// Turns an intent into results. The scope decides the endpoint before any guessing happens.

import * as tmdb from "./client.js";
import * as q from "./queries.js";
import * as scope from "../search/scope.js";

const { MOVIE, TV } = tmdb;

function noun(media) {
  return media === TV ? "Series" : "Movies";
}

// Credit endpoints cannot filter by genre, so it happens here; an empty filter result returns the unfiltered set.
function filterByGenre(items, genreNames) {
  if (!genreNames || !genreNames.length) return items;
  const wanted = genreNames.map(name => String(name).toLowerCase());
  const kept = items.filter(item =>
    (item.genres || []).some(genre => wanted.includes(String(genre).toLowerCase())));
  return kept.length ? kept : items;
}

function applySort(items, sort) {
  const list = [...items];
  if (sort === "rating") return list.sort((a, b) => b.rating - a.rating || b.vote_count - a.vote_count);
  if (sort === "newest") return list.sort((a, b) => String(b.release_date || "").localeCompare(String(a.release_date || "")));
  if (sort === "oldest") return list.sort((a, b) => {
    const left = a.release_date || "9999";
    const right = b.release_date || "9999";
    return left.localeCompare(right);
  });
  return list;
}

function genresOf(intent) {
  if (intent.genres && intent.genres.length) return intent.genres;
  return intent.genre ? [intent.genre] : [];
}

function yearFilter(items, intent) {
  if (!intent.year && !intent.year_from && !intent.year_to) return items;
  const kept = items.filter(item => {
    if (!item.year) return false;
    if (intent.year) return item.year === intent.year;
    if (intent.year_from && item.year < intent.year_from) return false;
    if (intent.year_to && item.year > intent.year_to) return false;
    return true;
  });
  return kept.length ? kept : items;
}

// --- the scopes -------------------------------------------------------------

async function resolvePerson(intent, media) {
  if (intent.person_id) {
    const byId = await q.personById(intent.person_id);
    if (byId) return byId;
  }
  const name = intent.person || intent.query || "";
  if (!name) return null;
  return q.searchPerson(name, intent.strict_person !== false);
}

// Names to TMDB people in parallel, in the order typed. Strict first then loose, and a name matching nobody is reported rather than dropped.
async function resolvePeople(intent, media) {
  const names = (intent.people || []).map(name => String(name || "").trim()).filter(Boolean);
  const ids = intent.person_ids || [];

  const found = await Promise.all(names.map(async (name, index) => {
    const known = ids[index];
    if (known) {
      const byId = await q.personById(known);
      if (byId) return { name, person: byId };
    }
    const strict = await q.searchPerson(name, true);
    if (strict) return { name, person: strict };
    const loose = intent.strict_person === false ? await q.searchPerson(name, false) : null;
    return { name, person: loose };
  }));

  const people = [];
  const missing = [];
  const seen = new Set();

  for (const entry of found) {
    if (!entry.person) {
      missing.push(entry.name);
      continue;
    }
    if (seen.has(entry.person.id)) continue;   // the same name typed twice
    seen.add(entry.person.id);
    people.push(entry.person);
  }
  return { people, missing };
}

// What ALL of these people worked on. /discover is one request but movies-only and billed cast only, so the credit intersection covers the rest.
async function runPeopleScope(intent, genres, media) {
  const { people, missing } = await resolvePeople(intent, media);

  // Only one name resolved, so their own filmography beats an empty page and the headline says whose it is.
  if (people.length < 2) {
    if (!people.length) return { people: [], missing, items: [] };
    const single = { ...intent, person_id: people[0].id, person: people[0].name };
    const found = await runPersonScope(single, genres, media);
    return { people, missing, items: found.items, person: found.person };
  }

  const ids = people.map(person => person.id);
  let items = [];

  if (media !== TV) {
    items = await q.discover({
      media,
      withPeople: ids,
      // A director-and-actor pairing is a crew credit on one side, and with_cast would never see it.
      crewToo: intent.role === "director" || !intent.role,
      genreNames: genres,
      year: intent.year,
      yearFrom: intent.year_from,
      yearTo: intent.year_to,
      pages: 3
    });
  }

  // No discover for series and billed-cast-only for films, so the intersection is the rule rather than the exception.
  if (items.length < 2) {
    const shared = await q.sharedFilmography(ids, intent.role || null, media);
    if (shared.length > items.length) items = filterByGenre(shared, genres);
  }

  items = yearFilter(items, intent);
  items = applySort(items, intent.sort || "popularity");
  return { people, missing, items };
}

async function runPersonScope(intent, genres, media) {
  const person = await resolvePerson(intent, media);
  if (!person) return { person: null, items: [] };

  let items = await q.personFilmography(person.id, intent.role || null, media);
  items = filterByGenre(items, genres);
  items = yearFilter(items, intent);
  if (intent.sort) items = applySort(items, intent.sort);
  return { person, items };
}

async function runTitleScope(intent, genres, media) {
  const wanted = intent.title || intent.query || "";
  if (!wanted) return { seed: null, items: [] };

  if (intent.intent === "similar") {
    const matches = await q.searchTitles(wanted, media);
    if (!matches.length) return { seed: null, items: [] };
    const seed = matches[0];
    const items = filterByGenre(await q.similarTitles(seed.id, media), genres);
    return { seed, items };
  }

  const { seed, items } = await q.titleSearch(wanted, media);
  return { seed, items: filterByGenre(items, genres) };
}

// Discover with progressively looser filters: a four-way AND often returns nothing, and empty is a worse answer than broader.
async function discoverWithFallbacks(intent, genres, media) {
  const base = {
    media,
    genreNames: genres,
    language: intent.language,
    country: intent.country,
    company: intent.company,
    keywords: intent.keywords,
    year: intent.year,
    yearFrom: intent.year_from,
    yearTo: intent.year_to,
    minRating: intent.min_rating,
    sort: intent.sort
  };

  const attempts = [base];
  if (base.keywords && base.keywords.length) attempts.push({ ...base, keywords: null });
  if (base.company) attempts.push({ ...base, keywords: null, company: null });
  if (base.year || base.yearFrom) attempts.push({ ...base, keywords: null, company: null, year: null, yearFrom: null, yearTo: null });
  if (base.language && genres.length) attempts.push({ ...base, keywords: null, company: null, language: null });

  for (const attempt of attempts) {
    const items = await q.discover(attempt);
    if (items.length >= 4) return items;
    if (items.length && attempt === attempts[attempts.length - 1]) return items;
  }
  return [];
}

async function runDiscoverScope(intent, genres, media) {
  return discoverWithFallbacks(intent, genres, media);
}

// --- the headline -----------------------------------------------------------

// "Akshay Kumar and Suniel Shetty", "A, B and C".
function nameList(people) {
  const names = people.map(person => person.name);
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function headlineFor(intent, person, seed, people) {
  const kind = intent.intent;
  const media = tmdb.cleanMedia(intent.media);
  const chosen = scope.clean(intent.scope);
  const word = noun(media);

  // Named people outrank every other rule, and must come before the scope branches, which know nothing about multiple subjects.
  if (people) {
    if (people.length > 1) {
      const bits = [];
      if (intent.sort === "rating") bits.push("Best");
      bits.push(...genresOf(intent));
      bits.push(word.toLowerCase());
      bits.push(`with ${nameList(people)}`);
      const line = bits.join(" ").trim();
      return line[0].toUpperCase() + line.slice(1);
    }
    if (!people.length) {
      const wanted = (intent.people || []).join(" and ");
      return wanted ? `Nobody on TMDB matches \u201c${wanted}\u201d` : "No such person";
    }
    // Exactly one resolved, so this is one filmography now and the headline names whose.
  }

  // A scoped search that found nothing has to say WHAT it looked for, or the empty screen reads as broken.
  if (chosen === scope.PERSON && !person) {
    const wanted = intent.person || intent.query || "";
    return wanted ? `Nobody on TMDB matches \u201c${wanted}\u201d` : "No such person";
  }

  if (chosen === scope.TITLE) {
    const wanted = intent.title || intent.query || "";
    if (!seed) return wanted ? `No ${word.toLowerCase()} on TMDB called \u201c${wanted}\u201d` : `No ${word.toLowerCase()} found`;
    if (kind === "similar") return `Similar to ${seed.title}`;
    return `${word} matching \u201c${wanted}\u201d`;
  }

  if ((kind === "person_movies" || kind === "people_movies") && person) {
    let verb;
    if (intent.role === "director") verb = media === TV ? "Created by" : "Directed by";
    else if (intent.role === "actor") verb = "Starring";
    else verb = `${word} with`;
    return `${verb} ${person.name}`;
  }

  if (kind === "similar" && seed) return `Similar to ${seed.title}`;

  if (kind === "search") {
    const wanted = intent.query || intent.title;
    if (wanted) return `${word} matching \u201c${wanted}\u201d`;
  }

  if (kind === "trending") return `Trending ${word.toLowerCase()} this week`;
  if (kind === "popular") return `Popular ${word.toLowerCase()} right now`;
  if (kind === "top_rated") return `Top rated ${word.toLowerCase()} of all time`;

  const bits = [];
  if (intent.sort === "rating") bits.push("Best");
  if (intent.language) bits.push(intent.language);
  bits.push(...genresOf(intent));
  bits.push(word.toLowerCase());
  if (intent.keywords && intent.keywords.length) bits.push("about " + intent.keywords.join(", "));
  if (intent.company) bits.push(`from ${intent.company}`);
  if (intent.year) bits.push(`(${intent.year})`);
  else if (intent.year_from) bits.push(`(${intent.year_from}-${intent.year_to || "now"})`);

  const line = bits.join(" ").trim();
  return line ? line[0].toUpperCase() + line.slice(1) : word;
}

async function result(items, media, intent, person, seed, people = null, missing = null) {
  const enriched = await q.enrichDetails(items);
  return {
    items: enriched,
    media,
    headline: headlineFor(intent, person, seed, people),
    person: person || null,
    people: people || null,
    // Names TMDB could not place, for the caller to decide whether a correction is worth trying.
    people_missing: missing || [],
    seed: seed || null,
    resolved_intent: intent
  };
}

export async function executeIntent(intent) {
  const media = tmdb.cleanMedia(intent.media);
  intent.media = media;

  const chosen = scope.clean(intent.scope);
  intent.scope = chosen;

  let kind = intent.intent || "search";
  const genres = genresOf(intent);

  // More than one name is a different question whatever the scope: under Person it is still people, under Auto it is the only sensible reading.
  const named = (intent.people || []).filter(Boolean);
  if (named.length > 1 && chosen !== scope.DISCOVER && chosen !== scope.TITLE) {
    const found = await runPeopleScope(intent, genres, media);
    return result(found.items, media, intent, found.person || null, null, found.people, found.missing);
  }

  if (chosen === scope.PERSON) {
    const { person, items } = await runPersonScope(intent, genres, media);
    return result(items, media, intent, person, null);
  }

  if (chosen === scope.TITLE) {
    const { seed, items } = await runTitleScope(intent, genres, media);
    return result(items, media, intent, null, seed);
  }

  if (chosen === scope.DISCOVER) {
    const items = await runDiscoverScope(intent, genres, media);
    return result(items, media, intent, null, null);
  }

  // Auto. Nothing said what this is, so work down from the most specific.
  let person = null;
  let seed = null;
  let items = [];

  if (kind === "person_movies" && intent.person) {
    const found = await runPersonScope(intent, genres, media);
    person = found.person;
    items = found.items;
    if (!person) {
      kind = "search";
      intent.title = intent.title || intent.person;
    }
  }

  if (!items.length && !person && kind === "similar" && intent.title) {
    const candidates = await q.searchTitles(intent.title, media);
    if (candidates.length) {
      seed = candidates[0];
      items = filterByGenre(await q.similarTitles(seed.id, media), genres);
    } else {
      kind = "search";
    }
  }

  if (!items.length && !person && kind === "search") {
    const query = intent.title || intent.person || "";
    if (query) {
      const found = await q.titleSearch(query, media);
      // A phrase matching no title exactly is more likely a person than a misspelled film.
      if (found.items.length && q.hasExactTitle(found.items, query, intent.query)) {
        seed = found.seed;
        items = found.items;
      } else {
        const maybePerson = await q.searchPerson(query, true);
        if (maybePerson) {
          person = maybePerson;
          items = filterByGenre(await q.personFilmography(maybePerson.id, intent.role || null, media), genres);
        } else if (found.items.length) {
          seed = found.seed;
          items = found.items;
        }
      }
    }
  }

  if (!items.length && !person) {
    if (kind === "trending") items = await q.trendingTitles(media);
    else if (kind === "popular") items = await q.popularTitles(media);
    else if (kind === "top_rated") items = await q.topRatedTitles(media);
  }

  // Only reached when no person or seed resolved, so this cannot replace a real filmography with unrelated popular titles.
  if (!items.length && !person && !seed) {
    items = await discoverWithFallbacks(intent, genres, media);
  }

  return result(items, media, intent, person, seed);
}

