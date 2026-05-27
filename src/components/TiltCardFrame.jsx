import { useCardTilt } from "./useCardTilt.js";

function TiltCardFrame({ children, variant = "default", className = "", enabled = true }) {
  const tilt = useCardTilt({
    enabled,
    intensity: "normal",
  });

  return (
    <div
      ref={tilt.ref}
      className={`tilt-card-shell tilt-card-shell--${variant} ${enabled ? "is-interactive" : "is-static"} ${className}`.trim()}
      onMouseMove={enabled ? tilt.onMouseMove : undefined}
      onMouseLeave={enabled ? tilt.onMouseLeave : undefined}
    >
      <div className={`tilt-card-frame tilt-card-frame--${variant}`}>
        {children}
      </div>
    </div>
  );
}

export default TiltCardFrame;
