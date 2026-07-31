// The navbar keeps every destination on every page and marks the current one.
// An earlier version hid the current entry, which changed the row's shape as you
// moved and told you nothing about where you were.

import assert from "node:assert";

let html = "";
const host = { set innerHTML(v) { html = v; }, get innerHTML() { return html; } };

globalThis.document = { getElementById: id => (id === "navTools" ? host : null) };
globalThis.URL = URL;
globalThis.window = { location: {} };

const { paintNav } = await import("../../js/ui/nav.js");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL " + name + ": " + e.message); } };

function at(pathname, href, options) {
  globalThis.window.location = { pathname, href };
  paintNav(options);
  return {
    labels: [...html.matchAll(/icon-btn__text">([^<]+)</g)].map(m => m[1]),
    current: (html.match(/is-current"[^>]*href="([^"]+)"/) || [])[1],
    html
  };
}

const DESTINATIONS = ["Library", "Favourites", "Must watch", "Watchlist"];

t("every page shows every destination", () => {
  for (const [path, href] of [
    ["/index.html", "http://x/index.html"],
    ["/watched.html", "http://x/watched.html"],
    ["/watched.html", "http://x/watched.html?view=favorite"],
    ["/watched.html", "http://x/watched.html?view=must_watch"],
    ["/watchlist.html", "http://x/watchlist.html"]
  ]) {
    assert.deepEqual(at(path, href).labels, DESTINATIONS, `wrong set on ${href}`);
  }
});

t("no Search entry - the wordmark is the way home", () => {
  assert.ok(!at("/watchlist.html", "http://x/watchlist.html").labels.includes("Search"));
});

t("the current page is marked, and only it", () => {
  assert.equal(at("/watched.html", "http://x/watched.html?view=must_watch").current,
    "watched.html?view=must_watch");
  assert.equal(at("/watched.html", "http://x/watched.html?view=favorite").current,
    "watched.html?view=favorite");
  assert.equal(at("/watched.html", "http://x/watched.html").current, "watched.html");
  assert.equal(at("/watchlist.html", "http://x/watchlist.html").current, "watchlist.html");
  assert.equal((at("/watchlist.html", "http://x/watchlist.html").html.match(/is-current/g) || []).length, 1);
});

t("the search page marks nothing, since it has no entry", () => {
  const nav = at("/index.html", "http://x/index.html");
  assert.equal(nav.current, undefined);
  assert.ok(!nav.html.includes("is-current"));
});

t("aria-current rides along with the class", () => {
  assert.ok(at("/watchlist.html", "http://x/watchlist.html").html.includes('aria-current="page"'));
});

t("the browse control belongs to the search page only", () => {
  assert.ok(at("/index.html", "http://x/index.html", { browse: true }).html.includes('id="filterToggle"'));
  assert.ok(!at("/watched.html", "http://x/watched.html").html.includes("filterToggle"));
});

t("the shared tools are always built", () => {
  const nav = at("/watched.html", "http://x/watched.html");
  ["refreshBtn", "libraryDot", "themeBtn"].forEach(id =>
    assert.ok(nav.html.includes(`id="${id}"`), "missing " + id));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
