// The People tab, indexed for correction and autocomplete: a name the sheet knows never costs a TMDB or Gemini call.

import { fetchTab } from "./sheets.js";
import * as snapshot from "./snapshot.js";
import { parseId } from "../core/util.js";

const MIN_CORRECTION_LENGTH = 4;
const MIN_CORRECTION_SCORE = 0.74;
const MIN_DICE = 0.28;
const SUGGEST_MIN_LENGTH = 2;
const SUGGEST_FUZZY_SCORE = 0.68;
const SUGGEST_LIMIT = 8;

function normaliseName(value) {
  if (!value) return "";
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Spaces removed, so "shahrukh khan" and "shah rukh khan" land here as the same string.
function flatten(normalised) {
  return normalised.replace(/ /g, "");
}

function bigrams(text) {
  const out = new Set();
  for (let i = 0; i < text.length - 1; i++) out.add(text.slice(i, i + 2));
  return out.size ? out : new Set([text]);
}

function dice(left, right) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared++;
  return (2 * shared) / (left.size + right.size);
}

// Longest common subsequence ratio, which is what SequenceMatcher.ratio approximates.
function ratio(a, b) {
  if (!a.length || !b.length) return 0;
  if (a === b) return 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = new Array(cols).fill(0);
  let current = new Array(cols).fill(0);

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      current[j] = a[i - 1] === b[j - 1]
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1]);
    }
    [previous, current] = [current, previous];
    current.fill(0);
  }
  return (2 * previous[cols - 1]) / (a.length + b.length);
}

// Best pairing of query words to name words, weighted by length, so one bad word is not diluted by the good ones.
function tokenSimilarity(queryTokens, nameTokens) {
  if (!queryTokens.length || !nameTokens.length) return 0;

  let totalWeight = 0;
  let earned = 0;
  for (const token of queryTokens) {
    let best = 0;
    for (const other of nameTokens) best = Math.max(best, ratio(token, other));
    earned += best * token.length;
    totalWeight += token.length;
  }
  let covered = totalWeight ? earned / totalWeight : 0;

  // A query covering only part of the name is a partial name, not a typo - otherwise "khan" scores perfectly against every Khan.
  if (nameTokens.length > queryTokens.length) {
    covered *= 0.72 + 0.28 * (queryTokens.length / nameTokens.length);
  }
  return covered;
}

function scoreNames(query, candidate) {
  const queryNorm = normaliseName(query);
  const nameNorm = normaliseName(candidate);
  if (!queryNorm || !nameNorm) return 0;

  const queryFlat = flatten(queryNorm);
  const nameFlat = flatten(nameNorm);
  if (queryFlat === nameFlat) return 1;

  // A complete prefix is an unfinished name, scaled by how much was typed so "shahrukh" beats "shah".
  if (queryFlat.length >= MIN_CORRECTION_LENGTH && nameFlat.startsWith(queryFlat)) {
    return 0.80 + 0.20 * (queryFlat.length / nameFlat.length);
  }

  return Math.max(ratio(queryFlat, nameFlat), tokenSimilarity(queryNorm.split(" "), nameNorm.split(" ")));
}

class PeopleDirectory {
  constructor() {
    this.rows = [];
    this.grams = [];
    this.byFlat = new Map();
    this.lastError = null;
  }

  get ready() {
    return this.rows.length > 0;
  }

  // Shaping happens here rather than in load(), so a snapshot and a live read take the same path.
  install(raw) {
    const rows = [];
    const byFlat = new Map();

    for (const record of raw) {
      const name = (record.name || "").trim();
      if (!name) continue;
      const norm = normaliseName(name);
      const flat = flatten(norm);
      const row = {
        name,
        norm,
        flat,
        tokens: norm.split(" ").filter(Boolean),
        role: (record.role || "").trim(),
        industry: (record.industry || "").trim(),
        tmdb_id: parseId(record.tmdb_id),
        tmdb_status: (record.tmdb_status || "").trim()
      };
      rows.push(row);
      if (flat && !byFlat.has(flat)) byFlat.set(flat, row);
    }

    this.rows = rows;
    this.grams = rows.map(row => bigrams(row.flat));
    this.byFlat = byFlat;
    this.lastError = null;
  }

  // Synchronous, so autocomplete answers the first keystroke after a refresh rather than the third.
  hydrate() {
    if (this.rows.length) return true;
    const rows = snapshot.load("people");
    if (!rows) return false;
    this.install(rows);
    return true;
  }

  async load() {
    try {
      const raw = await fetchTab("people");
      this.install(raw);
      // Only the sheet's own columns are stored; the rest is derived on install.
      snapshot.save("people", raw.filter(record => (record.name || "").trim()));
      return true;
    } catch (error) {
      if (!this.rows.length) this.lastError = error.message;
      return this.rows.length > 0;
    }
  }

  // The row for a name typed correctly, ignoring spacing and accents.
  exact(term) {
    const flat = flatten(normaliseName(term));
    return flat ? this.byFlat.get(flat) || null : null;
  }

  // Returns null rather than a weak guess: the caller has better fallbacks than a confident wrong answer.
  correct(term) {
    const queryNorm = normaliseName(term);
    const queryFlat = flatten(queryNorm);
    if (queryFlat.length < MIN_CORRECTION_LENGTH || !this.rows.length) return null;

    const queryGrams = bigrams(queryFlat);
    let best = null;
    let bestScore = 0;

    for (let index = 0; index < this.rows.length; index++) {
      if (dice(queryGrams, this.grams[index]) < MIN_DICE) continue;
      const score = scoreNames(queryNorm, this.rows[index].norm);
      if (score > bestScore) {
        best = this.rows[index];
        bestScore = score;
        if (score >= 1) break;
      }
    }

    if (!best || bestScore < MIN_CORRECTION_SCORE) return null;
    return { ...best, score: Math.round(bestScore * 1000) / 1000 };
  }

  // Four tiers: name prefix, word prefix, substring, then close-enough typo. Within a tier the sheet's own order wins.
  suggest(term, limit = SUGGEST_LIMIT) {
    const queryNorm = normaliseName(term);
    if (queryNorm.length < SUGGEST_MIN_LENGTH || !this.rows.length) return [];

    const queryFlat = flatten(queryNorm);
    const queryTokens = queryNorm.split(" ").filter(Boolean);
    const lastToken = queryTokens[queryTokens.length - 1] || queryFlat;
    const queryGrams = bigrams(queryFlat);
    const scored = [];

    for (let index = 0; index < this.rows.length; index++) {
      const row = this.rows[index];
      let tier = null;
      let score = 0;

      if (row.flat.startsWith(queryFlat)) {
        tier = 0;
      } else if (row.tokens.some(token => token.startsWith(lastToken))) {
        tier = 1;
      } else if (row.flat.includes(queryFlat)) {
        tier = 2;
      } else if (dice(queryGrams, this.grams[index]) >= MIN_DICE) {
        const fuzzy = scoreNames(queryNorm, row.norm);
        if (fuzzy >= SUGGEST_FUZZY_SCORE) {
          tier = 3;
          score = fuzzy;
        }
      }

      if (tier !== null) scored.push({ tier, score: -score, index, row });
    }

    scored.sort((a, b) => a.tier - b.tier || a.score - b.score || a.index - b.index);

    return scored.slice(0, Math.max(1, Math.min(limit, 20))).map(({ row }) => ({
      name: row.name,
      role: row.role,
      industry: row.industry,
      tmdb_id: row.tmdb_id
    }));
  }
}

export const people = new PeopleDirectory();
