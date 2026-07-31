// One controller for BOTH /watched and /watchlist, driven by PAGE_CONFIG set in
// each page. Don't fork it into two files: the pages differ in their source and
// their wording, not in their behaviour.
//
// Favourites and Must Watch are VIEWS here, not pages. They are flags on an All
// Watched row, so separate pages would mean the same title having three cards
// and a heart ticked on one not updating the others.

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

// label is what the control says; the rest is what the page says once you are
// there. A view that changes the grid but not the heading leaves you unsure
// which collection you are looking at.
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

// The view rides in the URL as ?view=favorite. It used to also have a row of
// pills here, but the navbar now carries all four destinations, so the pills were
// a second control for the same thing sitting six inches below the first.
function setView(key, push = true) {
  state.view = key;
  state.shown = PAGE_SIZE;
  // Favourites hold a different set of genres from the whole library, so the
  // list follows the view as well as the industry.
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
  // Setting a value no option carries leaves the select on "", which is the
  // right answer: the choice is gone, so the filter is gone with it.
  if (current) select.value = current;
}

// The genres actually used by the rows on screen, which is not the same as the
// genres in the sheet.
//
// Standing in Bollywood and being offered Western, Bhangra and forty others is
// a list of forty ways to empty the grid: only four of them are on a Bollywood
// row. So the list is rebuilt from the rows that survive the industry and the
// view, and the counts beside each one are the counts you will actually get.
// The same narrowing the mark-watched dialog already does when you pick an
// industry, applied to the control that filters.
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

// Called whenever the industry changes. A genre that no longer exists under the
// new industry is dropped rather than left selected: a filter naming something
// the list no longer offers is a grid that is empty for no visible reason.
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

// The numbers, as tiles rather than a run-on sentence. A comma-separated line
// reads as a caption and gets skipped; the counts are the most concrete thing on
// the page and should be the easiest to take in.
//
// They count the CURRENT VIEW, not the whole sheet. Standing in Must watch and
// being told there are 1,013 titles and 54 favourites answers a question nobody
// asked, and made the view look like it had not filtered anything.
//
// Three tiles, no more: the total for this view, then the film/series split of
// it. The cross-reference tile ("also must watch") went because it invited exactly
// the arithmetic the numbers are meant to save you - the flags are on the cards.
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

  // The split by industry, as a bar rather than a sentence. Proportions are the
  // point, and "450 Hollywood, 300 Bollywood" makes you do that arithmetic
  // yourself. Counted over the same rows as the tiles above.
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

function itemForCard(card) {
  if (!card) return null;
  const id = String(card.dataset.id);
  return state.all.find(item => String(item.id == null ? "" : item.id) === id) || null;
}

// --- loading ----------------------------------------------------------------

// Paint from the snapshot first, then correct from the live read. On a library
// of a thousand rows the difference is a page that is there on arrival against
// one that spends a second empty.
function paintFrom(data) {
  state.all = data.items;
  state.stats = data.stats;
  fillFacet(dom.collCategory, data.categories || [], "All industries");
  // Not data.genres: that is every genre in the sheet. The list is scoped to
  // the industry and the view currently chosen.
  refillGenres();
  paintSummary();
  paint();
}

function currentData() {
  // The whole watched library, not just its set of ids: the watchlist filters
  // itself against it by identity, so a film watched under one TMDB id no
  // longer sits in the queue under TMDB's other id for it.
  return PAGE.views ? watched.library() : watchlist.library(watched);
}

async function load() {
  // Both, always: && would skip the watched snapshot whenever the watchlist had
  // none, and the queue is filtered against the watched library.
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
      // Industry first, then genre - a sequence, not a pair. Picking one
      // rebuilds the other, and the reverse would be a list that narrows
      // itself into a corner.
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

  // This page had no reload at all: the button was in the navbar on every page
  // but only the search page ever bound it, so here it was a control that
  // answered a click with nothing.
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
      // Unmarking something watched takes it out of this collection entirely,
      // so the row has to leave rather than sit there with an empty tick.
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

  // The chosen view rides in the URL, so a Favourites link is shareable and the
  // back button works between views.
  const wanted = new URL(window.location.href).searchParams.get("view") || "";
  if (PAGE.views && VIEWS.some(view => view.key === wanted)) state.view = wanted;

  paintTitle();
  wire();
  actions.paintOwnerState();
  await load();
}
