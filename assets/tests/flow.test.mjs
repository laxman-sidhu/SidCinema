// End-to-end, in a real DOM. Optional: needs jsdom, which is the only
// dependency anywhere in this project.
//
//     npm install jsdom
//     node assets/tests/flow.test.mjs
//
// It skips cleanly when jsdom is absent, so the other four suites stay
// dependency-free. What it covers is the part reasoning about the code cannot:
// that a page actually paints what it should, in the order it should.

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let JSDOM;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  console.log("SKIPPED - jsdom is not installed. `npm install jsdom` to run this suite.");
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let pass = 0, fail = 0;

function boot(page) {
  const html = fs.readFileSync(path.join(ROOT, page), "utf8")
    .replace(/<link[^>]*>/g, "").replace(/<script src=[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { url: "http://localhost/" + page, pretendToBeVisual: true });
  const { window } = dom;
  const cfg = html.match(/window\.PAGE_CONFIG = (\{[\s\S]*?\});/);
  if (cfg) window.PAGE_CONFIG = eval("(" + cfg[1] + ")");

  Object.assign(globalThis, {
    window, document: window.document, localStorage: window.localStorage,
    sessionStorage: window.sessionStorage, CustomEvent: window.CustomEvent, URL,
    requestAnimationFrame: fn => setTimeout(fn, 0), performance: { now: () => Date.now() }
  });
  return window;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

const WATCHED_TAB = {
  header: ["Name","Year","Genre","Poster Link","Tmdb Id","Original Title","Industry","","Must Watch","Favorites"],
  rows: [
    ["The Call","2020","Thriller","p1","618344","The Call","Hollywood","","Yes","Yes"],
    ["3 Idiots","2009","Comedy","p2","20453","3 Idiots","Bollywood","","","Yes"],
    ["Dark","2017","Mystery","p3","70523","Dark","Web Series","","Yes",""]
  ]
};

// The read is deliberately slower than any first paint should wait for.
function stubFetch({ readDelay = 1200, writes = [] } = {}) {
  globalThis.fetch = async (u, opts) => {
    const url = String(u);
    if (url.includes("action=read")) {
      await wait(readDelay);
      return { ok: true, status: 200, json: async () => ({ ok: true, tabs: {
        watched: WATCHED_TAB,
        watchlist: { header: ["Name","Tmdb Id"], rows: [] },
        people: { header: ["Name"], rows: [] }
      } }) };
    }
    if (url.includes("script.google")) {
      writes.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, row: 2 }) };
    }
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  };
  return writes;
}

// The key carries the snapshot VERSION from js/data/snapshot.js. Bumping it
// there without bumping it here does not fail loudly: the snapshot is simply
// never found, and the page falls back to the slow path this test exists to
// prove it avoids.
function seedSnapshot(window) {
  window.localStorage.setItem("sidcinema-snapshot-watched-v2", JSON.stringify({ at: Date.now(), rows: [
    { name:"The Call", year:2020, genre:"Thriller", poster:"p1", tmdb_id:618344, og_title:"The Call", industry:"Hollywood", must_watch:true, favorite:true, media:"movie", media_hint:"movie" },
    { name:"3 Idiots", year:2009, genre:"Comedy", poster:"p2", tmdb_id:20453, og_title:"3 Idiots", industry:"Bollywood", must_watch:false, favorite:true, media:"movie", media_hint:"movie" },
    { name:"Dark", year:2017, genre:"Mystery", poster:"p3", tmdb_id:70523, og_title:"Dark", industry:"Web Series", must_watch:true, favorite:false, media:"tv", media_hint:"tv" }
  ]}));
}

async function t(name, fn) {
  try { await fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + ": " + e.message); }
}

// The lag this was written for: posters appearing, then turning green a second
// later when the Apps Script read lands. The snapshot has to beat the read.
await t("the library paints from the snapshot before the live read returns", async () => {
  const window = boot("watched.html");
  seedSnapshot(window);
  stubFetch({ readDelay: 1200 });

  const { start } = await import(`${ROOT}/js/pages/collection.js?1`);
  const run = start();
  await wait(90);

  assert.equal(window.document.querySelectorAll(".card.is-watched").length, 3,
    "cards were not green in the first frames");
  // The flag state has to be right in that first frame too, not just the green.
  assert.equal(window.document.querySelectorAll(".cardbar__btn--favorite.is-on").length, 2,
    "two favourites should be filled from the snapshot");
  assert.equal(window.document.querySelectorAll(".cardbar__btn--must.is-on").length, 2,
    "two must-watch stars should be filled from the snapshot");
  assert.ok(!window.document.querySelector("#collLoading") || window.document.querySelector("#collLoading").hidden,
    "the spinner should not show when a snapshot is already on screen");
  await run;
});

await t("the numbers follow the view, not the whole sheet", async () => {
  const window = boot("watched.html");
  seedSnapshot(window);
  stubFetch({ readDelay: 10 });

  const { start } = await import(`${ROOT}/js/pages/collection.js?2`);
  await start();

  const tiles = () => [...window.document.querySelectorAll(".stat")].map(s => ({
    n: s.querySelector(".stat__n").textContent,
    label: s.querySelector(".stat__label").textContent
  }));

  assert.equal(tiles()[0].label, "titles");
  assert.equal(tiles()[0].n, "3");

  // The pills are gone; the navbar navigates, so the view arrives in the URL.
  const mustWindow = boot("watched.html");
  seedSnapshot(mustWindow);
  mustWindow.history.replaceState({}, "", "/watched.html?view=must_watch");
  stubFetch({ readDelay: 10 });
  const again = await import(`${ROOT}/js/pages/collection.js?2b`);
  await again.start();

  const after = [...mustWindow.document.querySelectorAll(".stat")].map(s => ({
    n: s.querySelector(".stat__n").textContent,
    label: s.querySelector(".stat__label").textContent
  }));
  assert.equal(after[0].label, "must watch", "the first tile should name the view");
  assert.equal(after[0].n, "2");
  assert.ok(!after.some(x => x.label === "titles"), "the whole-sheet total has no place in a filtered view");
  assert.equal(mustWindow.document.querySelectorAll("#collGrid .card").length, 2);
  assert.match(mustWindow.document.querySelector("#collTitle").textContent, /recommending/);
});

// One tap, no menu. The tick opens the industry-and-genre dialog on the way in
// and writes straight through on the way out.
await t("the tick is a one-tap toggle, and there is no menu left", async () => {
  const window = boot("watched.html");
  seedSnapshot(window);
  window.localStorage.setItem("sidcinema-owner", JSON.stringify({ until: Date.now() + 8.64e7 }));
  const writes = stubFetch({ readDelay: 10 });

  const { start } = await import(`${ROOT}/js/pages/collection.js?3`);
  await start();

  assert.equal(window.document.querySelectorAll("[data-menu]").length, 0,
    "the three-dot trigger should be gone");
  assert.equal(window.document.querySelectorAll(".cardmenu__layer").length, 0);

  const card = [...window.document.querySelectorAll(".card")]
    .find(c => c.querySelector(".card__title").textContent === "Dark");
  const tick = card.querySelector(".cardbar__btn--watched");
  assert.ok(tick.classList.contains("is-on"), "a watched title should show a filled tick");

  tick.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);

  assert.ok(writes.some(w => w.action === "remove_watched"), "the bridge was never called");
  const toast = window.document.querySelector(".toast");
  assert.match(toast.textContent, /watched/i);
});

// Web Series is an Industry value like any other, and the dropdown filters rows.
await t("the industry dropdown lists every industry, series included", async () => {
  const window = boot("watched.html");
  stubFetch({ readDelay: 10 });

  const { start } = await import(`${ROOT}/js/pages/collection.js?5`);
  await start();

  const options = [...window.document.querySelectorAll("#collCategory option")]
    .map(o => o.value).filter(Boolean);
  assert.ok(options.includes("Web Series"),
    "Web Series was missing - stats.categories counts films only");
  assert.ok(options.includes("Hollywood") && options.includes("Bollywood"));
});

await t("each view shows three tiles, its own total first", async () => {
  const window = boot("watched.html");
  seedSnapshot(window);
  stubFetch({ readDelay: 10 });

  const { start } = await import(`${ROOT}/js/pages/collection.js?6`);
  await start();

  const tiles = () => [...window.document.querySelectorAll(".stat")].map(s =>
    s.querySelector(".stat__label").textContent);

  assert.deepEqual(tiles(), ["titles", "films", "series"]);

  const favWindow = boot("watched.html");
  seedSnapshot(favWindow);
  favWindow.history.replaceState({}, "", "/watched.html?view=favorite");
  stubFetch({ readDelay: 10 });
  const favMod = await import(`${ROOT}/js/pages/collection.js?6b`);
  await favMod.start();
  assert.deepEqual([...favWindow.document.querySelectorAll(".stat__label")].map(s => s.textContent),
    ["favourites", "films", "series"], "the cross-reference tile should be gone");
});


// The tick is the one state the whole app is built around, so it has to look it.
await t("a filled watched tick is green, not the row's muted grey", async () => {
  const window = boot("watched.html");
  seedSnapshot(window);
  stubFetch({ readDelay: 10 });

  const { start } = await import(`${ROOT}/js/pages/collection.js?7`);
  await start();

  const on = window.document.querySelectorAll(".cardbar__btn--watched.is-on");
  assert.equal(on.length, 3, "every watched card should show a filled tick");

  const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
  const rule = css.match(/\.cardbar__btn--watched\.is-on \{([^}]*)\}/);
  assert.ok(rule, "the filled tick has no rule of its own, so it inherits muted grey");
  assert.match(rule[1], /--seen/, "watched means green everywhere in this app");
});

// Facts about the machinery, not about the films.
await t("no timing or parser line is rendered anywhere", async () => {
  const window = boot("index.html");
  assert.equal(window.document.querySelectorAll("#resultsMeta, .toolbar__meta").length, 0,
    "the diagnostic line should be gone from the markup");
  const search = fs.readFileSync(path.join(ROOT, "js/search/search.js"), "utf8");
  assert.ok(!/elapsed_ms|parser:/.test(search),
    "the payload should not still carry fields nothing reads");
});


// TMDB's original_title is the title in the film's OWN script, so a Hindi film
// wrote Devanagari into a column that gets read back for matching and typed into
// by hand. Both columns take the English title now.
await t("the sheet gets the English title in both Name and Original Title", async () => {
  const window = boot("watched.html");
  const writes = stubFetch({ readDelay: 10 });
  window.localStorage.setItem("sidcinema-owner", JSON.stringify({ until: Date.now() + 8.64e7 }));

  const actions = await import(`${ROOT}/js/ui/actions.js?w1`);
  const { watched } = await import(`${ROOT}/js/data/watched.js?w1`);
  await watched.load();

  // Exactly what TMDB returns for Sapoot (1996).
  const sapoot = { id: 305899, title: "Sapoot", original_title: "\u0938\u092a\u0942\u0924",
    year: 1996, poster: "https://image.tmdb.org/t/p/w500/8ray.jpg", media_type: "movie" };

  await actions.markWatched(sapoot, { industry: "Bollywood", genre: "90s", favorite: false, must_watch: false });
  const row = writes[writes.length - 1].payload;

  assert.equal(row.name, "Sapoot");
  assert.equal(row.og_title, "Sapoot", "Original Title should not be the native script");
  assert.ok(!/[\u0900-\u097F]/.test(JSON.stringify(row)), "Devanagari reached the sheet");
  assert.equal(row.tmdb_id, 305899);
  assert.equal(row.year, 1996);
  assert.equal(row.genre, "90s");
  assert.equal(row.industry, "Bollywood");

  writes.length = 0;
  await actions.addToWatchlist(sapoot);
  assert.equal(writes[0].payload.og_title, "Sapoot", "the watchlist path must agree");
});

// Reading is untouched: rows already holding a native title still match, because
// TMDB's original_title is what gets compared against them.
await t("title matching still works for a row written in its own script", async () => {
  const { watched } = await import(`${ROOT}/js/data/watched.js?w2`);
  // A row with no TMDB id is the only kind indexed by title.
  watched.install([{ name: "Sapoot", year: 1996, genre: "", poster: "", tmdb_id: null,
    og_title: "\u0938\u092a\u0942\u0924", industry: "Bollywood", must_watch: false, favorite: false, media: "movie" }]);
  assert.ok(watched.annotate({ id: 999, title: "Sapoot", original_title: "\u0938\u092a\u0942\u0924" }).watched,
    "an old native-script row should still be recognised");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
