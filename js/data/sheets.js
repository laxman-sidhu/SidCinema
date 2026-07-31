// Reads the workbook. Columns are matched on header text, never position:
// All Watched has an unnamed spacer column and columns get moved by hand, so
// "column 9" would silently read the wrong data the first time one shifted.
//
// Two ways in. The Apps Script web app is preferred because it reads the live
// sheet, so a write is visible immediately. The gviz fallback covers a script
// that is not deployed yet, at the cost of Google's own few-minute cache.

import { APPS_SCRIPT_URL, SHEET_ID, WATCHED_GID, WATCHLIST_GID, PEOPLE_GID } from "../config.js";
import { getJSON } from "../core/http.js";
import { normaliseHeader } from "../core/util.js";

class SheetError extends Error {
  constructor(message) {
    super(message);
    this.name = "SheetError";
  }
}

const WATCHED_ALIASES = {
  name: ["name", "title", "movie", "movie name", "show", "show name"],
  year: ["year", "release year"],
  genre: ["genre", "genres"],
  poster: ["poster link", "poster", "poster url", "posterlink", "image"],
  tmdb_id: ["tmdb id", "tmdbid", "tmdb", "id", "tmdb_id"],
  og_title: ["og title", "original title", "ogtitle", "og_title"],
  industry: ["industry", "source tab", "category", "source", "tab", "type", "media", "list"],
  must_watch: ["must watch", "mustwatch", "must_watch", "must-watch", "priority"],
  favorite: ["favorites", "favourites", "favorite", "favourite", "liked", "like", "loved"]
};

const WATCHLIST_ALIASES = {
  name: WATCHED_ALIASES.name,
  year: WATCHED_ALIASES.year,
  genre: WATCHED_ALIASES.genre,
  poster: WATCHED_ALIASES.poster,
  tmdb_id: WATCHED_ALIASES.tmdb_id,
  og_title: WATCHED_ALIASES.og_title,
  industry: WATCHED_ALIASES.industry
};

const PEOPLE_ALIASES = {
  name: ["name", "person", "actor", "full name"],
  role: ["role", "known for", "job", "department"],
  industry: ["industry", "category", "source"],
  tmdb_id: ["tmdb_id", "tmdb id", "tmdbid", "id"],
  tmdb_status: ["tmdb_status", "tmdb status", "status"]
};

const TABS = {
  watched: { gid: WATCHED_GID, aliases: WATCHED_ALIASES, label: "All Watched" },
  watchlist: { gid: WATCHLIST_GID, aliases: WATCHLIST_ALIASES, label: "Watchlist" },
  people: { gid: PEOPLE_GID, aliases: PEOPLE_ALIASES, label: "People" }
};

function mapColumns(header, aliases) {
  const mapping = {};
  header.forEach((column, index) => {
    const normalised = normaliseHeader(column);
    if (!normalised) return;
    for (const [field, spellings] of Object.entries(aliases)) {
      if (spellings.includes(normalised) && mapping[index] === undefined) {
        mapping[index] = field;
        break;
      }
    }
  });
  return mapping;
}

function shapeRows(header, rows, aliases) {
  const mapping = mapColumns(header, aliases);
  const fields = Object.keys(aliases);
  const out = [];

  for (const raw of rows) {
    if (!raw.some(cell => String(cell == null ? "" : cell).trim())) continue;
    const record = {};
    fields.forEach(field => { record[field] = ""; });
    raw.forEach((cell, index) => {
      const field = mapping[index];
      if (field) record[field] = String(cell == null ? "" : cell).trim();
    });
    out.push(record);
  }
  return out;
}

// --- the Apps Script reader -------------------------------------------------

let bridgeRead = null;

// One request for all three tabs. Three separate calls would each pay the
// script's cold start.
function readBridge() {
  if (!bridgeRead) {
    bridgeRead = getJSON(`${APPS_SCRIPT_URL}?action=read`, { timeout: 25000 })
      .then(payload => {
        if (!payload || payload.ok !== true || !payload.tabs) {
          throw new SheetError("The write bridge answered, but not with sheet data.");
        }
        return payload.tabs;
      })
      .catch(error => {
        bridgeRead = null;
        throw error;
      });
  }
  return bridgeRead;
}

// --- the gviz fallback -----------------------------------------------------

let jsonpSeq = 0;

function readGviz(gid) {
  return new Promise((resolve, reject) => {
    const callback = `scGviz${++jsonpSeq}`;
    const script = document.createElement("script");
    const timer = setTimeout(() => finish(new SheetError("Google did not answer in time.")), 20000);

    function finish(error, table) {
      clearTimeout(timer);
      delete window[callback];
      script.remove();
      error ? reject(error) : resolve(table);
    }

    window[callback] = response => {
      const table = response && response.table;
      if (!table) return finish(new SheetError("That tab returned no table."));
      const header = (table.cols || []).map(col => col.label || col.id || "");
      const rows = (table.rows || []).map(row =>
        (row.c || []).map(cell => (cell && cell.f != null ? cell.f : cell ? cell.v : ""))
      );
      finish(null, { header, rows });
    };

    script.onerror = () => finish(new SheetError("Could not reach the spreadsheet."));
    script.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`
      + `?tqx=out:json;responseHandler:${callback}&gid=${encodeURIComponent(gid)}`;
    document.head.appendChild(script);
  });
}

// --- the one entry point ---------------------------------------------------

export async function fetchTab(which) {
  const tab = TABS[which];
  if (!tab) throw new SheetError(`No tab called "${which}".`);

  try {
    const tabs = await readBridge();
    const payload = tabs[which];
    if (payload && Array.isArray(payload.header)) {
      return shapeRows(payload.header, payload.rows || [], tab.aliases);
    }
  } catch {
    // Fall through. A missing deployment should cost the write buttons, not
    // the whole site.
  }

  try {
    const table = await readGviz(tab.gid);
    return shapeRows(table.header, table.rows, tab.aliases);
  } catch (error) {
    throw new SheetError(
      `Could not read ${tab.label}. Deploy the Apps Script bridge, or use `
      + `File > Share > Publish to web in Google Sheets. (${error.message})`
    );
  }
}

// Called after a write so the next read comes from the live sheet.
export function invalidate() {
  bridgeRead = null;
}
