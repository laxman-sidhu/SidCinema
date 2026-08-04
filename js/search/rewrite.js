// Rewrites a phrase when the Movies/Series toggle flips: "Hrithik Roshan movies" + tv -> "Hrithik Roshan series".

const MOVIE = "movie";
const TV = "tv";

// Longest first, so "web series" is consumed before the bare "series" can match inside it.
const MOVIE_WORDS = [
  "feature films", "feature film", "motion pictures", "motion picture",
  "movies", "movie", "films", "film", "flicks", "flick", "cinema"
];

const TV_WORDS = [
  "web series", "webseries", "tv series", "tv shows", "tv show",
  "mini series", "miniseries", "docuseries", "k dramas", "k-dramas",
  "kdramas", "k drama", "k-drama", "kdrama", "korean dramas",
  "sitcoms", "sitcom", "serials", "serial", "seasons", "season",
  "episodes", "episode", "shows", "show", "series", "tv"
];

// Deliberately short: "best", "trending" and "latest" all survive a toggle.
const FILLER = new Set([
  "the", "a", "an", "of", "all", "some", "any", "me", "my", "for",
  "in", "on", "show", "find", "list", "give", "search", "please", "watch"
]);

// Some format words carry a subject too, so "k-drama" is unpacked into "korean" before the format swap runs.
const FLAVOUR = [
  [/\b(k[-\s]?dramas?|korean dramas?)\b/gi, "korean"],
  [/\bsitcoms?\b/gi, "comedy"],
  [/\bdocuseries\b/gi, "documentary"],
  [/\bsoap operas?\b/gi, "drama"]
];

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pattern(words) {
  const ordered = [...words].sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(${ordered.map(escapeRe).join("|")})\\b`, "gi");
}

const MOVIE_PATTERN = () => pattern(MOVIE_WORDS);
const TV_PATTERN = () => pattern(TV_WORDS);

function tidy(text) {
  let out = text.replace(/\s+/g, " ").replace(/^[\s,.-]+|[\s,.-]+$/g, "");
  // "series series" and "movies movies" both come out of naive replacement.
  out = out.replace(/\b(\w+)( \1\b)+/gi, "$1");
  return out.trim();
}

function hasMediaWords(query) {
  const text = query || "";
  return MOVIE_PATTERN().test(text) || TV_PATTERN().test(text);
}

// True when the phrase is nothing but media words and filler.
function hasSubject(query) {
  const stripped = String(query || "").replace(MOVIE_PATTERN(), " ").replace(TV_PATTERN(), " ");
  const words = (stripped.toLowerCase().match(/[a-z0-9']+/g) || []);
  return words.some(word => !FILLER.has(word));
}

export function rewriteForMedia(query, media) {
  let text = String(query || "").trim();
  if (!text) return "";

  const hadMediaWord = hasMediaWords(text);

  for (const [regex, subject] of FLAVOUR) text = text.replace(regex, subject);

  if (!hasSubject(text)) return "";

  text = media === TV
    ? text.replace(MOVIE_PATTERN(), "series")
    : text.replace(TV_PATTERN(), "movies");

  text = tidy(text);

  // Unpacking can leave no format noun at all; put one back, but only when the original had one.
  if (hadMediaWord && !hasMediaWords(text)) {
    text = tidy(`${text} ${media === TV ? "series" : "movies"}`);
  }

  return text;
}
