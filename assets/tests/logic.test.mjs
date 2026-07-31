import assert from "node:assert";
import * as util from "../../js/core/util.js";
import * as intent from "../../js/search/intent.js";
import { rewriteForMedia } from "../../js/search/rewrite.js";
import * as scope from "../../js/search/scope.js";
import { buildSections } from "../../js/ui/sections.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL " + name + ": " + e.message); } };

// The bug that motivated the Title scope: "the" is a stopword, so the general
// parser searched for "call" and TMDB answered with something else.
t("titlePhrase keeps articles", () => {
  assert.equal(intent.titlePhrase("the call"), "the call");
  assert.equal(intent.titlePhrase("The Call movie"), "The Call");
  assert.equal(intent.titlePhrase("show me the office tv show"), "the office");
  assert.equal(intent.titlePhrase("The Movie"), "The Movie");
});

t("personPhrase strips filler", () => {
  assert.equal(intent.personPhrase("best movies of hritik roshan"), "hritik roshan");
  assert.equal(intent.personPhrase("hritik roshan films"), "hritik roshan");
  assert.equal(intent.personPhrase("Directed by Rajkumar Hirani"), "Rajkumar Hirani");
});

t("90s action with tom hanks", () => {
  const f = intent.extractFilters("90s action with tom hanks", "movie").filters;
  assert.equal(f.year_from, 1990); assert.equal(f.year_to, 1999); assert.equal(f.genre, "Action");
  assert.equal(intent.residue("90s action with tom hanks"), "tom hanks");
});

t("bollywood romance -> Hindi + Romance + rating", () => {
  const f = intent.extractFilters("best romantic films of bollywood", "movie").filters;
  assert.equal(f.language, "Hindi"); assert.equal(f.genre, "Romance"); assert.equal(f.sort, "rating");
});

t("decades", () => {
  assert.equal(intent.extractFilters("1990s thrillers","movie").filters.year_from, 1990);
  assert.equal(intent.extractFilters("80s horror","movie").filters.year_from, 1980);
  assert.equal(intent.extractFilters("20s movies","movie").filters.year_from, 2020);
  assert.equal(intent.extractFilters("best movies of 2025","movie").filters.year, 2025);
});

t("anime implies Animation + Japanese", () => {
  const f = intent.extractFilters("anime series", "tv").filters;
  assert.equal(f.language, "Japanese"); assert.equal(f.genre, "Animation");
});

t("networks only on tv side", () => {
  assert.equal(intent.extractFilters("netflix crime series","tv").filters.company, "Netflix");
  assert.equal(intent.extractFilters("netflix crime movies","movie").filters.company, undefined);
});

t("detectMedia", () => {
  assert.equal(intent.detectMedia("best web series"), "tv");
  assert.equal(intent.detectMedia("best films"), "movie");
  assert.equal(intent.detectMedia("Interstellar", "tv"), "tv");
});

t("scoped discover never yields a person", () => {
  const i = intent.heuristicScoped("tom hanks", "movie", scope.DISCOVER);
  assert.equal(i.intent, "discover");
  assert.equal(i.person, undefined);
  assert.deepEqual(i.keywords, ["tom hanks"]);
});

t("scoped person keeps genre, drops company", () => {
  const i = intent.heuristicScoped("Akshay Kumar comedy movies", "movie", scope.PERSON);
  assert.equal(i.intent, "person_movies");
  assert.equal(i.person, "Akshay Kumar");
  assert.equal(i.genre, "Comedy");
  assert.equal(i.company, undefined);
});

t("scoped title detects similar", () => {
  const i = intent.heuristicScoped("movies like Inception", "movie", scope.TITLE);
  assert.equal(i.intent, "similar"); assert.equal(i.title, "Inception");
});

t("rewriteForMedia", () => {
  assert.equal(rewriteForMedia("Hrithik Roshan movies", "tv"), "Hrithik Roshan series");
  assert.equal(rewriteForMedia("shows like Breaking Bad", "movie"), "movies like Breaking Bad");
  assert.equal(rewriteForMedia("movies", "tv"), "");
  assert.equal(rewriteForMedia("best k-dramas", "movie"), "best korean movies");
});

t("scope aliases", () => {
  assert.equal(scope.clean("Genre & mood"), scope.DISCOVER);
  assert.equal(scope.clean("actress"), scope.PERSON);
  assert.equal(scope.clean("nonsense"), scope.AUTO);
  assert.equal(scope.clean(null), scope.AUTO);
});

t("orderCategories pushes Other to the end", () => {
  const out = util.orderCategories({ "Other Language": 900, Hollywood: 450, Bollywood: 300 });
  assert.deepEqual(out.map(e => e.label), ["Hollywood", "Bollywood", "Other Language"]);
});

t("formatCategories", () => {
  assert.equal(util.formatCategories([{label:"Hollywood",count:450},{label:"Bollywood",count:300},{label:"Other",count:30}]),
    "450 Hollywood, 300 Bollywood and 30 Other");
});

t("flags read leniently", () => {
  ["Yes","y","TRUE","1","x","\u2713"].forEach(v => assert.ok(util.isYes(v), v));
  ["","no","n",null].forEach(v => assert.ok(!util.isYes(v)));
});

t("cleanLabel only recases single-case cells", () => {
  assert.equal(util.cleanLabel("HOLLYWOOD"), "Hollywood");
  assert.equal(util.cleanLabel("bollywood"), "Bollywood");
  assert.equal(util.cleanLabel("K-Drama"), "K-Drama");
});

t("splitGenres handles legacy multi-genre cells", () => {
  assert.deepEqual(util.splitGenres("Action, Thriller / Crime"), ["Action","Thriller","Crime"]);
  assert.deepEqual(util.splitGenres("Comedy and Drama"), ["Comedy","Drama"]);
});

t("parseId survives sheet noise", () => {
  assert.equal(util.parseId("550.0"), 550);
  assert.equal(util.parseId(" 1,234 "), 1234);
  assert.equal(util.parseId(""), null);
});

t("normaliseTitle", () => {
  assert.equal(util.normaliseTitle("Amélie!  (2001)"), "amelie 2001");
  assert.equal(util.normaliseTitle("Spider-Man: No Way Home"), "spider man no way home");
});

// \w is ASCII-only, so a Devanagari or Hangul title used to normalise to the
// empty string and its row was never indexed - invisible to title matching.
t("a non-Latin title normalises to something, not nothing", () => {
  for (const title of ["\u0938\u092a\u0942\u0924", "\uae30\uc0dd\uc99d", "\u4e03\u4eba\u306e\u4f8d"]) {
    assert.ok(util.normaliseTitle(title).length > 0, "normalised away: " + title);
    // And it has to be stable, since both sides of a match run through it.
    assert.equal(util.normaliseTitle(title), util.normaliseTitle(title));
  }
});

t("sections: released only loses its heading", () => {
  const s = buildSections([{id:1,title:"A",release_date:"2020-01-01",vote_count:9,rating:7}], {media:"movie"});
  assert.equal(s.length, 1); assert.equal(s[0].title, "");
});

t("sections: upcoming splits out and related is last", () => {
  const s = buildSections([
    {id:1,title:"Out",release_date:"2020-01-01",vote_count:9,rating:7},
    {id:2,title:"Soon",release_date:"2099-01-01",vote_count:0,rating:0},
    {id:3,title:"Rel",release_date:"2019-01-01",vote_count:5,rating:6,related:true}
  ], {media:"movie", relatedTo:"Out"});
  assert.deepEqual(s.map(x=>x.key), ["released","upcoming","related"]);
  assert.equal(s[2].title, "More like Out");
  assert.equal(s.reduce((n,x)=>n+x.movies.length,0), 3);
});

t("esc blocks injection", () => {
  assert.equal(util.esc('<img src=x onerror="y">'), "&lt;img src=x onerror=&quot;y&quot;&gt;");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
