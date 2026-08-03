import assert from "node:assert";

// Stub the browser surface the data modules touch.
const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k,v)=>mem.set(k,String(v)), removeItem: k=>mem.delete(k) };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, };
globalThis.performance = { now: () => Date.now() };

let calls = [];
let nextWriteFails = false;

const TABS = {
  watched: {
    header: ["Name","Year","Genre","Poster Link","Tmdb Id","Original Title","Industry","","Must Watch","Favorites"],
    rows: [
      ["The Call","2020","Thriller","p1","618344","The Call","Hollywood","","Yes","Yes"],
      ["3 Idiots","2009","Comedy","p2","20453","3 Idiots","Bollywood","","","Yes"],
      ["Dark","2017","Mystery","p3","70523","Dark","Web Series","","Yes",""],
      ["Old Film","1975","Drama","p4","","Old Film","HOLLYWOOD","",""],
      ["3 Idiots","2009","Comedy","p2","20453","3 Idiots","Bollywood","","",""]
    ]
  },
  watchlist: {
    header: ["Name","Year","Genre","Poster Link","Tmdb Id","Original Title","Industry"],
    rows: [["Dune","2021","Sci-Fi","p5","438631","Dune","Hollywood"]]
  },
  people: {
    header: ["Name","Role","Industry","TMDB_ID","TMDB_Status"],
    rows: [["Shah Rukh Khan","Actor","Bollywood","35742","ok"],
           ["Hrithik Roshan","Actor","Bollywood","77225","ok"],
           ["Christopher Nolan","Director","Hollywood","525","ok"]]
  }
};

globalThis.fetch = async (url, opts) => {
  if (String(url).includes("action=read")) {
    return { ok: true, status: 200, json: async () => ({ ok: true, tabs: TABS }) };
  }
  calls.push(JSON.parse(opts.body));
  if (nextWriteFails) return { ok: false, status: 502, json: async () => ({ ok: false, error: "boom" }) };
  return { ok: true, status: 200, json: async () => ({ ok: true, row: 7, removed: true, removed_from_watchlist: true }) };
};

const { watched } = await import("../../js/data/watched.js");
const { watchlist } = await import("../../js/data/watchlist.js");
const { people } = await import("../../js/data/people.js");
const writer = await import("../../js/data/writer.js");
const auth = await import("../../js/data/auth.js");

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; } catch (e) { fail++; console.log("FAIL " + name + ": " + e.message); } };

assert.ok(await watched.load(), "watched loaded");
assert.ok(await watchlist.load(), "watchlist loaded");
assert.ok(await people.load(), "people loaded");

await t("columns found by header name, spacer ignored", () => {
  const row = watched.byId.get(618344);
  assert.equal(row.name, "The Call");
  assert.equal(row.industry, "Hollywood");
  assert.equal(row.must_watch, true);
  assert.equal(row.favorite, true);
});

await t("HOLLYWOOD recased, Web Series -> tv", () => {
  assert.equal(watched.rows.find(r => r.name === "Old Film").industry, "Hollywood");
  assert.equal(watched.byId.get(70523).media, "tv");
});

await t("a re-watch counts once", () => {
  const stats = watched.stats();
  assert.equal(stats.total_rows, 5);
  assert.equal(stats.movies + stats.series, 4);
  assert.equal(watched.library().items.length, 4);
});

await t("stats", () => {
  const s = watched.stats();
  assert.equal(s.series, 1);
  assert.equal(s.favorites, 2);
  assert.equal(s.must_watch, 2);
});

// The bug this guards: indexing every row by title once meant one watched
// "The Call" marked every other film of that name as watched.
await t("matching is by id, not title", () => {
  assert.ok(watched.annotate({ id: 618344, title: "The Call" }).watched);
  assert.ok(!watched.annotate({ id: 999999, title: "The Call" }).watched);
  // A row with no id IS reachable by title, since that is all it has.
  assert.ok(watched.annotate({ id: 888, title: "Old Film", original_title: "Old Film" }).watched);
});

await t("people: despaced exact match", () => {
  assert.equal(people.exact("shahrukh khan").name, "Shah Rukh Khan");
  assert.equal(people.exact("SHAHRUKHKHAN").tmdb_id, 35742);
});

await t("people: correction and refusal", () => {
  assert.equal(people.correct("hritik roshan").name, "Hrithik Roshan");
  assert.equal(people.correct("zzzzqqqq"), null);
});

await t("people: autocomplete tiers", () => {
  assert.equal(people.suggest("chris")[0].name, "Christopher Nolan");
  assert.equal(people.suggest("nolan")[0].name, "Christopher Nolan");
});

await t("watchlist annotate", () => {
  assert.ok(watchlist.annotate({ id: 438631 }).watchlisted);
  assert.ok(!watchlist.annotate({ id: 1 }).watchlisted);
});

// Google first, memory second.
await t("a failed write changes nothing locally", async () => {
  const before = watched.stats().total_rows;
  nextWriteFails = true;
  await assert.rejects(() => writer.addWatched(
    { id: 1234, tmdb_id: 1234, name: "New", industry: "Hollywood", genre: "Drama" }, {}));
  nextWriteFails = false;
  assert.equal(watched.stats().total_rows, before, "memory drifted after a failed write");
});

await t("a confirmed write updates memory without re-reading", async () => {
  calls = [];
  const before = watched.stats().total_rows;
  await writer.addWatched({ id: 1234, tmdb_id: 1234, name: "New", industry: "Hollywood", genre: "Drama" },
    { mustWatch: true, favorite: false });
  assert.equal(watched.stats().total_rows, before + 1);
  assert.ok(watched.annotate({ id: 1234 }).watched);
  assert.equal(watched.annotate({ id: 1234 }).must_watch, true);
  assert.equal(calls[0].action, "add_watched");
  assert.equal(calls[0].payload.must_watch, "Yes");
  assert.equal(calls[0].payload.favorite, "");
});

await t("marking watched removes from the watchlist in one call", async () => {
  calls = [];
  assert.ok(watchlist.has(438631));
  await writer.addWatched({ id: 438631, tmdb_id: 438631, name: "Dune", industry: "Hollywood", genre: "Sci-Fi" }, {});
  assert.ok(!watchlist.has(438631), "still on the watchlist");
  assert.equal(calls.length, 1, "took more than one call");
});

await t("flags are independent of each other", async () => {
  await writer.setFlags(20453, { favorite: true });
  await writer.setFlags(20453, { mustWatch: true });
  const row = watched.byId.get(20453);
  assert.equal(row.favorite, true);
  assert.equal(row.must_watch, true);
  await writer.setFlags(20453, { favorite: false });
  assert.equal(watched.byId.get(20453).favorite, false);
  assert.equal(watched.byId.get(20453).must_watch, true, "must_watch was disturbed by a favourite change");
});

await t("setFlags sends only the named flag", async () => {
  calls = [];
  await writer.setFlags(618344, { favorite: true });
  assert.ok("favorite" in calls[0].payload);
  assert.ok(!("must_watch" in calls[0].payload));
});

await t("remove drops it from memory and the index", async () => {
  await writer.removeWatched(618344);
  assert.ok(!watched.annotate({ id: 618344 }).watched);
  assert.ok(!watched.watchedAny.has(618344));
});

await t("no id means it cannot be saved", async () => {
  await assert.rejects(() => writer.addWatched({ name: "X", industry: "Hollywood" }, {}), /TMDB id/);
});

await t("industry is required", async () => {
  await assert.rejects(() => writer.addWatched({ id: 5, tmdb_id: 5, name: "X" }, {}), /industry/i);
});

await t("the gate: wrong password refused, right one persists", () => {
  assert.ok(!auth.isOwner());
  assert.equal(auth.signIn("nope").ok, false);
  assert.equal(auth.signIn("nope").reason, "wrong");
  assert.ok(!auth.isOwner(), "a refused password must not grant a session");
  assert.ok(auth.signIn("LaxSid@12345").ok);
  assert.ok(auth.isOwner());
});

// The session is the only thing that ends it, so the expiry has to actually be
// checked rather than merely written.
await t("an expired session is not an owner", () => {
  assert.ok(auth.signIn("LaxSid@12345").ok);
  assert.ok(auth.isOwner());
  mem.set("sidcinema-owner", JSON.stringify({ until: Date.now() - 1000 }));
  assert.ok(!auth.isOwner(), "an expired session still counted as signed in");
  assert.equal(mem.get("sidcinema-owner"), null, "the expired session should be cleared");
});

await t("a corrupt session is not an owner", () => {
  mem.set("sidcinema-owner", "not json");
  assert.ok(!auth.isOwner());
  mem.set("sidcinema-owner", JSON.stringify({}));
  assert.ok(!auth.isOwner(), "a session with no expiry must not count");
});

await t("industries and genres come from the sheet's own contents", () => {
  assert.ok(watched.industries().some(e => e.label === "Bollywood"));
  assert.ok(watched.genres().some(e => e.label === "Comedy"));
});


await t("genres scope to the chosen industry", async () => {
  // Earlier tests added and removed rows, so start from the fixture again.
  await watched.load();
  const all = watched.genres().map(e => e.label);
  const bolly = watched.genres("Bollywood").map(e => e.label);
  assert.ok(all.includes("Thriller") && all.includes("Comedy"));
  // Thriller only ever appears on a Hollywood row in the fixture.
  assert.ok(bolly.includes("Comedy"));
  assert.ok(!bolly.includes("Thriller"), "Bollywood offered a Hollywood-only genre");
  assert.deepEqual(watched.genres("Web Series").map(e => e.label), ["Mystery"]);
});

await t("an unknown industry scopes to nothing, so the caller can fall back", async () => {
  await watched.load();
  assert.deepEqual(watched.genres("Nollywood"), []);
});

// --- the header row is allowed to be renamed --------------------------------
// The Watchlist tab's title column was "Movie" and is now "Name". Columns are
// found by header name, so a rename is a real change to the read path and not
// a cosmetic one. These pin both spellings to the same result, and pin the
// half-done rename - both columns present - to the same column Code.gs picks.
const sheets = await import("../../js/data/sheets.js");
const ORIGINAL_HEADER = TABS.watchlist.header.slice();
const ORIGINAL_ROWS = TABS.watchlist.rows.map(r => r.slice());

async function readWatchlistWith(header, rows) {
  TABS.watchlist.header = header;
  TABS.watchlist.rows = rows;
  sheets.invalidate();
  return await sheets.fetchTab("watchlist");
}

await t("the Watchlist reads the same under \"Movie\" and under \"Name\"", async () => {
  const row = ["Dune", "2021", "Sci-Fi", "p5", "438631", "Dune", "Hollywood"];
  const rest = ORIGINAL_HEADER.slice(1);
  const asMovie = await readWatchlistWith(["Movie", ...rest], [row.slice()]);
  const asName = await readWatchlistWith(["Name", ...rest], [row.slice()]);
  assert.equal(asName[0].name, "Dune");
  assert.deepEqual(asMovie, asName, "the rename changed what the site reads");
});

await t("two columns naming one field: the first wins, as Code.gs does", async () => {
  // A rename with the old column left behind. Code.gs's columnMap() keeps the
  // first match; the site kept the last, so it read the title out of a
  // different cell than the bridge wrote to, silently.
  const rows = await readWatchlistWith(
    ["Name", "Year", "Genre", "Poster Link", "Tmdb Id", "Original Title", "Industry", "Movie"],
    [["Dune", "2021", "Sci-Fi", "p5", "438631", "Dune", "Hollywood", "STALE OLD TITLE"]]
  );
  assert.equal(rows[0].name, "Dune");
});

await t("one column still feeds one field", async () => {
  // "Title" is an alias of name and of nothing else, but the guard that stops a
  // single column being claimed twice has to survive the fix to the other one.
  const rows = await readWatchlistWith(
    ["Title", "Year", "Genre", "Poster Link", "Tmdb Id", "Original Title", "Industry"],
    [["Dune", "2021", "Sci-Fi", "p5", "438631", "Dune Part One", "Hollywood"]]
  );
  assert.equal(rows[0].name, "Dune");
  assert.equal(rows[0].og_title, "Dune Part One");
});

TABS.watchlist.header = ORIGINAL_HEADER;
TABS.watchlist.rows = ORIGINAL_ROWS;
sheets.invalidate();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
