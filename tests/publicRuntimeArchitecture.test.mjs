import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { activeSets } from "../src/data/sets.js";
import { getSetExploreDetails } from "../src/lib/setExploreDetails.js";
import { getSetPublicContent } from "../src/lib/setContent.js";
import { getPublicSeoDescriptor } from "../src/lib/publicSeo.js";
import { getCanonicalSetPath } from "../src/lib/publicSetRoutes.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const setById = (id) => activeSets.find((set) => set.id === id);

test("runtime entry keeps root public, lazily routes content, and preserves explicit desktop compatibility", async () => {
  const [main, entry] = await Promise.all([read("../src/main.jsx"), read("../src/welcomeEntry.js")]);

  assert.match(main, /const isPublicLanding = !forceDesktop/);
  assert.match(main, /\["\/", "\/welcome"\]\.includes\(normalizedPath\)/);
  assert.match(main, /from "\.\/lib\/runtimeRoutes\.js"/);
  assert.match(main, /from "\.\/lib\/setRouteCatalog\.js"/);
  assert.doesNotMatch(main, /import\("\.\/lib\/publicRoutes\.js"\)/);
  assert.match(main, /from "\.\/lib\/staticPublicRoutes\.js"/);
  assert.match(main, /isEditorialPublicPath\(normalizedPath\)/);
  assert.match(main, /import\("\.\/PublicPages\.jsx"\)/);
  assert.match(main, /window\.history\.replaceState[\s\S]*?activeRoute\.canonicalPath/);
  assert.match(main, /props: \{ route: activeRoute \}/);
  assert.doesNotMatch(main, /window\.location\.replace\("\/mobile-app\/"\)/);
  assert.match(entry, /if \(forceDesktop\) return "desktop-app"/);
  assert.match(entry, /return "welcome"/);
});

test("public content pages expose the approved copy, one H1, and crawlable set links", async () => {
  const [pages, layout, app, selector] = await Promise.all([
    read("../src/PublicPages.jsx"),
    read("../src/public/PublicLayout.jsx"),
    read("../src/App.jsx"),
    read("../src/components/SetSelect.jsx"),
  ]);

  for (const phrase of [
    "Is PackDex free to play?",
    "How PackDex Works",
    "Hi, my name is Jonathan.",
    "PackDex is an unofficial, fan-made project",
  ]) assert.match(pages, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(pages, /from "\.\/lib\/staticPublicSeo\.js"/);
  assert.doesNotMatch(pages, /from "\.\/lib\/public(?:Routes|Seo)\.js"/);

  assert.match(app, /Choose a Pokémon TCG Set/);
  assert.match(app, /Open virtual packs from every English-language Pokémon TCG set supported by PackDex/);
  assert.match(app, /getSetHref=\{isSetsRoute \? getCanonicalSetPath : null\}/);
  assert.match(selector, /href=\{setHref\}/);
  assert.match(selector, /className="set-card-primary-action"/);
  assert.match(layout, /\["Sets", "\/sets"\]/);
  assert.match(layout, /\["How It Works", "\/how-it-works"\]/);
  assert.match(layout, /\["FAQ", "\/faq"\]/);
  assert.match(layout, /\["About", "\/about"\]/);
  assert.match(layout, /PUBLIC_LINKS\.map\(\(\[label, href\]\) => <a key=\{href\} href=\{href\}>/);
});

test("every public set description and collector detail derives from the shared catalog", () => {
  assert.equal(activeSets.length, 129);

  for (const set of activeSets) {
    const content = getSetPublicContent(set);
    assert.ok(content.supportedCardCount > 0, set.id);
    assert.ok(content.simulation.packSize > 0, set.id);
    assert.ok(content.guide, `${set.id} is missing curated set context`);
    assert.match(content.summary, /\S/);
    assert.match(content.simulation.notes.at(-1), /do not state official pull rates/i);
    assert.doesNotMatch(content.simulation.notes.join(" "), /Premium pool|configured subset position|internal simulation rules|internal slot-selection logic/i);
    assert.deepEqual(getSetExploreDetails(set).guide, content.guide);
    assert.ok(getCanonicalSetPath(set), set.id);
  }

  assert.equal(getSetPublicContent(setById("151")).supportedCardCount, 207);
  assert.equal(getSetPublicContent(setById("151")).simulation.packSize, 10);
  assert.equal(getSetPublicContent(setById("detective-pikachu")).simulation.packSize, 4);
  assert.equal(getSetPublicContent(setById("base-set")).simulation.packSize, 11);
});

test("set runtime keeps ads outside interaction controls and mobile content uses a separate inline placement", async () => {
  const [app, setPage, collection] = await Promise.all([
    read("../src/App.jsx"),
    read("../src/public/PublicSetPage.jsx"),
    read("../src/components/CollectionPage.jsx"),
  ]);

  assert.match(app, /isPublicSetRoute/);
  assert.match(app, /const initialScreen = isPublicSetRoute[\s\S]*?\? "opening"/);
  assert.match(app, /<PackOpening[\s\S]*?<DeferredPublicSetPage/);
  assert.match(app, /const PublicSetPage = lazy\(loadPublicSetPage\)/);
  assert.match(app, /allowDesktopRailDuringInteraction: true/);
  assert.match(app, /placement=\{AD_PLACEMENTS\.SET_RAIL\}/);
  assert.match(app, /backLabel=\{isPublicSetRoute \? "Back to Pack Ready"/);
  assert.doesNotMatch(app, /<PublicHeader|<PublicFooter/);
  assert.match(setPage, /placement=\{AD_PLACEMENTS\.MOBILE_INLINE\}/);
  assert.match(setPage, /placement=\{AD_PLACEMENTS\.SET_INLINE\}/);
  assert.ok(setPage.indexOf("About {set.name}") < setPage.indexOf("AD_PLACEMENTS.MOBILE_INLINE"));
  assert.match(setPage, /getSetExploreDetails/);
  assert.match(setPage, /Featured Pokémon/);
  assert.doesNotMatch(setPage, /PackDex Simulation Notes|Rarities in PackDex|public-simulation-grid|public-rarity-list/);
  assert.match(collection, /embedded = false/);
  assert.match(collection, /onOverlayStateChange/);
});

test("public and utility metadata use the expected canonical and indexing policy", () => {
  const sets = getPublicSeoDescriptor("/sets");
  const set = getPublicSeoDescriptor("/set/pokemon-151");
  const missing = getPublicSeoDescriptor("/set/not-real");
  const login = getPublicSeoDescriptor("/login");

  assert.equal(sets.canonicalUrl, "https://www.pack-dex.com/sets");
  assert.equal(sets.robots, "index, follow");
  assert.equal(set.canonicalUrl, "https://www.pack-dex.com/set/pokemon-151");
  assert.match(set.title, /^151 Virtual Packs & Collection/);
  assert.match(set.description, /discover set highlights/);
  assert.doesNotMatch(set.description, /simulation notes/i);
  assert.equal(missing.robots, "noindex, follow");
  assert.equal(missing.canonicalUrl, null);
  assert.equal(login.robots, "noindex, follow");
  assert.equal(login.canonicalUrl, null);
});
