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
  };
}

export function useCardTilt({ enabled = true, intensity = "normal" } = {}) {
  const ref = useRef(null);
  const frameRef = useRef(0);
  const currentRef = useRef({ ...NEUTRAL_TILT });
  const targetRef = useRef({ ...NEUTRAL_TILT });
  const motion = INTENSITY[intensity] || INTENSITY.normal;

  useEffect(() => {
    if (!enabled) {
      setNeutral(targetRef);
      if (ref.current) writeTiltVars(ref.current, NEUTRAL_TILT);
      return undefined;
    }

    function animate() {
      const element = ref.current;

      if (element) {
        const current = currentRef.current;
        const target = targetRef.current;

        for (const key of Object.keys(current)) {
          current[key] += (target[key] - current[key]) * motion.ease;
        }

        writeTiltVars(element, current);
      }

      frameRef.current = requestAnimationFrame(animate);
    }

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [enabled, motion.ease]);

  useEffect(() => {
    if (!enabled) return undefined;

    function handleDocumentMouseMove(event) {
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
      }
    }

    window.addEventListener("mousemove", handleDocumentMouseMove, { passive: true });

    return () => {
      window.removeEventListener("mousemove", handleDocumentMouseMove);
    };
  }, [enabled]);

  const onMouseMove = useCallback(
    (event) => {
      if (!enabled || !ref.current) return;

      targetRef.current = calculateTilt(event, ref.current, motion);
    },
    [enabled, motion]
  );

  const onMouseLeave = useCallback(() => {
    setNeutral(targetRef);
  }, []);

  return {
    ref,
    onMouseMove,
    onMouseLeave,
  };
}
