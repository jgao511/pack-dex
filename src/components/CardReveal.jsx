import { useEffect, useRef, useState } from "react";
import { Eye, Rows3 } from "lucide-react";
import FoilCard from "./FoilCard.jsx";
import { getCardBackUrl, getCardImageUrl } from "../utils/assetUrls.js";
import { isHigherThanRare, isSubsetCard } from "../utils/packGenerator.js";
import { getPackRevealSoundCue, playHitSound, preloadHitSounds } from "../utils/sounds.js";

const packSoundIds = new WeakMap();
const playedRevealSoundKeys = new Set();
const playedPackSoundKeys = new Set();
let packSoundCounter = 0;

function getPackSoundId(cards) {
  if (!packSoundIds.has(cards)) {
    packSoundCounter += 1;
    packSoundIds.set(cards, `pack-${Date.now()}-${packSoundCounter}`);
  }

  return packSoundIds.get(cards);
}

function preloadImages(urls) {
  return Promise.all(
    urls.map(
      (url) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = resolve;
          img.onerror = resolve;
          img.src = url;
        })
    )
  );
}

function CardReveal({ cards, set, onCardsRevealed, onComplete, onBackToSets }) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [isPreloading, setIsPreloading] = useState(false);
  const soundTimeoutsRef = useRef([]);
  const playedSoundKeysRef = useRef(new Set());
  const revealStartedRef = useRef(false);
  const packSoundId = getPackSoundId(cards);
  const isGodPack = Boolean(cards.isGodPack);
  const finalCard = cards.at(-1);
  const hasBigPull = Boolean(finalCard && isHigherThanRare(finalCard));
  const hasSubsetPull = cards.slice(0, -1).some((card) => isSubsetCard(card, set));
  const cardBack = getCardBackUrl();

  useEffect(() => {
    preloadHitSounds();

    return () => {
      soundTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      soundTimeoutsRef.current = [];
    };
  }, []);

  function clearRevealSoundTimers() {
    soundTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    soundTimeoutsRef.current = [];
  }

  function playRevealSoundCueOnce(cue) {
    if (!cue) return;

    const soundKey = `${packSoundId}-pack-reveal-sound`;

    if (
      playedSoundKeysRef.current.has(soundKey) ||
      playedRevealSoundKeys.has(soundKey) ||
      playedPackSoundKeys.has(packSoundId)
    ) {
      return;
    }

    playedSoundKeysRef.current.add(soundKey);
    playedRevealSoundKeys.add(soundKey);
    playedPackSoundKeys.add(packSoundId);
    playHitSound(cue.soundType);
  }

 async function revealAll() {
  if (isRevealed || isPreloading || revealStartedRef.current) return;

  revealStartedRef.current = true;
  setIsPreloading(true);

  const imageUrls = cards.map((card) => getCardImageUrl(card));
  await preloadImages(imageUrls);

  setIsPreloading(false);
  setIsRevealed(true);
  onCardsRevealed(cards);
  clearRevealSoundTimers();

  const soundCue = getPackRevealSoundCue(cards, set);
  if (soundCue) {
    soundTimeoutsRef.current = [
      window.setTimeout(() => {
        playRevealSoundCueOnce(soundCue);
        clearRevealSoundTimers();
      }, soundCue.index * 80 + 120),
    ];
  }
}

  function completeReveal() {
    clearRevealSoundTimers();
    onComplete();
  }

  if (!cards.length) return null;

  return (
    <section
      className={`reveal-screen ${isRevealed && hasBigPull ? "has-big-pull" : ""} ${
        isRevealed && hasSubsetPull ? "has-subset-pull" : ""
      }`}
    >
      <div className="reveal-heading">
        <span className="reveal-status">
          {set.name} - {cards.length} cards ready
        </span>
        {isRevealed && isGodPack && <span className="god-pack-badge">{cards.godPackDisplayName || "God Pack"}!</span>}
        <h1 className="brand-title">Reveal Your Pack</h1>
        <p>
          {isRevealed
            ? "All pulls are revealed."
            : "Click the grid or Reveal All to flip the full pack."}
        </p>
      </div>

   <button
  className="reveal-grid-button"
  onClick={revealAll}
  disabled={isRevealed || isPreloading}
  aria-label="Reveal all cards"
>
  {isPreloading ? "Loading Cards..." : "Reveal All"}
</button>
        <div className="reveal-grid">
          {cards.map((card, index) => (
            <article
              className={`grid-card-flip ${isRevealed ? "is-revealed" : ""} ${
                isRevealed && index === cards.length - 1 && hasBigPull ? "big-pull-card" : ""
              } ${
                isRevealed && index !== cards.length - 1 && isSubsetCard(card, set)
                  ? "subset-pull-card"
                  : ""
              }`}
              key={`${card.id}-${index}`}
              style={{ "--delay": `${index * 80}ms` }}
            >
              <div className="grid-card-face grid-card-back">
                <img src={cardBack} alt="" />
              </div>
              <div className="grid-card-face grid-card-front">
                <FoilCard card={card} set={set} interactive />
              </div>
            </article>
          ))}
        </div>
      </button>

      <div className="reveal-actions">
        {!isRevealed ? (
          <>
            <button className="secondary-button" onClick={onBackToSets}>
              Back to Sets
            </button>
            <button className="primary-button" onClick={revealAll}>
              <Eye size={20} aria-hidden="true" />
              Reveal All
            </button>
          </>
        ) : (
          <>
            <button className="secondary-button" onClick={onBackToSets}>
              Back to Sets
            </button>
            <button className="primary-button" onClick={completeReveal}>
              <Rows3 size={20} aria-hidden="true" />
              View Summary
            </button>
          </>
        )}
      </div>
    </section>
  );
}

export default CardReveal;
