// The search page. Everything on screen is driven from here; the modules below
// it know nothing about the DOM.

import { esc, debounce } from "../core/util.js";
import { MAX_BROWSE_PAGE, TMDB_PAGE_SIZE, BROWSE_PAGES } from "../config.js";
import * as scope from "../search/scope.js";
import { runSearch, homeFeed, annotate } from "../search/search.js";
import * as filters from "../search/filters.js";
import { buildSections } from "../ui/sections.js";
import { gridMarkup } from "../ui/cards.js";
import * as cardactions from "../ui/cardactions.js";
import * as detail from "../ui/detail.js";
import * as actions from "../ui/actions.js";
import * as toast from "../ui/toast.js";
import { paintNav, wireTheme, wireRefresh } from "../ui/nav.js";
import { watched } from "../data/watched.js";
import { watchlist } from "../data/watchlist.js";
import { people } from "../data/people.js";
import * as tmdb from "../tmdb/client.js";

const dom = {};
const state = {
  media: "movie",
  scope: scope.AUTO,
  query: "",
  mode: "home",
  sections: [],
  items: [],
  filter: "all",
  sort: "relevance",
  selection: {},
  page: 1,
  hasMore: false,
  headline: "",
  seed: null
};

function grab() {
  [
    "searchForm", "searchInput", "searchClear", "scopeSelect", "suggestions",
    "results", "toolbar", "resultsHeadline", "resultsCorrected",
    "resultSections", "skeletonGrid", "loadingLine", "loadingText", "stateBox",
    "stateIcon", "stateTitle", "stateText", "stateAction", "coverage",
    "coverageSeen", "coverageTotal", "coverageFill", "activeFilters",
    "sortSelect", "filterPanel", "panelFields", "panelApply", "panelClear",
    "panelClose", "scrim", "filterToggle", "filterCount", "peopleBox",
    "peopleList", "loadMoreRow", "loadMoreBtn", "refreshBtn", "libraryDot"
  ].forEach(id => { dom[id] = document.getElementById(id); });
}

// --- painting ---------------------------------------------------------------

function setBusy(on, message) {
  dom.skeletonGrid.hidden = !on || Boolean(state.items.length);
  dom.loadingLine.hidden = !on;
  if (on && message) dom.loadingText.textContent = message;
  if (on) {
    dom.stateBox.hidden = true;
    if (!state.items.length) dom.resultSections.innerHTML = "";
  }
}

function showState(icon, title, text, actionLabel, onAction) {
  dom.stateBox.hidden = false;
  dom.stateIcon.textContent = icon;
  dom.stateTitle.textContent = title;
  dom.stateText.textContent = text;
  dom.resultSections.innerHTML = "";

  if (actionLabel) {
    dom.stateAction.hidden = false;
    dom.stateAction.textContent = actionLabel;
    dom.stateAction.onclick = onAction;
  } else {
    dom.stateAction.hidden = true;
    dom.stateAction.onclick = null;
  }
}

function visibleItems() {
  let items = state.items;

  if (state.filter === "watched") items = items.filter(item => item.watched);
  else if (state.filter === "unwatched") items = items.filter(item => !item.watched);

  if (state.sort === "rating") items = [...items].sort((a, b) => b.rating - a.rating);
  else if (state.sort === "newest") items = [...items].sort((a, b) => String(b.release_date || "").localeCompare(String(a.release_date || "")));
  else if (state.sort === "oldest") items = [...items].sort((a, b) => String(a.release_date || "9999").localeCompare(String(b.release_date || "9999")));
  else if (state.sort === "alpha") items = [...items].sort((a, b) => a.title.localeCompare(b.title));

  return items;
}

function paintCoverage(items) {
  const total = items.length;
  const seen = items.filter(item => item.watched).length;
  dom.coverage.hidden = total === 0;
  dom.coverageSeen.textContent = seen;
  dom.coverageTotal.textContent = total;
  dom.coverageFill.style.width = total ? `${Math.round((seen / total) * 100)}%` : "0%";
}

function paintResults() {
  const items = visibleItems();
  state.sections = buildSections(items, {
    media: state.media,
    relatedTo: state.seed ? state.seed.title : null
  });

  dom.toolbar.hidden = false;
  dom.resultsHeadline.textContent = state.headline;
  paintCoverage(state.items);

  if (!items.length) {
    const filtered = state.items.length > 0;
    showState(
      filtered ? "\u{1F50D}" : "\u{1F37F}",
      filtered ? "Nothing left after that filter" : "Nothing found",
      filtered
        ? "Every result was filtered out. Try All instead."
        : "TMDB has nothing for that. Try a different phrase, or browse by genre.",
      filtered ? "Show all" : null,
      filtered ? () => setFilter("all") : null
    );
    dom.loadMoreRow.hidden = true;
    return;
  }

  dom.stateBox.hidden = true;
  dom.resultSections.innerHTML = state.sections.map(section => ''
    + '<section class="sect">'
    + (section.title
      ? `<h2 class="sect__head">${section.icon ? `<span class="sect__icon">${section.icon}</span>` : ""}`
        + `${esc(section.title)}<span class="sect__n">${section.count}</span></h2>`
      : "")
    + gridMarkup(section.movies, { showDate: section.key === "upcoming" })
    + "</section>").join("");

  dom.loadMoreRow.hidden = !state.hasMore;
}

// The one thing worth saying above a result set: these are not quite the words
// you typed. Which rung of the correction ladder found the better spelling, how
// long the search took and which parser read it were all facts about the
// machinery, not about the films - so they are gone.
function paintMeta(payload) {
  if (!payload.corrected) {
    dom.resultsCorrected.hidden = true;
    return;
  }
  dom.resultsCorrected.hidden = false;
  dom.resultsCorrected.innerHTML = `Showing results for <b>${esc(payload.corrected)}</b>`;
}

// --- the hero control -------------------------------------------------------

function scopeDefinition() {
  return scope.definitionFor(state.scope);
}

function paintScopeUI() {
  const definition = scopeDefinition();
  dom.searchInput.placeholder = definition.placeholder[state.media] || definition.placeholder.movie;

  const examples = definition.examples[state.media] || definition.examples.movie || [];
  dom.suggestions.innerHTML = '<span class="suggestions__label" id="searchHint">Try</span>'
    + examples.map(([full, label]) =>
      `<button type="button" class="chip" data-query="${esc(full)}">${esc(label)}</button>`).join("");

  // Autocomplete is only offered under Person, because the People tab is the
  // only local list the app holds. Offering completions for titles would promise
  // a catalogue that is not here.
  if (state.scope !== scope.PERSON) hideSuggestions();
}

function hideSuggestions() {
  dom.peopleBox.hidden = true;
  dom.peopleList.innerHTML = "";
  dom.searchInput.setAttribute("aria-expanded", "false");
}

const suggestPeople = debounce(() => {
  if (state.scope !== scope.PERSON || !people.ready) return hideSuggestions();

  const term = dom.searchInput.value.trim();
  const matches = term ? people.suggest(term, 8) : [];
  if (!matches.length) return hideSuggestions();

  dom.peopleList.innerHTML = matches.map(person =>
    `<li role="option" class="acbox__item" data-name="${esc(person.name)}">`
    + `<span class="acbox__name">${esc(person.name)}</span>`
    + (person.role ? `<span class="acbox__role">${esc(person.role)}</span>` : "")
    + "</li>").join("");
  dom.peopleBox.hidden = false;
  dom.searchInput.setAttribute("aria-expanded", "true");
}, 90);

// --- running things ---------------------------------------------------------

async function loadHome() {
  state.mode = "home";
  state.query = "";
  state.seed = null;
  state.hasMore = false;
  setBusy(true, "Loading what\u2019s trending\u2026");

  try {
    const payload = await homeFeed(state.media);
    state.items = payload.items;
    state.headline = payload.headline;
    paintMeta({});
    paintResults();
  } catch (error) {
    state.items = [];
    showState("\u26A0\uFE0F", "Could not reach TMDB", error.message, "Try again", loadHome);
  } finally {
    setBusy(false);
  }
}

async function search(query, { locked = false } = {}) {
  const text = String(query || "").trim();
  if (!text) return loadHome();

  state.mode = "search";
  state.query = text;
  state.hasMore = false;
  hideSuggestions();
  setBusy(true, state.scope === scope.AUTO || state.scope === scope.DISCOVER
    ? "Reading the search\u2026"
    : "Asking TMDB\u2026");

  try {
    const payload = await runSearch({
      query: text,
      media: state.media,
      locked,
      scope: state.scope
    });

    if (payload.empty) {
      dom.searchInput.value = "";
      return loadHome();
    }

    state.items = payload.items;
    state.headline = payload.headline;
    state.seed = payload.seed;
    state.media = payload.media;
    paintMeta(payload);
    paintResults();
  } catch (error) {
    state.items = [];
    showState("\u26A0\uFE0F", "That search did not work", error.message, "Try again", () => search(text));
  } finally {
    setBusy(false);
  }
}

// --- the browse panel -------------------------------------------------------

let panelLoaded = false;

function panelIsOpen() {
  return dom.filterPanel.classList.contains("is-open");
}

async function openPanel() {
  // The panel sits at translateX(-100%) and only .is-open slides it in, so
  // clearing `hidden` alone leaves it fully rendered just off the left edge -
  // present in the DOM, invisible on screen. Both are required.
  //
  // [hidden] is display:none, and a transition cannot run from display:none, so
  // the class has to land on a later frame than the unhide.
  dom.filterPanel.hidden = false;
  dom.scrim.hidden = false;
  requestAnimationFrame(() => {
    dom.filterPanel.classList.add("is-open");
    dom.scrim.classList.add("is-open");
  });
  dom.filterToggle.setAttribute("aria-expanded", "true");
  document.body.classList.add("panel-open");

  if (panelLoaded) return;
  dom.panelFields.innerHTML = '<div class="loading-line"><span class="spinner"></span><span>Loading filters\u2026</span></div>';

  try {
    const options = await filters.filterOptions(state.media);
    dom.panelFields.innerHTML = options.groups.map(group => ''
      + '<label class="facets">'
      + `<span class="facets__label">${esc(group.label)}</span>`
      + '<span class="facets__wrap">'
      + `<select class="facets__select" data-key="${group.key}">`
      + `<option value="">${esc(group.all_label)}</option>`
      + group.options.map(option =>
        `<option value="${esc(option.value)}"${state.selection[group.key] === option.value ? " selected" : ""}>`
        + `${esc(option.label)}</option>`).join("")
      + "</select>"
      + '<svg class="facets__caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
      + "</span></label>").join("");
    panelLoaded = true;
  } catch (error) {
    dom.panelFields.innerHTML = `<p class="note note--warn">${esc(error.message)}</p>`;
  }
}

function closePanel() {
  dom.filterPanel.classList.remove("is-open");
  dom.scrim.classList.remove("is-open");
  dom.filterToggle.setAttribute("aria-expanded", "false");
  document.body.classList.remove("panel-open");

  // Hide only after the slide finishes, or it vanishes instead of sliding out.
  // 280ms matches the transform transition on .panel.
  window.setTimeout(() => {
    if (!panelIsOpen()) {
      dom.filterPanel.hidden = true;
      dom.scrim.hidden = true;
    }
  }, 280);
}

function readPanel() {
  const picked = {};
  dom.panelFields.querySelectorAll("[data-key]").forEach(select => {
    if (select.value) picked[select.dataset.key] = select.value;
  });
  return filters.cleanSelection(picked);
}

function paintActiveFilters() {
  const entries = Object.entries(state.selection);
  // A non-default sort is a filter now, so it counts on the badge. "Most
  // popular" does not, because that is what the catalogue does unasked.
  const count = entries.filter(([key, value]) =>
    key !== "sort" || (value && value !== "popularity")).length;

  dom.filterCount.hidden = count === 0;
  dom.filterCount.textContent = String(count);
  dom.panelClear.hidden = entries.length === 0;

  if (!entries.length) {
    dom.activeFilters.hidden = true;
    dom.activeFilters.innerHTML = "";
    return;
  }

  dom.activeFilters.hidden = false;
  dom.activeFilters.innerHTML = entries.map(([key, value]) =>
    `<button type="button" class="chipx" data-drop="${key}">`
    + `${esc(filters.labelFor(key, value))}`
    + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'
    + "</button>").join("");
}

async function runBrowse(page = 1) {
  const { selection, dropped } = await filters.resolve(state.selection, state.media);
  state.selection = selection;
  paintActiveFilters();

  if (dropped.length) {
    toast.show(`That genre does not exist in the ${state.media === "tv" ? "series" : "film"} catalogue, so it was dropped.`);
  }

  if (!filters.isActive(selection)) {
    closePanel();
    return loadHome();
  }

  state.mode = "browse";
  state.page = Math.max(1, Math.min(page, MAX_BROWSE_PAGE));
  closePanel();
  setBusy(true, "Searching the catalogue\u2026");

  try {
    const found = await filters.browse(selection, state.media, { page: state.page });
    const fresh = annotate(found);

    state.items = state.page === 1 ? fresh : [...state.items, ...fresh];
    state.headline = filters.describe(selection, state.media);
    state.seed = null;
    // A short page means TMDB ran out, so the UI can retire Load more.
    state.hasMore = found.length >= BROWSE_PAGES * TMDB_PAGE_SIZE - 2 && state.page < MAX_BROWSE_PAGE;
    paintMeta({});
    paintResults();
  } catch (error) {
    showState("\u26A0\uFE0F", "Could not browse with those filters", error.message, "Try again", () => runBrowse(state.page));
  } finally {
    setBusy(false);
  }
}

// --- toolbar ----------------------------------------------------------------

function setFilter(value) {
  state.filter = value;
  document.querySelectorAll("[data-filter]").forEach(button =>
    button.classList.toggle("is-active", button.dataset.filter === value));
  paintResults();
}

function setMedia(value) {
  if (state.media === value) return;
  state.media = value;
  document.querySelectorAll("[data-media]").forEach(button =>
    button.classList.toggle("is-active", button.dataset.media === value));
  panelLoaded = false;
  paintScopeUI();

  if (state.mode === "browse") return runBrowse(1);
  if (state.query) return search(state.query, { locked: true });
  return loadHome();
}

// --- the card data behind an element ---------------------------------------
//
// Handed to CardActions so it mutates the page's OWN object, which is what makes
// a change survive the next re-render instead of reverting.

// Did the live read disagree with the snapshot about anything on screen?
function changedFlags(before, after) {
  if (before.length !== after.length) return true;
  return after.some((item, index) => {
    const was = before[index];
    return !was || was.watched !== item.watched || was.favorite !== item.favorite
      || was.must_watch !== item.must_watch || was.watchlisted !== item.watchlisted;
  });
}

function itemForCard(card) {
  if (!card) return null;
  const id = String(card.dataset.id);
  const media = card.dataset.media;
  return state.items.find(item => String(item.id) === id && item.media_type === media) || null;
}

// --- wiring -----------------------------------------------------------------

function wire() {
  dom.searchForm.addEventListener("submit", event => {
    event.preventDefault();
    search(dom.searchInput.value);
  });

  dom.searchInput.addEventListener("input", () => {
    dom.searchClear.hidden = !dom.searchInput.value;
    suggestPeople();
  });

  dom.searchInput.addEventListener("keydown", event => {
    if (event.key === "Escape") hideSuggestions();
  });

  dom.searchClear.addEventListener("click", () => {
    dom.searchInput.value = "";
    dom.searchClear.hidden = true;
    hideSuggestions();
    loadHome();
  });

  dom.scopeSelect.addEventListener("change", () => {
    state.scope = scope.clean(dom.scopeSelect.value);
    paintScopeUI();
    if (state.query) search(state.query);
  });

  dom.peopleList.addEventListener("click", event => {
    const option = event.target.closest("[data-name]");
    if (!option) return;
    dom.searchInput.value = option.dataset.name;
    hideSuggestions();
    search(option.dataset.name);
  });

  dom.suggestions.addEventListener("click", event => {
    const chip = event.target.closest("[data-query]");
    if (!chip) return;
    dom.searchInput.value = chip.dataset.query;
    dom.searchClear.hidden = false;
    search(chip.dataset.query);
  });

  document.querySelectorAll("[data-media]").forEach(button =>
    button.addEventListener("click", () => setMedia(button.dataset.media)));

  document.querySelectorAll("[data-filter]").forEach(button =>
    button.addEventListener("click", () => setFilter(button.dataset.filter)));

  dom.sortSelect.addEventListener("change", () => {
    state.sort = dom.sortSelect.value;
    paintResults();
  });

  dom.filterToggle.addEventListener("click", () =>
    (panelIsOpen() ? closePanel() : openPanel()));
  dom.panelClose.addEventListener("click", closePanel);
  dom.scrim.addEventListener("click", closePanel);

  dom.panelApply.addEventListener("click", () => {
    state.selection = readPanel();
    runBrowse(1);
  });

  dom.panelClear.addEventListener("click", () => {
    state.selection = {};
    panelLoaded = false;
    paintActiveFilters();
    closePanel();
    loadHome();
  });

  dom.activeFilters.addEventListener("click", event => {
    const drop = event.target.closest("[data-drop]");
    if (!drop) return;
    delete state.selection[drop.dataset.drop];
    panelLoaded = false;
    paintActiveFilters();
    filters.isActive(state.selection) ? runBrowse(1) : loadHome();
  });

  dom.loadMoreBtn.addEventListener("click", () => runBrowse(state.page + 1));

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && panelIsOpen()) closePanel();
  });

  wireRefresh(reload);

  detail.attach(dom.resultSections);
  cardactions.attach(dom.resultSections, itemForCard, {
    onChange: () => {
      paintCoverage(state.items);
      if (dom.libraryDot) dom.libraryDot.classList.add("is-on");
    }
  });
}

// Returns the line the toast settles to; throwing is how it reports a failure.
// The spinner, the tick and the toast itself belong to wireRefresh, so every
// page reports a reload the same way.
async function reload() {
  const { invalidate } = await import("../data/sheets.js");
  invalidate();

  const ok = await Promise.all([watched.load(), watchlist.load()]);
  if (!ok[0]) throw new Error(watched.lastError || "Could not reload the sheet.");

  state.items = annotate(state.items);
  paintResults();

  const seen = watched.stats().total_rows.toLocaleString();
  const queued = watchlist.stats().total_rows.toLocaleString();
  return `Reloaded \u2014 ${seen} watched, ${queued} queued`;
}

// --- start ------------------------------------------------------------------

export async function start() {
  // The nav is built first: grab() looks for #filterToggle, which lives in it.
  paintNav({ browse: true });
  wireTheme();
  grab();

  state.scope = scope.clean(dom.scopeSelect.value);
  dom.scopeSelect.innerHTML = scope.options().map(entry =>
    `<option value="${entry.value}" title="${esc(entry.hint)}"${entry.value === state.scope ? " selected" : ""}>`
    + `${esc(entry.label)}</option>`).join("");

  paintScopeUI();
  wire();
  actions.paintOwnerState();

  // The last known sheet, straight from localStorage and synchronous, so the
  // watched flags are already in the index before the first grid paints. Without
  // this the posters appear and turn green a second later, when the Apps Script
  // read lands - which reads as the page correcting itself.
  watched.hydrate();
  watchlist.hydrate();
  people.hydrate();

  // The live read runs alongside the feed and replaces the snapshot when it
  // arrives. A grid that paints early beats a blank page waiting for both.
  const sheets = Promise.all([watched.load(), watchlist.load(), people.load()]);
  await loadHome();

  await sheets;
  // Re-annotate only if the live read actually changed something. Repainting an
  // identical grid is a wasted frame the user sees as a flicker.
  const refreshed = annotate(state.items);
  if (changedFlags(state.items, refreshed)) {
    state.items = refreshed;
    paintResults();
  }

  const stats = watched.stats();
  if (stats.error) {
    toast.error(`Watch history unavailable. ${stats.error}`);
  } else if (stats.warning) {
    toast.error(stats.warning);
  }

  await tmdb.loadLanguageNames();
}
