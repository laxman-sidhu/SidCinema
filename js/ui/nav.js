// One navbar for all three pages.
//
// Previously each page hand-wrote its own, and they disagreed: the library had
// no Favourites link, so getting from Must watch to Favourites meant going back
// to the search page first. Building it from one list means adding a destination
// is a change in one place and every page gets it.
//
// Every destination stays visible on every page. An earlier version dropped the
// entry for the page you were on, which is tidy but wrong for a navbar: the row
// changed shape as you moved, and nothing told you where you were. The current
// page is marked instead, and its own entry becomes inert.
//
// There is no Search entry. The wordmark is the way back to the search page,
// which is what a wordmark is for, and one fewer icon leaves room for the four
// collections to keep their labels on a narrow screen.
//
// The wordmark sits first and left-aligned. The browse control is last, at the
// far right, and the drawer it opens slides in from that same edge - reaching
// across the width to a panel arriving from the opposite side reads as wrong
// every time.

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

// Which entry is the page you are on. The library link and its two views share
// one page, so the view in the URL decides between them.
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
    // aria-current is what a screen reader announces; the class is what the eye
    // reads. Both are needed, and neither substitutes for the other.
    return `<a class="icon-btn icon-btn--label${current ? " is-current" : ""}" `
      + `href="${link.href}" title="${link.title}"`
      + (current ? ' aria-current="page"' : "")
      + `><svg viewBox="0 0 24 24" aria-hidden="true">${link.icon}</svg>`
      + `<span class="icon-btn__text">${link.label}</span></a>`;
  }).join("");

  // Only the search page has a catalogue to browse, so only it gets the control.
  const browseBtn = browse
    ? '<button class="icon-btn icon-btn--browse" id="filterToggle" type="button" '
      + 'aria-expanded="false" aria-controls="filterPanel" '
      + 'aria-label="Browse by genre, language, year" title="Browse the whole catalogue">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
      + '<span class="icon-btn__count" id="filterCount" hidden>0</span></button>'
    : "";

  const refresh = '<button class="icon-btn" id="refreshBtn" type="button" '
    + 'aria-label="Reload from the sheet" title="Reload from the sheet">'
    + '<span class="icon-btn__dot" id="libraryDot"></span>'
    + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>'
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

  host.innerHTML = links + refresh + theme + browseBtn;
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
