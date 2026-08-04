// One card. Class names here are load bearing: style.css was written against them and never seen in a browser.

import { esc } from "../core/util.js";
import { barMarkup, badgeMarkup } from "./cardactions.js";

function isSeries(item) {
  return item.media_type === "tv";
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function runtimeLabel(minutes) {
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${rest ? `${rest}m` : ""}`.trim() : `${rest}m`;
}

function prettyDate(date) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function cardMarkup(item, { index = 0, showDate = false } = {}) {
  const watched = item.watched === true;
  const delay = Math.min(index * 26, 420);

  // The title renders BEHIND the poster and the <img> is only emitted when TMDB has one - an empty alt draws nothing, so a dead URL is covered too.
  const fallback = `<div class="card__noposter">${esc(item.title)}</div>`;
  const poster = item.poster
    ? `<img src="${esc(item.poster)}" alt="" aria-hidden="true" loading="lazy" decoding="async">`
    : "";
  // Watched, or queued, or neither. Shared with repaint() so a just-clicked card matches one that arrived queued.
  const badge = badgeMarkup(item);

  // What my own list calls it: hover on a pointer device, the (i) button on touch.
  const note = (watched && item.watched_name)
    ? '<button type="button" class="card__note" aria-expanded="false" aria-label="Show how my list names this">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.6"/></svg>'
      + "</button>"
      + '<span class="card__notetip" role="note">'
      + '<span class="card__notetip-label">In my list</span>'
      + esc(item.watched_name)
      + (item.watched_source ? `<span class="card__notetip-source">${esc(item.watched_source)}</span>` : "")
      + "</span>"
    : "";

  // Upcoming cards lead with the date, the one thing worth knowing about a title nobody can watch yet.
  const soon = showDate
    ? `<p class="card__release">${item.release_date ? prettyDate(item.release_date) : "Release date to be announced"}</p>`
    : "";
  const ribbon = showDate ? '<span class="card__soon">Upcoming</span>' : "";

  const facts = [];
  if (item.year) facts.push(`<span>${item.year}</span>`);
  if (isSeries(item) && item.seasons) facts.push(`<span>${plural(item.seasons, "season")}</span>`);
  if (item.language) facts.push(`<span>${esc(item.language)}</span>`);
  if (item.runtime) facts.push(`<span>${runtimeLabel(item.runtime)}${isSeries(item) ? " ep" : ""}</span>`);

  const genres = (item.genres || []).slice(0, 3)
    .map(genre => `<span class="card__genre">${esc(genre)}</span>`).join("");

  const overview = `<p class="card__overview">${esc(item.overview || "No overview on TMDB yet.")}</p>`;

  return '<article class="card'
    + (watched ? " is-watched" : "")
    + (item.watchlisted ? " is-listed" : "")
    + '" role="button" tabindex="0" '
    + `data-id="${item.id}" data-media="${esc(item.media_type)}" `
    + `style="animation-delay:${delay}ms" `
    + `aria-label="${esc(item.title)}${watched ? ", already watched" : ""}">`
    + `<div class="card__poster">${fallback}${poster}${badge}${ribbon}${note}</div>`
    + '<div class="card__body">'
    + `<h3 class="card__title card__scroll">${esc(item.title)}</h3>`
    + soon
    + `<div class="card__facts card__scroll">${facts.join('<span class="dot">/</span>')}</div>`
    + `<div class="card__genres card__scroll">${genres}</div>`
    + overview
    // Where the rating and vote count used to sit - numbers nobody acted on, in the one place actions belong.
    + barMarkup(item)
    + "</div>"
    + "</article>";
}

// A card for a sheet row rather than a TMDB result: no overview, rating or runtime, so the body would be mostly empty.
function sheetCardMarkup(item, { index = 0 } = {}) {
  const delay = Math.min(index * 22, 400);
  const watched = item.watched === true;

  // The title renders BEHIND the poster and the <img> is only emitted when TMDB has one - an empty alt draws nothing, so a dead URL is covered too.
  const fallback = `<div class="card__noposter">${esc(item.title)}</div>`;
  const poster = item.poster
    ? `<img src="${esc(item.poster)}" alt="" aria-hidden="true" loading="lazy" decoding="async">`
    : "";
  const badge = badgeMarkup(item);

  const facts = [];
  if (item.year) facts.push(`<span>${item.year}</span>`);
  if (item.category) facts.push(`<span>${esc(item.category)}</span>`);
  if (item.media_type === "tv") facts.push("<span>Series</span>");

  const genres = (item.genres || []).slice(0, 3)
    .map(genre => `<span class="card__genre">${esc(genre)}</span>`).join("");

  return '<article class="card card--sheet'
    + (watched ? " is-watched" : "")
    + (item.watchlisted ? " is-listed" : "")
    + '" role="button" tabindex="0" '
    + `data-id="${item.id == null ? "" : item.id}" data-media="${esc(item.media_type || "movie")}" `
    + `style="animation-delay:${delay}ms" aria-label="${esc(item.title)}">`
    + `<div class="card__poster">${fallback}${poster}${badge}</div>`
    + '<div class="card__body">'
    + `<h3 class="card__title card__scroll">${esc(item.title)}</h3>`
    + `<div class="card__facts card__scroll">${facts.join('<span class="dot">/</span>')}</div>`
    + `<div class="card__genres card__scroll">${genres}</div>`
    + barMarkup(item)
    + "</div>"
    + "</article>";
}

export function gridMarkup(items, { showDate = false, sheet = false } = {}) {
  const render = sheet ? sheetCardMarkup : cardMarkup;
  return `<div class="grid">${items.map((item, index) => render(item, { index, showDate })).join("")}</div>`;
}
