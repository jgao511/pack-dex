import { useEffect, useMemo, useRef, useState } from "react";
import FoilCard from "./FoilCard.jsx";
import { getCardBackUrl, getCardImageUrl } from "../utils/assetUrls.js";
import { preloadImage } from "../utils/imageCache.js";
import { isHigherThanRare, isSubsetCard } from "../utils/packGenerator.js";
import { getPackRevealSoundCue, playHitSound, preloadHitSounds } from "../utils/sounds.js";
import {
  beginPackImageDebug,
  markDealStart,
  markPreloadFinish,
  markPreloadStart,
  markVisualRevealSchedule,
} from "../utils/imageDebug.js";

const CARD_DEAL_STAGGER_MS = 180;
const GOD_PACK_CARD_DEAL_STAGGER_MS = 260;
const CARD_DEAL_ANIMATION_MS = 280;
const WAIT_AFTER_DEAL_MS = 500;

const CARD_FLIP_STAGGER_MS = 330;
const GOD_PACK_CARD_FLIP_STAGGER_MS = 420;
const LAST_CARD_EXTRA_DELAY_MS = 850;
const GOD_PACK_LAST_CARD_EXTRA_DELAY_MS = 1100;
const CARD_FLIP_ANIMATION_MS = 620;
const GOD_PACK_EXTRA_WAIT_AFTER_DEAL_MS = 1300;
const SUMMARY_AFTER_LAST_CARD_MS = 250;
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

function getCardDealDelay(index, isGodPack = false) {
  return index * (isGodPack ? GOD_PACK_CARD_DEAL_STAGGER_MS : CARD_DEAL_STAGGER_MS);
}

function getDealCompleteDelay(totalCards, isGodPack = false) {
  return Math.max(0, (totalCards - 1) * (isGodPack ? GOD_PACK_CARD_DEAL_STAGGER_MS : CARD_DEAL_STAGGER_MS)) + CARD_DEAL_ANIMATION_MS;
}

function getCardRevealDelay(index, totalCards, isGodPack = false) {
  const baseDelay = index * (isGodPack ? GOD_PACK_CARD_FLIP_STAGGER_MS : CARD_FLIP_STAGGER_MS);

  if (index === totalCards - 1) {
    return baseDelay + (isGodPack ? GOD_PACK_LAST_CARD_EXTRA_DELAY_MS : LAST_CARD_EXTRA_DELAY_MS);
  }

  return baseDelay;
}

function CardReveal({ cards, set, onCardsRevealed, onComplete, onBackToSets }) {
  const [isDealt, setIsDealt] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);

  const soundTimeoutsRef = useRef([]);
  const playedSoundKeysRef = useRef(new Set());
  const revealStartedRef = useRef(false);
  const autoRevealTimerRef = useRef(null);
  const autoCompleteTimerRef = useRef(null);
  const dealTimerRef = useRef(null);
  const imageDebugPackIdRef = useRef("");

  const packSoundId = getPackSoundId(cards);
  const isGodPack = Boolean(cards.isGodPack);
  const finalCard = cards.at(-1);
  const hasBigPull = Boolean(finalCard && isHigherThanRare(finalCard));
  const hasSubsetPull = cards.slice(0, -1).some((card) => isSubsetCard(card, set));
  const cardBack = getCardBackUrl();
  const imageDebugPackId = useMemo(() => beginPackImageDebug(cards, set), [cards, set]);

  imageDebugPackIdRef.current = imageDebugPackId;

  useEffect(() => {
    preloadHitSounds();

    return () => {
      clearRevealSoundTimers();

      if (autoRevealTimerRef.current) {
        window.clearTimeout(autoRevealTimerRef.current);
      }

      if (autoCompleteTimerRef.current) {
        window.clearTimeout(autoCompleteTimerRef.current);
      }

      if (dealTimerRef.current) {
        window.clearTimeout(dealTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!cards.length) return undefined;

    let isCancelled = false;
    setIsDealt(false);
    setIsRevealed(false);
    revealStartedRef.current = false;

    cards.forEach((card, index) => {
      const imageUrl = getCardImageUrl(card);

      preloadImage(imageUrl, {
        timeoutMs: 0,
        onStart: () => markPreloadStart(imageDebugPackId, index, imageUrl),
        onLoad: (detail) => markPreloadFinish(imageDebugPackId, index, imageUrl, true, detail),
        onError: (detail) => markPreloadFinish(imageDebugPackId, index, imageUrl, false, detail),
      });
    });

    dealTimerRef.current = window.setTimeout(() => {
      markDealStart(imageDebugPackId);
      setIsDealt(true);
    }, 30);

    const revealDelay =
      getDealCompleteDelay(cards.length, isGodPack) +
      WAIT_AFTER_DEAL_MS +
      (isGodPack ? GOD_PACK_EXTRA_WAIT_AFTER_DEAL_MS : 0);

    autoRevealTimerRef.current = window.setTimeout(() => {
      if (!isCancelled) {
        revealAll();
      }
    }, revealDelay);

    return () => {
      isCancelled = true;

      if (autoRevealTimerRef.current) {
        window.clearTimeout(autoRevealTimerRef.current);
      }

      if (autoCompleteTimerRef.current) {
        window.clearTimeout(autoCompleteTimerRef.current);
      }

      if (dealTimerRef.current) {
        window.clearTimeout(dealTimerRef.current);
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
    const revealStartedAt = performance.now();

    cards.forEach((card, index) => {
      markVisualRevealSchedule(
        imageDebugPackIdRef.current,
        index,
        revealStartedAt + getCardRevealDelay(index, cards.length, isGodPack)
      );
    });
    onCardsRevealed(cards);
    clearRevealSoundTimers();

    const soundCue = getPackRevealSoundCue(cards, set);

    if (soundCue) {
      const soundDelay = getCardRevealDelay(soundCue.index, cards.length, isGodPack) + SOUND_AFTER_FLIP_START_MS;

      soundTimeoutsRef.current = [
        window.setTimeout(() => {
          playRevealSoundCueOnce(soundCue);
          clearRevealSoundTimers();
        }, soundDelay),
      ];
    }

    const summaryDelay =
      getCardRevealDelay(cards.length - 1, cards.length, isGodPack) +
      CARD_FLIP_ANIMATION_MS +
      SUMMARY_AFTER_LAST_CARD_MS;

    autoCompleteTimerRef.current = window.setTimeout(() => {
      clearRevealSoundTimers();
      onComplete();
    }, summaryDelay);
  }

  if (!cards.length) return null;

  return (
    <section
      className={`reveal-screen ${isDealt ? "is-dealt" : ""} ${
        isRevealed && hasBigPull ? "has-big-pull" : ""
      } ${isRevealed && hasSubsetPull ? "has-subset-pull" : ""} ${
        isGodPack ? "is-god-pack" : ""
      }`}
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
      </div>

      <div className="reveal-grid">
        {cards.map((card, index) => (
          <article
            className={`grid-card-flip ${isRevealed ? "is-revealed" : ""} ${
              isRevealed && index === cards.length - 1 && hasBigPull ? "big-pull-card" : ""
            } ${isRevealed && index !== cards.length - 1 && isSubsetCard(card, set) ? "subset-pull-card" : ""}`}
            key={`${card.id}-${index}`}
            style={{
              "--deal-delay": `${getCardDealDelay(index, isGodPack)}ms`,
              "--delay": `${getCardRevealDelay(index, cards.length, isGodPack)}ms`,
            }}
          >
            <div className="grid-card-inner">
              <div className="grid-card-face grid-card-back">
                <img src={cardBack} alt="" decoding="async" fetchPriority="high" />
              </div>

              <div className="grid-card-face grid-card-front">
                <FoilCard
                  card={card}
                  set={set}
                  interactive
                  useCardBackPlaceholder={false}
                  imageDebugMeta={{ packId: imageDebugPackIdRef.current, slot: index }}
                />
              </div>
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
        ) : null}
      </div>
    </section>
  );
}

export default CardReveal;
