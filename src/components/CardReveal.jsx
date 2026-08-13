import { useEffect, useMemo, useRef, useState } from "react";
import FoilCard from "./FoilCard.jsx";
import SwipeRevealSurface from "./reveal/SwipeRevealSurface.jsx";
import "./reveal/CanonicalPhoneReveal.css";
import { getCardBackUrl, getCardImageUrl } from "../utils/assetUrls.js";
import { preloadImage } from "../utils/imageCache.js";
import { isHigherThanRare, isSubsetCard } from "../utils/packGenerator.js";
import {
  claimTapRevealInput,
  normalizeRevealStyle,
  revealCardAtIndex,
} from "../lib/revealStyle.js";
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

function CardReveal({
  cards,
  set,
  onCardsRevealed,
  onComplete,
  onBackToSets,
  backLabel = "Back to Sets",
  revealStyle = "automatic",
  interactionSurface = "desktop",
}) {
  const [isDealt, setIsDealt] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const [revealedCardIndexes, setRevealedCardIndexes] = useState(() => new Set());
  const [swipeActiveIndex, setSwipeActiveIndex] = useState(0);
  const [isInteractiveCompletionPending, setIsInteractiveCompletionPending] = useState(false);

  const revealStartedRef = useRef(false);
  const completionScheduledRef = useRef(false);
  const completionClaimedRef = useRef(false);
  const revealedCardIndexesRef = useRef(new Set());
  const swipeActiveIndexRef = useRef(0);
  const lastTapRevealTimestampRef = useRef(Number.NEGATIVE_INFINITY);
  const autoRevealTimerRef = useRef(null);
  const autoCompleteTimerRef = useRef(null);
  const dealTimerRef = useRef(null);
  const imageDebugPackIdRef = useRef("");

  const isGodPack = Boolean(cards.isGodPack);
  const finalCard = cards.at(-1);
  const hasBigPull = Boolean(finalCard && isHigherThanRare(finalCard));
  const hasSubsetPull = cards.slice(0, -1).some((card) => isSubsetCard(card, set));
  const cardBack = getCardBackUrl();
  const imageDebugPackId = useMemo(() => beginPackImageDebug(cards, set), [cards, set]);
  const activeRevealStyle = interactionSurface === "phone" ? normalizeRevealStyle(revealStyle) : "automatic";
  const isTapReveal = activeRevealStyle === "tap";
  const isSwipeReveal = activeRevealStyle === "swipe";

  imageDebugPackIdRef.current = imageDebugPackId;

  function clearTimers() {
    window.clearTimeout(autoRevealTimerRef.current);
    window.clearTimeout(autoCompleteTimerRef.current);
    window.clearTimeout(dealTimerRef.current);
    autoRevealTimerRef.current = null;
    autoCompleteTimerRef.current = null;
    dealTimerRef.current = null;
  }

  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    if (!cards.length) return undefined;

    let isCancelled = false;
    clearTimers();
    setIsDealt(false);
    setIsRevealed(false);
    setRevealedCardIndexes(new Set());
    setSwipeActiveIndex(0);
    setIsInteractiveCompletionPending(false);
    revealStartedRef.current = false;
    completionScheduledRef.current = false;
    completionClaimedRef.current = false;
    revealedCardIndexesRef.current = new Set();
    swipeActiveIndexRef.current = 0;
    lastTapRevealTimestampRef.current = Number.NEGATIVE_INFINITY;

    const revealDelay =
      getDealCompleteDelay(cards.length, isGodPack) +
      WAIT_AFTER_DEAL_MS +
      (isGodPack ? GOD_PACK_EXTRA_WAIT_AFTER_DEAL_MS : 0);

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
      if (isCancelled) return;
      markDealStart(imageDebugPackId);
      setIsDealt(true);
    }, 30);

    if (activeRevealStyle === "automatic") {
      autoRevealTimerRef.current = window.setTimeout(() => {
        if (!isCancelled) revealAll();
      }, revealDelay);
    }

    return () => {
      isCancelled = true;
      clearTimers();
    };
  }, [activeRevealStyle, cards]);

  function finishReveal(delay = 0) {
    if (completionScheduledRef.current || completionClaimedRef.current) return false;
    completionScheduledRef.current = true;
    setIsInteractiveCompletionPending(true);
    autoCompleteTimerRef.current = window.setTimeout(() => {
      if (completionClaimedRef.current) return;
      completionClaimedRef.current = true;
      onCardsRevealed(cards);
      onComplete();
    }, delay);
    return true;
  }

  function revealAll() {
    if (isRevealed || revealStartedRef.current || activeRevealStyle !== "automatic") return;

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
    const summaryDelay =
      getCardRevealDelay(cards.length - 1, cards.length, isGodPack) +
      CARD_FLIP_ANIMATION_MS +
      SUMMARY_AFTER_LAST_CARD_MS;

    finishReveal(summaryDelay);
  }

  function revealTappedCard(index, inputTimestamp = performance.now()) {
    if (!isTapReveal || !isDealt || isInteractiveCompletionPending || completionScheduledRef.current) return false;
    if (revealedCardIndexesRef.current.has(index)) return false;

    const inputClaim = claimTapRevealInput(lastTapRevealTimestampRef.current, inputTimestamp);
    if (!inputClaim.accepted) return false;
    lastTapRevealTimestampRef.current = inputClaim.timestamp;

    const result = revealCardAtIndex(revealedCardIndexesRef.current, index, cards.length);
    if (!result.changed) return false;
    revealedCardIndexesRef.current = result.revealedIndexes;
    setRevealedCardIndexes(result.revealedIndexes);

    if (result.isComplete) {
      const animationDuration = CARD_FLIP_ANIMATION_MS + (index === cards.length - 1 ? 140 : 0);
      finishReveal(animationDuration + SUMMARY_AFTER_LAST_CARD_MS);
    }
    return true;
  }

  function dismissSwipeCard(index) {
    if (
      !isSwipeReveal ||
      !isDealt ||
      completionScheduledRef.current ||
      index !== swipeActiveIndexRef.current
    ) return false;

    if (index === cards.length - 1) {
      finishReveal(0);
      return true;
    }

    const nextIndex = index + 1;
    swipeActiveIndexRef.current = nextIndex;
    setSwipeActiveIndex(nextIndex);
    return true;
  }

  if (!cards.length) return null;

  return (
    <section
      className={`reveal-screen reveal-mode-${activeRevealStyle} ${interactionSurface === "phone" ? "uses-phone-interaction" : ""} ${isDealt ? "is-dealt" : ""} ${
        isRevealed && hasBigPull ? "has-big-pull" : ""
      } ${isRevealed && hasSubsetPull ? "has-subset-pull" : ""} ${
        isGodPack ? "is-god-pack" : ""
      }`}
      data-reveal-style={activeRevealStyle}
      data-interaction-surface={interactionSurface}
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
        {isTapReveal && <p className="canonical-phone-reveal-instruction">Tap each card to reveal it</p>}
      </div>

      {isSwipeReveal ? (
        <SwipeRevealSurface
          cards={cards}
          activeIndex={swipeActiveIndex}
          isAnimating={!isDealt || isInteractiveCompletionPending}
          onDismiss={dismissSwipeCard}
          className="canonical-phone-swipe-reveal"
          progressClassName="canonical-phone-swipe-reveal__progress"
          instructionClassName="canonical-phone-swipe-reveal__instruction"
          stageClassName="canonical-phone-swipe-reveal__stage"
          underCardClassName="canonical-phone-swipe-reveal__under-card"
          primaryCardClassName="canonical-phone-swipe-reveal__primary-card"
          cardFaceClassName="canonical-phone-swipe-reveal__card-face"
          renderCard={(card, index) => (
            <FoilCard
              card={card}
              set={set}
              interactive={false}
              useCardBackPlaceholder={false}
              imageDebugMeta={{ packId: imageDebugPackIdRef.current, slot: index }}
            />
          )}
        />
      ) : (
        <div className="reveal-grid">
          {cards.map((card, index) => {
            const isCardRevealed = activeRevealStyle === "automatic"
              ? isRevealed
              : revealedCardIndexes.has(index);
            return (
              <button
                className={`grid-card-flip ${isCardRevealed ? "is-revealed" : ""} ${
                  isCardRevealed && index === cards.length - 1 && hasBigPull ? "big-pull-card" : ""
                } ${isCardRevealed && index !== cards.length - 1 && isSubsetCard(card, set) ? "subset-pull-card" : ""}`}
                type="button"
                key={`${card.id || card.number || card.name}-${index}`}
                style={{
                  "--deal-delay": `${getCardDealDelay(index, isGodPack)}ms`,
                  "--delay": activeRevealStyle === "automatic"
                    ? `${getCardRevealDelay(index, cards.length, isGodPack)}ms`
                    : "0ms",
                }}
                aria-label={isTapReveal && !isCardRevealed ? `Reveal card ${index + 1} of ${cards.length}` : undefined}
                disabled={!isTapReveal || !isDealt || isCardRevealed || isInteractiveCompletionPending}
                onClick={(event) => revealTappedCard(index, event.timeStamp)}
              >
                <span className="grid-card-inner">
                  <span className="grid-card-face grid-card-back">
                    <img src={cardBack} alt="" decoding="async" fetchPriority="high" />
                  </span>

                  <span className="grid-card-face grid-card-front">
                    <FoilCard
                      card={card}
                      set={set}
                      interactive
                      useCardBackPlaceholder={false}
                      imageDebugMeta={{ packId: imageDebugPackIdRef.current, slot: index }}
                    />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="reveal-actions">
        {!isRevealed && !completionScheduledRef.current ? (
          <>
            <button className="secondary-button" onClick={onBackToSets}>
              {backLabel}
            </button>

            <button className="primary-button" disabled>
              {activeRevealStyle === "automatic" ? "Revealing..." : isSwipeReveal ? "Swipe to reveal" : "Tap to reveal"}
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}

export default CardReveal;
