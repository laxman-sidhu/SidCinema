// "me" opens a photograph, one per theme. Neither is fetched until the word is first clicked, so a portrait nobody opens costs nothing.

const SOURCES = {
  light: { src: "assets/images/me-light.webp", alt: "Laxman, in colour" },
  dark: { src: "assets/images/me-dark.webp", alt: "Laxman, in black and white" }
};

let sheet = null;
let opened = false;

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function build() {
  if (sheet) return sheet;

  sheet = document.createElement("div");
  sheet.className = "portrait";
  sheet.hidden = true;
  sheet.innerHTML =
    '<div class="portrait__backdrop" data-portrait-close></div>'
    + '<figure class="portrait__panel" role="dialog" aria-modal="true" aria-label="A photograph of me">'
    + '<button type="button" class="portrait__close" data-portrait-close aria-label="Close">'
    + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'
    + "</button>"
    + '<div class="portrait__frame"><img class="portrait__img" alt="" decoding="async"></div>'
    + '<figcaption class="portrait__cap">Hello \u2014 It\u2019s Me.</figcaption>'
    + "</figure>";

  document.body.appendChild(sheet);

  sheet.addEventListener("click", event => {
    // The backdrop closes it; the photograph does not.
    if (event.target.closest("[data-portrait-close]")) close();
  });

  return sheet;
}

// Swapped whenever the theme changes while it is open, so the toggle keeps working with the sheet up.
function paint() {
  if (!sheet) return;
  const wanted = SOURCES[currentTheme()];
  const img = sheet.querySelector(".portrait__img");
  if (img.getAttribute("src") !== wanted.src) img.setAttribute("src", wanted.src);
  img.setAttribute("alt", wanted.alt);
}

function open() {
  const node = build();
  paint();
  node.hidden = false;

  // The class lands a frame after the unhide, because a transition cannot run from display:none.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => node.classList.add("is-open"));
  });

  document.body.classList.add("portrait-open");
  opened = true;
  setTimeout(() => {
    const close = node.querySelector(".portrait__close");
    if (close) close.focus();
  }, 220);
}

function close() {
  if (!sheet) return;
  sheet.classList.remove("is-open");
  document.body.classList.remove("portrait-open");
  opened = false;
  // Hidden only once the slide has finished, or it vanishes mid-animation.
  setTimeout(() => { if (!opened) sheet.hidden = true; }, 320);
}

export function wirePortrait() {
  const trigger = document.querySelector("[data-portrait-open]");
  if (!trigger) return;

  trigger.addEventListener("click", event => {
    event.preventDefault();
    opened ? close() : open();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && opened) close();
  });

  // Listen for the attribute rather than hooking the theme button, which knows nothing about this.
  new MutationObserver(() => { if (opened) paint(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
