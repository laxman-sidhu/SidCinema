// Splits a result list into the sections the UI renders. There are exactly
// three: released titles, everything not out yet, and titles related to a match.
//
// Upcoming is separated because a card you cannot watch tonight is a different
// kind of answer to one you can. Related is separated because it answers a
// different question to the one that was asked, and mixing it in would make a
// search look like it returned twenty wrong films.
//
// One guarantee the rest of the app relies on: every title lands in exactly one
// section, and an empty section is dropped rather than shown empty.

import { today } from "../core/util.js";

const TV = "tv";

const RELEASED = "released";
const UPCOMING = "upcoming";
const RELATED = "related";

function noun(media) {
  return media === TV ? "Series" : "Movies";
}

function isUpcoming(item, when) {
  const date = String(item.release_date || "").trim();
  if (date) return date > (when || today());
  // No date at all. Anything already rated is an old title with sloppy
  // metadata; anything unrated is an announced project.
  return !item.vote_count && !item.rating;
}

function byReleaseSoonest(items) {
  return [...items].sort((a, b) => {
    const aUndated = a.release_date ? 0 : 1;
    const bUndated = b.release_date ? 0 : 1;
    if (aUndated !== bUndated) return aUndated - bUndated;
    const left = a.release_date || "9999-99-99";
    const right = b.release_date || "9999-99-99";
    if (left !== right) return left.localeCompare(right);
    return (b.popularity || 0) - (a.popularity || 0);
  });
}

export function buildSections(items, { media = "movie", relatedTo = null, when = null } = {}) {
  if (!items || !items.length) return [];

  const day = when || today();
  const matches = items.filter(item => !item.related);
  const related = items.filter(item => item.related);

  const released = matches.filter(item => !isUpcoming(item, day));
  const upcoming = matches.filter(item => isUpcoming(item, day));

  const word = noun(media);
  const relatedTitle = relatedTo ? `More like ${relatedTo}` : `Related ${word.toLowerCase()}`;

  const sections = [
    { key: RELEASED, icon: "", title: word, count: released.length, movies: released },
    { key: UPCOMING, icon: "\u{1F4C5}", title: `Upcoming ${word}`, count: upcoming.length, movies: byReleaseSoonest(upcoming) },
    { key: RELATED, icon: "\u2728", title: relatedTitle, count: related.length, movies: related }
  ];

  const filled = sections.filter(section => section.movies.length);

  // Only released titles came back, so there is nothing to tell apart and the
  // heading would just be a label on the whole page.
  if (filled.length === 1 && filled[0].key === RELEASED) {
    filled[0] = { ...filled[0], title: "", icon: "" };
  }

  return filled;
}
