// Phrase to intent, for phrasings a regex cannot reach. Never runs for Title or Person, and every result is schema-checked before use.

import { GEMINI_API_KEY, GEMINI_MODEL } from "../config.js";
import * as scope from "./scope.js";
import { heuristicParse, heuristicScoped, VALID_GENRES, GENRE_ALIASES } from "./intent.js";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

// Tried in order. A retired model 404s and the next one is used.
const MODELS = [GEMINI_MODEL, "gemini-flash-latest", "gemini-2.5-flash"];

// After a 429 the free tier needs a breather: skip Gemini entirely for this long.
const COOLDOWN_MS = 120000;
let cooldownUntil = 0;

const SYSTEM_PROMPT = `You convert a search phrase into JSON for a TMDB API client.

Return ONLY a JSON object. No prose, no markdown, no code fences.
NEVER list, invent or name any titles. You are a parser, not a recommender.

Schema (include only the keys you can fill confidently):
{
  "intent": "person_movies" | "people_movies" | "discover" | "similar" | "trending" | "popular" | "top_rated" | "search",
  "media": "movie" | "tv",
  "person": "full name of a director/creator/actor",
  "people": ["every full name, when the phrase names TWO OR MORE people"],
  "role": "actor" | "director",
  "genre": "one TMDB genre name",
  "genres": ["TMDB genre names when more than one applies"],
  "language": "spoken language name, e.g. Hindi, Korean, Japanese",
  "country": "ISO 3166-1 country code, e.g. IN, KR, US",
  "company": "studio or network name, e.g. Marvel Studios, Pixar, HBO, Netflix",
  "keywords": ["theme words such as time travel, space, dystopia"],
  "title": "a specific movie or series title (only for intent similar or search)",
  "year": 2025,
  "year_from": 1990,
  "year_to": 1999,
  "sort": "rating" | "popularity" | "newest" | "oldest" | "revenue"
}

Valid TMDB genres: Action, Adventure, Animation, Comedy, Crime, Documentary,
Drama, Family, Fantasy, History, Horror, Music, Mystery, Romance,
Science Fiction, TV Movie, Thriller, War, Western.

Rules:
- "media" is "tv" for series, shows, web series, sitcoms, K-dramas, anime
  series, miniseries and docuseries. Otherwise "movie". Set it only when the
  phrase makes it clear; omit it when the phrase could mean either.
- A person's name in the phrase -> intent "person_movies". Directors and show
  creators get "role":"director"; actors get "role":"actor". If unsure, omit.
- TWO OR MORE names joined by "and", "with", "&" or commas -> intent
  "people_movies" with EVERY name in "people", in the order they were typed.
  This means titles they worked on TOGETHER. Use "person" only for one name,
  and "people" only for two or more; never both.
- Correct the spelling of a name you recognise: "sunil shetty" is Suniel
  Shetty, "maduri dixit" is Madhuri Dixit. Return the name as the database
  spells it, never as it was typed.
- "like X" / "similar to X" -> intent "similar" with "title":"X".
- Genre, mood, theme, era or language phrasing -> intent "discover".
- "best" / "top rated" / "greatest" / award phrasing -> add "sort":"rating".
- "new" / "latest" / "recent" -> add "sort":"newest".
- Bollywood -> language Hindi. Tollywood -> Telugu. Kollywood -> Tamil.
  Anime -> genre Animation with language Japanese. Korean -> language Korean.
  Do not add "country" when you already set "language".
- Franchise, studio or network words (Marvel, DC, Pixar, Ghibli, A24, HBO,
  Netflix, BBC) -> "company".
- Abstract themes (mind bending, time travel, space, heist) -> "keywords".
- If the phrase is just a title, use intent "search" with "title".
- If nothing is clear, return {"intent":"search"}.

Examples:
"Christopher Nolan movies" -> {"intent":"person_movies","media":"movie","person":"Christopher Nolan","role":"director"}
"Tom Cruise action movies" -> {"intent":"person_movies","media":"movie","person":"Tom Cruise","role":"actor","genre":"Action"}
"best horror movies" -> {"intent":"discover","media":"movie","genre":"Horror","sort":"rating"}
"bollywood comedy movies" -> {"intent":"discover","media":"movie","language":"Hindi","genre":"Comedy"}
"best romantic films of bollywood" -> {"intent":"discover","media":"movie","language":"Hindi","genre":"Romance","sort":"rating"}
"movies like Interstellar" -> {"intent":"similar","media":"movie","title":"Interstellar"}
"best movies of 2025" -> {"intent":"discover","media":"movie","year":2025,"sort":"rating"}
"akshay kumar and sunil shetty movies" -> {"intent":"people_movies","media":"movie","people":["Akshay Kumar","Suniel Shetty"],"role":"actor"}
"akshay kumar, sunil shetty and maduri dixit comedy movies" -> {"intent":"people_movies","media":"movie","people":["Akshay Kumar","Suniel Shetty","Madhuri Dixit"],"role":"actor","genre":"Comedy"}
"best movies of shah rukh khan and kajol" -> {"intent":"people_movies","media":"movie","people":["Shah Rukh Khan","Kajol"],"role":"actor","sort":"rating"}
"films directed by rajkumar hirani starring aamir khan" -> {"intent":"people_movies","media":"movie","people":["Rajkumar Hirani","Aamir Khan"]}
"90s action with tom hanks" -> {"intent":"person_movies","media":"movie","person":"Tom Hanks","role":"actor","genre":"Action","year_from":1990,"year_to":1999}
"time travel movies" -> {"intent":"discover","media":"movie","keywords":["time travel"]}
"marvel movies" -> {"intent":"discover","media":"movie","company":"Marvel Studios","sort":"newest"}
"best korean dramas" -> {"intent":"discover","media":"tv","language":"Korean","genre":"Drama","sort":"rating"}
"netflix crime series" -> {"intent":"discover","media":"tv","company":"Netflix","genre":"Crime"}
"anime series" -> {"intent":"discover","media":"tv","genre":"Animation","language":"Japanese"}`;

// Appended once the user has chosen a scope. The failure that matters is a name landing in "title", or a title in "person".
const SCOPE_DIRECTIVES = {
  [scope.DISCOVER]:
    "The user chose SEARCH BY GENRE AND MOOD. The phrase describes a KIND of "
    + "title, never a specific one and never a person. Return "
    + '"intent":"discover" and fill genre, genres, language, country, company, '
    + "keywords, year, year_from, year_to and sort from the phrase. Never use "
    + '"person" or "title", and never return any other intent.'
};

function isConfigured() {
  return Boolean(GEMINI_API_KEY);
}

function inCooldown() {
  return Date.now() < cooldownUntil;
}

async function callModel(prompt, system) {
  if (!isConfigured() || inCooldown()) return null;

  for (const model of MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(
        `${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 400, responseMimeType: "application/json" }
          }),
          signal: controller.signal
        }
      );

      if (response.status === 429) {
        cooldownUntil = Date.now() + COOLDOWN_MS;
        return null;
      }
      if (response.status === 404) continue;   // retired model, try the next
      if (!response.ok) return null;

      const payload = await response.json();
      const text = (payload.candidates || [])
        .flatMap(candidate => ((candidate.content || {}).parts || []))
        .map(part => part.text || "")
        .join("");
      return text || null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function extractJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}

const VALID_INTENTS = ["person_movies", "people_movies", "discover", "similar", "trending", "popular", "top_rated", "search"];
const VALID_SORTS = ["rating", "popularity", "newest", "oldest", "revenue"];

function cleanGenre(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (VALID_GENRES.includes(lowered)) {
    return lowered.replace(/\b\w/g, ch => ch.toUpperCase()).replace("Tv Movie", "TV Movie");
  }
  return GENRE_ALIASES[lowered] || null;
}

function cleanYear(value) {
  const year = parseInt(value, 10);
  return year >= 1880 && year <= 2100 ? year : null;
}

// The schema gate: anything not in here is dropped, so a hallucinated key cannot reach the TMDB client.
function validateIntent(raw, originalQuery, mediaHint, chosenScope) {
  if (!raw || typeof raw !== "object") return null;

  const out = { source: "gemini", scope: chosenScope };

  out.intent = VALID_INTENTS.includes(raw.intent) ? raw.intent : "search";
  out.media = ["movie", "tv"].includes(raw.media) ? raw.media : (mediaHint || "movie");

  if (typeof raw.person === "string" && raw.person.trim()) out.person = raw.person.trim().slice(0, 80);

  // Four is the ceiling on purpose: an AND across five names has no answer.
  if (Array.isArray(raw.people)) {
    const names = [];
    for (const entry of raw.people) {
      if (typeof entry !== "string") continue;
      const name = entry.trim().slice(0, 80);
      if (!name || names.some(seen => seen.toLowerCase() === name.toLowerCase())) continue;
      names.push(name);
    }
    if (names.length > 1) out.people = names.slice(0, 4);
    else if (names.length === 1 && !out.person) out.person = names[0];
  }
  if (["actor", "director"].includes(raw.role)) out.role = raw.role;
  if (typeof raw.title === "string" && raw.title.trim()) out.title = raw.title.trim().slice(0, 120);
  if (typeof raw.language === "string" && raw.language.trim()) out.language = raw.language.trim().slice(0, 30);
  if (typeof raw.country === "string" && /^[A-Za-z]{2}$/.test(raw.country.trim())) {
    out.country = raw.country.trim().toUpperCase();
  }
  if (typeof raw.company === "string" && raw.company.trim()) out.company = raw.company.trim().slice(0, 60);

  const genre = cleanGenre(raw.genre);
  if (genre) out.genre = genre;

  if (Array.isArray(raw.genres)) {
    const genres = raw.genres.map(cleanGenre).filter(Boolean);
    if (genres.length) {
      out.genres = [...new Set(genres)].slice(0, 3);
      if (!out.genre) out.genre = out.genres[0];
    }
  }

  if (Array.isArray(raw.keywords)) {
    const keywords = raw.keywords
      .filter(word => typeof word === "string" && word.trim())
      .map(word => word.trim().slice(0, 40));
    if (keywords.length) out.keywords = keywords.slice(0, 3);
  }

  const year = cleanYear(raw.year);
  if (year) out.year = year;
  const yearFrom = cleanYear(raw.year_from);
  const yearTo = cleanYear(raw.year_to);
  if (yearFrom) out.year_from = yearFrom;
  if (yearTo) out.year_to = yearTo;
  if (out.year_from && out.year_to && out.year_from > out.year_to) {
    [out.year_from, out.year_to] = [out.year_to, out.year_from];
  }

  if (VALID_SORTS.includes(raw.sort)) out.sort = raw.sort;

  // The scope was an instruction, not a suggestion - a person under Genre & mood would call the wrong endpoint.
  if (chosenScope === scope.DISCOVER) {
    delete out.person;
    delete out.people;
    delete out.role;
    delete out.title;
    out.intent = "discover";
  }

  // An intent that names nothing to search for is not usable.
  if (out.intent === "similar" && !out.title) out.intent = "search";
  if (out.intent === "people_movies" && !out.people) {
    out.intent = out.person ? "person_movies" : "search";
  }
  if (out.intent === "person_movies" && !out.person) {
    out.intent = out.people ? "people_movies" : "search";
  }
  // Two names is the co-star search whatever the model called the intent.
  if (out.people && out.intent === "search") out.intent = "people_movies";
  if (out.intent === "search" && !out.title && !out.person && !out.people) {
    out.title = String(originalQuery || "").trim();
    if (!out.title) return null;
  }

  out.query = originalQuery;
  return out;
}

export async function parseQuery(query, mediaHint, { lockMedia = false, scope: chosenScope = scope.AUTO } = {}) {
  const offline = () => {
    const fallback = chosenScope === scope.AUTO
      ? heuristicParse(query, mediaHint)
      : heuristicScoped(query, mediaHint, chosenScope);
    fallback.query = query;
    fallback.scope = chosenScope;
    if (lockMedia && mediaHint) fallback.media = mediaHint;
    return fallback;
  };

  if (!isConfigured() || inCooldown()) return offline();

  const directive = SCOPE_DIRECTIVES[chosenScope];
  const system = directive ? `${SYSTEM_PROMPT}\n\n${directive}` : SYSTEM_PROMPT;
  const hint = lockMedia && mediaHint ? `\n(The user is browsing ${mediaHint === "tv" ? "series" : "movies"}.)` : "";

  const text = await callModel(`${query}${hint}`, system);
  const parsed = validateIntent(extractJSON(text), query, mediaHint, chosenScope);
  if (!parsed) return offline();

  if (lockMedia && mediaHint) parsed.media = mediaHint;
  return parsed;
}

// --- spelling rescue: "what did they mean to type", run only after TMDB came back empty ---

const NORMALISE_SYSTEM = `You correct search terms for a movie database. You are given what someone typed. Return the most likely correctly-spelled name of the person, movie or series they meant.

Correct only:
- spelling mistakes: "shahrukh khan" -> "Shah Rukh Khan"
- missing or extra spaces: "robertdowneyjr" -> "Robert Downey Jr."
- common misspellings: "dwyane johnson" -> "Dwayne Johnson"

Rules:
- Return ONLY the corrected term as a JSON object: {"term":"..."}
- Never invent a different person or title. Never answer a question.
- The corrected term must be recognisably the same words they typed.
- If the input already looks correct, return it unchanged.`;

const NORMALISE_MAX_LENGTH = 80;
const NORMALISE_MIN_SIMILARITY = 0.72;

function similarity(a, b) {
  const left = String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const right = String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!left || !right) return 0;
  if (left === right) return 1;

  let shared = 0;
  const pool = right.split("");
  for (const ch of left) {
    const at = pool.indexOf(ch);
    if (at !== -1) {
      shared++;
      pool.splice(at, 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

// Is this the same words spelled better, or a different search entirely?
function looksLikeCorrection(original, candidate) {
  const cleaned = String(candidate || "").trim();
  if (!cleaned || cleaned.length > NORMALISE_MAX_LENGTH) return false;
  if (cleaned.toLowerCase() === String(original || "").trim().toLowerCase()) return false;
  if (/[\n"]/.test(cleaned)) return false;
  return similarity(original, cleaned) >= NORMALISE_MIN_SIMILARITY;
}

export async function normaliseTerm(term) {
  const text = String(term || "").trim();
  if (!text || text.length > NORMALISE_MAX_LENGTH || !isConfigured() || inCooldown()) return null;

  const raw = await callModel(text, NORMALISE_SYSTEM);
  const parsed = extractJSON(raw);
  const candidate = parsed && typeof parsed.term === "string" ? parsed.term : null;
  return candidate && looksLikeCorrection(text, candidate) ? candidate.trim() : null;
}
