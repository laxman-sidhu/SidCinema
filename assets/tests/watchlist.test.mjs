// The watchlist identity bug, in the shape it actually shipped.
//
// The sheet below is a slice of the real one. It carries the two things that
// broke it: "Ved" sitting under TMDB's 1037690 while search returns 913544, and
// a run of low ids (120-122) that collide with TV ids because TMDB's two id
// sequences are separate and both start at 1.

import assert from "node:assert";

const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

let calls = [];

const TABS = {
  watched: {
    header: ["Name", "Year", "Genre", "Poster Link", "Tmdb Id", "Original Title", "Industry", "", "Must Watch", "Favorites"],
    rows: [
      // A series whose TMDB id is also a film's TMDB id.
      ["Some Series", "2005", "Drama", "p1", "122", "Some Series", "Web Series", "", "", ""],
      // Watched under one of TMDB's two records for this film.
      ["Sairat", "2016", "Drama", "p2", "419430", "Sairat", "Marathi", "", "", "Yes"]
    ]
  },
  watchlist: {
    header: ["Name", "Year", "Genre", "Poster Link", "Tmdb Id", "Original Title", "Industry"],
    rows: [
      ["Ved", "2022", "Marathi", "pv", "1037690", "Ved", "Marathi"],
      ["The Lord of the Rings: The Return of the King", "2003", "Hollywood", "pl", "122",
        "The Lord of the Rings: The Return of the King", "Hollywood"],
      // Added from search, so the Industry cell is blank - the commonest shape
      // in the real sheet.
      ["Colony", "2026", "Action", "pc", "1375646", "Colony", ""],
      ["A Taxi Driver", "2017", "Drama", "pt", "437068", "A Taxi Driver", ""]
    ]
  },
  people: { header: ["Name", "Role", "Industry", "TMDB_ID", "TMDB_Status"], rows: [] }
};

globalThis.fetch = async (url, opts) => {
  if (String(url).includes("action=read")) {
    return { ok: true, status: 200, json: async () => ({ ok: true, tabs: TABS }) };
  }
  const body = JSON.parse(opts.body);
  calls.push(body);
  return {
    ok: true, status: 200,
    json: async () => ({ ok: true, row: 9, removed: true, removed_from_watchlist: true })
  };
};

const { watched } = await import("../../js/data/watched.js");
const { watchlist } = await import("../../js/data/watchlist.js");
const writer = await import("../../js/data/writer.js");
const actions = await import("../../js/ui/cardactions.js");

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; } catch (e) { fail++; console.log("FAIL " + name + ": " + e.message); }
};

assert.ok(await watched.load(), "watched loaded");
assert.ok(await watchlist.load(), "watchlist loaded");

// --- the bug itself --------------------------------------------------------

// The reported case: Ved is queued as 1037690, search hands back 913544, and
// the card showed no watchlist state at all.
await t("a film TMDB holds twice is recognised under either id", () => {
  const card = { id: 913544, title: "Ved", original_title: "Ved", year: 2022, media_type: "movie" };
  watchlist.annotate(card);
  assert.equal(card.watchlisted, true, "the queued row was not found");
  assert.equal(card.watchlist_id, 1037690, "the card must carry the id the SHEET holds");
});

await t("the same title is not queued twice", () => {
  const before = watchlist.rows.length;
  watchlist.applyAdd({ tmdb_id: 913544, name: "Ved", og_title: "Ved", year: 2022 });
  assert.equal(watchlist.rows.length, before, "a second row was appended for the same film");
});

await t("a write sends the title, so the bridge can match it too", async () => {
  calls = [];
  await writer.addWatchlist({ id: 913544, tmdb_id: 913544, name: "Ved", og_title: "Ved", year: 2022 });
  assert.equal(calls[0].action, "add_watchlist");
  assert.equal(calls[0].payload.name, "Ved");
  assert.equal(String(calls[0].payload.year), "2022", "no year means the bridge can only match on title");
});

// The other half: a year is what keeps title matching honest. Two different
// films called "The Call" are two films.
await t("a different year is a different film", () => {
  const card = { id: 5, title: "Ved", original_title: "Ved", year: 2018, media_type: "movie" };
  watchlist.annotate(card);
  assert.equal(card.watchlisted, false, "matched across years - this is the The Call bug");
});

await t("an unrelated title is still not on the list", () => {
  assert.equal(watchlist.annotate({ id: 999999, title: "Sholay", year: 1975 }).watchlisted, false);
});

// --- media types -----------------------------------------------------------

// TMDB movie ids and TV ids are separate sequences. The Return of the King is
// film 122; a watched series can hold 122 as well, and it used to hide the film
// from the watchlist page with no error anywhere.
await t("a watched series does not hide a queued film of the same id", () => {
  const titles = watchlist.library(watched).items.map(item => item.title);
  assert.ok(titles.some(title => title.startsWith("The Lord of the Rings")),
    "the film was filtered out by a series that merely shares its id");
});

await t("a series row does not mark a film watched", () => {
  const film = { id: 122, title: "The Lord of the Rings: The Return of the King", year: 2003, media_type: "movie" };
  assert.equal(watched.annotate(film).watched, false);
  const series = { id: 122, title: "Some Series", year: 2005, media_type: "tv" };
  assert.equal(watched.annotate(series).watched, true);
});

// Every row added from search has a blank Industry, so its media type is
// genuinely unknown and must not be guessed at.
await t("a blank Industry matches either kind", () => {
  assert.ok(watchlist.annotate({ id: 1375646, title: "Colony", year: 2026, media_type: "movie" }).watchlisted);
  assert.ok(watchlist.annotate({ id: 1375646, title: "Colony", year: 2026, media_type: "tv" }).watchlisted);
});

// --- the queue stays clean -------------------------------------------------

await t("two rows for one film are one card", () => {
  watchlist.install([...watchlist.rows,
    { name: "Ved", genre: "Drama", poster: "pv", og_title: "Ved", industry: "", tmdb_id: 913544, year: 2022, media: "movie", media_hint: "" }]);
  const cards = watchlist.library(watched).items.filter(item => item.title === "Ved");
  assert.equal(cards.length, 1, "the duplicate row got its own card");
});

await t("removing one duplicate removes them all", async () => {
  assert.equal(watchlist.matches({ id: 913544, title: "Ved", year: 2022 }).length, 2, "test setup");
  calls = [];
  await writer.removeWatchlist({ tmdb_id: 1037690, name: "Ved", og_title: "Ved", year: 2022 });
  assert.equal(watchlist.rows.filter(row => row.name === "Ved").length, 0, "a duplicate was left behind");
  assert.equal(calls[0].action, "remove_watchlist");
  assert.equal(calls[0].payload.name, "Ved", "the bridge cannot clear a duplicate it was not told about");
});

await t("something already watched is not in the queue", () => {
  watchlist.install([...watchlist.rows,
    // TMDB's other record for a film already in All Watched as 419430.
    { name: "Sairat", genre: "Drama", poster: "ps", og_title: "Sairat", industry: "", tmdb_id: 888888, year: 2016, media: "movie", media_hint: "" }]);
  const titles = watchlist.library(watched).items.map(item => item.title);
  assert.ok(!titles.includes("Sairat"), "a watched film sat in the queue under its other id");
});

// --- writing to the right row ----------------------------------------------

await t("a flag write addresses the row the SHEET holds", async () => {
  const card = { id: 999001, title: "Sairat", original_title: "Sairat", year: 2016, media_type: "movie" };
  watched.annotate(card);
  assert.equal(card.watched, true);
  assert.equal(card.sheet_id, 419430, "the card must carry the sheet's id, not TMDB's other one");
});

await t("a queued title still resolves from a bare id", () => {
  assert.ok(watchlist.has(437068));
  assert.ok(!watchlist.has(1));
});

// --- the tag is drawn ------------------------------------------------------

await t("a queued card is tagged, a watched one outranks it", () => {
  assert.match(actions.badgeMarkup({ watchlisted: true }), /card__badge--listed/);
  assert.match(actions.badgeMarkup({ watchlisted: true }), /Watchlist/);
  assert.match(actions.badgeMarkup({ watched: true, watchlisted: true }), /Watched<\/span>/);
  assert.equal(actions.badgeMarkup({}), "");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
