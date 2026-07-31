// The search route, as one function. Its whole job is the order of attempts:
// TMDB as typed, then the People sheet, then Gemini, then a loose TMDB search.
// Each rung costs more than the last, and the ladder stops at the first that
// finds something, so a name the sheet knows never reaches Gemini.

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

  // Term scopes are parsed offline, not by Gemini. That is what makes the first
  // attempt free: the user already said whether they are naming a title or a
  // person, so all that is left is stripping the framing words off it.
  if (scope.TERM_SCOPES.includes(chosen)) {
    intent = heuristicScoped(query, media, chosen);
    intent.query = query;
    if (locked) intent.media = tmdb.cleanMedia(media);
  } else {
    intent = await gemini.parseQuery(query, media, { lockMedia: locked, scope: chosen });
  }

  // Every name in a co-star search, checked against my own People tab first.
  // Free, offline, and it fixes the spelling as a side effect: the sheet says
  // "Suniel Shetty", so typing "sunil shetty" resolves to the right id without
  // TMDB or the model being asked anything.
  if (intent.people && intent.people.length > 1) {
    // What the user actually typed, kept before anything rewrites it. The
    // correction line compares against this, or a name fixed by the sheet would
    // be fixed silently and the reader would never learn which spelling won.
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

  // A name spelled correctly and already in my own list needs no lookup: the
  // sheet carries its TMDB id.
  if (chosen === scope.PERSON) {
    if (personId) {
      intent.person_id = personId;
    } else {
      const known = people.exact(intent.person || query);
      if (known) {
        if (known.tmdb_id) intent.person_id = known.tmdb_id;
        // The sheet's own spelling. "shahrukh khan" resolves here without a
        // correction ever running, so this is the only place the difference is
        // visible and the caller needs it to say so.
        intent.person_resolved = known.name;
      }
    }
  }

  // A retry with corrected names reuses the parse and replaces only the names,
  // so the genre, era and sort the first pass worked out are not thrown away.
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

// Better spellings of a term, cheapest first. A generator, so a caller that
// stops at the first working correction never pays for the model call.
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

  // The toggle was just used, so re-word the phrase for the media type the user
  // picked: "Hrithik Roshan movies" + Series -> "Hrithik Roshan series".
  const query = locked ? rewriteForMedia(trimmed, media) : trimmed;

  if (!query) {
    // The phrase was nothing but format words, so flipping the toggle left
    // nothing to search for.
    return { empty: true, hadQuery: Boolean(trimmed) };
  }

  let corrected = null;

  // TMDB's own search is fuzzy, so most of the time this is the answer and
  // nothing below ever runs.
  let { intent, result } = await searchOnce(query, media, locked, chosen);

  // The phrase worked, but not as written. Compared with the spaces IN, so a
  // difference in capitals alone stays quiet.
  if (result.items.length && intent.person_resolved) {
    const typed = (termOf(intent, chosen) || "").trim();
    const canonical = intent.person_resolved.trim();
    if (typed && canonical.toLowerCase() !== typed.toLowerCase()) {
      corrected = canonical;
    }
  }

  // One or more names in a co-star search matched nobody. Correct just those,
  // leaving the ones that worked alone, and run it once more. The sheet is
  // tried before the model, same order as everywhere else - and this only runs
  // when a name has already failed, so a search that worked pays nothing.
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

  // The names the search actually ran on, when they are not the names typed.
  //
  // Compared with the spaces removed, like the single-name case, so a
  // difference in capitals or spacing alone stays quiet. It says WHO was
  // searched for and nothing about how that was worked out - which rung found
  // them is a fact about the machinery.
  if (result.items.length && result.people && result.people.length > 1) {
    const used = result.people.map(person => person.name);
    const flatten = list => list.join(" ").toLowerCase().replace(/[^a-z0-9]/g, "");
    const typed = intent.people_typed || intent.people || [];
    if (typed.length && flatten(used) !== flatten(typed)) {
      corrected = `${used.slice(0, -1).join(", ")} and ${used[used.length - 1]}`;
    }
  }

  // Nothing came back. Now - and only now - is it worth asking whether the
  // phrase was simply mistyped.
  if (!result.items.length) {
    const attempted = scope.TERM_SCOPES.includes(chosen) ? termOf(intent, chosen) : query;

    for await (const candidate of correctionCandidates(attempted, chosen)) {
      const retry = await searchOnce(candidate.suggestion, media, locked, chosen, { personId: candidate.personId });
      // Only keep the retry if it actually found something. A second empty
      // result should report the phrase the user typed, not a correction that
      // also failed.
      if (retry.result.items.length) {
        intent = retry.intent;
        result = retry.result;
        corrected = candidate.suggestion;
        break;
      }
    }
  }

  // Before reporting nothing, drop the strictness and take the closest thing
  // TMDB had. The safety net for a wrong spelling AND an unavailable correction.
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
