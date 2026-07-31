// The navbar keeps every destination on every page and marks the current one.
// An earlier version hid the current entry, which changed the row's shape as you
// moved and told you nothing about where you were.

import assert from "node:assert";

let html = "";
const host = { set innerHTML(v) { html = v; }, get innerHTML() { return html; } };

globalThis.document = {
  getElementById: id => (id === "navTools" ? host : null),
  addEventListener: () => {}
};
globalThis.URL = URL;
globalThis.window = { location: {}, addEventListener: () => {} };

const { paintNav } = await import("../../js/ui/nav.js");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL " + name + ": " + e.message); } };

function at(pathname, href, options) {
  globalThis.window.location = { pathname, href };
  paintNav(options);
  return {
    // The row of labelled links, which is what a wide screen shows.
    labels: [...html.matchAll(/<a class="icon-btn icon-btn--label[^"]*"[^>]*>[\s\S]*?icon-btn__text">([^<]+)</g)]
      .map(m => m[1]),
    // The same destinations inside the phone dropdown.
    menu: [...html.matchAll(/navmenu__item[^"]*"[^>]*>[\s\S]*?<span>([^<]+)<\/span>/g)].map(m => m[1]),
    // What the dropdown button calls itself.
    trigger: (html.match(/navmenu__trigger[\s\S]*?icon-btn__text">([^<]+)</) || [])[1],
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
  // Twice, and only twice: the row link and its twin in the dropdown. Both are
  // in the DOM at every width and CSS shows one.
  assert.equal((at("/watchlist.html", "http://x/watchlist.html").html.match(/is-current/g) || []).length, 2);
});

// On a phone the four destinations collapse into one control. Four unlabelled
// glyphs in a row named nothing; this says where you are and lists where you
// could go.
t("the phone dropdown carries the same four destinations", () => {
  for (const [path, href] of [
    ["/index.html", "http://x/index.html"],
    ["/watched.html", "http://x/watched.html"],
    ["/watchlist.html", "http://x/watchlist.html"]
  ]) {
    assert.deepEqual(at(path, href).menu, DESTINATIONS, `wrong menu on ${href}`);
  }
});

t("the dropdown button says which collection you are in", () => {
  assert.equal(at("/watched.html", "http://x/watched.html").trigger, "Library");
  assert.equal(at("/watched.html", "http://x/watched.html?view=favorite").trigger, "Favourites");
  assert.equal(at("/watchlist.html", "http://x/watchlist.html").trigger, "Watchlist");
  // The search page is in no collection, so the button names the set instead of
  // claiming to be somewhere.
  assert.equal(at("/index.html", "http://x/index.html").trigger, "Collections");
});

t("the tools sit after the destinations and browse sits last", () => {
  const nav = at("/index.html", "http://x/index.html", { browse: true });
  const order = ["navMenuBtn", "refreshBtn", "themeBtn", "filterToggle"]
    .map(id => nav.html.indexOf(`id="${id}"`));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "the navbar order changed");
  assert.ok(order.every(at => at > -1));
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
