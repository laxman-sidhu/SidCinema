import assert from "node:assert";
// cardactions touches no DOM at import time now that the floating layer is gone.
globalThis.document = { addEventListener() {} };
const { barFor, barMarkup } = await import("../../js/ui/cardactions.js");
const { gridMarkup } = await import("../../js/ui/cards.js");

const actsOf = item => barFor(item).map(b => b.act);

let pass=0, fail=0;
const t=(n,f)=>{try{f();pass++}catch(e){fail++;console.log("FAIL "+n+": "+e.message)}};



// Which toggles appear follows what the sheet can record. Favourite and Must
// Watch are columns on an All Watched row, so they need the row to exist.
// Watchlisting something already seen is a contradiction.
t("an unwatched card offers the watchlist and the tick", () => {
  assert.deepEqual(actsOf({ id:1, title:"Dune", watched:false }), ["watchlist", "watched"]);
});

t("a watched card offers both flags and the tick, and no watchlist", () => {
  assert.deepEqual(actsOf({ id:1, title:"Dune", watched:true }), ["favorite", "must", "watched"]);
});

// One position for one action, on every card, so the eye learns it.
t("the tick is always last on the right", () => {
  for (const watched of [true, false]) {
    const rows = barFor({ id:1, watched });
    const last = rows[rows.length - 1];
    assert.equal(last.act, "watched");
    assert.equal(last.side, "right");
  }
});

t("flags sit left, the watchlist sits right", () => {
  assert.ok(barFor({ id:1, watched:true }).filter(b => b.act !== "watched")
    .every(b => b.side === "left"));
  assert.equal(barFor({ id:1, watched:false })[0].side, "right");
});

t("the fill is the state", () => {
  const on = barMarkup({ id:1, title:"X", watched:true, favorite:true, must_watch:false });
  assert.match(on, /cardbar__btn--favorite is-on/);
  assert.ok(!/cardbar__btn--must is-on/.test(on));
  assert.match(on, /cardbar__btn--watched is-on/);
  assert.match(on, /aria-pressed="true"/);
});

t("an unwatched card shows an empty tick", () => {
  const off = barMarkup({ id:1, title:"X", watched:false, watchlisted:false });
  assert.match(off, /cardbar__btn--watched(?! is-on)/);
  assert.ok(!/is-on/.test(off));
});

t("the watchlist toggle reflects being on it", () => {
  assert.match(barMarkup({ id:1, title:"X", watched:false, watchlisted:true }),
    /cardbar__btn--watchlist is-on/);
});

t("a row with no id gets no bar", () => {
  assert.equal(barMarkup({ id:null, title:"Old Film", watched:true }), "");
  assert.equal(barMarkup({ id:"", title:"X" }), "");
});

t("labels are escaped into the tooltip", () => {
  assert.ok(!barMarkup({ id:1, title:"X", watched:false }).includes("<script"));
  assert.match(barMarkup({ id:1, title:"X", watched:false }), /aria-label="/);
});

t("no three-dot menu remains", () => {
  const markup = barMarkup({ id:1, title:"X", watched:true });
  assert.ok(!markup.includes("data-menu"), "the menu should be gone entirely");
  assert.ok(!markup.includes("cardmenu"));
});

// There is no placeholder graphic. A title says which film TMDB has no artwork
// for; a generic film reel says nothing.
const withPoster = { id:1, title:"Fight Club", media_type:"movie", poster:"https://img/x.jpg",
  year:1999, genres:["Drama"], overview:"o", rating:8.4, vote_count:900, watched:false };
const without = { ...withPoster, id:2, title:"Some Obscure Film \u7fa4\u4f53", poster:null };

for (const [label, render] of [["search card", i => gridMarkup([i])],
                               ["library card", i => gridMarkup([i], { sheet:true })]]) {
  t(`${label}: no poster means the title and no img`, () => {
    const html = render(without);
    assert.match(html, /card__noposter">Some Obscure Film/);
    assert.ok(!/<img/.test(html), "there should be no image element at all");
    assert.ok(!/placeholder/i.test(html));
  });

  t(`${label}: with a poster the title still sits behind it`, () => {
    const html = render(withPoster);
    const noposter = html.indexOf("card__noposter");
    const img = html.indexOf("<img");
    assert.ok(noposter > -1, "the title should always be rendered");
    assert.ok(img > -1 && img > noposter, "the image must come after, so it covers the title");
    assert.match(html, /alt=""/, "an empty alt is what makes a failed load reveal the title");
    assert.ok(!/onerror/.test(html), "no error handler needed");
  });
}

t("the title is escaped in the fallback", () => {
  assert.match(gridMarkup([{ ...without, title:'<img src=x onerror="y">' }]), /&lt;img/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
