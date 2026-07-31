// Co-star searches: "akshay kumar and sunil shetty movies".
//
// This one asserts the REQUESTS, not just the results. The whole feature is
// which endpoint gets called with which parameters - with_cast=976,85034 is the
// answer, and a test that only checked the titles came back would pass just as
// happily on a call that fetched one actor and ignored the other.

import assert from "node:assert";

const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

// --- a fake TMDB -----------------------------------------------------------

const PEOPLE = {
  "Akshay Kumar": { id: 976 },
  "Suniel Shetty": { id: 85034 },
  "Madhuri Dixit": { id: 52757 },
  "Paresh Rawal": { id: 35780 }
};

const FILMS = {
  1: { id: 1, title: "Hera Pheri", release_date: "2000-12-01", genre_ids: [35], vote_average: 8.2, vote_count: 400, popularity: 40 },
  2: { id: 2, title: "Awara Paagal Deewana", release_date: "2002-05-24", genre_ids: [35], vote_average: 6.4, vote_count: 120, popularity: 20 },
  3: { id: 3, title: "Mohra", release_date: "1994-07-01", genre_ids: [28], vote_average: 6.8, vote_count: 90, popularity: 18 },
  4: { id: 4, title: "Solo Akshay Film", release_date: "2010-01-01", genre_ids: [28], vote_average: 5.9, vote_count: 60, popularity: 30 }
};

// Who is in what, for the credit-intersection path.
const CREDITS = {
  976: [1, 2, 3, 4],
  85034: [1, 2, 3],
  52757: [3],
  35780: [1, 2]
};

let requests = [];

function urlOf(input) {
  return new URL(String(input));
}

globalThis.fetch = async input => {
  const url = urlOf(input);
  const path = url.pathname.replace("/3", "");
  const params = Object.fromEntries(url.searchParams.entries());
  requests.push({ path, params });

  const reply = body => ({ ok: true, status: 200, json: async () => body });

  if (path === "/search/person") {
    const wanted = String(params.query || "").toLowerCase();
    const hit = Object.entries(PEOPLE).find(([name]) => name.toLowerCase() === wanted);
    if (hit) return reply({ results: [{ id: hit[1].id, name: hit[0], popularity: 10 }] });
    // TMDB's own search is fuzzy: a near miss still comes back, and it is our
    // side that has to decide whether it is the same name.
    const near = Object.entries(PEOPLE).find(([name]) =>
      name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 4) === wanted.replace(/[^a-z]/g, "").slice(0, 4));
    return reply({ results: near ? [{ id: near[1].id, name: near[0], popularity: 10 }] : [] });
  }

  if (path.startsWith("/person/") && path.endsWith("_credits")) {
    const id = Number(path.split("/")[2]);
    return reply({ cast: (CREDITS[id] || []).map(film => ({ ...FILMS[film], order: 0 })), crew: [] });
  }

  if (path.startsWith("/person/")) {
    const id = Number(path.split("/")[2]);
    const entry = Object.entries(PEOPLE).find(([, value]) => value.id === id);
    return reply({ id, name: entry ? entry[0] : "Unknown" });
  }

  if (path === "/discover/movie") {
    const cast = String(params.with_cast || params.with_people || "")
      .split(",").filter(Boolean).map(Number);
    if (!cast.length) return reply({ results: [], total_pages: 1 });
    const shared = cast
      .map(id => new Set(CREDITS[id] || []))
      .reduce((left, right) => new Set([...left].filter(film => right.has(film))));
    let films = [...shared].map(id => FILMS[id]);
    if (params.with_genres) {
      const wanted = String(params.with_genres).split(",").map(Number);
      films = films.filter(film => wanted.every(genre => film.genre_ids.includes(genre)));
    }
    return reply({ results: films, total_pages: 1 });
  }

  if (path === "/genre/movie/list") {
    return reply({ genres: [{ id: 28, name: "Action" }, { id: 35, name: "Comedy" }] });
  }
  if (path === "/genre/tv/list") return reply({ genres: [] });
  if (path === "/configuration/languages") return reply([]);

  return reply({ results: [], cast: [], crew: [], total_pages: 1 });
};

const { runSearch } = await import("../../js/search/search.js");
const { splitPeople } = await import("../../js/search/intent.js");
const tmdb = await import("../../js/tmdb/client.js");

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; } catch (e) { fail++; console.log("FAIL " + name + ": " + e.message); }
};

const discovers = () => requests.filter(r => r.path === "/discover/movie");
const personSearches = () => requests.filter(r => r.path === "/search/person");
const castOf = call => String(call.params.with_cast || call.params.with_people || "");

// js/core/cache.js caches on the URL, so repeating a search makes no request at
// all. Anything asserting on REQUESTS has to ask a question that has not been
// asked yet - hence the different pairings below.

// --- the phrasing --------------------------------------------------------

await t("two names are two names, however they are joined", () => {
  assert.deepEqual(splitPeople("akshay kumar and suniel shetty movies"), ["akshay kumar", "suniel shetty"]);
  assert.deepEqual(splitPeople("akshay kumar & suniel shetty"), ["akshay kumar", "suniel shetty"]);
  assert.deepEqual(splitPeople("movies with akshay kumar, suniel shetty and madhuri dixit"),
    ["akshay kumar", "suniel shetty", "madhuri dixit"]);
});

// The guard that keeps a title from being read as a cast list.
await t("a list of words is not a list of people", () => {
  assert.deepEqual(splitPeople("The Good, the Bad and the Ugly"), []);
  assert.deepEqual(splitPeople("movies like Interstellar"), []);
  assert.deepEqual(splitPeople("bollywood action and comedy movies"), []);
});

// --- the call ------------------------------------------------------------

await t("both names go out, and the discover call ANDs them", async () => {
  requests = [];
  const found = await runSearch({ query: "akshay kumar and suniel shetty movies", media: "movie", scope: "auto" });

  const names = personSearches().map(r => r.params.query.toLowerCase()).sort();
  assert.deepEqual(names, ["akshay kumar", "suniel shetty"], "each name needs its own /search/person");

  const call = discovers()[0];
  assert.ok(call, "no discover call was made");
  assert.deepEqual(castOf(call).split(",").sort(), ["85034", "976"],
    "the two ids must travel together in one parameter");
  assert.ok(!castOf(call).includes("|"), "a pipe would return films with EITHER of them");
  assert.ok(!("vote_count.gte" in call.params),
    "a vote floor on top of an AND empties the page - a co-star list is a handful of films");

  const titles = found.items.map(item => item.title);
  assert.ok(titles.includes("Hera Pheri"));
  assert.ok(!titles.includes("Solo Akshay Film"), "a film only one of them is in came back");
});

await t("three names narrow it further", async () => {
  requests = [];
  const found = await runSearch({
    query: "akshay kumar, suniel shetty and madhuri dixit movies", media: "movie", scope: "auto"
  });
  const ids = String(discovers()[0].params.with_cast || discovers()[0].params.with_people).split(",");
  assert.equal(ids.length, 3);
  assert.deepEqual(found.items.map(item => item.title), ["Mohra"]);
});

await t("a genre rides along as a server-side filter", async () => {
  requests = [];
  const found = await runSearch({
    query: "akshay kumar and suniel shetty comedy movies", media: "movie", scope: "auto"
  });
  const call = discovers()[0];
  assert.equal(call.params.with_genres, "35", "the genre was dropped, or filtered after the fact");
  assert.ok(call.params.with_cast || call.params.with_people);
  assert.deepEqual(found.items.map(item => item.title).sort(), ["Awara Paagal Deewana", "Hera Pheri"]);
});

// "best" normally adds a 300-vote floor. On top of an AND across two names it
// returns an empty page, which is how this feature would have looked broken.
await t("best does not bring its vote floor to a co-star search", async () => {
  requests = [];
  await runSearch({ query: "best akshay kumar and paresh rawal movies", media: "movie", scope: "auto" });
  const call = discovers()[0];
  assert.ok(call, "no discover call was made");
  assert.ok(!("vote_count.gte" in call.params), "a vote floor would empty the page");
  assert.equal(call.params.sort_by, "popularity.desc",
    "the sort is applied to the returned set, not asked of TMDB");
});

await t("best sorts by rating, over the set the AND returned", async () => {
  const found = await runSearch({ query: "best akshay kumar and suniel shetty movies", media: "movie", scope: "auto" });
  assert.equal(found.items[0].title, "Hera Pheri", "the highest rated of the three should lead");
});

await t("an era still applies", async () => {
  const found = await runSearch({ query: "akshay kumar and suniel shetty 90s movies", media: "movie", scope: "auto" });
  assert.deepEqual(found.items.map(item => item.title), ["Mohra"]);
});

// --- the headline --------------------------------------------------------

await t("the headline names who it searched for", async () => {
  const found = await runSearch({ query: "akshay kumar and suniel shetty movies", media: "movie", scope: "auto" });
  assert.equal(found.headline, "Movies with Akshay Kumar and Suniel Shetty");

  const best = await runSearch({ query: "best akshay kumar and suniel shetty comedy movies", media: "movie", scope: "auto" });
  assert.equal(best.headline, "Best Comedy movies with Akshay Kumar and Suniel Shetty");
});

// --- misspelling ---------------------------------------------------------

// The reported case. TMDB spells him Suniel; nobody types it that way.
await t("a misspelled name still resolves, and the page says so", async () => {
  requests = [];
  const found = await runSearch({ query: "akshay kumar and sunil shetty movies", media: "movie", scope: "auto" });
  assert.ok(found.items.length, "the search came back empty on a one-letter typo");
  assert.equal(found.corrected, "Akshay Kumar and Suniel Shetty");
});

// The near-miss rule is bounded by an ABSOLUTE edit distance. Two edits is a
// typo; anything looser starts matching people who merely rhyme.
await t("one edit is a typo, several are a different person", () => {
  assert.ok(tmdb.nameScore("sunil shetty", "Suniel Shetty") >= tmdb.PERSON_CONFIDENCE);
  assert.ok(tmdb.nameScore("maduri dixit", "Madhuri Dixit") >= tmdb.PERSON_CONFIDENCE);
  assert.equal(tmdb.nameScore("suniel shetty", "Salman Khan"), 0);
  assert.equal(tmdb.nameScore("akshay kumar", "Akshaye Khanna"), 0,
    "two real actors, four edits apart, must not collapse into one");
});

// --- the person scope ----------------------------------------------------

await t("the Person scope takes a list too", async () => {
  const found = await runSearch({ query: "akshay kumar and suniel shetty", media: "movie", scope: "person" });
  assert.equal(found.headline, "Movies with Akshay Kumar and Suniel Shetty",
    "the Person scope fell back to a single filmography");
  assert.ok(found.items.map(item => item.title).includes("Hera Pheri"));
  assert.ok(!found.items.map(item => item.title).includes("Solo Akshay Film"));
});

// One name resolving is not the co-star search asked for, but it is a far
// better answer than a blank page - as long as the headline says whose it is.
await t("one name of two resolving still answers", async () => {
  const found = await runSearch({ query: "akshay kumar and nobody at all", media: "movie", scope: "auto" });
  assert.ok(found.items.length, "a bad second name emptied the whole search");
  assert.match(found.headline, /Akshay Kumar/);
});

// --- series --------------------------------------------------------------

// /discover/tv has no people parameter, so this must go the long way round.
await t("a series co-star search intersects credits instead", async () => {
  requests = [];
  await runSearch({ query: "akshay kumar and suniel shetty series", media: "tv", scope: "auto", locked: true });
  assert.equal(requests.filter(r => r.path === "/discover/tv").length, 0,
    "discover/tv cannot filter by person, so calling it would return everything");
  assert.equal(requests.filter(r => r.path.endsWith("/tv_credits")).length, 2);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
