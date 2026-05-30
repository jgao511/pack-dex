import { useEffect, useRef, useState } from "react";
import { Rows3 } from "lucide-react";
import FoilCard from "./FoilCard.jsx";
import { getCardBackUrl, getCardImageUrl } from "../utils/assetUrls.js";
import { isHigherThanRare, isSubsetCard } from "../utils/packGenerator.js";
import {
  getPackRevealSoundCue,
  playHitSound,
  preloadHitSounds,
} from "../utils/sounds.js";

const AUTO_REVEAL_DELAY_MS = 650;
const CARD_FLIP_STAGGER_MS = 220;
const LAST_CARD_EXTRA_DELAY_MS = 650;
const SOUND_AFTER_FLIP_START_MS = 120;

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
  return Promise.allSettled(
    urls.map(
      (url) =>
        new Promise((resolve) => {
          if (!url) {
            resolve();
            return;
          }

          const img = new Image();

          img.onload = resolve;
          img.onerror = resolve;
          img.src = url;
        })
    )
  );
}

function getCardRevealDelay(index, totalCards) {
  const baseDelay = index * CARD_FLIP_STAGGER_MS;

  if (index === totalCards - 1) {
    return baseDelay + LAST_CARD_EXTRA_DELAY_MS;
  }

  return baseDelay;
}

function CardReveal({ cards, set, onCardsRevealed, onComplete, onBackToSets }) {
  const [isRevealed, setIsRevealed] = useState(false);

  const soundTimeoutsRef = useRef([]);
  const playedSoundKeysRef = useRef(new Set());
  const revealStartedRef = useRef(false);
  const autoRevealTimerRef = useRef(null);

  const packSoundId = getPackSoundId(cards);
  const isGodPack = Boolean(cards.isGodPack);
  const finalCard = cards.at(-1);
  const hasBigPull = Boolean(finalCard && isHigherThanRare(finalCard));
  const hasSubsetPull = cards
    .slice(0, -1)
    .some((card) => isSubsetCard(card, set));
  const cardBack = getCardBackUrl();

  useEffect(() => {
    preloadHitSounds();

    return () => {
      clearRevealSoundTimers();

      if (autoRevealTimerRef.current) {
        window.clearTimeout(autoRevealTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!cards.length) return undefined;

    setIsRevealed(false);
    revealStartedRef.current = false;

    const imageUrls = cards.map((card) => getCardImageUrl(card));

    // Preload card fronts while backs are showing.
    preloadImages(imageUrls);

    // After 0.65 seconds, start the slower staggered reveal.
    autoRevealTimerRef.current = window.setTimeout(() => {
      revealAll();
    }, AUTO_REVEAL_DELAY_MS);

    return () => {
      if (autoRevealTimerRef.current) {
        window.clearTimeout(autoRevealTimerRef.current);
      }
    };
  }, [cards]);

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

  function revealAll() {
    if (isRevealed || revealStartedRef.current) return;

    revealStartedRef.current = true;
    setIsRevealed(true);
    onCardsRevealed(cards);
    clearRevealSoundTimers();

    const soundCue = getPackRevealSoundCue(cards, set);

    if (soundCue) {
      const soundDelay =
        getCardRevealDelay(soundCue.index, cards.length) + SOUND_AFTER_FLIP_START_MS;

      soundTimeoutsRef.current = [
        window.setTimeout(() => {
          playRevealSoundCueOnce(soundCue);
          clearRevealSoundTimers();
        }, soundDelay),
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
      className={`reveal-screen ${
        isRevealed && hasBigPull ? "has-big-pull" : ""
      } ${isRevealed && hasSubsetPull ? "has-subset-pull" : ""}`}
    >
      <div className="reveal-heading">
        <span className="reveal-status">
          {set.name} - {cards.length} cards ready
        </span>

        {isRevealed && isGodPack && (
          <span className="god-pack-badge">
            {cards.godPackDisplayName || "God Pack"}!
          </span>
        )}

        <h1 className="brand-title">Reveal Your Pack</h1>

        <p>{isRevealed ? "All pulls are revealed." : "Loading card fronts..."}</p>
      </div>

      <div className="reveal-grid">
        {cards.map((card, index) => (
          <article
            className={`grid-card-flip ${isRevealed ? "is-revealed" : ""} ${
              isRevealed && index === cards.length - 1 && hasBigPull
                ? "big-pull-card"
                : ""
            } ${
              isRevealed && index !== cards.length - 1 && isSubsetCard(card, set)
                ? "subset-pull-card"
                : ""
            }`}
            key={`${card.id}-${index}`}
            style={{
              "--delay": `${getCardRevealDelay(index, cards.length)}ms`,
            }}
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

      <div className="reveal-actions">
        {!isRevealed ? (
          <>
            <button className="secondary-button" onClick={onBackToSets}>
              Back to Sets
            </button>

            <button className="primary-button" disabled>
              Revealing...
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
