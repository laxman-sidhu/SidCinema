// The gate and every write call. The only UI module that talks to writer.js.

import * as auth from "../data/auth.js";
import * as writer from "../data/writer.js";
import { watched } from "../data/watched.js";
import { SERIES_INDUSTRY } from "../config.js";
import { firstGenre } from "../tmdb/queries.js";
import { esc } from "../core/util.js";
import * as toast from "./toast.js";

let gate = null;
let sheetDialog = null;
let replayAfterAuth = null;
let optionsCache = null;

export function isOwner() {
  return auth.isOwner();
}

export function canWrite() {
  return auth.configured() && auth.bridgeReady();
}

export function ownerName() {
  return auth.status().owner_name || "the owner";
}

// A Bootstrap modal traps focus, so focus is set after the hide transition rather than during it.
function closeAnyModal() {
  document.querySelectorAll(".modal.show").forEach(node => {
    const instance = window.bootstrap && window.bootstrap.Modal
      ? window.bootstrap.Modal.getInstance(node)
      : null;
    if (instance) instance.hide();
  });
}

// --- the gate: a bare password prompt reads as a wall, so the field only appears after Yes ---

function buildGate() {
  if (gate) return gate;

  gate = document.createElement("div");
  gate.className = "gate";
  gate.hidden = true;
  gate.innerHTML =
    '<div class="gate__backdrop" data-gate-close></div>'
    + '<div class="gate__panel" role="dialog" aria-modal="true" aria-labelledby="gateTitle">'
    + '<h2 class="gate__title" id="gateTitle"></h2>'
    + '<p class="gate__text"></p>'
    + '<div data-step="who">'
    + '<div class="gate__actions">'
    + '<button type="button" class="gate__btn gate__btn--ghost" data-gate-close>No, go back</button>'
    + '<button type="button" class="gate__btn gate__btn--solid" data-gate-yes></button>'
    + "</div></div>"
    + '<div data-step="password" hidden>'
    + '<label class="gate__label" for="gatePassword">Password</label>'
    + '<input class="gate__input" id="gatePassword" type="password" autocomplete="current-password" '
    + 'placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022">'
    + '<p class="gate__error" hidden></p>'
    + '<div class="gate__actions">'
    + '<button type="button" class="gate__btn gate__btn--ghost" data-gate-close>Cancel</button>'
    + '<button type="button" class="gate__btn gate__btn--solid" data-gate-submit>Sign in</button>'
    + "</div></div></div>";

  document.body.appendChild(gate);

  gate.addEventListener("click", event => {
    if (event.target.closest("[data-gate-close]")) closeGate();
    if (event.target.closest("[data-gate-yes]")) showPasswordStep();
    if (event.target.closest("[data-gate-submit]")) submitPassword();
  });

  gate.querySelector("#gatePassword").addEventListener("keydown", event => {
    if (event.key === "Enter") submitPassword();
    if (event.key === "Escape") closeGate();
  });

  return gate;
}

function openGate() {
  const node = buildGate();
  const name = ownerName();

  node.querySelector(".gate__title").textContent = `This is ${name}\u2019s film diary`;
  node.querySelector(".gate__text").textContent =
    `Everything here \u2014 what\u2019s been watched, liked and queued up \u2014 is ${name}\u2019s `
    + `own list, kept in ${name}\u2019s spreadsheet. You\u2019re very welcome to browse and `
    + `search all of it, but only ${name} can change what\u2019s on it.`;
  node.querySelector("[data-gate-yes]").textContent = `Yes, I\u2019m ${name}`;

  node.querySelector('[data-step="who"]').hidden = false;
  node.querySelector('[data-step="password"]').hidden = true;
  node.querySelector(".gate__error").hidden = true;
  node.querySelector("#gatePassword").value = "";

  closeAnyModal();
  node.hidden = false;
  document.body.classList.add("gate-open");
  setTimeout(() => node.querySelector("[data-gate-yes]").focus(), 220);
}

function showPasswordStep() {
  const node = buildGate();
  node.querySelector('[data-step="who"]').hidden = true;
  node.querySelector('[data-step="password"]').hidden = false;
  node.querySelector(".gate__title").textContent = "Welcome back";
  node.querySelector(".gate__text").textContent = "Enter the password to unlock editing on this device.";
  closeAnyModal();
  setTimeout(() => node.querySelector("#gatePassword").focus(), 220);
}

function closeGate() {
  if (!gate) return;
  gate.hidden = true;
  document.body.classList.remove("gate-open");
  replayAfterAuth = null;
}

function submitPassword() {
  const node = buildGate();
  const field = node.querySelector("#gatePassword");
  const error = node.querySelector(".gate__error");

  if (!field.value) {
    error.textContent = "Type the password first.";
    error.hidden = false;
    return;
  }

  const result = auth.signIn(field.value);
  if (!result.ok) {
    error.textContent = result.reason === "not_configured"
      ? "Editing is not set up. Set OWNER_PASSWORD in js/config.js."
      : "That password does not match.";
    error.hidden = false;
    field.select();
    return;
  }

  closeGate();
  document.body.classList.add("is-owner");
  window.dispatchEvent(new CustomEvent("sheet:authchange", { detail: { owner: true } }));

  // Signing in should finish the job, not merely unlock it.
  const replay = replayAfterAuth;
  replayAfterAuth = null;
  if (replay) replay();
}

// Run the job if signed in, otherwise open the gate and run it afterwards.
export function withOwner(job) {
  if (isOwner()) {
    job();
    return;
  }
  if (!canWrite()) {
    toast.error("Editing is not set up. Check js/config.js.");
    return;
  }
  replayAfterAuth = job;
  openGate();
}

// --- the "which shelf?" dialog: Industry then Genre, both from the sheet's own contents, plus "+ Add new..." ---

const NEW_VALUE = "__new__";

function loadOptions() {
  if (!optionsCache) optionsCache = { industries: watched.industries() };
  return optionsCache;
}

// A new industry or genre must show up in the next dialog.
export function forgetOptions() {
  optionsCache = null;
}

function buildSheetDialog() {
  if (sheetDialog) return sheetDialog;

  sheetDialog = document.createElement("div");
  sheetDialog.className = "gate gate--form";
  sheetDialog.hidden = true;
  sheetDialog.innerHTML =
    '<div class="gate__backdrop" data-ask-close></div>'
    + '<div class="gate__panel gate__panel--wide" role="dialog" aria-modal="true" aria-labelledby="askTitle">'
    + '<h2 class="gate__title" id="askTitle">Mark as watched</h2>'
    + '<p class="gate__text" data-ask-subject></p>'
    + '<div class="askfield">'
    + '<label class="gate__label" for="askIndustry"><span class="askfield__step">1</span>Industry</label>'
    + '<select class="gate__select" id="askIndustry"></select>'
    + '<input class="gate__input askfield__new" id="askIndustryNew" hidden placeholder="New industry name" maxlength="40">'
    + "</div>"
    + '<div class="askfield">'
    + '<label class="gate__label" for="askGenre"><span class="askfield__step">2</span>Genre</label>'
    + '<select class="gate__select" id="askGenre"></select>'
    + '<input class="gate__input askfield__new" id="askGenreNew" hidden placeholder="New genre name" maxlength="40">'
    + '<p class="askfield__hint" data-genre-hint></p>'
    + "</div>"
    + '<div class="askflags">'
    + '<label class="askflag"><input type="checkbox" id="askFavorite"><span>Add to Favourites</span></label>'
    + '<label class="askflag"><input type="checkbox" id="askMustWatch"><span>Mark as Must Watch</span></label>'
    + "</div>"
    + '<p class="gate__error" hidden></p>'
    + '<div class="gate__actions">'
    + '<button type="button" class="gate__btn gate__btn--ghost" data-ask-close>Cancel</button>'
    + '<button type="button" class="gate__btn gate__btn--solid" data-ask-save>Save to sheet</button>'
    + "</div></div>";

  document.body.appendChild(sheetDialog);
  return sheetDialog;
}

function fillSelect(select, entries, preferred) {
  const options = entries.map(entry =>
    `<option value="${esc(entry.label)}"${entry.label === preferred ? " selected" : ""}>`
    + `${esc(entry.label)} (${entry.count.toLocaleString()})</option>`);
  options.push(`<option value="${NEW_VALUE}">+ Add new\u2026</option>`);
  select.innerHTML = options.join("");
}

function wireNewField(select, field, after) {
  function sync() {
    const adding = select.value === NEW_VALUE;
    field.hidden = !adding;
    if (adding) field.focus();
    if (after) after();
  }
  select.onchange = sync;
  field.hidden = select.value !== NEW_VALUE;
}

// Resolves with the choices, or null if cancelled.
export function askWatchedDetails(item) {
  const options = loadOptions();

  return new Promise(resolve => {
    const node = buildSheetDialog();
    const industry = node.querySelector("#askIndustry");
    const genre = node.querySelector("#askGenre");
    const industryNew = node.querySelector("#askIndustryNew");
    const genreNew = node.querySelector("#askGenreNew");
    const genreHint = node.querySelector("[data-genre-hint]");
    const error = node.querySelector(".gate__error");

    node.querySelector("[data-ask-subject]").innerHTML =
      `Where should <b>${esc(item.title || "this")}</b> go in your sheet?`;

    // A series preselects the series industry; a film keeps whatever it has.
    const isSeries = (item.media_type || "movie") === "tv";
    const seriesEntry = options.industries.find(entry => entry.label.toLowerCase().includes("series"));
    const seriesLabel = seriesEntry ? seriesEntry.label : "";

    fillSelect(industry, options.industries,
      isSeries && seriesLabel ? seriesLabel : (item.category || ""));

    // Industry first, then genre, rebuilt from the rows under the chosen industry. "+ Add new..." is always last.
    function refillGenres() {
      const chosenIndustry = industry.value === NEW_VALUE
        ? industryNew.value.trim()
        : industry.value;

      const scoped = watched.genres(chosenIndustry);
      // A brand new industry has no rows yet, so fall back to every genre rather than offering nothing.
      const entries = scoped.length ? scoped : watched.genres();

      const preferred = (item.genres || []).find(g => entries.some(e => e.label === g))
        || (genre.value && genre.value !== NEW_VALUE && entries.some(e => e.label === genre.value)
            ? genre.value : "");

      fillSelect(genre, entries, preferred);
      genreNew.hidden = genre.value !== NEW_VALUE;
      genreHint.textContent = scoped.length
        ? `${entries.length} genre${entries.length === 1 ? "" : "s"} used under ${chosenIndustry}`
        : "No rows under that industry yet, so every genre is listed";
    }

    industryNew.value = "";
    genreNew.value = "";
    node.querySelector("#askFavorite").checked = false;
    node.querySelector("#askMustWatch").checked = false;
    error.hidden = true;

    wireNewField(industry, industryNew, refillGenres);
    wireNewField(genre, genreNew);
    industryNew.addEventListener("input", refillGenres);
    refillGenres();

    function cleanup(result) {
      node.hidden = true;
      document.body.classList.remove("gate-open");
      node.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      resolve(result);
    }

    function chosen(select, field) {
      return select.value === NEW_VALUE ? field.value.trim() : select.value;
    }

    function save() {
      const pickedIndustry = chosen(industry, industryNew);
      const pickedGenre = chosen(genre, genreNew);

      if (!pickedIndustry) {
        error.textContent = "Pick an industry, or type a new one.";
        error.hidden = false;
        return;
      }
      if (!pickedGenre) {
        error.textContent = "Pick a genre, or type a new one.";
        error.hidden = false;
        return;
      }

      cleanup({
        industry: pickedIndustry,
        genre: pickedGenre,
        favorite: node.querySelector("#askFavorite").checked,
        must_watch: node.querySelector("#askMustWatch").checked
      });
    }

    function onClick(event) {
      if (event.target.closest("[data-ask-close]")) cleanup(null);
      if (event.target.closest("[data-ask-save]")) save();
    }

    function onKey(event) {
      if (event.key === "Escape") cleanup(null);
      if (event.key === "Enter" && event.target.closest(".gate--form")) save();
    }

    node.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);

    closeAnyModal();
    node.hidden = false;
    document.body.classList.add("gate-open");
    setTimeout(() => industry.focus(), 220);
  });
}

// --- the four actions, each taking the card's own data, so no TMDB round trip is needed ---

function rowFor(item, extra) {
  // Both Name and Original Title get TMDB's ENGLISH title: original_title is the film's own script, which the sheet is neither read nor typed in.
  const english = item.title || item.original_title || "";
  return {
    tmdb_id: item.id,
    id: item.id,
    title: english,
    name: english,
    original_title: english,
    og_title: english,
    year: item.year || "",
    poster: item.poster || "",
    media_type: item.media_type || "movie",
    ...extra
  };
}

// sheet_id / watchlist_id hold the id of the row ACTUALLY in the sheet; name and year ride along as the bridge's fallback.
function targetFor(item, sheetIdField) {
  const rowId = item[sheetIdField];
  const english = item.title || item.original_title || "";
  return {
    tmdb_id: rowId != null ? rowId : item.id,
    name: english,
    og_title: item.og_title || english,
    year: item.year || ""
  };
}

export async function markWatched(item, choices) {
  const result = await writer.addWatched(
    rowFor(item, { industry: choices.industry, genre: choices.genre }),
    { mustWatch: choices.must_watch, favorite: choices.favorite }
  );
  // A brand new industry or genre has to appear in the next dialog.
  forgetOptions();
  return result;
}

export function unmarkWatched(item) {
  return writer.removeWatched(targetFor(item, "sheet_id"));
}

export function setFlag(item, flag, value) {
  return writer.setFlags(targetFor(item, "sheet_id"), flag === "favorite"
    ? { favorite: value }
    : { mustWatch: value });
}

export async function addToWatchlist(item) {
  // The Genre column is written on the way in or not at all - the watchlist page groups by it and nothing fills a blank one later.
  const genre = (item.genres && item.genres[0])
    || item.genre
    || await firstGenre(item.id, item.media_type);

  return writer.addWatchlist(rowFor(item, {
    // A queued series has to say so: Industry is the only thing recording film-versus-series, and a TMDB result carries none.
    industry: item.category
      || (item.media_type === "tv" ? SERIES_INDUSTRY : ""),
    genre
  }));
}

export function removeFromWatchlist(item) {
  return writer.removeWatchlist(targetFor(item, "watchlist_id"));
}

// Reflect the session on <body> so CSS can hide owner-only affordances without every component asking.
export function paintOwnerState() {
  document.body.classList.toggle("is-owner", isOwner());
  document.body.classList.toggle("no-writes", !canWrite());
}
