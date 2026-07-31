const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

export function debounce(fn, wait) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

// Survives "550.0", " 550 ", "1,234" and "".
export function parseId(value) {
  if (value == null) return null;
  const match = String(value).replace(/,/g, "").match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

// Lowercase, unaccented, punctuation-free, single-spaced.
//
// \p{L}\p{N} rather than \w, because \w is ASCII-only: every character of a
// Devanagari, Korean or Japanese title fell outside it and was replaced by a
// space, so the whole title normalised to the empty string and the row was never
// indexed at all. Any sheet row with a non-Latin title and no TMDB id was
// invisible to title matching. The /u flag is required for \p{...} to work.
export function normaliseTitle(title) {
  if (!title) return "";
  return String(title)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseHeader(header) {
  return String(header == null ? "" : header)
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Flags are spelled by hand over years, so read them leniently.
const TRUTHY = new Set(["yes", "y", "true", "1", "x", "\u2713", "\u2714", "done", "ok"]);

export function isYes(value) {
  return TRUTHY.has(String(value == null ? "" : value).trim().toLowerCase());
}

// Tidied, not translated. Casing is only fixed when the cell is entirely one
// case, so "K-Drama" survives while "HOLLYWOOD" becomes "Hollywood".
export function cleanLabel(value) {
  let text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  const upper = text.toUpperCase();
  if (text === lower || text === upper) {
    text = text.replace(/\w\S*/g, word => word[0].toUpperCase() + word.slice(1).toLowerCase());
  }
  return text.slice(0, 40);
}

const GENRE_SPLIT = /[,/|;]|\sand\s/i;

export function splitGenres(value) {
  const out = [];
  for (const part of String(value == null ? "" : value).split(GENRE_SPLIT)) {
    const label = cleanLabel(part);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

// Catch-all buckets belong at the end however many rows they hold.
function isRemainder(label) {
  const lowered = label.toLowerCase();
  return lowered.startsWith("other") || ["misc", "miscellaneous", "unsorted"].includes(lowered);
}

export function orderCategories(counts) {
  return Object.entries(counts)
    .sort((a, b) => {
      const remainder = Number(isRemainder(a[0])) - Number(isRemainder(b[0]));
      if (remainder) return remainder;
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].toLowerCase().localeCompare(b[0].toLowerCase());
    })
    .map(([label, count]) => ({ label, count }));
}

// "450 Hollywood, 300 Bollywood and 30 Other Language"
export function formatCategories(categories) {
  const parts = categories
    .filter(entry => entry.count)
    .map(entry => `${entry.count.toLocaleString()} ${entry.label}`);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

export function yearFrom(dateString) {
  const match = String(dateString || "").match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

// localStorage throws in private mode on some browsers, so never let it break
// a page. A lost preference is not worth a blank screen.
export const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
  getJSON(key) {
    const raw = this.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  setJSON(key, value) {
    try { this.set(key, JSON.stringify(value)); } catch { /* ignore */ }
  }
};

// Bounded parallelism. TMDB rate limits, and forty simultaneous detail calls
// is how a browse page gets itself throttled.
export async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}
