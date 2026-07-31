// The detail modal, rendered from a real TMDB payload in a real DOM.
// Optional: needs jsdom. Skips cleanly without it.

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let JSDOM;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  console.log("SKIPPED - jsdom is not installed. `npm install` to run this suite.");
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const html = fs.readFileSync(path.join(ROOT, "watched.html"), "utf8").replace(/<link[^>]*>/g,"").replace(/<script src=[^>]*><\/script>/g,"");
const dom = new JSDOM(html, { url:"http://localhost/watched.html", pretendToBeVisual:true });
const { window } = dom;
window.PAGE_CONFIG = { views:true, eyebrow:"My library", title:"x" };
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage,
  sessionStorage: window.sessionStorage, CustomEvent: window.CustomEvent, URL,
  requestAnimationFrame: fn=>setTimeout(fn,0), performance:{now:()=>Date.now()} });

// jsdom has no matchMedia
let touch = false;
window.matchMedia = q => ({ matches: q.includes("hover: none") ? touch : false });

// An unreleased film: no revenue, no budget.
// Kept for reference: the shape render() receives after normalisation.
const UNRELEASED = { id:1, title:"Disclosure Day", original_title:"Disclosure Day", media_type:"movie",
  overview:"A cybersecurity expert...", poster:"/p.jpg", backdrop:"/b.jpg", release_date:"2026-06-10",
  year:2026, rating:7.4, vote_count:2000, language:"English", genres:["Science Fiction","Thriller"],
  runtime:146, budget:0, revenue:0, status:"Post Production", tagline:"We deserve to know.",
  homepage:"https://example.com", imdb_id:"tt1", trailer:{key:"abc"},
  directors:[{id:1,name:"Steven Spielberg"}], writers:[],
  cast:[{id:2,name:"Emily Blunt",character:"Margaret Fairchild",profile:"/a.jpg"}],
  similar:[], season_list:[], production_countries:[], spoken_languages:[] };

// TMDB shape, straight off the wire, so the real normalise + render path runs.
const RAW = {
  id: 1, title: "Disclosure Day", original_title: "Disclosure Day",
  overview: "A cybersecurity expert becomes a whistleblower.",
  poster_path: "/p.jpg", backdrop_path: "/b.jpg", release_date: "2026-06-10",
  vote_average: 7.4, vote_count: 2000, original_language: "en", popularity: 50,
  runtime: 146, budget: 0, revenue: 0, status: "Post Production",
  tagline: "We deserve to know.", homepage: "https://example.com",
  genres: [{ id: 878, name: "Science Fiction" }, { id: 53, name: "Thriller" }],
  credits: { cast: [{ id: 2, name: "Emily Blunt", character: "Margaret Fairchild", profile_path: "/a.jpg" },
                    { id: 3, name: "Colman Domingo", character: "Hugo Wakefield", profile_path: null },
                    { id: 4, name: "Cher", character: "Herself", profile_path: null }],
             crew: [{ id: 9, name: "Steven Spielberg", job: "Director" }] },
  videos: { results: [{ site: "YouTube", type: "Trailer", official: true, key: "abc", name: "Trailer" }] },
  external_ids: { imdb_id: "tt1" },
  recommendations: { results: [] }, similar: { results: [] },
  production_countries: [], spoken_languages: [], seasons: []
};

globalThis.fetch = async (u) => {
  const url = String(u);
  if (url.includes("action=read")) {
    return { ok:true, status:200, json: async()=>({ ok:true, tabs:{
      watched:{header:["Name"],rows:[]}, watchlist:{header:["Name"],rows:[]}, people:{header:["Name"],rows:[]} } }) };
  }
  if (url.includes("/movie/1?")) return { ok:true, status:200, json: async()=>RAW };
  if (url.includes("/genre/")) return { ok:true, status:200, json: async()=>({ genres: RAW.genres }) };
  if (url.includes("/configuration/languages")) return { ok:true, status:200, json: async()=>[{iso_639_1:"en",english_name:"English"}] };
  return { ok:true, status:200, json: async()=>({ results: [] }) };
};

const detail = await import(path.join(ROOT, "js/ui/detail.js"));
window.bootstrap = { Modal: class { show(){} static getInstance(){ return null; } } };

let pass=0, fail=0;
const t=(n,f)=>{try{f();pass++;console.log("  ok   "+n)}catch(e){fail++;console.log("  FAIL "+n+": "+e.message)}};
await detail.open(1, "movie");
await new Promise(r=>setTimeout(r,120));
const body = window.document.getElementById("detailBody");

t("box office shows an em dash when nothing has been earned", () => {
  const cells = [...body.querySelectorAll(".detail__cell")].map(c => [
    c.querySelector(".detail__cell-key").textContent,
    c.querySelector(".detail__cell-val").textContent ]);
  const map = Object.fromEntries(cells);
  assert.equal(map["Box office"], "\u2014", "unreleased films must not show $0");
  assert.equal(map["Budget"], "\u2014");
  assert.equal(map["Director"], "Steven Spielberg");
  assert.equal(map["Runtime"], "2h 26m");
  assert.equal(map["Status"], "Post Production");
  assert.ok(map["Release date"].includes("2026"));
});

t("the rating sits in the facts line, not in a tile", () => {
  assert.match(body.querySelector(".detail__facts").textContent, /7\.4/);
  assert.match(body.querySelector(".detail__facts").textContent, /2k votes/);
  assert.equal(body.querySelectorAll(".detail__stat").length, 0);
});

t("four buttons, trailer first and solid", () => {
  const row = [...body.querySelectorAll(".detail__actions > *")];
  assert.deepEqual(row.map(b => b.textContent.trim()),
    ["Watch trailer", "IMDb", "TMDB", "Official site"]);
  // The mobile grid puts the solid one across the whole first row, so it has to
  // be the only solid one and it has to be first.
  assert.ok(row[0].classList.contains("btn-solid"));
  assert.equal(row.filter(b => b.classList.contains("btn-solid")).length, 1);
});

t("a cast photo is framed for a circle, with initials behind it", () => {
  const face = body.querySelector(".detail__face");
  assert.ok(face, "no face element");
  assert.equal(face.querySelector(".detail__face-ini").textContent, "EB",
    "initials should be first and last name");
  assert.ok(face.querySelector("img"), "the photo should sit over the initials");
  // An empty alt means a failed load renders nothing, so the letters show through
  // with no error handler involved.
  assert.equal(face.querySelector("img").getAttribute("alt"), "");
});

t("the card no longer prints the original title", () => {
  const cards = fs.readFileSync(path.join(ROOT, "js/ui/cards.js"), "utf8");
  assert.ok(!cards.includes("card__original"), "cards should not render an original title");
  assert.ok(fs.readFileSync(path.join(ROOT, "js/ui/detail.js"), "utf8").includes("detail__original"),
    "the modal should still show it");
});

// Pointer: click anywhere puts it away. Touch: only the button does.
t("the trailer close button sits outside the frame", () => {
  body.querySelector("[data-trailer]").dispatchEvent(new window.MouseEvent("click",{bubbles:true}));
  assert.ok(body.querySelector(".detail__video"), "no video appeared");
  const close = body.querySelector("[data-trailer-close]");
  assert.ok(close, "no close button");
  // Inside the iframe's box it collided with YouTube's own controls.
  assert.equal(close.closest(".detail__video"), null,
    "the close button must not be inside the video box");
  assert.ok(close.closest(".detail__trailer-bar"), "it belongs on the bar above");
});

t("on a pointer device a click elsewhere closes it", () => {
  body.querySelector(".detail__overview").dispatchEvent(new window.MouseEvent("click",{bubbles:true}));
  assert.equal(body.querySelector(".detail__video"), null, "video should be gone");
});

t("on touch a stray tap does NOT close it - only the button", () => {
  touch = true;
  body.querySelector("[data-trailer]").dispatchEvent(new window.MouseEvent("click",{bubbles:true}));
  assert.ok(body.querySelector(".detail__video"));
  body.querySelector(".detail__overview").dispatchEvent(new window.MouseEvent("click",{bubbles:true}));
  assert.ok(body.querySelector(".detail__video"), "a careless tap killed the video on touch");
  body.querySelector("[data-trailer-close]").dispatchEvent(new window.MouseEvent("click",{bubbles:true}));
  assert.equal(body.querySelector(".detail__video"), null, "the close button did not work");
  touch = false;
});

// No white poster placeholder under a cast list: it is a 2:3 film-poster graphic
// and a row of them reads as missing films rather than people.
t("a cast member with no photo gets initials, not a placeholder image", () => {
  const faces = [...body.querySelectorAll(".detail__face")];
  assert.equal(faces.length, 3);
  assert.equal(faces[1].querySelector("img"), null, "no photo means no img at all");
  assert.equal(faces[1].querySelector(".detail__face-ini").textContent, "CD");
  // One word: one letter, not a mangled pair.
  assert.equal(faces[2].querySelector(".detail__face-ini").textContent, "C");
  assert.ok(!body.innerHTML.includes("poster-placeholder"),
    "the poster placeholder has no business in a cast list");
});

// There is no placeholder graphic anywhere any more. A title says which film has
// no artwork; a generic film reel says nothing.
t("the modal poster falls back to the title, not an image", () => {
  const poster = body.querySelector(".detail__poster");
  assert.ok(poster, "no poster element");
  assert.equal(poster.querySelector(".detail__poster-alt").textContent, "Disclosure Day");
  // The photo sits over the title, so a dead URL reveals it with no scripting.
  const img = poster.querySelector("img");
  assert.ok(img, "this fixture has a poster, so the image should be present");
  assert.equal(img.getAttribute("alt"), "");
  assert.ok(!body.innerHTML.includes("poster-placeholder"),
    "the placeholder file is gone; nothing may still reference it");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
