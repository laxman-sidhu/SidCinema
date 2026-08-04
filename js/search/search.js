// The correction ladder: TMDB as typed, the People sheet, Gemini, then a loose TMDB search. It stops at the first that finds something.

import * as scope from "./scope.js";
import * as gemini from "./gemini.js";
import { heuristicScoped } from "./intent.js";
import { rewriteForMedia } from "./rewrite.js";
import { executeIntent } from "../tmdb/execute.js";
import * as tmdb from "../tmdb/client.js";
import { people } from "../data/people.js";
import { watched } from "../data/watched.js";
import { watchlist } from "../data/watchlist.js";
import { MAX_QUERY_LENGTH } from "../config.js";

function termOf(intent, chosen) {
  if (chosen === scope.PERSON) return intent.person || intent.query || "";
  return intent.title || intent.query || "";
}

function annotate(items) {
  return watchlist.annotateAll(watched.annotateAll(items));
}

async function searchOnce(query, media, locked, chosen, { strict = true, personId = null, people: nameList = null } = {}) {
  let intent;

  // Term scopes are parsed offline, not by Gemini - the user already said what they are naming.
  if (scope.TERM_SCOPES.includes(chosen)) {
    intent = heuristicScoped(query, media, chosen);
    intent.query = query;
    if (locked) intent.media = tmdb.cleanMedia(media);
  } else {
    intent = await gemini.parseQuery(query, media, { lockMedia: locked, scope: chosen });
  }

  // Every name is checked against the People tab first: free, and it fixes "sunil shetty" to "Suniel Shetty" as a side effect.
  if (intent.people && intent.people.length > 1) {
    // What the user actually typed, kept before anything rewrites it, so the correction line has something to compare against.
    intent.people_typed = [...intent.people];
    intent.person_ids = intent.people.map(name => {
      const known = people.exact(name) || people.correct(name);
      return known && known.tmdb_id ? known.tmdb_id : null;
    });
    const spelled = intent.people.map(name => {
      const known = people.exact(name) || people.correct(name);
      return known ? known.name : name;
    });
    if (spelled.some((name, index) => name !== intent.people[index])) {
      intent.people_resolved = spelled;
      intent.people = spelled;
    }
  }

  // A name spelled correctly and already in my own list needs no lookup: the sheet carries its TMDB id.
  if (chosen === scope.PERSON) {
    if (personId) {
      intent.person_id = personId;
    } else {
      const known = people.exact(intent.person || query);
      if (known) {
        if (known.tmdb_id) intent.person_id = known.tmdb_id;
        // The sheet's own spelling, which is the only place that difference is visible.
        intent.person_resolved = known.name;
      }
    }
  }

  // A retry reuses the parse and replaces only the names, so the genre, era and sort survive.
  if (nameList && nameList.length > 1) {
    intent.people_typed = intent.people_typed || intent.people;
    intent.people = nameList;
    intent.person_ids = nameList.map(name => {
      const known = people.exact(name);
      return known && known.tmdb_id ? known.tmdb_id : null;
    });
  }

  intent.strict_person = strict;
  return { intent, result: await executeIntent({ ...intent }) };
}

// Better spellings, cheapest first. A generator, so a caller that stops early never pays for the model call.
async function* correctionCandidates(term, chosen) {
  const seen = new Set([term.trim().toLowerCase()]);

  if (chosen === scope.PERSON) {
    const match = people.correct(term);
    if (match && !seen.has(match.name.trim().toLowerCase())) {
      seen.add(match.name.trim().toLowerCase());
      yield { suggestion: match.name, personId: match.tmdb_id, source: "library" };
    }
  }

  const guess = await gemini.normaliseTerm(term);
  if (guess && !seen.has(guess.trim().toLowerCase())) {
    yield { suggestion: guess, personId: null, source: "model" };
  }
}

export async function runSearch({ query: rawQuery, media: rawMedia, locked = false, scope: rawScope }) {
  const media = tmdb.cleanMedia(rawMedia);
  const chosen = scope.clean(rawScope);
  const trimmed = String(rawQuery || "").trim().slice(0, MAX_QUERY_LENGTH);

  if (!tmdb.isConfigured()) {
    throw new Error("No TMDB key. Set TMDB_API_KEY in js/config.js.");
  }

  // The toggle was just used, so re-word the phrase for the media type picked.
  const query = locked ? rewriteForMedia(trimmed, media) : trimmed;

  if (!query) {
    // The phrase was nothing but format words, so flipping the toggle left nothing to search for.
    return { empty: true, hadQuery: Boolean(trimmed) };
  }

  let corrected = null;

  // TMDB's own search is fuzzy, so most of the time nothing below ever runs.
  let { intent, result } = await searchOnce(query, media, locked, chosen);

  // Compared with the spaces IN, so a difference in capitals alone stays quiet.
  if (result.items.length && intent.person_resolved) {
    const typed = (termOf(intent, chosen) || "").trim();
    const canonical = intent.person_resolved.trim();
    if (typed && canonical.toLowerCase() !== typed.toLowerCase()) {
      corrected = canonical;
    }
  }

  // Correct only the names that failed, leaving the ones that worked, and run it once more.
  if (intent.people && result.people_missing && result.people_missing.length) {
    const missing = new Set(result.people_missing.map(name => name.toLowerCase()));
    const fixed = [];
    let changed = false;

    for (const name of intent.people) {
      if (!missing.has(name.toLowerCase())) {
        fixed.push(name);
        continue;
      }
      const fromSheet = people.correct(name);
      const better = fromSheet ? fromSheet.name : await gemini.normaliseTerm(name);
      if (better && better.toLowerCase() !== name.toLowerCase()) {
        fixed.push(better);
        changed = true;
      } else {
        fixed.push(name);
      }
    }

    if (changed) {
      const retry = await searchOnce(query, media, locked, chosen, { people: fixed });
      if (retry.result.items.length) {
        intent = retry.intent;
        result = retry.result;
      }
    }
  }

  // The names the search actually ran on. Compared with spaces removed, and it says WHO, not which rung found them.
  if (result.items.length && result.people && result.people.length > 1) {
    const used = result.people.map(person => person.name);
    const flatten = list => list.join(" ").toLowerCase().replace(/[^a-z0-9]/g, "");
    const typed = intent.people_typed || intent.people || [];
    if (typed.length && flatten(used) !== flatten(typed)) {
      corrected = `${used.slice(0, -1).join(", ")} and ${used[used.length - 1]}`;
    }
  }

  // Nothing came back. Now - and only now - is it worth asking whether the phrase was mistyped.
  if (!result.items.length) {
    const attempted = scope.TERM_SCOPES.includes(chosen) ? termOf(intent, chosen) : query;

    for await (const candidate of correctionCandidates(attempted, chosen)) {
      const retry = await searchOnce(candidate.suggestion, media, locked, chosen, { personId: candidate.personId });
      // Only keep the retry if it found something: a second empty result should report the phrase the user typed.
      if (retry.result.items.length) {
        intent = retry.intent;
        result = retry.result;
        corrected = candidate.suggestion;
        break;
      }
    }
  }

  // Last resort: drop the strictness and take the closest thing TMDB had.
  if (!result.items.length && chosen === scope.PERSON) {
    const loose = await searchOnce(query, media, locked, chosen, { strict: false });
    if (loose.result.items.length) {
      intent = loose.intent;
      result = loose.result;
    }
  }

  const items = annotate(result.items);

  return {
    empty: false,
    mode: "search",
    query,
    media: result.media,
    scope: chosen,
    headline: result.headline,
    intent: result.resolved_intent,
    corrected,
    person: result.person,
    seed: result.seed,
    items
  };
}

export async function homeFeed(rawMedia) {
  const media = tmdb.cleanMedia(rawMedia);
  const { trendingFeed, enrichDetails } = await import("../tmdb/queries.js");
  const items = annotate(await enrichDetails(await trendingFeed(media)));
  return {
    empty: false,
    mode: "home",
    query: "",
    media,
    headline: `Trending ${media === "tv" ? "series" : "movies"} this week`,
    items
  };
}

export { annotate };
