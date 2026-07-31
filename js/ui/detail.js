// The title modal, shared by all pages. Opens on a card click and fetches the
// full record from TMDB, because a card carries only what a list endpoint gave.

import { esc } from "../core/util.js";
import { details } from "../tmdb/queries.js";
import { watched } from "../data/watched.js";
import { watchlist } from "../data/watchlist.js";

const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const OUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

const TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.5 12.5 5 5 10-11"/></svg>';

let modal = null;
let body = null;
let requestId = 0;

function instance() {
  if (!modal) {
    const node = document.getElementById("detailModal");
    if (!node) return null;
    body = document.getElementById("detailBody");
    modal = window.bootstrap && window.bootstrap.Modal
      ? new window.bootstrap.Modal(node)
      : null;
  }
  return modal;
}

// Up to two initials. Anything more is unreadable at 76px, and a single letter
// is ambiguous across a cast list.
function initials(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1
    ? words[0].slice(0, 1)
    : words[0].slice(0, 1) + words[words.length - 1].slice(0, 1);
  return letters.toUpperCase();
}

// A face, or the initials in its place. NOT the poster placeholder: that is a
// 2:3 film-poster graphic, and a row of them under a cast list reads as a row of
// missing films rather than people whose photo TMDB happens to lack.
//
// Deliberately one neutral treatment rather than a colour per person. Green and
// gold already mean watched and must-watch everywhere else in this app, and
// borrowing them for decoration would spend meaning that is already committed.
function faceFor(person) {
  // The initials sit BEHIND the photo rather than being swapped in by an error
  // handler. An <img> with an empty alt that fails to load renders nothing, so
  // the letters underneath simply show through - no inline script, and it covers
  // a broken URL as well as a missing one.
  const ini = `<span class="detail__face-ini">${esc(initials(person.name))}</span>`;
  const photo = person.profile
    ? `<img src="${esc(person.profile)}" alt="" loading="lazy" decoding="async">`
    : "";
  return `<span class="detail__face" aria-hidden="true">${ini}${photo}</span>`;
}

function prettyDate(date) {
  const parsed = new Date(`${date}T00:00:00`);
  // TMDB dates are occasionally partial or malformed; show the raw string rather
  // than "Invalid Date".
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function compact(count) {
  if (!count) return "0";
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${Math.round(count / 1000)}k`;
  return String(count);
}

function money(value) {
  if (!value) return null;
  if (value >= 1000000000) return `$${(value / 1000000000).toFixed(2)}B`;
  if (value >= 1000000) return `$${Math.round(value / 1000000)}M`;
  return `$${value.toLocaleString()}`;
}

function runtimeLabel(minutes) {
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${rest ? `${rest}m` : ""}`.trim() : `${rest}m`;
}

const BOOKMARK = '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.3.3 0 0 1-.47.25L12 16.4l-6.03 4.05a.3.3 0 0 1-.47-.25V4a.5.5 0 0 1 .5-.5Z"/></svg>';

function render(item) {
  const isTv = item.media_type === "tv";
  const seen = item.watched === true;
  // The queue state belongs here too. The modal is the other place a title is
  // looked at, and it said nothing about the watchlist at all.
  const queued = !seen && item.watchlisted === true;
  const kind = isTv ? "Web series" : "Film";

  const heroStyle = item.backdrop ? `background-image:url('${esc(item.backdrop)}')` : "";

  // The rating rides in the facts line rather than in a tile of its own. It is
  // the one number people read before deciding, so it belongs beside the year and
  // the runtime, not three sections further down.
  const facts = [];
  if (item.year) facts.push(`<span>${item.year}</span>`);
  if (item.runtime) facts.push(`<span>${runtimeLabel(item.runtime)}${isTv ? " per ep" : ""}</span>`);
  if (item.language) facts.push(`<span>${esc(item.language)}</span>`);
  if (isTv && item.seasons) facts.push(`<span>${item.seasons} season${item.seasons === 1 ? "" : "s"}</span>`);
  if (item.rating > 0) {
    facts.push(`<span class="detail__rate">${item.rating.toFixed(1)}</span>`);
    facts.push(`<span>${compact(item.vote_count)} votes</span>`);
  }

  // The trailer leads and the reference links follow. On a phone the trailer
  // takes the whole first row and the rest share the second - see the grid rule
  // in the stylesheet, which relies on .btn-solid being the only solid one here.
  const buttons = [];
  if (item.trailer) {
    buttons.push(`<button type="button" class="btn-solid" data-trailer="${esc(item.trailer.key)}">`
      + `${PLAY}Watch trailer</button>`);
  }
  if (item.imdb_id) {
    buttons.push(`<a class="btn-outline" href="https://www.imdb.com/title/${esc(item.imdb_id)}/" `
      + `target="_blank" rel="noopener">${OUT}IMDb</a>`);
  }
  buttons.push(`<a class="btn-outline" href="https://www.themoviedb.org/${item.media_type}/${item.id}" `
    + `target="_blank" rel="noopener">${OUT}TMDB</a>`);
  if (item.homepage) {
    buttons.push(`<a class="btn-outline" href="${esc(item.homepage)}" target="_blank" rel="noopener">`
      + `${OUT}Official site</a>`);
  }

  const genres = (item.genres || [])
    .map(genre => `<span class="detail__chip">${esc(genre)}</span>`).join("");

  // A fixed grid, label above value. Every cell is always present so the grid
  // keeps its shape between titles - an em dash says "TMDB has no figure" and
  // an absent cell says nothing at all, which is worse. A film that has not
  // opened has no box office yet, and that is the commonest case here.
  const cells = [
    ["Release date", item.release_date ? prettyDate(item.release_date) : "\u2014"],
    [isTv ? "Episode length" : "Runtime", item.runtime ? runtimeLabel(item.runtime) : "\u2014"],
    [isTv ? "Created by" : "Director",
      (item.directors || []).map(person => person.name).join(", ") || "\u2014"]
  ];
  if (isTv) {
    cells.push(["Seasons", item.seasons ? String(item.seasons) : "\u2014"]);
    cells.push(["Episodes", item.episodes ? String(item.episodes) : "\u2014"]);
  } else {
    cells.push(["Budget", item.budget ? money(item.budget) : "\u2014"]);
    cells.push(["Box office", item.revenue ? money(item.revenue) : "\u2014"]);
  }
  cells.push(["Status", item.status || "\u2014"]);

  const numbers = cells.map(([label, value]) =>
    '<div class="detail__cell">'
    + `<span class="detail__cell-key">${esc(label)}</span>`
    + `<span class="detail__cell-val">${esc(value)}</span></div>`).join("");

  const seasons = (item.season_list || []).slice(0, 8)
    .map(season => `<span class="detail__chip">${esc(season.name)}${season.episodes ? ` \u00b7 ${season.episodes} ep` : ""}</span>`)
    .join("");

  const cast = (item.cast || []).map(person =>
    '<div class="detail__person">'
    + faceFor(person)
    + `<span class="detail__person-name">${esc(person.name)}</span>`
    + (person.character ? `<span class="detail__person-role">${esc(person.character)}</span>` : "")
    + "</div>").join("");

  const similar = (item.similar || []).map(other =>
    `<button type="button" class="detail__similar" data-jump="${other.id}" data-jump-media="${esc(other.media_type)}">`
    + '<span class="detail__similar-art">'
    + `<span class="detail__similar-alt">${esc(other.title)}</span>`
    + (other.poster ? `<img src="${esc(other.poster)}" alt="" loading="lazy">` : "")
    + "</span>"
    + `<span>${esc(other.title)}</span>`
    + (other.watched ? `<span class="detail__similar-seen">${TICK}</span>` : "")
    + "</button>").join("");

  return ''
    + `<div class="detail__hero${item.backdrop ? "" : " is-blank"}" style="${heroStyle}"></div>`
    + '<div class="detail__head">'
    + `<span class="detail__poster${seen ? " is-watched" : ""}">`
    + `<span class="detail__poster-alt">${esc(item.title)}</span>`
    + (item.poster ? `<img src="${esc(item.poster)}" alt="" loading="lazy">` : "")
    + "</span>"
    + '<div class="detail__headline">'
    + `<p class="detail__kind">${kind}</p>`
    + (seen ? `<div class="detail__seen">${TICK}Already watched</div>` : "")
    + (queued ? `<div class="detail__seen detail__seen--listed">${BOOKMARK}On the watchlist</div>` : "")
    + `<h2 class="detail__title" id="modalTitle">${esc(item.title)}</h2>`
    + (item.original_title && item.original_title !== item.title
      ? `<p class="detail__original">${esc(item.original_title)}</p>` : "")
    + (item.tagline ? `<p class="detail__tagline">${esc(item.tagline)}</p>` : "")
    + `<div class="detail__facts">${facts.join('<span class="dot">/</span>')}</div>`
    + `<div class="detail__actions">${buttons.join("")}</div>`
    + "</div></div>"
    + '<div class="detail__main">'
    + '<div class="detail__section" id="trailerSlot"></div>'
    + '<div class="detail__section">'
    + '<p class="detail__label">Overview</p>'
    + `<p class="detail__overview">${esc(item.overview || "TMDB has no overview for this one yet.")}</p>`
    + "</div>"
    + (genres ? `<div class="detail__section"><p class="detail__label">Genres</p><div class="detail__chips">${genres}</div></div>` : "")
    + `<div class="detail__section"><p class="detail__label">The numbers</p><div class="detail__grid">${numbers}</div></div>`
    + (seasons ? `<div class="detail__section"><p class="detail__label">Seasons</p><div class="detail__chips">${seasons}</div></div>` : "")
    + (cast ? `<div class="detail__section"><p class="detail__label">Cast</p><div class="detail__people">${cast}</div></div>` : "")
    + (similar ? `<div class="detail__section"><p class="detail__label">More like this</p><div class="detail__similars">${similar}</div></div>` : "")
    + "</div>";
}

// A pointer can hover; a finger cannot. That is the only reliable signal for
// "this is a touch device" that does not involve sniffing user agents.
function isTouch() {
  return window.matchMedia("(hover: none)").matches;
}

function openTrailer(key) {
  const slot = document.getElementById("trailerSlot");
  if (!slot) return;
  // The close button sits ABOVE the video, not on it. Inside the frame it landed
  // on YouTube's own settings and fullscreen controls, so the two fought for the
  // same corner and either could be hit by mistake.
  slot.innerHTML = '<div class="detail__trailer">'
    + '<div class="detail__trailer-bar">'
    + '<span class="detail__trailer-label">Trailer</span>'
    + '<button type="button" class="detail__trailer-close" data-trailer-close '
    + 'aria-label="Close the trailer" title="Close the trailer">'
    + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'
    + "</button></div>"
    + '<div class="detail__video">'
    + `<iframe src="https://www.youtube.com/embed/${esc(key)}?autoplay=1" title="Trailer" `
    + 'allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture" '
    + 'allowfullscreen loading="lazy"></iframe></div></div>';
  // Guarded: not every environment implements it, and failing to scroll should
  // never stop the video from playing.
  if (typeof slot.scrollIntoView === "function") {
    slot.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function closeTrailer() {
  const slot = document.getElementById("trailerSlot");
  // Emptying the slot is what stops the audio. Hiding it would leave the video
  // playing behind a closed panel.
  if (slot) slot.innerHTML = "";
}

function wire() {
  if (!body || body.dataset.wired) return;
  body.dataset.wired = "1";

  body.addEventListener("click", event => {
    const trailer = event.target.closest("[data-trailer]");
    if (trailer) {
      openTrailer(trailer.dataset.trailer);
      return;
    }

    if (event.target.closest("[data-trailer-close]")) {
      closeTrailer();
      return;
    }

    // On a pointer device, a click anywhere else in the modal puts the video
    // away - the quickest gesture for the commonest intention.
    //
    // NOT on touch. A phone gets handled carelessly and a stray thumb anywhere
    // on the sheet would kill a video mid-scene, so there the explicit close
    // button is the only way out. Same reason a swipe-to-delete needs a
    // confirmation and a click-to-delete does not.
    if (!isTouch() && document.getElementById("trailerSlot").firstChild
        && !event.target.closest(".detail__trailer")) {
      closeTrailer();
    }

    const jump = event.target.closest("[data-jump]");
    if (jump) open(jump.dataset.jump, jump.dataset.jumpMedia);
  });
}

export async function open(itemId, media) {
  const shell = instance();
  if (!shell || !body) return;

  wire();
  const ticket = ++requestId;

  body.innerHTML = '<div class="detail__loading"><span class="spinner"></span><p>Loading the details\u2026</p></div>';
  shell.show();

  try {
    const item = await details(itemId, media);
    if (ticket !== requestId) return;   // a later click won

    watched.annotate(item);
    watchlist.annotate(item);
    item.similar = watchlist.annotateAll(watched.annotateAll(item.similar || []));

    body.innerHTML = render(item);
  } catch (error) {
    if (ticket !== requestId) return;
    body.innerHTML = '<div class="detail__loading"><p><strong>Could not load that title.</strong></p>'
      + `<p>${esc(error.message)}</p></div>`;
  }
}

// Controls that live inside a card but must not open it. stopPropagation is not
// enough on its own: the card handler is bound to the same container and
// registered first, and stopPropagation only stops a click travelling UP, not a
// sibling listener on the same element. If you add another in-card control, add
// it here.
const IN_CARD = ".cardact, .card__note";

// The "what my sheet calls it" tip.
//
// On a pointer device it appears on hover. A touch screen has no hover, so the
// (i) button carries it there, and the whole feature was invisible on a phone
// until this existed. Tapping it again closes it, as does tapping anywhere else
// - a tip that can only be opened is a tip stuck open.
let noteWired = false;

function wireNotes() {
  if (noteWired) return;
  noteWired = true;

  document.addEventListener("click", event => {
    const button = event.target.closest(".card__note");

    document.querySelectorAll('.card__note[aria-expanded="true"]').forEach(open => {
      if (open !== button) open.setAttribute("aria-expanded", "false");
    });

    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const showing = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", showing ? "false" : "true");
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    document.querySelectorAll('.card__note[aria-expanded="true"]')
      .forEach(open => open.setAttribute("aria-expanded", "false"));
  });
}

export function attach(container, { onOpen } = {}) {
  if (!container) return;
  wireNotes();

  container.addEventListener("click", event => {
    if (event.target.closest(IN_CARD)) return;
    const card = event.target.closest(".card");
    if (!card) return;
    if (onOpen) onOpen(card);
    open(card.dataset.id, card.dataset.media);
  });

  container.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.closest(IN_CARD)) return;
    const card = event.target.closest(".card");
    if (!card) return;
    event.preventDefault();
    open(card.dataset.id, card.dataset.media);
  });
}
