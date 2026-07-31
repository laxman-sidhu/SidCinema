// Every credential and constant. Nothing else in the app holds a key.
// Rotate anything here and the whole app follows.

export const TMDB_API_KEY = "f937245c9deb3cb82511d04b777e096f";

// Optional. Without it the offline parser handles every search.
export const GEMINI_API_KEY = "AQ.Ab8RN6KguL0XdOCrMtJcCQP04IfWIpxtcT6lifaX5nkqoxnNPA";
export const GEMINI_MODEL = "gemini-2.0-flash";

// The Apps Script web app deployed from inside the workbook. It both reads
// the tabs and writes to them. See SETUP.txt.
export const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby5--x2f-OHO4jwZRrFXxXBm9YNFg8e8YCJkh9qiz0-tmZAEXrvH7NSBd6Rzon0KOhw/exec";

// Must match SECRET inside Code.gs exactly. Change both together.
export const APPS_SCRIPT_TOKEN = "THIS-IS-A-LONG-RANDOM-STRING-FOR-APPS-SCRIPT-TOKEN";

// The /d/<this>/edit part of the spreadsheet URL. Only used by the gviz
// fallback reader, which runs when the Apps Script read fails.
export const SHEET_ID = "1UhTK_0IqotZila6-SFMVYtmP863qcWAt4Jk1JBj3ETs";

export const WATCHED_GID = "0";
export const WATCHLIST_GID = "549028903";
export const PEOPLE_GID = "1194380540";

// The Industry value that means series rather than film.
export const SERIES_INDUSTRY = "Web Series";

// Written into Must Watch and Favorites when ticked.
export const FLAG_YES = "Yes";

// Typed once per device to unlock editing. Checked in the browser only, so
// this gates the buttons, not the sheet. SETUP.txt section 7 explains.
export const OWNER_PASSWORD = "LaxSid@12345";
export const OWNER_NAME = "Laxman";
export const SESSION_DAYS = 90;

// How long a TMDB response stays cached in this tab.
export const TMDB_TTL_MS = 6 * 60 * 60 * 1000;

export const TMDB_BASE = "https://api.themoviedb.org/3";
export const IMAGE_BASE = "https://image.tmdb.org/t/p";
export const POSTER_SIZE = "w500";
export const BACKDROP_SIZE = "w1280";
export const PROFILE_SIZE = "w185";

// Pages of TMDB results fetched per request, and the browse ceiling.
export const PAGES_PER_REQUEST = 2;
export const BROWSE_PAGES = 3;
export const MAX_BROWSE_PAGE = 5;
export const TMDB_PAGE_SIZE = 20;

// Runtimes and certifications cost one call per title, so cap the enrichment.
export const ENRICH_LIMIT = 18;

export const MAX_QUERY_LENGTH = 160;
