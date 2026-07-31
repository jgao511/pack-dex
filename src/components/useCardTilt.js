import { useCallback, useEffect, useRef } from "react";

const NEUTRAL_TILT = {
  rx: 0,
  ry: 0,
  tx: 0,
  ty: 0,
  scale: 1,
  tilt: 0,
  foilAngle: 115,
  foilShiftX: 50,
  foilShiftY: 50,
  rainbowOpacity: 0.32,
  shineOpacity: 0.28,
  inspectionGlowAngle: 115,
  inspectionGlowOpacity: 0,
};

const INTENSITY = {
  normal: {
    ease: 0.18,
    rotateX: -8,
    rotateY: 10,
    translate: 5,
    scale: 1.04,
  },
  large: {
    ease: 0.14,
    rotateX: -8,
    rotateY: 10,
    translate: 5,
    scale: 1.04,
  },
};

function writeTiltVars(element, values) {
  element.style.setProperty("--rx", `${values.rx.toFixed(2)}deg`);
  element.style.setProperty("--ry", `${values.ry.toFixed(2)}deg`);
  element.style.setProperty("--tx", `${values.tx.toFixed(2)}px`);
  element.style.setProperty("--ty", `${values.ty.toFixed(2)}px`);
  element.style.setProperty("--scale", values.scale.toFixed(3));
  element.style.setProperty("--tilt-strength", values.tilt.toFixed(3));
  element.style.setProperty("--foil-angle", `${values.foilAngle.toFixed(2)}deg`);
  element.style.setProperty("--foil-shift-x", `${values.foilShiftX.toFixed(2)}%`);
  element.style.setProperty("--foil-shift-y", `${values.foilShiftY.toFixed(2)}%`);
  element.style.setProperty("--rainbow-opacity", values.rainbowOpacity.toFixed(3));
  element.style.setProperty("--shine-opacity", values.shineOpacity.toFixed(3));
  element.style.setProperty("--inspection-glow-angle", `${values.inspectionGlowAngle.toFixed(2)}deg`);
  element.style.setProperty("--inspection-glow-proximity", values.tilt.toFixed(3));
  element.style.setProperty("--inspection-glow-opacity", values.inspectionGlowOpacity.toFixed(3));
}

function setNeutral(target) {
  target.current = { ...NEUTRAL_TILT };
}

function calculateTilt(event, element, motion) {
  const rect = element.getBoundingClientRect();
  const nx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
  const ny = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  const tilt = Math.min(1, Math.hypot(nx, ny));

  return {
    rx: ny * motion.rotateX,
    ry: nx * motion.rotateY,
    tx: nx * motion.translate,
    ty: ny * motion.translate,
    scale: motion.scale,
    tilt,
    foilAngle: 115 + nx * 24 - ny * 12,
    foilShiftX: 50 + nx * 18,
    foilShiftY: 50 + ny * 12,
    rainbowOpacity: 0.24 + tilt * 0.2,
    shineOpacity: 0.18 + tilt * 0.18,
    inspectionGlowAngle: 115 + nx * 90 - ny * 45,
    inspectionGlowOpacity: 0.48 + tilt * 0.42,
  };
}

export function useCardTilt({ enabled = true, intensity = "normal" } = {}) {
  const ref = useRef(null);
  const frameRef = useRef(0);
  const activePointerIdRef = useRef(null);
  const reducedMotionRef = useRef(false);
  const currentRef = useRef({ ...NEUTRAL_TILT });
  const targetRef = useRef({ ...NEUTRAL_TILT });
  const motion = INTENSITY[intensity] || INTENSITY.normal;

  const startAnimation = useCallback(() => {
    if (!enabled || frameRef.current || reducedMotionRef.current) return;

    function animate() {
      const element = ref.current;
      const current = currentRef.current;
      const target = targetRef.current;
      let isMoving = false;

      for (const key of Object.keys(current)) {
        const difference = target[key] - current[key];
        if (Math.abs(difference) > 0.002) {
          current[key] += difference * motion.ease;
          isMoving = true;
        } else {
          current[key] = target[key];
        }
      }

      if (element) writeTiltVars(element, current);

      if (isMoving && ref.current) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        frameRef.current = 0;
      }
    }

    frameRef.current = requestAnimationFrame(animate);
  }, [enabled, motion.ease]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      reducedMotionRef.current = Boolean(media?.matches);
      if (media?.matches) {
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
        setNeutral(targetRef);
        currentRef.current = { ...NEUTRAL_TILT };
        if (ref.current) writeTiltVars(ref.current, NEUTRAL_TILT);
      }
    };

    updatePreference();
    media?.addEventListener?.("change", updatePreference);
    return () => media?.removeEventListener?.("change", updatePreference);
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      setNeutral(targetRef);
      currentRef.current = { ...NEUTRAL_TILT };
      if (ref.current) writeTiltVars(ref.current, NEUTRAL_TILT);
      return undefined;
    }

    if (ref.current) writeTiltVars(ref.current, currentRef.current);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;

    function handleDocumentPointerMove(event) {
      if (event.pointerType !== "mouse") return;

      const element = ref.current;

      if (!element) return;

      const rect = element.getBoundingClientRect();
      const isInside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (!isInside) {
        setNeutral(targetRef);
        startAnimation();
      }
    }

    window.addEventListener("pointermove", handleDocumentPointerMove, { passive: true });

    return () => {
      window.removeEventListener("pointermove", handleDocumentPointerMove);
    };
  }, [enabled, startAnimation]);

  const onPointerDown = useCallback(
    (event) => {
      if (!enabled || !ref.current || reducedMotionRef.current || event.isPrimary === false) return;
      if (activePointerIdRef.current !== null && activePointerIdRef.current !== event.pointerId) return;

      activePointerIdRef.current = event.pointerId;
      if (event.pointerType === "touch" || event.pointerType === "pen") event.preventDefault();
      try {
        ref.current.setPointerCapture?.(event.pointerId);
      } catch {
        // Older WebKit can reject capture while promoting a touch to a gesture.
      }
      targetRef.current = calculateTilt(event, ref.current, motion);
      startAnimation();
    },
    [enabled, motion, startAnimation]
  );

  const onPointerMove = useCallback(
    (event) => {
      if (!enabled || !ref.current || reducedMotionRef.current || event.isPrimary === false) return;

      const isTouchPointer = event.pointerType === "touch" || event.pointerType === "pen";

      if (isTouchPointer && activePointerIdRef.current !== event.pointerId) return;
      if (isTouchPointer) event.preventDefault();

      targetRef.current = calculateTilt(event, ref.current, motion);
      startAnimation();
    },
    [enabled, motion, startAnimation]
  );

  const onPointerEnd = useCallback((event) => {
    if (event?.pointerId != null && activePointerIdRef.current === event.pointerId) {
      try {
        if (ref.current?.hasPointerCapture?.(event.pointerId)) {
          ref.current.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Capture may already have been released by Safari after cancellation.
      }
      activePointerIdRef.current = null;
    }

    setNeutral(targetRef);
    startAnimation();
  }, [startAnimation]);

  const onLostPointerCapture = useCallback((event) => {
    if (event?.pointerId == null || activePointerIdRef.current === event.pointerId) {
      activePointerIdRef.current = null;
      setNeutral(targetRef);
      startAnimation();
    }
  }, [startAnimation]);

  const onPointerLeave = useCallback(
    (event) => {
      if (event.pointerType === "mouse" || activePointerIdRef.current === null) {
        setNeutral(targetRef);
        startAnimation();
      }
    },
    [startAnimation]
  );

  return {
    ref,
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onPointerLeave,
    onLostPointerCapture,
  };
}
