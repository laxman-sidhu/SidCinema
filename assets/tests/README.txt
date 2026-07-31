Nine suites, seven of them runnable with plain Node and no dependencies.

    node assets/tests/logic.test.mjs     search parsing, sections, sheet helpers
    node assets/tests/data.test.mjs      the sheet layer and every write path
    node assets/tests/watchlist.test.mjs identity: one film, one row, everywhere
    node assets/tests/people.test.mjs    co-star searches, and the calls they make
    node assets/tests/nav.test.mjs       which navbar entry is marked where
    node assets/tests/cardbar.test.mjs   every shape the card action bar can take
    node assets/tests/css.test.mjs       stacking, class coverage, iOS zoom
    node assets/tests/flow.test.mjs      a real page in a real DOM (needs jsdom)
    node assets/tests/modal.test.mjs     the detail modal, rendered (needs jsdom)

Seven of the nine need nothing installed. flow.test.mjs and modal.test.mjs want
jsdom and skip cleanly without it:

    npm install jsdom

There is no package.json, so Node prints a "module type is not specified" warning
before those two run. Harmless - it is the absence of "type": "module", not a
problem with the code.

The pattern is the same one the Flask version used: stub the wire, then exercise
the real modules. logic.test.mjs needs no stubs at all because those modules
touch nothing. data.test.mjs replaces global fetch with a fake workbook, so the
tests cover the cases that actually matter and cost nothing to run:

  - columns found by header name, with the unnamed spacer ignored
  - matching by TMDB id rather than title
  - a re-watch counting as one title
  - Google first, memory second: a failed write leaves memory untouched
  - marking watched taking exactly ONE Apps Script call
  - Must Watch and Favorites not disturbing each other

watchlist.test.mjs runs on a slice of the REAL sheet rather than tidy fixtures,
because the bug it guards does not appear in tidy fixtures. It carries the two
Ved rows (one film, two TMDB records), the low ids that collide with TV ids, and
the blank-Industry rows the site writes itself:

  - a film TMDB holds twice recognised under either id
  - the same title never queued twice
  - a different year being a different film - the The Call guard, still holding
  - a watched series not hiding a queued film that merely shares its id
  - a blank Industry matching either kind rather than being guessed at
  - two rows for one film rendering as one card
  - removing one duplicate removing them all
  - a write addressing the row the SHEET holds, not the id on the card

Worth running before any change to the write path.

The snapshot key in flow.test.mjs carries the VERSION from js/data/snapshot.js.
Bumping it there without bumping it here does not fail loudly - the snapshot is
simply never found, and the test quietly stops proving the thing it exists for.
