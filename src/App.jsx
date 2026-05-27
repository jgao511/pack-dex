import { useRef, useState } from "react";
import PackOpening from "./components/PackOpening.jsx";
import CardReveal from "./components/CardReveal.jsx";
import CollectionPage from "./components/CollectionPage.jsx";
import PullSummary from "./components/PullSummary.jsx";
import SetSelect from "./components/SetSelect.jsx";
import { sets } from "./data/sets.js";
import { canGeneratePack, generatePack } from "./utils/packGenerator.js";
import { loadCollection, markCardsCollected, saveCollection } from "./utils/collectionStorage.js";
import { getPokeballLoadingUrl } from "./utils/assetUrls.js";

const MIN_RETURN_LOADING_MS = 450;
const RETURN_LOADING_RENDER_DELAY_MS = 100;
const POKEBALL_LOADING_SRC = getPokeballLoadingUrl();

function LoadingOverlay() {
  return (
    <div className="loading-overlay" role="status" aria-live="polite" aria-label="Returning to set">
      <img className="loading-pokeball" src={POKEBALL_LOADING_SRC} alt="" />
      <div className="loading-text">Returning to set...</div>
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState("home");
  const [selectedSet, setSelectedSet] = useState(null);
  const [pulledCards, setPulledCards] = useState([]);
  const [collection, setCollection] = useState(() => loadCollection());
  const [isReturningToSet, setIsReturningToSet] = useState(false);
  const returnTokenRef = useRef(0);

  function startPackOpening(set = selectedSet) {
    if (!set || !canGeneratePack(set)) return;

    setIsReturningToSet(false);
    setSelectedSet(set);
    setPulledCards([]);
    setScreen("opening");
  }

  function revealPack() {
    if (!selectedSet) return;

    setPulledCards(generatePack(selectedSet));
    setScreen("reveal");
  }

  function viewCollection(set = selectedSet) {
    if (!set) return;

    setSelectedSet(set);
    setScreen("collection");
  }

  function handleCardsRevealed(cards) {
    if (!selectedSet || !cards.length) return;

    const currentCollection = loadCollection();
    const nextCollection = markCardsCollected(currentCollection, cards, selectedSet.id);

    saveCollection(nextCollection);
    setCollection(nextCollection);
  }

  function backToSets() {
    const token = returnTokenRef.current + 1;
    const start = performance.now();

    returnTokenRef.current = token;
    setIsReturningToSet(true);

    window.setTimeout(() => {
      if (returnTokenRef.current !== token) return;

      setPulledCards([]);
      setSelectedSet(null);
      setScreen("home");

      const elapsed = performance.now() - start;
      const remaining = Math.max(0, MIN_RETURN_LOADING_MS - elapsed);

      window.setTimeout(() => {
        if (returnTokenRef.current === token) {
          setIsReturningToSet(false);
        }
      }, remaining);
    }, RETURN_LOADING_RENDER_DELAY_MS);
  }

  return (
    <main className="app-shell">
      {screen === "home" && (
        <SetSelect sets={sets} collection={collection} onSelectSet={startPackOpening} onViewCollection={viewCollection} />
      )}

      {screen === "opening" && selectedSet && (
        <PackOpening
          set={selectedSet}
          onOpened={revealPack}
          onBackToSets={backToSets}
          onViewCollection={viewCollection}
        />
      )}

      {screen === "reveal" && selectedSet && (
        <CardReveal
          cards={pulledCards}
          set={selectedSet}
          onCardsRevealed={handleCardsRevealed}
          onComplete={() => setScreen("summary")}
          onBackToSets={backToSets}
        />
      )}

      {screen === "summary" && selectedSet && (
        <PullSummary
          cards={pulledCards}
          set={selectedSet}
          collection={collection}
          onOpenAnother={() => startPackOpening(selectedSet)}
          onBackToSets={backToSets}
          onViewCollection={viewCollection}
        />
      )}

      {screen === "collection" && selectedSet && (
        <CollectionPage
          set={selectedSet}
          collection={collection}
          onOpenPacks={startPackOpening}
          onBackToSets={backToSets}
        />
      )}

      {isReturningToSet && <LoadingOverlay />}
    </main>
  );
}

export default App;
