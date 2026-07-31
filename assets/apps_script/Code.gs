/**
 * SidCinema - the read and write bridge.
 *
 * Paste this into Extensions > Apps Script on the workbook, set SECRET below,
 * then deploy as a web app. Full instructions in SETUP.txt.
 *
 * WHAT THIS IS FOR
 * The site is static HTML, CSS and JS with no server of its own. This script is
 * the only thing that touches the spreadsheet. It lives inside the workbook and
 * runs as its owner, so it can read and edit without any Google credential ever
 * leaving Google.
 *
 * Reading through doGet rather than the published CSV is deliberate. A published
 * CSV is cached by Google for minutes, so a write was invisible until the cache
 * expired; this reads the live sheet, so a change is there on the next load.
 *
 * SECURITY
 * The deployment has to be readable by "Anyone" for the site to reach it, so the
 * URL is effectively public and SECRET is the only thing between a stranger and
 * your spreadsheet. Treat it like a password. Changing it here and redeploying
 * revokes access instantly. Google Sheets keeps full version history, so
 * File > Version history restores anything lost.
 *
 * A ROW IS FOUND BY IDENTITY, NOT BY TMDB ID ALONE.
 * TMDB holds some films twice - "Ved" (2022) is 1037690 and 913544, same film,
 * same poster - so an id-only check said "not here" about a row that was, and
 * appended a second one. Every lookup here tries the id first and then the name
 * and year together. Title alone is never enough: two different films called
 * "The Call" are two rows, and only the year tells them apart.
 *
 * COLUMNS ARE FOUND BY HEADER NAME, NEVER BY POSITION.
 * All Watched has an unnamed spacer column and columns get moved by hand.
 * Writing to "column 9" would corrupt data the first time something shifted,
 * silently. Writing to "the column whose header says Must Watch" survives any
 * rearrangement and fails loudly if the header is gone.
 */

// ============================================================================
// SETTINGS
// ============================================================================

/** Must match APPS_SCRIPT_TOKEN in js/config.js. Change both together. */
var SECRET = 'THIS-IS-A-LONG-RANDOM-STRING-FOR-APPS-SCRIPT-TOKEN';

/** Tab names as they appear at the bottom of the workbook. */
var WATCHED_SHEET = 'All Watched';
var WATCHLIST_SHEET = 'Watchlist';
var PEOPLE_SHEET = 'People';

/** What gets written into Must Watch and Favorites when they are ticked. */
var FLAG_YES = 'Yes';

/**
 * Header text -> the field the site sends. Compared lowercased and with
 * whitespace collapsed, so "Tmdb Id", "TMDB ID" and " tmdb id " all match.
 * Add spellings here if a header is ever renamed.
 */
var COLUMN_ALIASES = {
  name:       ['name', 'title', 'movie', 'movie name', 'show', 'show name'],
  year:       ['year', 'release year'],
  genre:      ['genre', 'genres'],
  poster:     ['poster link', 'poster', 'poster url', 'posterlink', 'image'],
  tmdb_id:    ['tmdb id', 'tmdbid', 'tmdb', 'id', 'tmdb_id'],
  og_title:   ['og title', 'original title', 'ogtitle', 'og_title'],
  industry:   ['industry', 'source tab', 'category', 'source', 'tab', 'type', 'media', 'list'],
  must_watch: ['must watch', 'mustwatch', 'must_watch', 'must-watch', 'priority'],
  favorite:   ['favorites', 'favourites', 'favorite', 'favourite', 'liked', 'like', 'loved']
};

// ============================================================================
// ENTRY POINTS
// ============================================================================

/**
 * Reading. No token required: the same rows are readable through the published
 * CSV anyway, so demanding one here would protect nothing and would put the
 * secret into every page load.
 *
 * One request returns all three tabs. Three separate calls would each pay this
 * script's cold start, which is the slowest part of a first page load.
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'read';

  if (action !== 'read') {
    return reply({
      ok: true,
      message: 'SidCinema bridge is deployed. Use ?action=read to read, POST to write.'
    });
  }

  try {
    return reply({
      ok: true,
      tabs: {
        watched: readTab(WATCHED_SHEET),
        watchlist: readTab(WATCHLIST_SHEET),
        people: readTab(PEOPLE_SHEET)
      }
    });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

/** Writing. Every action here needs the token. */
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (body.token !== SECRET) {
      return reply({ ok: false, error: 'Bad token.' });
    }

    var action = String(body.action || '');
    var payload = body.payload || {};

    switch (action) {
      case 'ping':             return reply(ping());
      case 'add_watched':      return reply(addWatched(payload));
      case 'remove_watched':   return reply(removeWatched(payload));
      case 'set_flags':        return reply(setFlags(payload));
      case 'add_watchlist':    return reply(addWatchlist(payload));
      case 'remove_watchlist': return reply(removeWatchlist(payload));
      default:
        return reply({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

function reply(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// READING
// ============================================================================

/**
 * One tab as a header row plus data rows. Values are stringified here rather
 * than in the browser, because a year read as a number and a year read as text
 * are different keys once they reach a lookup.
 */
function readTab(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) return { header: [], rows: [] };

  var values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return { header: [], rows: [] };

  return { header: values[0], rows: values.slice(1) };
}

// ============================================================================
// SHEET HELPERS
// ============================================================================

function normaliseHeader(text) {
  return String(text == null ? '' : text)
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getSheet(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('No tab named "' + name + '" in this workbook.');
  return sheet;
}

/** Canonical field name -> 1-based column index, matched on header text. */
function columnMap(sheet) {
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};

  for (var i = 0; i < header.length; i++) {
    var normalised = normaliseHeader(header[i]);
    if (!normalised) continue;

    for (var field in COLUMN_ALIASES) {
      if (map[field] !== undefined) continue;
      if (COLUMN_ALIASES[field].indexOf(normalised) !== -1) {
        map[field] = i + 1;
        break;
      }
    }
  }
  return map;
}

function requireColumn(map, field, sheet) {
  if (map[field] === undefined) {
    throw new Error('The "' + sheet.getName() + '" tab has no column for ' + field
      + '. Expected a header naming it.');
  }
  return map[field];
}

function toId(value) {
  var text = String(value == null ? '' : value).replace(/,/g, '');
  var match = text.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

/**
 * Lowercase, unaccented, punctuation-free, single-spaced - the same shape
 * js/core/util.js produces, so the two sides agree on what "the same title"
 * looks like.
 *
 * \p{L} needs the u flag and a V8 runtime. Built with new RegExp so an old
 * Rhino deployment falls back to ASCII rather than refusing to parse the file
 * at all - which would take every write down, not just this one.
 */
var TITLE_STRIP = (function () {
  try { return new RegExp('[^\\p{L}\\p{N}\\s]', 'gu'); }
  catch (e) { return /[^a-z0-9\s]/g; }
})();

function normaliseTitleText(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(TITLE_STRIP, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toYear(value) {
  var match = String(value == null ? '' : value).match(/\d{4}/);
  return match ? match[0] : '';
}

/**
 * Every 1-based row this title occupies, newest last. Matched on the id, or on
 * the name and the year together.
 *
 * A blank year on either side falls back to the title alone, because a row with
 * no year has nothing else to be matched on. Rows that DO carry a year are
 * never matched across years.
 */
function findRowsByIdentity(sheet, map, payload) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var wantedId = toId(payload.tmdb_id);
  var wantedYear = toYear(payload.year);
  var wantedTitles = [];

  var raw = [payload.name, payload.og_title, payload.title, payload.original_title];
  for (var t = 0; t < raw.length; t++) {
    var norm = normaliseTitleText(raw[t]);
    if (norm && wantedTitles.indexOf(norm) === -1) wantedTitles.push(norm);
  }

  var width = Math.max(sheet.getLastColumn(), 1);
  var values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  var found = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var cell = function (field) {
      var column = map[field];
      return column === undefined ? '' : row[column - 1];
    };

    if (wantedId !== null && toId(cell('tmdb_id')) === wantedId) {
      found.push(i + 2);
      continue;
    }
    if (!wantedTitles.length) continue;

    var rowYear = toYear(cell('year'));
    if (wantedYear && rowYear && wantedYear !== rowYear) continue;

    var names = [normaliseTitleText(cell('name')), normaliseTitleText(cell('og_title'))];
    for (var n = 0; n < names.length; n++) {
      if (names[n] && wantedTitles.indexOf(names[n]) !== -1) {
        found.push(i + 2);
        break;
      }
    }
  }
  return found;
}

/** The first row this title occupies, or 0. */
function findRowByIdentity(sheet, map, payload) {
  var rows = findRowsByIdentity(sheet, map, payload);
  return rows.length ? rows[0] : 0;
}

/** Deletes rows bottom-up, so an earlier deletion cannot shift a later index. */
function deleteRows(sheet, rows) {
  var sorted = rows.slice().sort(function (a, b) { return b - a; });
  for (var i = 0; i < sorted.length; i++) sheet.deleteRow(sorted[i]);
  return sorted.length;
}

/**
 * Append one row, writing each field into the column its header names. Cells
 * whose header is absent are simply skipped, including the unnamed spacer.
 */
function appendRow(sheet, map, fields) {
  var width = Math.max(sheet.getLastColumn(), 1);
  var row = new Array(width);
  for (var i = 0; i < width; i++) row[i] = '';

  for (var field in fields) {
    var column = map[field];
    if (column !== undefined && column <= width) row[column - 1] = fields[field];
  }

  sheet.appendRow(row);
  return sheet.getLastRow();
}

// ============================================================================
// ACTIONS
// ============================================================================

function ping() {
  var watched = getSheet(WATCHED_SHEET);
  var watchlist = getSheet(WATCHLIST_SHEET);
  var map = columnMap(watched);

  var found = [];
  for (var field in map) found.push(field);

  return {
    ok: true,
    bridge: {
      watched_rows: Math.max(watched.getLastRow() - 1, 0),
      watchlist_rows: Math.max(watchlist.getLastRow() - 1, 0),
      columns_found: found.sort(),
      secret_is_placeholder: SECRET.indexOf('THIS-IS-A-LONG-RANDOM') === 0
    }
  };
}

/**
 * Append to All Watched and delete from Watchlist in ONE call. Two calls can
 * half-fail and leave a title sitting in both lists.
 */
function addWatched(payload) {
  var sheet = getSheet(WATCHED_SHEET);
  var map = columnMap(sheet);
  requireColumn(map, 'name', sheet);
  requireColumn(map, 'tmdb_id', sheet);

  var tmdbId = toId(payload.tmdb_id);
  if (tmdbId === null) return { ok: false, error: 'That title has no TMDB id.' };

  var existing = findRowByIdentity(sheet, map, payload);
  if (existing) {
    // Already watched, under this id or TMDB's other one for the same film.
    // Apply the flags rather than adding a duplicate row.
    var applied = setFlags({
      tmdb_id: tmdbId,
      name: payload.name,
      og_title: payload.og_title,
      year: payload.year,
      must_watch: payload.must_watch === FLAG_YES || payload.must_watch === true,
      favorite: payload.favorite === FLAG_YES || payload.favorite === true
    });
    applied.already_watched = true;
    applied.removed_from_watchlist = removeFromWatchlist(payload) > 0;
    return applied;
  }

  var row = appendRow(sheet, map, {
    name: payload.name || '',
    year: payload.year || '',
    genre: payload.genre || '',
    poster: payload.poster || '',
    tmdb_id: tmdbId,
    og_title: payload.og_title || '',
    industry: payload.industry || '',
    must_watch: payload.must_watch || '',
    favorite: payload.favorite || ''
  });

  return {
    ok: true,
    row: row,
    removed_from_watchlist: removeFromWatchlist(payload) > 0
  };
}

function removeWatched(payload) {
  var sheet = getSheet(WATCHED_SHEET);
  var map = columnMap(sheet);
  var rows = findRowsByIdentity(sheet, map, payload);

  if (!rows.length) return { ok: true, removed: false };

  // Every row for this title, so a re-watch logged twice does not leave half of
  // itself behind and the card come back green on the next load.
  var removed = deleteRows(sheet, rows);
  return { ok: true, removed: true, rows_removed: removed };
}

/**
 * Must Watch and Favorites. Only the flags actually named are touched, so
 * liking something never disturbs its must-watch state.
 */
function setFlags(payload) {
  var sheet = getSheet(WATCHED_SHEET);
  var map = columnMap(sheet);
  var row = findRowByIdentity(sheet, map, payload);

  if (!row) return { ok: false, error: 'That title is not in All Watched.' };

  var changed = [];

  if (payload.must_watch !== undefined && payload.must_watch !== null) {
    var mustColumn = requireColumn(map, 'must_watch', sheet);
    sheet.getRange(row, mustColumn).setValue(payload.must_watch ? FLAG_YES : '');
    changed.push('must_watch');
  }

  if (payload.favorite !== undefined && payload.favorite !== null) {
    var favColumn = requireColumn(map, 'favorite', sheet);
    sheet.getRange(row, favColumn).setValue(payload.favorite ? FLAG_YES : '');
    changed.push('favorite');
  }

  return { ok: true, row: row, changed: changed };
}

function addWatchlist(payload) {
  var sheet = getSheet(WATCHLIST_SHEET);
  var map = columnMap(sheet);
  requireColumn(map, 'name', sheet);
  requireColumn(map, 'tmdb_id', sheet);

  var tmdbId = toId(payload.tmdb_id);
  if (tmdbId === null) return { ok: false, error: 'That title has no TMDB id.' };

  // By identity, not by id. This is the check that stops a second row for a
  // film TMDB happens to hold twice.
  if (findRowByIdentity(sheet, map, payload)) {
    return { ok: true, already_listed: true };
  }

  var row = appendRow(sheet, map, {
    name: payload.name || '',
    year: payload.year || '',
    genre: payload.genre || '',
    poster: payload.poster || '',
    tmdb_id: tmdbId,
    og_title: payload.og_title || '',
    industry: payload.industry || ''
  });

  return { ok: true, row: row };
}

function removeWatchlist(payload) {
  var removed = removeFromWatchlist(payload);
  return { ok: true, removed: removed > 0, rows_removed: removed };
}

/**
 * Every queued row for this title, not just the first. Duplicates that predate
 * the identity check have to leave together, or removing one leaves the other
 * in the queue and the card comes straight back.
 *
 * Takes the whole payload, or a bare id.
 */
function removeFromWatchlist(payload) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WATCHLIST_SHEET);
  if (!sheet) return 0;

  var target = (payload && typeof payload === 'object') ? payload : { tmdb_id: payload };
  var map = columnMap(sheet);
  var rows = findRowsByIdentity(sheet, map, target);
  if (!rows.length) return 0;

  return deleteRows(sheet, rows);
}

// ============================================================================
// SETUP CHECK
// ============================================================================

/**
 * A one-off tidy of the Watchlist tab, for duplicates that predate the identity
 * check. Select it in the toolbar and press Run.
 *
 * Removes two things: a second row for a film already queued, and a row for
 * something already in All Watched. Nothing else is touched, and the first row
 * of each title is always the one kept. Google Sheets keeps full version
 * history, so File > Version history undoes this if it takes something wanted.
 */
function cleanWatchlist() {
  var sheet = getSheet(WATCHLIST_SHEET);
  var map = columnMap(sheet);
  var watchedSheet = getSheet(WATCHED_SHEET);
  var watchedMap = columnMap(watchedSheet);

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('Watchlist is empty.');
    return;
  }

  var width = Math.max(sheet.getLastColumn(), 1);
  var values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  var seen = {};
  var doomed = [];
  var duplicates = 0;
  var watchedAlready = 0;

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var read = function (field) {
      var column = map[field];
      return column === undefined ? '' : row[column - 1];
    };

    var payload = {
      tmdb_id: read('tmdb_id'),
      name: read('name'),
      og_title: read('og_title'),
      year: read('year')
    };

    var id = toId(payload.tmdb_id);
    var year = toYear(payload.year);
    var keys = [];
    if (id !== null) keys.push('id:' + id);
    var titles = [normaliseTitleText(payload.name), normaliseTitleText(payload.og_title)];
    for (var t = 0; t < titles.length; t++) {
      if (titles[t]) keys.push('t:' + titles[t] + '|' + year);
    }

    var isDuplicate = false;
    for (var k = 0; k < keys.length; k++) {
      if (seen[keys[k]]) isDuplicate = true;
    }
    for (var k2 = 0; k2 < keys.length; k2++) seen[keys[k2]] = true;

    if (isDuplicate) {
      doomed.push(i + 2);
      duplicates++;
      continue;
    }
    if (findRowByIdentity(watchedSheet, watchedMap, payload)) {
      doomed.push(i + 2);
      watchedAlready++;
    }
  }

  if (!doomed.length) {
    Logger.log('Nothing to clean: ' + values.length + ' rows, all distinct and none watched.');
    return;
  }

  deleteRows(sheet, doomed);
  Logger.log('Removed ' + doomed.length + ' rows: '
    + duplicates + ' duplicate, ' + watchedAlready + ' already watched.');
  Logger.log(Math.max(sheet.getLastRow() - 1, 0) + ' rows left on the watchlist.');
}

/**
 * Select this function in the Apps Script toolbar and press Run. It reports
 * what it found without changing anything, so a broken setup can be diagnosed
 * before the site is pointed at it.
 */
function testSetup() {
  var report = ping();
  Logger.log('Watched rows:    ' + report.bridge.watched_rows);
  Logger.log('Watchlist rows:  ' + report.bridge.watchlist_rows);
  Logger.log('Columns found:   ' + report.bridge.columns_found.join(', '));

  var needed = ['name', 'tmdb_id', 'must_watch', 'favorite'];
  for (var i = 0; i < needed.length; i++) {
    if (report.bridge.columns_found.indexOf(needed[i]) === -1) {
      Logger.log('MISSING COLUMN: ' + needed[i] + ' - check the header row.');
    }
  }

  var people = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PEOPLE_SHEET);
  Logger.log('People tab:      ' + (people ? 'found' : 'NOT FOUND (autocomplete will be off)'));

  if (report.bridge.secret_is_placeholder) {
    Logger.log('WARNING: SECRET is still the placeholder. Replace it with a long '
      + 'random string, put the same value in js/config.js, then redeploy.');
  }

  Logger.log('Remember: the site sees the last DEPLOYED version, not the last saved one.');
}
