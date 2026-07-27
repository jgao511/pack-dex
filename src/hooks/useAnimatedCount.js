import { useEffect, useRef, useState } from "react";

export function useAnimatedCount(target, {
  enabled = true,
  reducedMotion = false,
  animationKey = target,
  duration = 1100,
} = {}) {
  const numericTarget = Number.isFinite(Number(target)) ? Number(target) : 0;
  const [value, setValue] = useState(reducedMotion ? numericTarget : 0);
  const animatedKeyRef = useRef(null);

  useEffect(() => {
    if (!enabled || animatedKeyRef.current === animationKey) return undefined;
    animatedKeyRef.current = animationKey;

    if (reducedMotion) {
      setValue(numericTarget);
      return undefined;
    }

    setValue(0);
    const startedAt = performance.now();
    let frameId = 0;
    const tick = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(numericTarget * eased));
      if (progress < 1) frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [animationKey, duration, enabled, numericTarget, reducedMotion]);

  return reducedMotion ? numericTarget : value;
}
