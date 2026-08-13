import { useEffect, useRef, useState } from "react";
import { getSwipeReleaseAction, getSwipeTransform } from "../../lib/revealStyle.js";
import "./SwipeRevealSurface.css";

function joinClasses(...classes) {
  return classes.filter(Boolean).join(" ");
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() => (
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ));

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return undefined;
    const update = () => setReducedMotion(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return reducedMotion;
}

/**
 * Shared, persistence-agnostic swipe surface used by both PackDex web shells.
 * Pack generation, reveal-cycle state, and completion remain owned by the caller.
 */
function SwipeRevealSurface({
  cards,
  activeIndex,
  isAnimating = false,
  onDismiss,
  renderCard,
  getCardClassName,
  className = "",
  progressClassName = "",
  instructionClassName = "",
  stageClassName = "",
  underCardClassName = "",
  primaryCardClassName = "",
  cardFaceClassName = "",
}) {
  const reducedMotion = usePrefersReducedMotion();
  const pointerRef = useRef(null);
  const exitTimerRef = useRef(null);
  const repositionFrameRef = useRef(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isRepositioning, setIsRepositioning] = useState(false);
  const [exitDirection, setExitDirection] = useState("");
  const card = cards[activeIndex];
  const nextCard = cards[activeIndex + 1];

  useEffect(() => {
    pointerRef.current = null;
    setDrag({ x: 0, y: 0 });
    setIsDragging(false);
    setExitDirection("");
  }, [activeIndex]);

  useEffect(() => () => {
    window.clearTimeout(exitTimerRef.current);
    window.cancelAnimationFrame(repositionFrameRef.current);
    pointerRef.current = null;
  }, []);

  useEffect(() => {
    if (!isRepositioning) return undefined;
    repositionFrameRef.current = window.requestAnimationFrame(() => setIsRepositioning(false));
    return () => window.cancelAnimationFrame(repositionFrameRef.current);
  }, [activeIndex, isRepositioning]);

  if (!card) return null;

  const isFinal = activeIndex === cards.length - 1;
  const exitTransform = exitDirection === "left"
    ? "translate3d(-135vw, -4vh, 0) rotateZ(-18deg)"
    : exitDirection === "up"
      ? "translate3d(0, -125vh, 0) rotateZ(4deg)"
      : "translate3d(135vw, -4vh, 0) rotateZ(18deg)";
  const transform = exitDirection
    ? exitTransform
    : getSwipeTransform({ deltaX: drag.x, deltaY: drag.y, reducedMotion });

  function resetCard() {
    pointerRef.current = null;
    setIsDragging(false);
    setDrag({ x: 0, y: 0 });
  }

  function requestDismiss(direction = "right") {
    if (isAnimating || exitDirection) return;
    setIsDragging(false);
    setExitDirection(direction);
    exitTimerRef.current = window.setTimeout(() => {
      setIsRepositioning(true);
      setExitDirection("");
      setDrag({ x: 0, y: 0 });
      onDismiss?.(activeIndex);
    }, reducedMotion ? 20 : 260);
  }

  function handlePointerDown(event) {
    if (isAnimating || exitDirection || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointerRef.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
    };
    setIsDragging(true);
  }

  function handlePointerMove(event) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    event.preventDefault();
    setDrag({
      x: event.clientX - pointer.startX,
      y: Math.max(-220, Math.min(70, event.clientY - pointer.startY)),
    });
  }

  function finishPointer(event, cancelled = false) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    event.preventDefault();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const deltaX = event.clientX - pointer.startX;
    const deltaY = Math.max(-220, Math.min(70, event.clientY - pointer.startY));
    const elapsedMs = performance.now() - pointer.startedAt;
    pointerRef.current = null;
    setIsDragging(false);

    if (cancelled) {
      setDrag({ x: 0, y: 0 });
      return;
    }

    const decision = getSwipeReleaseAction({ deltaX, deltaY, elapsedMs });
    if (decision.action === "dismiss") {
      setDrag({ x: deltaX, y: deltaY });
      requestDismiss(decision.direction);
    } else {
      resetCard();
    }
  }

  return (
    <section className={joinClasses("packdex-swipe-reveal", className)} aria-live="polite">
      <p className={joinClasses("packdex-swipe-reveal__progress", progressClassName)} role="status">
        {activeIndex + 1} / {cards.length}
      </p>
      <div className={joinClasses("packdex-swipe-reveal__stage", stageClassName)}>
        {nextCard && (
          <span
            className={joinClasses(
              "packdex-swipe-reveal__under-card",
              underCardClassName,
              getCardClassName?.(nextCard, activeIndex + 1)
            )}
            aria-hidden="true"
          >
            <span className={joinClasses("packdex-swipe-reveal__card-face", cardFaceClassName)}>
              {renderCard(nextCard, activeIndex + 1, { isCurrent: false, isFinal: activeIndex + 1 === cards.length - 1 })}
            </span>
          </span>
        )}
        <button
          className={joinClasses(
            "packdex-swipe-reveal__primary-card",
            primaryCardClassName,
            getCardClassName?.(card, activeIndex),
            isFinal && "is-final",
            isDragging && "is-dragging",
            isRepositioning && "is-repositioning",
            exitDirection && "is-exiting"
          )}
          type="button"
          aria-label={`Card ${activeIndex + 1} of ${cards.length}. Swipe left, right, or up${isFinal ? " to finish the pack" : " to reveal the next card"}.`}
          style={{
            transform,
            "--foil-shift-x": `${50 + Math.max(-35, Math.min(35, drag.x / 5))}%`,
            "--foil-shift-y": `${50 + Math.max(-30, Math.min(30, drag.y / 5))}%`,
          }}
          onClick={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (!["Enter", " "].includes(event.key)) return;
            event.preventDefault();
            requestDismiss("right");
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishPointer(event)}
          onPointerCancel={(event) => finishPointer(event, true)}
          onLostPointerCapture={(event) => {
            if (pointerRef.current?.id === event.pointerId) finishPointer(event, true);
          }}
        >
          <span className={joinClasses("packdex-swipe-reveal__card-face", cardFaceClassName)}>
            {renderCard(card, activeIndex, { isCurrent: true, isFinal })}
          </span>
        </button>
      </div>
      <p className={joinClasses("packdex-swipe-reveal__instruction", instructionClassName)}>
        {isFinal ? "Swipe the final card to finish" : "Swipe the card to reveal the next card"}
      </p>
    </section>
  );
}

export default SwipeRevealSurface;
