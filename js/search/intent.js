// Phrase to intent with no network: the scoped parsers (Title, Person) and the fallback whenever Gemini is unavailable.

import * as scope from "./scope.js";

const MOVIE = "movie";
const TV = "tv";

const VALID_GENRES = [
  "action", "adventure", "animation", "comedy", "crime", "documentary",
  "drama", "family", "fantasy", "history", "horror", "music", "mystery",
  "romance", "science fiction", "tv movie", "thriller", "war", "western"
];

const GENRE_ALIASES = {
  "sci fi": "Science Fiction", "sci-fi": "Science Fiction",
  scifi: "Science Fiction", "science-fiction": "Science Fiction",
  "rom com": "Romance", romcom: "Romance", romantic: "Romance",
  "love story": "Romance", funny: "Comedy", scary: "Horror",
  spooky: "Horror", docu: "Documentary", documentaries: "Documentary",
  kids: "Family", cartoon: "Animation", animated: "Animation",
  biopic: "History", historical: "History", musical: "Music",
  detective: "Mystery", suspense: "Thriller", psychological: "Thriller",
  "action packed": "Action", superhero: "Action", sitcom: "Comedy"
};

const LANGUAGE_WORDS = {
  bollywood: "Hindi", hindi: "Hindi", tollywood: "Telugu",
  telugu: "Telugu", kollywood: "Tamil", tamil: "Tamil",
  malayalam: "Malayalam", mollywood: "Malayalam", kannada: "Kannada",
  sandalwood: "Kannada", punjabi: "Punjabi", marathi: "Marathi",
  bengali: "Bengali", urdu: "Urdu", korean: "Korean",
  "k drama": "Korean", kdrama: "Korean", "k dramas": "Korean",
  japanese: "Japanese", anime: "Japanese",
  chinese: "Chinese", mandarin: "Chinese", cantonese: "Cantonese",
  french: "French", spanish: "Spanish", german: "German",
  italian: "Italian", russian: "Russian", turkish: "Turkish",
  thai: "Thai", swedish: "Swedish", danish: "Danish",
  norwegian: "Norwegian", polish: "Polish", persian: "Persian",
  iranian: "Persian", arabic: "Arabic", hebrew: "Hebrew",
  indonesian: "Indonesian", vietnamese: "Vietnamese",
  portuguese: "Portuguese", english: "English", hollywood: "English",
  indian: "Hindi", desi: "Hindi"
};

const COMPANY_WORDS = {
  marvel: "Marvel Studios", mcu: "Marvel Studios", dc: "DC",
  pixar: "Pixar", ghibli: "Studio Ghibli", "studio ghibli": "Studio Ghibli",
  a24: "A24", blumhouse: "Blumhouse", disney: "Walt Disney Pictures",
  dreamworks: "DreamWorks Animation", warner: "Warner Bros. Pictures",
  "yash raj": "Yash Raj Films", dharma: "Dharma Productions"
};

// Networks only make sense on the TV side of TMDB.
const NETWORK_WORDS = {
  netflix: "Netflix", hbo: "HBO", "amazon prime": "Amazon",
  "prime video": "Amazon", "apple tv": "Apple TV+", hulu: "Hulu",
  bbc: "BBC", amc: "AMC", fx: "FX", showtime: "Showtime",
  "disney plus": "Disney+", hotstar: "Disney+ Hotstar", sonyliv: "SonyLIV"
};

const KEYWORD_PHRASES = [
  "time travel", "mind bending", "mind blowing", "space", "dystopia",
  "post apocalyptic", "apocalypse", "heist", "revenge", "survival",
  "serial killer", "zombie", "vampire", "alien", "robot",
  "artificial intelligence", "coming of age", "based on a true story",
  "true story", "courtroom", "spy", "martial arts", "road trip",
  "found footage", "parallel universe", "multiverse", "cyberpunk",
  "noir", "slasher", "gangster", "prison", "boxing", "chess", "hacker"
];

const TV_PATTERN = /\b(tv|tv shows?|shows?|series|web series|webseries|miniseries|mini series|docuseries|sitcoms?|k ?dramas?|korean dramas?|soap opera|seasons?|episodes?|anime series|streaming shows?)\b/i;
const MOVIE_PATTERN = /\b(movies?|films?|cinema|feature films?|flicks?)\b/i;

const STOPWORD_PATTERN = /\b(movies?|films?|cinema|tv|shows?|series|web series|webseries|miniseries|docuseries|sitcoms?|episodes?|seasons?|show me|find|search|list|of|the|all|some|good|great|best|top|rated|greatest|famous|popular|trending|latest|new|newest|recent|classic|old|underrated|must watch|watchlist|please|give me|any|from|in|with|by|starring|directed|director|creator|actor|acted|watch|binge)\b/gi;

const AWARD_PATTERN = /\b(oscars?|academy awards?|award winning|award-winning|palme d'?or|emmys?|golden globes?|bafta|cannes|acclaimed|critically acclaimed)\b/i;

const FRAMING_PATTERN = /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:show me|show|find me|find|search for|search|look for|look up|give me|get me|i want to watch|i wanna watch|i want|i need|watch)\s+/i;

// A trailing format noun is framing too - "The Call movie" is still The Call.
const FORMAT_TAIL = /\s*\b(?:the\s+)?(?:movies?|films?|web\s?series|tv\s?series|tv\s?shows?|series|shows?|seasons?|episodes?|tv)\b\s*$/i;

// What is left after stripping the tail must still be a plausible title, or "The Movie" becomes "The".
const BARE_ARTICLES = new Set(["the", "a", "an", "of", "my", "our", "it", "is"]);

// "with" separates before it is filler: "movies with akshay kumar and suniel shetty" splits on the "and".
const PEOPLE_SPLIT = /\s*(?:,|&|\+|\band\b|\bwith\b|\bft\.?\b|\bfeaturing\b|\balong\s+with\b)\s*/i;

const SIMILAR_PATTERN = /\b(?:like|similar to|same as|in the style of)\s+(.+)$/i;
const DIRECTOR_HINT = /\b(directed by|direction of|director|directors|filmmaker|film maker|created by|creator|showrunner|made by)\b/i;
const ACTOR_HINT = /\b(starring|stars|acted|acting|actor|actress|featuring|cast of|played by|performance)\b/i;

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWord(haystack, phrase) {
  return new RegExp(`\\b${escapeRe(phrase)}\\b`, "i").test(haystack);
}

function cleanMediaValue(value) {
  const text = String(value || "").trim().toLowerCase();
  if ([TV, "series", "show", "shows", "web series"].includes(text)) return TV;
  if ([MOVIE, "movies", "film", "films"].includes(text)) return MOVIE;
  return null;
}

export function detectMedia(query, hint) {
  const lowered = String(query || "").toLowerCase();
  if (TV_PATTERN.test(lowered)) return TV;
  if (MOVIE_PATTERN.test(lowered)) return MOVIE;
  return cleanMediaValue(hint) || MOVIE;
}

// Everything a phrase says about WHAT KIND of title is wanted, kept separate so the scoped parsers can reuse it.
export function extractFilters(text, media) {
  const lowered = String(text || "").toLowerCase();
  const found = {};

  const genres = [];
  for (const [alias, canonical] of Object.entries(GENRE_ALIASES)) {
    if (hasWord(lowered, alias) && !genres.includes(canonical)) genres.push(canonical);
  }
  for (const genre of VALID_GENRES) {
    if (hasWord(lowered, genre)) {
      const proper = genre.replace(/\b\w/g, ch => ch.toUpperCase()).replace("Tv Movie", "TV Movie");
      if (!genres.includes(proper)) genres.push(proper);
    }
  }
  if (genres.length) {
    found.genre = genres[0];
    if (genres.length > 1) found.genres = genres;
  }

  for (const [word, language] of Object.entries(LANGUAGE_WORDS)) {
    if (hasWord(lowered, word)) {
      found.language = language;
      if (word === "anime") found.genre = "Animation";
      break;
    }
  }

  const catalogue = media === TV ? { ...COMPANY_WORDS, ...NETWORK_WORDS } : COMPANY_WORDS;
  for (const [word, company] of Object.entries(catalogue)) {
    if (hasWord(lowered, word)) {
      found.company = company;
      break;
    }
  }

  const keywords = KEYWORD_PHRASES.filter(phrase => lowered.includes(phrase));
  if (keywords.length) found.keywords = keywords.slice(0, 2);

  // "1990s", "90s" and a bare "2025" all resolve here.
  const longDecade = lowered.match(/\b(19|20)(\d)0s\b/);
  const shortDecade = lowered.match(/\b(\d)0s\b/);
  if (longDecade) {
    const start = parseInt(`${longDecade[1]}${longDecade[2]}0`, 10);
    found.year_from = start;
    found.year_to = start + 9;
  } else if (shortDecade) {
    const tens = parseInt(shortDecade[1], 10) * 10;
    const start = tens >= 30 ? 1900 + tens : 2000 + tens;
    found.year_from = start;
    found.year_to = start + 9;
  } else {
    const year = lowered.match(/\b(19\d{2}|20\d{2})\b/);
    if (year) found.year = parseInt(year[0], 10);
  }

  // TMDB has no award filter, so award phrasing becomes a rating sort.
  const isAwardQuery = AWARD_PATTERN.test(lowered);
  if (isAwardQuery) found.sort = "rating";

  if (!found.sort) {
    if (/\b(best|top|greatest|highest rated)\b/i.test(lowered)) found.sort = "rating";
    else if (/\b(new|latest|recent|newest)\b/i.test(lowered)) found.sort = "newest";
    else if (/\b(old|classic|oldest)\b/i.test(lowered)) found.sort = "oldest";
  }

  return { filters: found, isAwardQuery };
}

// What is left once every filter word, format word and pleasantry is removed: usually a name.
export function residue(text) {
  let out = String(text || "");
  const consumed = [
    ...Object.keys(GENRE_ALIASES), ...VALID_GENRES, ...Object.keys(LANGUAGE_WORDS),
    ...Object.keys(COMPANY_WORDS), ...Object.keys(NETWORK_WORDS), ...KEYWORD_PHRASES
  ].sort((a, b) => b.length - a.length);

  for (const phrase of consumed) {
    out = out.replace(new RegExp(`\\b${escapeRe(phrase)}\\b`, "gi"), " ");
  }
  out = out.replace(new RegExp(AWARD_PATTERN.source, "gi"), " ");
  out = out.replace(/\b\d{2,4}s?\b/g, " ");
  out = out.replace(STOPWORD_PATTERN, " ");
  out = out.replace(/[^\w\s]/g, " ");
  return out.replace(/\s+/g, " ").trim();
}

// The title inside a phrase, with the title's own words left alone - "the" is a stopword, which is why "The Call" searched for "call".
export function titlePhrase(query) {
  const text = String(query || "").trim().replace(/\s+/g, " ");
  if (!text) return "";

  let stripped = text.replace(FRAMING_PATTERN, "").trim();
  stripped = stripped.replace(/^["'\u201c\u201d\u2018\u2019]+|["'\u201c\u201d\u2018\u2019]+$/g, "");

  // Twice, so "the office tv show" loses both nouns.
  for (let pass = 0; pass < 2; pass++) {
    const candidate = stripped.replace(FORMAT_TAIL, "").trim();
    if (candidate === stripped) break;
    if (candidate.length < 2 || BARE_ARTICLES.has(candidate.toLowerCase())) break;
    stripped = candidate;
  }

  return stripped || text;
}

// The name inside a phrase. Unlike a title, here the filler genuinely is filler.
export function personPhrase(query) {
  const text = String(query || "").trim().replace(/\s+/g, " ");
  if (!text) return "";

  const left = residue(text);
  if (left) return left;

  // Everything looked like filler, so the name is a word the stripper knows: fall back to framing-only removal.
  let lighter = text.replace(FRAMING_PATTERN, "").trim();
  for (let pass = 0; pass < 2; pass++) {
    const candidate = lighter.replace(FORMAT_TAIL, "").trim();
    if (candidate === lighter || !candidate) break;
    lighter = candidate;
  }
  return lighter || text;
}

// Two or more names, or []. Deliberately timid - every part must survive the stripper AND hold two words, which is what saves "The Good, the Bad and the Ugly".
export function splitPeople(query) {
  const text = String(query || "").trim();
  if (!text || SIMILAR_PATTERN.test(text)) return [];
  if (!PEOPLE_SPLIT.test(text)) return [];

  const parts = text.split(new RegExp(PEOPLE_SPLIT.source, "gi"));
  if (parts.length < 2) return [];

  const names = [];
  for (const part of parts) {
    const name = personPhrase(part).trim();
    if (!name) continue;
    // A full name, not a leftover word: one-word parts would read every list of nouns as a cast list.
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) continue;
    if (name.length < 5 || /\d/.test(name)) continue;
    if (names.some(existing => existing.toLowerCase() === name.toLowerCase())) continue;
    names.push(name);
  }

  return names.length >= 2 ? names.slice(0, 4) : [];
}

function roleHint(query) {
  if (DIRECTOR_HINT.test(query || "")) return "director";
  if (ACTOR_HINT.test(query || "")) return "actor";
  return null;
}

// The unscoped parser. Also the fallback when Gemini is down.
export function heuristicParse(query, mediaHint) {
  const text = String(query || "").trim();
  const lowered = text.toLowerCase();
  const media = detectMedia(text, mediaHint);

  const similar = lowered.match(/(?:like|similar to|same as|in the style of)\s+(.+)$/);
  if (similar) {
    const title = similar[1].replace(STOPWORD_PATTERN, " ").replace(/\s+/g, " ").replace(/^[\s,.]+|[\s,.]+$/g, "");
    if (title) return { intent: "similar", media, title, source: "heuristic" };
  }

  if (/\btrending\b|this week|right now/.test(lowered)) return { intent: "trending", media, source: "heuristic" };
  if (/\bpopular\b/.test(lowered) && lowered.split(/\s+/).length <= 3) {
    return { intent: "popular", media, source: "heuristic" };
  }
  if (/\btop rated\b|highest rated/.test(lowered) && lowered.split(/\s+/).length <= 4) {
    return { intent: "top_rated", media, source: "heuristic" };
  }

  const intent = { intent: "discover", media, source: "heuristic" };
  const { filters, isAwardQuery } = extractFilters(text, media);
  Object.assign(intent, filters);

  // Names first, or "akshay kumar and suniel shetty comedy movies" is searched for as one long title.
  const cast = splitPeople(text);
  if (cast.length > 1) {
    intent.intent = "people_movies";
    intent.people = cast;
    const role = roleHint(text);
    if (role) intent.role = role;
    return intent;
  }

  // Two or more surviving words are probably a person or a title, which multi-search resolves.
  const left = residue(text);
  if (left.split(/\s+/).length >= 2 && left.length >= 6 && !isAwardQuery) {
    intent.intent = "search";
    intent.title = left;
    return intent;
  }

  const filterKeys = ["genre", "genres", "language", "company", "keywords", "year", "year_from", "sort"];
  if (filterKeys.some(key => key in intent)) return intent;

  return { intent: "search", media, title: left || text, source: "heuristic" };
}

// The offline parser, told in advance what kind of thing it is parsing.
export function heuristicScoped(query, mediaHint, chosenScope) {
  const text = String(query || "").trim();
  const media = detectMedia(text, mediaHint);
  const { filters } = extractFilters(text, media);

  const intent = { intent: "discover", media, scope: chosenScope, source: "heuristic" };

  if (chosenScope === scope.PERSON) {
    intent.intent = "person_movies";
    intent.person = personPhrase(text) || text;

    // The user said these are people. A list of them is still people.
    const cast = splitPeople(text);
    if (cast.length > 1) {
      intent.intent = "people_movies";
      intent.people = cast;
      delete intent.person;
    }
    // Genre and sort still apply to a filmography; language and company do not.
    for (const key of ["genre", "genres", "sort", "year", "year_from", "year_to"]) {
      if (key in filters) intent[key] = filters[key];
    }
    const role = roleHint(text);
    if (role) intent.role = role;
    return intent;
  }

  if (chosenScope === scope.TITLE) {
    const similar = text.match(SIMILAR_PATTERN);
    if (similar) {
      const seed = titlePhrase(similar[1]);
      if (seed) {
        intent.intent = "similar";
        intent.title = seed;
        return intent;
      }
    }
    intent.intent = "search";
    intent.title = titlePhrase(text) || text;
    return intent;
  }

  // Discover: a name has no meaning here, so anything left over becomes a theme keyword.
  Object.assign(intent, filters);
  if (!["genre", "genres", "language", "company", "keywords"].some(key => key in intent)) {
    const left = residue(text);
    if (left) intent.keywords = [left.slice(0, 40)];
  }
  return intent;
}

export { VALID_GENRES, GENRE_ALIASES };
