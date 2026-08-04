// One navbar for all three pages, from one list. Every destination stays visible and the current one is marked rather than hidden; the wordmark is the way back to search.

import * as toast from "./toast.js";

const LINKS = [
  {
    key: "library",
    href: "watched.html",
    label: "Library",
    title: "Everything I have watched",
    icon: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h4A1.5 1.5 0 0 1 11 5.5v13A1.5 1.5 0 0 1 9.5 20h-4A1.5 1.5 0 0 1 4 18.5Z"/>'
        + '<path d="M13 5.5A1.5 1.5 0 0 1 14.5 4h4A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5Z"/>'
        + '<path d="M7.5 8v2M16.5 8v2"/>'
  },
  {
    key: "favorite",
    href: "watched.html?view=favorite",
    label: "Favourites",
    title: "Everything I loved",
    icon: '<path d="M12 20s-7-4.4-7-9.3A3.7 3.7 0 0 1 12 8a3.7 3.7 0 0 1 7 2.7C19 15.6 12 20 12 20z"/>'
  },
  {
    key: "must_watch",
    href: "watched.html?view=must_watch",
    label: "Must watch",
    title: "The ones worth telling people about",
    icon: '<path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.6-.8z"/>'
  },
  {
    key: "watchlist",
    href: "watchlist.html",
    label: "Watchlist",
    title: "Everything queued up to watch",
    icon: '<path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4.5L5 20V5a1 1 0 0 1 1-1Z"/>'
  }
];

// Which entry is the page you are on. The library link and its two views share one page, so the URL decides between them.
function currentKey() {
  const file = window.location.pathname.split("/").pop() || "index.html";
  if (file === "" || file === "index.html") return "search";
  if (file === "watchlist.html") return "watchlist";
  if (file === "watched.html") {
    const view = new URL(window.location.href).searchParams.get("view");
    if (view === "favorite") return "favorite";
    if (view === "must_watch") return "must_watch";
    return "library";
  }
  return "search";
}

export function paintNav({ browse = false } = {}) {
  const host = document.getElementById("navTools");
  if (!host) return;

  const here = currentKey();

  const links = LINKS.map(link => {
    const current = link.key === here;
    // aria-current is what a screen reader announces and the class is what the eye reads; neither substitutes for the other.
    return `<a class="icon-btn icon-btn--label${current ? " is-current" : ""}" `
      + `href="${link.href}" title="${link.title}"`
      + (current ? ' aria-current="page"' : "")
      + `><svg viewBox="0 0 24 24" aria-hidden="true">${link.icon}</svg>`
      + `<span class="icon-btn__text">${link.label}</span></a>`;
  }).join("");

  // The same four destinations folded into one control on a narrow screen, because four unlabelled glyphs name nothing. Both layouts stay in the DOM and CSS shows one.
  const here_link = LINKS.find(link => link.key === here);
  const menuItems = LINKS.map(link => {
    const current = link.key === here;
    return `<a class="navmenu__item${current ? " is-current" : ""}" href="${link.href}"`
      + (current ? ' aria-current="page"' : "")
      + `><svg viewBox="0 0 24 24" aria-hidden="true">${link.icon}</svg>`
      + `<span>${link.label}</span></a>`;
  }).join("");

  const menu = '<div class="navmenu">'
    + '<button class="icon-btn icon-btn--label navmenu__trigger" id="navMenuBtn" type="button" '
    + 'aria-expanded="false" aria-haspopup="true" aria-controls="navMenuList" '
    + 'title="Go to a collection">'
    + `<svg viewBox="0 0 24 24" aria-hidden="true">${here_link ? here_link.icon : LINKS[0].icon}</svg>`
    + `<span class="icon-btn__text">${here_link ? here_link.label : "Collections"}</span>`
    + '<svg class="navmenu__caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
    + "</button>"
    + `<div class="navmenu__list" id="navMenuList" role="menu" hidden>${menuItems}</div>`
    + "</div>";

  // The list LIVES ON <body>: .topbar__tools has overflow-x and .topbar has backdrop-filter, either of which would clip or trap it.

  // Only the search page has a catalogue to browse, so only it gets the control.
  const browseBtn = browse
    ? '<button class="icon-btn icon-btn--browse" id="filterToggle" type="button" '
      + 'aria-expanded="false" aria-controls="filterPanel" '
      + 'aria-label="Browse by genre, language, year" title="Browse the whole catalogue">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
      + '<span class="icon-btn__count" id="filterCount" hidden>0</span></button>'
    : "";

  // Both glyphs are mounted and CSS shows one, so settling to the tick is a class change rather than a re-render that would lose the listener.
  const refresh = '<button class="icon-btn icon-btn--refresh" id="refreshBtn" type="button" '
    + 'aria-label="Reload from the sheet" title="Reload from the sheet">'
    + '<span class="icon-btn__dot" id="libraryDot"></span>'
    + '<svg class="icon-btn__arrows" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>'
    + '<svg class="icon-btn__done" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="m4.5 12.5 5 5 10-11"/></svg>'
    + "</button>";

  const theme = '<button class="icon-btn theme-btn" id="themeBtn" type="button" '
    + 'title="Switch theme" aria-label="Switch theme" aria-pressed="false">'
    + '<svg class="theme-btn__sun" viewBox="0 0 24 24" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="4.2"/>'
    + '<path d="M12 2.4v2.4M12 19.2v2.4M4.2 12H1.8M22.2 12h-2.4M6.5 6.5 4.8 4.8M19.2 19.2l-1.7-1.7M17.5 6.5l1.7-1.7M4.8 19.2l1.7-1.7"/>'
    + "</svg>"
    + '<svg class="theme-btn__moon" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1Z"/>'
    + "</svg></button>";

  // A previous paint's menu: paintNav runs again on every view change, and a stale one would point at a trigger that no longer exists.
  const stale = document.getElementById("navMenuList");
  if (stale && stale.parentNode && stale.parentNode !== host) stale.remove();

  // Order is the same at both widths: destinations, the two tools, then browse at the far right beside the drawer it opens.
  host.innerHTML = menu + links + refresh + theme + browseBtn;

  const list = host.querySelector ? host.querySelector("#navMenuList") : null;
  if (list && document.body) document.body.appendChild(list);

  wireNavMenu();
}

// Under the trigger, measured rather than assumed: the header is 68px on desktop and 58px on a phone, and moves again inside a notch.
function placeNavMenu() {
  const trigger = document.getElementById("navMenuBtn");
  const list = document.getElementById("navMenuList");
  if (!trigger || !list) return;

  const box = trigger.getBoundingClientRect();
  list.style.top = `${Math.round(box.bottom + 8)}px`;
  list.style.left = `${Math.round(box.left)}px`;
}

// Bound to the document, not the button: paintNav() replaces the trigger whenever the view changes.
let menuWired = false;

function wireNavMenu() {
  if (menuWired) return;
  menuWired = true;

  const close = () => {
    const trigger = document.getElementById("navMenuBtn");
    const list = document.getElementById("navMenuList");
    if (!trigger || !list) return;
    trigger.setAttribute("aria-expanded", "false");
    list.hidden = true;
  };

  document.addEventListener("click", event => {
    const trigger = event.target.closest("#navMenuBtn");
    const list = document.getElementById("navMenuList");
    if (!list) return;

    if (!trigger) {
      // A tap on an entry navigates, and a tap anywhere else means "not this".
      if (!event.target.closest("#navMenuList") || event.target.closest(".navmenu__item")) close();
      return;
    }

    event.preventDefault();
    const open = trigger.getAttribute("aria-expanded") === "true";
    trigger.setAttribute("aria-expanded", open ? "false" : "true");
    // Placed before it is shown, or the first frame lands in the top left corner and slides across.
    if (!open) placeNavMenu();
    list.hidden = open;
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") close();
  });

  // A menu anchored to a bar that has moved is worse than no menu, so both of these close it.
  window.addEventListener("resize", close);
  window.addEventListener("scroll", close, { passive: true });
}

// The reload button, on every page rather than one. It reports three times - spinner, tick, toast - and refuses a second click while the first read is in flight.
export function wireRefresh(job) {
  const button = document.getElementById("refreshBtn");
  if (!button || typeof job !== "function") return;

  let busy = false;

  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    button.classList.add("is-busy");
    button.classList.remove("is-done");
    button.setAttribute("aria-busy", "true");

    const note = toast.pending("Reloading from the sheet\u2026");

    try {
      const summary = await job();
      note.succeed(summary || "Reloaded from the sheet");

      // A tick where the arrows were, for a moment: the control answering for itself.
      button.classList.add("is-done");
      setTimeout(() => button.classList.remove("is-done"), 1600);

      // The pip means "the sheet has moved since this page loaded", and it has just been caught up with.
      const dot = document.getElementById("libraryDot");
      if (dot) dot.classList.remove("is-on");
    } catch (error) {
      note.fail((error && error.message) || "Could not reload the sheet.");
    } finally {
      busy = false;
      button.classList.remove("is-busy");
      button.removeAttribute("aria-busy");
    }
  });
}

// Shared by every page so the theme button behaves identically everywhere.
export function wireTheme() {
  const button = document.getElementById("themeBtn");
  if (!button) return;

  button.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.bsTheme = dark ? "dark" : "light";
    button.setAttribute("aria-pressed", dark ? "true" : "false");
    try { localStorage.setItem("sidcinema-theme", dark ? "dark" : "light"); } catch { /* ignore */ }
    const meta = document.getElementById("themeColor");
    if (meta) meta.setAttribute("content", dark ? "#0d1117" : "#fafbfd");
  });
}
