// One controller for BOTH watched.html and watchlist.html, driven by PAGE_CONFIG. Favourites and Must Watch are views, not pages.

import { esc, debounce, orderCategories } from "../core/util.js";
import { gridMarkup } from "../ui/cards.js";
import * as cardactions from "../ui/cardactions.js";
import * as detail from "../ui/detail.js";
import * as actions from "../ui/actions.js";
import * as toast from "../ui/toast.js";
import { paintNav, wireTheme, wireRefresh } from "../ui/nav.js";
import { watched } from "../data/watched.js";
import { watchlist } from "../data/watchlist.js";

const PAGE = window.PAGE_CONFIG || {};
const PAGE_SIZE = 60;

const dom = {};
const state = {
  all: [],
  view: "",
  search: "",
  category: "",
  genre: "",
  sort: "recent",
  shown: PAGE_SIZE,
  stats: {}
};

// label is what the control says; the rest is what the page says once you are there.
const VIEWS = [
  {
    key: "",
    label: "All",
    eyebrow: "My library",
    title: "Everything I have watched",
    lead: "Every film and series in the sheet, in one place."
  },
  {
    key: "favorite",
    label: "Favourites",
    eyebrow: "Favourites",
    title: "The ones I loved",
    lead: "Films and series I would happily watch again."
  },
  {
    key: "must_watch",
    label: "Must watch",
    eyebrow: "Must watch",
    title: "The ones worth recommending",
    lead: "What I tell people to go and watch."
  }
];

function grab() {
  [
    "collSearch", "collClear", "collCategory", "collGenre",
    "collSort", "collGrid", "collCount", "collState",
    "collStateTitle", "collStateText", "collMore", "collMoreBtn",
    "collLoading", "collTitle", "collEyebrow", "collLead", "collStats", "collSplit"
  ].forEach(id => { dom[id] = document.getElementById(id); });
}

// The view rides in the URL as ?view=favorite. The navbar carries all four destinations, so there are no pills here.
function setView(key, push = true) {
  state.view = key;
  state.shown = PAGE_SIZE;
  // Favourites hold a different set of genres, so the list follows the view as well as the industry.
  refillGenres();
  paintSummary();
  paint();

  if (!push) return;
  const url = new URL(window.location.href);
  key ? url.searchParams.set("view", key) : url.searchParams.delete("view");
  window.history.pushState({ view: key }, "", url);
  paintTitle();
  paintNav();
  wireTheme();
}

function paintTitle() {
  if (!dom.collTitle) return;

  const view = PAGE.views ? VIEWS.find(entry => entry.key === state.view) : null;
  const eyebrow = view ? view.eyebrow : PAGE.eyebrow;
  const title = view ? view.title : PAGE.title;
  const lead = view ? view.lead : PAGE.lead;

  if (dom.collEyebrow) dom.collEyebrow.textContent = eyebrow;
  dom.collTitle.textContent = title;
  if (dom.collLead) dom.collLead.textContent = lead || "";

  document.title = `${eyebrow} \u00b7 SidCinema`;
}

// --- filtering --------------------------------------------------------------

function fillFacet(select, entries, allLabel) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${esc(allLabel)}</option>`
    + entries.map(entry =>
      `<option value="${esc(entry.label)}">${esc(entry.label)} (${entry.count.toLocaleString()})</option>`).join("");
  // Setting a value no option carries leaves the select on "", which is right: the choice is gone, so the filter is gone.
  if (current) select.value = current;
}

// The genres actually used by the rows on screen, not every genre in the sheet - only four of forty appear on a Bollywood row.
function genreOptions() {
  const rows = state.view ? state.all.filter(item => item[state.view]) : state.all;
  const scoped = state.category
    ? rows.filter(item => item.category === state.category)
    : rows;

  const counts = {};
  for (const item of scoped) {
    for (const genre of item.genres || []) counts[genre] = (counts[genre] || 0) + 1;
  }
  return orderCategories(counts);
}

// A genre that no longer exists under the new industry is cleared, or the grid empties for no visible reason.
function refillGenres() {
  if (!dom.collGenre) return;
  fillFacet(dom.collGenre, genreOptions(), "All genres");
  if (state.genre && dom.collGenre.value !== state.genre) {
    state.genre = "";
    dom.collGenre.value = "";
  }
}

function visible() {
  let items = state.all;

  if (state.view) items = items.filter(item => item[state.view]);
  if (state.category) items = items.filter(item => item.category === state.category);
  if (state.genre) items = items.filter(item => (item.genres || []).includes(state.genre));

  if (state.search) {
    const needle = state.search.toLowerCase();
    items = items.filter(item =>
      String(item.title || "").toLowerCase().includes(needle)
      || String(item.original_title || "").toLowerCase().includes(needle));
  }

  if (state.sort === "alpha") items = [...items].sort((a, b) => a.title.localeCompare(b.title));
  else if (state.sort === "year") items = [...items].sort((a, b) => (b.year || 0) - (a.year || 0));
  else if (state.sort === "oldest") items = [...items].sort((a, b) => (a.year || 9999) - (b.year || 9999));

  return items;
}

function paint() {
  const items = visible();
  const slice = items.slice(0, state.shown);

  dom.collCount.textContent = items.length.toLocaleString();

  if (!items.length) {
    dom.collGrid.innerHTML = "";
    dom.collState.hidden = false;
    dom.collStateTitle.textContent = state.all.length ? "Nothing matches" : (PAGE.emptyTitle || "Nothing here yet");
    dom.collStateText.textContent = state.all.length
      ? (PAGE.noMatch || "Try clearing a filter.")
      : (PAGE.emptyText || "Search for something and add it.");
    dom.collMore.hidden = true;
    return;
  }

  dom.collState.hidden = true;
  dom.collGrid.innerHTML = gridMarkup(slice, { sheet: true });
  dom.collMore.hidden = slice.length >= items.length;
  if (!dom.collMore.hidden) {
    dom.collMoreBtn.textContent = `Show ${Math.min(PAGE_SIZE, items.length - slice.length)} more`;
  }
}

// Three tiles counting the CURRENT VIEW, not the whole sheet: a view reporting the sheet's numbers looks like it did not filter.
function paintSummary() {
  if (!dom.collStats) return;

  const rows = state.view ? state.all.filter(item => item[state.view]) : state.all;
  const films = rows.filter(item => item.media_type !== "tv").length;
  const series = rows.length - films;

  let tiles;
  if (!PAGE.views) {
    tiles = [
      { n: rows.length, label: "queued" },
      { n: films, label: "films" },
      { n: series, label: "series" }
    ];
  } else if (state.view === "favorite") {
    tiles = [
      { n: rows.length, label: "favourites", tone: "fav" },
      { n: films, label: "films" },
      { n: series, label: "series" }
    ];
  } else if (state.view === "must_watch") {
    tiles = [
      { n: rows.length, label: "must watch", tone: "must" },
      { n: films, label: "films" },
      { n: series, label: "series" }
    ];
  } else {
    tiles = [
      { n: rows.length, label: "titles" },
      { n: films, label: "films" },
      { n: series, label: "series" }
    ];
  }

  dom.collStats.innerHTML = tiles.map(tile =>
    `<div class="stat${tile.tone ? ` stat--${tile.tone}` : ""}">`
    + `<span class="stat__n">${tile.n.toLocaleString()}</span>`
    + `<span class="stat__label">${esc(tile.label)}</span></div>`).join("");

  // The split by industry as a bar rather than a sentence, over the same rows as the tiles above.
  if (!dom.collSplit) return;

  const counts = {};
  for (const item of rows) {
    if (item.category) counts[item.category] = (counts[item.category] || 0) + 1;
  }
  const categories = Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  const total = categories.reduce((sum, entry) => sum + entry.count, 0);

  if (!total) {
    dom.collSplit.hidden = true;
    return;
  }

  dom.collSplit.hidden = false;
  const shown = categories.slice(0, 6);
  dom.collSplit.innerHTML =
    '<div class="split__track">'
    + shown.map((entry, index) =>
      `<span class="split__seg split__seg--${index}" style="width:${(entry.count / total) * 100}%" `
      + `title="${esc(entry.label)}: ${entry.count.toLocaleString()}"></span>`).join("")
    + "</div>"
    + '<div class="split__keys">'
    + shown.map((entry, index) =>
      `<span class="split__key"><i class="split__dot split__seg--${index}"></i>`
      + `${esc(entry.label)}<b>${entry.count.toLocaleString()}</b></span>`).join("")
    + "</div>";
}

// ?dupes=1 names every row firstSeen() collapsed. Off by default: a maintenance view over the sheet, not part of reading it.
function paintDuplicates() {
  const wanted = new URLSearchParams(window.location.search).has("dupes");
  let panel = document.getElementById("collDupes");

  if (!wanted || !PAGE.views) {
    if (panel) panel.remove();
    return;
  }

  if (!panel) {
    panel = document.createElement("div");
    panel.id = "collDupes";
    panel.className = "dupes";
    dom.collGrid.parentNode.insertBefore(panel, dom.collGrid);
  }

  const list = (state.stats && state.stats.duplicates) || [];
  const rows = state.stats ? state.stats.total_rows : 0;

  if (!list.length) {
    panel.innerHTML = `<p class="dupes__lead">${rows.toLocaleString()} rows in the sheet, `
      + `${rows.toLocaleString()} titles on the page. Nothing was collapsed.</p>`;
    return;
  }

  const line = entry => {
    const side = row => `${esc(row.name || row.og_title || "(no name)")}`
      + `${row.year ? ` (${row.year})` : " (no year)"}`
      + ` &middot; ${esc(row.industry || "no industry")}`
      + ` &middot; id ${row.tmdb_id == null ? "\u2014" : row.tmdb_id}`;
    return `<li class="dupes__item">`
      + `<div class="dupes__why">${esc(entry.reason)}</div>`
      + `<div class="dupes__row"><b>dropped</b> ${side(entry.dropped)}</div>`
      + `<div class="dupes__row"><b>kept</b> ${side(entry.kept)}</div>`
      + `</li>`;
  };

  panel.innerHTML =
    `<p class="dupes__lead">${rows.toLocaleString()} rows in the sheet, `
    + `${(rows - list.length).toLocaleString()} titles on the page. `
    + `${list.length.toLocaleString()} row${list.length === 1 ? "" : "s"} collapsed:</p>`
    + `<ol class="dupes__list">${list.map(line).join("")}</ol>`;
}

function itemForCard(card) {
  if (!card) return null;
  const id = String(card.dataset.id);
  return state.all.find(item => String(item.id == null ? "" : item.id) === id) || null;
}

// --- loading ----------------------------------------------------------------

// Paint from the snapshot first, then correct from the live read.
function paintFrom(data) {
  state.all = data.items;
  state.stats = data.stats;
  fillFacet(dom.collCategory, data.categories || [], "All industries");
  // Not data.genres, which is every genre in the sheet: this is scoped to the industry and view currently chosen.
  refillGenres();
  paintSummary();
  paintDuplicates();
  paint();
}

function currentData() {
  // The whole watched library, not just its ids: the watchlist filters itself against it by identity.
  return PAGE.views ? watched.library() : watchlist.library(watched);
}

async function load() {
  // Both, always: && would skip the watched snapshot whenever the watchlist had none.
  const cached = PAGE.views
    ? watched.hydrate()
    : [watchlist.hydrate(), watched.hydrate()][0];

  if (cached) paintFrom(currentData());
  dom.collLoading.hidden = cached;

  const ok = PAGE.views ? await watched.load() : await Promise.all([watchlist.load(), watched.load()]);
  const failed = PAGE.views ? !ok : !ok[0];

  if (failed) {
    dom.collLoading.hidden = true;
    if (cached) return;   // a stale page beats an error over the top of one
    dom.collState.hidden = false;
    dom.collStateTitle.textContent = PAGE.loadError || "Could not load this page";
    dom.collStateText.textContent = (PAGE.views ? watched.lastError : watchlist.lastError)
      || "The sheet did not answer.";
    return;
  }

  dom.collLoading.hidden = true;
  paintFrom(currentData());
}

// --- wiring -----------------------------------------------------------------

function wire() {
  dom.collSearch.addEventListener("input", debounce(() => {
    state.search = dom.collSearch.value.trim();
    state.shown = PAGE_SIZE;
    dom.collClear.hidden = !state.search;
    paint();
  }, 130));

  dom.collClear.addEventListener("click", () => {
    dom.collSearch.value = "";
    state.search = "";
    dom.collClear.hidden = true;
    paint();
  });

  [["collCategory", "category"], ["collGenre", "genre"], ["collSort", "sort"]].forEach(([id, key]) => {
    if (!dom[id]) return;
    dom[id].addEventListener("change", () => {
      state[key] = dom[id].value;
      state.shown = PAGE_SIZE;
      // Industry first, then genre - a sequence, not a pair, or the two narrow each other into a corner.
      if (key === "category") refillGenres();
      paint();
    });
  });

  dom.collMoreBtn.addEventListener("click", () => {
    state.shown += PAGE_SIZE;
    paint();
  });

  window.addEventListener("popstate", () => {
    const wanted = new URL(window.location.href).searchParams.get("view") || "";
    if (PAGE.views && VIEWS.some(view => view.key === wanted)) setView(wanted, false);
    paintTitle();
    paintNav();
    wireTheme();
  });

  // This page had no reload at all: the navbar button was only ever bound on the search page.
  wireRefresh(async () => {
    const { invalidate } = await import("../data/sheets.js");
    invalidate();

    const ok = PAGE.views
      ? await watched.load()
      : (await Promise.all([watchlist.load(), watched.load()]))[0];
    if (!ok) {
      throw new Error((PAGE.views ? watched.lastError : watchlist.lastError)
        || "Could not reload the sheet.");
    }

    paintFrom(currentData());

    const count = (PAGE.views ? watched.stats().total_rows : watchlist.stats().total_rows);
    return `Reloaded \u2014 ${count.toLocaleString()} ${PAGE.views ? "watched" : "queued"}`;
  });

  detail.attach(dom.collGrid);
  cardactions.attach(dom.collGrid, itemForCard, {
    onChange: (item, action) => {
      // Unmarking something watched takes it out of this collection, so the row has to leave.
      if (PAGE.views && action === "watched" && !item.watched) {
        state.all = state.all.filter(row => row !== item);
      }
      if (!PAGE.views && action === "watched" && item.watched) {
        state.all = state.all.filter(row => row !== item);
      }
      if (!PAGE.views && action === "watchlist" && !item.watchlisted) {
        state.all = state.all.filter(row => row !== item);
      }
      state.stats = PAGE.views ? watched.stats() : watchlist.stats(watched);
      paintSummary();
      paint();
    }
  });

}

export async function start() {
  paintNav();
  wireTheme();
  grab();

  // The chosen view rides in the URL, so a Favourites link is shareable and the back button works.
  const wanted = new URL(window.location.href).searchParams.get("view") || "";
  if (PAGE.views && VIEWS.some(view => view.key === wanted)) state.view = wanted;

  paintTitle();
  wire();
  actions.paintOwnerState();
  await load();
}
