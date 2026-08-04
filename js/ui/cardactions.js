// Every write you can start from a card. The menu lives on <body> because .card is overflow:hidden, and each click repaints optimistically from a snapshot restored exactly on failure.

import { esc } from "../core/util.js";
import * as toast from "./toast.js";
import * as actions from "./actions.js";

const ICONS = {
  watched: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.5 12.5 5 5 10-11"/></svg>',
  // The same glyph either way, so only the fill changes and the row never shifts.
  watchlist: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.3.3 0 0 1-.47.25L12 16.4l-6.03 4.05a.3.3 0 0 1-.47-.25V4a.5.5 0 0 1 .5-.5Z"/></svg>',
  favorite: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-9.3A3.7 3.7 0 0 1 12 8a3.7 3.7 0 0 1 7 2.7C19 15.6 12 20 12 20z"/></svg>',
  must: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.6-.8z"/></svg>'
};

const BOOKMARK = '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.3.3 0 0 1-.47.25L12 16.4l-6.03 4.05a.3.3 0 0 1-.47-.25V4a.5.5 0 0 1 .5-.5Z"/></svg>';

// Watched wins over queued: the two are mutually exclusive, so this only decides the frame between a click and its write.
export function badgeMarkup(item) {
  if (item && item.watched === true) {
    return '<span class="card__badge">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.5 12.5 5 5 10-11"/></svg>'
      + "Watched</span>";
  }
  if (item && item.watchlisted === true) {
    return `<span class="card__badge card__badge--listed">${BOOKMARK}Watchlist</span>`;
  }
  return "";
}

const DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>';

// Which toggles a card shows follows what the sheet can record; the watched tick is always last, in the same place on every card.
export function barFor(item) {
  const watched = item.watched === true;
  const rows = [];

  if (watched) {
    rows.push({ act: "favorite", icon: "favorite", on: item.favorite === true, side: "left",
      label: item.favorite ? "In Favourites \u2014 tap to remove" : "Add to Favourites" });
    rows.push({ act: "must", icon: "must", on: item.must_watch === true, side: "left",
      label: item.must_watch ? "In Must watch \u2014 tap to remove" : "Mark as Must watch" });
  } else {
    rows.push({ act: "watchlist", icon: "watchlist", on: item.watchlisted === true, side: "right",
      label: item.watchlisted ? "On the watchlist \u2014 tap to remove" : "Add to watchlist" });
  }

  rows.push({ act: "watched", icon: "watched", on: watched, side: "right",
    label: watched ? "Watched \u2014 tap to undo" : "Mark as watched" });

  return rows;
}

export function barMarkup(item) {
  if (!item || item.id == null || item.id === "") return "";

  const buttons = barFor(item);
  const render = b =>
    `<button type="button" class="cardact cardbar__btn cardbar__btn--${b.act}${b.on ? " is-on" : ""}" `
    + `data-act="${b.act}" aria-pressed="${b.on}" `
    + `title="${esc(b.label)}" aria-label="${esc(b.label)}">${ICONS[b.icon]}</button>`;

  return '<div class="cardbar" data-bar>'
    + `<div class="cardbar__side">${buttons.filter(b => b.side === "left").map(render).join("")}</div>`
    + `<div class="cardbar__side cardbar__side--end">${buttons.filter(b => b.side === "right").map(render).join("")}</div>`
    + "</div>";
}

export function repaint(card, item) {

  // The bar carries the flag state, so it is rebuilt too or a heart filled from the card would not stay filled.
  const bar = card.querySelector("[data-bar]");
  if (bar) bar.outerHTML = barMarkup(item);
  card.classList.toggle("is-watched", item.watched === true);
  card.classList.toggle("is-listed", item.watchlisted === true);

  // One badge with two possible states, so it is rebuilt rather than added and removed.
  const badge = card.querySelector(".card__badge");
  if (badge) badge.remove();
  const wanted = badgeMarkup(item);
  if (wanted) {
    const poster = card.querySelector(".card__poster");
    if (poster) poster.insertAdjacentHTML("afterbegin", wanted);
  }
}

// --- running an action ------------------------------------------------------

const WORDING = {
  watched_add: ["Adding to watched", "Added to watched"],
  watched_remove: ["Removing from watched", "Removed from watched"],
  watchlist_add: ["Adding to watchlist", "Added to watchlist"],
  watchlist_remove: ["Removing from watchlist", "Removed from watchlist"],
  favorite_add: ["Adding to Favourites", "Added to Favourites"],
  favorite_remove: ["Removing from Favourites", "Removed from Favourites"],
  must_add: ["Marking as Must watch", "Marked as Must watch"],
  must_remove: ["Removing from Must watch", "Removed from Must watch"]
};

function pendingFor(key, title) {
  const [doing, done] = WORDING[key];
  const handle = toast.pending(`${doing}\u2026`);
  return {
    ok: () => handle.succeed(title ? `${done} \u2014 ${title}` : done),
    no: message => handle.fail(message)
  };
}

export function attach(container, find, options = {}) {
  if (!container) return;

  container.addEventListener("click", event => {
    const toggle = event.target.closest(".cardbar__btn");
    if (!toggle) return;

    // Or the click reaches the card and opens the detail modal over it.
    event.preventDefault();
    event.stopPropagation();
    if (toggle.disabled || toggle.classList.contains("is-working")) return;

    const card = toggle.closest(".card");
    const item = find(card);
    if (!item) return;

    actions.withOwner(() => run(toggle.dataset.act, card, item, options));
  });
}

async function run(action, card, item, options) {
  const before = {
    watched: item.watched,
    watchlisted: item.watchlisted,
    favorite: item.favorite,
    must_watch: item.must_watch,
    category: item.category,
    watched_source: item.watched_source,
    // Which row in the sheet this card stands for, restored on failure or the next click writes to a row that was never created.
    sheet_id: item.sheet_id,
    watchlist_id: item.watchlist_id
  };

  // The toast carries the story; nothing else on the card is disabled, so a second title can be added while this one saves.
  card.classList.add("is-saving");
  const pressed = card.querySelector(`.cardbar__btn--${action}`);
  if (pressed) pressed.classList.add("is-working");

  let note = null;

  try {
    if (action === "watched") {
      if (item.watched) {
        note = pendingFor("watched_remove", item.title);
        item.watched = false;
        item.favorite = false;
        item.must_watch = false;
        repaint(card, item);
        await actions.unmarkWatched(item);
        item.sheet_id = null;
      } else {
        // The only action needing more than a click: TMDB knows a production country, not whether a film is Bollywood or Other Language.
        const choices = await actions.askWatchedDetails(item);
        if (!choices) {
          card.classList.remove("is-saving");
          return;
        }
        note = pendingFor("watched_add", item.title);
        item.watched = true;
        item.watchlisted = false;
        item.favorite = choices.favorite;
        item.must_watch = choices.must_watch;
        item.category = choices.industry;
        item.watched_source = choices.industry;
        item.genre = choices.genre;
        item.industry = choices.industry;
        repaint(card, item);
        const saved = await actions.markWatched(item, choices);
        // The row that now exists in All Watched, which is what the next flag write has to address.
        if (saved && saved.row) item.sheet_id = saved.row.tmdb_id;
        item.watchlist_id = null;
      }
    } else if (action === "watchlist") {
      if (item.watchlisted) {
        note = pendingFor("watchlist_remove", item.title);
        item.watchlisted = false;
        repaint(card, item);
        await actions.removeFromWatchlist(item);
        item.watchlist_id = null;
      } else {
        note = pendingFor("watchlist_add", item.title);
        item.watchlisted = true;
        repaint(card, item);
        const queued = await actions.addToWatchlist(item);
        // Either the row just appended or the one already there under TMDB's other id for this film.
        if (queued && queued.row) item.watchlist_id = queued.row.tmdb_id;
      }
    } else if (action === "favorite") {
      const next = !item.favorite;
      note = pendingFor(next ? "favorite_add" : "favorite_remove", item.title);
      item.favorite = next;
      repaint(card, item);
      await actions.setFlag(item, "favorite", next);
    } else if (action === "must") {
      const next = !item.must_watch;
      note = pendingFor(next ? "must_add" : "must_remove", item.title);
      item.must_watch = next;
      repaint(card, item);
      await actions.setFlag(item, "must_watch", next);
    }

    if (note) note.ok();
    if (typeof options.onChange === "function") options.onChange(item, action);
  } catch (failure) {
    Object.assign(item, before);
    repaint(card, item);
    const message = failure && failure.message ? failure.message : "That did not save.";
    if (note) note.no(message);
    else toast.error(message);
  } finally {
    card.classList.remove("is-saving");
    // repaint() replaced the button, so re-find it rather than reusing a handle that is now detached.
    const again = card.querySelector(`.cardbar__btn--${action}`);
    if (again) again.classList.remove("is-working");
  }
}
